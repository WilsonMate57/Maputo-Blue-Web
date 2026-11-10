// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/analytics.js — Visit statistics for the admin "Estatísticas"
// view: totals with the previous period, visits per day, pages, traffic
// sources, devices, most clicked buttons and the click heatmap of a page.
// The same report exports as PDF (to share) and CSV (for Excel).
// Dates are calendar days in Africa/Maputo.
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from '../../lib/audit.js';
import { buildReport, checkRange, reportCsv, reportPdf } from '../../lib/analytics-report.js';

const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const range = { type: 'object', required: ['from', 'to'], properties: { from: day, to: day } };
const exportQuery = { type: 'object', required: ['from', 'to'], properties: { from: day, to: day, lang: { type: 'string', enum: ['pt', 'en'] } } };
const TZ = 'Africa/Maputo';
const IN_RANGE = `at >= ($1::date)::timestamp at time zone '${TZ}' and at < ($2::date + 1)::timestamp at time zone '${TZ}'`;

export default async function analyticsAdminRoutes(app) {
  const { pool, cfg } = app;

  app.get('/analytics', { schema: { querystring: range } }, async req => buildReport(pool, req.query.from, req.query.to));

  // Exports: the screen shows the top 20 of each list; files carry up to 200
  const exporter = (ext, type, render) => app.get(`/analytics.${ext}`, { schema: { querystring: exportQuery } }, async (req, reply) => {
    const { from, to, lang = 'pt' } = req.query;
    const report = await buildReport(pool, from, to, { limit: 200 });
    await audit(pool, req.user, 'analytics', `${from}_${to}`, `${ext}_export`, { from, to });
    reply.header('Content-Type', type);
    reply.header('Content-Disposition', `attachment; filename="${lang === 'en' ? 'site-visits' : 'visitas-site'}-${from}-a-${to}.${ext}"`);
    return render(report, lang);
  });
  exporter('pdf', 'application/pdf', (r, lang) => reportPdf(r, cfg, lang));
  exporter('csv', 'text/csv; charset=utf-8', (r, lang) => reportCsv(r, lang));

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
