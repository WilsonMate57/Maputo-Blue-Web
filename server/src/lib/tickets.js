// ─────────────────────────────────────────────────────────────────────────────
// tickets.js — Booking tickets (PDF + HTML data) and QR verification.
//
// The QR code encodes only a verification URL:
//   <site>/pages/verify.html?r=<reference>&k=<signature>
// signature = HMAC-SHA256(TICKET_SECRET, "<reference>|<ticket_version>"),
// base64url, 128 bits. It is unguessable, carries no personal data, can be
// regenerated for any (re)download, and is revoked by bumping ticket_version.
// Every value printed comes from the persisted booking (price snapshot), never
// from the current package price.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { brandFonts } from './pdf-fonts.js';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { getSetting } from './catalog.js';

export function ticketSignature(cfg, reference, version) {
  return crypto.createHmac('sha256', cfg.ticketSecret).update(`${reference}|${version}`).digest('base64url').slice(0, 22);
}

export function checkSignature(cfg, reference, version, sig) {
  const expected = Buffer.from(ticketSignature(cfg, reference, version));
  const given = Buffer.from(String(sig || ''));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export function verifyUrl(cfg, b) {
  return `${cfg.publicBaseUrl}/pages/verify.html?r=${encodeURIComponent(b.reference)}&k=${ticketSignature(cfg, b.reference, b.ticket_version || 1)}`;
}

/* ── Labels (ticket language = the booking's language) ─────────────────── */
const L = {
  pt: {
    doc: { pending: 'Comprovativo de pedido de reserva', confirmed: 'Confirmação de reserva', completed: 'Reserva concluída',
           cancelled: 'Reserva cancelada', rejected: 'Pedido de reserva não aceite' },
    status: { pending: 'Pendente — a aguardar confirmação', confirmed: 'Confirmada', completed: 'Concluída', cancelled: 'Cancelada', rejected: 'Rejeitada' },
    pay: { unpaid: 'Por pagar', partial: 'Pago parcialmente', paid: 'Pago', refunded: 'Reembolsado' },
    ref: 'Referência', issued: 'Emitido em', customer: 'Cliente', contact: 'Contacto', experience: 'Experiência',
    date: 'Data', checkin: 'Check-in', checkout: 'Check-out', guests: 'Participantes', adults: 'adulto(s)', children: 'criança(s)',
    option: 'Opção', details: 'Detalhe do preço', subtotal: 'Subtotal', discount: 'Desconto', total: 'Total', status_l: 'Estado da reserva',
    payment: 'Pagamento', paid_amount: 'Valor pago', meeting: 'Ponto de encontro', duration: 'Duração', notes: 'Observações do cliente',
    conditions: 'Informações importantes', scan: 'Digitalize para verificar a validade desta reserva.',
    pendingNote: 'Este pedido ainda NÃO está confirmado. Receberá um e-mail quando a disponibilidade for confirmada.',
    cancelNote: 'Esta reserva não é válida para utilização.',
    childOnRequest: 'Preço das crianças sob consulta — a confirmar pela equipa.',
    disclaimer: 'Este documento comprova os dados da reserva. Não é um recibo nem um documento fiscal.',
    onRequest: 'sob consulta', page: 'Página',
  },
  en: {
    doc: { pending: 'Booking request receipt', confirmed: 'Booking confirmation', completed: 'Booking completed',
           cancelled: 'Booking cancelled', rejected: 'Booking request not accepted' },
    status: { pending: 'Pending — awaiting confirmation', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', rejected: 'Rejected' },
    pay: { unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', refunded: 'Refunded' },
    ref: 'Reference', issued: 'Issued on', customer: 'Customer', contact: 'Contact', experience: 'Experience',
    date: 'Date', checkin: 'Check-in', checkout: 'Check-out', guests: 'Guests', adults: 'adult(s)', children: 'child(ren)',
    option: 'Option', details: 'Price details', subtotal: 'Subtotal', discount: 'Discount', total: 'Total', status_l: 'Booking status',
    payment: 'Payment', paid_amount: 'Amount paid', meeting: 'Meeting point', duration: 'Duration', notes: 'Customer notes',
    conditions: 'Important information', scan: 'Scan to verify that this booking is valid.',
    pendingNote: 'This request is NOT confirmed yet. You will receive an e-mail once availability is confirmed.',
    cancelNote: 'This booking is not valid for use.',
    childOnRequest: 'Children price on request — to be confirmed by our team.',
    disclaimer: 'This document confirms the booking details. It is not a receipt or a tax document.',
    onRequest: 'on request', page: 'Page',
  },
};

const money = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fmtDate = (d, lang, opts) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d)
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { timeZone: 'Africa/Maputo', ...(opts || { day: '2-digit', month: 'long', year: 'numeric' }) });

/** Mask the phone for printing: keep country code + last 3 digits. */
function maskPhone(p) {
  const s = String(p || '').replace(/\s+/g, ' ').trim();
  if (s.length <= 6) return s;
  return s.slice(0, 4) + s.slice(4, -3).replace(/\d/g, '•') + s.slice(-3);
}

/** Everything a ticket shows, from persisted data only. */
export async function ticketData(db, cfg, b) {
  const lang = b.locale === 'en' ? 'en' : 'pt';
  const t = L[lang];
  const snap = b.price_snapshot || {};
  const q = snap.quote || {};
  const company = await getSetting(db, 'company');
  const { rows: [pkg] } = await db.query('select kind, content from packages where id = $1', [b.package_id]);
  const content = (pkg && pkg.content) || {};
  const pick = (o, k) => (lang === 'en' ? o[`${k}_en`] || o[k] : o[k]);
  const mp = snap.package && snap.package.meeting_point;
  const info = pick(content, 'important_info');
  const lines = (q.lines || []).map(l => ({
    label: lang === 'en' ? l.label_en || l.label : l.label, quantity: l.quantity, qty_in_label: !!l.qty_in_label,
    unit_price: l.unit_price, amount: l.unit_price === null ? null : l.amount,
  }));
  const optionLine = (q.lines || []).find(l => (l.type === 'group' || l.type === 'night') && b.option_key);
  return {
    lang, labels: t,
    company: Object.fromEntries(Object.entries(company).filter(([, v]) => v)),
    reference: b.reference,
    issued_at: new Date().toISOString(),
    status: b.status, status_label: t.status[b.status] || b.status,
    doc_title: t.doc[b.status] || t.doc.pending,
    payment_status: b.payment_status, payment_label: t.pay[b.payment_status] || b.payment_status,
    amount_paid: Number(b.amount_paid) || 0,
    customer_name: b.customer_name, customer_phone_masked: maskPhone(b.customer_phone),
    package_title: lang === 'en' ? snap.package?.title_en || snap.package?.title : snap.package?.title,
    kind: snap.package?.kind || (pkg && pkg.kind) || 'tour',
    start_date: b.start_date, end_date: b.end_date,
    date_label: fmtDate(b.start_date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    end_label: b.end_date !== b.start_date ? fmtDate(b.end_date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : null,
    adults: b.adults, children: b.children,
    option_name: optionLine ? (lang === 'en' ? optionLine.label_en : optionLine.label) : null,
    currency: b.currency, lines,
    subtotal: q.subtotal ?? b.total,
    discounts: (q.discounts || []).map(d => ({ label: lang === 'en' ? d.label_en || d.label : d.label, amount: d.amount })),
    total: Number(b.total),
    manual_total: !!snap.manual_total,
    child_price_on_request: !!q.child_price_on_request,
    meeting_point: mp ? [mp.name, mp.address].filter(Boolean).join(' — ') : null,
    duration: pick(content, 'duration') || null,
    customer_notes: b.customer_notes || null,
    conditions: Array.isArray(info) && info.length ? info.slice(0, 6) : null,
    checked_in_at: b.checked_in_at || null,
    verify_url: verifyUrl(cfg, b),
  };
}

export async function qrSvg(url) {
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0A2540', light: '#FFFFFF' } });
}

let logoCache = null;
async function logoPng(cfg) {
  if (logoCache) return logoCache;
  const file = path.join(cfg.siteRoot, 'logo.webp');
  // Read into memory: on Windows sharp keeps files it opened locked
  logoCache = fs.existsSync(file) ? await sharp(fs.readFileSync(file)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer() : null;
  return logoCache;
}

/* ── PDF ───────────────────────────────────────────────────────────────── */
const C = { navy: '#0A2540', teal: '#00838F', coral: '#C2410C', text: '#334155', muted: '#64748B', line: '#E2E8F0', soft: '#F4F7FB' };
const STATUS_COLORS = { confirmed: '#047857', completed: '#1D4ED8', pending: '#B45309', cancelled: '#B91C1C', rejected: '#B91C1C' };

/** Render an A4 PDF (selectable text, vector QR). Returns a Buffer. */
export async function renderTicketPdf(cfg, d) {
  const t = d.labels;
  const qr = QRCode.create(d.verify_url, { errorCorrectionLevel: 'M' });
  const logo = await logoPng(cfg);
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 48, bottom: 56, left: 50, right: 50 },
    info: { Title: `${d.doc_title} ${d.reference}`, Author: d.company.trade_name || 'Maputo Blue', Subject: d.package_title || '' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(r => doc.on('end', r));
  const W = doc.page.width, M = 50, CW = W - 2 * M;
  const F = brandFonts(doc);

  // Header: logo + company block
  let y = 44;
  if (logo) doc.image(logo, M, y, { height: 56 });
  doc.font(F.bold).fontSize(16).fillColor(C.navy).text(d.company.trade_name || 'Maputo Blue', M + 72, y + 4, { width: 220 });
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted);
  const contact = [d.company.legal_name, d.company.address, [d.company.phone, d.company.email].filter(Boolean).join('  ·  '), d.company.website,
    d.company.nuit ? `NUIT ${d.company.nuit}` : null, d.company.licence ? `Alvará ${d.company.licence}` : null].filter(Boolean);
  doc.text(contact.join('\n'), M + 72, y + 24, { width: 250, lineGap: 1 });

  // Title block (right)
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(t.ref.toUpperCase(), W - M - 200, y + 2, { width: 200, align: 'right', characterSpacing: 0.6 });
  doc.font(F.heavy).fontSize(20).fillColor(C.navy).text(d.reference, W - M - 200, y + 14, { width: 200, align: 'right', characterSpacing: 1 });
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(`${t.issued} ${fmtDate(d.issued_at, d.lang, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    W - M - 200, y + 40, { width: 200, align: 'right' });
  y = Math.max(doc.y, y + 64) + 14;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 16;

  // Document title + status
  doc.font(F.heavy).fontSize(17).fillColor(C.navy).text(d.doc_title, M, y, { width: CW });
  const sc = STATUS_COLORS[d.status] || C.muted;
  const statusText = d.status_label.toUpperCase();
  y = doc.y + 6;
  doc.font(F.bold).fontSize(8.5);
  const sw = doc.widthOfString(statusText) + 22;
  doc.roundedRect(M, y, sw, 20, 10).lineWidth(1.2).strokeColor(sc).stroke();
  doc.fillColor(sc).text(statusText, M, y + 6, { width: sw, align: 'center' });
  y += 32;
  if (d.status === 'pending' || d.status === 'cancelled' || d.status === 'rejected') {
    const note = d.status === 'pending' ? t.pendingNote : t.cancelNote;
    doc.font(F.regular).fontSize(9.5);
    const h = doc.heightOfString(note, { width: CW - 24 }) + 16;
    doc.roundedRect(M, y, CW, h, 6).fillColor(d.status === 'pending' ? '#FFF7ED' : '#FEF2F2').fill();
    doc.fillColor(sc).text(note, M + 12, y + 8, { width: CW - 24 });
    y += h + 12;
  }

  // Booking details (left) + QR (right)
  const qrSize = 132, qrX = W - M - qrSize, top = y;
  const rows = [
    [t.experience, d.package_title],
    [d.kind === 'accommodation' ? t.checkin : t.date, d.date_label],
    d.end_label ? [t.checkout, d.end_label] : null,
    [t.guests, `${d.adults} ${t.adults}${d.children ? `, ${d.children} ${t.children}` : ''}`],
    d.option_name ? [t.option, d.option_name] : null,
    d.duration ? [t.duration, d.duration] : null,
    [t.customer, d.customer_name],
    [t.contact, d.customer_phone_masked],
    d.meeting_point ? [t.meeting, d.meeting_point] : null,
  ].filter(Boolean);
  const colW = CW - qrSize - 24;
  for (const [k, v] of rows) {
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(k.toUpperCase(), M, y, { width: colW, characterSpacing: 0.5 });
    doc.font(F.bold).fontSize(10.5).fillColor(C.navy).text(String(v || '—'), M, doc.y + 1, { width: colW });
    y = doc.y + 7;
  }
  // QR as vector modules
  const n = qr.modules.size, cell = (qrSize - 12) / n;
  doc.roundedRect(qrX, top, qrSize, qrSize, 8).lineWidth(1).strokeColor(C.line).stroke();
  // One path filled once: no hairline seams between modules
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(qrX + 6 + c * cell, top + 6 + r * cell, cell, cell);
  doc.fillColor(C.navy).fill();
  doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.scan, qrX - 6, top + qrSize + 6, { width: qrSize + 12, align: 'center' });
  y = Math.max(y, doc.y) + 10;

  // Price table
  doc.font(F.bold).fontSize(11).fillColor(C.navy).text(t.details, M, y);
  y = doc.y + 6;
  const row = (label, value, opts = {}) => {
    if (y > doc.page.height - 120) { doc.addPage(); y = 56; }
    doc.font(opts.bold ? F.bold : F.regular).fontSize(opts.size || 9.5).fillColor(opts.color || C.text);
    const h = Math.max(doc.heightOfString(label, { width: CW - 150 }), 12);
    doc.text(label, M + 8, y + 5, { width: CW - 150 });
    doc.text(value, W - M - 140, y + 5, { width: 132, align: 'right' });
    y += h + 10;
    if (!opts.noLine) doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(C.line).stroke();
  };
  doc.rect(M, y, CW, 1).fillColor(C.line).fill();
  for (const l of d.lines) {
    const label = `${l.label}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}${l.unit_price !== null && l.quantity > 1 ? `  (${money(l.unit_price, d.currency)})` : ''}`;
    row(label, l.amount === null ? t.onRequest : money(l.amount, d.currency));
  }
  if (d.discounts.length) {
    row(t.subtotal, money(d.subtotal, d.currency));
    for (const x of d.discounts) row(`${t.discount}: ${x.label}`, `- ${money(x.amount, d.currency)}`, { color: '#047857' });
  }
  if (y > doc.page.height - 150) { doc.addPage(); y = 56; }
  doc.rect(M, y + 4, CW, 30).fillColor(C.soft).fill();
  doc.font(F.bold).fontSize(12).fillColor(C.navy).text(t.total, M + 10, y + 13);
  doc.text(money(d.total, d.currency), W - M - 200, y + 13, { width: 190, align: 'right' });
  y += 44;
  const payLine = `${t.payment}: ${d.payment_label}${d.amount_paid > 0 && d.payment_status !== 'paid' ? ` — ${t.paid_amount} ${money(d.amount_paid, d.currency)}` : ''}`;
  doc.font(F.regular).fontSize(9.5).fillColor(C.text).text(payLine, M, y, { width: CW });
  y = doc.y + 4;
  if (d.child_price_on_request) { doc.fillColor(C.coral).text(t.childOnRequest, M, y, { width: CW }); y = doc.y + 4; }

  // Notes + conditions
  const block = (title, body) => {
    if (y > doc.page.height - 140) { doc.addPage(); y = 56; }
    y += 10;
    doc.font(F.bold).fontSize(10).fillColor(C.navy).text(title, M, y, { width: CW });
    doc.font(F.regular).fontSize(9).fillColor(C.text).text(body, M, doc.y + 3, { width: CW, lineGap: 1.5 });
    y = doc.y;
  };
  if (d.customer_notes) block(t.notes, d.customer_notes);
  if (d.conditions) block(t.conditions, d.conditions.map(c => `• ${c}`).join('\n'));

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make pdfkit add a blank page
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 40;
    doc.moveTo(M, fy - 8).lineTo(W - M, fy - 8).lineWidth(0.6).strokeColor(C.line).stroke();
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted)
      .text(t.disclaimer, M, fy, { width: CW - 60, lineBreak: false })
      .text([d.company.website, d.company.phone].filter(Boolean).join('  ·  '), M, fy + 11, { width: CW - 60, lineBreak: false });
    doc.text(`${t.page} ${i + 1}/${range.count}`, W - M - 60, fy, { width: 60, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/**
 * Outbox attachment resolver: e-mails queued with data.attach_ticket_booking
 * get the ticket PDF generated at send time (always the current status).
 */
export function ticketAttachments(pool, cfg) {
  return async job => {
    const id = job.data && job.data.attach_ticket_booking;
    if (!id) return [];
    const { rows: [b] } = await pool.query('select * from bookings where id = $1', [id]);
    if (!b) return [];
    const pdf = await renderTicketPdf(cfg, await ticketData(pool, cfg, b));
    return [{ filename: `maputo-blue-${b.reference}.pdf`, content: pdf.toString('base64') }];
  };
}

/** Public, minimal view of a booking for QR verification. */
export function verificationView(b, snap, lang = 'pt') {
  return {
    reference: b.reference,
    package_title: lang === 'en' ? snap.package?.title_en || snap.package?.title : snap.package?.title,
    start_date: b.start_date, end_date: b.end_date,
    guests: b.adults + b.children, adults: b.adults, children: b.children,
    status: b.status, payment_status: b.payment_status,
    checked_in: !!b.checked_in_at,
  };
}
