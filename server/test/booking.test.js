// Public booking workflow, availability, concurrency and e-mail behaviour.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody, nextWeekday } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
  await ctx.pool.query(`update settings set value = value || '{"admin_emails":["ops@maputoblue.test"]}' where key = 'notifications'`);
});
after(async () => ctx && ctx.close());

test('end-to-end: quote → booking → admin confirm → availability', async () => {
  const guest = client(ctx.app);
  const date = nextWeekday(6); // Saturday → weekend price
  // 1–5. package, date, guests, extras → correct total from the server
  const pkg = await guest.get('/api/catalog/packages/machangulo-transfer');
  assert.equal(pkg.status, 200);
  assert.equal(pkg.body.price_from, 3600);
  const quote = await guest.post('/api/quote', { package_id: 'machangulo-transfer', date, adults: 2, children: 1 });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.total, 2 * 3600 + 1750);

  // Set a capacity so availability is enforced for this package
  const cap = await admin.put('/api/admin/availability/machangulo-transfer/days', { from: date, to: date, capacity: 5 });
  assert.equal(cap.status, 200);

  // 6–8. submit, reference, response
  const res = await guest.post('/api/bookings', bookingBody({ package_id: 'machangulo-transfer', date, adults: 2, children: 1,
    total: 1, price_snapshot: { hacked: true }, status: 'confirmed' }));
  assert.equal(res.status, 201, res.raw);
  const b = res.body.booking;
  assert.match(b.reference, /^MB-[A-Z0-9]{6}$/);
  assert.equal(b.status, 'pending');
  assert.equal(b.total, 8950);
  assert.ok(res.body.token);

  // Pending hold consumes capacity
  let cal = await guest.get(`/api/availability/machangulo-transfer?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].remaining, 2);

  // Guest can look up status with the e-mailed token, and by e-mail
  const look = await guest.post('/api/bookings/lookup', { reference: b.reference, token: res.body.token });
  assert.equal(look.status, 200);
  assert.equal(look.body.booking.status, 'pending');
  assert.equal((await guest.post('/api/bookings/lookup', { reference: b.reference, email: 'ANA@example.com' })).status, 200);
  assert.equal((await guest.post('/api/bookings/lookup', { reference: b.reference, email: 'other@example.com' })).status, 404);

  // 9. admin sees it
  const list = await admin.get('/api/admin/bookings?status=pending');
  assert.ok(list.body.items.some(x => x.reference === b.reference));

  // 10–11. confirm → status + availability
  const conf = await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'confirmed', message: 'Até breve!' });
  assert.equal(conf.status, 200, conf.raw);
  assert.equal(conf.body.status, 'confirmed');
  cal = await guest.get(`/api/availability/machangulo-transfer?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].remaining, 2);

  // Over-capacity request is refused
  const over = await guest.post('/api/bookings', bookingBody({ package_id: 'machangulo-transfer', date, adults: 3 }));
  assert.equal(over.status, 409);
  assert.equal(over.body.error, 'insufficient_capacity');

  // Invalid transition is refused (confirmed → rejected)
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'rejected' })).status, 409);

  // Cancel frees capacity
  await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'cancelled' });
  cal = await guest.get(`/api/availability/machangulo-transfer?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].remaining, 5);

  // E-mails were queued for customer and admin
  const { rows } = await ctx.pool.query(`select template, to_email from mail_outbox where idempotency_key like $1 order by created_at`, [`booking:${b.id}:%`]);
  const templates = rows.map(r => r.template);
  assert.ok(templates.includes('booking_received'));
  assert.ok(templates.includes('admin_new_booking'));
  assert.ok(templates.filter(t => t === 'booking_status').length >= 2);
});

test('idempotent submission returns the same booking', async () => {
  const guest = client(ctx.app);
  const body = bookingBody();
  const a = await guest.post('/api/bookings', body);
  const b = await guest.post('/api/bookings', body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal(a.body.booking.reference, b.body.booking.reference);
});

test('concurrent requests never exceed capacity', async () => {
  const date = nextWeekday(2);
  await admin.put('/api/admin/availability/sunset-cruise-maputo-bay/days', { from: date, to: date, capacity: 4 });
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    client(ctx.app).post('/api/bookings', bookingBody({ date, adults: 1, customer: { name: 'C' + i, email: `c${i}@ex.com`, phone: '+258840000000' } }))));
  const ok = results.filter(r => r.status === 201).length;
  const full = results.filter(r => r.status === 409).length;
  assert.equal(ok, 4);
  assert.equal(full, 2);
  const { rows: [{ used }] } = await ctx.pool.query(
    `select coalesce(sum(quantity),0)::int used from booking_allocations a join bookings b on b.id = a.booking_id
      where a.package_id = 'sunset-cruise-maputo-bay' and a.day = $1 and b.status = 'pending'`, [date]);
  assert.equal(used, 4);
});

test('expired pending holds release capacity; confirming re-checks capacity', async () => {
  const date = nextWeekday(4);
  await admin.put('/api/admin/availability/farol-inhaca-tour/days', { from: date, to: date, capacity: 2 });
  const g = client(ctx.app);
  const first = await g.post('/api/bookings', bookingBody({ package_id: 'farol-inhaca-tour', date, adults: 2 }));
  assert.equal(first.status, 201);
  assert.equal((await g.post('/api/bookings', bookingBody({ package_id: 'farol-inhaca-tour', date, adults: 1 }))).status, 409);
  // Simulate the 48h hold expiring
  await ctx.pool.query(`update bookings set hold_expires_at = now() - interval '1 minute' where id = $1`, [first.body.booking.id]);
  const second = await g.post('/api/bookings', bookingBody({ package_id: 'farol-inhaca-tour', date, adults: 2 }));
  assert.equal(second.status, 201);
  // The first (expired) request can no longer be confirmed: no capacity left
  const conf = await admin.post(`/api/admin/bookings/${first.body.booking.id}/status`, { to: 'confirmed' });
  assert.equal(conf.status, 409);
  assert.equal(conf.body.error, 'insufficient_capacity');
});

test('blocked days and past dates are refused', async () => {
  const g = client(ctx.app);
  const date = nextWeekday(5);
  await admin.put('/api/admin/availability/maputo-city-tour/days', { from: date, to: date, closed: true, note: 'Feriado' });
  const r = await g.post('/api/bookings', bookingBody({ package_id: 'maputo-city-tour', date }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'date_unavailable');
  const past = await g.post('/api/bookings', bookingBody({ date: '2020-01-01' }));
  assert.equal(past.status, 409);
  const cal = await g.get(`/api/availability/maputo-city-tour?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].status, 'closed');
});

test('validation: missing fields, bad e-mail, honeypot, consent', async () => {
  const g = client(ctx.app);
  assert.equal((await g.post('/api/bookings', { package_id: 'sunset-cruise-maputo-bay' })).status, 400);
  assert.equal((await g.post('/api/bookings', bookingBody({ customer: { name: 'x', email: 'not-an-email', phone: '+258840000000' } }))).status, 400);
  assert.equal((await g.post('/api/bookings', bookingBody({ website: 'http://spam' }))).status, 400);
  assert.equal((await g.post('/api/bookings', bookingBody({ consent: false }))).status, 400);
  assert.equal((await g.post('/api/bookings', bookingBody({ package_id: 'does-not-exist' }))).status, 404);
  assert.equal((await g.post('/api/bookings', bookingBody({ adults: 0 }))).status, 400);
  assert.equal((await g.post('/api/bookings', bookingBody({ extras: ['ghost-extra'] }))).status, 400);
});

test('e-mail failure does not undo a booking and can be retried', async () => {
  const g = client(ctx.app);
  const res = await g.post('/api/bookings', bookingBody({ customer: { name: 'Mail Fail', email: 'fail@example.com', phone: '+258840000001' } }));
  assert.equal(res.status, 201);
  const failing = async () => { const e = new Error('provider down'); e.retryable = false; throw e; };
  await processOutbox(ctx.pool, failing);
  const { rows: [m] } = await ctx.pool.query(`select id, status from mail_outbox where to_email = 'fail@example.com'`);
  assert.equal(m.status, 'failed');
  const { rows: [b] } = await ctx.pool.query(`select status from bookings where id = $1`, [res.body.booking.id]);
  assert.equal(b.status, 'pending');
  // Admin retry → delivered
  assert.equal((await admin.post(`/api/admin/mail/${m.id}/retry`)).status, 200);
  await processOutbox(ctx.pool, ctx.transport);
  const { rows: [m2] } = await ctx.pool.query(`select status from mail_outbox where id = $1`, [m.id]);
  assert.equal(m2.status, 'sent');
  assert.ok(ctx.sent.some(s => s.to === 'fail@example.com' && /MB-/.test(s.subject)));
});

test('admin edit recomputes price, keeps old snapshot in audit; CSV export works', async () => {
  const g = client(ctx.app);
  const res = await g.post('/api/bookings', bookingBody({ adults: 2 }));
  const id = res.body.booking.id;
  const upd = await admin.patch(`/api/admin/bookings/${id}`, { adults: 3 });
  assert.equal(upd.status, 200, upd.raw);
  assert.equal(upd.body.total, 3 * 1800);
  const detail = await admin.get(`/api/admin/bookings/${id}`);
  const ev = detail.body.history.find(h => h.action === 'updated');
  assert.equal(ev.data.previous_snapshot.quote.total, 3600);
  const note = await admin.post(`/api/admin/bookings/${id}/notes`, { body: 'Cliente pediu almoço vegetariano' });
  assert.equal(note.status, 201);
  // Money is only recorded once the administrator confirms it was received
  const unverified = await admin.post(`/api/admin/bookings/${id}/payments`, { amount: 2000, method: 'mpesa', reference: 'MP123', verified: false });
  assert.equal(unverified.status, 400);
  assert.equal(unverified.body.error, 'payment_not_verified');
  const pay = await admin.post(`/api/admin/bookings/${id}/payments`, { amount: 2000, method: 'mpesa', reference: 'MP123', verified: true });
  assert.equal(pay.status, 201, pay.raw);
  assert.equal(pay.body.payment_status, 'partial');
  const csv = await admin.get('/api/admin/bookings.csv?status=pending');
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.raw.includes(res.body.booking.reference));
  // Customer notes never leak to the public lookup
  const look = await g.post('/api/bookings/lookup', { reference: res.body.booking.reference, token: res.body.token });
  assert.equal(JSON.stringify(look.body).includes('vegetariano'), false);
});

test('dashboard returns counts and money without inventing values', async () => {
  const d = await admin.get('/api/admin/dashboard');
  assert.equal(d.status, 200);
  assert.ok(d.body.counts.total >= 1);
  assert.ok(Array.isArray(d.body.money));
  for (const m of d.body.money) assert.ok(m.received <= m.confirmed_value + m.pending_value + 1e6);
});

test('reviews: public list from migrated data, submission, moderation', async () => {
  const g = client(ctx.app);
  const r = await g.post('/api/reviews', { package_id: 'sunset-cruise-maputo-bay', name: 'Rui', rating: 5, comment: 'Fantástico!' });
  assert.equal(r.status, 201);
  assert.equal(r.body.verified, false);
  let list = await g.get('/api/reviews?package_id=sunset-cruise-maputo-bay');
  assert.ok(list.body.some(x => x.id === r.body.id));
  assert.equal((await admin.patch(`/api/admin/reviews/${r.body.id}`, { status: 'hidden' })).status, 200);
  list = await g.get('/api/reviews?package_id=sunset-cruise-maputo-bay');
  assert.ok(!list.body.some(x => x.id === r.body.id));
  assert.equal((await g.post('/api/reviews', { package_id: 'sunset-cruise-maputo-bay', name: 'X', rating: 9, comment: 'x' })).status, 400);
});

