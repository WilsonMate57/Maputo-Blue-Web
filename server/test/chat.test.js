// Live chat: visitors, the team, isolation between conversations, real-time
// delivery, availability, alerts and retention.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup, client, adminClient, createAdmin } from './helpers.js';
import { cleanBody, packageFromPath, purgeChats, runChatAlerts, withinHours } from '../src/lib/chat.js';
import { hashPassword } from '../src/lib/security.js';

let ctx, admin, adminId;
const ALL_DAY = { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' };
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
  adminId = (await ctx.pool.query(`select id from users where email = 'admin@test.local'`)).rows[0].id;
  await admin.put('/api/admin/settings/chat', ALL_DAY);
  await admin.put('/api/admin/settings/notifications', { admin_emails: ['equipa@test.local'] });
});
after(async () => ctx && ctx.close());

/** A browser with its own chat cookie. */
function visitor() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await ctx.app.inject({ method, url, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      payload: body ? JSON.stringify(body) : undefined });
    const set = [res.headers['set-cookie']].flat().find(c => c && c.startsWith('mb_chat='));
    if (set) cookie = set.split(';')[0];
    let json;
    try { json = res.json(); } catch { json = undefined; }
    return { status: res.statusCode, body: json, headers: res.headers };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), get cookie() { return cookie; } };
}
const uuid = () => crypto.randomUUID();
const start = (v, over = {}) => v.post('/api/chat/start', { name: 'Ana Silva', email: 'ana@example.com', subject: 'bookings', body: 'Olá, têm vagas?', locale: 'pt', path: '/', ...over });
const online = () => admin.post('/api/admin/chat/presence', { status: 'online' });
const offline = () => admin.post('/api/admin/chat/presence', { status: 'offline' });

async function staffClient(email, role) {
  await ctx.pool.query(`insert into users (email, password_hash, name, role, email_verified_at) values ($1,$2,$3,$4, now())`, [email, await hashPassword('staff-password-1'), `Agente ${role}`, role]);
  const c = client(ctx.app);
  assert.equal((await c.post('/api/auth/login', { email, password: 'staff-password-1' })).status, 200);
  return c;
}

test('helpers: hours in Maputo, package pages, plain text', () => {
  const s = { days: [1], open: '07:00', close: '17:30' };
  assert.equal(withinHours(s, new Date('2026-11-02T06:00:00Z')), true);    // Monday 08:00 in Maputo
  assert.equal(withinHours(s, new Date('2026-11-02T16:00:00Z')), false);   // Monday 18:00
  assert.equal(withinHours(s, new Date('2026-11-03T06:00:00Z')), false);   // Tuesday
  assert.equal(packageFromPath('/pages/package.html?id=sunset-cruise'), 'sunset-cruise');
  assert.equal(packageFromPath('/en/package.html?id=sunset-cruise'), 'sunset-cruise');
  assert.equal(packageFromPath('/pages/tours.html'), null);
  assert.equal(cleanBody('  a\u0000b\r\nc  '), 'ab\nc');
});

test('visitor starts a conversation: no account, no cookie before that, token stored as a hash', async () => {
  await online();
  const v = visitor();
  const state = await v.get('/api/chat/state?locale=pt');
  assert.equal(state.status, 200);
  assert.equal(state.headers['set-cookie'], undefined, 'opening a page sets no cookie');
  assert.equal(state.body.availability.status, 'online');

  const r = await start(v, { path: '/pages/package.html?id=sunset-cruise-maputo-bay', title: 'Sunset' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(String(r.headers['set-cookie']), /HttpOnly/);
  const token = v.cookie.split('=')[1];
  const { rows: [row] } = await ctx.pool.query('select * from chat_conversations where id = $1', [r.body.conversation.id]);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.package_id, 'sunset-cruise-maputo-bay');

  const list = await admin.get('/api/admin/chat/conversations?filter=new');
  const item = list.body.items.find(c => c.id === r.body.conversation.id);
  assert.equal(item.unread_agent, 1);
  assert.equal(item.token_hash, undefined);
  const detail = await admin.get(`/api/admin/chat/conversations/${item.id}`);
  assert.equal(detail.body.context.package.id, 'sunset-cruise-maputo-bay');
  assert.ok(detail.body.context.package.title);
  assert.equal(JSON.stringify(detail.body).includes(row.token_hash), false);
});

test('reply, status changes, read marks and session recovery', async () => {
  await online();
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v);
  const reply = await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Temos sim.' });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));

  // A page reload brings everything back without asking for details
  let s = await v.get('/api/chat/state');
  assert.equal(s.body.conversation.status, 'active');
  assert.equal(s.body.conversation.unread, 1);
  assert.deepEqual(s.body.messages.map(m => m.kind), ['visitor', 'agent']);
  assert.equal(s.body.messages[1].author, 'Admin');
  assert.equal((await admin.get(`/api/admin/chat/conversations/${id}`)).body.conversation.assigned_to, adminId, 'answering takes the conversation');

  await v.post('/api/chat/read', { last_id: s.body.messages[1].id });
  s = await v.get('/api/chat/state');
  assert.equal(s.body.conversation.unread, 0);

  await v.post('/api/chat/messages', { body: 'Obrigada!' });
  let d = await admin.get(`/api/admin/chat/conversations/${id}`);
  assert.equal(d.body.conversation.status, 'waiting');
  assert.equal(d.body.conversation.unread_agent, 1);
  await admin.post(`/api/admin/chat/conversations/${id}/read`);
  d = await admin.get(`/api/admin/chat/conversations/${id}`);
  assert.equal(d.body.conversation.unread_agent, 0);
  s = await v.get('/api/chat/state');
  assert.equal(s.body.conversation.agent_read_id, s.body.messages.at(-1).id, 'visitor sees the message was read');
});

test('isolation: other visitors, notes, and the admin area', async () => {
  await online();
  const a = visitor(), b = visitor(), nobody = visitor();
  const { body: { conversation: ca } } = await start(a, { email: 'a@example.com', body: 'Segredo da Ana' });
  await start(b, { email: 'b@example.com', body: 'Mensagem do Bruno' });
  await admin.post(`/api/admin/chat/conversations/${ca.id}/messages`, { body: 'Cliente difícil', note: true });

  const seenByA = (await a.get('/api/chat/state')).body;
  assert.equal(JSON.stringify(seenByA).includes('Cliente difícil'), false, 'notes stay internal');
  const seenByB = (await b.get('/api/chat/state')).body;
  assert.equal(JSON.stringify(seenByB).includes('Segredo da Ana'), false);
  assert.equal((await b.get('/api/chat/messages?after=0')).body.messages.length, 1);

  assert.equal((await nobody.get('/api/chat/messages')).status, 404);
  assert.equal((await nobody.post('/api/chat/messages', { body: 'x' })).status, 404);
  assert.equal((await nobody.get('/api/chat/stream')).status, 404);
  assert.equal((await a.get(`/api/admin/chat/conversations/${ca.id}`)).status, 401);
  assert.equal((await a.post(`/api/admin/chat/conversations/${ca.id}/status`, { status: 'closed' })).status, 401);
  const forged = await ctx.app.inject({ method: 'GET', url: '/api/chat/messages', headers: { cookie: `mb_chat=${'x'.repeat(43)}` } });
  assert.equal(forged.statusCode, 404);

  const customer = client(ctx.app);
  await customer.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Cliente', email: 'cliente@example.com', password: 'customer-password-1', consent: true });
  assert.notEqual((await customer.get('/api/admin/chat/conversations')).status, 200);
});

test('a message sent twice is stored once', async () => {
  await online();
  const v = visitor();
  const first = uuid();
  const { body: { conversation: { id } } } = await start(v, { client_id: first });
  const again = await start(v, { client_id: first });
  assert.equal(again.body.conversation.id, id, 'no second conversation');
  const cid = uuid();
  const [x, y] = await Promise.all([v.post('/api/chat/messages', { body: 'Oi', client_id: cid }), v.post('/api/chat/messages', { body: 'Oi', client_id: cid })]);
  assert.equal(x.body.message.id, y.body.message.id);
  const aid = uuid();
  await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Olá', client_id: aid });
  await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Olá', client_id: aid });
  const { rows } = await ctx.pool.query('select kind from chat_messages where conversation_id = $1 order by id', [id]);
  assert.deepEqual(rows.map(r => r.kind), ['visitor', 'visitor', 'agent']);
});

test('closing and reopening; a closed conversation leaves room for a new one', async () => {
  await online();
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v);
  assert.equal((await admin.post(`/api/admin/chat/conversations/${id}/status`, { status: 'closed' })).body.status, 'closed');
  assert.equal((await v.post('/api/chat/messages', { body: 'ainda aí?' })).status, 409);
  assert.equal((await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'x' })).status, 409);
  assert.equal((await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'nota final', note: true })).status, 200);
  assert.equal((await v.get('/api/chat/state')).body.conversation.status, 'closed');

  assert.equal((await admin.post(`/api/admin/chat/conversations/${id}/status`, { status: 'active' })).body.status, 'active');
  assert.equal((await v.post('/api/chat/messages', { body: 'voltei' })).status, 200);
  await admin.post(`/api/admin/chat/conversations/${id}/status`, { status: 'closed' });
  const next = await start(v, { body: 'Nova dúvida' });
  assert.notEqual(next.body.conversation.id, id);
  assert.deepEqual(next.body.messages.map(m => m.body), ['Nova dúvida']);
});

test('two agents: one takes it, the other is told; hand-over is explicit', async () => {
  await online();
  const other = await staffClient('segundo@test.local', 'admin');
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v);
  const results = await Promise.all([admin.post(`/api/admin/chat/conversations/${id}/assign`, {}), other.post(`/api/admin/chat/conversations/${id}/assign`, {})]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(results.find(r => r.status === 409).body.error, 'chat_taken');

  const { body: { items } } = await admin.get('/api/admin/chat/agents');
  const second = items.find(a => a.name === 'Agente admin');
  const moved = await admin.post(`/api/admin/chat/conversations/${id}/assign`, { user_id: second.id });
  assert.equal(moved.body.assigned_to, second.id);
  assert.equal((await admin.post(`/api/admin/chat/conversations/${id}/assign`, { user_id: uuid() })).status, 400);
  const released = await admin.post(`/api/admin/chat/conversations/${id}/assign`, { user_id: null });
  assert.equal(released.body.assigned_to, null);
  const { rows } = await ctx.pool.query(`select count(*)::int n from audit_log where entity_type = 'chat' and entity_id = $1`, [id]);
  assert.ok(rows[0].n >= 2);
});

test('presence: a stale heartbeat or closed hours mean offline; the message is kept and the team alerted', async () => {
  await online();
  assert.equal((await visitor().get('/api/chat/state')).body.availability.status, 'online');

  await ctx.pool.query(`update chat_agents set last_seen_at = now() - interval '5 minutes'`);
  assert.equal((await visitor().get('/api/chat/state')).body.availability.status, 'offline', 'an old panel does not count as online');

  await admin.post('/api/admin/chat/presence', {});   // heartbeat keeps the chosen state
  assert.equal((await visitor().get('/api/chat/state')).body.availability.status, 'online');
  await admin.post('/api/admin/chat/presence', { status: 'away' });
  assert.equal((await visitor().get('/api/chat/state')).body.availability.status, 'away');

  await online();
  await admin.put('/api/admin/settings/chat', { days: [] });
  const closed = await visitor().get('/api/chat/state?locale=en');
  assert.equal(closed.body.availability.status, 'offline');
  assert.match(closed.body.availability.offline_message, /offline/);
  await admin.put('/api/admin/settings/chat', ALL_DAY);

  await offline();
  const v = visitor();
  const { body } = await start(v, { email: 'noite@example.com', body: 'Mensagem fora de horas' });
  assert.deepEqual(body.messages.map(m => m.kind), ['visitor', 'system']);
  const { rows: [c] } = await ctx.pool.query('select * from chat_conversations where id = $1', [body.conversation.id]);
  assert.equal(c.started_offline, true);
  assert.equal(c.status, 'new');
  assert.equal(c.last_sender, 'visitor');
  assert.ok(c.alerted_at);
  const { rows } = await ctx.pool.query(`select to_email from mail_outbox where template = 'admin_chat'`);
  assert.ok(rows.some(r => r.to_email === 'equipa@test.local'));
});

test('alerts: unanswered conversations once; replies nobody read go by e-mail', async () => {
  await online();
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v, { email: 'espera@example.com' });
  await ctx.pool.query('delete from mail_outbox');

  await runChatAlerts(ctx.pool, ctx.cfg);
  assert.equal((await ctx.pool.query('select * from mail_outbox')).rows.length, 0, 'too early');
  await ctx.pool.query(`update chat_conversations set last_message_at = now() - interval '6 minutes' where id = $1`, [id]);
  await runChatAlerts(ctx.pool, ctx.cfg);
  await runChatAlerts(ctx.pool, ctx.cfg);
  assert.equal((await ctx.pool.query(`select * from mail_outbox where template = 'admin_chat'`)).rows.length, 1, 'alerted once');

  await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Resposta para o e-mail' });
  await ctx.pool.query(`update chat_conversations set last_message_at = now() - interval '3 minutes', visitor_seen_at = now() - interval '3 minutes' where id = $1`, [id]);
  await runChatAlerts(ctx.pool, ctx.cfg);
  await runChatAlerts(ctx.pool, ctx.cfg);
  const { rows } = await ctx.pool.query(`select * from mail_outbox where template = 'chat_reply'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to_email, 'espera@example.com');
});

test('links are made by the team; the same e-mail is only a hint', async () => {
  await online();
  const owner = client(ctx.app);
  await owner.post('/api/auth/register', { phone: '+258 84 000 1111', country: 'Moçambique', name: 'Ana Conta', email: 'conta@example.com', password: 'customer-password-1', consent: true });
  await ctx.pool.query(`update users set email_verified_at = now() where email = 'conta@example.com'`);
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v, { name: 'Ana Conta', email: 'conta@example.com' });
  const d = await admin.get(`/api/admin/chat/conversations/${id}`);
  assert.equal(d.body.conversation.user_id, null, 'a typed e-mail links nothing');
  assert.equal(d.body.context.same_email.customer.email, 'conta@example.com');

  const linked = await admin.patch(`/api/admin/chat/conversations/${id}/links`, { user_id: d.body.context.same_email.customer.id, package_id: 'sunset-cruise-maputo-bay' });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.context.customer.email, 'conta@example.com');
  assert.ok(linked.body.context.package);
  assert.equal((await admin.patch(`/api/admin/chat/conversations/${id}/links`, { booking_reference: 'MB-NOPE' })).status, 404);
  assert.equal((await admin.patch(`/api/admin/chat/conversations/${id}/links`, { quote_number: 'COT-1999-0001' })).status, 404);
});

test('content: stored as text, spam refused, limits per conversation', async () => {
  await online();
  const v = visitor();
  const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const { body } = await start(v, { body: xss });
  assert.equal(body.messages[0].body, xss, 'kept verbatim; the page shows it as text');
  assert.equal((await visitor().post('/api/chat/start', { name: 'Bot', email: 'b@x.co', subject: 'other', body: 'hi', website: 'http://spam' })).status, 400);
  assert.equal((await v.post('/api/chat/messages', { body: 'http://a.co http://b.co http://c.co http://d.co' })).status, 400);
  assert.equal((await v.post('/api/chat/messages', { body: '   ' })).status, 400);
  assert.equal((await v.post('/api/chat/messages', { body: 'x'.repeat(2001) })).status, 400);
  let last;
  for (let i = 0; i < 21; i++) last = await v.post('/api/chat/messages', { body: `m${i}` });
  assert.equal(last.status, 429);
});

test('staff levels: managers work in the chat; settings stay with administrators', async () => {
  const m = await staffClient('gestor@test.local', 'manager');
  for (const url of ['/api/admin/chat/conversations', '/api/admin/chat/agents', '/api/admin/chat/replies', '/api/admin/attention']) assert.equal((await m.get(url)).status, 200, url);
  assert.equal((await m.post('/api/admin/chat/presence', { status: 'online' })).status, 200);
  assert.equal((await m.put('/api/admin/settings/chat', { open: '08:00' })).status, 403);
  assert.equal((await admin.put('/api/admin/settings/chat', { open: '18:00', close: '09:00' })).status, 400);

  const created = await m.post('/api/admin/chat/replies', { title: 'Teste', body: 'Olá', body_en: 'Hi' });
  assert.equal(created.status, 200);
  assert.equal((await m.patch(`/api/admin/chat/replies/${created.body.id}`, { title: 'Teste 2', body: 'Olá!' })).body.title, 'Teste 2');
  assert.equal((await m.del(`/api/admin/chat/replies/${created.body.id}`)).status, 200);
  await m.post('/api/admin/chat/presence', { status: 'offline' });
});

test('search and filters', async () => {
  await online();
  const v = visitor();
  const { body: { conversation: c } } = await start(v, { name: 'Zacarias Único', email: 'zacarias@example.com', phone: '+258 84 000 7777' });
  for (const q of ['zacarias', 'ZACARIAS@EXAMPLE', '000 7777', c.reference]) {
    const r = await admin.get(`/api/admin/chat/conversations?q=${encodeURIComponent(q)}`);
    assert.deepEqual(r.body.items.map(i => i.id), [c.id], q);
  }
  const counts = (await admin.get('/api/admin/chat/conversations')).body.counts;
  assert.ok(counts.all >= counts.new + counts.closed);
  assert.equal((await admin.get('/api/admin/attention')).body.chat_unread > 0, true);
});

test('retention: closed conversations go after the period; quiet ones close first', async () => {
  const v = visitor();
  const { body: { conversation: { id } } } = await start(v);
  await ctx.pool.query(`update chat_conversations set last_message_at = now() - interval '31 days' where id = $1`, [id]);
  await purgeChats(ctx.pool);
  assert.equal((await ctx.pool.query('select status from chat_conversations where id = $1', [id])).rows[0].status, 'closed');
  await ctx.pool.query(`update chat_conversations set closed_at = now() - interval '13 months' where id = $1`, [id]);
  await purgeChats(ctx.pool);
  assert.equal((await ctx.pool.query('select count(*)::int n from chat_conversations where id = $1', [id])).rows[0].n, 0);
  assert.equal((await ctx.pool.query('select count(*)::int n from chat_messages where conversation_id = $1', [id])).rows[0].n, 0);
});

/** Reads a real event stream until `until` matches. */
async function collect(url, headers, until) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  const res = await fetch(url, { headers, signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const out = { text: '', ready: null };
  out.ready = new Promise(resolve => { out.onReady = resolve; });
  out.done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out.text += dec.decode(value, { stream: true });
        if (out.text.includes('event: availability') || out.text.includes('event: ready')) out.onReady();
        if (until(out.text)) break;
      }
    } catch { /* aborted: the assertions below say what was missing */ }
    clearTimeout(timer);
    ac.abort();
    return out.text;
  })();
  return out;
}

test('real time: both sides receive events over a real connection, notes stay out, resuming skips nothing', async () => {
  await online();
  const base = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const v = visitor();
  const { body: { conversation: { id }, messages } } = await start(v);
  const firstId = messages[0].id;

  const vs = await collect(`${base}/api/chat/stream?after=${firstId}`, { cookie: v.cookie }, t => t.includes('Mensagem em directo'));
  const as = await collect(`${base}/api/admin/chat/stream`, { cookie: admin.cookie }, t => t.includes('Resposta do visitante'));
  await vs.ready;
  await as.ready;
  await new Promise(r => setTimeout(r, 300));   // the listener connection is up

  await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Nota secreta', note: true });
  await admin.post(`/api/admin/chat/conversations/${id}/typing`);
  await admin.post(`/api/admin/chat/conversations/${id}/messages`, { body: 'Mensagem em directo' });
  await v.post('/api/chat/messages', { body: 'Resposta do visitante' });

  const seen = await vs.done, team = await as.done;
  assert.match(seen, /Mensagem em directo/);
  assert.match(seen, /event: typing/);
  assert.equal(seen.includes('Nota secreta'), false, 'notes never reach the visitor');
  assert.match(team, /Nota secreta/);
  assert.match(team, /Resposta do visitante/);

  const { rows } = await ctx.pool.query(`select id from chat_messages where conversation_id = $1 and kind = 'agent'`, [id]);
  const resumed = await collect(`${base}/api/chat/stream`, { cookie: v.cookie, 'last-event-id': String(Number(rows[0].id) - 1) }, t => t.includes('event: availability'));
  const text = await resumed.done;
  assert.match(text, /Mensagem em directo/);
  assert.equal((text.match(/Mensagem em directo/g) || []).length, 1);

  assert.equal((await fetch(`${base}/api/admin/chat/stream`)).status, 401);
});
