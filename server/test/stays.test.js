// Multi-night stays: the customer chooses check-in and number of nights; every
// night is priced with its own rule and must have capacity.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody, nextWeekday } from './helpers.js';
import { addDays } from '../src/lib/dates.js';

let ctx, admin;
const PKG = 'manico-camp-inhaca'; // per person per night: adult 9950, child 7500
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const checkIn = () => nextWeekday(2, 20);
const stay = (over = {}) => bookingBody({ package_id: PKG, date: checkIn(), adults: 2, children: 1, ...over });

test('quote: price per person per night × nights, check-out date returned', async () => {
  const q = await client(ctx.app).post('/api/quote', { package_id: PKG, date: checkIn(), nights: 3, adults: 2, children: 1 });
  assert.equal(q.status, 200, q.raw);
  assert.equal(q.body.nights, 3);
  assert.equal(q.body.end_date, addDays(checkIn(), 3));
  assert.equal(q.body.total, 3 * (2 * 9950 + 7500));
  assert.match(q.body.lines[0].label, /× 3 noites/);
  // Without nights → the package minimum (1)
  const one = await client(ctx.app).post('/api/quote', { package_id: PKG, date: checkIn(), adults: 2 });
  assert.equal(one.body.nights, 1);
  assert.equal(one.body.total, 2 * 9950);
});

test('limits: below the minimum or above the maximum is refused; tours ignore nights', async () => {
  const zero = await client(ctx.app).post('/api/quote', { package_id: PKG, date: checkIn(), nights: 0, adults: 2 });
  assert.equal(zero.status, 400);
  const tooMany = await client(ctx.app).post('/api/quote', { package_id: PKG, date: checkIn(), nights: 31, adults: 2 });
  assert.equal(tooMany.status, 400);
  assert.deepEqual(tooMany.body.details, ['nights_range']);
  const tour = await client(ctx.app).post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date: checkIn(), nights: 3, adults: 2 });
  assert.equal(tour.status, 200);
  assert.equal(tour.body.total, 3600, 'tours are not multiplied by nights');
});

test('each night is priced with its own rule (season on part of the stay)', async () => {
  const start = addDays(checkIn(), 40);
  await ctx.pool.query(`insert into price_rules (package_id, label, date_from, date_to, adult, child, priority) values ($1, 'Época alta', $2, $3, 12000, 8000, 10)`,
    [PKG, addDays(start, 2), addDays(start, 10)]);
  const q = await client(ctx.app).post('/api/quote', { package_id: PKG, date: start, nights: 4, adults: 2 });
  assert.equal(q.status, 200, q.raw);
  // 2 nights at 9950 + 2 nights at 12000, for 2 adults
  assert.equal(q.body.total, 2 * (2 * 9950) + 2 * (2 * 12000));
  assert.equal(q.body.lines.filter(l => l.type === 'adult').length, 2);
});

test('booking: check-out stored, one allocation per night, every night must be available', async () => {
  const r = await client(ctx.app).post('/api/bookings', stay({ nights: 3 }));
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.booking.end_date, addDays(checkIn(), 3));
  assert.equal(r.body.booking.total, 3 * (2 * 9950 + 7500));
  const { rows } = await ctx.pool.query('select day from booking_allocations where booking_id = $1 order by day', [r.body.booking.id]);
  assert.deepEqual(rows.map(x => x.day), [checkIn(), addDays(checkIn(), 1), addDays(checkIn(), 2)]);

  // A night closed in the middle blocks the whole stay
  const start = addDays(checkIn(), 70);
  await ctx.pool.query(`insert into availability_days (package_id, resource_key, day, closed) values ($1, '*', $2, true)`, [PKG, addDays(start, 1)]);
  const blocked = await client(ctx.app).post('/api/bookings', stay({ date: start, nights: 3 }));
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'date_unavailable');
  assert.equal(blocked.body.details.day, addDays(start, 1));
  // …while a one-night stay before it is fine
  assert.equal((await client(ctx.app).post('/api/bookings', stay({ date: start, nights: 1 }))).status, 201);
});

test('admin can change the length of a stay; price and nights are recomputed', async () => {
  const r = await client(ctx.app).post('/api/bookings', stay({ date: addDays(checkIn(), 100), nights: 2, children: 0 }));
  const id = r.body.booking.id;
  const u = await admin.patch(`/api/admin/bookings/${id}`, { nights: 5, notify: false });
  assert.equal(u.status, 200, u.raw);
  assert.equal(u.body.end_date, addDays(addDays(checkIn(), 100), 5));
  assert.equal(u.body.total, 5 * 2 * 9950);
  const { rows: [{ n }] } = await ctx.pool.query('select count(*)::int n from booking_allocations where booking_id = $1', [id]);
  assert.equal(n, 5);
  // Confirming re-checks every night
  assert.equal((await admin.post(`/api/admin/bookings/${id}/status`, { to: 'confirmed', notify: false })).status, 200);
});
