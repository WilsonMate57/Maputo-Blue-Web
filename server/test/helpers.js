// ─────────────────────────────────────────────────────────────────────────────
// test/helpers.js — Fresh test database + in-process app (fastify.inject).
// Uses the maputoblue_test database of the dev PostgreSQL (npm run db:dev).
// ─────────────────────────────────────────────────────────────────────────────
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { planImport, runImport } from '../src/lib/importer.js';
import { hashPassword } from '../src/lib/security.js';
import { addDays, todayLocal, weekday } from '../src/lib/dates.js';

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5433/maputoblue_test';

/** Copy of the site folder's images dir for upload tests (never touch real assets). */
function tempSiteRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-site-'));
  fs.mkdirSync(path.join(dir, 'assets', 'images', 'tours', 'test'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  for (const d of ['pages', 'en']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.copyFileSync(path.join(SITE_ROOT, d, 'package.html'), path.join(dir, d, 'package.html'));
  }
  fs.copyFileSync(path.join(SITE_ROOT, 'logo.webp'), path.join(dir, 'logo.webp'));
  for (const f of ['tours.json', 'accommodations.json', 'gallery.json']) {
    fs.copyFileSync(path.join(SITE_ROOT, 'data', f), path.join(dir, 'data', f));
  }
  return dir;
}

export async function setup({ importCatalog = true, mailTransport, rateLimit = false } = {}) {
  const pool = createPool(TEST_DB);
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  if (importCatalog) {
    const plan = planImport(SITE_ROOT); // validates against the real data files
    await runImport(pool, plan);
  }
  const sent = [];
  const transport = mailTransport || (async msg => { sent.push(msg); return `test-${sent.length}`; });
  const siteRoot = tempSiteRoot();
  const cfg = loadConfig({ databaseUrl: TEST_DB, publicBaseUrl: 'http://localhost', serveStatic: false, jobs: false,
    cookieSecure: false, siteRoot, disableRateLimit: !rateLimit, mail: { resendApiKey: 'test' } });
  const app = await buildApp({ cfg, pool, mailTransport: transport });
  await app.ready();
  return { app, pool, cfg, sent, transport, siteRoot,
    async close() { await app.close(); await pool.end(); fs.rmSync(siteRoot, { recursive: true, force: true }); } };
}

/** Minimal cookie-aware client around app.inject. */
export function client(app) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await app.inject({
      method, url,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined && !headers['content-type'] ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
    });
    const set = res.headers['set-cookie'];
    if (set) {
      const first = (Array.isArray(set) ? set : [set]).find(c => c.startsWith('mb_session='));
      if (first) cookie = first.split(';')[0].endsWith('=') ? '' : first.split(';')[0];
    }
    let json;
    try { json = res.json(); } catch { json = undefined; }
    return { status: res.statusCode, body: json, raw: res.body, headers: res.headers };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    put: (u, b, h) => call('PUT', u, b, h),
    patch: (u, b, h) => call('PATCH', u, b, h),
    del: (u, h) => call('DELETE', u, undefined, h),
    raw: call,
    get cookie() { return cookie; },
  };
}

export async function createAdmin(pool, email = 'admin@test.local', password = 'admin-password-123') {
  await pool.query(`insert into users (email, password_hash, name, role, email_verified_at) values ($1,$2,'Admin','admin', now())`,
    [email, await hashPassword(password)]);
  return { email, password };
}

export async function adminClient(app, pool) {
  const creds = await createAdmin(pool);
  const c = client(app);
  const r = await c.post('/api/auth/login', creds);
  if (r.status !== 200) throw new Error('admin login failed ' + r.raw);
  return c;
}

/** Next date (≥ 3 days ahead, to clear the lead time) falling on the given weekday. */
export function nextWeekday(wd, minDays = 3) {
  let d = addDays(todayLocal(), minDays);
  while (weekday(d) !== wd) d = addDays(d, 1);
  return d;
}

let n = 0;
export const idem = () => `test-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 10)}`;

export function bookingBody(over = {}) {
  return {
    package_id: 'sunset-cruise-maputo-bay',
    date: nextWeekday(3),
    adults: 2, children: 0,
    customer: { name: 'Ana Teste', email: 'ana@example.com', phone: '+258 84 000 0000' },
    locale: 'pt', consent: true, idempotency_key: idem(),
    ...over,
  };
}
