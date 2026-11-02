// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/team.js — Staff accounts, managed only by the super-administrator.
// A new member gets an e-mail with a link to choose their own password: nobody
// else ever knows it. An existing customer account with that e-mail is promoted
// and keeps its password. The super-administrator account itself cannot be
// changed here (only with `npm run create-admin`).
// ─────────────────────────────────────────────────────────────────────────────
import { requireSuperadmin } from '../../lib/auth.js';
import { issueToken } from '../auth.js';
import { enqueueMail } from '../../lib/mailer.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { sha256 } from '../../lib/security.js';
import { tx } from '../../db.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const ROLE_LABELS = { manager: 'Gestor', admin: 'Administrador' };
// Accounts created here have no usable password until the invitation is used.
const NO_PASSWORD = '!invited';
const INVITE_HOURS = 72;

export default async function teamRoutes(app) {
  const { pool, cfg } = app;
  app.addHook('onRequest', requireSuperadmin);

  async function sendInvite(c, u) {
    const t = await issueToken(c, u.id, 'reset_password', INVITE_HOURS);
    await enqueueMail(c, { key: `invite:${sha256(t)}`, to: u.email, template: 'staff_invite', locale: 'pt', data: {
      name: u.name, role_label: ROLE_LABELS[u.role], admin_url: `${cfg.publicBaseUrl}/admin/`,
      url: `${cfg.publicBaseUrl}/admin/?invite=${encodeURIComponent(t)}` } });
  }

  app.get('/team', async () => {
    const { rows } = await pool.query(
      `select u.id, u.email, u.name, u.role, u.disabled_at, u.created_at, u.password_hash = $1 as invite_pending,
              (select max(s.created_at) from sessions s where s.user_id = u.id) as last_sign_in
         from users u where u.role <> 'customer'
        order by array_position(array['superadmin','admin','manager'], u.role), lower(u.name)`, [NO_PASSWORD]);
    return { items: rows };
  });

  app.post('/team', {
    schema: { body: { type: 'object', required: ['email', 'name', 'role'], properties: {
      email: { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' },
      name: { type: 'string', minLength: 2, maxLength: 120 },
      role: { type: 'string', enum: ['manager', 'admin'] } } } },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const name = req.body.name.trim();
    const result = await tx(pool, async c => {
      const { rows: [old] } = await c.query('select id, role from users where lower(email) = $1 for update', [email]);
      if (old && old.role !== 'customer') throw conflict('already_staff', 'This e-mail already belongs to a team member');
      if (old) {
        const { rows: [u] } = await c.query(
          `update users set role = $2, disabled_at = null, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
            where id = $1 returning id, email, name, role`, [old.id, req.body.role]);
        await c.query('delete from sessions where user_id = $1', [u.id]);
        await audit(c, req.user, 'user', u.id, 'access_changed', { role_before: 'customer', role_after: u.role });
        return { user: u, promoted: true };
      }
      const { rows: [u] } = await c.query(
        `insert into users (email, password_hash, name, role, email_verified_at) values ($1,$2,$3,$4, now())
         returning id, email, name, role`, [email, NO_PASSWORD, name, req.body.role]);
      await sendInvite(c, u);
      await audit(c, req.user, 'user', u.id, 'staff_invited', { role: u.role });
      return { user: u, promoted: false };
    });
    reply.code(201);
    return result;
  });

  app.patch('/team/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } },
              body: { type: 'object', properties: { role: { type: 'string', enum: ['manager', 'admin', 'customer'] }, disabled: { type: 'boolean' } } } },
  }, async req => {
    if (req.params.id === req.user.id) throw badRequest('cannot_change_self', 'You cannot change your own role or access');
    return tx(pool, async c => {
      const { rows: [old] } = await c.query('select id, role, disabled_at from users where id = $1 for update', [req.params.id]);
      if (!old || old.role === 'customer') throw notFound('user_not_found');
      if (old.role === 'superadmin') throw badRequest('cannot_change_superadmin', 'The super-administrator cannot be changed here');
      const role = req.body.role ?? old.role;
      const disabled = req.body.disabled === undefined ? old.disabled_at : (req.body.disabled ? new Date() : null);
      const { rows: [u] } = await c.query(
        `update users set role = $2, disabled_at = $3, updated_at = now() where id = $1 returning id, email, name, role, disabled_at`,
        [old.id, role, disabled]);
      if (req.body.disabled || role !== old.role) await c.query('delete from sessions where user_id = $1', [old.id]);
      await audit(c, req.user, 'user', old.id, 'access_changed', { role_before: old.role, role_after: role, disabled: !!disabled });
      return u;
    });
  });

  // New invitation link (also works as a password reset for a team member).
  app.post('/team/:id/invite', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    await tx(pool, async c => {
      const { rows: [u] } = await c.query('select id, email, name, role, disabled_at from users where id = $1', [req.params.id]);
      if (!u || !ROLE_LABELS[u.role]) throw notFound('user_not_found');
      if (u.disabled_at) throw badRequest('user_disabled', 'Reactivate the account first');
      await sendInvite(c, u);
      await audit(c, req.user, 'user', u.id, 'staff_invited', { role: u.role, resent: true });
    });
    return { ok: true };
  });
}
