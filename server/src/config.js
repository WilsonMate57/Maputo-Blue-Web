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
    port:           Number(env.PORT || 3000),
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
  };
  return { ...cfg, ...overrides, mail: { ...cfg.mail, ...(overrides.mail || {}) } };
}
