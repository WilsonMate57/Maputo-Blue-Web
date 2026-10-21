// ─────────────────────────────────────────────────────────────────────────────
// routes/auth.js — Registration, login/logout, e-mail verification and
// password reset. Registration always creates a *customer*; administrator
// rights can only be granted by `npm run create-admin` or another admin.
// ─────────────────────────────────────────────────────────────────────────────
import { createSession, destroySession, publicUser } from '../lib/auth.js';
import { enqueueMail } from '../lib/mailer.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { dummyVerify, hashPassword, passwordProblems, randomToken, sha256, verifyPassword } from '../lib/security.js';
import { tx } from '../db.js';

const email = { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' };
const password = { type: 'string', minLength: 1, maxLength: 200 };
const token = { type: 'string', minLength: 20, maxLength: 100 };

async function issueToken(c, userId, purpose, hours) {
  const t = randomToken(32);
  await c.query(`delete from auth_tokens where user_id = $1 and purpose = $2 and used_at is null`, [userId, purpose]);
  await c.query(`insert into auth_tokens (token_hash, user_id, purpose, expires_at) values ($1,$2,$3, now() + make_interval(hours => $4))`,
    [sha256(t), userId, purpose, hours]);
  return t;
}

async function consumeToken(c, t, purpose) {
  const { rows } = await c.query(
    `update auth_tokens set used_at = now() where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
     returning user_id`, [sha256(t), purpose]);
  if (!rows[0]) throw badRequest('invalid_token', 'This link is invalid or has expired');
  return rows[0].user_id;
}

function accountUrl(cfg, locale, query) {
  return `${cfg.publicBaseUrl}/${locale === 'en' ? 'en/account.html' : 'pages/conta.html'}?${query}`;
}

export async function sendVerification(c, cfg, user) {
  const t = await issueToken(c, user.id, 'verify_email', 48);
  await enqueueMail(c, { key: `verify:${sha256(t)}`, to: user.email, template: 'verify_email', locale: user.locale,
    data: { name: user.name, url: accountUrl(cfg, user.locale, `verify=${encodeURIComponent(t)}`) } });
}

export default async function authRoutes(app) {
  const { pool, cfg } = app;
  const strict = { rateLimit: { max: 10, timeWindow: '15 minutes' } };

  app.get('/me', async req => ({ user: publicUser(req.user) }));

  app.post('/register', {
    config: strict,
    schema: { body: { type: 'object', required: ['name', 'email', 'password'], properties: {
      name: { type: 'string', minLength: 2, maxLength: 120 }, email, password,
      phone: { type: 'string', maxLength: 30, pattern: '^[+0-9 ()-]*$' }, country: { type: 'string', maxLength: 60 },
      locale: { type: 'string', enum: ['pt', 'en'] }, website: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    if (req.body.website) throw badRequest('rejected');
    const pwErr = passwordProblems(req.body.password);
    if (pwErr) throw badRequest(pwErr, 'Password must be at least 10 characters');
    const user = await tx(pool, async c => {
      const exists = await c.query('select 1 from users where lower(email) = lower($1)', [req.body.email]);
      if (exists.rows[0]) throw conflict('email_taken', 'An account with this e-mail already exists');
      const { rows: [u] } = await c.query(
        `insert into users (email, password_hash, name, phone, country, locale) values ($1,$2,$3,$4,$5,$6)
         returning id, email, name, phone, country, locale, role, email_verified_at`,
        [req.body.email.trim().toLowerCase(), await hashPassword(req.body.password), req.body.name.trim(),
         req.body.phone || null, req.body.country || null, req.body.locale || 'pt']);
      await sendVerification(c, cfg, u);
      await audit(c, u, 'user', u.id, 'registered');
      return u;
    });
    await createSession(pool, cfg, reply, user, req);
    reply.code(201);
    return { user: publicUser(user) };
  });

  app.post('/login', {
    config: strict,
    schema: { body: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', maxLength: 200 }, password } } },
  }, async (req, reply) => {
    const { rows } = await pool.query(
      `select id, email, name, phone, country, locale, role, email_verified_at, password_hash, disabled_at
         from users where lower(email) = lower($1)`, [req.body.email.trim()]);
    const u = rows[0];
    const ok = u ? await verifyPassword(req.body.password, u.password_hash) : await dummyVerify(req.body.password);
    if (!ok || u.disabled_at) throw unauthorized('invalid_credentials', 'E-mail or password is incorrect');
    await createSession(pool, cfg, reply, u, req);
    await audit(pool, u, 'user', u.id, 'login', { ip_hash: sha256(cfg.ipHashSalt + req.ip) });
    return { user: publicUser(u) };
  });

  app.post('/logout', async (req, reply) => {
    await destroySession(pool, req, reply);
    return { ok: true };
  });

  app.post('/verify-email', {
    config: strict,
    schema: { body: { type: 'object', required: ['token'], properties: { token } } },
  }, async req => tx(pool, async c => {
    const userId = await consumeToken(c, req.body.token, 'verify_email');
    const { rows: [u] } = await c.query(
      `update users set email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = $1
       returning id, email, name, phone, country, locale, role, email_verified_at`, [userId]);
    // Attach earlier guest bookings made with this (now verified) e-mail
    const linked = await c.query(`update bookings set user_id = $1 where user_id is null and lower(customer_email) = lower($2)`, [u.id, u.email]);
    await c.query(`update custom_requests set user_id = $1 where user_id is null and lower(email) = lower($2)`, [u.id, u.email]);
    await audit(c, u, 'user', u.id, 'email_verified', { linked_bookings: linked.rowCount });
    return { user: publicUser(u), linked_bookings: linked.rowCount };
  }));

  app.post('/resend-verification', { config: strict }, async req => {
    if (!req.user) throw unauthorized();
    if (req.user.email_verified_at) return { ok: true };
    await tx(pool, c => sendVerification(c, cfg, req.user));
    return { ok: true };
  });

  // Always answers 200 so the endpoint cannot be used to discover accounts
  app.post('/request-password-reset', {
    config: strict,
    schema: { body: { type: 'object', required: ['email'], properties: { email: { type: 'string', maxLength: 200 } } } },
  }, async req => {
    const { rows } = await pool.query('select id, email, name, locale from users where lower(email) = lower($1) and disabled_at is null', [req.body.email.trim()]);
    if (rows[0]) {
      await tx(pool, async c => {
        const t = await issueToken(c, rows[0].id, 'reset_password', 1);
        await enqueueMail(c, { key: `reset:${sha256(t)}`, to: rows[0].email, template: 'reset_password', locale: rows[0].locale,
          data: { url: accountUrl(cfg, rows[0].locale, `reset=${encodeURIComponent(t)}`) } });
      });
    }
    return { ok: true };
  });

  app.post('/reset-password', {
    config: strict,
    schema: { body: { type: 'object', required: ['token', 'password'], properties: { token, password } } },
  }, async req => {
    const pwErr = passwordProblems(req.body.password);
    if (pwErr) throw badRequest(pwErr, 'Password must be at least 10 characters');
    await tx(pool, async c => {
      const userId = await consumeToken(c, req.body.token, 'reset_password');
      await c.query('update users set password_hash = $2, updated_at = now() where id = $1', [userId, await hashPassword(req.body.password)]);
      await c.query('delete from sessions where user_id = $1', [userId]); // sign out everywhere
      await audit(c, { id: userId, role: 'customer' }, 'user', userId, 'password_reset');
    });
    return { ok: true };
  });
}
