// ─────────────────────────────────────────────────────────────────────────────
// routes/account.js — Customer area. Every query is scoped to request.user.id,
// so changing an id in the URL can never expose another customer's data.
// ─────────────────────────────────────────────────────────────────────────────
import { publicUser, requireUser } from '../lib/auth.js';
import { ticketResponders } from './tickets.js';
import { currentInvoicePdf, invoiceFilename, publicInvoice } from '../lib/invoices.js';
import { publicQuote, respondToQuote } from '../lib/quotes.js';
import { loadQuoteForPdf, quoteFilename, renderQuotePdf } from '../lib/quote-pdf.js';
import { tx } from '../db.js';
import { publicBooking, requestCancellation, transitionBooking } from '../lib/bookings.js';
import { loyaltyStatus } from '../lib/loyalty.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, passwordProblems, verifyPassword } from '../lib/security.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };

export default async function accountRoutes(app) {
  const { pool, cfg } = app;
  app.addHook('onRequest', requireUser);

  async function ownBooking(req) {
    const { rows } = await pool.query('select * from bookings where id = $1 and user_id = $2', [req.params.id, req.user.id]);
    if (!rows[0]) throw notFound('booking_not_found');
    return rows[0];
  }

  // Issued/cancelled invoices of the customer's own bookings (drafts are internal)
  const ownInvoices = (userId, extra = '', params = []) => pool.query(
    `select i.* from invoices i join bookings b on b.id = i.booking_id
      where b.user_id = $1 and i.doc_status <> 'draft' ${extra} order by i.issue_date desc, i.created_at desc`, [userId, ...params]);

  app.get('/bookings', async req => {
    const [{ rows }, { rows: invoices }] = await Promise.all([
      pool.query('select * from bookings where user_id = $1 order by start_date desc, created_at desc limit 200', [req.user.id]),
      ownInvoices(req.user.id, "and i.doc_status = 'issued'"),
    ]);
    const byBooking = new Map(invoices.map(i => [i.booking_id, publicInvoice(i)]));
    return rows.map(b => ({ ...publicBooking(b), invoice: byBooking.get(b.id) || null }));
  });

  app.get('/invoices', async req => (await ownInvoices(req.user.id)).rows.map(publicInvoice));

  app.get('/invoices/:id/pdf', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const { rows: [inv] } = await ownInvoices(req.user.id, 'and i.id = $2', [req.params.id]);
    if (!inv) throw notFound('invoice_not_found');
    const pdf = await currentInvoicePdf(pool, cfg, inv);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${invoiceFilename(inv)}"`);
    return reply.send(pdf);
  });

  app.get('/bookings/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } },
    async req => publicBooking(await ownBooking(req)));

  // Pending → cancelled immediately; confirmed → cancellation request for the admin
  app.post('/bookings/:id/cancel', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: ['object', 'null'], properties: { reason: { type: 'string', maxLength: 500 } } } },
  }, async req => {
    const b = await ownBooking(req);
    const reason = req.body && req.body.reason;
    if (b.status === 'pending') {
      return publicBooking(await transitionBooking(pool, cfg, { bookingId: b.id, to: 'cancelled', actor: req.user, message: reason || null }));
    }
    return publicBooking(await requestCancellation(pool, cfg, { bookingId: b.id, user: req.user, reason }));
  });

  // Tickets of the customer's own bookings
  const T = ticketResponders(app);
  const idParams = { params: { type: 'object', properties: { id: uuid } } };
  app.get('/bookings/:id/ticket', { schema: idParams }, async req => T.json(await ownBooking(req)));
  app.get('/bookings/:id/ticket.pdf', { schema: idParams }, async (req, reply) => T.pdf(await ownBooking(req), reply));
  app.post('/bookings/:id/ticket/email', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: idParams },
    async req => T.email(await ownBooking(req), req.user));

  // Requests made with this account, or with its e-mail once that e-mail is confirmed
  const OWN_REQUEST = `(r.user_id = $1 or ($2::boolean and lower(r.email) = lower($3)))`;
  const ownParams = req => [req.user.id, !!req.user.email_verified_at, req.user.email];

  app.get('/requests', async req => {
    const { rows } = await pool.query(
      `select r.id, r.reference, r.status, r.destination, r.date_from, r.date_to, r.adults, r.children, r.created_at, r.items,
              (select json_build_object('id', q.id, 'total', q.total, 'currency', q.currency, 'valid_until', q.valid_until,
                      'status', case when q.status = 'sent' and q.valid_until < current_date then 'expired' else q.status end)
                 from quotes q where q.request_id = r.id and q.status in ('sent','accepted','declined','expired')
                order by q.created_at desc limit 1) as quote
         from custom_requests r where ${OWN_REQUEST} order by r.created_at desc limit 100`, ownParams(req));
    return rows;
  });

  async function ownQuote(c, req, lock = false) {
    const { rows: [q] } = await c.query(
      `select q.*, r.reference, r.name, r.email, r.locale, r.id as req_id from quotes q join custom_requests r on r.id = q.request_id
        where q.id = $4 and q.status in ('sent','accepted','declined','expired') and ${OWN_REQUEST} ${lock ? 'for update of q' : ''}`,
      [...ownParams(req), req.params.id]);
    if (!q) throw notFound('quote_not_found');
    return q;
  }

  app.get('/quotes/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => publicQuote(await ownQuote(pool, req)));

  app.get('/quotes/:id/pdf', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const q = await ownQuote(pool, req);
    const full = await loadQuoteForPdf(pool, q.id);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${quoteFilename(full)}"`);
    return reply.send(await renderQuotePdf(pool, cfg, full));
  });

  app.post('/quotes/:id/respond', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['accept', 'decline'] } } } },
  }, async req => tx(pool, async c => {
    const q = await ownQuote(c, req, true);
    const status = await respondToQuote(c, cfg, { quote: q, decision: req.body.decision, actor: req.user });
    return publicQuote({ ...q, status });
  }));

  app.get('/loyalty', async req => loyaltyStatus(pool, req.user));

  app.patch('/profile', {
    schema: { body: { type: 'object', properties: {
      name: { type: 'string', minLength: 2, maxLength: 120 },
      phone: { type: ['string', 'null'], maxLength: 30, pattern: '^[+0-9 ()-]*$' },
      country: { type: ['string', 'null'], maxLength: 60 },
      locale: { type: 'string', enum: ['pt', 'en'] } } } },
  }, async req => {
    const u = req.user, b = req.body;
    const { rows: [nu] } = await pool.query(
      `update users set name=$2, phone=$3, country=$4, locale=$5, updated_at=now() where id=$1
       returning id, email, name, phone, country, locale, role, email_verified_at`,
      [u.id, b.name ?? u.name, b.phone !== undefined ? b.phone : u.phone, b.country !== undefined ? b.country : u.country, b.locale ?? u.locale]);
    await audit(pool, u, 'user', u.id, 'profile_updated', { fields: Object.keys(b) });
    return { user: publicUser(nu) };
  });

  app.post('/password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    schema: { body: { type: 'object', required: ['current_password', 'new_password'], properties: {
      current_password: { type: 'string', maxLength: 200 }, new_password: { type: 'string', maxLength: 200 } } } },
  }, async req => {
    const { rows: [row] } = await pool.query('select password_hash from users where id = $1', [req.user.id]);
    if (!(await verifyPassword(req.body.current_password, row.password_hash))) throw unauthorized('invalid_credentials', 'Current password is incorrect');
    const pwErr = passwordProblems(req.body.new_password);
    if (pwErr) throw badRequest(pwErr, 'Password must be at least 10 characters');
    await pool.query('update users set password_hash=$2, updated_at=now() where id=$1', [req.user.id, await hashPassword(req.body.new_password)]);
    await audit(pool, req.user, 'user', req.user.id, 'password_changed');
    return { ok: true };
  });
}
