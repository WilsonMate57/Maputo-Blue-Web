// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/requests.js — Custom tour requests and quotations.
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from '../../lib/audit.js';
import { enqueueMail } from '../../lib/mailer.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { randomToken, sha256 } from '../../lib/security.js';
import { todayLocal } from '../../lib/dates.js';
import { tx } from '../../db.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const STATUSES = ['new', 'under_review', 'quote_sent', 'accepted', 'rejected', 'closed'];
const NEXT = {
  new: ['under_review', 'rejected', 'closed'],
  under_review: ['quote_sent', 'rejected', 'closed'],
  quote_sent: ['accepted', 'rejected', 'under_review', 'closed'],
  accepted: ['closed'],
  rejected: ['closed', 'under_review'],
  closed: ['under_review'],
};

export default async function requestRoutes(app) {
  const { pool, cfg } = app;

  app.get('/requests', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', maxLength: 80 }, q: { type: 'string', maxLength: 100 },
      page: { type: 'string', pattern: '^\\d{1,5}$' } } } },
  }, async req => {
    const params = [], where = [];
    if (req.query.status) { params.push(req.query.status.split(',').filter(s => STATUSES.includes(s))); where.push(`status = any($${params.length})`); }
    if (req.query.q) { params.push(`%${req.query.q.replace(/[%_\\]/g, m => '\\' + m)}%`); where.push(`(reference ilike $${params.length} or name ilike $${params.length} or email ilike $${params.length} or destination ilike $${params.length})`); }
    const sql = where.length ? 'where ' + where.join(' and ') : '';
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select id, reference, name, email, phone, destination, date_from, date_to, flexible_dates, adults, children,
                         budget, budget_currency, status, created_at from custom_requests ${sql}
                  order by created_at desc limit 25 offset ${(page - 1) * 25}`, params),
      pool.query(`select count(*)::int n from custom_requests ${sql}`, params),
    ]);
    return { items: rows, total: n, page, page_size: 25 };
  });

  app.get('/requests/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [r] } = await pool.query('select * from custom_requests where id = $1', [req.params.id]);
    if (!r) throw notFound('request_not_found');
    const [quotes, notes, history] = await Promise.all([
      pool.query(`select q.id, q.items, q.inclusions, q.exclusions, q.message, q.currency, q.total, q.valid_until, q.status,
                         q.sent_at, q.responded_at, q.created_at, u.name as created_by_name
                    from quotes q left join users u on u.id = q.created_by where q.request_id = $1 order by q.created_at desc`, [r.id]),
      pool.query(`select n.id, n.body, n.created_at, u.name as author from internal_notes n left join users u on u.id = n.author_id
                   where n.entity_type = 'request' and n.entity_id = $1 order by n.created_at desc`, [r.id]),
      pool.query(`select a.at, a.action, a.data, a.actor_type, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
                   where a.entity_type = 'request' and a.entity_id = $1 order by a.at desc`, [r.id]),
    ]);
    delete r.idempotency_key;
    return { request: r, quotes: quotes.rows, notes: notes.rows, history: history.rows, next_statuses: NEXT[r.status] };
  });

  app.post('/requests/:id/status', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['to'], properties: { to: { type: 'string', enum: STATUSES } } } },
  }, async req => tx(pool, async c => {
    const { rows: [r] } = await c.query('select * from custom_requests where id = $1 for update', [req.params.id]);
    if (!r) throw notFound('request_not_found');
    if (!NEXT[r.status].includes(req.body.to)) throw conflict('invalid_transition', `Cannot change ${r.status} → ${req.body.to}`);
    const { rows: [u] } = await c.query('update custom_requests set status = $2, updated_at = now() where id = $1 returning *', [r.id, req.body.to]);
    await audit(c, req.user, 'request', r.id, 'status_changed', { from: r.status, to: req.body.to });
    return u;
  }));

  app.post('/requests/:id/notes', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } } } },
  }, async (req, reply) => {
    const { rowCount } = await pool.query('select 1 from custom_requests where id = $1', [req.params.id]);
    if (!rowCount) throw notFound('request_not_found');
    const { rows: [n] } = await pool.query(
      `insert into internal_notes (entity_type, entity_id, body, author_id) values ('request',$1,$2,$3) returning *`,
      [req.params.id, req.body.body, req.user.id]);
    reply.code(201);
    return n;
  });

  // Create a quotation; with send=true it is e-mailed and the request moves to quote_sent
  app.post('/requests/:id/quotes', {
    schema: {
      params: { type: 'object', properties: { id: uuid } },
      body: { type: 'object', required: ['items', 'currency', 'valid_until'], properties: {
        items: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', required: ['description', 'quantity', 'unit_price'], properties: {
          description: { type: 'string', minLength: 1, maxLength: 300 },
          quantity: { type: 'number', exclusiveMinimum: 0, maximum: 10000 },
          unit_price: { type: 'number', minimum: 0, maximum: 1e9 } } } },
        currency: { type: 'string', enum: ['MZN', 'USD', 'ZAR', 'EUR'] },
        valid_until: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        inclusions: { type: 'string', maxLength: 3000 }, exclusions: { type: 'string', maxLength: 3000 },
        message: { type: 'string', maxLength: 3000 }, send: { type: 'boolean' } } },
    },
  }, async (req, reply) => {
    const b = req.body;
    if (b.valid_until < todayLocal()) throw badRequest('invalid_date', 'Validity date is in the past');
    const total = Math.round(b.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;
    const result = await tx(pool, async c => {
      const { rows: [r] } = await c.query('select * from custom_requests where id = $1 for update', [req.params.id]);
      if (!r) throw notFound('request_not_found');
      if (['accepted', 'closed'].includes(r.status)) throw conflict('request_closed');
      const token = b.send ? randomToken(32) : null;
      if (b.send) await c.query(`update quotes set status = 'withdrawn' where request_id = $1 and status = 'sent'`, [r.id]);
      const { rows: [q] } = await c.query(
        `insert into quotes (request_id, items, inclusions, exclusions, message, currency, total, valid_until, status, public_token_hash, sent_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [r.id, JSON.stringify(b.items), b.inclusions || null, b.exclusions || null, b.message || null, b.currency, total, b.valid_until,
         b.send ? 'sent' : 'draft', token ? sha256(token) : null, b.send ? new Date() : null, req.user.id]);
      if (b.send) {
        await c.query(`update custom_requests set status = 'quote_sent', updated_at = now() where id = $1`, [r.id]);
        const page = r.locale === 'en' ? 'en/quote.html' : 'pages/quote.html';
        await enqueueMail(c, { key: `quote:${q.id}:issued`, to: r.email, template: 'quote_issued', locale: r.locale,
          data: { ...q, items: b.items, reference: r.reference, name: r.name, quote_url: `${cfg.publicBaseUrl}/${page}?t=${encodeURIComponent(token)}` } });
      }
      await audit(c, req.user, 'request', r.id, b.send ? 'quote_sent' : 'quote_drafted', { quote_id: q.id, total, currency: b.currency });
      delete q.public_token_hash;
      return q;
    });
    reply.code(201);
    return result;
  });

  // Send an existing draft
  app.post('/quotes/:quoteId/send', { schema: { params: { type: 'object', properties: { quoteId: uuid } } } }, async req => tx(pool, async c => {
    const { rows: [q] } = await c.query(
      `select q.*, r.email, r.locale, r.reference, r.name, r.status as request_status from quotes q join custom_requests r on r.id = q.request_id
        where q.id = $1 for update of q`, [req.params.quoteId]);
    if (!q) throw notFound('quote_not_found');
    if (q.status !== 'draft') throw conflict('quote_not_draft');
    if (q.valid_until < todayLocal()) throw badRequest('invalid_date', 'Validity date is in the past');
    const token = randomToken(32);
    await c.query(`update quotes set status = 'withdrawn' where request_id = $1 and status = 'sent'`, [q.request_id]);
    await c.query(`update quotes set status='sent', sent_at=now(), public_token_hash=$2 where id=$1`, [q.id, sha256(token)]);
    await c.query(`update custom_requests set status = 'quote_sent', updated_at = now() where id = $1`, [q.request_id]);
    const page = q.locale === 'en' ? 'en/quote.html' : 'pages/quote.html';
    await enqueueMail(c, { key: `quote:${q.id}:issued`, to: q.email, template: 'quote_issued', locale: q.locale,
      data: { ...q, quote_url: `${cfg.publicBaseUrl}/${page}?t=${encodeURIComponent(token)}` } });
    await audit(c, req.user, 'request', q.request_id, 'quote_sent', { quote_id: q.id });
    return { ok: true };
  }));

  app.post('/quotes/:quoteId/withdraw', { schema: { params: { type: 'object', properties: { quoteId: uuid } } } }, async req => {
    const { rows: [q] } = await pool.query(
      `update quotes set status='withdrawn' where id=$1 and status in ('draft','sent') returning request_id`, [req.params.quoteId]);
    if (!q) throw conflict('quote_not_open');
    await audit(pool, req.user, 'request', q.request_id, 'quote_withdrawn', { quote_id: req.params.quoteId });
    return { ok: true };
  });
}
