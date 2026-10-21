// Customer accounts, history, loyalty and custom tour requests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody, idem } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

/** Pull the token out of the most recent e-mail of a template sent to someone. */
async function tokenFromMail(to, template, param) {
  await processOutbox(ctx.pool, ctx.transport);
  const msg = [...ctx.sent].reverse().find(m => m.to === to && m.text.includes(`${param}=`));
  assert.ok(msg, `no ${template} e-mail for ${to}`);
  return decodeURIComponent(msg.text.match(new RegExp(`${param}=([^\\s&]+)`))[1]);
}

test('1–3. register, verify, sign in/out, view own history (incl. earlier guest bookings)', async () => {
  // Guest booking made before the account existed
  const guest = await client(ctx.app).post('/api/bookings', bookingBody({ customer: { name: 'Maria', email: 'maria@example.com', phone: '+258840000010' } }));
  assert.equal(guest.status, 201);

  const c = client(ctx.app);
  const reg = await c.post('/api/auth/register', { name: 'Maria Silva', email: 'Maria@Example.com', password: 'maria-password-1', locale: 'pt' });
  assert.equal(reg.status, 201, reg.raw);
  assert.equal(reg.body.user.email_verified, false);
  assert.equal((await client(ctx.app).post('/api/auth/register', { name: 'Dup', email: 'maria@example.com', password: 'maria-password-1' })).status, 409);

  // Not linked until the e-mail is verified
  assert.equal((await c.get('/api/account/bookings')).body.length, 0);
  const token = await tokenFromMail('maria@example.com', 'verify_email', 'verify');
  const ver = await c.post('/api/auth/verify-email', { token });
  assert.equal(ver.status, 200, ver.raw);
  assert.equal(ver.body.linked_bookings, 1);
  assert.equal((await c.post('/api/auth/verify-email', { token })).status, 400); // single use

  // Booking while signed in is linked automatically
  const own = await c.post('/api/bookings', bookingBody({ customer: { name: 'Maria Silva', email: 'maria@example.com', phone: '+258840000010' } }));
  const hist = await c.get('/api/account/bookings');
  assert.equal(hist.body.length, 2);
  const one = await c.get(`/api/account/bookings/${own.body.booking.id}`);
  assert.equal(one.body.reference, own.body.booking.reference);

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).body.user, null);
  const login = await c.post('/api/auth/login', { email: 'maria@example.com', password: 'maria-password-1' });
  assert.equal(login.status, 200);
  assert.equal((await c.get('/api/account/bookings')).body.length, 2);
});

test('password reset flow (no account enumeration)', async () => {
  const g = client(ctx.app);
  assert.equal((await g.post('/api/auth/request-password-reset', { email: 'nobody@example.com' })).status, 200);
  assert.equal((await g.post('/api/auth/request-password-reset', { email: 'maria@example.com' })).status, 200);
  const token = await tokenFromMail('maria@example.com', 'reset_password', 'reset');
  assert.equal((await g.post('/api/auth/reset-password', { token, password: 'brand-new-password' })).status, 200);
  assert.equal((await g.post('/api/auth/login', { email: 'maria@example.com', password: 'maria-password-1' })).status, 401);
  assert.equal((await g.post('/api/auth/login', { email: 'maria@example.com', password: 'brand-new-password' })).status, 200);
});

test('profile update and cancellation request on a confirmed booking', async () => {
  const c = client(ctx.app);
  await c.post('/api/auth/login', { email: 'maria@example.com', password: 'brand-new-password' });
  const p = await c.patch('/api/account/profile', { phone: '+258 84 111 2222', locale: 'en' });
  assert.equal(p.body.user.locale, 'en');
  const [b] = (await c.get('/api/account/bookings')).body;
  await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'confirmed' });
  const req = await c.post(`/api/account/bookings/${b.id}/cancel`, { reason: 'Doença' });
  assert.equal(req.status, 200);
  assert.equal(req.body.status, 'confirmed');      // admin decides
  assert.equal(req.body.cancel_requested, true);
  const list = await admin.get('/api/admin/bookings?cancel_requested=1');
  assert.ok(list.body.items.some(x => x.id === b.id));
});

test('5. loyalty eligibility is computed from verified completed bookings', async () => {
  await admin.put('/api/admin/settings/loyalty', { enabled: true, min_completed_bookings: 2, kind: 'percent', value: 10, window_months: 24 });
  const c = client(ctx.app);
  await c.post('/api/auth/login', { email: 'maria@example.com', password: 'brand-new-password' });
  let s = await c.get('/api/account/loyalty');
  assert.equal(s.body.eligible, false);
  assert.equal(s.body.completed, 0);

  // Complete both of Maria's bookings
  const { rows } = await ctx.pool.query(`select id, status from bookings where lower(customer_email) = 'maria@example.com'`);
  for (const r of rows) {
    if (r.status === 'pending') await admin.post(`/api/admin/bookings/${r.id}/status`, { to: 'confirmed' });
    await admin.post(`/api/admin/bookings/${r.id}/status`, { to: 'completed' });
  }
  s = await c.get('/api/account/loyalty');
  assert.equal(s.body.completed, 2);
  assert.equal(s.body.eligible, true);
  const q = await c.post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date: bookingBody().date, adults: 2 });
  assert.equal(q.body.discount_total, 360);
  assert.equal(q.body.discounts[0].source, 'loyalty');

  // An unverified duplicate account with the same bookings' e-mail gets nothing
  const dup = client(ctx.app);
  await dup.post('/api/auth/register', { name: 'Maria 2', email: 'maria+2@example.com', password: 'maria-password-2' });
  assert.equal((await dup.get('/api/account/loyalty')).body.eligible, false);
  // A guest never gets the loyalty discount
  const gq = await client(ctx.app).post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date: bookingBody().date, adults: 2 });
  assert.equal(gq.body.discount_total, 0);

  // Manual adjustment (audited)
  const { rows: [u] } = await ctx.pool.query(`select id from users where email = 'maria@example.com'`);
  assert.equal((await admin.post(`/api/admin/customers/${u.id}/loyalty-adjustments`, { delta: -2, reason: 'Correcção' })).status, 201);
  assert.equal((await c.get('/api/account/loyalty')).body.eligible, false);
});

test('6. custom tour request → admin review → quotation → customer accepts', async () => {
  const g = client(ctx.app);
  const body = { name: 'João', email: 'joao@example.com', phone: '+258840000020', destination: 'Inhaca + Kruger',
    categories: ['safaris', 'island-daytrips'], date_from: '2026-12-01', date_to: '2026-12-07', adults: 4, children: 2,
    accommodation: 'Lodge 4*', transport: 'Transfer aeroporto', budget: 250000, budget_currency: 'MZN',
    special_requests: 'Aniversário', consent: true, idempotency_key: idem(), locale: 'pt' };
  const r = await g.post('/api/custom-requests', body);
  assert.equal(r.status, 201, r.raw);
  assert.match(r.body.request.reference, /^TR-/);
  assert.equal((await g.post('/api/custom-requests', body)).body.duplicate, true);

  const list = await admin.get('/api/admin/requests?status=new');
  const item = list.body.items.find(x => x.reference === r.body.request.reference);
  assert.ok(item);
  assert.equal((await admin.post(`/api/admin/requests/${item.id}/status`, { to: 'under_review' })).status, 200);
  await admin.post(`/api/admin/requests/${item.id}/notes`, { body: 'Verificar lodge com piscina' });
  const quote = await admin.post(`/api/admin/requests/${item.id}/quotes`, {
    items: [{ description: 'Safari Kruger', quantity: 6, unit_price: 13500 }, { description: 'Lodge 2 noites', quantity: 2, unit_price: 40000 }],
    currency: 'MZN', valid_until: '2026-11-30', inclusions: 'Transporte, guia', exclusions: 'Bebidas', send: true });
  assert.equal(quote.status, 201, quote.raw);
  assert.equal(quote.body.total, 161000);

  const token = await tokenFromMail('joao@example.com', 'quote_issued', 't');
  const view = await g.get(`/api/quotes/${token}`);
  assert.equal(view.body.total, 161000);
  assert.equal(view.body.status, 'sent');
  const acc = await g.post(`/api/quotes/${token}/respond`, { decision: 'accept' });
  assert.equal(acc.body.status, 'accepted');
  assert.equal((await g.post(`/api/quotes/${token}/respond`, { decision: 'decline' })).status, 409);
  const det = await admin.get(`/api/admin/requests/${item.id}`);
  assert.equal(det.body.request.status, 'accepted');
  assert.equal(det.body.notes.length, 1);
});
