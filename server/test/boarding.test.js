// Boarding needs the trip paid in full: receipts are never tickets, the QR code
// exists only once the booking may board, check-in follows the same rule and the
// team can authorise exceptions with a reason. Phone numbers in international form.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody, idem } from './helpers.js';
import { normalizeCustomerPhone } from '../src/lib/phone.js';
import { ticketAttachments } from '../src/lib/tickets.js';
import { renderTemplate } from '../src/lib/mail-templates.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
  await admin.put('/api/admin/settings/notifications', { admin_whatsapp: ['+258 84 999 0000'] });
});
after(async () => ctx && ctx.close());

async function book(over = {}) {
  const r = await client(ctx.app).post('/api/bookings', bookingBody(over));
  assert.equal(r.status, 201, r.raw);
  return { ...r.body.booking, token: r.body.token };
}
const ticket = b => client(ctx.app).post('/api/bookings/ticket', { reference: b.reference, token: b.token });
const row = async id => (await ctx.pool.query('select * from bookings where id = $1', [id])).rows[0];
const confirm = id => admin.post(`/api/admin/bookings/${id}/status`, { to: 'confirmed', notify: false });
const pay = (id, amount, extra = {}) => admin.post(`/api/admin/bookings/${id}/payments`, { amount, method: 'cash', verified: true, idempotency_key: idem(), ...extra });

test('phone numbers: Mozambican mobiles and international numbers only', () => {
  assert.equal(normalizeCustomerPhone('84 123 4567'), '+258 84 123 4567');
  assert.equal(normalizeCustomerPhone('+258 (82) 123-4567'), '+258 82 123 4567');
  assert.equal(normalizeCustomerPhone('00258871234567'), '+258 87 123 4567');
  assert.equal(normalizeCustomerPhone('+27 82 555 1234'), '+27825551234');
  assert.equal(normalizeCustomerPhone('+351 912 345 678'), '+351912345678');
  for (const bad of ['', '123456', '84 123', '0841234567', '+258 21 123 456', '+258 88 123 4567', '+258 84 123 45678', '+0 123 456 789', 'ligar-me'])
    assert.equal(normalizeCustomerPhone(bad), null, bad);
});

test('bookings and quote requests refuse a phone without a valid mobile number', async () => {
  const g = client(ctx.app);
  const bad = await g.post('/api/bookings', bookingBody({ customer: { name: 'Sem Indicativo', email: 'x@example.com', phone: '123456' } }));
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_phone');
  const req = await g.post('/api/custom-requests', { name: 'Rui', email: 'rui@example.com', phone: '21 123 456', adults: 2, consent: true, idempotency_key: idem() });
  assert.equal(req.body.error, 'invalid_phone');

  const local = await book({ customer: { name: 'Local', email: 'local@example.com', phone: '84 123 4567' } });
  assert.equal((await row(local.id)).customer_phone, '+258 84 123 4567');
});

test('WhatsApp: a different number is kept, and the team chat button opens the right one', async () => {
  const other = await book({ customer: { name: 'Outro WhatsApp', email: 'wa@example.com', phone: '+258 82 111 2222', has_whatsapp: false, whatsapp: '+27 82 555 1234' } });
  const r = await row(other.id);
  assert.equal(r.customer_has_whatsapp, false);
  assert.equal(r.customer_whatsapp, '+27825551234');
  const none = await book({ customer: { name: 'Sem WhatsApp', email: 'nowa@example.com', phone: '+258 82 333 4444', has_whatsapp: false } });
  assert.equal((await row(none.id)).customer_whatsapp, null);
  assert.equal((await client(ctx.app).post('/api/bookings', bookingBody({ customer: { name: 'Mau', email: 'mau@example.com', phone: '+258 84 000 0001', has_whatsapp: false, whatsapp: '999' } }))).body.error, 'invalid_phone');

  const { rows } = await ctx.pool.query(`select b.customer_email, w.chat_phone from whatsapp_outbox w join bookings b on w.idempotency_key like 'booking:' || b.id || ':admin_new%'`);
  const byEmail = Object.fromEntries(rows.map(x => [x.customer_email, x.chat_phone]));
  assert.equal(byEmail['wa@example.com'], '27825551234');
  assert.equal(byEmail['nowa@example.com'], null);
});

test('a request is a receipt: no QR code, not attached to automatic e-mails', async () => {
  const b = await book();
  const t = (await ticket(b)).body;
  assert.equal(t.ticket.state, 'request');
  assert.equal(t.qr_svg, null);
  assert.equal(t.ticket.verify_url, null);
  assert.match(t.ticket.doc_title, /Comprovativo de pedido/);
  assert.match(t.ticket.notice, /NÃO é um bilhete/);
  const pdf = await client(ctx.app).raw('POST', '/api/bookings/ticket.pdf', { reference: b.reference, token: b.token });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');

  const attach = ticketAttachments(ctx.pool, ctx.cfg);
  assert.deepEqual(await attach({ template: 'booking_received', data: { attach_ticket_booking: b.id } }), []);
  assert.equal((await attach({ template: 'booking_ticket', data: { attach_ticket_booking: b.id } })).length, 1, 'asked for, the receipt is sent');
});

test('confirmed but not paid: still no ticket, check-in refused, the amount due is stated', async () => {
  const b = await book();
  assert.equal((await confirm(b.id)).status, 200);
  await pay(b.id, 500);
  const t = (await ticket(b)).body.ticket;
  assert.equal(t.state, 'unpaid');
  assert.equal(t.verify_url, null);
  assert.match(t.doc_title, /pagamento pendente/);
  assert.equal(t.amount_due, Number(b.total) - 500);
  assert.match(t.notice, /só fica concluída com o pagamento total/);

  const ci = await admin.post(`/api/admin/bookings/${b.id}/check-in`);
  assert.equal(ci.status, 409);
  assert.equal(ci.body.error, 'payment_pending');
  const attach = ticketAttachments(ctx.pool, ctx.cfg);
  assert.deepEqual(await attach({ template: 'booking_status', data: { attach_ticket_booking: b.id } }), []);
});

test('paid in full: the ticket gets its QR code and is e-mailed once, check-in works', async () => {
  const b = await book();
  await confirm(b.id);
  const r = await pay(b.id, Number(b.total));
  assert.equal(r.status, 201, r.raw);
  const t = (await ticket(b)).body;
  assert.equal(t.ticket.state, 'boarding');
  assert.ok(t.qr_svg && t.ticket.verify_url);
  assert.equal(t.ticket.doc_title, 'Bilhete');
  assert.equal(t.ticket.notice, null);

  const { rows } = await ctx.pool.query(`select template, data from mail_outbox where idempotency_key = $1`, [`booking:${b.id}:ticket:paid`]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.state, 'boarding');
  const attach = ticketAttachments(ctx.pool, ctx.cfg);
  assert.equal((await attach({ template: 'booking_status', data: { attach_ticket_booking: b.id } })).length, 1);

  const k = new URL(t.ticket.verify_url).searchParams;
  const v = await admin.get(`/api/tickets/verify?r=${k.get('r')}&k=${k.get('k')}`);
  assert.equal(v.body.booking.may_board, true);
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/check-in`)).status, 200);
});

test('exceptions: the team authorises boarding with a reason, and can take it back', async () => {
  const b = await book();
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: true, reason: 'Agência' })).status, 409, 'only confirmed bookings');
  await confirm(b.id);
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: true })).body.error, 'reason_required');
  const ok = await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: true, reason: 'Agência paga no fim do mês' });
  assert.equal(ok.status, 200, ok.raw);
  assert.equal(ok.body.boarding_override_reason, 'Agência paga no fim do mês');
  let t = (await ticket(b)).body;
  assert.equal(t.ticket.state, 'boarding');
  assert.equal(t.ticket.boarding_authorised, true);
  assert.ok(t.qr_svg);

  await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: false });
  t = (await ticket(b)).body;
  assert.equal(t.ticket.state, 'unpaid');
  assert.equal(t.qr_svg, null);
  const { rows } = await ctx.pool.query(`select action from audit_log where entity_id = $1 and action like 'boarding%' order by id`, [b.id]);
  assert.deepEqual(rows.map(x => x.action), ['boarding_authorised', 'boarding_authorisation_removed']);
});

test('old QR codes of unpaid bookings say the booking may not board', async () => {
  const b = await book();
  await confirm(b.id);
  await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: true, reason: 'teste' });
  const url = (await ticket(b)).body.ticket.verify_url;
  await admin.post(`/api/admin/bookings/${b.id}/boarding`, { allow: false });
  const k = new URL(url).searchParams;
  const pub = await client(ctx.app).get(`/api/tickets/verify?r=${k.get('r')}&k=${k.get('k')}`);
  assert.equal(pub.body.booking.may_board, false);
  const staff = await admin.get(`/api/tickets/verify?r=${k.get('r')}&k=${k.get('k')}`);
  assert.equal(staff.body.booking.amount_due, Number(b.total));
});

test('e-mails say boarding needs full payment', () => {
  const d = { reference: 'MB-TEST01', customer_name: 'Ana', package_title: 'Sunset', start_date: '2026-12-12', end_date: '2026-12-12', adults: 2, children: 0,
    total: 3600, currency: 'MZN', status: 'confirmed', event: 'confirmed', state: 'unpaid', amount_due: 3600 };
  const pt = renderTemplate('booking_status', 'pt', d);
  assert.match(pt.html, /pagamento total/);
  assert.match(pt.text, /MZN 3,600/);
  assert.match(renderTemplate('booking_status', 'en', d).html, /full payment/);
  assert.doesNotMatch(renderTemplate('booking_status', 'pt', { ...d, state: 'boarding', amount_due: 0 }).html, /Não se dirija/);
  assert.match(renderTemplate('booking_received', 'pt', { ...d, status: 'pending' }).html, /bilhete/);
  assert.match(renderTemplate('booking_ticket', 'pt', { ...d, state: 'boarding' }).subject, /O seu bilhete/);
});

test('confirmation e-mail: the date is available, the booking is complete only once paid, and how to pay', async () => {
  await admin.put('/api/admin/settings/invoicing', { payment_instructions: 'M-Pesa 84 000 0000 (Maputo Blue)', payment_instructions_en: 'M-Pesa 84 000 0000 (Maputo Blue)' });
  const b = await book();
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'confirmed' })).status, 200);
  const { rows: [job] } = await ctx.pool.query(`select template, locale, data from mail_outbox where idempotency_key = $1`, [`booking:${b.id}:status:confirmed`]);
  assert.equal(job.data.state, 'unpaid');
  assert.equal(job.data.how_to_pay, 'M-Pesa 84 000 0000 (Maputo Blue)');
  const m = renderTemplate(job.template, job.locale, job.data);
  assert.match(m.subject, /A data está disponível — conclua a reserva com o pagamento/);
  assert.doesNotMatch(m.subject, /reserva está confirmada/);
  assert.match(m.html, /ainda não está concluída/);
  assert.match(m.html, /MZN 3,600/);
  assert.match(m.html, /M-Pesa 84 000 0000/);
  assert.match(m.html, /Não se dirija ainda ao ponto de partida/);
  assert.match(m.html, /Data disponível — a aguardar pagamento/);
  assert.match(m.text, /Como pagar/);
  const en = renderTemplate('booking_status', 'en', job.data);
  assert.match(en.subject, /Your date is available/);
  assert.match(en.html, /not complete yet/);

  // Already paid when confirmed: the booking is complete and the ticket goes with it
  const paid = renderTemplate('booking_status', 'pt', { ...job.data, state: 'boarding', amount_due: 0 });
  assert.match(paid.subject, /A sua reserva está concluída/);
  assert.match(paid.html, /bilhete com código QR/);
  assert.doesNotMatch(paid.html, /Como pagar/);
});
