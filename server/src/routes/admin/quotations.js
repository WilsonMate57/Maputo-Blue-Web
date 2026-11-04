// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/quotations.js — Commercial proposals: list and indicators, the
// builder (catalogue, contacts, line prices), the lifecycle (issue, send, new
// version, duplicate, cancel, recorded answers) and conversion to a booking.
// The rules live in lib/quotes.js and lib/quote-conversion.js.
// ─────────────────────────────────────────────────────────────────────────────
import { tx } from '../../db.js';
import { getSetting, loadPackage } from '../../lib/catalog.js';
import { computeQuote } from '../../lib/pricing.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { todayLocal } from '../../lib/dates.js';
import { CHANNELS, SERVICES, cancelQuote, createProposal, currentLink, deliverQuote, duplicateQuote, issueProblems, issueQuote, loadQuote, newVersion,
  respondToQuote, updateDraft } from '../../lib/quotes.js';
import { conversionPreview, convertQuote } from '../../lib/quote-conversion.js';
import { quoteFilename, quotePdf } from '../../lib/quote-pdf.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const idParams = { params: { type: 'object', properties: { id: uuid } } };
const dateStr = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const optDate = { type: ['string', 'null'], pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' };
const str = n => ({ type: ['string', 'null'], maxLength: n });
const count = { type: ['integer', 'null'], minimum: 0, maximum: 10000 };
const discount = { type: ['object', 'null'], required: ['kind', 'value'], properties: {
  kind: { type: 'string', enum: ['percent', 'fixed'] }, value: { type: 'number', minimum: 0, maximum: 1e9 } } };
const STATUSES = ['draft', 'issued', 'sent', 'viewed', 'accepted', 'declined', 'revision_requested', 'expired', 'converted', 'withdrawn', 'superseded'];

/** The whole proposal, for creating a draft and for saving changes to it. */
export const proposalSchema = { type: 'object', required: ['items', 'currency', 'valid_until'], properties: {
  request_id: { ...uuid, type: ['string', 'null'] },
  customer: { type: 'object', properties: {
    name: str(160), company: str(160), email: { type: ['string', 'null'], maxLength: 200, pattern: '^([^\\s@]+@[^\\s@]+\\.[^\\s@]{2,})?$' }, phone: str(40), country: str(80),
    client_type: { type: 'string', enum: ['individual', 'group', 'company', 'agency', 'other'] }, nuit: str(40), address: str(300) } },
  trip: { type: 'object', properties: {
    destination: str(200), date_from: optDate, date_to: optDate, days: count, nights: count, adults: count, children: count, experience: str(200), customer_notes: str(3000) } },
  locale: { type: 'string', enum: ['pt', 'en'] },
  items: { type: 'array', maxItems: 80, items: { type: 'object', required: ['description', 'quantity'], properties: {
    kind: { type: 'string', enum: ['package', 'service', 'custom'] }, package_id: str(90), service_key: str(40), option_key: str(60),
    description: { type: 'string', minLength: 1, maxLength: 300 }, details: str(1000), date_from: optDate, date_to: optDate, nights: count, adults: count, children: count,
    quantity: { type: 'number', exclusiveMinimum: 0, maximum: 10000 }, participants: count,
    unit_price: { type: ['number', 'null'], minimum: 0, maximum: 1e9 }, discount } } },
  discount, fees: { type: 'array', maxItems: 20, items: { type: 'object', properties: { label: str(120), amount: { type: ['number', 'null'], minimum: 0, maximum: 1e9 } } } },
  currency: { type: 'string', enum: ['MZN', 'USD', 'ZAR', 'EUR'] }, valid_until: dateStr,
  inclusions: str(3000), exclusions: str(3000), message: str(3000), payment_terms: str(3000), deposit_percent: { type: ['number', 'null'], minimum: 0, maximum: 100 },
  payment_due: str(300), cancellation_terms: str(3000), special_conditions: str(3000), internal_notes: str(3000),
  itinerary: { type: 'array', maxItems: 60, items: { type: 'object', properties: { title: str(200), description: str(2000) } } },
} };

export default async function quotationRoutes(app) {
  const { pool, cfg } = app;
  const like = s => `%${s.replace(/[%_\\]/g, m => '\\' + m)}%`;

  // ── List and indicators ───────────────────────────────────────────────────
  app.get('/quotations', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', maxLength: 120 }, q: { type: 'string', maxLength: 100 },
      page: { type: 'string', pattern: '^\\d{1,5}$' }, customer_email: { type: 'string', maxLength: 200 } } } },
  }, async req => {
    const params = [], where = [`q.status <> 'superseded'`];
    if (req.query.status) { params.push(req.query.status.split(',').filter(s => STATUSES.includes(s))); where.push(`q.status = any($${params.length})`); }
    if (req.query.customer_email) { params.push(req.query.customer_email.toLowerCase()); where.push(`lower(q.customer->>'email') = $${params.length}`); }
    if (req.query.q) {
      params.push(like(req.query.q));
      where.push(`(q.number ilike $${params.length} or q.customer->>'name' ilike $${params.length} or q.customer->>'company' ilike $${params.length}
                   or q.customer->>'email' ilike $${params.length} or q.trip->>'destination' ilike $${params.length})`);
    }
    const sql = 'where ' + where.join(' and ');
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select q.id, q.number, q.version, q.status, q.currency, q.total, q.valid_until, q.created_at, q.sent_at, q.responded_at, q.customer, q.trip,
                         u.name as created_by_name, b.reference as booking_reference
                    from quotes q left join users u on u.id = q.created_by left join bookings b on b.quote_id = q.id ${sql}
                   order by q.created_at desc limit 25 offset ${(page - 1) * 25}`, params),
      pool.query(`select count(*)::int n from quotes q ${sql}`, params),
    ]);
    return { items: rows, total: n, page, page_size: 25 };
  });

  // Each proposal counts once (superseded versions are left out); money is never summed across currencies.
  app.get('/quotations/stats', {
    schema: { querystring: { type: 'object', properties: { from: dateStr, to: dateStr } } },
  }, async req => {
    const params = [req.query.from || null, req.query.to || null];
    const scope = `status not in ('draft','superseded') and ($1::date is null or (coalesce(issued_at, created_at) at time zone 'Africa/Maputo')::date >= $1)
                   and ($2::date is null or (coalesce(issued_at, created_at) at time zone 'Africa/Maputo')::date <= $2)`;
    const [{ rows: [k] }, { rows: money }, { rows: months }, { rows: types }] = await Promise.all([
      pool.query(`select count(*)::int as issued,
                         count(*) filter (where sent_at is not null)::int as sent,
                         count(*) filter (where status in ('sent','viewed'))::int as awaiting,
                         count(*) filter (where status = 'revision_requested')::int as revision,
                         count(*) filter (where status in ('accepted','converted'))::int as accepted,
                         count(*) filter (where status = 'declined')::int as declined,
                         count(*) filter (where status = 'expired')::int as expired,
                         count(*) filter (where status = 'converted')::int as converted
                    from quotes where ${scope}`, params),
      pool.query(`select currency, sum(total) as issued_value, sum(total) filter (where status in ('accepted','converted')) as accepted_value,
                         sum(total) filter (where status = 'converted') as converted_value
                    from quotes where ${scope} group by currency order by currency`, params),
      pool.query(`select to_char(coalesce(issued_at, created_at) at time zone 'Africa/Maputo', 'YYYY-MM') as month, count(*)::int as issued,
                         count(*) filter (where status in ('accepted','converted'))::int as accepted, count(*) filter (where status = 'converted')::int as converted
                    from quotes where ${scope} group by 1 order by 1 desc limit 12`, params),
      pool.query(`select coalesce(customer->>'client_type', 'individual') as client_type, count(*)::int as issued,
                         count(*) filter (where status = 'converted')::int as converted
                    from quotes where ${scope} group by 1 order by 2 desc`, params),
    ]);
    return { ...k, conversion_rate: k.issued ? Math.round(k.converted / k.issued * 1000) / 10 : null, money, months, client_types: types };
  });

  // ── What the builder needs ────────────────────────────────────────────────
  app.get('/quotations/builder', async () => {
    const [{ rows }, settings] = await Promise.all([
      pool.query(`select id, kind, category, content, pricing from packages where status = 'published' order by kind, sort_order, id`),
      getSetting(pool, 'quotes'),
    ]);
    const packages = rows.map(p => {
      const c = p.content || {}, x = p.pricing || {};
      return { id: p.id, kind: p.kind, category: p.category, title: c.title || c.name || p.id, title_en: c.title_en || c.name_en || c.title || c.name || p.id,
        currency: x.currency, unit: x.unit, options: (x.options || []).filter(o => o.active !== false).map(o => ({ key: o.key, name: o.name, name_en: o.name_en || o.name })),
        included: c.included || [], included_en: c.included_en || [], excluded: c.excluded || [], excluded_en: c.excluded_en || [],
        itinerary: (c.itinerary || []).map(s => ({ title: s.title || '', title_en: s.title_en || '', description: s.description || '', description_en: s.description_en || '' })) };
    });
    return { packages, services: Object.entries(SERVICES).map(([key, s]) => ({ key, ...s })), settings };
  });

  // Current catalogue price of one item; the team can change it on the line
  app.post('/quotations/price', {
    schema: { body: { type: 'object', required: ['package_id', 'date'], properties: { package_id: { type: 'string', maxLength: 90 }, date: dateStr,
      nights: { type: ['integer', 'null'], minimum: 1, maximum: 365 }, adults: { type: 'integer', minimum: 0, maximum: 1000 }, children: { type: 'integer', minimum: 0, maximum: 1000 },
      option_key: { type: ['string', 'null'], maxLength: 60 } } } },
  }, async req => {
    const b = req.body;
    const { pkg, rules } = await loadPackage(pool, b.package_id, { publishedOnly: true });
    const q = computeQuote({ pkg, rules, today: todayLocal(), input: { date: b.date, nights: b.nights ?? undefined, adults: b.adults ?? 1, children: b.children ?? 0, option_key: b.option_key || null } });
    return { total: q.child_price_on_request ? null : q.total, currency: q.currency, nights: q.nights, end_date: q.end_date, child_price_on_request: q.child_price_on_request };
  });

  // Customers with an account and contacts from earlier proposals
  app.get('/contacts', { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 100 } } } } }, async req => {
    const q = like(req.query.q);
    const [{ rows: contacts }, { rows: users }] = await Promise.all([
      pool.query(`select id, name, company, email, phone, country, client_type, nuit, address from contacts
                   where name ilike $1 or email ilike $1 or company ilike $1 or phone ilike $1 order by updated_at desc limit 10`, [q]),
      pool.query(`select id, name, email, phone, country from users
                   where role = 'customer' and (name ilike $1 or email ilike $1 or phone ilike $1) order by created_at desc limit 10`, [q]),
    ]);
    const known = new Set(contacts.map(c => c.email.toLowerCase()));
    return { items: [...contacts.map(c => ({ ...c, source: 'contact' })),
      ...users.filter(u => !known.has(u.email.toLowerCase())).map(u => ({ ...u, source: 'account', client_type: 'individual' }))] };
  });

  // ── One proposal ──────────────────────────────────────────────────────────
  app.post('/quotations', { schema: { body: proposalSchema } }, async (req, reply) => {
    const q = await tx(pool, async c => {
      let request = null;
      if (req.body.request_id) {
        ({ rows: [request] } = await c.query('select * from custom_requests where id = $1 for update', [req.body.request_id]));
        if (!request) throw notFound('request_not_found');
      }
      return createProposal(c, { body: req.body, actor: req.user, request });
    });
    reply.code(201);
    return { id: q.id, number: q.number, version: q.version, status: q.status, total: q.total };
  });

  app.get('/quotations/:id', { schema: idParams }, async req => {
    const q = await loadQuote(pool, req.params.id);
    delete q.public_token_hash;
    const [versions, history, booking, author, request] = await Promise.all([
      pool.query(`select id, version, status, total, currency, issued_at, created_at from quotes where group_id = $1 order by version desc`, [q.group_id]),
      pool.query(`select a.at, a.action, a.data, a.actor_type, u.name as actor_name from audit_log a left join users u on u.id = a.actor_id
                   where a.entity_type = 'quote' and a.entity_id = $1 order by a.at desc`, [q.group_id]),
      pool.query(`select b.id, b.reference, b.status, b.payment_status from bookings b join quotes x on x.id = b.quote_id where x.group_id = $1`, [q.group_id]),
      pool.query('select name from users where id = $1', [q.created_by]),
      q.request_id ? pool.query('select id, reference from custom_requests where id = $1', [q.request_id]) : { rows: [] },
    ]);
    return { quote: q, versions: versions.rows, history: history.rows, booking: booking.rows[0] || null, created_by_name: author.rows[0]?.name || null,
      request: request.rows[0] || null, link: currentLink(cfg, q), problems: q.status === 'draft' ? issueProblems(q) : [] };
  });

  const locked = fn => async req => tx(pool, async c => fn(c, await loadQuote(c, req.params.id, { lock: true }), req));

  app.patch('/quotations/:id', { schema: { ...idParams, body: proposalSchema } }, locked(async (c, quote, req) => {
    const q = await updateDraft(c, { quote, body: req.body, actor: req.user });
    return { id: q.id, status: q.status, total: q.total };
  }));

  app.post('/quotations/:id/issue', { schema: idParams }, locked(async (c, quote, req) => {
    const q = await issueQuote(c, cfg, { quote, actor: req.user });
    return { id: q.id, status: q.status };
  }));

  app.post('/quotations/:id/send', {
    schema: { ...idParams, body: { type: 'object', required: ['channels'], properties: {
      channels: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: CHANNELS } } } } },
  }, locked(async (c, quote, req) => {
    if (!['draft', 'issued', 'sent', 'viewed', 'revision_requested'].includes(quote.status)) throw badRequest('quote_not_open');
    return { ok: true, delivery: await deliverQuote(c, cfg, { quote, channels: req.body.channels, actor: req.user }) };
  }));

  app.post('/quotations/:id/version', { schema: idParams }, locked(async (c, quote, req) => {
    const q = await newVersion(c, { quote, actor: req.user });
    return { id: q.id, version: q.version };
  }));

  app.post('/quotations/:id/duplicate', { schema: idParams }, locked(async (c, quote, req) => {
    const q = await duplicateQuote(c, { quote, actor: req.user });
    return { id: q.id, number: q.number };
  }));

  app.post('/quotations/:id/cancel', {
    schema: { ...idParams, body: { type: ['object', 'null'], properties: { reason: { type: 'string', maxLength: 500 } } } },
  }, locked(async (c, quote, req) => {
    await cancelQuote(c, { quote, actor: req.user, reason: req.body?.reason });
    return { ok: true };
  }));

  // An answer given outside the link, by phone or in person
  app.post('/quotations/:id/respond', {
    schema: { ...idParams, body: { type: 'object', required: ['decision'], properties: {
      decision: { type: 'string', enum: ['accept', 'decline', 'revision'] }, message: { type: 'string', maxLength: 3000 } } } },
  }, locked(async (c, quote, req) => {
    const status = await respondToQuote(c, cfg, { quote, decision: req.body.decision, message: req.body.message, actor: req.user });
    return { status };
  }));

  app.get('/quotations/:id/pdf', {
    schema: { ...idParams, querystring: { type: 'object', properties: { inline: { type: 'string', enum: ['1'] } } } },
  }, async (req, reply) => {
    const q = await loadQuote(pool, req.params.id);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${quoteFilename(q)}"`);
    return reply.send(await quotePdf(pool, cfg, q));
  });

  // ── Conversion ────────────────────────────────────────────────────────────
  app.get('/quotations/:id/conversion', { schema: idParams }, async req => conversionPreview(pool, req.params.id));

  app.post('/quotations/:id/convert', {
    schema: { ...idParams, body: { type: ['object', 'null'], properties: { notify: { type: 'boolean' } } } },
  }, async (req, reply) => {
    const b = await convertQuote(pool, cfg, { quoteId: req.params.id, actor: req.user, notify: req.body?.notify !== false });
    reply.code(201);
    return { booking: { id: b.id, reference: b.reference, status: b.status } };
  });
}
