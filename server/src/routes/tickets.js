// ─────────────────────────────────────────────────────────────────────────────
// routes/tickets.js — Ticket access for guests and QR verification.
//
// Guests prove ownership exactly like on the status page: reference + the
// secret token from the e-mail link, or reference + the booking e-mail.
// Credentials travel in POST bodies, never in URLs. The public verification
// endpoint returns only the minimum needed to check a booking and can never
// change it; staff (admin session) additionally see the customer name and
// can register a check-in through the protected admin API.
// ─────────────────────────────────────────────────────────────────────────────
import { checkSignature, qrSvg, renderTicketPdf, ticketData, verificationView } from '../lib/tickets.js';
import { currentInvoicePdf, invoiceFilename, publicInvoice } from '../lib/invoices.js';
import { enqueueMail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound } from '../lib/errors.js';
import { sha256 } from '../lib/security.js';

const REF = { type: 'string', maxLength: 20, pattern: '^MB-[A-Z0-9]{4,10}$' };
const credentials = {
  type: 'object', required: ['reference'],
  properties: { reference: REF, token: { type: 'string', maxLength: 100 }, email: { type: 'string', maxLength: 200 } },
};

/** Resolve a guest's booking from reference + token|email, or 404. */
export async function guestBooking(pool, body) {
  const { reference, token, email } = body;
  if (!token && !email) throw badRequest('token_or_email_required');
  const { rows: [b] } = await pool.query('select * from bookings where reference = $1', [reference]);
  const ok = b && ((token && b.lookup_token_hash === sha256(token)) ||
                   (email && b.customer_email.toLowerCase() === String(email).trim().toLowerCase()));
  if (!ok) throw notFound('booking_not_found', 'No booking matches these details');
  return b;
}

/** Shared responders used by the guest, account and admin routes. */
export function ticketResponders(app) {
  const { pool, cfg } = app;
  return {
    async json(b) {
      const data = await ticketData(pool, cfg, b);
      return { ticket: data, qr_svg: await qrSvg(data.verify_url) };
    },
    async pdf(b, reply) {
      const data = await ticketData(pool, cfg, b);
      const buf = await renderTicketPdf(cfg, data);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="maputo-blue-${b.reference}.pdf"`);
      return reply.send(buf);
    },
    /** Queue the ticket e-mail; at most once per 10 minutes per booking. */
    async email(b, actor) {
      const bucket = Math.floor(Date.now() / 600000);
      await enqueueMail(pool, { key: `booking:${b.id}:ticket:${bucket}`, to: b.customer_email, template: 'booking_ticket', locale: b.locale,
        data: { reference: b.reference, customer_name: b.customer_name, status: b.status, attach_ticket_booking: b.id } });
      await audit(pool, actor, 'booking', b.id, 'ticket_emailed', {});
      return { ok: true };
    },
  };
}

export default async function ticketRoutes(app) {
  const { pool, cfg } = app;
  const T = ticketResponders(app);
  const limited = { rateLimit: { max: 20, timeWindow: '10 minutes' } };

  app.post('/bookings/ticket', { config: limited, schema: { body: credentials } }, async req => T.json(await guestBooking(pool, req.body)));
  app.post('/bookings/ticket.pdf', { config: limited, schema: { body: credentials } }, async (req, reply) => T.pdf(await guestBooking(pool, req.body), reply));
  app.post('/bookings/ticket/email', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }, schema: { body: credentials } },
    async req => T.email(await guestBooking(pool, req.body), null));

  // Invoice of a guest booking: same proof of ownership, POST only (no guessable URL)
  const guestInvoice = async body => {
    const b = await guestBooking(pool, body);
    const { rows: [inv] } = await pool.query(
      `select * from invoices where booking_id = $1 and doc_status <> 'draft' order by (doc_status = 'issued') desc, created_at desc limit 1`, [b.id]);
    return inv || null;
  };
  app.post('/bookings/invoice', { config: limited, schema: { body: credentials } }, async req => {
    const inv = await guestInvoice(req.body);
    return { invoice: inv ? publicInvoice(inv) : null };
  });
  app.post('/bookings/invoice.pdf', { config: limited, schema: { body: credentials } }, async (req, reply) => {
    const inv = await guestInvoice(req.body);
    if (!inv) throw notFound('invoice_not_found');
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${invoiceFilename(inv)}"`);
    return reply.send(await currentInvoicePdf(pool, cfg, inv));
  });

  // QR verification — read-only, minimal data, every scan logged
  app.get('/tickets/verify', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { querystring: { type: 'object', required: ['r', 'k'], properties: { r: { type: 'string', maxLength: 20 }, k: { type: 'string', maxLength: 64 } } } },
  }, async req => {
    const ref = String(req.query.r).toUpperCase();
    const ipHash = sha256(cfg.ipHashSalt + req.ip);
    const staff = req.user && req.user.role === 'admin' ? req.user : null;
    const { rows: [b] } = /^MB-[A-Z0-9]{4,10}$/.test(ref) ? await pool.query('select * from bookings where reference = $1', [ref]) : { rows: [] };
    const log = (result, id) => pool.query(`insert into ticket_scans (booking_id, reference, result, staff_id, ip_hash) values ($1,$2,$3,$4,$5)`,
      [id || null, ref.slice(0, 20), result, staff ? staff.id : null, ipHash]);

    // Same answer for unknown references and wrong signatures: nothing to enumerate
    if (!b) { await log('invalid'); return { result: 'invalid' }; }
    if (!checkSignature(cfg, b.reference, b.ticket_version, req.query.k)) {
      // A signature for an older ticket version means the ticket was revoked
      let revoked = false;
      for (let v = 1; v < b.ticket_version && !revoked; v++) revoked = checkSignature(cfg, b.reference, v, req.query.k);
      await log(revoked ? 'revoked' : 'invalid', b.id);
      return { result: revoked ? 'revoked' : 'invalid' };
    }
    await log(b.status, b.id);
    const view = verificationView(b, b.price_snapshot || {});
    if (!staff) return { result: b.status, booking: view };
    const { rows: scans } = await pool.query(
      `select at, result, (staff_id is not null) as by_staff from ticket_scans where booking_id = $1 order by at desc limit 10`, [b.id]);
    return {
      result: b.status, staff: true,
      booking: { ...view, id: b.id, customer_name: b.customer_name, customer_phone: b.customer_phone,
        option_key: b.option_key, checked_in_at: b.checked_in_at, total: b.total, currency: b.currency, amount_paid: b.amount_paid },
      scans,
    };
  });
}
