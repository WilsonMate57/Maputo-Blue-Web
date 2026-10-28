// WhatsApp team alerts (Meta Cloud API): queued with the team e-mails,
// delivered by the outbox worker, never blocking a booking.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client, adminClient, bookingBody } from './helpers.js';
import { alertParams, chatPhone, cloudApiTransport, normalizePhone, processWhatsAppOutbox } from '../src/lib/whatsapp.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const outbox = async () => (await ctx.pool.query('select * from whatsapp_outbox order by created_at')).rows;

test('phone numbers: international format only', () => {
  assert.equal(normalizePhone('+258 84 712 1666'), '258847121666');
  assert.equal(normalizePhone('(+258) 84-712-1666'), '258847121666');
  assert.equal(normalizePhone('84 712'), null);
  assert.equal(normalizePhone('abc'), null);
});

test('customer number for the chat button (free text typed by the customer)', () => {
  assert.equal(chatPhone('+258 84 123 4567'), '258841234567');
  assert.equal(chatPhone('00351 912 345 678'), '351912345678');
  assert.equal(chatPhone('84 123 4567'), '258841234567', 'Mozambican mobile without country code');
  assert.equal(chatPhone('258841234567'), '258841234567');
  assert.equal(chatPhone('021 123 456'), null, 'landline / unknown country → no button');
  assert.equal(chatPhone('912345678'), null);
  assert.equal(chatPhone(''), null);
});

test('template parameters: three, no line breaks, link last', () => {
  const p = alertParams('admin_new_request', { reference: 'TR-1', name: 'Ana\nSilva', phone: '+258 84', adults: 2, children: 0,
    items: [{ title: 'Inhaca' }, { title: 'Sunset    cruise' }], admin_url: 'https://x/admin/#/requests/1' });
  assert.equal(p.length, 3);
  assert.equal(p[0], 'Novo pedido de cotação TR-1');
  assert.ok(!/[\n\t]| {2,}/.test(p.join('')), p[1]);
  assert.match(p[1], /Inhaca, Sunset cruise · datas flexíveis · 2 adultos · Cliente: Ana · Silva, \+258 84/);
  assert.equal(p[2], 'https://x/admin/#/requests/1');
  assert.equal(alertParams('booking_received', {}), null, 'customer e-mails have no WhatsApp version');
});

test('admin: numbers validated and normalised; test message needs a number', async () => {
  assert.equal((await admin.post('/api/admin/whatsapp/test')).status, 400);
  const bad = await admin.put('/api/admin/settings/notifications', { admin_whatsapp: ['12'] });
  assert.equal(bad.status, 400);
  const ok = await admin.put('/api/admin/settings/notifications', { admin_whatsapp: ['+258 84 712 1666', '258847121666', '+351 912 345 678'] });
  assert.equal(ok.status, 200, ok.raw);
  assert.deepEqual(ok.body.admin_whatsapp, ['+258847121666', '+351912345678']);
  const s = await admin.get('/api/admin/settings');
  assert.equal(s.body.whatsapp_configured, false);
  const t = await admin.post('/api/admin/whatsapp/test');
  assert.equal(t.body.queued, 2);
});

test('a new booking queues one alert per team number, delivered by the worker', async () => {
  await ctx.pool.query('delete from whatsapp_outbox');
  const r = await client(ctx.app).post('/api/bookings', bookingBody());
  assert.equal(r.status, 201, r.raw);
  const rows = await outbox();
  assert.deepEqual(rows.map(x => x.to_phone).sort(), ['258847121666', '351912345678']);
  assert.equal(rows[0].template, 'admin_new_booking');
  assert.match(rows[0].params[0], new RegExp(`Nova reserva ${r.body.booking.reference}`));
  assert.match(rows[0].params[2], /\/admin\/#\/bookings\//);
  assert.ok(rows.every(x => x.chat_phone === '258840000000'), 'booking alerts carry the customer number');
  const t = await ctx.pool.query(`select chat_phone from whatsapp_outbox where template = 'test'`);
  assert.ok(t.rows.every(x => x.chat_phone === null));

  const calls = [];
  const stats = await processWhatsAppOutbox(ctx.pool, async msg => { calls.push(msg); return `wamid.${calls.length}`; });
  assert.deepEqual(stats, { sent: 2, failed: 0, retried: 0 });
  assert.ok((await outbox()).every(x => x.status === 'sent' && x.provider_id));
});

test('failures: temporary errors retry, permanent ones fail; booking unaffected', async () => {
  await ctx.pool.query('delete from whatsapp_outbox');
  const r = await client(ctx.app).post('/api/bookings', bookingBody());
  assert.equal(r.status, 201);
  let n = 0;
  const stats = await processWhatsAppOutbox(ctx.pool, async () => {
    n++;
    throw Object.assign(new Error(n === 1 ? 'rate limited' : 'template does not exist'), { retryable: n === 1 });
  });
  assert.deepEqual(stats, { sent: 0, failed: 1, retried: 1 });
  const rows = await outbox();
  assert.ok(rows.some(x => x.status === 'queued' && x.last_error === 'rate limited'));
  assert.ok(rows.some(x => x.status === 'failed'));
  const failed = rows.find(x => x.status === 'failed');
  assert.equal((await admin.post(`/api/admin/whatsapp/${failed.id}/retry`)).status, 200);
  assert.equal((await admin.get('/api/admin/whatsapp')).body.items.length, 2);
});

test('Cloud API request: template with body parameters; errors classified', async () => {
  const realFetch = globalThis.fetch;
  const wa = { token: 'T', phoneNumberId: '123', template: 'alerta_equipa', language: 'pt_PT', apiVersion: 'v23.0' };
  try {
    let req;
    globalThis.fetch = async (url, opts) => { req = { url, ...opts, body: JSON.parse(opts.body) }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }); };
    assert.equal(await cloudApiTransport(wa)({ to: '258847121666', params: ['a', 'b', 'c'] }), 'wamid.X');
    assert.equal(req.url, 'https://graph.facebook.com/v23.0/123/messages');
    assert.equal(req.headers.Authorization, 'Bearer T');
    assert.deepEqual(req.body.template, { name: 'alerta_equipa', language: { code: 'pt_PT' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }, { type: 'text', text: 'c' }] }] });

    // Booking alert with a customer number → chat template with the URL button
    const chat = cloudApiTransport({ ...wa, templateChat: 'alerta_reserva' });
    globalThis.fetch = async (url, opts) => { req = { body: JSON.parse(opts.body) }; return new Response(JSON.stringify({ messages: [{ id: 'wamid.Y' }] }), { status: 200 }); };
    await chat({ to: '258847121666', params: ['a', 'b', 'c'], chatPhone: '258841234567' });
    assert.equal(req.body.template.name, 'alerta_reserva');
    assert.deepEqual(req.body.template.components[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '258841234567' }] });
    // …no customer number, or no chat template configured → plain template, no button
    await chat({ to: '258847121666', params: ['a', 'b', 'c'], chatPhone: null });
    assert.equal(req.body.template.name, 'alerta_equipa');
    assert.equal(req.body.template.components.length, 1);
    await cloudApiTransport(wa)({ to: '258847121666', params: ['a', 'b', 'c'], chatPhone: '258841234567' });
    assert.equal(req.body.template.name, 'alerta_equipa');

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 132001, message: 'Template name does not exist' } }), { status: 400 });
    await assert.rejects(cloudApiTransport(wa)({ to: '1', params: [] }), e => e.retryable === false && /132001/.test(e.message));
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 130429, message: 'Rate limit hit' } }), { status: 400 });
    await assert.rejects(cloudApiTransport(wa)({ to: '1', params: [] }), e => e.retryable === true);
    await assert.rejects(cloudApiTransport({ ...wa, token: '' })({ to: '1', params: [] }), e => e.retryable === false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
