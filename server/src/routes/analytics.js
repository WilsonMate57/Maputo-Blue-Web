// ─────────────────────────────────────────────────────────────────────────────
// routes/analytics.js — Collects first-party visit statistics from
// assets/js/analytics.js (POST /api/t): page views, time on page, scroll depth
// and clicks. Cookieless: the daily visitor hash cannot follow anyone across
// days, and nothing typed by visitors is ever sent. Bots, the admin area and
// signed-in administrators are not counted.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { todayLocal } from '../lib/dates.js';

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|node-fetch/i;
const PATH = '^/[A-Za-z0-9/_.~%-]*(\\?id=[a-z0-9-]{1,80})?$';
const str = n => ({ type: 'string', maxLength: n });

const schema = {
  body: {
    type: 'object', required: ['t', 'id', 'sid'],
    properties: {
      t: { type: 'string', enum: ['pv', 'leave', 'click'] },
      id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
      sid: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
      path: { type: 'string', maxLength: 200, pattern: PATH },
      title: str(150), ref: str(500), lang: str(10),
      utm_source: str(80), utm_medium: str(80), utm_campaign: str(120),
      vw: { type: 'integer', minimum: 0, maximum: 10000 },
      ms: { type: 'integer', minimum: 0, maximum: 86_400_000 },
      sp: { type: 'integer', minimum: 0, maximum: 100 },
      x: { type: 'number', minimum: 0, maximum: 1 },
      y: { type: 'integer', minimum: 0, maximum: 200_000 },
      label: str(80), tag: str(20), href: str(200),
    },
  },
};

/** Device by viewport width, so the heatmap groups pages with the same layout. */
export const deviceFor = vw => (vw && vw < 768 ? 'mobile' : vw && vw < 1200 ? 'tablet' : 'desktop');

export function browserOf(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Outro';
}

export function osOf(ua) {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Outro';
}

/** "/index.html" → "/", "/en/index.html" → "/en/". */
const normPath = p => p.replace(/\/index\.html$/, '/');

export default async function analyticsRoutes(app) {
  const { pool, cfg } = app;
  const ownHost = new URL(cfg.publicBaseUrl).host.replace(/^www\./, '');

  app.post('/t', { schema, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.code(204);
    const ua = String(req.headers['user-agent'] || '');
    if (!ua || BOT.test(ua) || (req.user && req.user.role === 'admin')) return;
    const b = req.body;

    if (b.t === 'pv') {
      if (!b.path || b.path.startsWith('/admin')) return;
      let refHost = null;
      try {
        refHost = b.ref ? new URL(b.ref).host.replace(/^www\./, '') : null;
        if (refHost && (refHost === ownHost || refHost === String(req.headers.host || '').replace(/^www\./, ''))) refHost = null;
      } catch { refHost = null; }
      const visitor = crypto.createHash('sha256')
        .update(`${cfg.ipHashSalt}:${todayLocal()}:${req.ip}:${ua}`).digest('hex').slice(0, 32);
      await pool.query(
        `insert into analytics_pageviews (id, session_id, visitor_hash, path, locale, title, referrer_host,
           utm_source, utm_medium, utm_campaign, device, browser, os, viewport_w)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (id) do nothing`,
        [b.id, b.sid, visitor, normPath(b.path), b.lang ? b.lang.slice(0, 2) : null, b.title || null, refHost,
          b.utm_source || null, b.utm_medium || null, b.utm_campaign || null,
          deviceFor(b.vw), browserOf(ua), osOf(ua), b.vw || null]);
      return;
    }

    if (b.t === 'leave') {
      // Only the session that created the page view can update it
      await pool.query(
        `update analytics_pageviews set engaged_ms = greatest(engaged_ms, least($3, 10800000)),
                scroll_pct = greatest(scroll_pct, $4)
          where id = $1 and session_id = $2`, [b.id, b.sid, b.ms || 0, b.sp || 0]);
      return;
    }

    // click
    if (b.x === undefined || b.y === undefined) return;
    await pool.query(
      `insert into analytics_clicks (pageview_id, path, device, x, y, label, tag, href)
       select p.id, p.path, p.device, $3, $4, $5, $6, $7 from analytics_pageviews p
        where p.id = $1 and p.session_id = $2
          and (select count(*) from analytics_clicks c where c.pageview_id = p.id) < 300`,
      [b.id, b.sid, b.x, b.y, b.label || null, b.tag || null, b.href || null]);
  });
}
