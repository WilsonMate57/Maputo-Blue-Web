// Tickets (JSON/PDF), QR verification, revocation, check-in and e-mail attachments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';
import { ticketAttachments } from '../src/lib/tickets.js';

let ctx, admin, booking, token;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
  const r = await client(ctx.app).post('/api/bookings', bookingBody({ adults: 2, children: 1, notes: 'Vegetariano' }));
  booking = r.body.booking;
  token = r.body.token;
});
after(async () => ctx && ctx.close());

const creds = () => ({ reference: booking.reference, token });
const qrParams = url => Object.fromEntries(new URL(url).searchParams);

test('guest ticket matches the persisted booking exactly; wrong credentials are refused', async () => {
  const g = client(ctx.app);
  const r = await g.post('/api/bookings/ticket', creds());
  assert.equal(r.status, 200, r.raw);
  const t = r.body.ticket;
  assert.equal(t.reference, booking.reference);
  assert.equal(t.status, 'pending');
  assert.match(t.doc_title, /Comprovativo de pedido/);
  assert.equal(t.total, booking.total);
  assert.equal(t.adults, 2);
  assert.equal(t.children, 1);
  assert.deepEqual(t.lines.map(l => l.amount), booking.lines.map(l => l.amount));
  assert.equal(t.payment_status, 'unpaid');
  assert.equal(t.customer_notes, 'Vegetariano');
  assert.ok(!JSON.stringify(t).includes('ana@example.com'), 'e-mail is not printed');
  assert.match(t.customer_phone_masked, /•/);
  assert.match(r.body.qr_svg, /^<svg/);
  // QR carries only the verification URL (reference + signature)
  const q = qrParams(t.verify_url);
  assert.deepEqual(Object.keys(q).sort(), ['k', 'r']);
  assert.equal(q.r, booking.reference);
  assert.equal(q.k.length, 22);
  assert.equal((await g.post('/api/bookings/ticket', { reference: booking.reference, token: 'x'.repeat(32) })).status, 404);
  assert.equal((await g.post('/api/bookings/ticket', { reference: booking.reference, email: 'other@example.com' })).status, 404);
  assert.equal((await g.post('/api/bookings/ticket', { reference: booking.reference })).status, 400);
  // Lookup by e-mail also works
  assert.equal((await g.post('/api/bookings/ticket', { reference: booking.reference, email: 'ANA@example.com' })).status, 200);
});

test('PDF is a real A4 PDF for the right booking', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/api/bookings/ticket.pdf', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(creds()) });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.match(res.headers['content-disposition'], new RegExp(booking.reference));
  const pdf = res.rawPayload;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.toString('latin1').includes(booking.reference), 'reference in the PDF metadata');
  assert.ok(pdf.toString('latin1').includes('/MediaBox [0 0 595.28 841.89]'), 'A4 page');
});

test('ticket keeps the agreed prices after the package price changes', async () => {
  const cur = await admin.get('/api/admin/packages/sunset-cruise-maputo-bay');
  await admin.put('/api/admin/packages/sunset-cruise-maputo-bay', { version: cur.body.package.version,
    pricing: { ...cur.body.package.pricing, adult: 9999 } });
  const t = (await client(ctx.app).post('/api/bookings/ticket', creds())).body.ticket;
  assert.equal(t.total, booking.total);
  assert.equal(t.lines[0].amount, 3600);
});

test('QR verification reflects the live status, shows minimal data and never modifies the booking', async () => {
  const g = client(ctx.app);
  const t = (await g.post('/api/bookings/ticket', creds())).body.ticket;
  const { r, k } = qrParams(t.verify_url);
  const verify = (rr, kk, c = g) => c.get(`/api/tickets/verify?r=${encodeURIComponent(rr)}&k=${encodeURIComponent(kk)}`);

  let v = await verify(r, k);
  assert.equal(v.body.result, 'pending');
  for (const leak of ['customer_name', 'customer_email', 'customer_phone', 'total', 'id']) assert.ok(!(leak in v.body.booking), `public view leaks ${leak}`);
  assert.ok(!JSON.stringify(v.body).includes('Ana'));

  await admin.post(`/api/admin/bookings/${booking.id}/status`, { to: 'confirmed' });
  v = await verify(r, k);
  assert.equal(v.body.result, 'confirmed');

  // Tampered or unknown values
  assert.equal((await verify(r, k.slice(0, -1) + (k.endsWith('A') ? 'B' : 'A'))).body.result, 'invalid');
  assert.equal((await verify('MB-ZZZZZZ', k)).body.result, 'invalid');
  assert.equal((await verify('not-a-ref', k)).body.result, 'invalid');
  // Another booking's signature cannot be reused
  const other = await g.post('/api/bookings', bookingBody({ customer: { name: 'Outro', email: 'outro@example.com', phone: '+258840000077' } }));
  const ot = (await g.post('/api/bookings/ticket', { reference: other.body.booking.reference, token: other.body.token })).body.ticket;
  assert.equal((await verify(r, qrParams(ot.verify_url).k)).body.result, 'invalid');

  // No write access through the public page
  assert.equal((await g.post(`/api/tickets/verify?r=${r}&k=${k}`, {})).status, 404);
  assert.equal((await g.post(`/api/admin/bookings/${booking.id}/check-in`)).status, 401);
  const { rows: [b] } = await ctx.pool.query('select status, checked_in_at from bookings where id = $1', [booking.id]);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.checked_in_at, null);

  // Scans are logged
  const { rows: [{ n }] } = await ctx.pool.query('select count(*)::int n from ticket_scans where booking_id = $1', [booking.id]);
  assert.ok(n >= 3);
});

test('staff view, check-in rules and customer cannot check in', async () => {
  const t = (await client(ctx.app).post('/api/bookings/ticket', creds())).body.ticket;
  const { r, k } = qrParams(t.verify_url);
  const v = await admin.get(`/api/tickets/verify?r=${r}&k=${k}`);
  assert.equal(v.body.staff, true);
  assert.equal(v.body.booking.customer_name, 'Ana Teste');
  const cust = client(ctx.app);
  await cust.post('/api/auth/register', { name: 'Cliente', email: 'cliente-ci@example.com', password: 'customer-pass-123' });
  assert.equal((await cust.post(`/api/admin/bookings/${booking.id}/check-in`)).status, 403);
  assert.equal((await admin.post(`/api/admin/bookings/${booking.id}/check-in`)).status, 200);
  assert.equal((await admin.post(`/api/admin/bookings/${booking.id}/check-in`)).status, 409);
  const after = await admin.get(`/api/tickets/verify?r=${r}&k=${k}`);
  assert.ok(after.body.booking.checked_in_at);
  // Pending bookings cannot be checked in
  const p = await client(ctx.app).post('/api/bookings', bookingBody());
  assert.equal((await admin.post(`/api/admin/bookings/${p.body.booking.id}/check-in`)).status, 409);
});

test('revoking invalidates old QR codes; a new ticket gets a new valid QR', async () => {
  const g = client(ctx.app);
  const old = qrParams((await g.post('/api/bookings/ticket', creds())).body.ticket.verify_url);
  assert.equal((await admin.post(`/api/admin/bookings/${booking.id}/ticket/revoke`)).status, 200);
  assert.equal((await g.get(`/api/tickets/verify?r=${old.r}&k=${old.k}`)).body.result, 'revoked');
  const fresh = qrParams((await g.post('/api/bookings/ticket', creds())).body.ticket.verify_url);
  assert.notEqual(fresh.k, old.k);
  assert.equal((await g.get(`/api/tickets/verify?r=${fresh.r}&k=${fresh.k}`)).body.result, 'confirmed');
});

test('cancelled bookings verify as cancelled; tickets say so', async () => {
  const g = client(ctx.app);
  const res = await g.post('/api/bookings', bookingBody({ customer: { name: 'Cancel', email: 'cancel@example.com', phone: '+258840000055' } }));
  await admin.post(`/api/admin/bookings/${res.body.booking.id}/status`, { to: 'cancelled' });
  const t = (await g.post('/api/bookings/ticket', { reference: res.body.booking.reference, token: res.body.token })).body.ticket;
  assert.equal(t.status, 'cancelled');
  assert.match(t.doc_title, /cancelada/i);
  const { r, k } = qrParams(t.verify_url);
  assert.equal((await g.get(`/api/tickets/verify?r=${r}&k=${k}`)).body.result, 'cancelled');
});

test('account owner gets the ticket; other customers cannot', async () => {
  const a = client(ctx.app);
  await a.post('/api/auth/register', { name: 'Owner', email: 'owner@example.com', password: 'customer-pass-123' });
  const res = await a.post('/api/bookings', bookingBody({ customer: { name: 'Owner', email: 'owner@example.com', phone: '+258840000033' } }));
  const id = res.body.booking.id;
  assert.equal((await a.get(`/api/account/bookings/${id}/ticket`)).status, 200);
  assert.equal((await a.raw('GET', `/api/account/bookings/${id}/ticket.pdf`)).status, 200);
  const b = client(ctx.app);
  await b.post('/api/auth/register', { name: 'Intruder', email: 'intruder@example.com', password: 'customer-pass-123' });
  assert.equal((await b.get(`/api/account/bookings/${id}/ticket`)).status, 404);
  assert.equal((await b.raw('GET', `/api/account/bookings/${id}/ticket.pdf`)).status, 404);
  assert.equal((await client(ctx.app).get(`/api/account/bookings/${id}/ticket`)).status, 401);
});

test('ticket e-mails carry the PDF; repeated requests do not duplicate e-mails', async () => {
  const g = client(ctx.app);
  assert.equal((await g.post('/api/bookings/ticket/email', creds())).status, 200);
  assert.equal((await g.post('/api/bookings/ticket/email', creds())).status, 200);
  const { rows } = await ctx.pool.query(`select count(*)::int n from mail_outbox where template = 'booking_ticket' and data->>'attach_ticket_booking' = $1`, [booking.id]);
  assert.equal(rows[0].n, 1);
  ctx.sent.length = 0;
  const captured = [];
  await processOutbox(ctx.pool, async m => { captured.push(m); return 'id'; }, { attachments: ticketAttachments(ctx.pool, ctx.cfg) });
  const withPdf = captured.filter(m => m.attachments && m.attachments.length);
  assert.ok(withPdf.some(m => /ticket|documento/i.test(m.subject)), 'ticket e-mail sent');
  for (const m of withPdf) {
    assert.match(m.attachments[0].filename, /^maputo-blue-MB-[A-Z0-9]+\.pdf$/);
    assert.equal(Buffer.from(m.attachments[0].content, 'base64').subarray(0, 5).toString(), '%PDF-');
  }
  // Admin notices never carry the customer's ticket
  assert.ok(!captured.some(m => /Novo pedido de reserva/.test(m.subject) && m.attachments && m.attachments.length));
});
