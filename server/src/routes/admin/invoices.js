// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/invoices.js — Invoices, verified payments and financial
// reporting. Mounted under /api/admin (admin role enforced by the parent).
// ─────────────────────────────────────────────────────────────────────────────
import {
  DISPLAY_STATUSES, cancelInvoice, createInvoice, currentInvoicePdf, deleteDraft, displayStatus, displayStatusSql,
  invoiceFilename, issueDraft, lookupForInvoice, queueInvoiceMail, updateDraft,
} from '../../lib/invoices.js';
import { METHODS, cents, recordPayment } from '../../lib/payments.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayLocal } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const nullableDate = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const idParams = { params: { type: 'object', properties: { id: uuid } } };
const REF = { type: 'string', minLength: 4, maxLength: 20, pattern: '^[A-Za-z]{2}-[A-Za-z0-9]{4,10}$' };

const billing = { type: 'object', properties: {
  name: { type: 'string', maxLength: 160 }, email: { type: 'string', maxLength: 200, pattern: '^$|^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' },
  nuit: { type: ['string', 'null'], maxLength: 40 }, address: { type: ['string', 'null'], maxLength: 300 } } };
export const paymentBody = {
  type: 'object', required: ['verified'],
  properties: {
    kind: { type: 'string', enum: ['payment', 'refund', 'reversal'] },
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    method: { type: 'string', enum: METHODS },
    reference: { type: 'string', maxLength: 120 },
    note: { type: 'string', maxLength: 500 },
    payment_date: date,
    verified: { type: 'boolean' },
    idempotency_key: { type: 'string', minLength: 8, maxLength: 80 },
    reverses_payment_id: uuid,
    notify: { type: 'boolean' },
  },
};

const listQuery = { type: 'object', properties: {
  q: { type: 'string', maxLength: 100 }, status: { type: 'string', maxLength: 120 }, method: { type: 'string', enum: METHODS },
  from: date, to: date, page: { type: 'string', pattern: '^\\d{1,5}$' }, page_size: { type: 'string', pattern: '^\\d{1,3}$' },
  sort: { type: 'string', enum: ['issued_desc', 'issued_asc', 'number_desc', 'balance_desc', 'due_asc'] } } };

const ORDER = {
  issued_desc: 'i.issue_date desc nulls first, i.created_at desc', issued_asc: 'i.issue_date asc nulls last, i.created_at asc',
  number_desc: 'i.year desc nulls first, i.seq desc nulls first', balance_desc: '(i.total - i.amount_paid) desc, i.issue_date desc',
  due_asc: 'i.due_date asc nulls last',
};

function filters(q, today) {
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replaceAll('?', `$${params.length}`)); };
  if (q.status) {
    const st = q.status.split(',').filter(s => DISPLAY_STATUSES.includes(s));
    if (st.length) {
      params.push(today);
      add(`(${displayStatusSql(`$${params.length}`)}) = any(?)`, st);
    }
  }
  if (q.method) add(`exists (select 1 from payments p where p.booking_id = i.booking_id and p.method = ?)`, q.method);
  if (q.from) add(`coalesce(i.issue_date, (i.created_at at time zone 'Africa/Maputo')::date) >= ?`, q.from);
  if (q.to) add(`coalesce(i.issue_date, (i.created_at at time zone 'Africa/Maputo')::date) <= ?`, q.to);
  if (q.q) add(`(i.number ilike ? or i.booking_snapshot->>'reference' ilike ? or i.customer->>'name' ilike ? or i.customer->>'email' ilike ?)`,
    `%${q.q.trim().replace(/[%_\\]/g, m => '\\' + m)}%`);
  return { sql: where.length ? 'where ' + where.join(' and ') : '', params };
}

const LIST_COLS = `i.id, i.number, i.doc_status, i.pay_status, i.issue_date, i.due_date, i.currency, i.total, i.amount_paid,
  (i.total - i.amount_paid)::numeric(12,2) as balance, i.customer->>'name' as customer_name, i.customer->>'email' as customer_email,
  i.booking_id, i.booking_snapshot->>'reference' as booking_reference, i.booking_snapshot->>'title' as service, i.created_at,
  (select string_agg(distinct p.method, ',') from payments p where p.booking_id = i.booking_id and p.kind = 'payment') as methods`;

const csvCell = v => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function invoiceRoutes(app) {
  const { pool, cfg } = app;

  async function loadInvoice(id) {
    const { rows: [inv] } = await pool.query('select * from invoices where id = $1', [id]);
    if (!inv) throw notFound('invoice_not_found');
    return inv;
  }
  const withStatus = r => ({ ...r, display_status: displayStatus(r) });

  // ── List / CSV ─────────────────────────────────────────────────────────────
  app.get('/invoices', { schema: { querystring: listQuery } }, async req => {
    const { sql, params } = filters(req.query, todayLocal());
    const pageSize = Math.min(Number(req.query.page_size || 25), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select ${LIST_COLS} from invoices i ${sql} order by ${ORDER[req.query.sort] || ORDER.issued_desc}
                   limit ${pageSize} offset ${(page - 1) * pageSize}`, params),
      pool.query(`select count(*)::int n from invoices i ${sql}`, params),
    ]);
    return { items: rows.map(withStatus), total: n, page, page_size: pageSize };
  });

  app.get('/invoices.csv', { schema: { querystring: listQuery } }, async (req, reply) => {
    const { sql, params } = filters(req.query, todayLocal());
    const { rows } = await pool.query(`select ${LIST_COLS} from invoices i ${sql} order by ${ORDER[req.query.sort] || ORDER.issued_desc} limit 20000`, params);
    const cols = ['number', 'display_status', 'issue_date', 'due_date', 'booking_reference', 'customer_name', 'customer_email', 'service',
      'currency', 'total', 'amount_paid', 'balance', 'methods'];
    const lines = [cols.join(','), ...rows.map(withStatus).map(r => cols.map(c => csvCell(r[c])).join(','))];
    await audit(pool, req.user, 'invoice', 'export', 'csv_export', { filters: req.query, rows: rows.length });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="facturas-${todayLocal()}.csv"`);
    return '﻿' + lines.join('\r\n');
  });

  // ── Financial summary (invoiced ≠ received) ────────────────────────────────
  app.get('/invoices/summary', { schema: { querystring: { type: 'object', properties: { from: date, to: date } } } }, async req => {
    const today = todayLocal();
    const from = req.query.from || addDays(today, -30);
    const to = req.query.to || today;
    if (to < from) throw badRequest('invalid_range');
    const monthly = (Date.parse(to) - Date.parse(from)) / 864e5 > 62;
    const bucket = col => monthly ? `to_char(${col}, 'YYYY-MM')` : `to_char(${col}, 'YYYY-MM-DD')`;
    const [inv, pay, outstanding, series] = await Promise.all([
      pool.query(
        `select i.currency, count(*)::int as issued, coalesce(sum(i.total),0) as invoiced,
                count(*) filter (where i.pay_status = 'paid')::int as paid,
                count(*) filter (where i.pay_status = 'partially_paid')::int as partially_paid,
                count(*) filter (where i.pay_status = 'unpaid')::int as unpaid,
                count(*) filter (where i.pay_status in ('unpaid','partially_paid') and i.due_date < $3)::int as overdue
           from invoices i where i.doc_status = 'issued' and i.issue_date between $1 and $2 group by i.currency`, [from, to, today]),
      pool.query(
        `select currency, coalesce(sum(amount) filter (where kind = 'payment'),0) as received,
                coalesce(-sum(amount) filter (where kind <> 'payment'),0) as returned, coalesce(sum(amount),0) as net
           from payments where payment_date between $1 and $2 group by currency`, [from, to]),
      // Open balances right now, whatever the issue date
      pool.query(
        `select currency, coalesce(sum(total - amount_paid),0) as outstanding,
                coalesce(sum(total - amount_paid) filter (where due_date < $1),0) as overdue_amount, count(*)::int as open
           from invoices where doc_status = 'issued' and pay_status in ('unpaid','partially_paid') group by currency`, [today]),
      pool.query(
        `select k, currency, sum(invoiced) as invoiced, sum(received) as received from (
           select ${bucket('issue_date')} as k, currency, total as invoiced, 0 as received from invoices
            where doc_status = 'issued' and issue_date between $1 and $2
           union all
           select ${bucket('payment_date')}, currency, 0, amount from payments where payment_date between $1 and $2
         ) x group by k, currency order by k`, [from, to]),
    ]);
    const currencies = [...new Set([...inv.rows, ...pay.rows, ...outstanding.rows].map(r => r.currency))];
    const by = (rows, cur) => rows.find(r => r.currency === cur) || {};
    return {
      range: { from, to }, granularity: monthly ? 'month' : 'day',
      currencies: currencies.map(cur => {
        const a = by(inv.rows, cur), p = by(pay.rows, cur), o = by(outstanding.rows, cur);
        return { currency: cur, invoiced: Number(a.invoiced || 0), issued: a.issued || 0, paid: a.paid || 0, partially_paid: a.partially_paid || 0,
          unpaid: a.unpaid || 0, overdue: a.overdue || 0, received: Number(p.received || 0), returned: Number(p.returned || 0), net_received: Number(p.net || 0),
          outstanding_now: Number(o.outstanding || 0), overdue_now: Number(o.overdue_amount || 0), open_now: o.open || 0 };
      }),
      series: series.rows.map(r => ({ key: r.k, currency: r.currency, invoiced: Number(r.invoiced), received: Number(r.received) })),
    };
  });

  // ── Create from a booking reference ────────────────────────────────────────
  app.get('/invoices/lookup', { schema: { querystring: { type: 'object', required: ['reference'], properties: { reference: REF } } } },
    async req => lookupForInvoice(pool, req.query.reference));

  app.post('/invoices', {
    schema: { body: { type: 'object', required: ['booking_reference'], properties: {
      booking_reference: REF, issue: { type: 'boolean' }, billing, notes: { type: ['string', 'null'], maxLength: 1000 }, due_date: nullableDate,
      payment: paymentBody, send_email: { type: 'boolean' } } } },
  }, async (req, reply) => {
    const { rows: [b] } = await pool.query('select id from bookings where reference = $1', [req.body.booking_reference.toUpperCase()]);
    if (!b) throw notFound('booking_not_found', 'No booking with this reference');
    if (req.body.payment && !req.body.issue) throw badRequest('payment_requires_issue');
    const { invoice } = await createInvoice(pool, cfg, { bookingId: b.id, actor: req.user, issue: !!req.body.issue,
      billing: req.body.billing, notes: req.body.notes, due_date: req.body.due_date, payment: req.body.payment, send_email: !!req.body.send_email });
    reply.code(201);
    return withStatus(invoice);
  });

  // ── Detail ─────────────────────────────────────────────────────────────────
  app.get('/invoices/:id', { schema: idParams }, async req => {
    const inv = await loadInvoice(req.params.id);
    const [{ rows: [b] }, payments, history, doc, related] = await Promise.all([
      pool.query('select id, reference, status, payment_status, total, amount_paid, currency, start_date, cancelled_at from bookings where id = $1', [inv.booking_id]),
      pool.query(`select p.*, u.name as recorded_by_name, exists (select 1 from payments r where r.reverses_payment_id = p.id) as reversed
                    from payments p left join users u on u.id = p.recorded_by where p.booking_id = $1 order by p.recorded_at`, [inv.booking_id]),
      pool.query(`select a.at, a.action, a.data, a.actor_type, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
                   where a.entity_type = 'invoice' and a.entity_id = $1 order by a.at desc`, [inv.id]),
      pool.query('select sha256, length(pdf)::int as bytes, created_at from invoice_documents where invoice_id = $1', [inv.id]),
      pool.query(`select id, number, doc_status from invoices where (id = $1 or replaces_invoice_id = $2) and id <> $2`, [inv.replaces_invoice_id, inv.id]),
    ]);
    const warnings = [];
    if (inv.doc_status === 'issued' && cents(b.total) !== cents(inv.total)) warnings.push('booking_total_changed');
    if (inv.doc_status === 'issued' && ['cancelled', 'rejected'].includes(b.status)) warnings.push('booking_cancelled');
    const balance = (cents(inv.total) - cents(inv.amount_paid)) / 100;
    return { invoice: { ...withStatus(inv), balance }, booking: b, payments: payments.rows, history: history.rows,
      document: doc.rows[0] || null, related: related.rows, warnings };
  });

  app.patch('/invoices/:id', {
    schema: { ...idParams, body: { type: 'object', properties: { billing, notes: { type: ['string', 'null'], maxLength: 1000 }, due_date: nullableDate } } },
  }, async req => withStatus(await updateDraft(pool, { invoiceId: req.params.id, actor: req.user, patch: req.body })));

  app.delete('/invoices/:id', { schema: idParams }, async req => deleteDraft(pool, { invoiceId: req.params.id, actor: req.user }));

  app.post('/invoices/:id/issue', {
    schema: { ...idParams, body: { type: ['object', 'null'], properties: { due_date: nullableDate, payment: paymentBody, send_email: { type: 'boolean' } } } },
  }, async req => {
    const body = req.body || {};
    const { invoice } = await issueDraft(pool, cfg, { invoiceId: req.params.id, actor: req.user, due_date: body.due_date, payment: body.payment, send_email: !!body.send_email });
    return withStatus(invoice);
  });

  app.post('/invoices/:id/cancel', {
    schema: { ...idParams, body: { type: 'object', required: ['reason'], properties: {
      reason: { type: 'string', minLength: 3, maxLength: 500 }, reissue: { type: 'boolean' }, send_email: { type: 'boolean' } } } },
  }, async req => {
    const r = await cancelInvoice(pool, cfg, { invoiceId: req.params.id, actor: req.user, reason: req.body.reason,
      reissue: !!req.body.reissue, send_email: !!req.body.send_email });
    return { invoice: withStatus(r.invoice), ...(r.cancelled ? { cancelled: withStatus(r.cancelled) } : {}) };
  });

  // ── Payments against the invoice's booking ─────────────────────────────────
  app.post('/invoices/:id/payments', { schema: { ...idParams, body: paymentBody } }, async (req, reply) => {
    const inv = await loadInvoice(req.params.id);
    if (inv.doc_status !== 'issued') throw badRequest('invoice_not_issued', 'Record payments on an issued invoice (or on the booking)');
    const r = await recordPayment(pool, { ...req.body, bookingId: inv.booking_id, actor: req.user });
    if (r.becamePaid && r.invoice && req.body.notify !== false) await queueInvoiceMail(pool, r.invoice, 'invoice_paid', req.user);
    reply.code(r.duplicate ? 200 : 201);
    return { payment: r.payment, duplicate: r.duplicate, invoice: r.invoice ? withStatus(r.invoice) : null, booking_payment_status: r.booking.payment_status };
  });

  // ── Documents and e-mail ───────────────────────────────────────────────────
  app.get('/invoices/:id/pdf', { schema: idParams }, async (req, reply) => {
    const inv = await loadInvoice(req.params.id);
    if (inv.doc_status === 'draft') throw badRequest('invoice_not_issued');
    const pdf = await currentInvoicePdf(pool, cfg, inv);
    await audit(pool, req.user, 'invoice', inv.id, 'pdf_downloaded', {});
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${invoiceFilename(inv)}"`);
    return reply.send(pdf);
  });

  app.get('/invoices/:id/original.pdf', { schema: idParams }, async (req, reply) => {
    const { rows: [d] } = await pool.query(
      'select d.pdf, i.number from invoice_documents d join invoices i on i.id = d.invoice_id where d.invoice_id = $1', [req.params.id]);
    if (!d) throw notFound('document_not_found');
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${invoiceFilename(d).replace('.pdf', '-original.pdf')}"`);
    return reply.send(d.pdf);
  });

  app.post('/invoices/:id/email', { schema: idParams }, async req => {
    const inv = await loadInvoice(req.params.id);
    if (inv.doc_status !== 'issued') throw badRequest('invoice_not_issued');
    await queueInvoiceMail(pool, inv, 'invoice_issued', req.user);
    return { ok: true, to: inv.customer.email };
  });
}
