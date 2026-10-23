// ─────────────────────────────────────────────────────────────────────────────
// config.js — Runtime configuration from environment variables.
// Secrets live only in server/.env (never committed) or the service environment.
// ─────────────────────────────────────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const cfg = {
    env:            env.NODE_ENV || 'development',
    // A number, or a named pipe when the host hands one over (Plesk on Windows / iisnode)
    port:           /^\d+$/.test(env.PORT || '3000') ? Number(env.PORT || 3000) : env.PORT,
    host:           env.HOST || '127.0.0.1',
    databaseUrl:    env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/maputoblue',
    siteRoot:       path.resolve(env.SITE_ROOT || path.join(__dirname, '..', '..')),
    publicBaseUrl:  (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
    trustProxy:     bool(env.TRUST_PROXY, false),
    cookieSecure:   bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
    sessionDays:    Number(env.SESSION_DAYS || 14),
    serveStatic:    bool(env.SERVE_STATIC, true),
    jobs:           bool(env.RUN_JOBS, true),
    mail: {
      resendApiKey: env.RESEND_API_KEY || '',
      from:         env.MAIL_FROM || 'Maputo Blue <reservas@maputoblue.com>',
      replyTo:      env.MAIL_REPLY_TO || 'maputoblue.info@gmail.com',
    },
    ipHashSalt:     env.IP_HASH_SALT || 'dev-salt-change-me',
    // Signs ticket QR codes. Changing it invalidates every issued QR code.
    ticketSecret:   env.TICKET_SECRET || '',
  };
  const out = { ...cfg, ...overrides, mail: { ...cfg.mail, ...(overrides.mail || {}) } };
  if (out.env === 'production') {
    const problems = productionProblems(out, env);
    if (problems.length) {
      throw new Error(`Invalid production configuration (see docs/IMPLANTACAO.md):\n  - ${problems.join('\n  - ')}`);
    }
  }
  if (!out.ticketSecret) out.ticketSecret = 'dev-only-ticket-secret';
  return out;
}

const placeholder = v => !v || /CHANGE_ME/i.test(v);

/** Settings that must be real before the server runs in production. */
export function productionProblems(cfg, env = process.env) {
  const problems = [];
  if (placeholder(env.DATABASE_URL)) problems.push('DATABASE_URL is not set');
  if (placeholder(env.PUBLIC_BASE_URL) || !/^https:\/\//.test(cfg.publicBaseUrl)) problems.push('PUBLIC_BASE_URL must be the public https:// address of the site');
  if (!cfg.cookieSecure) problems.push('COOKIE_SECURE must be true (the site is served over HTTPS)');
  if (placeholder(cfg.ticketSecret) || cfg.ticketSecret.length < 32) problems.push('TICKET_SECRET must be a random string of at least 32 characters');
  if (placeholder(env.IP_HASH_SALT) || cfg.ipHashSalt.length < 16) problems.push('IP_HASH_SALT must be a random string of at least 16 characters');
  return problems;
}
