// Staff levels: the super-administrator manages the team; managers only reach
// bookings, availability, packages, invoices and customers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient } from './helpers.js';
import { hashPassword } from '../src/lib/security.js';

let ctx, admin, owner;
before(async () => {
  ctx = await setup({ importCatalog: false });
  admin = await adminClient(ctx.app, ctx.pool);
  await ctx.pool.query(`insert into users (email, password_hash, name, role, email_verified_at) values ('owner@test.local',$1,'Owner','superadmin', now())`,
    [await hashPassword('owner-password-123')]);
  owner = client(ctx.app);
  assert.equal((await owner.post('/api/auth/login', { email: 'owner@test.local', password: 'owner-password-123' })).status, 200);
});
after(async () => ctx && ctx.close());

const inviteToken = async email => {
  const { rows: [m] } = await ctx.pool.query(
    `select data from mail_outbox where template = 'staff_invite' and to_email = $1 order by created_at desc limit 1`, [email]);
  return new URL(m.data.url).searchParams.get('invite');
};
const userId = async email => (await ctx.pool.query('select id from users where email = $1', [email])).rows[0].id;

test('only the super-administrator manages the team', async () => {
  assert.equal((await admin.get('/api/admin/team')).status, 403);
  assert.equal((await admin.post('/api/admin/team', { name: 'X', email: 'x@test.local', role: 'admin' })).status, 403);
  const r = await owner.get('/api/admin/team');
  assert.equal(r.status, 200, r.raw);
  assert.deepEqual(r.body.items.map(u => u.role), ['superadmin', 'admin']);
});

test('invited member chooses their own password, then signs in as manager', async () => {
  const r = await owner.post('/api/admin/team', { name: 'Gestora', email: 'Gestora@Test.local', role: 'manager' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.promoted, false);
  const team = (await owner.get('/api/admin/team')).body.items;
  assert.equal(team.find(u => u.email === 'gestora@test.local').invite_pending, true);
  assert.equal((await client(ctx.app).post('/api/auth/login', { email: 'gestora@test.local', password: '!invited' })).status, 401);

  const token = await inviteToken('gestora@test.local');
  assert.equal((await client(ctx.app).post('/api/auth/reset-password', { token, password: 'manager-password-1' })).status, 200);
  const m = client(ctx.app);
  const login = await m.post('/api/auth/login', { email: 'gestora@test.local', password: 'manager-password-1' });
  assert.equal(login.status, 200, login.raw);
  assert.equal(login.body.user.role, 'manager');
  assert.equal((await owner.post('/api/admin/team', { name: 'Again', email: 'gestora@test.local', role: 'admin' })).status, 409);

  // Allowed areas
  for (const url of ['/api/admin/attention', '/api/admin/bookings', '/api/admin/invoices', '/api/admin/packages', '/api/admin/customers', '/api/admin/media/folders', '/api/admin/requests', '/api/admin/quotations'])
    assert.equal((await m.get(url)).status, 200, url);
  // Everything else is refused
  for (const url of ['/api/admin/dashboard', '/api/admin/settings', '/api/admin/promotions', '/api/admin/reviews', '/api/admin/mail', '/api/admin/audit', '/api/admin/team', '/api/admin/whatsapp'])
    assert.equal((await m.get(url)).status, 403, url);
  const someone = await userId('admin@test.local');
  assert.equal((await m.patch(`/api/admin/customers/${someone}`, { disabled: true })).status, 403);
  assert.equal((await m.post(`/api/admin/customers/${someone}/loyalty-adjustments`, { delta: 1, reason: 'test' })).status, 403);
  assert.equal((await m.post(`/api/admin/customers/${someone}/notes`, { body: 'ok' })).status, 201);
  assert.equal((await m.del('/api/admin/media?path=x')).status, 403);
});

test('changing a level ends the sessions; the owner and self are protected', async () => {
  const m = client(ctx.app);
  await m.post('/api/auth/login', { email: 'gestora@test.local', password: 'manager-password-1' });
  const id = await userId('gestora@test.local');
  assert.equal((await owner.patch(`/api/admin/team/${id}`, { role: 'admin' })).status, 200);
  assert.equal((await m.get('/api/admin/bookings')).status, 401, 'signed out');
  assert.equal((await owner.patch(`/api/admin/team/${id}`, { disabled: true })).status, 200);
  assert.equal((await client(ctx.app).post('/api/auth/login', { email: 'gestora@test.local', password: 'manager-password-1' })).status, 401);
  assert.equal((await owner.post(`/api/admin/team/${id}/invite`)).status, 400, 'disabled: no invite');
  assert.equal((await owner.patch(`/api/admin/team/${id}`, { disabled: false, role: 'customer' })).status, 200);
  assert.equal((await owner.get('/api/admin/team')).body.items.some(u => u.id === id), false);

  const ownerId = await userId('owner@test.local');
  assert.equal((await owner.patch(`/api/admin/team/${ownerId}`, { role: 'admin' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/customers/${ownerId}`, { disabled: true })).status, 400, 'team accounts are not changed in Customers');
});

test('an existing customer is promoted and keeps their password', async () => {
  const c = client(ctx.app);
  await c.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Cliente', email: 'cliente@test.local', password: 'customer-pass-123' });
  const r = await owner.post('/api/admin/team', { name: 'Ignored', email: 'cliente@test.local', role: 'manager' });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.promoted, true);
  const again = client(ctx.app);
  const login = await again.post('/api/auth/login', { email: 'cliente@test.local', password: 'customer-pass-123' });
  assert.equal(login.body.user.role, 'manager');
});
