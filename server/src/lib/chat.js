// ─────────────────────────────────────────────────────────────────────────────
// chat.js — Live chat rules: conversations, messages, availability, alerts and
// retention. Routes stay thin; everything a visitor or agent can do goes through
// here, so the rules (locks, read marks, duplicates) live in one place.
// ─────────────────────────────────────────────────────────────────────────────
import { tx } from '../db.js';
import { getSetting } from './catalog.js';
import { enqueueMail, notifyTeam } from './mailer.js';
import { STAFF_ROLES } from './auth.js';
import { AppError, conflict, notFound } from './errors.js';
import { randomToken, sha256 } from './security.js';

export const CHAT_COOKIE = 'mb_chat';
export const COOKIE_DAYS = 30;
export const SUBJECTS = ['bookings', 'packages', 'tours', 'transfers', 'accommodation', 'general', 'other'];
const SUBJECT_LABELS = { bookings: 'Reservas e disponibilidade', packages: 'Pacotes turísticos', tours: 'Excursões e actividades', transfers: 'Transfers', accommodation: 'Alojamento', general: 'Informações gerais', other: 'Outros assuntos' };
const PRESENCE_SECONDS = 90;      // the panel beats every 30 s; background tabs may be throttled
const RETURN_MINUTES = 30;        // a visitor writing after this long "came back"
const MAX_PER_MINUTE = 20;
const IDLE_CLOSE_DAYS = 30;

export const chatRef = c => `CHAT-${c.number}`;
const firstName = n => String(n || '').trim().split(/\s+/)[0] || null;
const preview = s => s.replace(/\s+/g, ' ').slice(0, 140);

/** Plain text only: control characters out, line breaks kept. It is never rendered as HTML. */
export function cleanBody(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{4,}/g, '\n\n\n').trim();
}

/** "/pages/package.html?id=x" → "x" (same under /en/). */
export function packageFromPath(path) {
  const m = /^(?:\/en|\/pages)\/package\.html\?id=([a-z0-9-]{1,80})$/.exec(path || '');
  return m ? m[1] : null;
}

/** Is `now` inside the service hours (Africa/Maputo)? */
export function withinHours(s, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Maputo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const time = `${parts.hour}:${parts.minute}`;
  return (s.days || []).includes(day) && time >= (s.open || '00:00') && time < (s.close || '24:00');
}

/** What visitors are told. Outside the service hours the team shows as offline. */
export async function availability(db, locale = 'pt') {
  const s = await getSetting(db, 'chat');
  const { rows: [a] } = await db.query(
    `select count(*) filter (where a.status = 'online')::int as online, count(*) filter (where a.status = 'away')::int as away
       from chat_agents a join users u on u.id = a.user_id
      where a.last_seen_at > now() - make_interval(secs => $1) and u.disabled_at is null and u.role = any($2)`,
    [PRESENCE_SECONDS, STAFF_ROLES]);
  const hours = withinHours(s);
  const status = !hours ? 'offline' : a.online ? 'online' : a.away ? 'away' : 'offline';
  return { enabled: s.enabled !== false, status, within_hours: hours,
    offline_message: (locale === 'en' ? s.offline_message_en : s.offline_message) || s.offline_message || '' };
}

export const publicMessage = m => ({ id: Number(m.id), kind: m.kind, author: m.kind === 'agent' ? firstName(m.author_name) : null, body: m.body, at: m.created_at, client_id: m.client_id });
export const agentMessage = m => ({ ...publicMessage(m), author: m.author_name, author_id: m.author_id });

export const publicConversation = c => ({ id: c.id, reference: chatRef(c), status: c.status, subject: c.subject, name: c.name,
  agent_read_id: Number(c.agent_read_id), unread: c.unread_visitor });

export async function visitorConversation(db, token) {
  if (!token || token.length > 100) return null;
  const { rows: [c] } = await db.query('select * from chat_conversations where token_hash = $1', [sha256(token)]);
  return c || null;
}

export async function visitorMessages(db, id, after = 0) {
  const { rows } = await db.query(
    `select * from chat_messages where conversation_id = $1 and id > $2 and kind <> 'note' order by id limit 300`, [id, after]);
  return rows.map(publicMessage);
}

async function insertMessage(db, c, { kind, body, author, clientId }) {
  const { rows: [m] } = await db.query(
    `insert into chat_messages (conversation_id, kind, author_id, author_name, body, client_id) values ($1,$2,$3,$4,$5,$6) returning *`,
    [c.id, kind, author ? author.id : null, author ? author.name : null, body, clientId || null]);
  return m;
}

const existing = async (db, c, clientId) => (await db.query('select * from chat_messages where conversation_id = $1 and client_id = $2', [c.id, clientId])).rows[0];

async function lock(db, id) {
  const { rows: [c] } = await db.query('select * from chat_conversations where id = $1 for update', [id]);
  if (!c) throw notFound('chat_not_found', 'Conversation not found');
  return c;
}

async function systemMessage(db, c, pt, en) {
  const body = c.locale === 'en' ? en : pt;
  const m = await insertMessage(db, c, { kind: 'system', body });
  await db.query(`update chat_conversations set unread_visitor = unread_visitor + 1, last_preview = $2, last_sender = 'system', last_message_at = now() where id = $1`, [c.id, preview(body)]);
  return m;
}

export function alertTeam(db, cfg, c, message) {
  return notifyTeam(db, { key: `chat-alert-${c.id}-${Date.now()}`, template: 'admin_chat', data: {
    reference: chatRef(c), name: c.name, email: c.email, phone: c.phone, subject: SUBJECT_LABELS[c.subject], message,
    admin_url: `${cfg.publicBaseUrl}/admin/#/chat/${c.id}` } });
}

/** A new conversation with the visitor's first message. Returns the secret token for the cookie. */
export async function startConversation(pool, bus, cfg, { name, email, phone, subject, body, locale, path, title, clientId, user }) {
  const token = randomToken(32);
  const avail = await availability(pool, locale);
  const pkg = packageFromPath(path);
  const conversation = await tx(pool, async db => {
    const known = pkg ? (await db.query('select id from packages where id = $1', [pkg])).rows[0] : null;
    // An account is linked only from its own verified session, never from a typed name or e-mail
    const owner = user && user.role === 'customer' && user.email_verified_at && user.email.toLowerCase() === email.toLowerCase() ? user.id : null;
    const { rows: [c] } = await db.query(
      `insert into chat_conversations (token_hash, name, email, phone, subject, locale, user_id, package_id, origin_path, current_path, current_title,
         started_offline, unread_agent, last_preview, last_sender, last_visitor_at, visitor_seen_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,1,$12,'visitor', now(), now()) returning *`,
      [sha256(token), name, email.toLowerCase(), phone || null, subject, locale, owner, known ? known.id : null, path || null, title || null, avail.status === 'offline', preview(body)]);
    await insertMessage(db, c, { kind: 'visitor', body, clientId });
    if (avail.status === 'offline' && avail.offline_message) await systemMessage(db, c, avail.offline_message, avail.offline_message);
    // The last word is the visitor's for the team: the automatic reply answers nothing
    await db.query(`update chat_conversations set last_sender = 'visitor', last_preview = $2, unread_visitor = 0 where id = $1`, [c.id, preview(body)]);
    if (avail.status !== 'online') {
      await alertTeam(db, cfg, c, body);
      await db.query('update chat_conversations set alerted_at = now() where id = $1', [c.id]);
    }
    return c;
  });
  await bus.publish({ t: 'new', c: conversation.id });
  return { token, conversation };
}

export async function postVisitorMessage(pool, bus, id, { body, clientId }) {
  const out = await tx(pool, async db => {
    const c = await lock(db, id);
    if (c.status === 'closed') throw conflict('chat_closed', 'This conversation has ended');
    if (clientId) { const dup = await existing(db, c, clientId); if (dup) return { message: dup, duplicate: true }; }
    const { rows: [{ n }] } = await db.query(
      `select count(*)::int n from chat_messages where conversation_id = $1 and kind = 'visitor' and created_at > now() - interval '1 minute'`, [id]);
    if (n >= MAX_PER_MINUTE) throw new AppError(429, 'rate_limited', 'Too many messages');
    const returned = !!c.last_visitor_at && Date.now() - new Date(c.last_visitor_at).getTime() > RETURN_MINUTES * 60_000;
    const message = await insertMessage(db, c, { kind: 'visitor', body, clientId });
    await db.query(
      `update chat_conversations set unread_agent = unread_agent + 1, last_message_at = now(), last_preview = $2, last_sender = 'visitor',
              last_visitor_at = now(), visitor_seen_at = now(), status = case when status = 'active' then 'waiting' else status end where id = $1`,
      [id, preview(body)]);
    return { message, returned };
  });
  if (!out.duplicate) await bus.publish({ t: 'message', c: id, id: Number(out.message.id), kind: 'visitor', returned: out.returned });
  return out.message;
}

export async function postAgentMessage(pool, bus, id, user, { body, clientId, note }) {
  const out = await tx(pool, async db => {
    const c = await lock(db, id);
    if (clientId) { const dup = await existing(db, c, clientId); if (dup) return { message: dup, duplicate: true }; }
    if (note) return { message: await insertMessage(db, c, { kind: 'note', body, author: user, clientId }) };
    if (c.status === 'closed') throw conflict('chat_closed', 'Reopen the conversation first');
    const message = await insertMessage(db, c, { kind: 'agent', body, author: user, clientId });
    await db.query(
      `update chat_conversations set unread_visitor = unread_visitor + 1, unread_agent = 0, agent_read_id = $3, last_message_at = now(), last_preview = $2,
              last_sender = 'agent', status = 'active', alerted_at = null, assigned_to = coalesce(assigned_to, $4) where id = $1`,
      [id, preview(body), message.id, user.id]);
    return { message };
  });
  if (!out.duplicate) await bus.publish({ t: 'message', c: id, id: Number(out.message.id), kind: out.message.kind });
  return out.message;
}

export async function markVisitorRead(pool, bus, c, lastId) {
  const { rowCount } = await pool.query(
    `update chat_conversations set visitor_read_id = greatest(visitor_read_id, $2), unread_visitor = 0, visitor_seen_at = now()
      where id = $1 and (unread_visitor > 0 or visitor_read_id < $2)`, [c.id, lastId]);
  if (rowCount) await bus.publish({ t: 'read', c: c.id, by: 'visitor' });
}

export async function markAgentRead(pool, bus, id) {
  const { rowCount } = await pool.query(
    `update chat_conversations c set unread_agent = 0,
            agent_read_id = greatest(agent_read_id, coalesce((select max(m.id) from chat_messages m where m.conversation_id = c.id and m.kind = 'visitor'), 0))
      where id = $1 and unread_agent > 0`, [id]);
  if (rowCount) await bus.publish({ t: 'read', c: id, by: 'agent' });
}

/** Take a free conversation; only `force` (an explicit hand-over) replaces someone else. */
export async function assignConversation(pool, bus, id, target, { force = false } = {}) {
  const out = await tx(pool, async db => {
    const c = await lock(db, id);
    if (c.status === 'closed') throw conflict('chat_closed', 'Reopen the conversation first');
    if (c.assigned_to && c.assigned_to !== target?.id && !force) {
      const { rows: [who] } = await db.query('select name from users where id = $1', [c.assigned_to]);
      throw conflict('chat_taken', 'Already taken', [who ? who.name : '']);
    }
    await db.query(`update chat_conversations set assigned_to = $2, status = case when status = 'new' and $2::uuid is not null then 'active' else status end where id = $1`, [id, target ? target.id : null]);
    const message = target && c.assigned_to !== target.id
      ? await systemMessage(db, c, `${firstName(target.name)} está a acompanhar esta conversa.`, `${firstName(target.name)} has joined the conversation.`) : null;
    return { message, before: c.assigned_to };
  });
  await bus.publish(out.message ? { t: 'message', c: id, id: Number(out.message.id), kind: 'system' } : { t: 'state', c: id });
  return out.before;
}

export async function setConversationStatus(pool, bus, id, actor, status) {
  const out = await tx(pool, async db => {
    const c = await lock(db, id);
    if (c.status === status) return {};
    const closing = status === 'closed', reopening = c.status === 'closed';
    await db.query(
      `update chat_conversations set status = $2, closed_at = case when $3 then now() end, closed_by = case when $3 then $4::uuid end where id = $1`,
      [id, status, closing, actor.id]);
    if (closing) return { message: await systemMessage(db, c, 'A conversa foi encerrada. Obrigado pelo contacto.', 'This conversation has ended. Thank you for getting in touch.') };
    if (reopening) return { message: await systemMessage(db, c, 'A conversa foi reaberta.', 'This conversation has been reopened.') };
    return {};
  });
  await bus.publish(out.message ? { t: 'message', c: id, id: Number(out.message.id), kind: 'system' } : { t: 'state', c: id });
}

/** Heartbeat (no status) or a manual change of state. */
export async function touchAgent(pool, bus, user, status) {
  const before = await availability(pool);
  const { rows: [a] } = await pool.query(
    `insert into chat_agents (user_id, status, last_seen_at) values ($1, coalesce($2, 'offline'), now())
     on conflict (user_id) do update set status = coalesce($2, chat_agents.status), last_seen_at = now(), updated_at = now() returning status`,
    [user.id, status || null]);
  const after = await availability(pool);
  if (before.status !== after.status) await bus.publish({ t: 'presence' });
  return { status: a.status, within_hours: after.within_hours };
}

/** Every minute: alerts about unanswered visitors, and e-mails for replies nobody read. */
export async function runChatAlerts(pool, cfg) {
  const s = await getSetting(pool, 'chat');
  await tx(pool, async db => {
    const { rows } = await db.query(
      `select * from chat_conversations
        where status in ('new','waiting') and last_sender = 'visitor' and alerted_at is null
          and last_message_at < now() - make_interval(mins => $1) for update skip locked`, [s.alert_minutes || 5]);
    for (const c of rows) {
      await alertTeam(db, cfg, c, c.last_preview);
      await db.query('update chat_conversations set alerted_at = now() where id = $1', [c.id]);
    }
  });
  await tx(pool, async db => {
    const { rows } = await db.query(
      `select * from chat_conversations
        where unread_visitor > 0 and last_message_at < now() - interval '2 minutes'
          and (visitor_seen_at is null or visitor_seen_at < now() - interval '2 minutes')
          and (mailed_at is null or mailed_at < last_message_at) for update skip locked`);
    for (const c of rows) {
      const { rows: msgs } = await db.query(
        `select author_name, body, id from chat_messages where conversation_id = $1 and kind = 'agent' and id > $2 order by id limit 20`, [c.id, c.visitor_read_id]);
      if (msgs.length) {
        await enqueueMail(db, { key: `chat-reply-${c.id}-${msgs.at(-1).id}`, to: [c.email], template: 'chat_reply', locale: c.locale, data: {
          reference: chatRef(c), name: c.name, messages: msgs.map(m => ({ author: firstName(m.author_name), body: m.body })), site_url: cfg.publicBaseUrl } });
      }
      await db.query('update chat_conversations set mailed_at = now() where id = $1', [c.id]);
    }
  });
}

/** Hourly: quiet conversations close, and closed ones go when the retention period ends. */
export async function purgeChats(pool) {
  const s = await getSetting(pool, 'chat');
  await pool.query(`update chat_conversations set status = 'closed', closed_at = now() where status <> 'closed' and last_message_at < now() - make_interval(days => $1)`, [IDLE_CLOSE_DAYS]);
  const { rowCount } = await pool.query(`delete from chat_conversations where status = 'closed' and closed_at < now() - make_interval(months => $1)`, [s.retention_months || 12]);
  return rowCount;
}
