// ─────────────────────────────────────────────────────────────────────────────
// invoices.js — Invoices issued from bookings.
//
// Workflow:  booking reference ─► review (preview) ─► [draft] ─► issued
//                                                             └─► cancelled
//   • Every value comes from the persisted booking (its price snapshot), never
//     from the current package price, and is frozen into the invoice row when
//     it is issued. A correction cancels the invoice (number kept, reason
//     recorded) and issues a new one that references it — nothing is
//     overwritten.
//   • Numbers: "<prefix> <year>/<seq>" allocated inside the issuing
//     transaction from invoice_sequences (see 003_invoices.sql): unique,
//     sequential per year and gapless, also under concurrent issuance.
//   • Issuing never marks anything paid. Verified payments (payments.js) drive
//     pay_status; a verified payment can be recorded in the same transaction
//     as the issuance when the money was already received.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { brandFonts } from './pdf-fonts.js';
import sharp from 'sharp';
import { tx } from '../db.js';
import { getSetting } from './catalog.js';
import { audit } from './audit.js';
import { addDays, todayLocal } from './dates.js';
import { badRequest, conflict, notFound } from './errors.js';
import { cents, recordPaymentTx, syncFinancialState } from './payments.js';
import { enqueueMail } from './mailer.js';

export const DISPLAY_STATUSES = ['draft', 'unpaid', 'partially_paid', 'paid', 'overdue', 'refunded', 'cancelled'];
const BILLABLE = ['pending', 'confirmed', 'completed'];

/** One status for lists and badges: document state first, then money, then due date. */
export function displayStatus(inv, today = todayLocal()) {
  if (inv.doc_status === 'draft') return 'draft';
  if (inv.doc_status === 'cancelled') return 'cancelled';
  if (inv.pay_status === 'paid' || inv.pay_status === 'refunded') return inv.pay_status;
  if (inv.due_date && inv.due_date < today) return 'overdue';
  return inv.pay_status; // unpaid | partially_paid
}

/** SQL expression equivalent of displayStatus (alias i, $today param position given). */
export const displayStatusSql = todayParam => `case
  when i.doc_status = 'draft' then 'draft'
  when i.doc_status = 'cancelled' then 'cancelled'
  when i.pay_status in ('paid','refunded') then i.pay_status
  when i.due_date is not null and i.due_date < ${todayParam}::date then 'overdue'
  else i.pay_status end`;

export async function invoiceSettings(db) {
  const s = await getSetting(db, 'invoicing');
  return {
    series_prefix: 'FT', due_days: 7, issuer: {}, tax: { enabled: false, label: 'IVA', rate: null, mode: 'inclusive' },
    payment_instructions: '', payment_instructions_en: '', footer_note: '', footer_note_en: '', ...s,
  };
}

/**
 * Invoice content computed from a booking (used for the review screen and,
 * frozen, for the issued invoice). Throws when the booking cannot be billed.
 */
export function composeInvoice(b, settings, { billing = {}, notes = null, issueDate = todayLocal(), dueDate } = {}) {
  const snap = b.price_snapshot || {};
  const q = snap.quote || {};
  const problems = [];
  if (!BILLABLE.includes(b.status)) problems.push('booking_not_billable');
  if (q.child_price_on_request && !snap.manual_total) problems.push('price_on_request');

  const lines = (q.lines || []).map(l => ({
    description: l.label, description_en: l.label_en || l.label,
    quantity: Number(l.quantity) || 1,
    unit_price: l.unit_price === null || l.unit_price === undefined ? null : Number(l.unit_price),
    amount: l.amount === null || l.amount === undefined || l.unit_price === null ? 0 : Number(l.amount),
  }));
  const discounts = (q.discounts || []).map(d => ({ description: d.label, description_en: d.label_en || d.label, amount: Number(d.amount) }));
  let subtotalC = lines.reduce((s, l) => s + cents(l.amount), 0);
  const discountC = discounts.reduce((s, d) => s + cents(d.amount), 0);
  const totalC = cents(b.total);
  // The agreed total may differ from the computed lines (manual price set by the team)
  const diffC = totalC - (subtotalC - discountC);
  if (diffC !== 0) {
    lines.push({ description: 'Ajuste de preço acordado', description_en: 'Agreed price adjustment', quantity: 1, unit_price: diffC / 100, amount: diffC / 100,
      adjustment: true, reason: snap.manual_total ? snap.manual_total.reason || null : null });
    subtotalC += diffC;
  }
  const tax = settings.tax && settings.tax.enabled && Number(settings.tax.rate) > 0
    ? { enabled: true, label: settings.tax.label || 'IVA', rate: Number(settings.tax.rate), mode: 'inclusive' }
    : { enabled: false };
  // Prices are final consumer prices: tax (when configured) is contained in the total
  const taxC = tax.enabled ? Math.round(totalC * tax.rate / (100 + tax.rate)) : 0;

  const due = dueDate || addDays(issueDate, Math.max(0, Number(settings.due_days) || 0));
  return {
    problems,
    currency: b.currency,
    locale: b.locale === 'en' ? 'en' : 'pt',
    subtotal: subtotalC / 100, discount_total: discountC / 100, tax_total: taxC / 100, total: totalC / 100,
    lines, discounts, tax,
    issuer: { ...settings.issuer },
    customer: {
      name: (billing.name || b.customer_name || '').trim(),
      email: (billing.email || b.customer_email || '').trim().toLowerCase(),
      phone: b.customer_phone || null,
      country: b.customer_country || null,
      nuit: (billing.nuit || '').trim() || null,
      address: (billing.address || '').trim() || null,
    },
    booking_snapshot: {
      reference: b.reference, package_id: b.package_id,
      title: snap.package?.title || b.package_id, title_en: snap.package?.title_en || snap.package?.title || b.package_id,
      kind: snap.package?.kind || 'tour', start_date: b.start_date, end_date: b.end_date,
      adults: b.adults, children: b.children, booking_status: b.status, booked_at: b.created_at,
    },
    notes: notes || null,
    payment_instructions: b.locale === 'en' ? settings.payment_instructions_en || settings.payment_instructions || null : settings.payment_instructions || null,
    issue_date: issueDate,
    due_date: due < issueDate ? issueDate : due,
  };
}

/** Admin "create invoice" lookup: booking by reference + preview + existing invoice + payments. */
export async function lookupForInvoice(db, reference) {
  const ref = String(reference || '').trim().toUpperCase();
  const { rows: [b] } = await db.query('select * from bookings where reference = $1', [ref]);
  if (!b) throw notFound('booking_not_found', 'No booking with this reference');
  const settings = await invoiceSettings(db);
  const [{ rows: invoices }, { rows: payments }] = await Promise.all([
    db.query(`select id, number, doc_status, pay_status, total, amount_paid, issue_date, due_date, cancelled_at
                from invoices where booking_id = $1 order by created_at desc`, [b.id]),
    db.query(`select p.id, p.kind, p.amount, p.method, p.reference, p.payment_date, p.verified_at, u.name as recorded_by_name,
                     exists (select 1 from payments r where r.reverses_payment_id = p.id) as reversed
                from payments p left join users u on u.id = p.recorded_by where p.booking_id = $1 order by p.recorded_at`, [b.id]),
  ]);
  const active = invoices.find(i => i.doc_status !== 'cancelled') || null;
  const preview = composeInvoice(b, settings);
  const paid = payments.reduce((s, p) => s + cents(p.amount), 0) / 100;
  return {
    booking: {
      id: b.id, reference: b.reference, status: b.status, payment_status: b.payment_status, created_at: b.created_at,
      customer_name: b.customer_name, customer_email: b.customer_email, customer_phone: b.customer_phone, customer_country: b.customer_country,
      start_date: b.start_date, end_date: b.end_date, adults: b.adults, children: b.children, currency: b.currency,
      total: Number(b.total), amount_paid: Number(b.amount_paid), locale: b.locale,
      manual_total: b.price_snapshot?.manual_total || null,
    },
    preview: { ...preview, amount_paid: paid, balance: (cents(preview.total) - cents(paid)) / 100 },
    existing_invoice: active ? { ...active, display_status: displayStatus(active) } : null,
    previous_invoices: invoices.filter(i => i.doc_status === 'cancelled'),
    payments,
  };
}

async function allocateNumber(c, prefix, year) {
  const { rows: [r] } = await c.query(
    `insert into invoice_sequences (series, year, last_number) values ($1, $2, 1)
     on conflict (series, year) do update set last_number = invoice_sequences.last_number + 1
     returning last_number`, [prefix, year]);
  return { seq: r.last_number, number: `${prefix} ${year}/${String(r.last_number).padStart(4, '0')}` };
}

/**
 * Create (draft) or issue an invoice for a booking.
 * opts: { bookingId, actor, issue: boolean, billing, notes, due_date, payment, send_email, replacesId }
 */
export async function createInvoice(pool, cfg, opts, client = null) {
  const run = async c => {
    const { bookingId, actor } = opts;
    const { rows: [b] } = await c.query('select * from bookings where id = $1 for update', [bookingId]);
    if (!b) throw notFound('booking_not_found');
    const { rows: [existing] } = await c.query(
      `select * from invoices where booking_id = $1 and doc_status <> 'cancelled' for update`, [b.id]);
    if (existing && !(opts.fromDraftId && existing.id === opts.fromDraftId)) {
      throw conflict('invoice_exists', 'This booking already has an invoice', { id: existing.id, number: existing.number, doc_status: existing.doc_status });
    }
    const settings = await invoiceSettings(c);
    const today = todayLocal();
    const draft = existing || null;
    // A draft keeps its edited billing details, notes and (if still valid) due date
    const draftDue = draft?.due_date && draft.due_date >= today ? draft.due_date : null;
    const input = { billing: opts.billing ?? draft?.customer, notes: opts.notes ?? draft?.notes, due_date: opts.due_date ?? draftDue };
    const inv = composeInvoice(b, settings, { billing: input.billing || {}, notes: input.notes, issueDate: today, dueDate: input.due_date || undefined });
    if (opts.issue && inv.problems.length) throw conflict(inv.problems[0], 'This booking cannot be invoiced yet', inv.problems);
    if (input.due_date && input.due_date < today) throw badRequest('invalid_due_date');
    if (!inv.customer.name || !inv.customer.email) throw badRequest('billing_incomplete');

    let number = null, seq = null, year = null;
    if (opts.issue) {
      year = Number(today.slice(0, 4));
      ({ number, seq } = await allocateNumber(c, settings.series_prefix || 'FT', year));
    }
    const values = [b.id, b.user_id, opts.issue ? settings.series_prefix || 'FT' : null, year, seq, number,
      opts.issue ? 'issued' : 'draft', inv.locale, inv.currency, inv.subtotal, inv.discount_total, inv.tax_total, inv.total,
      JSON.stringify(inv.lines), JSON.stringify(inv.discounts), JSON.stringify(inv.tax), JSON.stringify(inv.issuer),
      JSON.stringify(inv.customer), JSON.stringify(inv.booking_snapshot), inv.notes, inv.payment_instructions,
      opts.issue ? inv.issue_date : null, opts.issue ? inv.due_date : input.due_date, actor.id, opts.replacesId || null];
    let row;
    if (draft) {
      ({ rows: [row] } = await c.query(
        `update invoices set user_id=$2, series=$3, year=$4, seq=$5, number=$6, doc_status=$7, locale=$8, currency=$9, subtotal=$10,
                discount_total=$11, tax_total=$12, total=$13, lines=$14, discounts=$15, tax=$16, issuer=$17, customer=$18,
                booking_snapshot=$19, notes=$20, payment_instructions=$21, issue_date=$22, due_date=$23,
                issued_by = case when $7 = 'issued' then $24::uuid end, issued_at = case when $7 = 'issued' then now() end,
                updated_at = now()
          where id = $1 returning *`, [draft.id, ...values.slice(1, 24)]));
    } else {
      ({ rows: [row] } = await c.query(
        `insert into invoices (booking_id, user_id, series, year, seq, number, doc_status, locale, currency, subtotal, discount_total,
            tax_total, total, lines, discounts, tax, issuer, customer, booking_snapshot, notes, payment_instructions, issue_date, due_date,
            created_by, replaces_invoice_id, issued_by, issued_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
                 case when $7 = 'issued' then $24::uuid end, case when $7 = 'issued' then now() end) returning *`, values));
    }
    await audit(c, actor, 'invoice', row.id, opts.issue ? 'issued' : 'draft_saved',
      { number, booking_reference: b.reference, total: inv.total, currency: inv.currency, ...(opts.replacesId ? { replaces: opts.replacesId } : {}) });
    if (!opts.issue) return { invoice: row };

    await audit(c, actor, 'booking', b.id, 'invoice_issued', { invoice_id: row.id, number });
    // Money already received and verified can be recorded with the issuance
    if (opts.payment) await recordPaymentTx(c, { ...opts.payment, kind: 'payment', bookingId: b.id, actor });
    const state = await syncFinancialState(c, b.id);
    row = state.invoice;
    // Archive the PDF exactly as issued
    const pdf = await renderInvoicePdf(cfg, { ...row, footer_note: settings.footer_note, footer_note_en: settings.footer_note_en }, { original: true });
    const sha = crypto.createHash('sha256').update(pdf).digest('hex');
    await c.query('insert into invoice_documents (invoice_id, pdf, sha256) values ($1,$2,$3)', [row.id, pdf, sha]);
    await audit(c, actor, 'invoice', row.id, 'document_archived', { sha256: sha, bytes: pdf.length });
    if (opts.send_email) await queueInvoiceMail(c, row, 'invoice_issued', actor);
    return { invoice: row };
  };
  if (client) return run(client);
  try {
    return await tx(pool, run);
  } catch (err) {
    // Two administrators issuing for the same booking at once: the partial unique index decides
    if (err.code === '23505' && /invoices_one_active_per_booking/.test(err.constraint || err.message)) {
      throw conflict('invoice_exists', 'This booking already has an invoice');
    }
    throw err;
  }
}

/** Issue a saved draft. */
export async function issueDraft(pool, cfg, { invoiceId, actor, ...rest }) {
  const { rows: [d] } = await pool.query('select booking_id, doc_status from invoices where id = $1', [invoiceId]);
  if (!d) throw notFound('invoice_not_found');
  if (d.doc_status !== 'draft') throw conflict('invoice_not_draft', 'Only drafts can be issued');
  return createInvoice(pool, cfg, { ...rest, bookingId: d.booking_id, actor, issue: true, fromDraftId: invoiceId });
}

/** Update the editable fields of a draft. */
export async function updateDraft(pool, { invoiceId, actor, patch }) {
  return tx(pool, async c => {
    const { rows: [d] } = await c.query('select * from invoices where id = $1 for update', [invoiceId]);
    if (!d) throw notFound('invoice_not_found');
    if (d.doc_status !== 'draft') throw conflict('invoice_locked', 'Issued invoices cannot be edited; cancel and re-issue instead');
    const customer = patch.billing ? { ...d.customer, ...Object.fromEntries(Object.entries(patch.billing).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v])) } : d.customer;
    const { rows: [u] } = await c.query(
      `update invoices set customer = $2, notes = $3, due_date = $4, updated_at = now() where id = $1 returning *`,
      [d.id, JSON.stringify(customer), patch.notes !== undefined ? patch.notes || null : d.notes, patch.due_date !== undefined ? patch.due_date || null : d.due_date]);
    await audit(c, actor, 'invoice', d.id, 'draft_updated', { fields: Object.keys(patch) });
    return u;
  });
}

export async function deleteDraft(pool, { invoiceId, actor }) {
  return tx(pool, async c => {
    const { rows: [d] } = await c.query('select * from invoices where id = $1 for update', [invoiceId]);
    if (!d) throw notFound('invoice_not_found');
    if (d.doc_status !== 'draft') throw conflict('invoice_locked', 'Issued invoices cannot be deleted; cancel them instead');
    await c.query('delete from invoices where id = $1', [d.id]);
    await audit(c, actor, 'invoice', d.id, 'draft_deleted', { booking_id: d.booking_id });
    return { ok: true };
  });
}

/**
 * Cancel an issued invoice (its number stays used and visible). With
 * reissue=true a corrected invoice is issued in the same transaction from the
 * booking's current data, referencing the cancelled one.
 */
export async function cancelInvoice(pool, cfg, { invoiceId, actor, reason, reissue = false, send_email = false }) {
  if (!reason || !reason.trim()) throw badRequest('cancel_reason_required');
  return tx(pool, async c => {
    const { rows: [inv] } = await c.query('select * from invoices where id = $1 for update', [invoiceId]);
    if (!inv) throw notFound('invoice_not_found');
    if (inv.doc_status !== 'issued') throw conflict('invoice_not_issued', 'Only issued invoices can be cancelled');
    const { rows: [u] } = await c.query(
      `update invoices set doc_status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3, updated_at = now()
        where id = $1 returning *`, [inv.id, actor.id, reason.trim()]);
    await audit(c, actor, 'invoice', inv.id, 'cancelled', { number: inv.number, reason: reason.trim(), reissue });
    await audit(c, actor, 'booking', inv.booking_id, 'invoice_cancelled', { invoice_id: inv.id, number: inv.number });
    if (!reissue) {
      await syncFinancialState(c, inv.booking_id);
      return { invoice: u };
    }
    const { invoice } = await createInvoice(pool, cfg, { bookingId: inv.booking_id, actor, issue: true, billing: inv.customer,
      notes: inv.notes, replacesId: inv.id, send_email }, c);
    return { invoice, cancelled: u };
  });
}

export async function queueInvoiceMail(db, inv, template, actor) {
  const bucket = template === 'invoice_paid' ? 'paid' : Math.floor(Date.now() / 600000);
  await enqueueMail(db, { key: `invoice:${inv.id}:${template}:${bucket}`, to: inv.customer.email, template, locale: inv.locale,
    data: { number: inv.number, reference: inv.booking_snapshot.reference, customer_name: inv.customer.name,
      total: Number(inv.total), amount_paid: Number(inv.amount_paid), currency: inv.currency,
      due_date: inv.due_date, pay_status: inv.pay_status, attach_invoice: inv.id } });
  if (actor !== undefined) await audit(db, actor, 'invoice', inv.id, 'emailed', { template });
}

/* ── PDF ───────────────────────────────────────────────────────────────── */
const LABELS = {
  pt: {
    title: 'Factura', ref: 'Nº', issued: 'Data de emissão', due: 'Data de vencimento', bill_to: 'Facturado a', booking: 'Reserva',
    service: 'Serviço', service_date: 'Data do serviço', guests: 'Participantes', adults: 'adulto(s)', children: 'criança(s)',
    desc: 'Descrição', qty: 'Qtd.', unit: 'Preço unit.', amount: 'Valor', subtotal: 'Subtotal', discount: 'Desconto', total: 'Total',
    tax_incl: (l, r) => `${l} (${r}%) incluído`, tax_none: '', paid: 'Pago', balance: 'Saldo em dívida', payments: 'Pagamentos registados',
    status: { unpaid: 'NÃO PAGA', partially_paid: 'PARCIALMENTE PAGA', paid: 'PAGA', refunded: 'REEMBOLSADA', overdue: 'VENCIDA', cancelled: 'ANULADA', draft: 'RASCUNHO' },
    method: { cash: 'Numerário', bank_transfer: 'Transferência bancária', mpesa: 'M-Pesa', emola: 'e-Mola', card: 'Cartão', other: 'Outro' },
    kind: { payment: 'Pagamento', refund: 'Reembolso', reversal: 'Estorno' },
    instructions: 'Instruções de pagamento', notes: 'Observações', nuit: 'NUIT', page: 'Página',
    state_at: d => `Situação de pagamento em ${d}`, original: 'Original', cancelled_note: (d, r) => `Factura anulada em ${d}. Motivo: ${r}`,
    replaces: n => `Substitui a factura ${n}`, none: 'Sem pagamentos registados.',
  },
  en: {
    title: 'Invoice', ref: 'No.', issued: 'Issue date', due: 'Due date', bill_to: 'Billed to', booking: 'Booking',
    service: 'Service', service_date: 'Service date', guests: 'Guests', adults: 'adult(s)', children: 'child(ren)',
    desc: 'Description', qty: 'Qty', unit: 'Unit price', amount: 'Amount', subtotal: 'Subtotal', discount: 'Discount', total: 'Total',
    tax_incl: (l, r) => `${l} (${r}%) included`, tax_none: '', paid: 'Paid', balance: 'Balance due', payments: 'Recorded payments',
    status: { unpaid: 'UNPAID', partially_paid: 'PARTIALLY PAID', paid: 'PAID', refunded: 'REFUNDED', overdue: 'OVERDUE', cancelled: 'CANCELLED', draft: 'DRAFT' },
    method: { cash: 'Cash', bank_transfer: 'Bank transfer', mpesa: 'M-Pesa', emola: 'e-Mola', card: 'Card', other: 'Other' },
    kind: { payment: 'Payment', refund: 'Refund', reversal: 'Reversal' },
    instructions: 'Payment instructions', notes: 'Notes', nuit: 'NUIT', page: 'Page',
    state_at: d => `Payment status as of ${d}`, original: 'Original', cancelled_note: (d, r) => `Invoice cancelled on ${d}. Reason: ${r}`,
    replaces: n => `Replaces invoice ${n}`, none: 'No payments recorded.',
  },
};
const C = { navy: '#0A2540', teal: '#00838F', text: '#334155', muted: '#64748B', line: '#E2E8F0', soft: '#F4F7FB' };
const STATUS_COLORS = { paid: '#047857', partially_paid: '#B45309', unpaid: '#B45309', overdue: '#B91C1C', cancelled: '#B91C1C', refunded: '#475569', draft: '#475569' };
const fmtMoney = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d, lang) => (d ? new Date((/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d))
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Maputo' }) : '—');

let logoCache = null;
async function logoPng(cfg) {
  if (logoCache) return logoCache;
  const file = path.join(cfg.siteRoot, 'logo.webp');
  logoCache = fs.existsSync(file) ? await sharp(fs.readFileSync(file)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer() : null;
  return logoCache;
}

/**
 * Render an invoice as an A4 PDF from its stored snapshot.
 * opts.original: archival copy at issuance (no "status as of" line).
 * opts.payments: payment rows to list (current downloads).
 */
export async function renderInvoicePdf(cfg, inv, { original = false, payments = [], replacesNumber = null } = {}) {
  const lang = inv.locale === 'en' ? 'en' : 'pt';
  const t = LABELS[lang];
  const issuer = inv.issuer || {}, cust = inv.customer || {}, bk = inv.booking_snapshot || {};
  const status = displayStatus(inv);
  const logo = await logoPng(cfg);
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 48, bottom: 60, left: 50, right: 50 },
    info: { Title: `${t.title} ${inv.number || ''}`.trim(), Author: issuer.name || 'Maputo Blue', Subject: bk.reference || '' } });
  const chunks = [];
  doc.on('data', ch => chunks.push(ch));
  const done = new Promise(r => doc.on('end', r));
  const W = doc.page.width, M = 50, CW = W - 2 * M;
  const F = brandFonts(doc);

  // Header: logo + issuer (left), document title + number (right)
  let y = 44;
  if (logo) doc.image(logo, M, y, { height: 54 });
  const ix = M + (logo ? 70 : 0);
  doc.font(F.bold).fontSize(14).fillColor(C.navy).text(issuer.name || 'Maputo Blue', ix, y + 2, { width: 250 });
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text([
    issuer.legal_name, issuer.address, issuer.phone, issuer.email, issuer.website, issuer.nuit ? `${t.nuit}: ${issuer.nuit}` : null,
  ].filter(Boolean).join('\n'), ix, doc.y + 2, { width: 250, lineGap: 1 });
  const headBottom = doc.y;

  doc.font(F.heavy).fontSize(24).fillColor(C.navy).text(t.title.toUpperCase(), W - M - 220, y, { width: 220, align: 'right', characterSpacing: 1.5 });
  doc.font(F.regular).fontSize(9).fillColor(C.muted).text(t.ref, W - M - 220, y + 32, { width: 220, align: 'right' });
  doc.font(F.bold).fontSize(13).fillColor(C.navy).text(inv.number || t.status.draft, W - M - 220, y + 43, { width: 220, align: 'right' });
  const meta = [[t.issued, fmtDate(inv.issue_date, lang)], inv.due_date ? [t.due, fmtDate(inv.due_date, lang)] : null, [t.booking, bk.reference]].filter(Boolean);
  let my = y + 64;
  for (const [k, v] of meta) {
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(`${k}: `, W - M - 220, my, { width: 220, align: 'right', continued: false });
    doc.font(F.bold).fontSize(8.5).fillColor(C.navy).text(v, W - M - 220, my + 10, { width: 220, align: 'right' });
    my += 24;
  }
  y = Math.max(headBottom, my) + 10;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 16;

  // Status pill
  const sc = STATUS_COLORS[status] || C.muted;
  const sText = t.status[status] || status;
  doc.font(F.bold).fontSize(9);
  const sw = doc.widthOfString(sText) + 24;
  doc.roundedRect(W - M - sw, y, sw, 22, 11).lineWidth(1.4).strokeColor(sc).stroke();
  doc.fillColor(sc).text(sText, W - M - sw, y + 7, { width: sw, align: 'center' });

  // Bill to (left) + service (right column)
  const colW = (CW - 24) / 2;
  doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.bill_to.toUpperCase(), M, y, { characterSpacing: 0.6 });
  doc.font(F.bold).fontSize(11).fillColor(C.navy).text(cust.name || '—', M, doc.y + 3, { width: colW });
  doc.font(F.regular).fontSize(9).fillColor(C.text).text([
    cust.address, cust.country, cust.email, cust.nuit ? `${t.nuit}: ${cust.nuit}` : null,
  ].filter(Boolean).join('\n'), M, doc.y + 2, { width: colW, lineGap: 1 });
  const leftBottom = doc.y;
  const sx = M + colW + 24;
  let sy = y + 30;
  doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.service.toUpperCase(), sx, sy, { characterSpacing: 0.6 });
  doc.font(F.bold).fontSize(10).fillColor(C.navy).text(lang === 'en' ? bk.title_en : bk.title, sx, doc.y + 3, { width: colW });
  const when = bk.end_date && bk.end_date !== bk.start_date ? `${fmtDate(bk.start_date, lang)} – ${fmtDate(bk.end_date, lang)}` : fmtDate(bk.start_date, lang);
  doc.font(F.regular).fontSize(9).fillColor(C.text).text(`${t.service_date}: ${when}`, sx, doc.y + 2, { width: colW })
    .text(`${t.guests}: ${bk.adults} ${t.adults}${bk.children ? `, ${bk.children} ${t.children}` : ''}`, sx, doc.y + 1, { width: colW });
  y = Math.max(leftBottom, doc.y) + 20;

  // Lines table
  const cols = [{ k: 'desc', w: CW - 250 }, { k: 'qty', w: 50, a: 'right' }, { k: 'unit', w: 95, a: 'right' }, { k: 'amount', w: 105, a: 'right' }];
  const header = () => {
    doc.rect(M, y, CW, 22).fillColor(C.navy).fill();
    let x = M + 8;
    doc.font(F.bold).fontSize(8).fillColor('#FFFFFF');
    for (const c of cols) { doc.text(t[c.k].toUpperCase(), x, y + 7, { width: c.w - 12, align: c.a || 'left', characterSpacing: 0.4 }); x += c.w; }
    y += 22;
  };
  header();
  for (const l of inv.lines || []) {
    const desc = lang === 'en' ? l.description_en || l.description : l.description;
    doc.font(F.regular).fontSize(9.5);
    const h = Math.max(doc.heightOfString(desc, { width: cols[0].w - 12 }), 11) + 12;
    if (y + h > doc.page.height - 200) { doc.addPage(); y = 56; header(); }
    let x = M + 8;
    const cells = [desc, String(l.quantity), l.unit_price === null ? '—' : fmtMoney(l.unit_price, inv.currency), fmtMoney(l.amount, inv.currency)];
    cols.forEach((c, i) => { doc.fillColor(C.text).text(cells[i], x, y + 6, { width: c.w - 12, align: c.a || 'left' }); x += c.w; });
    y += h;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(C.line).stroke();
  }

  // Totals (right-aligned block)
  y += 10;
  const tx0 = W - M - 250;
  const trow = (label, value, o = {}) => {
    if (y > doc.page.height - 120) { doc.addPage(); y = 56; }
    doc.font(o.bold ? F.bold : F.regular).fontSize(o.size || 9.5).fillColor(o.color || C.text);
    doc.text(label, tx0, y, { width: 140 }).text(value, tx0 + 140, y, { width: 110, align: 'right' });
    y += (o.size || 9.5) + 8;
  };
  trow(t.subtotal, fmtMoney(inv.subtotal, inv.currency));
  for (const d of inv.discounts || []) trow(`${t.discount}: ${lang === 'en' ? d.description_en : d.description}`, `- ${fmtMoney(d.amount, inv.currency)}`, { color: '#047857' });
  doc.rect(tx0 - 8, y - 2, 258, 26).fillColor(C.soft).fill();
  y += 5;
  trow(t.total, fmtMoney(inv.total, inv.currency), { bold: true, size: 12, color: C.navy });
  if (inv.tax && inv.tax.enabled) trow(t.tax_incl(inv.tax.label, inv.tax.rate), fmtMoney(inv.tax_total, inv.currency), { size: 8.5, color: C.muted });
  trow(t.paid, fmtMoney(inv.amount_paid, inv.currency));
  const balance = (cents(inv.total) - cents(inv.amount_paid)) / 100;
  trow(t.balance, fmtMoney(Math.max(balance, 0), inv.currency), { bold: true, color: balance > 0 ? '#B45309' : '#047857' });

  // Blocks below the table
  const block = (title, body, color = C.text) => {
    if (!body) return;
    if (y > doc.page.height - 140) { doc.addPage(); y = 56; }
    y += 8;
    doc.font(F.bold).fontSize(9.5).fillColor(C.navy).text(title, M, y, { width: CW });
    doc.font(F.regular).fontSize(9).fillColor(color).text(body, M, doc.y + 3, { width: CW, lineGap: 1.5 });
    y = doc.y + 4;
  };
  if (!original) {
    const today = fmtDate(todayLocal(), lang);
    const list = payments.length
      ? payments.map(p => `${fmtDate(p.payment_date, lang)}  ·  ${t.kind[p.kind] || p.kind}  ·  ${t.method[p.method] || p.method}${p.reference ? `  ·  ${p.reference}` : ''}  ·  ${fmtMoney(p.amount, inv.currency)}`).join('\n')
      : t.none;
    block(`${t.payments} — ${t.state_at(today)}`, list);
  }
  if (inv.doc_status === 'cancelled') block(t.status.cancelled, t.cancelled_note(fmtDate(inv.cancelled_at, lang), inv.cancel_reason), '#B91C1C');
  if (replacesNumber) block(t.notes, t.replaces(replacesNumber));
  block(t.instructions, inv.payment_instructions);
  block(t.notes, inv.notes);

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 44;
    doc.moveTo(M, fy - 8).lineTo(W - M, fy - 8).lineWidth(0.6).strokeColor(C.line).stroke();
    const foot = [issuer.name, issuer.nuit ? `${t.nuit} ${issuer.nuit}` : null, issuer.phone, issuer.email].filter(Boolean).join('  ·  ');
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(foot, M, fy, { width: CW - 70, lineBreak: false });
    const note = lang === 'en' ? inv.footer_note_en : inv.footer_note;
    if (note) doc.text(note, M, fy + 11, { width: CW - 70, lineBreak: false });
    doc.text(`${original ? t.original + ' · ' : ''}${t.page} ${i + 1}/${range.count}`, W - M - 90, fy, { width: 90, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** Current PDF: frozen invoice content + today's payment state. */
export async function currentInvoicePdf(db, cfg, inv) {
  const settings = await invoiceSettings(db);
  const [{ rows: payments }, { rows: [rep] }] = await Promise.all([
    db.query(`select kind, amount, method, reference, payment_date from payments where booking_id = $1 order by payment_date, recorded_at`, [inv.booking_id]),
    inv.replaces_invoice_id ? db.query('select number from invoices where id = $1', [inv.replaces_invoice_id]) : Promise.resolve({ rows: [] }),
  ]);
  return renderInvoicePdf(cfg, { ...inv, footer_note: settings.footer_note, footer_note_en: settings.footer_note_en },
    { payments, replacesNumber: rep ? rep.number : null });
}

export const invoiceFilename = inv => `factura-${String(inv.number || 'rascunho').replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;

/** Outbox attachment resolver for e-mails queued with data.attach_invoice. */
export function invoiceAttachments(pool, cfg) {
  return async job => {
    const id = job.data && job.data.attach_invoice;
    if (!id) return [];
    const { rows: [inv] } = await pool.query(`select * from invoices where id = $1 and doc_status <> 'draft'`, [id]);
    if (!inv) return [];
    const pdf = await currentInvoicePdf(pool, cfg, inv);
    return [{ filename: invoiceFilename(inv), content: pdf.toString('base64') }];
  };
}

/** Customer-safe projection. */
export function publicInvoice(inv) {
  return {
    id: inv.id, number: inv.number, status: displayStatus(inv), doc_status: inv.doc_status, pay_status: inv.pay_status,
    issue_date: inv.issue_date, due_date: inv.due_date, currency: inv.currency, total: Number(inv.total),
    amount_paid: Number(inv.amount_paid), balance: Math.max(0, (cents(inv.total) - cents(inv.amount_paid)) / 100),
    booking_reference: inv.booking_snapshot?.reference, booking_id: inv.booking_id,
  };
}

