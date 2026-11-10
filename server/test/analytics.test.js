// First-party visit statistics: collection (POST /api/t) and the admin reports.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setup, client, adminClient, createAdmin } from './helpers.js';
import { todayLocal } from '../src/lib/dates.js';
import { browserOf, deviceFor, osOf } from '../src/routes/analytics.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const CHROME = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const IPHONE = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const uuid = () => crypto.randomUUID();
const track = (body, headers = CHROME, c = client(ctx.app)) => c.post('/api/t', body, headers);
const pageviews = async () => (await ctx.pool.query('select * from analytics_pageviews order by at')).rows;

test('device, browser and OS', () => {
  assert.equal(deviceFor(390), 'mobile');
  assert.equal(deviceFor(820), 'tablet');
  assert.equal(deviceFor(1366), 'desktop');
  assert.equal(browserOf(CHROME['user-agent']), 'Chrome');
  assert.equal(browserOf(IPHONE['user-agent']), 'Safari');
  assert.equal(osOf(IPHONE['user-agent']), 'iOS');
});

test('page view: recorded without cookies; own-site referrer is "direct"', async () => {
  const sid = uuid(), id = uuid();
  const r = await track({ t: 'pv', id, sid, path: '/index.html', title: 'Maputo Blue', ref: 'http://localhost/pages/tours.html', vw: 1366, lang: 'pt' });
  assert.equal(r.status, 204);
  assert.equal(r.headers['set-cookie'], undefined, 'no cookie is set');
  const [pv] = await pageviews();
  assert.equal(pv.path, '/', '/index.html is stored as /');
  assert.equal(pv.referrer_host, null);
  assert.equal(pv.device, 'desktop');
  assert.equal(pv.browser, 'Chrome');
  assert.match(pv.visitor_hash, /^[0-9a-f]{32}$/);

  await track({ t: 'pv', id: uuid(), sid, path: '/pages/package.html?id=sunset-cruise-maputo-bay', ref: 'https://www.google.com/search?q=x', vw: 390 }, IPHONE);
  const rows = await pageviews();
  assert.equal(rows[1].referrer_host, 'google.com');
  assert.equal(rows[1].device, 'mobile');
});

test('not counted: bots, admin pages, signed-in administrators; junk paths refused', async () => {
  const before = (await pageviews()).length;
  await track({ t: 'pv', id: uuid(), sid: uuid(), path: '/' }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
  await track({ t: 'pv', id: uuid(), sid: uuid(), path: '/admin/' });
  await track({ t: 'pv', id: uuid(), sid: uuid(), path: '/' }, CHROME, admin);
  assert.equal((await pageviews()).length, before);
  assert.equal((await track({ t: 'pv', id: uuid(), sid: uuid(), path: 'https://evil.example/' })).status, 400);
  assert.equal((await track({ t: 'pv', id: uuid(), sid: uuid(), path: '/pages/package.html?id=x&email=a@b.c' })).status, 400);
});

test('time on page and clicks: only the session that created the page view', async () => {
  const sid = uuid(), id = uuid();
  await track({ t: 'pv', id, sid, path: '/pages/tours.html', vw: 1366 });
  await track({ t: 'leave', id, sid, ms: 42000, sp: 80 });
  await track({ t: 'leave', id, sid: uuid(), ms: 999999, sp: 100 });      // another session: ignored
  await track({ t: 'leave', id, sid, ms: 30000, sp: 40 });                  // never decreases
  const pv = (await ctx.pool.query('select engaged_ms, scroll_pct from analytics_pageviews where id = $1', [id])).rows[0];
  assert.deepEqual(pv, { engaged_ms: 42000, scroll_pct: 80 });

  await track({ t: 'click', id, sid, x: 0.5, y: 640, label: 'Reservar', tag: 'a', href: '/pages/package.html' });
  await track({ t: 'click', id, sid: uuid(), x: 0.1, y: 10, label: 'Forged' });
  await track({ t: 'click', id: uuid(), sid, x: 0.1, y: 10, label: 'Orphan' });
  const { rows } = await ctx.pool.query('select label, path, device from analytics_clicks');
  assert.deepEqual(rows, [{ label: 'Reservar', path: '/pages/tours.html', device: 'desktop' }]);
});

test('managers: their visits are not counted, and they can read the reports', async () => {
  await createAdmin(ctx.pool, 'gestor@test.local', 'manager-password-1');
  await ctx.pool.query(`update users set role = 'manager' where email = 'gestor@test.local'`);
  const m = client(ctx.app);
  assert.equal((await m.post('/api/auth/login', { email: 'gestor@test.local', password: 'manager-password-1' })).status, 200);
  const before = (await pageviews()).length;
  await track({ t: 'pv', id: uuid(), sid: uuid(), path: '/' }, CHROME, m);
  assert.equal((await pageviews()).length, before);
  const today = todayLocal();
  assert.equal((await m.get(`/api/admin/analytics?from=${today}&to=${today}`)).status, 200);
  assert.equal((await m.get(`/api/admin/analytics/heatmap?from=${today}&to=${today}&device=desktop`)).status, 200);
});

test('admin report: totals, per day, package names, clicks and heatmap', async () => {
  const today = todayLocal();
  assert.equal((await client(ctx.app).get(`/api/admin/analytics?from=${today}&to=${today}`)).status, 401);
  const r = await admin.get(`/api/admin/analytics?from=${today}&to=${today}`);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.body.current.pageviews, 3);
  assert.equal(r.body.current.sessions, 2);
  assert.equal(r.body.current.single_page_sessions, 1);
  assert.equal(r.body.current.avg_engaged_ms, 42000);
  assert.equal(r.body.daily.length, 1);
  assert.equal(r.body.daily[0].pageviews, 3);
  const pkg = r.body.pages.find(p => p.path.includes('sunset-cruise'));
  assert.ok(pkg && pkg.name !== pkg.path, 'package pages show the package name');
  assert.equal(r.body.clicks[0].label, 'Reservar');
  assert.equal(r.body.devices.length, 2);

  const h = await admin.get(`/api/admin/analytics/heatmap?from=${today}&to=${today}&device=desktop`);
  assert.equal(h.status, 200, h.raw);
  assert.equal(h.body.path, '/pages/tours.html');
  assert.deepEqual(h.body.points, [[0.5, 640]]);
  assert.equal((await admin.get(`/api/admin/analytics?from=2020-01-01&to=${today}`)).status, 400, 'period capped');
});

test('exports: PDF and CSV of the same report, for staff only, recorded in the activity log', async () => {
  const today = todayLocal();
  const q = `from=${today}&to=${today}`;
  const screen = (await admin.get(`/api/admin/analytics?${q}`)).body;

  const pdf = await admin.raw('GET', `/api/admin/analytics.pdf?${q}`);
  assert.equal(pdf.status, 200, pdf.raw);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.match(pdf.headers['content-disposition'], new RegExp(`visitas-site-${today}-a-${today}\.pdf`));
  assert.equal(pdf.raw.slice(0, 5), '%PDF-');

  const csv = await admin.raw('GET', `/api/admin/analytics.csv?${q}&lang=en`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.headers['content-disposition'], /site-visits-/);
  const lines = csv.raw.replace(/^\uFEFF/, '').split('\r\n');
  for (const section of ['Summary', 'Visits per day', 'Most visited pages', 'Where visits come from', 'Devices', 'Browsers', 'Most clicked buttons and links'])
    assert.ok(lines.includes(section), section);
  // The same numbers as the screen
  assert.equal(lines.find(l => l.startsWith('Page views,')).split(',')[1], String(screen.current.pageviews));
  assert.equal(lines.find(l => l.startsWith('Visitors,')).split(',')[1], String(screen.current.visitors));
  assert.ok(lines.includes(`${today},${screen.daily[0].pageviews},${screen.daily[0].visitors}`));
  const pt = (await admin.raw('GET', `/api/admin/analytics.csv?${q}`)).raw;
  assert.match(pt, /Visualizações de páginas/);

  assert.equal((await admin.raw('GET', `/api/admin/analytics.pdf?from=2020-01-01&to=${today}`)).status, 400, 'period capped');
  assert.equal((await client(ctx.app).raw('GET', `/api/admin/analytics.csv?${q}`)).status, 401);
  const m = client(ctx.app);
  await m.post('/api/auth/login', { email: 'gestor@test.local', password: 'manager-password-1' });
  assert.equal((await m.raw('GET', `/api/admin/analytics.pdf?${q}`)).status, 200, 'managers can export');

  const { rows } = await ctx.pool.query(`select action from audit_log where entity_type = 'analytics' order by id`);
  assert.deepEqual(rows.map(r => r.action).slice(0, 2), ['pdf_export', 'csv_export']);
});
