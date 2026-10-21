// ─────────────────────────────────────────────────────────────────────────────
// auth.js — Cookie sessions. The cookie holds a random token; only its SHA-256
// hash is stored. Roles come exclusively from the users table, which only the
// create-admin script (or an existing admin) can change.
// ─────────────────────────────────────────────────────────────────────────────
import { randomToken, sha256 } from './security.js';
import { forbidden, unauthorized } from './errors.js';

export const SESSION_COOKIE = 'mb_session';

export async function createSession(pool, cfg, reply, user, request) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + cfg.sessionDays * 86400e3);
  await pool.query(
    `insert into sessions (token_hash, user_id, expires_at, ip, user_agent) values ($1,$2,$3,$4,$5)`,
    [sha256(token), user.id, expires, request.ip, String(request.headers['user-agent'] || '').slice(0, 300)]);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, expires,
  });
}

export async function destroySession(pool, request, reply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) await pool.query('delete from sessions where token_hash = $1', [sha256(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** onRequest hook: attach request.user when a valid session cookie is present. */
export function sessionHook(pool) {
  return async request => {
    request.user = null;
    const token = request.cookies[SESSION_COOKIE];
    if (!token || token.length > 100) return;
    const { rows } = await pool.query(
      `select u.id, u.email, u.name, u.phone, u.country, u.locale, u.role, u.email_verified_at
         from sessions s join users u on u.id = s.user_id
        where s.token_hash = $1 and s.expires_at > now() and u.disabled_at is null`, [sha256(token)]);
    request.user = rows[0] || null;
  };
}

export async function requireUser(request) {
  if (!request.user) throw unauthorized();
}

export async function requireAdmin(request) {
  if (!request.user) throw unauthorized();
  if (request.user.role !== 'admin') throw forbidden('admin_only', 'Administrator access required');
}

export function publicUser(u) {
  return u && { id: u.id, email: u.email, name: u.name, phone: u.phone, country: u.country, locale: u.locale,
                role: u.role, email_verified: !!u.email_verified_at };
}
