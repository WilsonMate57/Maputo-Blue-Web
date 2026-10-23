// Quote requests with chosen packages/services → generated quotation →
// delivery channels → answer from the customer's account.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, idem, nextWeekday } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';
import { addDays, todayLocal } from '../src/lib/dates.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const tripDate = () => nextWeekday(3, 10);
const requestBody = (over = {}) => ({
  name: 'Carla Quote', email: 'carla@example.com', phone: '+258 84 555 0001', locale: 'pt', adults: 2, children: 1,
  date_from: tripDate(), date_to: addDays(tripDate(), 3), consent: true, idempotency_key: idem(),
  items: [
    { package_id: 'sunset-cruise-maputo-bay', date: tripDate(), notes: 'Aniversário' },
    { package_id: 'machangulo-transfer' },
    { service_key: 'boat-charter', notes: 'Dia inteiro' },
  ],
  ...over,
});

async function signedIn(email, name = 'Carla Quote', verify = true) {
  const c = client(ctx.app);
  const r = await c.post('/api/auth/register', { name, email, password: 'carla-password-1' });
  assert.equal(r.status, 201, r.raw);
  if (verify) await ctx.pool.query('update users set email_verified_at = now() where lower(email) = lower($1)', [email]);
  return c;
}

test('the request stores the chosen packages and services (titles snapshotted); unknown items are refused', async () => {
  const r = await client(ctx.app).post('/api/custom-requests', requestBody());
  assert.equal(r.status, 201, r.raw);
  const { rows: [row] } = await ctx.pool.query('select items, categories from custom_requests where reference = $1', [r.body.request.reference]);
  assert.equal(row.items.length, 3);
  assert.deepEqual(row.items.map(i => i.kind), ['package', 'package', 'service']);
  assert.equal(row.items[0].title, 'Sunset Cruise');
  assert.equal(row.items[0].date, tripDate());
  assert.equal(row.items[2].title, 'Aluguer de barco privado');
  assert.ok(row.categories.includes('beach-daytrips') && row.categories.includes('transfers'));

  const bad = await client(ctx.app).post('/api/custom-requests', requestBody({ items: [{ package_id: 'does-not-exist' }] }));
  assert.equal(bad.status, 400);
  const badSvc = await client(ctx.app).post('/api/custom-requests', requestBody({ items: [{ service_key: 'helicopter' }] }));
  assert.equal(badSvc.status, 400);
  const past = await client(ctx.app).post('/api/custom-requests', requestBody({ items: [{ package_id: 'sunset-cruise-maputo-bay', date: '2020-01-01' }] }));
  assert.equal(past.status, 400);
});

test('requests on behalf of a company keep the company, NUIT and address; invalid NUITs are refused', async () => {
  const body = requestBody({ email: 'compras@empresa.co.mz', billing: { company_name: '  Empresa Exemplo, Lda ', nuit: '400 123 456', address: 'Av. Julius Nyerere 100, Maputo' } });
  const r = await client(ctx.app).post('/api/custom-requests', body);
  assert.equal(r.status, 201, r.raw);
  const { rows: [row] } = await ctx.pool.query('select id, billing from custom_requests where reference = $1', [r.body.request.reference]);
  assert.deepEqual(row.billing, { company_name: 'Empresa Exemplo, Lda', nuit: '400123456', address: 'Av. Julius Nyerere 100, Maputo' });
  // Visible to the team (detail + search by company / NUIT)
  assert.equal((await admin.get(`/api/admin/requests/${row.id}`)).body.request.billing.company_name, 'Empresa Exemplo, Lda');
  assert.equal((await admin.get('/api/admin/requests?q=400123456')).body.items[0].company, 'Empresa Exemplo, Lda');
  // Confirmation e-mail lists the company
  const { rows: [mail] } = await ctx.pool.query(`select data from mail_outbox where to_email = 'compras@empresa.co.mz' and template = 'request_received'`);
  assert.equal(mail.data.billing.nuit, '400123456');
  // The quotation PDF is addressed to the company
  const q = await admin.post(`/api/admin/requests/${row.id}/quotes`, { items: [{ description: 'Evento', quantity: 1, unit_price: 50000 }], currency: 'MZN',
    valid_until: addDays(todayLocal(), 10), send: true, channels: ['link'] });
  const pdf = await ctx.app.inject({ method: 'GET', url: `/api/admin/quotes/${q.body.id}/pdf`, headers: { cookie: admin.cookie } });
  assert.equal(pdf.statusCode, 200);
  // Validation: company name required, NUIT must have 9 digits
  for (const billing of [{ nuit: '400123456' }, { company_name: 'X Lda', nuit: '12345' }, { company_name: 'X Lda', nuit: '4001234567' }, { company_name: 'X Lda', nuit: 'ABC123456' }]) {
    const bad = await client(ctx.app).post('/api/custom-requests', requestBody({ billing }));
    assert.equal(bad.status, 400, JSON.stringify(billing));
  }
  // Individuals: no billing stored
  const ind = await client(ctx.app).post('/api/custom-requests', requestBody());
  const { rows: [i2] } = await ctx.pool.query('select billing from custom_requests where reference = $1', [ind.body.request.reference]);
  assert.equal(i2.billing, null);
});

test('the team generates lines from the chosen items with current prices; services are priced by hand', async () => {
  const r = await client(ctx.app).post('/api/custom-requests', requestBody());
  const { rows: [req] } = await ctx.pool.query('select id from custom_requests where reference = $1', [r.body.request.reference]);
  const s = await admin.get(`/api/admin/requests/${req.id}/quote-suggestion`);
  assert.equal(s.status, 200, s.raw);
  assert.equal(s.body.currency, 'MZN');
  assert.equal(s.body.lines.length, 3);
  const [cruise, transfer, boat] = s.body.lines;
  // Same price the public booking quote gives for the same date and group
  const pub = await client(ctx.app).post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date: tripDate(), adults: 2, children: 1 });
  assert.equal(cruise.unit_price, pub.body.total);
  assert.match(cruise.description, /Sunset Cruise/);
  assert.ok(transfer.unit_price > 0);
  assert.equal(boat.unit_price, null);
  assert.ok(s.body.warnings.some(w => w.reason === 'service_manual_price'));
});

test('sending: channels recorded, WhatsApp link and shareable link returned, e-mail only when chosen', async () => {
  const r = await client(ctx.app).post('/api/custom-requests', requestBody({ email: 'wa-only@example.com' }));
  const { rows: [req] } = await ctx.pool.query('select id from custom_requests where reference = $1', [r.body.request.reference]);
  const before = (await ctx.pool.query(`select count(*)::int n from mail_outbox where to_email = 'wa-only@example.com' and template = 'quote_issued'`)).rows[0].n;
  const q = await admin.post(`/api/admin/requests/${req.id}/quotes`, {
    items: [{ description: 'Sunset Cruise', quantity: 1, unit_price: 5400 }, { description: 'Barco privado', quantity: 1, unit_price: 20000 }],
    currency: 'MZN', valid_until: addDays(todayLocal(), 14), send: true, channels: ['whatsapp', 'link'] });
  assert.equal(q.status, 201, q.raw);
  assert.equal(q.body.status, 'sent');
  assert.deepEqual(q.body.delivery.channels.sort(), ['link', 'whatsapp']);
  assert.match(q.body.delivery.quote_url, /\/pages\/quote\.html\?t=/);
  assert.match(q.body.delivery.whatsapp_url, /^https:\/\/wa\.me\/258845550001\?text=/);
  assert.ok(decodeURIComponent(q.body.delivery.whatsapp_url).includes(q.body.delivery.quote_url));
  const after = (await ctx.pool.query(`select count(*)::int n from mail_outbox where to_email = 'wa-only@example.com' and template = 'quote_issued'`)).rows[0].n;
  assert.equal(after, before, 'no e-mail when only WhatsApp/link were chosen');
  // The shared link works
  const token = decodeURIComponent(q.body.delivery.quote_url.split('t=')[1]);
  assert.equal((await client(ctx.app).get(`/api/quotes/${token}`)).body.total, 25400);
  const linkPdf = await ctx.app.inject({ method: 'GET', url: `/api/quotes/${encodeURIComponent(token)}/pdf` });
  assert.equal(linkPdf.statusCode, 200);
  assert.equal(linkPdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  const adminPdf = await ctx.app.inject({ method: 'GET', url: `/api/admin/quotes/${q.body.id}/pdf`, headers: { cookie: admin.cookie } });
  assert.equal(adminPdf.statusCode, 200);
  // Sharing again issues a new link and invalidates the old one; e-mail can be added
  const share = await admin.post(`/api/admin/quotes/${q.body.id}/share`, { channels: ['email'] });
  assert.equal(share.status, 200, share.raw);
  assert.equal((await client(ctx.app).get(`/api/quotes/${token}`)).status, 404, 'old link no longer works');
  await processOutbox(ctx.pool, ctx.transport, { limit: 500 });
  assert.ok(ctx.sent.some(m => m.to === 'wa-only@example.com' && /quote\.html\?t=/.test(m.text)));
  const det = await admin.get(`/api/admin/requests/${req.id}`);
  assert.deepEqual(det.body.quotes[0].channels.sort(), ['email', 'link', 'whatsapp']);
  // Drafts are sent later with the chosen channels; a channel is required
  const d = await admin.post(`/api/admin/requests/${req.id}/quotes`, { items: [{ description: 'X', quantity: 1, unit_price: 100 }], currency: 'MZN', valid_until: addDays(todayLocal(), 5) });
  assert.equal(d.body.status, 'draft');
  assert.equal((await admin.post(`/api/admin/quotes/${d.body.id}/send`, { channels: [] })).status, 400);
  const sent = await admin.post(`/api/admin/quotes/${d.body.id}/send`, { channels: ['link'] });
  assert.equal(sent.status, 200, sent.raw);
  // The newest sent quotation replaces the previous one
  const { rows } = await ctx.pool.query('select status from quotes where request_id = $1 order by created_at', [req.id]);
  assert.deepEqual(rows.map(x => x.status), ['withdrawn', 'sent']);
});

test('the customer sees and answers the quotation in the account; nobody else can', async () => {
  const carla = await signedIn('carla.acct@example.com');
  const r = await carla.post('/api/custom-requests', requestBody({ email: 'carla.acct@example.com' }));
  assert.equal(r.status, 201, r.raw);
  const { rows: [req] } = await ctx.pool.query('select id from custom_requests where reference = $1', [r.body.request.reference]);
  const det = await admin.get(`/api/admin/requests/${req.id}`);
  assert.equal(det.body.account.linked, true);
  const q = await admin.post(`/api/admin/requests/${req.id}/quotes`, {
    items: [{ description: 'Pacote completo', quantity: 1, unit_price: 30000 }], currency: 'MZN', valid_until: addDays(todayLocal(), 10),
    send: true, channels: ['link'] });

  const list = await carla.get('/api/account/requests');
  const mine = list.body.find(x => x.reference === r.body.request.reference);
  assert.equal(mine.quote.id, q.body.id);
  assert.equal(mine.quote.status, 'sent');
  assert.equal(mine.items.length, 3);
  const view = await carla.get(`/api/account/quotes/${q.body.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.total, 30000);
  // PDF from the account: real A4 PDF for the owner only
  const pdf = await ctx.app.inject({ method: 'GET', url: `/api/account/quotes/${q.body.id}/pdf`, headers: { cookie: carla.cookie } });
  assert.equal(pdf.statusCode, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.match(pdf.headers['content-disposition'], new RegExp(`cotacao-${r.body.request.reference}\.pdf`));
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.rawPayload.length > 5000, 'document with content');

  // Another customer (even signed in) cannot see or answer it
  const other = await signedIn('other.acct@example.com', 'Outro');
  assert.equal((await other.get(`/api/account/quotes/${q.body.id}`)).status, 404);
  assert.equal((await other.post(`/api/account/quotes/${q.body.id}/respond`, { decision: 'accept' })).status, 404);
  assert.equal((await other.get(`/api/account/quotes/${q.body.id}/pdf`)).status, 404);
  assert.equal((await client(ctx.app).get(`/api/account/quotes/${q.body.id}/pdf`)).status, 401);
  // An unverified account with the same e-mail as a guest request does not get access
  const guestReq = await client(ctx.app).post('/api/custom-requests', requestBody({ email: 'claimer@example.com' }));
  const { rows: [g] } = await ctx.pool.query('select id from custom_requests where reference = $1', [guestReq.body.request.reference]);
  const gq = await admin.post(`/api/admin/requests/${g.id}/quotes`, { items: [{ description: 'Y', quantity: 1, unit_price: 1 }], currency: 'MZN',
    valid_until: addDays(todayLocal(), 10), send: true, channels: ['link'] });
  const claimer = await signedIn('claimer@example.com', 'Claimer', false);
  assert.equal((await claimer.get(`/api/account/quotes/${gq.body.id}`)).status, 404);
  await ctx.pool.query(`update users set email_verified_at = now() where email = 'claimer@example.com'`);
  assert.equal((await claimer.get(`/api/account/quotes/${gq.body.id}`)).status, 200, 'visible once the e-mail is confirmed');

  const acc = await carla.post(`/api/account/quotes/${q.body.id}/respond`, { decision: 'accept' });
  assert.equal(acc.status, 200, acc.raw);
  assert.equal(acc.body.status, 'accepted');
  assert.equal((await carla.post(`/api/account/quotes/${q.body.id}/respond`, { decision: 'decline' })).status, 409);
  assert.equal((await admin.get(`/api/admin/requests/${req.id}`)).body.request.status, 'accepted');
});
