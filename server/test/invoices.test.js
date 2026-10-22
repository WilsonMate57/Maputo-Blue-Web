// Invoices: issuance from a booking reference, numbering, verified payments,
// automatic status, refunds/reversals, corrections, PDFs, customer access.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody, idem } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';
import { invoiceAttachments } from '../src/lib/invoices.js';
import { todayLocal } from '../src/lib/dates.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

/** New booking (sunset cruise, 2 adults = MZN 3,600) — optionally for a signed-in customer client. */
async function newBooking(over = {}, as = client(ctx.app)) {
  const r = await as.post('/api/bookings', bookingBody(over));
  assert.equal(r.status, 201, r.raw);
  return { ...r.body.booking, token: r.body.token };
}
const pay = (invId, amount, extra = {}) => admin.post(`/api/admin/invoices/${invId}/payments`,
  { amount, method: 'mpesa', verified: true, idempotency_key: idem(), ...extra });
const issue = (ref, extra = {}) => admin.post('/api/admin/invoices', { booking_reference: ref, issue: true, ...extra });
const pdfText = raw => Buffer.from(raw, 'binary').toString('latin1');

test('lookup by reference shows the review data; unknown references are refused', async () => {
  const b = await newBooking();
  const r = await admin.get(`/api/admin/invoices/lookup?reference=${b.reference.toLowerCase()}`);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.booking.reference, b.reference);
  assert.equal(r.body.preview.total, 3600);
  assert.equal(r.body.preview.currency, 'MZN');
  assert.equal(r.body.preview.balance, 3600);
  assert.equal(r.body.preview.issuer.nuit, '154 559 620');
  assert.match(r.body.preview.issuer.address, /10 de Novembro Nr\.74/);
  assert.equal(r.body.existing_invoice, null);
  assert.deepEqual(r.body.preview.problems, []);

  assert.equal((await admin.get('/api/admin/invoices/lookup?reference=MB-ZZZZZZ')).status, 404);
  const notFound = await issue('MB-ZZZZZZ');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, 'booking_not_found');
});

test('issuing assigns a sequential number, freezes values and starts UNPAID (never paid automatically)', async () => {
  const b = await newBooking();
  const r = await issue(b.reference);
  assert.equal(r.status, 201, r.raw);
  const inv = r.body;
  const year = todayLocal().slice(0, 4);
  assert.match(inv.number, new RegExp(`^FT ${year}/\\d{4}$`));
  assert.equal(inv.doc_status, 'issued');
  assert.equal(inv.pay_status, 'unpaid');
  assert.equal(inv.display_status, 'unpaid');
  assert.equal(inv.total, 3600);
  assert.equal(inv.amount_paid, 0);
  assert.equal(inv.booking_snapshot.reference, b.reference);
  assert.equal(inv.issue_date, todayLocal());
  assert.ok(inv.due_date >= inv.issue_date);
  // The booking itself is untouched: still pending, still unpaid
  const d = await admin.get(`/api/admin/bookings/${b.id}`);
  assert.equal(d.body.booking.status, 'pending');
  assert.equal(d.body.booking.payment_status, 'unpaid');
  assert.equal(d.body.invoices[0].number, inv.number);
});

test('a second invoice for the same booking is refused and points to the existing one', async () => {
  const b = await newBooking();
  const first = await issue(b.reference);
  const again = await issue(b.reference);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'invoice_exists');
  assert.equal(again.body.details.id, first.body.id);
  const look = await admin.get(`/api/admin/invoices/lookup?reference=${b.reference}`);
  assert.equal(look.body.existing_invoice.id, first.body.id);
  // Concurrent attempts: exactly one invoice
  const b2 = await newBooking();
  const rs = await Promise.all([issue(b2.reference), issue(b2.reference), issue(b2.reference)]);
  assert.equal(rs.filter(x => x.status === 201).length, 1);
  assert.ok(rs.filter(x => x.status !== 201).every(x => x.status === 409));
});

test('numbers stay unique and gapless under concurrent issuance; failures do not consume numbers', async () => {
  const bookings = await Promise.all(Array.from({ length: 6 }, () => newBooking()));
  // A failing issuance in the middle (cancelled booking cannot be invoiced)
  const bad = await newBooking();
  await admin.post(`/api/admin/bookings/${bad.id}/status`, { to: 'cancelled', notify: false });
  const results = await Promise.all([...bookings.map(b => issue(b.reference)), issue(bad.reference)]);
  assert.equal(results.at(-1).status, 409);
  assert.equal(results.at(-1).body.error, 'booking_not_billable');
  const seqs = results.slice(0, -1).map(r => { assert.equal(r.status, 201, r.raw); return r.body.seq; }).sort((a, b) => a - b);
  const { rows: [{ max }] } = await ctx.pool.query('select max(seq) from invoices where year = $1', [Number(todayLocal().slice(0, 4))]);
  const { rows: [{ n }] } = await ctx.pool.query('select count(*)::int n from invoices where number is not null');
  assert.equal(max, n, 'no gaps: highest number equals the number of issued invoices');
  assert.equal(new Set(seqs).size, seqs.length);
  for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1] + 1);
});

test('partial payment → PARTIALLY_PAID; PAID only when the balance reaches zero; overpayment refused', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  let r = await pay(inv.id, 1000, { reference: 'MP-A1' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.invoice.pay_status, 'partially_paid');
  assert.equal(r.body.invoice.amount_paid, 1000);
  assert.equal(r.body.booking_payment_status, 'partial');

  r = await pay(inv.id, 2600.01, { reference: 'MP-A2' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'overpayment');
  assert.equal(r.body.details.outstanding, 2600);

  r = await pay(inv.id, 2599.99, { reference: 'MP-A3' });
  assert.equal(r.body.invoice.pay_status, 'partially_paid', 'one cent still open');
  r = await pay(inv.id, 0.01, { reference: 'MP-A4' });
  assert.equal(r.body.invoice.pay_status, 'paid');
  assert.equal(r.body.invoice.display_status, 'paid');
  assert.ok(r.body.invoice.paid_at);
  assert.equal(r.body.booking_payment_status, 'paid');

  const d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.balance, 0);
  assert.equal(d.payments.length, 3);
  assert.ok(d.history.some(h => h.action === 'payment_status_changed' && h.data.to === 'paid'));
  // The customer gets one "paid" e-mail with the updated invoice attached
  const { rows } = await ctx.pool.query(`select * from mail_outbox where idempotency_key like $1`, [`invoice:${inv.id}:invoice_paid:%`]);
  assert.equal(rows.length, 1);
});

test('unverified payments, duplicate submissions and repeated transaction references are refused', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  const unverified = await admin.post(`/api/admin/invoices/${inv.id}/payments`, { amount: 100, method: 'cash', verified: false });
  assert.equal(unverified.status, 400);
  assert.equal(unverified.body.error, 'payment_not_verified');

  const key = idem();
  const [a, b2] = await Promise.all([pay(inv.id, 500, { idempotency_key: key }), pay(inv.id, 500, { idempotency_key: key })]);
  assert.deepEqual([a.status, b2.status].sort(), [200, 201]);
  assert.equal(a.body.payment.id, b2.body.payment.id);
  const again = await pay(inv.id, 500, { idempotency_key: key });
  assert.equal(again.body.duplicate, true);

  await pay(inv.id, 300, { method: 'bank_transfer', reference: 'TRF-777' });
  const dupRef = await pay(inv.id, 300, { method: 'bank_transfer', reference: 'trf-777' });
  assert.equal(dupRef.status, 409);
  assert.equal(dupRef.body.error, 'duplicate_payment');
  const d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.amount_paid, 800);
});

test('payment recorded during issuance when the money was already verified', async () => {
  const b = await newBooking();
  const r = await issue(b.reference, { payment: { amount: 3600, method: 'bank_transfer', reference: 'TRF-PRE', verified: true, idempotency_key: idem() } });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.pay_status, 'paid');
  assert.equal(r.body.display_status, 'paid');
  // Unverified money cannot ride along with the issuance either (and nothing is issued)
  const b2 = await newBooking();
  const bad = await issue(b2.reference, { payment: { amount: 3600, method: 'cash', verified: false } });
  assert.equal(bad.status, 400);
  assert.equal((await admin.get(`/api/admin/invoices/lookup?reference=${b2.reference}`)).body.existing_invoice, null);
});

test('refunds and reversals adjust the balance and keep the full history', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  const p1 = (await pay(inv.id, 3000, { reference: 'MP-R1' })).body.payment;
  await pay(inv.id, 600, { reference: 'MP-R2' });
  let d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.pay_status, 'paid');

  // Mistaken entry reversed: original row kept and flagged, balance reopens
  let r = await admin.post(`/api/admin/invoices/${inv.id}/payments`, { kind: 'reversal', reverses_payment_id: p1.id, verified: true, idempotency_key: idem() });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.payment.amount, -3000);
  assert.equal(r.body.invoice.pay_status, 'partially_paid');
  r = await admin.post(`/api/admin/invoices/${inv.id}/payments`, { kind: 'reversal', reverses_payment_id: p1.id, verified: true, idempotency_key: idem() });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'already_reversed');

  // Refund of the rest → nothing paid, status "refunded"; cannot refund more than paid
  r = await admin.post(`/api/admin/invoices/${inv.id}/payments`, { kind: 'refund', amount: 700, method: 'mpesa', verified: true, idempotency_key: idem() });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'refund_exceeds_paid');
  r = await admin.post(`/api/admin/invoices/${inv.id}/payments`, { kind: 'refund', amount: 600, method: 'mpesa', verified: true, idempotency_key: idem() });
  assert.equal(r.body.invoice.pay_status, 'refunded');
  assert.equal(r.body.booking_payment_status, 'refunded');

  d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.payments.length, 4, 'nothing deleted');
  assert.equal(d.payments.find(p => p.id === p1.id).reversed, true);
  assert.deepEqual(d.payments.map(p => p.kind), ['payment', 'payment', 'reversal', 'refund']);
  for (const a of ['issued', 'payment_recorded', 'payment_reversed', 'refund_recorded']) assert.ok(d.history.some(h => h.action === a), a);
});

test('issued values do not change when package prices change; correction = cancel + new number', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  await pay(inv.id, 1000, { reference: 'MP-C1' });
  const cur = await admin.get('/api/admin/packages/sunset-cruise-maputo-bay');
  await admin.put('/api/admin/packages/sunset-cruise-maputo-bay', { version: cur.body.package.version, pricing: { ...cur.body.package.pricing, adult: 9999 } });
  let d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.total, 3600);
  assert.equal(d.invoice.lines[0].amount, 3600);
  assert.equal(d.invoice.lines[0].unit_price, 1800);

  // Issued invoices are read-only
  assert.equal((await admin.patch(`/api/admin/invoices/${inv.id}`, { notes: 'x' })).status, 409);
  assert.equal((await admin.del(`/api/admin/invoices/${inv.id}`)).status, 409);

  // Booking total corrected by the team → invoice flags it until corrected
  await admin.patch(`/api/admin/bookings/${b.id}`, { total_override: 3000, override_reason: 'Desconto de fidelização', notify: false });
  d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.ok(d.warnings.includes('booking_total_changed'));
  const noReason = await admin.post(`/api/admin/invoices/${inv.id}/cancel`, { reason: '' });
  assert.equal(noReason.status, 400);
  const r = await admin.post(`/api/admin/invoices/${inv.id}/cancel`, { reason: 'Correcção do valor acordado', reissue: true });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.cancelled.doc_status, 'cancelled');
  assert.equal(r.body.cancelled.number, inv.number, 'the cancelled number stays');
  assert.notEqual(r.body.invoice.number, inv.number);
  assert.equal(r.body.invoice.total, 3000);
  assert.equal(r.body.invoice.amount_paid, 1000, 'payments carry over to the corrected invoice');
  assert.equal(r.body.invoice.pay_status, 'partially_paid');
  assert.equal(r.body.invoice.replaces_invoice_id, inv.id);
  assert.equal(r.body.invoice.lines.at(-1).description, 'Ajuste de preço acordado');
  const old = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(old.invoice.total, 3600);
  assert.equal(old.invoice.display_status, 'cancelled');
  assert.equal(old.invoice.cancel_reason, 'Correcção do valor acordado');
  // Payments cannot be added to a cancelled invoice
  assert.equal((await pay(inv.id, 10)).status, 400);
  await admin.put('/api/admin/packages/sunset-cruise-maputo-bay', { version: cur.body.package.version + 1, pricing: cur.body.package.pricing });
});

test('drafts: save, edit, issue later; deleting only drafts', async () => {
  const b = await newBooking();
  const draft = await admin.post('/api/admin/invoices', { booking_reference: b.reference, issue: false, notes: 'Grupo escolar' });
  assert.equal(draft.status, 201, draft.raw);
  assert.equal(draft.body.doc_status, 'draft');
  assert.equal(draft.body.number, null);
  assert.equal(draft.body.display_status, 'draft');
  const ed = await admin.patch(`/api/admin/invoices/${draft.body.id}`, { billing: { nuit: '400123456', address: 'Av. Julius Nyerere 100, Maputo' } });
  assert.equal(ed.status, 200, ed.raw);
  assert.equal(ed.body.customer.nuit, '400123456');
  assert.equal((await admin.get(`/api/admin/invoices/${draft.body.id}/pdf`)).status, 400, 'no PDF for drafts');
  const issued = await admin.post(`/api/admin/invoices/${draft.body.id}/issue`, {});
  assert.equal(issued.status, 200, issued.raw);
  assert.match(issued.body.number, /^FT \d{4}\/\d{4}$/);
  assert.equal(issued.body.customer.nuit, '400123456');
  assert.equal(issued.body.notes, 'Grupo escolar');
  // Another draft for a new booking can be discarded
  const b2 = await newBooking();
  const d2 = await admin.post('/api/admin/invoices', { booking_reference: b2.reference });
  assert.equal((await admin.del(`/api/admin/invoices/${d2.body.id}`)).status, 200);
  assert.equal((await admin.get(`/api/admin/invoices/${d2.body.id}`)).status, 404);
});

test('PDF: real A4 document in the booking language, current and original copies', async () => {
  const b = await newBooking({ locale: 'en', customer: { name: 'John Smith', email: 'john@example.com', phone: '+27 82 000 0000' } });
  const inv = (await issue(b.reference)).body;
  await pay(inv.id, 3600, { reference: 'CARD-1', method: 'card' });
  const res = await ctx.app.inject({ method: 'GET', url: `/api/admin/invoices/${inv.id}/pdf`, headers: { cookie: admin.cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.match(res.headers['content-disposition'], /factura-FT-\d{4}-\d{4}\.pdf/);
  const pdf = res.rawPayload;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdfText(pdf).includes('/MediaBox [0 0 595.28 841.89]'));
  assert.ok(pdfText(pdf).includes(`Invoice ${inv.number}`), 'English title in the metadata');
  const orig = await ctx.app.inject({ method: 'GET', url: `/api/admin/invoices/${inv.id}/original.pdf`, headers: { cookie: admin.cookie } });
  assert.equal(orig.statusCode, 200);
  assert.equal(orig.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const { rows: [doc] } = await ctx.pool.query('select sha256 from invoice_documents where invoice_id = $1', [inv.id]);
  assert.match(doc.sha256, /^[0-9a-f]{64}$/);
  // Portuguese booking → Portuguese document
  const pt = await newBooking();
  const ptInv = (await issue(pt.reference)).body;
  const ptPdf = await ctx.app.inject({ method: 'GET', url: `/api/admin/invoices/${ptInv.id}/pdf`, headers: { cookie: admin.cookie } });
  assert.ok(pdfText(ptPdf.rawPayload).includes(`Factura ${ptInv.number}`));
});

test('invoice e-mail carries the PDF; PT and EN templates', async () => {
  const b = await newBooking({ locale: 'en', customer: { name: 'Jane Doe', email: 'jane@example.com', phone: '+27 82 000 0001' } });
  const inv = (await issue(b.reference, { send_email: true })).body;
  const before = ctx.sent.length;
  await processOutbox(ctx.pool, ctx.transport, { limit: 1000, attachments: invoiceAttachments(ctx.pool, ctx.cfg) });
  const mail = ctx.sent.slice(before).find(m => m.to === 'jane@example.com' && /Invoice/.test(m.subject));
  assert.ok(mail, 'English invoice e-mail sent');
  assert.equal(mail.attachments.length, 1);
  assert.match(mail.attachments[0].filename, /\.pdf$/);
  const r = await admin.post(`/api/admin/invoices/${inv.id}/email`);
  assert.equal(r.status, 200);
  const pt = await newBooking();
  const ptInv = (await issue(pt.reference, { send_email: true })).body;
  await processOutbox(ctx.pool, ctx.transport, { limit: 1000, attachments: invoiceAttachments(ctx.pool, ctx.cfg) });
  assert.ok(ctx.sent.some(m => m.to === 'ana@example.com' && m.subject.startsWith(`Factura ${ptInv.number}`)));
});

test('only administrators issue invoices or record payments', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  const guest = client(ctx.app);
  assert.equal((await guest.post('/api/admin/invoices', { booking_reference: b.reference, issue: true })).status, 401);
  assert.equal((await guest.post(`/api/admin/invoices/${inv.id}/payments`, { amount: 10, method: 'cash', verified: true })).status, 401);
  const cust = client(ctx.app);
  await cust.post('/api/auth/register', { name: 'Paula', email: 'paula@example.com', password: 'paula-password-1' });
  assert.equal((await cust.post('/api/admin/invoices', { booking_reference: b.reference, issue: true })).status, 403);
  assert.equal((await cust.post(`/api/admin/invoices/${inv.id}/payments`, { amount: 10, method: 'cash', verified: true })).status, 403);
  assert.equal((await cust.post(`/api/admin/bookings/${b.id}/payments`, { amount: 10, method: 'cash', verified: true })).status, 403);
  assert.equal((await cust.get(`/api/admin/invoices/${inv.id}/pdf`)).status, 403);
  const { rows: [{ n }] } = await ctx.pool.query('select count(*)::int n from payments where booking_id = $1', [b.id]);
  assert.equal(n, 0);
});

test('customers see their own invoices (status, balance, PDF) and never anyone else\'s', async () => {
  const maria = client(ctx.app);
  await maria.post('/api/auth/register', { name: 'Maria Inv', email: 'maria.inv@example.com', password: 'maria-password-1' });
  const mb = await newBooking({ customer: { name: 'Maria Inv', email: 'maria.inv@example.com', phone: '+258 84 111 1111' } }, maria);
  const minv = (await issue(mb.reference)).body;
  await pay(minv.id, 3600, { reference: 'MP-M1' });

  const list = await maria.get('/api/account/invoices');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].number, minv.number);
  assert.equal(list.body[0].status, 'paid');
  assert.equal(list.body[0].balance, 0);
  for (const leak of ['lines', 'customer', 'issuer', 'notes']) assert.ok(!(leak in list.body[0]), leak);
  const bookings = await maria.get('/api/account/bookings');
  assert.equal(bookings.body.find(x => x.id === mb.id).invoice.status, 'paid');
  const pdf = await ctx.app.inject({ method: 'GET', url: `/api/account/invoices/${minv.id}/pdf`, headers: { cookie: maria.cookie } });
  assert.equal(pdf.statusCode, 200);

  const joao = client(ctx.app);
  await joao.post('/api/auth/register', { name: 'Joao', email: 'joao.inv@example.com', password: 'joao-password-1' });
  assert.deepEqual((await joao.get('/api/account/invoices')).body, []);
  assert.equal((await joao.get(`/api/account/invoices/${minv.id}/pdf`)).status, 404);
  // Customers cannot change payments or statuses through their API
  assert.equal((await maria.post(`/api/admin/invoices/${minv.id}/payments`, { amount: 1, method: 'cash', verified: true })).status, 403);

  // Guests: only with the booking's secret token or e-mail, via POST
  const g = await newBooking();
  const ginv = (await issue(g.reference)).body;
  const guest = client(ctx.app);
  const ok = await guest.post('/api/bookings/invoice', { reference: g.reference, token: g.token });
  assert.equal(ok.body.invoice.number, ginv.number);
  assert.equal(ok.body.invoice.status, 'unpaid');
  assert.equal((await guest.post('/api/bookings/invoice', { reference: g.reference, email: 'someone@else.com' })).status, 404);
  assert.equal((await guest.post('/api/bookings/invoice', { reference: g.reference, token: 'x'.repeat(32) })).status, 404);
  const gpdf = await ctx.app.inject({ method: 'POST', url: '/api/bookings/invoice.pdf', headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ reference: g.reference, token: g.token }) });
  assert.equal(gpdf.statusCode, 200);
  // Drafts are never visible to customers
  const d = await newBooking();
  await admin.post('/api/admin/invoices', { booking_reference: d.reference });
  assert.equal((await guest.post('/api/bookings/invoice', { reference: d.reference, token: d.token })).body.invoice, null);
});

test('booking and invoice statuses stay separate and consistent', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'confirmed', notify: false });
  let d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.booking.status, 'confirmed');
  assert.equal(d.invoice.pay_status, 'unpaid', 'confirmed booking, unpaid invoice');
  // Payment recorded from the booking screen updates the invoice too
  const r = await admin.post(`/api/admin/bookings/${b.id}/payments`, { amount: 3600, method: 'cash', verified: true, idempotency_key: idem() });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.invoice.pay_status, 'paid');
  d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.display_status, 'paid');
  assert.equal(d.booking.payment_status, 'paid');
  assert.equal(d.booking.status, 'confirmed', 'payment does not change the trip status');
  // Cancelled trip: invoice stays paid until a refund is recorded, and is flagged
  await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'cancelled', notify: false });
  d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.ok(d.warnings.includes('booking_cancelled'));
  assert.equal(d.invoice.pay_status, 'paid');
});

test('overdue is derived from the due date; list filters, search, summary and CSV agree', async () => {
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  await pay(inv.id, 500, { reference: 'MP-O1' });
  await ctx.pool.query(`update invoices set issue_date = current_date - 20, due_date = current_date - 5 where id = $1`, [inv.id]);
  const d = (await admin.get(`/api/admin/invoices/${inv.id}`)).body;
  assert.equal(d.invoice.display_status, 'overdue');

  const overdue = await admin.get('/api/admin/invoices?status=overdue');
  assert.ok(overdue.body.items.some(i => i.id === inv.id));
  assert.ok(overdue.body.items.every(i => i.display_status === 'overdue'));
  const byRef = await admin.get(`/api/admin/invoices?q=${b.reference}`);
  assert.equal(byRef.body.total, 1);
  const byNumber = await admin.get(`/api/admin/invoices?q=${encodeURIComponent(inv.number)}`);
  assert.equal(byNumber.body.items[0].id, inv.id);
  const byMethod = await admin.get('/api/admin/invoices?method=mpesa');
  assert.ok(byMethod.body.items.some(i => i.id === inv.id));
  const paged = await admin.get('/api/admin/invoices?page_size=2&page=2');
  assert.equal(paged.body.items.length, 2);

  const s = (await admin.get('/api/admin/invoices/summary')).body;
  const mzn = s.currencies.find(c => c.currency === 'MZN');
  const { rows: [db] } = await ctx.pool.query(
    `select coalesce(sum(total) filter (where doc_status = 'issued' and issue_date >= current_date - 30), 0)::float as invoiced,
            coalesce(sum(total - amount_paid) filter (where doc_status = 'issued' and pay_status in ('unpaid','partially_paid')), 0)::float as outstanding
       from invoices`);
  assert.equal(mzn.invoiced, db.invoiced);
  assert.equal(mzn.outstanding_now, db.outstanding);
  assert.ok(mzn.received > 0 && mzn.received !== mzn.invoiced, 'received money is reported separately from invoiced value');
  assert.ok(mzn.overdue_now >= 3100);

  const csv = await admin.get('/api/admin/invoices.csv?status=overdue');
  assert.equal(csv.status, 200);
  assert.ok(csv.raw.includes(inv.number));
  assert.ok(!csv.raw.includes('Ana Teste,ana@example.com,Sunset Cruise,MZN,3600,3600,0'), 'paid invoices are not in the overdue export');
});

test('invoicing settings: issuer details editable, tax requires a rate', async () => {
  const s = await admin.get('/api/admin/settings');
  assert.equal(s.body.invoicing.issuer.nuit, '154 559 620');
  assert.equal(s.body.invoicing.tax.enabled, false, 'tax is off until confirmed by an accountant');
  assert.equal((await admin.put('/api/admin/settings/invoicing', { tax: { enabled: true } })).status, 400);
  const r = await admin.put('/api/admin/settings/invoicing', { issuer: { legal_name: 'Maputo Blue, Lda' } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.issuer.nuit, '154 559 620', 'partial update keeps the other issuer fields');
  assert.equal(r.body.issuer.legal_name, 'Maputo Blue, Lda');
  // Issued invoices keep the issuer details they were issued with
  const b = await newBooking();
  const inv = (await issue(b.reference)).body;
  await admin.put('/api/admin/settings/invoicing', { issuer: { legal_name: 'Outro Nome' } });
  assert.equal((await admin.get(`/api/admin/invoices/${inv.id}`)).body.invoice.issuer.legal_name, 'Maputo Blue, Lda');
});
