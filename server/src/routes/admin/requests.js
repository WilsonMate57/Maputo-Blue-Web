// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/requests.js — Custom tour requests and quotations.
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from '../../lib/audit.js';
import { enqueueMail } from '../../lib/mailer.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { CHANNELS, deliverQuote, suggestQuoteLines } from '../../lib/quotes.js';
import { loadQuoteForPdf, quoteFilename, renderQuotePdf } from '../../lib/quote-pdf.js';
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
    if (req.query.q) { params.push(`%${req.query.q.replace(/[%_\\]/g, m => '\\' + m)}%`); where.push(`(reference ilike $${params.length} or name ilike $${params.length} or email ilike $${params.length} or destination ilike $${params.length} or billing->>'company_name' ilike $${params.length} or billing->>'nuit' ilike $${params.length})`); }
    const sql = where.length ? 'where ' + where.join(' and ') : '';
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select id, reference, name, email, phone, destination, date_from, date_to, flexible_dates, adults, children,
                         budget, budget_currency, status, created_at, items, billing->>'company_name' as company from custom_requests ${sql}
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
                         q.sent_at, q.responded_at, q.created_at, q.channels, u.name as created_by_name
                    from quotes q left join users u on u.id = q.created_by where q.request_id = $1 order by q.created_at desc`, [r.id]),
      pool.query(`select n.id, n.body, n.created_at, u.name as author from internal_notes n left join users u on u.id = n.author_id
                   where n.entity_type = 'request' and n.entity_id = $1 order by n.created_at desc`, [r.id]),
      pool.query(`select a.at, a.action, a.data, a.actor_type, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
                   where a.entity_type = 'request' and a.entity_id = $1 order by a.at desc`, [r.id]),
    ]);
    delete r.idempotency_key;
    // The customer sees the quotation in their account when the request is linked to one
    const { rows: [acct] } = await pool.query(
      `select id, email_verified_at is not null as verified from users where id = $1 or lower(email) = lower($2) order by (id = $1) desc limit 1`,
      [r.user_id, r.email]);
    return { request: r, quotes: quotes.rows, notes: notes.rows, history: history.rows, next_statuses: NEXT[r.status],
      account: acct ? { user_id: acct.id, linked: acct.id === r.user_id || acct.verified } : null };
  });

  // Quotation lines generated from the packages/services the customer chose
  app.get('/requests/:id/quote-suggestion', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [r] } = await pool.query('select * from custom_requests where id = $1', [req.params.id]);
    if (!r) throw notFound('request_not_found');
    return suggestQuoteLines(pool, r);
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

  // Create a quotation; with send=true it is delivered through the chosen channels and the request moves to quote_sent
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
        message: { type: 'string', maxLength: 3000 }, send: { type: 'boolean' },
        channels: { type: 'array', maxItems: 3, items: { type: 'string', enum: CHANNELS } } } },
    },
  }, async (req, reply) => {
    const b = req.body;
    if (b.valid_until < todayLocal()) throw badRequest('invalid_date', 'Validity date is in the past');
    const total = Math.round(b.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) * 100) / 100;
    const result = await tx(pool, async c => {
      const { rows: [r] } = await c.query('select * from custom_requests where id = $1 for update', [req.params.id]);
      if (!r) throw notFound('request_not_found');
      if (['accepted', 'closed'].includes(r.status)) throw conflict('request_closed');
      const { rows: [q] } = await c.query(
        `insert into quotes (request_id, items, inclusions, exclusions, message, currency, total, valid_until, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) returning *`,
        [r.id, JSON.stringify(b.items), b.inclusions || null, b.exclusions || null, b.message || null, b.currency, total, b.valid_until, req.user.id]);
      if (!b.send) {
        await audit(c, req.user, 'request', r.id, 'quote_drafted', { quote_id: q.id, total, currency: b.currency });
        delete q.public_token_hash;
        return q;
      }
      const delivery = await deliverQuote(c, cfg, { quote: q, request: r, channels: b.channels, actor: req.user });
      delete q.public_token_hash;
      return { ...q, status: 'sent', delivery };
    });
    reply.code(201);
    return result;
  });

  const channelsBody = { type: ['object', 'null'], properties: { channels: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: CHANNELS } } } };
  // Lock order: request, then quotation (same as creating a quotation)
  const loadForDelivery = async (c, quoteId) => {
    const { rows: [ref] } = await c.query('select request_id from quotes where id = $1', [quoteId]);
    if (!ref) throw notFound('quote_not_found');
    const { rows: [r] } = await c.query('select * from custom_requests where id = $1 for update', [ref.request_id]);
    const { rows: [q] } = await c.query('select * from quotes where id = $1 for update', [quoteId]);
    return { q, r };
  };

  // Send a draft through the chosen channels
  app.post('/quotes/:quoteId/send', { schema: { params: { type: 'object', properties: { quoteId: uuid } }, body: channelsBody } }, async req => tx(pool, async c => {
    const { q, r } = await loadForDelivery(c, req.params.quoteId);
    if (q.status !== 'draft') throw conflict('quote_not_draft');
    return { ok: true, delivery: await deliverQuote(c, cfg, { quote: q, request: r, channels: req.body && req.body.channels, actor: req.user }) };
  }));

  // Share a sent quotation again (new link — the previous one stops working)
  app.post('/quotes/:quoteId/share', { schema: { params: { type: 'object', properties: { quoteId: uuid } }, body: channelsBody } }, async req => tx(pool, async c => {
    const { q, r } = await loadForDelivery(c, req.params.quoteId);
    if (q.status !== 'sent') throw conflict('quote_not_open');
    return { ok: true, delivery: await deliverQuote(c, cfg, { quote: q, request: r, channels: req.body && req.body.channels, actor: req.user }) };
  }));
  app.get('/quotes/:quoteId/pdf', { schema: { params: { type: 'object', properties: { quoteId: uuid } } } }, async (req, reply) => {
    const full = await loadQuoteForPdf(pool, req.params.quoteId);
    if (!full) throw notFound('quote_not_found');
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${quoteFilename(full)}"`);
    return reply.send(await renderQuotePdf(pool, cfg, full));
  });

  app.post('/quotes/:quoteId/withdraw', { schema: { params: { type: 'object', properties: { quoteId: uuid } } } }, async req => {
    const { rows: [q] } = await pool.query(
      `update quotes set status='withdrawn' where id=$1 and status in ('draft','sent') returning request_id`, [req.params.quoteId]);
    if (!q) throw conflict('quote_not_open');
    await audit(pool, req.user, 'request', q.request_id, 'quote_withdrawn', { quote_id: req.params.quoteId });
    return { ok: true };
  });
}
