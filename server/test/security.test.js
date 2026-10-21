// Authorization and abuse-prevention tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody } from './helpers.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

async function customer(email) {
  const c = client(ctx.app);
  const r = await c.post('/api/auth/register', { name: 'Cliente', email, password: 'customer-pass-123' });
  assert.equal(r.status, 201, r.raw);
  return c;
}

const ADMIN_ENDPOINTS = [
  ['GET', '/api/admin/dashboard'], ['GET', '/api/admin/bookings'], ['GET', '/api/admin/packages'],
  ['PUT', '/api/admin/packages/sunset-cruise-maputo-bay'], ['POST', '/api/admin/packages'],
  ['PUT', '/api/admin/availability/sunset-cruise-maputo-bay/days'], ['POST', '/api/admin/promotions'],
  ['POST', '/api/admin/media/upload'], ['DELETE', '/api/admin/media?path=assets/images/x.webp'],
  ['PUT', '/api/admin/settings/loyalty'], ['GET', '/api/admin/customers'],
];

test('1. unauthenticated visitors cannot reach any admin endpoint', async () => {
  const g = client(ctx.app);
  for (const [m, u] of ADMIN_ENDPOINTS) {
    const r = await g.raw(m, u, m === 'GET' || m === 'DELETE' ? undefined : {});
    assert.equal(r.status, 401, `${m} ${u} → ${r.status}`);
  }
});

test('2. a normal customer cannot use the admin dashboard', async () => {
  const c = await customer('normal@example.com');
  for (const [m, u] of ADMIN_ENDPOINTS) {
    const r = await c.raw(m, u, m === 'GET' || m === 'DELETE' ? undefined : {});
    assert.equal(r.status, 403, `${m} ${u} → ${r.status}`);
  }
  // Role cannot be set through registration or profile update
  const reg = await client(ctx.app).post('/api/auth/register', { name: 'Evil', email: 'evil@example.com', password: 'customer-pass-123', role: 'admin' });
  assert.equal(reg.body.user.role, 'customer');
  const prof = await c.patch('/api/account/profile', { role: 'admin', name: 'Still customer' });
  assert.equal(prof.body.user.role, 'customer');
  assert.equal((await c.get('/api/admin/dashboard')).status, 403);
});

test('3. a customer cannot read another customer\'s booking', async () => {
  const a = await customer('alice@example.com');
  const b = await customer('bob@example.com');
  const res = await a.post('/api/bookings', bookingBody({ customer: { name: 'Alice', email: 'alice@example.com', phone: '+258840000002' } }));
  assert.equal(res.status, 201);
  const id = res.body.booking.id;
  assert.equal((await a.get(`/api/account/bookings/${id}`)).status, 200);
  assert.equal((await b.get(`/api/account/bookings/${id}`)).status, 404);
  assert.equal((await b.post(`/api/account/bookings/${id}/cancel`, {})).status, 404);
  const bList = await b.get('/api/account/bookings');
  assert.equal(bList.body.length, 0);
  // Guest lookup with a wrong token / e-mail fails
  assert.equal((await client(ctx.app).post('/api/bookings/lookup', { reference: res.body.booking.reference, token: 'x'.repeat(32) })).status, 404);
});

test('4. the browser cannot set the authoritative price, discount or status', async () => {
  const g = client(ctx.app);
  const res = await g.post('/api/bookings', {
    ...bookingBody({ adults: 2 }),
    total: 1, subtotal: 1, discounts: [{ amount: 99999 }], unit_prices: { adult: 1 }, status: 'confirmed',
    payment_status: 'paid', price_snapshot: {}, lines: [],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.booking.total, 3600);
  assert.equal(res.body.booking.status, 'pending');
  assert.equal(res.body.booking.payment_status, 'unpaid');
  const q = await g.post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date: bookingBody().date, adults: 2, price: 1, total: 1 });
  assert.equal(q.body.total, 3600);
});

test('5. a customer cannot confirm their own booking', async () => {
  const c = await customer('self@example.com');
  const res = await c.post('/api/bookings', bookingBody({ customer: { name: 'Self', email: 'self@example.com', phone: '+258840000003' } }));
  const id = res.body.booking.id;
  assert.equal((await c.post(`/api/admin/bookings/${id}/status`, { to: 'confirmed' })).status, 403);
  // Account cancel on a pending booking cancels it — never confirms it
  const cancel = await c.post(`/api/account/bookings/${id}/cancel`, { reason: 'mudança de planos' });
  assert.equal(cancel.body.status, 'cancelled');
  const { rows: [b] } = await ctx.pool.query('select status from bookings where id = $1', [id]);
  assert.equal(b.status, 'cancelled');
});

test('6. unauthorized users cannot change pricing or availability', async () => {
  const c = await customer('pricing@example.com');
  const before = await client(ctx.app).get('/api/catalog/packages/sunset-cruise-maputo-bay');
  await c.put('/api/admin/packages/sunset-cruise-maputo-bay', { version: 1, pricing: { currency: 'MZN', unit: 'per_person', adult: 1 } });
  await c.post('/api/admin/packages/sunset-cruise-maputo-bay/rules', { label: 'x', adult: 1 });
  await c.put('/api/admin/availability/sunset-cruise-maputo-bay/days', { from: '2030-01-01', to: '2030-01-02', closed: true });
  const after = await client(ctx.app).get('/api/catalog/packages/sunset-cruise-maputo-bay');
  assert.equal(after.body.price_from, before.body.price_from);
  const { rows } = await ctx.pool.query(`select count(*)::int n from availability_days where day = '2030-01-01'`);
  assert.equal(rows[0].n, 0);
});

test('7. public users cannot upload, overwrite or delete images; admins cannot delete original assets', async () => {
  const g = client(ctx.app);
  const boundary = '----mb';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\ntours/test\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nnotanimage\r\n--${boundary}--\r\n`;
  const up = await g.raw('POST', '/api/admin/media/upload', body, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(up.status, 401);
  // Even admins cannot delete pre-existing site images (no media row = protected)
  const del = await admin.del('/api/admin/media?path=assets/images/tours/sea-activities/whale-watching-1.webp');
  assert.equal(del.status, 409);
  assert.equal(del.body.error, 'protected_file');
  // Path traversal is rejected
  assert.equal((await admin.del('/api/admin/media?path=assets/images/../../server/.env')).status, 400);
  assert.equal((await admin.get('/api/admin/media?folder=../../server')).status, 400);
});

test('CSRF: cross-origin state-changing requests and form posts are rejected', async () => {
  const g = client(ctx.app);
  const r = await g.post('/api/bookings', bookingBody(), { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const form = await g.raw('POST', '/api/auth/login', 'email=a&password=b', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const plain = await g.raw('POST', '/api/auth/login', '{"email":"a","password":"b"}', { 'content-type': 'text/plain' });
  assert.equal(plain.status, 415);
});

test('login: wrong password and unknown e-mail give the same answer; sessions end on logout', async () => {
  await customer('login@example.com');
  const c = client(ctx.app);
  const wrong = await c.post('/api/auth/login', { email: 'login@example.com', password: 'nope-nope-nope' });
  const unknown = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope-nope-nope' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  assert.equal((await c.post('/api/auth/login', { email: 'login@example.com', password: 'customer-pass-123' })).status, 200);
  assert.equal((await c.get('/api/account/bookings')).status, 200);
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/account/bookings')).status, 401);
  // Short passwords are refused
  assert.equal((await client(ctx.app).post('/api/auth/register', { name: 'Short', email: 'short@example.com', password: 'short' })).status, 400);
});

test('admin cannot demote themselves; disabling a user ends their sessions', async () => {
  const c = await customer('disable@example.com');
  const { rows: [me] } = await ctx.pool.query(`select id from users where email = 'admin@test.local'`);
  assert.equal((await admin.patch(`/api/admin/customers/${me.id}`, { role: 'customer' })).status, 400);
  const { rows: [u] } = await ctx.pool.query(`select id from users where email = 'disable@example.com'`);
  assert.equal((await admin.patch(`/api/admin/customers/${u.id}`, { disabled: true })).status, 200);
  assert.equal((await c.get('/api/account/bookings')).status, 401);
});

test('rate limiting is enforced on booking submissions', async () => {
  const limited = await setup({ rateLimit: true, importCatalog: false });
  try {
    const g = client(limited.app);
    let last;
    for (let i = 0; i < 9; i++) last = await g.post('/api/bookings', { package_id: 'x' });
    assert.equal(last.status, 429);
  } finally {
    await limited.close();
  }
});
