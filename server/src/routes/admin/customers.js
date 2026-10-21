// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/customers.js — Customer accounts, loyalty adjustments, roles,
// and review moderation.
// ─────────────────────────────────────────────────────────────────────────────
import { loyaltyStatus } from '../../lib/loyalty.js';
import { publicBooking } from '../../lib/bookings.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };

export default async function customerRoutes(app) {
  const { pool } = app;

  app.get('/customers', {
    schema: { querystring: { type: 'object', properties: { q: { type: 'string', maxLength: 100 }, page: { type: 'string', pattern: '^\\d{1,5}$' },
      role: { type: 'string', enum: ['customer', 'admin'] } } } },
  }, async req => {
    const params = [], where = [];
    if (req.query.q) { params.push(`%${req.query.q.replace(/[%_\\]/g, m => '\\' + m)}%`); where.push(`(u.email ilike $${params.length} or u.name ilike $${params.length} or u.phone ilike $${params.length})`); }
    if (req.query.role) { params.push(req.query.role); where.push(`u.role = $${params.length}`); }
    const sql = where.length ? 'where ' + where.join(' and ') : '';
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select u.id, u.email, u.name, u.phone, u.country, u.role, u.email_verified_at, u.disabled_at, u.created_at,
                         (select count(*)::int from bookings b where b.user_id = u.id) as bookings,
                         (select count(*)::int from bookings b where b.user_id = u.id and b.status = 'completed') as completed
                    from users u ${sql} order by u.created_at desc limit 25 offset ${(page - 1) * 25}`, params),
      pool.query(`select count(*)::int n from users u ${sql}`, params),
    ]);
    return { items: rows, total: n, page, page_size: 25 };
  });

  app.get('/customers/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    const { rows: [u] } = await pool.query(
      `select id, email, name, phone, country, locale, role, email_verified_at, disabled_at, created_at from users where id = $1`, [req.params.id]);
    if (!u) throw notFound('user_not_found');
    const [bookings, adjustments, notes, loyalty] = await Promise.all([
      pool.query('select * from bookings where user_id = $1 order by start_date desc limit 100', [u.id]),
      pool.query(`select a.*, c.name as created_by_name from loyalty_adjustments a left join users c on c.id = a.created_by
                   where a.user_id = $1 order by a.created_at desc`, [u.id]),
      pool.query(`select n.id, n.body, n.created_at, a.name as author from internal_notes n left join users a on a.id = n.author_id
                   where n.entity_type = 'user' and n.entity_id = $1 order by n.created_at desc`, [u.id]),
      loyaltyStatus(pool, u),
    ]);
    return { user: u, bookings: bookings.rows.map(publicBooking), adjustments: adjustments.rows, notes: notes.rows, loyalty };
  });

  app.post('/customers/:id/loyalty-adjustments', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['delta', 'reason'], properties: {
                delta: { type: 'integer', minimum: -100, maximum: 100 }, reason: { type: 'string', minLength: 3, maxLength: 500 } } } },
  }, async (req, reply) => {
    if (!req.body.delta) throw badRequest('invalid_delta');
    const { rowCount } = await pool.query('select 1 from users where id = $1', [req.params.id]);
    if (!rowCount) throw notFound('user_not_found');
    const { rows: [a] } = await pool.query(
      `insert into loyalty_adjustments (user_id, delta, reason, created_by) values ($1,$2,$3,$4) returning *`,
      [req.params.id, req.body.delta, req.body.reason, req.user.id]);
    await audit(pool, req.user, 'user', req.params.id, 'loyalty_adjusted', { delta: a.delta, reason: a.reason });
    reply.code(201);
    return a;
  });

  app.post('/customers/:id/notes', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 4000 } } } },
  }, async (req, reply) => {
    const { rowCount } = await pool.query('select 1 from users where id = $1', [req.params.id]);
    if (!rowCount) throw notFound('user_not_found');
    const { rows: [n] } = await pool.query(
      `insert into internal_notes (entity_type, entity_id, body, author_id) values ('user',$1,$2,$3) returning *`,
      [req.params.id, req.body.body, req.user.id]);
    reply.code(201);
    return n;
  });

  // Role / access changes (audited). An admin cannot demote or disable themselves.
  app.patch('/customers/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', properties: { role: { type: 'string', enum: ['customer', 'admin'] }, disabled: { type: 'boolean' } } } },
  }, async req => {
    if (req.params.id === req.user.id) throw badRequest('cannot_change_self', 'You cannot change your own role or access');
    const { rows: [old] } = await pool.query('select id, role, disabled_at from users where id = $1', [req.params.id]);
    if (!old) throw notFound('user_not_found');
    const role = req.body.role ?? old.role;
    const disabled = req.body.disabled === undefined ? old.disabled_at : (req.body.disabled ? new Date() : null);
    const { rows: [u] } = await pool.query(
      `update users set role=$2, disabled_at=$3, updated_at=now() where id=$1 returning id, email, name, role, disabled_at`, [old.id, role, disabled]);
    if (req.body.disabled || role !== old.role) await pool.query('delete from sessions where user_id = $1', [old.id]);
    await audit(pool, req.user, 'user', old.id, 'access_changed', { role_before: old.role, role_after: role, disabled: !!disabled });
    return u;
  });

  // ── Reviews moderation ─────────────────────────────────────────────────────
  app.get('/reviews', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', enum: ['published', 'hidden'] },
      package_id: { type: 'string', maxLength: 90 }, page: { type: 'string', pattern: '^\\d{1,5}$' } } } },
  }, async req => {
    const params = [], where = [];
    if (req.query.status) { params.push(req.query.status); where.push(`r.status = $${params.length}`); }
    if (req.query.package_id) { params.push(req.query.package_id); where.push(`r.package_id = $${params.length}`); }
    const sql = where.length ? 'where ' + where.join(' and ') : '';
    const page = Math.max(Number(req.query.page || 1), 1);
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select r.id, r.package_id, r.name, r.rating, r.comment, r.status, r.source, r.created_at, (r.booking_id is not null) as verified,
                         coalesce(p.content->>'title', p.content->>'name') as package_title
                    from reviews r left join packages p on p.id = r.package_id ${sql}
                   order by r.created_at desc limit 30 offset ${(page - 1) * 30}`, params),
      pool.query(`select count(*)::int n from reviews r ${sql}`, params),
    ]);
    return { items: rows, total: n, page, page_size: 30 };
  });

  app.patch('/reviews/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['published', 'hidden'] } } } },
  }, async req => {
    const { rows: [r] } = await pool.query('update reviews set status = $2 where id = $1 returning id, status', [req.params.id, req.body.status]);
    if (!r) throw notFound('review_not_found');
    await audit(pool, req.user, 'review', r.id, req.body.status === 'hidden' ? 'hidden' : 'published');
    return r;
  });
}
