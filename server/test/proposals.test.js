// Commercial proposals: builder data, money, documents, the customer's answers,
// versions, expiry and conversion to a booking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient } from './helpers.js';
import { addDays, todayLocal } from '../src/lib/dates.js';
import { computeQuoteTotals } from '../src/lib/quote-totals.js';
import { expireQuotes } from '../src/lib/quotes.js';
import { processOutbox } from '../src/lib/mailer.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const valid = addDays(todayLocal(), 10);
const futureDate = () => addDays(todayLocal(), 40);
const proposal = (over = {}) => ({
  locale: 'pt', currency: 'USD', valid_until: valid,
  customer: { name: 'Ana Silva', company: 'Oceano Lda', email: 'ana@oceano.example', phone: '+258840000001', country: 'Moçambique', client_type: 'company' },
  trip: { destination: 'Inhaca', date_from: addDays(todayLocal(), 30), date_to: addDays(todayLocal(), 33), adults: 4, children: 1 },
  items: [
    { kind: 'custom', description: 'Transporte privado especial', quantity: 2, unit_price: 150.5 },
    { kind: 'custom', description: 'Jantar na praia', details: 'Menu do dia', quantity: 5, unit_price: 40, participants: 5, discount: { kind: 'percent', value: 10 } },
  ],
  discount: { kind: 'fixed', value: 20 }, fees: [{ label: 'Taxa de conservação', amount: 15.25 }],
  inclusions: 'Guia', exclusions: 'Voos', payment_terms: 'Transferência bancária', deposit_percent: 30, payment_due: '7 dias antes', cancellation_terms: 'Sem reembolso após 48 h',
  itinerary: [{ title: 'Dia 1', description: 'Chegada' }], internal_notes: 'Margem apertada: não mostrar ao cliente',
  ...over,
});
const create = async over => {
  const r = await admin.post('/api/admin/quotations', proposal(over));
  assert.equal(r.status, 201, r.raw);
  return r.body;
};
const sendLink = async id => {
  const r = await admin.post(`/api/admin/quotations/${id}/send`, { channels: ['link'] });
  assert.equal(r.status, 200, r.raw);
  return decodeURIComponent(r.body.delivery.quote_url.split('t=')[1]);
};
const statusOf = async id => (await ctx.pool.query('select status from quotes where id = $1', [id])).rows[0].status;
const pub = t => `/api/quotes/${encodeURIComponent(t)}`;

test('totals are exact in cents: line discounts, global discount, fees', () => {
  const t = computeQuoteTotals({ items: [{ quantity: 3, unit_price: 0.1 }, { quantity: 1, unit_price: 1000, discount: { kind: 'percent', value: 12.5 } }],
    discount: { kind: 'percent', value: 10 }, fees: [{ label: 'Taxa', amount: 0.07 }] });
  assert.equal(t.subtotal, 1000.3);
  assert.equal(t.line_discount_total, 125);
  assert.equal(t.global_discount, 87.53);
  assert.equal(t.total, 787.84);
  const capped = computeQuoteTotals({ items: [{ quantity: 1, unit_price: 50, discount: { kind: 'fixed', value: 80 } }], discount: { kind: 'fixed', value: 10 } });
  assert.equal(capped.total, 0, 'a discount never makes a line negative');
});

test('new customer: number, computed totals, contact created; the amounts sent by the panel are ignored', async () => {
  const q = await create({ total: 1, subtotal: 1 });
  assert.match(q.number, /^COT-\d{4}-\d{4}$/);
  assert.equal(q.status, 'draft');
  // 301 + (200 − 20) − 20 + 15.25
  assert.equal(q.total, 476.25);
  const { rows: [c] } = await ctx.pool.query(`select * from contacts where email = 'ana@oceano.example'`);
  assert.equal(c.company, 'Oceano Lda');
  const found = await admin.get('/api/admin/contacts?q=oceano');
  assert.equal(found.body.items[0].source, 'contact');
  // Same e-mail again: the contact is reused
  await create();
  assert.equal((await ctx.pool.query(`select count(*)::int n from contacts where lower(email) = 'ana@oceano.example'`)).rows[0].n, 1);
});

test('existing customer: their account sees the proposal once the e-mail is confirmed', async () => {
  const c = client(ctx.app);
  await c.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Rui', email: 'rui@example.com', password: 'customer-pass-123' });
  await ctx.pool.query(`update users set email_verified_at = now() where email = 'rui@example.com'`);
  const found = await admin.get('/api/admin/contacts?q=rui@example');
  assert.equal(found.body.items[0].source, 'account');
  const q = await create({ customer: { name: 'Rui', email: 'rui@example.com', phone: '+258840000002' } });
  await sendLink(q.id);
  const list = await c.get('/api/account/proposals');
  assert.equal(list.body[0].quote.id, q.id);
  assert.equal((await c.get(`/api/account/quotes/${q.id}`)).body.total, 476.25);
  const other = client(ctx.app);
  await other.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Outro', email: 'outro@example.com', password: 'customer-pass-123' });
  assert.equal((await other.get(`/api/account/quotes/${q.id}`)).status, 404);
  assert.equal((await other.get('/api/account/proposals')).body.length, 0);
});

test('catalogue items are priced by the current rules; the price stays editable and the catalogue untouched', async () => {
  const b = await admin.get('/api/admin/quotations/builder');
  assert.ok(b.body.packages.length > 5);
  assert.ok(b.body.services.some(s => s.key === 'airport-transfer'));
  assert.equal(b.body.packages.some(p => p.id === 'proposta-personalizada'), false);
  const pkg = b.body.packages.find(p => p.kind === 'tour' && p.unit === 'per_person');
  const price = await admin.post('/api/admin/quotations/price', { package_id: pkg.id, date: futureDate(), adults: 2 });
  assert.equal(price.status, 200, price.raw);
  assert.ok(price.body.total > 0);
  const before = (await ctx.pool.query('select version from packages where id = $1', [pkg.id])).rows[0].version;
  const q = await create({ currency: price.body.currency, items: [
    { kind: 'package', package_id: pkg.id, description: pkg.title, date_from: futureDate(), quantity: 1, unit_price: price.body.total / 2 },
    { kind: 'custom', description: 'Experiência exclusiva', quantity: 1, unit_price: 100 }] });
  assert.equal(q.total, price.body.total / 2 + 100 - 20 + 15.25);
  assert.equal((await ctx.pool.query('select version from packages where id = $1', [pkg.id])).rows[0].version, before);
});

test('issuing needs a complete proposal, freezes it and archives the PDF, in PT and EN and in any currency', async () => {
  const draft = await create({ items: [{ kind: 'custom', description: 'Sem preço', quantity: 1, unit_price: null }], customer: { name: 'Só nome' } });
  const refused = await admin.post(`/api/admin/quotations/${draft.id}/issue`);
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body.details.sort(), ['customer_email', 'customer_phone', 'price_missing']);

  for (const [locale, currency, word] of [['pt', 'MZN', 'cotacao'], ['en', 'ZAR', 'cotacao']]) {
    const q = await create({ locale, currency });
    const preview = await ctx.app.inject({ method: 'GET', url: `/api/admin/quotations/${q.id}/pdf`, headers: { cookie: admin.cookie } });
    assert.equal(preview.statusCode, 200);
    assert.equal((await admin.post(`/api/admin/quotations/${q.id}/issue`)).status, 200);
    const pdf = await ctx.app.inject({ method: 'GET', url: `/api/admin/quotations/${q.id}/pdf`, headers: { cookie: admin.cookie } });
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.rawPayload.length > 8000);
    assert.match(pdf.headers['content-disposition'], new RegExp(word));
    const { rows: [doc] } = await ctx.pool.query('select pdf from quote_documents where quote_id = $1', [q.id]);
    assert.ok(doc.pdf.equals(pdf.rawPayload), 'the download is the archived document');
    const change = await admin.patch(`/api/admin/quotations/${q.id}`, proposal({ currency }));
    assert.equal(change.status, 409, 'issued proposals are not edited');
    assert.equal(change.body.error, 'quote_locked');
  }
});

test('sending: e-mail with the PDF attached, WhatsApp link, and a link that can be copied again', async () => {
  const q = await create();
  const r = await admin.post(`/api/admin/quotations/${q.id}/send`, { channels: ['email', 'whatsapp'] });
  assert.equal(r.status, 200, r.raw);
  assert.equal(await statusOf(q.id), 'sent');
  assert.match(r.body.delivery.whatsapp_url, /^https:\/\/wa\.me\/258840000001\?text=/);
  const d = await admin.get(`/api/admin/quotations/${q.id}`);
  assert.equal(d.body.link, r.body.delivery.quote_url);
  assert.equal(d.body.quote.public_token_hash, undefined);
  const { rows: [m] } = await ctx.pool.query(`select data from mail_outbox where template = 'quote_issued' and data->>'attach_quote' = $1`, [q.id]);
  assert.equal(m.data.internal_notes, undefined, 'internal notes never reach the e-mail');
  const { quoteAttachments } = await import('../src/lib/quote-pdf.js');
  await processOutbox(ctx.pool, ctx.transport, { limit: 500, attachments: quoteAttachments(ctx.pool, ctx.cfg) });
  const sent = ctx.sent.find(x => x.to === 'ana@oceano.example' && x.attachments?.length);
  assert.match(sent.attachments[0].filename, /^cotacao-COT-/);
});

test('public page: only customer data, and a link only opens its own proposal', async () => {
  const q = await create();
  const t = await sendLink(q.id);
  const r = await client(ctx.app).get(pub(t));
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 476.25);
  assert.equal(r.body.discount_total, 40);
  assert.equal(r.body.fees_total, 15.25);
  assert.doesNotMatch(r.raw, /Margem apertada|internal_notes|created_by|public_token|contact_id|user_id/);
  assert.equal(await statusOf(q.id), 'viewed');
  assert.equal((await client(ctx.app).get(pub(t.slice(0, -2) + 'xx'))).status, 404);
  assert.equal((await client(ctx.app).get(`/api/quotes/${q.id}`)).status, 404, 'the id is not a credential');
  // The team opening the link does not count as the customer viewing it
  const other = await create();
  const t2 = await sendLink(other.id);
  await admin.get(pub(t2));
  assert.equal(await statusOf(other.id), 'sent');
  // Drafts and cancelled proposals are not public
  await admin.post(`/api/admin/quotations/${other.id}/cancel`, { reason: 'Cliente desistiu' });
  assert.equal((await client(ctx.app).get(pub(t2))).status, 404);
});

test('answers: accept, decline with a reason, ask for changes; the team is told', async () => {
  await ctx.pool.query(`insert into settings (key, value) values ('notifications', '{"admin_emails": ["team@example.com"]}')
                        on conflict (key) do update set value = excluded.value`);
  const guest = client(ctx.app);
  const a = await create();
  const ta = await sendLink(a.id);
  const accepted = await guest.post(`${pub(ta)}/respond`, { decision: 'accept' });
  assert.equal(accepted.status, 200, accepted.raw);
  assert.equal(accepted.body.status, 'accepted');
  const { rows: [row] } = await ctx.pool.query('select responded_at from quotes where id = $1', [a.id]);
  assert.ok(row.responded_at, 'date and time are recorded');
  assert.equal((await ctx.pool.query('select count(*)::int n from bookings where quote_id = $1', [a.id])).rows[0].n, 0, 'accepting creates no booking');
  assert.equal((await guest.post(`${pub(ta)}/respond`, { decision: 'decline' })).status, 409);

  const b = await create();
  const tb = await sendLink(b.id);
  await guest.post(`${pub(tb)}/respond`, { decision: 'decline', message: 'Encontrámos outra data' });
  assert.equal(await statusOf(b.id), 'declined');

  const c = await create();
  const tc = await sendLink(c.id);
  assert.equal((await guest.post(`${pub(tc)}/respond`, { decision: 'revision' })).status, 400, 'a message is required');
  await guest.post(`${pub(tc)}/respond`, { decision: 'revision', message: 'Trocar o jantar por almoço' });
  assert.equal(await statusOf(c.id), 'revision_requested');
  const d = await admin.get(`/api/admin/quotations/${c.id}`);
  assert.equal(d.body.quote.response_message, 'Trocar o jantar por almoço');
  assert.ok(d.body.history.some(h => h.action === 'quote_revision_requested'));

  const { rows } = await ctx.pool.query(`select template from mail_outbox where to_email = 'team@example.com' and template like 'admin_quote%'`);
  for (const t of ['admin_quote_accepted', 'admin_quote_declined', 'admin_quote_revision']) assert.ok(rows.some(r => r.template === t), t);
  assert.ok((await admin.get('/api/admin/attention')).body.quote_actions >= 2);
});

test('versions: changes go to a new version, the old document stays, and even an accepted one is replaced openly', async () => {
  const q = await create();
  const t = await sendLink(q.id);
  await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' });
  const v = await admin.post(`/api/admin/quotations/${q.id}/version`);
  assert.equal(v.status, 200, v.raw);
  assert.equal(v.body.version, 2);
  assert.equal((await admin.post(`/api/admin/quotations/${q.id}/version`)).body.id, v.body.id, 'one open draft per proposal');
  assert.equal(await statusOf(q.id), 'accepted', 'still accepted until the new version is issued');
  assert.equal((await admin.patch(`/api/admin/quotations/${v.body.id}`, proposal({ discount: null }))).status, 200);
  assert.equal((await admin.post(`/api/admin/quotations/${v.body.id}/issue`)).status, 200);
  assert.equal(await statusOf(q.id), 'superseded');
  const d = await admin.get(`/api/admin/quotations/${v.body.id}`);
  assert.deepEqual(d.body.versions.map(x => x.version), [2, 1]);
  assert.equal(d.body.versions[0].total, 496.25);
  assert.equal(d.body.versions[1].total, 476.25, 'the old version keeps its values');
  assert.ok((await ctx.pool.query('select 1 from quote_documents where quote_id = $1', [q.id])).rowCount, 'the old document is kept');
  const old = await client(ctx.app).get(pub(t));
  assert.equal(old.body.status, 'superseded');
  assert.equal((await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' })).status, 409);
  const list = await admin.get('/api/admin/quotations?status=superseded,issued');
  assert.equal(list.body.items.some(x => x.id === q.id), false, 'the list shows the current version');
});

test('expiry: open proposals expire, answered ones do not, and an expired one can be duplicated', async () => {
  const open = await create();
  const t = await sendLink(open.id);
  const taken = await create();
  const t2 = await sendLink(taken.id);
  await client(ctx.app).post(`${pub(t2)}/respond`, { decision: 'accept' });
  await ctx.pool.query(`update quotes set valid_until = $2 where id = any($1)`, [[open.id, taken.id], addDays(todayLocal(), -1)]);
  assert.equal((await client(ctx.app).get(pub(t))).body.status, 'expired', 'already shown as expired before the job runs');
  assert.equal((await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' })).status, 409);
  assert.ok(await expireQuotes(ctx.pool) >= 1);
  assert.equal(await statusOf(open.id), 'expired');
  assert.equal(await statusOf(taken.id), 'accepted');
  const copy = await admin.post(`/api/admin/quotations/${open.id}/duplicate`);
  assert.equal(copy.status, 200, copy.raw);
  const d = await admin.get(`/api/admin/quotations/${copy.body.id}`);
  assert.equal(d.body.quote.status, 'draft');
  assert.notEqual(copy.body.number, (await admin.get(`/api/admin/quotations/${open.id}`)).body.quote.number);
  assert.ok(d.body.quote.valid_until >= todayLocal());
  assert.equal(await statusOf(open.id), 'expired', 'the original keeps its history');
});

test('conversion: checks availability, creates one confirmed booking, never twice; the invoice adds up', async () => {
  const pkg = (await admin.get('/api/admin/quotations/builder')).body.packages.find(p => p.kind === 'tour' && p.unit === 'per_person');
  const day = futureDate();
  await ctx.pool.query(`update packages set availability = availability || '{"default_capacity": 10}' where id = $1`, [pkg.id]);
  const items = [
    { kind: 'package', package_id: pkg.id, description: pkg.title, date_from: day, quantity: 1, unit_price: 300, adults: 3, children: 0 },
    { kind: 'package', package_id: pkg.id, description: `${pkg.title} (segundo grupo)`, date_from: day, quantity: 1, unit_price: 200, adults: 2, children: 0 },
    { kind: 'custom', description: 'Roteiro personalizado', quantity: 1, unit_price: 100, discount: { kind: 'fixed', value: 10 } },
  ];
  const q = await create({ items, currency: 'MZN' });
  assert.equal((await admin.post(`/api/admin/quotations/${q.id}/convert`)).status, 409, 'not accepted yet');
  const t = await sendLink(q.id);
  await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' });

  const preview = await admin.get(`/api/admin/quotations/${q.id}/conversion`);
  assert.equal(preview.status, 200, preview.raw);
  assert.equal(preview.body.can_convert, true);
  assert.deepEqual(preview.body.items.map(i => i.state), ['available', 'available', 'not_controlled']);

  const income = async () => (await ctx.pool.query(`select coalesce(sum(amount),0)::float s from payments`)).rows[0].s;
  const paidBefore = await income();
  const invoicesBefore = (await ctx.pool.query('select count(*)::int n from invoices')).rows[0].n;
  const r = await admin.post(`/api/admin/quotations/${q.id}/convert`, { notify: true });
  assert.equal(r.status, 201, r.raw);
  assert.equal(r.body.booking.status, 'confirmed');
  assert.equal(await statusOf(q.id), 'converted');
  assert.equal(await income(), paidBefore, 'no money is recorded');
  assert.equal((await ctx.pool.query('select count(*)::int n from invoices')).rows[0].n, invoicesBefore, 'no invoice is created by itself');
  const again = await admin.post(`/api/admin/quotations/${q.id}/convert`);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'quote_already_converted');
  assert.equal((await ctx.pool.query('select count(*)::int n from bookings where quote_id = $1', [q.id])).rows[0].n, 1);
  assert.equal((await admin.post(`/api/admin/quotations/${q.id}/version`)).status, 409, 'a converted proposal is closed');

  const { booking: b } = (await admin.get(`/api/admin/bookings/${r.body.booking.id}`)).body;
  // 600 − 10 line − 20 global + 15.25 fee
  assert.equal(b.total, 585.25);
  assert.equal(b.quote_id, q.id);
  assert.equal(b.quote_number, q.number);
  assert.equal(b.customer_name, 'Oceano Lda');
  // Both groups on the same day take capacity from the same package
  const { rows: alloc } = await ctx.pool.query('select package_id, quantity from booking_allocations where booking_id = $1', [b.id]);
  assert.deepEqual(alloc, [{ package_id: pkg.id, quantity: 5 }]);
  // Dates cannot be changed here, because the lines carry the capacity and price
  const edit = await admin.patch(`/api/admin/bookings/${b.id}`, { adults: 9 });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.error, 'booking_from_quote');

  const lookup = await admin.get(`/api/admin/invoices/lookup?reference=${b.reference}`);
  assert.equal(lookup.status, 200, lookup.raw);
  assert.equal(lookup.body.preview.total, 585.25);
  assert.equal(lookup.body.preview.lines.some(l => l.adjustment), false, 'the lines and discounts add up to the total');
  assert.equal(lookup.body.preview.lines.length, 4);
  const ticket = await ctx.app.inject({ method: 'GET', url: `/api/admin/bookings/${b.id}/ticket.pdf`, headers: { cookie: admin.cookie } });
  assert.equal(ticket.statusCode, 200);
  // Cancelling and confirming go through the normal lifecycle
  assert.equal((await admin.post(`/api/admin/bookings/${b.id}/status`, { to: 'cancelled' })).status, 200);
});

test('conversion stops when a service is full, and nothing is written', async () => {
  const pkg = (await admin.get('/api/admin/quotations/builder')).body.packages.find(p => p.kind === 'tour' && p.unit === 'per_person');
  await ctx.pool.query(`update packages set availability = availability || '{"default_capacity": 2}' where id = $1`, [pkg.id]);
  const q = await create({ items: [{ kind: 'package', package_id: pkg.id, description: pkg.title, date_from: futureDate(), quantity: 1, unit_price: 300, adults: 6 }] });
  const t = await sendLink(q.id);
  await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' });
  const preview = await admin.get(`/api/admin/quotations/${q.id}/conversion`);
  assert.equal(preview.body.can_convert, false);
  assert.equal(preview.body.items[0].state, 'unavailable');
  const r = await admin.post(`/api/admin/quotations/${q.id}/convert`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'quote_unavailable');
  assert.equal(await statusOf(q.id), 'accepted');
  assert.equal((await ctx.pool.query('select count(*)::int n from bookings where quote_id = $1', [q.id])).rows[0].n, 0);
  await ctx.pool.query(`update packages set availability = availability - 'default_capacity' where id = $1`, [pkg.id]);
});

test('indicators come from real rows, per currency, and proposals are not income', async () => {
  const before = (await admin.get('/api/admin/dashboard')).body;
  const s = await admin.get('/api/admin/quotations/stats');
  assert.equal(s.status, 200, s.raw);
  const { rows: [real] } = await ctx.pool.query(`select count(*)::int n, count(*) filter (where status = 'converted')::int c from quotes where status not in ('draft','superseded')`);
  assert.equal(s.body.issued, real.n);
  assert.equal(s.body.converted, real.c);
  assert.equal(s.body.conversion_rate, Math.round(real.c / real.n * 1000) / 10);
  assert.ok(s.body.money.length >= 2, 'no sum across currencies');
  const q = await create();
  const t = await sendLink(q.id);
  await client(ctx.app).post(`${pub(t)}/respond`, { decision: 'accept' });
  assert.deepEqual((await admin.get('/api/admin/dashboard')).body.money, before.money, 'an accepted proposal is not income');
});

test('a manager works with proposals; a customer does not', async () => {
  const c = client(ctx.app);
  await c.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Curioso', email: 'curioso@example.com', password: 'customer-pass-123' });
  assert.equal((await c.get('/api/admin/quotations')).status, 403);
  assert.equal((await client(ctx.app).get('/api/admin/quotations')).status, 401);
  await ctx.pool.query(`update users set role = 'manager' where email = 'curioso@example.com'`);
  assert.equal((await c.get('/api/admin/quotations')).status, 200);
  assert.equal((await c.get('/api/admin/quotations/stats')).status, 200);
  assert.equal((await c.post('/api/admin/quotations', proposal())).status, 201);
});
