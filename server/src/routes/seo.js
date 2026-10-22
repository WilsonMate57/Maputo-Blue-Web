// ─────────────────────────────────────────────────────────────────────────────
// routes/seo.js — robots.txt and sitemap.xml generated from the database, so
// packages published in the dashboard are indexed automatically. Private
// areas (admin, API, account, booking status, quotations) are excluded.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const STATIC_PAGES = ['tours.html', 'accommodations.html', 'destinations.html', 'services.html', 'gallery.html', 'custom-tour.html', 'privacy.html'];
const xmlEsc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const htmlEsc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const absImg = (base, p) => (p ? `${base}/${String(p).replace(/^(\.\.\/|\.\/|\/)+/, '')}` : null);
const pageCache = new Map();

export default async function seoRoutes(app) {
  const { pool, cfg } = app;
  const base = cfg.publicBaseUrl;

  // ── Package pages: per-package <title>, description, canonical, hreflang,
  // Open Graph and JSON-LD rendered on the server (social networks and some
  // crawlers do not run JavaScript). Only real data; ratings only with reviews.
  for (const lang of ['pt', 'en']) {
    const route = lang === 'en' ? '/en/package.html' : '/pages/package.html';
    app.get(route, async (req, reply) => {
      const file = path.join(cfg.siteRoot, lang === 'en' ? 'en' : 'pages', 'package.html');
      const stat = await fs.promises.stat(file);
      let tpl = pageCache.get(file);
      if (!tpl || tpl.mtime !== stat.mtimeMs) { tpl = { mtime: stat.mtimeMs, html: await fs.promises.readFile(file, 'utf8') }; pageCache.set(file, tpl); }
      let html = tpl.html;
      const id = typeof req.query.id === 'string' && /^[a-z0-9][a-z0-9-]{1,80}$/.test(req.query.id) ? req.query.id : null;
      const { rows: [p] } = id ? await pool.query(`select * from packages where id = $1 and status = 'published'`, [id]) : { rows: [] };
      reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');
      if (!p) {
        if (req.query.preview !== '1') html = html.replace('<meta name="robots" content="index, follow">', '<meta name="robots" content="noindex, follow">');
        return html;
      }
      const c = p.content || {};
      const en = lang === 'en';
      const name = (en ? c.title_en || c.name_en : c.title || c.name) || c.title || c.name || p.id;
      const desc = String((en ? p.seo.description_en : p.seo.description) || (en ? c.description_en : c.description) || c.description || '').replace(/\s+/g, ' ').trim().slice(0, 158);
      const title = (en ? p.seo.title_en : p.seo.title) || `${name} | Maputo Blue`;
      const q = `?id=${encodeURIComponent(p.id)}${p.kind === 'accommodation' ? '&type=accommodation' : ''}`;
      const urlPt = `${base}/pages/package.html${q}`, urlEn = `${base}/en/package.html${q}`;
      const self = en ? urlEn : urlPt;
      const img = absImg(base, p.seo.og_image || c.cover || (c.images || [])[0]);
      const { rows: [rating] } = await pool.query(
        `select round(avg(rating)::numeric,1)::float avg, count(*)::int n from reviews where package_id = $1 and status = 'published'`, [p.id]);
      const ld = {
        '@context': 'https://schema.org', '@type': 'TouristTrip', name, description: desc || undefined, url: self,
        image: img || undefined, touristType: undefined,
        provider: { '@type': 'TravelAgency', name: 'Maputo Blue', url: base },
        offers: { '@type': 'Offer', price: String(p.pricing.options && p.pricing.unit === 'per_group' && p.pricing.options.length ? Math.min(...p.pricing.options.map(o => o.price)) : p.pricing.adult),
                  priceCurrency: p.pricing.currency, availability: 'https://schema.org/InStock', url: self },
        ...(rating && rating.n > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.n } } : {}),
      };
      const head = [
        `<link rel="canonical" href="${htmlEsc(self)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="Maputo Blue">`,
        `<meta property="og:title" content="${htmlEsc(name)}">`,
        desc ? `<meta property="og:description" content="${htmlEsc(desc)}">` : '',
        `<meta property="og:url" content="${htmlEsc(self)}">`,
        img ? `<meta property="og:image" content="${htmlEsc(img)}">` : '',
        `<meta name="twitter:card" content="summary_large_image">`,
        `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
      ].filter(Boolean).join('\n  ');
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${htmlEsc(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${htmlEsc(desc || name)}">`)
        .replace(/<link rel="alternate" hreflang="pt" href="[^"]*">/, `<link rel="alternate" hreflang="pt" href="${htmlEsc(urlPt)}">`)
        .replace(/<link rel="alternate" hreflang="en" href="[^"]*">/, `<link rel="alternate" hreflang="en" href="${htmlEsc(urlEn)}">`)
        .replace(/<link rel="alternate" hreflang="x-default" href="[^"]*">/, `<link rel="alternate" hreflang="x-default" href="${htmlEsc(urlPt)}">\n  ${head}`);
      return html;
    });
  }

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
