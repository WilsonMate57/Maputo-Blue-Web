// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/analytics.js — Visit statistics for the admin "Estatísticas"
// view: totals with the previous period, visits per day, pages, traffic
// sources, devices, most clicked buttons and the click heatmap of a page.
// Dates are calendar days in Africa/Maputo.
// ─────────────────────────────────────────────────────────────────────────────
import { addDays, diffDays } from '../../lib/dates.js';
import { badRequest } from '../../lib/errors.js';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const range = { type: 'object', required: ['from', 'to'], properties: { from: day, to: day } };
const TZ = 'Africa/Maputo';
// $1 = first day, $2 = last day (inclusive)
const IN_RANGE = `at >= ($1::date)::timestamp at time zone '${TZ}' and at < ($2::date + 1)::timestamp at time zone '${TZ}'`;

function checkRange(from, to) {
  const n = diffDays(from, to);
  if (n < 0 || n > 400) throw badRequest('invalid_range', 'Choose a period of up to 400 days');
  return n + 1;
}

async function totals(pool, from, to) {
  const { rows: [t] } = await pool.query(
    `with pv as (select * from analytics_pageviews where ${IN_RANGE}),
          s as (select session_id, count(*) n from pv group by session_id)
     select (select count(*) from pv)::int as pageviews,
            (select count(distinct visitor_hash) from pv)::int as visitors,
            (select count(*) from s)::int as sessions,
            (select coalesce(round(avg(engaged_ms)), 0) from pv where engaged_ms > 0)::int as avg_engaged_ms,
            (select coalesce(round(avg(scroll_pct)), 0) from pv where engaged_ms > 0)::int as avg_scroll,
            (select count(*) from s where n = 1)::int as single_page_sessions,
            (select count(*) from analytics_clicks where ${IN_RANGE})::int as clicks,
            (select count(*) from bookings where created_at >= ($1::date)::timestamp at time zone '${TZ}'
               and created_at < ($2::date + 1)::timestamp at time zone '${TZ}')::int as bookings,
            (select count(*) from custom_requests where created_at >= ($1::date)::timestamp at time zone '${TZ}'
               and created_at < ($2::date + 1)::timestamp at time zone '${TZ}')::int as requests`, [from, to]);
  return t;
}

export default async function analyticsAdminRoutes(app) {
  const { pool } = app;

  app.get('/analytics', { schema: { querystring: range } }, async req => {
    const { from, to } = req.query;
    const days = checkRange(from, to);
    const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
    const q = sql => pool.query(sql, [from, to]).then(r => r.rows);

    const [current, previous, daily, pages, sources, devices, browsers, clicks, titles] = await Promise.all([
      totals(pool, from, to),
      totals(pool, prevFrom, prevTo),
      q(`select d::date::text as day,
                count(p.id)::int as pageviews, count(distinct p.visitor_hash)::int as visitors
           from generate_series($1::date, $2::date, interval '1 day') d
           left join analytics_pageviews p on (p.at at time zone '${TZ}')::date = d::date
          group by d order by d`),
      q(`select path, max(title) as title, count(*)::int as views, count(distinct visitor_hash)::int as visitors,
                coalesce(round(avg(engaged_ms) filter (where engaged_ms > 0)), 0)::int as avg_ms,
                coalesce(round(avg(scroll_pct) filter (where engaged_ms > 0)), 0)::int as avg_scroll
           from analytics_pageviews where ${IN_RANGE} group by path order by views desc limit 20`),
      q(`select coalesce(utm_source, referrer_host) as source, (utm_source is not null) as campaign,
                count(distinct session_id)::int as sessions
           from analytics_pageviews where ${IN_RANGE} group by 1, 2 order by sessions desc limit 12`),
      q(`select device as name, count(distinct session_id)::int as sessions
           from analytics_pageviews where ${IN_RANGE} group by 1 order by sessions desc`),
      q(`select browser as name, count(distinct session_id)::int as sessions
           from analytics_pageviews where ${IN_RANGE} group by 1 order by sessions desc limit 8`),
      q(`select label, path, max(href) as href, count(*)::int as clicks
           from analytics_clicks where ${IN_RANGE} and label is not null and label <> ''
          group by label, path order by clicks desc limit 20`),
      pool.query(`select id, content->>'title' as title from packages`).then(r => r.rows),
    ]);

    // Package pages are told apart by ?id= — show the package name
    const pkg = Object.fromEntries(titles.map(t => [t.id, t.title]));
    const name = path => {
      const m = /package\.html\?id=([a-z0-9-]+)/.exec(path);
      return m && pkg[m[1]] ? pkg[m[1]] : null;
    };
    for (const p of pages) p.name = name(p.path) || p.title || p.path;
    for (const c of clicks) c.page = name(c.path) || c.path;

    return { from, to, previous: { from: prevFrom, to: prevTo, ...previous }, current, daily, pages, sources, devices, browsers, clicks };
  });

  app.get('/analytics/heatmap', {
    schema: { querystring: { type: 'object', required: ['from', 'to', 'device'], properties: {
      from: day, to: day, device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] }, path: { type: 'string', maxLength: 200 } } } },
  }, async req => {
    const { from, to, device, path } = req.query;
    checkRange(from, to);
    const { rows: pages } = await pool.query(
      `select path, count(*)::int as clicks from analytics_clicks where ${IN_RANGE} and device = $3
        group by path order by clicks desc limit 40`, [from, to, device]);
    const current = path || (pages[0] && pages[0].path);
    if (!current) return { pages, path: null, points: [], top: [] };
    const [{ rows: points }, { rows: top }] = await Promise.all([
      pool.query(`select x, y from analytics_clicks where ${IN_RANGE} and device = $3 and path = $4
                   order by at desc limit 10000`, [from, to, device, current]),
      pool.query(`select label, count(*)::int as clicks from analytics_clicks
                   where ${IN_RANGE} and device = $3 and path = $4 and label is not null and label <> ''
                   group by label order by clicks desc limit 10`, [from, to, device, current]),
    ]);
    return { pages, path: current, points: points.map(p => [Math.round(p.x * 10000) / 10000, p.y]), top };
  });
}
