// ─────────────────────────────────────────────────────────────────────────────
// routes/seo.js — robots.txt and sitemap.xml generated from the database, so
// packages published in the dashboard are indexed automatically. Private
// areas (admin, API, account, booking status, quotations) are excluded.
// ─────────────────────────────────────────────────────────────────────────────

const STATIC_PAGES = ['tours.html', 'accommodations.html', 'destinations.html', 'services.html', 'gallery.html', 'custom-tour.html', 'privacy.html'];
const xmlEsc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export default async function seoRoutes(app) {
  const { pool, cfg } = app;
  const base = cfg.publicBaseUrl;

  app.get('/robots.txt', async (req, reply) => {
    reply.type('text/plain; charset=utf-8').header('Cache-Control', 'public, max-age=3600');
    return [
      'User-agent: *',
      'Disallow: /admin/',
      'Disallow: /api/',
      'Disallow: /pages/account.html',
      'Disallow: /en/account.html',
      'Disallow: /pages/booking-status.html',
      'Disallow: /en/booking-status.html',
      'Disallow: /pages/quote.html',
      'Disallow: /en/quote.html',
      'Disallow: /pages/ticket.html',
      'Disallow: /en/ticket.html',
      'Disallow: /pages/verify.html',
      'Disallow: /en/verify.html',
      '',
      `Sitemap: ${base}/sitemap.xml`,
      '',
    ].join('\n');
  });

  app.get('/sitemap.xml', async (req, reply) => {
    const { rows } = await pool.query(`select id, kind, updated_at from packages where status = 'published' order by sort_order, id`);
    const alt = (pt, en) => `<xhtml:link rel="alternate" hreflang="pt" href="${xmlEsc(pt)}"/><xhtml:link rel="alternate" hreflang="en" href="${xmlEsc(en)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${xmlEsc(pt)}"/>`;
    const urls = [];
    const add = (pt, en, lastmod) => {
      for (const loc of [pt, en]) urls.push(`<url><loc>${xmlEsc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${alt(pt, en)}</url>`);
    };
    add(`${base}/`, `${base}/en/index.html`);
    for (const p of STATIC_PAGES) add(`${base}/pages/${p}`, `${base}/en/${p}`);
    for (const r of rows) {
      const q = `package.html?id=${encodeURIComponent(r.id)}${r.kind === 'accommodation' ? '&type=accommodation' : ''}`;
      add(`${base}/pages/${q}`, `${base}/en/${q}`, new Date(r.updated_at).toISOString().slice(0, 10));
    }
    reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=3600');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  });
}
