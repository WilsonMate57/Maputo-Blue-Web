// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/chat.js — The team's side of the live chat: conversations, replies,
// internal notes, hand-overs, links to bookings/quotations, quick replies and
// presence. Open to every staff level (see MANAGER_ROUTES in index.js).
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from '../../lib/audit.js';
import { STAFF_ROLES } from '../../lib/auth.js';
import { agentMessage, assignConversation, availability, chatRef, cleanBody, markAgentRead, postAgentMessage, setConversationStatus, touchAgent } from '../../lib/chat.js';
import { badRequest, notFound } from '../../lib/errors.js';

const STREAM_LIFETIME = 5 * 60_000;    // short, so a removed account loses the stream soon
const PAGE_SIZE = 40;
const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const params = { type: 'object', properties: { id: uuid } };
const FILTERS = {
  all: 'true', new: `c.status = 'new'`, unassigned: `c.assigned_to is null and c.status <> 'closed'`,
  active: `c.status = 'active'`, waiting: `c.status = 'waiting'`, closed: `c.status = 'closed'`,
};
const COLUMNS = `c.id, c.number, c.name, c.email, c.phone, c.subject, c.locale, c.status, c.assigned_to, a.name as assigned_name, c.unread_agent, c.unread_visitor,
  c.last_preview, c.last_sender, c.last_message_at, c.created_at, c.closed_at, c.started_offline, c.user_id, c.booking_id, c.quote_id, c.package_id,
  c.origin_path, c.current_path, c.current_title, c.visitor_read_id, c.visitor_seen_at`;
const row = c => ({ ...c, reference: chatRef(c), visitor_read_id: Number(c.visitor_read_id) });

export default async function chatAdminRoutes(app) {
  const { pool, chatBus: bus } = app;

  async function load(id) {
    const { rows: [c] } = await pool.query(`select ${COLUMNS} from chat_conversations c left join users a on a.id = c.assigned_to where c.id = $1`, [id]);
    if (!c) throw notFound('chat_not_found', 'Conversation not found');
    return row(c);
  }

  /** Linked records, plus what merely shares the e-mail: a hint for the team, never a link. */
  async function context(c) {
    const one = async (sql, id) => (id ? (await pool.query(sql, [id])).rows[0] || null : null);
    const [pkg, booking, quote, customer] = await Promise.all([
      one(`select id, content->>'title' as title from packages where id = $1`, c.package_id),
      one(`select id, reference, status, start_date, total, currency, price_snapshot->'package'->>'title' as package_title from bookings where id = $1`, c.booking_id),
      one(`select id, number, version, status, total, currency from quotes where id = $1`, c.quote_id),
      one(`select id, name, email, phone, country from users where id = $1`, c.user_id),
    ]);
    const [users, bookings, quotes] = await Promise.all([
      c.user_id ? { rows: [] } : pool.query(
        `select id, name, email from users where lower(email) = lower($1) and role = 'customer' and email_verified_at is not null`, [c.email]),
      pool.query(`select id, reference, status, start_date from bookings where lower(customer_email) = lower($1) and id is distinct from $2 order by created_at desc limit 5`, [c.email, c.booking_id]),
      pool.query(`select id, number, version, status from quotes where lower(customer->>'email') = lower($1) and id is distinct from $2 and status <> 'superseded' order by created_at desc limit 5`, [c.email, c.quote_id]),
    ]);
    return { package: pkg, booking, quote, customer, same_email: { customer: users.rows[0] || null, bookings: bookings.rows, quotes: quotes.rows } };
  }

  app.get('/chat/conversations', {
    schema: { querystring: { type: 'object', properties: { filter: { type: 'string', enum: Object.keys(FILTERS) }, q: { type: 'string', maxLength: 120 }, page: { type: 'string', pattern: '^\\d{1,5}$' } } } },
  }, async req => {
    const q = (req.query.q || '').trim().toLowerCase();
    const search = `($1 = '' or position($1 in lower(c.name || ' ' || c.email || ' ' || coalesce(c.phone, ''))) > 0 or 'chat-' || c.number = $1 or c.number::text = $1)`;
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [counts] }] = await Promise.all([
      pool.query(
        `select ${COLUMNS} from chat_conversations c left join users a on a.id = c.assigned_to
          where ${FILTERS[req.query.filter || 'all']} and ${search}
          order by (c.status = 'closed'), c.last_message_at desc limit ${PAGE_SIZE} offset $2`, [q, (page - 1) * PAGE_SIZE]),
      pool.query(
        `select count(*)::int as all, ${Object.entries(FILTERS).filter(([k]) => k !== 'all').map(([k, w]) => `count(*) filter (where ${w})::int as ${k === 'new' ? '"new"' : k}`).join(', ')}
           from chat_conversations c where ${search}`, [q]),
    ]);
    return { items: rows.map(row), counts, page, page_size: PAGE_SIZE };
  });

  app.get('/chat/conversations/:id', { schema: { params } }, async req => {
    const c = await load(req.params.id);
    const { rows } = await pool.query('select * from chat_messages where conversation_id = $1 order by id desc limit 500', [c.id]);
    return { conversation: c, messages: rows.reverse().map(agentMessage), context: await context(c) };
  });

  app.post('/chat/conversations/:id/messages', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: { params, body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 2000 }, client_id: uuid, note: { type: 'boolean' } } } },
  }, async req => {
    const body = cleanBody(req.body.body);
    if (!body) throw badRequest('message_required', 'Write a message');
    const m = await postAgentMessage(pool, bus, req.params.id, req.user, { body, clientId: req.body.client_id, note: !!req.body.note });
    return { message: agentMessage(m) };
  });

  app.post('/chat/conversations/:id/read', { schema: { params } }, async req => {
    await markAgentRead(pool, bus, req.params.id);
    return { ok: true };
  });

  app.post('/chat/conversations/:id/typing', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { params } }, async req => {
    await bus.publish({ t: 'typing', c: req.params.id, who: 'agent', name: req.user.name.split(/\s+/)[0], by: req.user.id });
    return { ok: true };
  });

  // Empty body = take it. user_id hands it over; null releases it.
  app.post('/chat/conversations/:id/assign', {
    schema: { params, body: { type: 'object', properties: { user_id: { type: ['string', 'null'], pattern: '^[0-9a-f-]{36}$' } } } },
  }, async req => {
    const handOver = req.body.user_id !== undefined;
    let target = req.user;
    if (handOver && req.body.user_id) {
      const { rows: [u] } = await pool.query(`select id, name from users where id = $1 and role = any($2) and disabled_at is null`, [req.body.user_id, STAFF_ROLES]);
      if (!u) throw badRequest('invalid_agent', 'Not a team member');
      target = u;
    } else if (handOver) target = null;
    const before = await assignConversation(pool, bus, req.params.id, target, { force: handOver });
    await audit(pool, req.user, 'chat', req.params.id, 'assigned', { before, after: target ? target.id : null });
    return load(req.params.id);
  });

  app.post('/chat/conversations/:id/status', {
    schema: { params, body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['new', 'active', 'waiting', 'closed'] } } } },
  }, async req => {
    await setConversationStatus(pool, bus, req.params.id, req.user, req.body.status);
    await audit(pool, req.user, 'chat', req.params.id, 'status', { status: req.body.status });
    return load(req.params.id);
  });

  // Links are set by hand: a reference, number or account chosen by the team
  app.patch('/chat/conversations/:id/links', {
    schema: { params, body: { type: 'object', properties: {
      booking_reference: { type: ['string', 'null'], maxLength: 20 }, quote_number: { type: ['string', 'null'], maxLength: 30 },
      package_id: { type: ['string', 'null'], maxLength: 90 }, user_id: { type: ['string', 'null'], pattern: '^[0-9a-f-]{36}$' } } } },
  }, async req => {
    const b = req.body, set = {};
    if (b.booking_reference !== undefined) {
      set.booking_id = null;
      if (b.booking_reference) {
        const { rows: [x] } = await pool.query('select id from bookings where reference = $1', [b.booking_reference.trim().toUpperCase()]);
        if (!x) throw notFound('booking_not_found', 'No booking with this reference');
        set.booking_id = x.id;
      }
    }
    if (b.quote_number !== undefined) {
      set.quote_id = null;
      if (b.quote_number) {
        const { rows: [x] } = await pool.query('select id from quotes where number = $1 order by version desc limit 1', [b.quote_number.trim().toUpperCase()]);
        if (!x) throw notFound('quote_not_found', 'No quotation with this number');
        set.quote_id = x.id;
      }
    }
    if (b.package_id !== undefined) {
      set.package_id = null;
      if (b.package_id) {
        const { rows: [x] } = await pool.query('select id from packages where id = $1', [b.package_id]);
        if (!x) throw notFound('package_not_found', 'Package not found');
        set.package_id = x.id;
      }
    }
    if (b.user_id !== undefined) {
      set.user_id = null;
      if (b.user_id) {
        const { rows: [x] } = await pool.query(`select id from users where id = $1 and role = 'customer'`, [b.user_id]);
        if (!x) throw notFound('customer_not_found', 'Customer not found');
        set.user_id = x.id;
      }
    }
    const keys = Object.keys(set);
    if (keys.length) {
      await pool.query(`update chat_conversations set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [req.params.id, ...keys.map(k => set[k])]);
      await audit(pool, req.user, 'chat', req.params.id, 'linked', set);
      await bus.publish({ t: 'state', c: req.params.id });
    }
    const c = await load(req.params.id);
    return { conversation: c, context: await context(c) };
  });

  /* ── Team presence ─────────────────────────────────────────────────────── */
  app.get('/chat/agents', async () => {
    const { rows } = await pool.query(
      `select u.id, u.name, case when a.last_seen_at > now() - interval '90 seconds' then a.status else 'offline' end as status
         from users u left join chat_agents a on a.user_id = u.id
        where u.role = any($1) and u.disabled_at is null order by u.name`, [STAFF_ROLES]);
    return { items: rows, availability: await availability(pool) };
  });

  // With a status: the person chose it. Without: the panel's heartbeat.
  app.post('/chat/presence', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', properties: { status: { type: 'string', enum: ['online', 'away', 'offline'] } } } },
  }, async req => touchAgent(pool, bus, req.user, req.body.status));

  /* ── Quick replies ─────────────────────────────────────────────────────── */
  const replyBody = { type: 'object', required: ['title', 'body'], properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 }, body: { type: 'string', minLength: 1, maxLength: 2000 }, body_en: { type: 'string', maxLength: 2000 } } };

  app.get('/chat/replies', async () => ({ items: (await pool.query('select id, title, body, body_en from chat_quick_replies order by sort_order, created_at')).rows }));

  app.post('/chat/replies', { schema: { body: replyBody } }, async req => {
    const { rows: [r] } = await pool.query(
      `insert into chat_quick_replies (title, body, body_en, sort_order) values ($1,$2,$3,(select coalesce(max(sort_order), 0) + 1 from chat_quick_replies)) returning id, title, body, body_en`,
      [req.body.title.trim(), req.body.body.trim(), (req.body.body_en || '').trim()]);
    return r;
  });

  app.patch('/chat/replies/:id', { schema: { params, body: replyBody } }, async req => {
    const { rows: [r] } = await pool.query(
      `update chat_quick_replies set title = $2, body = $3, body_en = $4 where id = $1 returning id, title, body, body_en`,
      [req.params.id, req.body.title.trim(), req.body.body.trim(), (req.body.body_en || '').trim()]);
    if (!r) throw notFound('not_found', 'Quick reply not found');
    return r;
  });

  app.delete('/chat/replies/:id', { schema: { params } }, async req => {
    await pool.query('delete from chat_quick_replies where id = $1', [req.params.id]);
    return { ok: true };
  });

  /* ── Live events for the panel ─────────────────────────────────────────── */
  app.get('/chat/stream', async (req, reply) => bus.stream(req, reply, {
    lifetime: STREAM_LIFETIME,
    start: async () => {},
    onEvent: async (evt, send) => {
      if (evt.t !== 'message') return send('chat', evt);
      const { rows: [m] } = await pool.query('select * from chat_messages where id = $1', [evt.id]);
      if (m) send('chat', { ...evt, message: agentMessage(m) });
    },
  }));
}
