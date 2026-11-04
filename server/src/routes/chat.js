// ─────────────────────────────────────────────────────────────────────────────
// routes/chat.js — The visitor's side of the live chat (assets/js/chat.js).
// No account needed: the HttpOnly cookie mb_chat opens one conversation and
// nothing else. Internal notes and team details never leave these routes.
// ─────────────────────────────────────────────────────────────────────────────
import { CHAT_COOKIE, COOKIE_DAYS, SUBJECTS, availability, cleanBody, markVisitorRead, packageFromPath, postVisitorMessage,
  publicConversation, startConversation, visitorConversation, visitorMessages } from '../lib/chat.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

const STREAM_LIFETIME = 30 * 60_000;
const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const email = { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' };
const phone = { type: 'string', minLength: 6, maxLength: 30, pattern: '^[+0-9 ()-]+$' };
const path = { type: 'string', maxLength: 200, pattern: '^/[A-Za-z0-9/_.~%-]*(\\?id=[a-z0-9-]{1,80})?$' };
const locale = { type: 'string', enum: ['pt', 'en'] };
const after = { type: 'object', properties: { after: { type: 'string', pattern: '^\\d{1,15}$' }, locale } };
const limit = max => ({ rateLimit: { max, timeWindow: '1 minute' } });

/** Text a person really wrote: not empty, and not a list of links. */
function messageBody(raw) {
  const body = cleanBody(raw);
  if (!body) throw badRequest('message_required', 'Write a message');
  if ((body.match(/https?:\/\/|www\./gi) || []).length > 3) throw badRequest('chat_spam', 'Too many links');
  return body;
}

export default async function chatRoutes(app) {
  const { pool, cfg, chatBus: bus } = app;
  const current = req => visitorConversation(pool, req.cookies[CHAT_COOKIE]);
  async function mine(req) {
    const c = await current(req);
    if (!c) throw notFound('chat_not_found', 'Conversation not found');
    return c;
  }

  // Everything the widget needs when a page opens. Sets no cookie.
  app.get('/chat/state', { config: limit(120), schema: { querystring: after } }, async req => {
    const c = await current(req);
    const avail = await availability(pool, c ? c.locale : req.query.locale || 'pt');
    const u = req.user;
    return { availability: avail, conversation: c ? publicConversation(c) : null, messages: c ? await visitorMessages(pool, c.id) : [],
      prefill: u ? { name: u.name, email: u.email, phone: u.phone } : null };
  });

  app.post('/chat/start', {
    config: { rateLimit: { max: 8, timeWindow: '10 minutes' } },
    schema: { body: { type: 'object', required: ['name', 'email', 'subject', 'body'], properties: {
      name: { type: 'string', minLength: 2, maxLength: 120 }, email, phone, subject: { type: 'string', enum: SUBJECTS },
      body: { type: 'string', minLength: 1, maxLength: 2000 }, locale, path, title: { type: 'string', maxLength: 150 },
      client_id: uuid, website: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const b = req.body;
    if (b.website) throw badRequest('rejected', 'Request rejected');     // honeypot
    const body = messageBody(b.body);
    const open = await current(req);
    if (open && open.status !== 'closed') {
      await postVisitorMessage(pool, bus, open.id, { body, clientId: b.client_id });
      return { conversation: publicConversation(await current(req)), messages: await visitorMessages(pool, open.id) };
    }
    const { token, conversation } = await startConversation(pool, bus, cfg, {
      name: b.name.trim(), email: b.email.trim(), phone: b.phone, subject: b.subject, body, locale: b.locale || 'pt',
      path: b.path, title: b.title, clientId: b.client_id, user: req.user });
    reply.setCookie(CHAT_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, maxAge: COOKIE_DAYS * 86400 });
    return { conversation: publicConversation(conversation), messages: await visitorMessages(pool, conversation.id) };
  });

  app.post('/chat/messages', {
    config: limit(40),
    schema: { body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 2000 }, client_id: uuid } } },
  }, async req => {
    const c = await mine(req);
    const m = await postVisitorMessage(pool, bus, c.id, { body: messageBody(req.body.body), clientId: req.body.client_id });
    return { message: (await visitorMessages(pool, c.id, Number(m.id) - 1))[0] };
  });

  // Used when the event stream is not available
  app.get('/chat/messages', { config: limit(40), schema: { querystring: after } }, async req => {
    const c = await mine(req);
    await pool.query('update chat_conversations set visitor_seen_at = now() where id = $1', [c.id]);
    return { conversation: publicConversation(c), messages: await visitorMessages(pool, c.id, Number(req.query.after || 0)), availability: await availability(pool, c.locale) };
  });

  app.post('/chat/read', { config: limit(60), schema: { body: { type: 'object', required: ['last_id'], properties: { last_id: { type: 'integer', minimum: 0 } } } } }, async req => {
    await markVisitorRead(pool, bus, await mine(req), req.body.last_id);
    return { ok: true };
  });

  app.post('/chat/typing', { config: limit(40) }, async req => {
    const c = await mine(req);
    if (c.status === 'closed') throw conflict('chat_closed', 'This conversation has ended');
    await bus.publish({ t: 'typing', c: c.id, who: 'visitor' });
    return { ok: true };
  });

  // The page the visitor is on right now, shown beside the conversation
  app.post('/chat/page', {
    config: limit(30),
    schema: { body: { type: 'object', required: ['path'], properties: { path, title: { type: 'string', maxLength: 150 } } } },
  }, async req => {
    const c = await mine(req);
    if (c.status === 'closed') return { ok: true };
    const pkg = packageFromPath(req.body.path);
    await pool.query(
      `update chat_conversations set current_path = $2, current_title = $3, visitor_seen_at = now(),
              package_id = coalesce((select id from packages where id = $4), package_id) where id = $1`,
      [c.id, req.body.path, req.body.title || null, pkg]);
    await bus.publish({ t: 'state', c: c.id });
    return { ok: true };
  });

  app.get('/chat/stream', { config: limit(60), schema: { querystring: after } }, async (req, reply) => {
    const c = await mine(req);
    const header = String(req.headers['last-event-id'] || '');
    let last = /^\d{1,15}$/.test(header) ? Number(header) : Number(req.query.after || 0);

    const flush = async send => {
      for (const m of await visitorMessages(pool, c.id, last)) { last = m.id; send('message', m, m.id); }
    };
    const state = async send => {
      const fresh = await visitorConversation(pool, req.cookies[CHAT_COOKIE]);
      if (fresh) send('state', publicConversation(fresh));
    };
    const seen = () => pool.query('update chat_conversations set visitor_seen_at = now() where id = $1', [c.id]);

    await seen();
    return bus.stream(req, reply, {
      lifetime: STREAM_LIFETIME,
      onPing: seen,
      start: async send => { await flush(send); await state(send); send('availability', await availability(pool, c.locale)); },
      onEvent: async (evt, send) => {
        if (evt.t === 'presence') return send('availability', await availability(pool, c.locale));
        if (evt.t === 'resync') { await flush(send); return state(send); }
        if (evt.c !== c.id) return;
        if (evt.t === 'message' && evt.kind !== 'note') { await flush(send); return state(send); }
        if (evt.t === 'typing' && evt.who === 'agent') return send('typing', { name: evt.name || null });
        if (evt.t === 'state' || (evt.t === 'read' && evt.by === 'agent')) return state(send);
      },
    });
  });
}
