// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/bookings.js — Dashboard metrics and booking management.
// ─────────────────────────────────────────────────────────────────────────────
import { mailData, recordPayment, statusUrl, transitionBooking, updateBooking } from '../../lib/bookings.js';
import { randomToken, sha256 } from '../../lib/security.js';
import { enqueueMail } from '../../lib/mailer.js';
import { audit } from '../../lib/audit.js';
import { addDays, todayLocal } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled', 'completed'];

const listQuery = {
  type: 'object',
  properties: {
    q: { type: 'string', maxLength: 100 },
    status: { type: 'string', maxLength: 80 },          // comma-separated
    package_id: { type: 'string', maxLength: 90 },
    from: date, to: date,
    date_field: { type: 'string', enum: ['start_date', 'created_at'] },
    cancel_requested: { type: 'string', enum: ['1'] },
    page: { type: 'string', pattern: '^\\d{1,5}$' },
    page_size: { type: 'string', pattern: '^\\d{1,3}$' },
    sort: { type: 'string', enum: ['created_desc', 'created_asc', 'date_asc', 'date_desc'] },
  },
};

/** Build WHERE clause + params from list filters. */
function filters(q) {
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (q.status) {
    const st = q.status.split(',').filter(s => STATUSES.includes(s));
    if (st.length) add('b.status = any(?)', st);
  }
  if (q.package_id) add('b.package_id = ?', q.package_id);
  const field = q.date_field === 'created_at' ? "(b.created_at at time zone 'Africa/Maputo')::date" : 'b.start_date';
  if (q.from) add(`${field} >= ?`, q.from);
  if (q.to) add(`${field} <= ?`, q.to);
  if (q.cancel_requested) where.push(`b.cancel_requested_at is not null and b.status in ('pending','confirmed')`);
  if (q.q) {
    params.push(`%${q.q.replace(/[%_\\]/g, m => '\\' + m)}%`);
    const n = `$${params.length}`;
    where.push(`(b.reference ilike ${n} or b.customer_name ilike ${n} or b.customer_email ilike ${n} or b.customer_phone ilike ${n})`);
  }
  return { sql: where.length ? 'where ' + where.join(' and ') : '', params };
}

const ORDER = {
  created_desc: 'b.created_at desc', created_asc: 'b.created_at asc',
  date_asc: 'b.start_date asc, b.created_at asc', date_desc: 'b.start_date desc, b.created_at desc',
};

const csvCell = v => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function bookingRoutes(app) {
  const { pool, cfg } = app;

  // ── Dashboard ──────────────────────────────────────────────────────────────
  app.get('/dashboard', { schema: { querystring: { type: 'object', properties: { from: date, to: date, package_id: { type: 'string', maxLength: 90 } } } } }, async req => {
    const today = todayLocal();
    const from = req.query.from || addDays(today, -30);
    const to = req.query.to || today;
    const pkg = req.query.package_id || null;
    const range = `(b.created_at at time zone 'Africa/Maputo')::date between $1 and $2 and ($3::text is null or b.package_id = $3)`;

    const [counts, money, upcoming, recent, popular, limited, attention] = await Promise.all([
      pool.query(`select b.status, count(*)::int n from bookings b where ${range} group by b.status`, [from, to, pkg]),
      pool.query(
        `select b.currency,
                coalesce(sum(b.total) filter (where b.status in ('confirmed','completed')), 0) as confirmed_value,
                coalesce(sum(b.total) filter (where b.status = 'pending'), 0) as pending_value,
                coalesce(sum(b.amount_paid) filter (where b.status in ('confirmed','completed','cancelled')), 0) as received,
                coalesce(sum(b.total - b.amount_paid) filter (where b.status in ('confirmed','completed')), 0) as outstanding
           from bookings b where ${range} group by b.currency`, [from, to, pkg]),
      pool.query(
        `select b.id, b.reference, b.customer_name, b.start_date, b.end_date, b.adults, b.children, b.status, p.kind,
                b.price_snapshot->'package'->>'title' as package_title
           from bookings b join packages p on p.id = b.package_id
          where b.status in ('confirmed','pending') and b.start_date between $1 and $2::date + 14
            and ($3::text is null or b.package_id = $3)
          order by b.start_date, b.created_at limit 30`, [today, today, pkg]),
      pool.query(
        `select a.at, a.action, a.entity_id, a.data, a.actor_type, u.name as actor_name, b.reference
           from audit_log a left join users u on u.id = a.actor_id left join bookings b on b.id::text = a.entity_id
          where a.entity_type = 'booking' order by a.at desc limit 15`),
      pool.query(
        `select b.package_id, b.price_snapshot->'package'->>'title' as title, count(*)::int as bookings,
                sum(b.adults + b.children)::int as guests
           from bookings b where ${range} and b.status in ('pending','confirmed','completed')
          group by 1, 2 order by bookings desc limit 8`, [from, to, pkg]),
      pool.query(
        `select d.package_id, d.day, d.capacity, coalesce(sum(a.quantity) filter (where bk.status = 'confirmed'
                   or (bk.status = 'pending' and bk.hold_expires_at > now())), 0)::int as used
           from availability_days d
           left join booking_allocations a on a.package_id = d.package_id and a.resource_key = d.resource_key and a.day = d.day
           left join bookings bk on bk.id = a.booking_id
          where d.day between $1 and $1::date + 30 and d.capacity is not null and not d.closed
          group by d.package_id, d.day, d.capacity
          having d.capacity - coalesce(sum(a.quantity) filter (where bk.status = 'confirmed'
                   or (bk.status = 'pending' and bk.hold_expires_at > now())), 0) <= greatest(2, ceil(d.capacity * 0.2))
          order by d.day limit 20`, [today]),
      pool.query(
        `select count(*) filter (where status = 'pending')::int as pending,
                count(*) filter (where status = 'pending' and (hold_expires_at is null or hold_expires_at <= now()))::int as pending_hold_expired,
                count(*) filter (where cancel_requested_at is not null and status in ('pending','confirmed'))::int as cancel_requests
           from bookings`),
    ]);
    const [{ rows: [reqs] }, { rows: [mail] }] = await Promise.all([
      pool.query(`select count(*) filter (where status = 'new')::int as new_requests from custom_requests`),
      pool.query(`select count(*) filter (where status = 'failed')::int as failed_mail from mail_outbox`),
    ]);
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    counts.rows.forEach(r => { byStatus[r.status] = r.n; });
    return {
      range: { from, to },
      counts: { ...byStatus, total: Object.values(byStatus).reduce((a, b) => a + b, 0) },
      money: money.rows,
      attention: { ...attention.rows[0], ...reqs, ...mail },
      upcoming: upcoming.rows, recent: recent.rows, popular: popular.rows, limited: limited.rows,
    };
  });

  // ── Bookings list / CSV ────────────────────────────────────────────────────
  app.get('/bookings', { schema: { querystring: listQuery } }, async req => {
    const { sql, params } = filters(req.query);
    const pageSize = Math.min(Number(req.query.page_size || 25), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const order = ORDER[req.query.sort] || ORDER.created_desc;
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(
        `select b.id, b.reference, b.customer_name, b.customer_email, b.customer_phone, b.package_id,
                b.price_snapshot->'package'->>'title' as package_title, b.start_date, b.end_date, b.adults, b.children,
                b.option_key, b.extras, b.transfer_key, b.total, b.currency, b.status, b.payment_status, b.amount_paid,
                b.created_at, b.hold_expires_at, b.cancel_requested_at
           from bookings b ${sql} order by ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`, params),
      pool.query(`select count(*)::int n from bookings b ${sql}`, params),
    ]);
    return { items: rows, total: n, page, page_size: pageSize };
  });

  app.get('/bookings.csv', { schema: { querystring: listQuery } }, async (req, reply) => {
    const { sql, params } = filters(req.query);
    const { rows } = await pool.query(
      `select b.reference, b.status, b.payment_status, b.customer_name, b.customer_email, b.customer_phone, b.customer_country,
              b.package_id, b.price_snapshot->'package'->>'title' as package_title, b.start_date, b.end_date, b.adults, b.children,
              b.option_key, b.extras, b.transfer_key, b.currency, b.total, b.amount_paid, b.created_at
         from bookings b ${sql} order by ${ORDER[req.query.sort] || ORDER.created_desc} limit 10000`, params);
    const cols = ['reference', 'status', 'payment_status', 'customer_name', 'customer_email', 'customer_phone', 'customer_country',
      'package_id', 'package_title', 'start_date', 'end_date', 'adults', 'children', 'option_key', 'extras', 'transfer_key',
      'currency', 'total', 'amount_paid', 'created_at'];
    const lines = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(
      c === 'extras' ? (r.extras || []).join('|') : c === 'created_at' ? r.created_at.toISOString() : r[c])).join(','))];
    await audit(pool, req.user, 'booking', 'export', 'csv_export', { filters: req.query, rows: rows.length });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="reservas-${todayLocal()}.csv"`);
    return '﻿' + lines.join('\r\n');
  });

  // ── Booking detail ─────────────────────────────────────────────────────────
  app.get('/bookings/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [b] } = await pool.query(
      `select b.*, u.email as account_email from bookings b left join users u on u.id = b.user_id where b.id = $1`, [req.params.id]);
    if (!b) throw notFound('booking_not_found');
    delete b.lookup_token_hash;
    const [notes, history, payments, mails, allocations] = await Promise.all([
      pool.query(`select n.id, n.body, n.created_at, u.name as author from internal_notes n left join users u on u.id = n.author_id
                   where n.entity_type = 'booking' and n.entity_id = $1 order by n.created_at desc`, [b.id]),
      pool.query(`select a.at, a.action, a.data, a.actor_type, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
                   where a.entity_type = 'booking' and a.entity_id = $1 order by a.at desc`, [b.id]),
      pool.query(`select p.*, u.name as recorded_by_name from payments p left join users u on u.id = p.recorded_by
                   where p.booking_id = $1 order by p.recorded_at desc`, [b.id]),
      pool.query(`select id, template, to_email, status, attempts, last_error, sent_at, created_at from mail_outbox
                   where idempotency_key like $1 order by created_at desc`, [`booking:${b.id}:%`]),
      pool.query(`select resource_key, day, quantity from booking_allocations where booking_id = $1 order by day`, [b.id]),
    ]);
    return { booking: b, notes: notes.rows, history: history.rows, payments: payments.rows, mails: mails.rows, allocations: allocations.rows };
  });

  app.post('/bookings/:id/status', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['to'], properties: {
                to: { type: 'string', enum: ['confirmed', 'rejected', 'cancelled', 'completed'] },
                message: { type: ['string', 'null'], maxLength: 1000 }, notify: { type: 'boolean' } } } },
  }, async req => transitionBooking(pool, cfg, { bookingId: req.params.id, to: req.body.to, actor: req.user,
    message: req.body.message || null, notify: req.body.notify !== false }));

  app.patch('/bookings/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', properties: {
                customer_name: { type: 'string', minLength: 1, maxLength: 120 },
                customer_email: { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' },
                customer_phone: { type: 'string', minLength: 6, maxLength: 30 },
                customer_country: { type: ['string', 'null'], maxLength: 60 },
                date, adults: { type: 'integer', minimum: 0, maximum: 200 }, children: { type: 'integer', minimum: 0, maximum: 200 },
                option_key: { type: ['string', 'null'], maxLength: 64 },
                keep_price: { type: 'boolean' },
                total_override: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
                override_reason: { type: 'string', maxLength: 500 },
                notify: { type: 'boolean' } } } },
  }, async req => updateBooking(pool, cfg, { bookingId: req.params.id, actor: req.user, patch: req.body }));

  app.post('/bookings/:id/notes', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } } } },
  }, async (req, reply) => {
    const { rowCount } = await pool.query('select 1 from bookings where id = $1', [req.params.id]);
    if (!rowCount) throw notFound('booking_not_found');
    const { rows: [n] } = await pool.query(
      `insert into internal_notes (entity_type, entity_id, body, author_id) values ('booking',$1,$2,$3) returning *`,
      [req.params.id, req.body.body, req.user.id]);
    reply.code(201);
    return n;
  });

  app.post('/bookings/:id/payments', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['amount', 'method'], properties: {
                amount: { type: 'number', minimum: -1e9, maximum: 1e9 },
                method: { type: 'string', enum: ['cash', 'bank_transfer', 'mpesa', 'emola', 'card', 'other'] },
                reference: { type: 'string', maxLength: 120 }, note: { type: 'string', maxLength: 500 } } } },
  }, async req => {
    if (!req.body.amount) throw badRequest('invalid_amount');
    return recordPayment(pool, { bookingId: req.params.id, actor: req.user, ...req.body });
  });

  // Re-send the e-mail matching the booking's current status
  app.post('/bookings/:id/resend', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [b] } = await pool.query('select * from bookings where id = $1', [req.params.id]);
    if (!b) throw notFound('booking_not_found');
    const template = b.status === 'pending' ? 'booking_received' : 'booking_status';
    // The original tracking link token is only stored hashed, so issue a fresh one
    const token = randomToken(24);
    await pool.query('update bookings set lookup_token_hash = $2 where id = $1', [b.id, sha256(token)]);
    await enqueueMail(pool, { key: `booking:${b.id}:resend:${Date.now()}`, to: b.customer_email, template, locale: b.locale,
      data: mailData(b, cfg, { event: b.status, status_url: statusUrl(cfg, b, token) }) });
    await audit(pool, req.user, 'booking', b.id, 'email_resent', { template });
    return { ok: true, template };
  });
}
