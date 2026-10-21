// ─────────────────────────────────────────────────────────────────────────────
// routes/public.js — Public API: catalogue, availability, quotes, bookings,
// reviews, custom tour requests and quotation responses.
// Unknown body properties are stripped by the schemas (removeAdditional), so a
// client can never inject prices, totals, statuses or discounts.
// ─────────────────────────────────────────────────────────────────────────────
import { getPublic, getSetting, listPublic, loadPackage } from '../lib/catalog.js';
import { calendar } from '../lib/availability.js';
import { createBooking, publicBooking, quoteFor } from '../lib/bookings.js';
import { enqueueAdminMail, enqueueMail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { addDays, todayLocal } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { reference, sha256 } from '../lib/security.js';
import { tx } from '../db.js';

const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,80}$' };
const shortText = max => ({ type: 'string', minLength: 1, maxLength: max });
const email = { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' };
const phone = { type: 'string', minLength: 6, maxLength: 30, pattern: '^[+0-9 ()-]+$' };

const selection = {
  date,
  adults: { type: 'integer', minimum: 0, maximum: 100 },
  children: { type: 'integer', minimum: 0, maximum: 100 },
  option_key: { type: ['string', 'null'], maxLength: 64 },
  extras: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 64 } },
  transfer_key: { type: ['string', 'null'], maxLength: 64 },
  promo_code: { type: ['string', 'null'], maxLength: 40 },
};

/** Honeypot: real users never fill the hidden "website" field. */
function assertHuman(body) {
  if (body && body.website) throw badRequest('rejected', 'Request rejected');
}

export default async function publicRoutes(app) {
  const { pool, cfg } = app;

  app.get('/health', async () => {
    await pool.query('select 1');
    return { ok: true, time: new Date().toISOString() };
  });

  // ── Catalogue ──────────────────────────────────────────────────────────────
  app.get('/catalog/tours', async () => listPublic(pool, 'tour'));
  app.get('/catalog/accommodations', async () => listPublic(pool, 'accommodation'));
  app.get('/catalog/packages/:id', { schema: { params: { type: 'object', properties: { id }, required: ['id'] } } },
    async req => getPublic(pool, req.params.id));

  app.get('/ratings', async () => {
    const { rows } = await pool.query(
      `select package_id, round(avg(rating)::numeric,1)::float as avg, count(*)::int as count
         from reviews where status = 'published' group by package_id`);
    return Object.fromEntries(rows.map(r => [r.package_id, { avg: r.avg, count: r.count }]));
  });

  // ── Availability calendar (public view: status + remaining only) ──────────
  app.get('/availability/:id', {
    schema: {
      params: { type: 'object', properties: { id }, required: ['id'] },
      querystring: { type: 'object', properties: { from: date, to: date, option: { type: 'string', maxLength: 64 } } },
    },
  }, async req => {
    const { pkg } = await loadPackage(pool, req.params.id, { publishedOnly: true });
    const settings = await getSetting(pool, 'booking');
    const from = req.query.from || todayLocal();
    const to = req.query.to || addDays(from, 62);
    const days = await calendar(pool, pkg, { from, to, optionKey: req.query.option || null, settings });
    return {
      package_id: pkg.id,
      limited: pkg.availability.default_capacity !== null,
      days: days.map(d => ({ day: d.day, status: d.status, ...(d.reason ? { reason: d.reason } : {}),
        ...(d.remaining !== null && d.remaining !== undefined ? { remaining: d.remaining } : {}) })),
    };
  });

  // ── Authoritative price preview ────────────────────────────────────────────
  app.post('/quote', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['package_id', 'date', 'adults'], properties: { package_id: id, ...selection } } },
  }, async req => {
    const { quote } = await quoteFor(pool, { packageId: req.body.package_id, input: req.body, user: req.user });
    return quote;
  });

  // ── Booking request ────────────────────────────────────────────────────────
  app.post('/bookings', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['package_id', 'date', 'adults', 'customer', 'idempotency_key'],
        properties: {
          package_id: id, ...selection,
          customer: {
            type: 'object', required: ['name', 'email', 'phone'],
            properties: { name: shortText(120), email, phone, country: { type: 'string', maxLength: 60 } },
          },
          notes: { type: 'string', maxLength: 1500 },
          locale: { type: 'string', enum: ['pt', 'en'] },
          idempotency_key: { type: 'string', minLength: 16, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' },
          consent: { type: 'boolean', const: true },
          website: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    assertHuman(req.body);
    if (req.body.consent !== true) throw badRequest('consent_required');
    const { booking, token, duplicate } = await createBooking(pool, cfg, { input: req.body, user: req.user });
    reply.code(duplicate ? 200 : 201);
    return { booking: publicBooking(booking), ...(token ? { token } : {}), duplicate };
  });

  // Guest status lookup: reference + secret token (e-mail link) or reference + e-mail
  app.post('/bookings/lookup', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: {
      body: { type: 'object', required: ['reference'], properties: {
        reference: { type: 'string', maxLength: 20, pattern: '^MB-[A-Z0-9]{4,10}$' },
        token: { type: 'string', maxLength: 100 }, email: { type: 'string', maxLength: 200 } } },
    },
  }, async req => {
    const { reference: ref, token, email: em } = req.body;
    if (!token && !em) throw badRequest('token_or_email_required');
    const { rows } = await pool.query('select * from bookings where reference = $1', [ref]);
    const b = rows[0];
    const ok = b && ((token && b.lookup_token_hash === sha256(token)) ||
                     (em && b.customer_email.toLowerCase() === String(em).trim().toLowerCase()));
    if (!ok) throw notFound('booking_not_found', 'No booking matches these details');
    return { booking: publicBooking(b) };
  });

  // ── Reviews ────────────────────────────────────────────────────────────────
  app.get('/reviews', {
    schema: { querystring: { type: 'object', required: ['package_id'], properties: { package_id: id } } },
  }, async req => {
    const { rows } = await pool.query(
      `select r.id, r.name, r.rating, r.comment, r.created_at, (r.booking_id is not null) as verified
         from reviews r where r.package_id = $1 and r.status = 'published' order by r.created_at desc limit 200`,
      [req.query.package_id]);
    return rows;
  });

  app.post('/reviews', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: { type: 'object', required: ['package_id', 'name', 'rating', 'comment'], properties: {
        package_id: id, name: shortText(80), rating: { type: 'integer', minimum: 1, maximum: 5 },
        comment: shortText(1000), booking_reference: { type: 'string', maxLength: 20 }, website: { type: 'string', maxLength: 200 } } },
    },
  }, async (req, reply) => {
    assertHuman(req.body);
    await loadPackage(pool, req.body.package_id, { publishedOnly: true });
    // A review is "verified" only when it references a completed booking of the
    // same package owned by the signed-in customer.
    let bookingId = null;
    if (req.user && req.body.booking_reference) {
      const { rows } = await pool.query(
        `select id from bookings where reference = $1 and package_id = $2 and status = 'completed' and user_id = $3`,
        [req.body.booking_reference, req.body.package_id, req.user.id]);
      bookingId = rows[0] ? rows[0].id : null;
    }
    const { rows: [r] } = await pool.query(
      `insert into reviews (package_id, name, rating, comment, booking_id, ip_hash) values ($1,$2,$3,$4,$5,$6)
       returning id, name, rating, comment, created_at, (booking_id is not null) as verified`,
      [req.body.package_id, req.body.name.trim(), req.body.rating, req.body.comment.trim(), bookingId, sha256(cfg.ipHashSalt + req.ip)]);
    reply.code(201);
    return r;
  });

  // ── Custom tour requests ───────────────────────────────────────────────────
  app.post('/custom-requests', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object', required: ['name', 'email', 'phone', 'adults', 'idempotency_key'],
        properties: {
          name: shortText(120), email, phone, locale: { type: 'string', enum: ['pt', 'en'] },
          destination: { type: 'string', maxLength: 200 },
          categories: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 40 } },
          date_from: date, date_to: date, flexible_dates: { type: 'boolean' },
          adults: { type: 'integer', minimum: 1, maximum: 200 }, children: { type: 'integer', minimum: 0, maximum: 200 },
          accommodation: { type: 'string', maxLength: 500 }, transport: { type: 'string', maxLength: 500 },
          activities: { type: 'string', maxLength: 1000 },
          budget: { type: ['number', 'null'], minimum: 0, maximum: 1e9 }, budget_currency: { type: 'string', enum: ['MZN', 'USD', 'ZAR', 'EUR'] },
          special_requests: { type: 'string', maxLength: 2000 },
          idempotency_key: { type: 'string', minLength: 16, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' },
          consent: { type: 'boolean', const: true },
          website: { type: 'string', maxLength: 200 },
        },
      },
    },
  }, async (req, reply) => {
    assertHuman(req.body);
    const b = req.body;
    if (b.consent !== true) throw badRequest('consent_required');
    if (b.date_from && b.date_to && b.date_to < b.date_from) throw badRequest('invalid_range');
    if (b.date_from && b.date_from < todayLocal()) throw badRequest('invalid_date');
    const existing = await pool.query('select id, reference, status from custom_requests where idempotency_key = $1', [b.idempotency_key]);
    if (existing.rows[0]) return { request: existing.rows[0], duplicate: true };

    const row = await tx(pool, async c => {
      let r;
      for (let i = 0; i < 5 && !r; i++) {
        ({ rows: [r] } = await c.query(
          `insert into custom_requests (reference, user_id, name, email, phone, locale, destination, categories, date_from, date_to,
             flexible_dates, adults, children, accommodation, transport, activities, budget, budget_currency, special_requests, idempotency_key)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           on conflict (reference) do nothing returning *`,
          [reference('TR'), req.user ? req.user.id : null, b.name.trim(), b.email.toLowerCase(), b.phone, b.locale || 'pt',
           b.destination || null, b.categories || [], b.date_from || null, b.date_to || null, !!b.flexible_dates,
           b.adults, b.children || 0, b.accommodation || null, b.transport || null, b.activities || null,
           b.budget ?? null, b.budget_currency || null, b.special_requests || null, b.idempotency_key]));
      }
      await audit(c, req.user, 'request', r.id, 'created', { reference: r.reference });
      await enqueueMail(c, { key: `request:${r.id}:received`, to: r.email, template: 'request_received', locale: r.locale, data: r });
      await enqueueAdminMail(c, { key: `request:${r.id}:admin_new`, template: 'admin_new_request',
        data: { ...r, admin_url: `${cfg.publicBaseUrl}/admin/#/requests/${r.id}` } });
      return r;
    });
    reply.code(201);
    return { request: { id: row.id, reference: row.reference, status: row.status }, duplicate: false };
  });

  // ── Quotations (link sent by e-mail; token is the credential) ─────────────
  async function quoteByToken(c, token, lock = false) {
    const { rows } = await c.query(
      `select q.*, r.reference, r.name, r.email, r.locale, r.id as req_id from quotes q join custom_requests r on r.id = q.request_id
        where q.public_token_hash = $1 and q.status in ('sent','accepted','declined','expired') ${lock ? 'for update of q' : ''}`, [sha256(token)]);
    if (!rows[0]) throw notFound('quote_not_found');
    return rows[0];
  }
  const tokenParams = { type: 'object', required: ['token'], properties: { token: { type: 'string', minLength: 20, maxLength: 100 } } };
  const publicQuote = q => ({
    reference: q.reference, name: q.name, items: q.items, inclusions: q.inclusions, exclusions: q.exclusions, message: q.message,
    currency: q.currency, total: q.total, valid_until: q.valid_until,
    status: q.status === 'sent' && q.valid_until < todayLocal() ? 'expired' : q.status,
  });

  app.get('/quotes/:token', { schema: { params: tokenParams } }, async req => publicQuote(await quoteByToken(pool, req.params.token)));

  app.post('/quotes/:token/respond', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    schema: { params: tokenParams, body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['accept', 'decline'] } } } },
  }, async req => tx(pool, async c => {
    const q = await quoteByToken(c, req.params.token, true);
    if (q.status !== 'sent') throw conflict('quote_closed', 'This quotation can no longer be changed');
    if (q.valid_until < todayLocal()) {
      await c.query(`update quotes set status='expired' where id=$1`, [q.id]);
      throw conflict('quote_expired', 'This quotation has expired');
    }
    const accepted = req.body.decision === 'accept';
    await c.query(`update quotes set status=$2, responded_at=now() where id=$1`, [q.id, accepted ? 'accepted' : 'declined']);
    if (accepted) {
      await c.query(`update custom_requests set status='accepted', updated_at=now() where id=$1`, [q.req_id]);
      await enqueueMail(c, { key: `quote:${q.id}:accepted`, to: q.email, template: 'quote_accepted', locale: q.locale, data: { ...q } });
      await enqueueAdminMail(c, { key: `quote:${q.id}:admin_accepted`, template: 'admin_quote_accepted',
        data: { ...q, admin_url: `${cfg.publicBaseUrl}/admin/#/requests/${q.req_id}` } });
    }
    await audit(c, null, 'request', q.req_id, accepted ? 'quote_accepted' : 'quote_declined', { quote_id: q.id });
    return publicQuote({ ...q, status: accepted ? 'accepted' : 'declined' });
  }));

}
