// ─────────────────────────────────────────────────────────────────────────────
// audit.js — Automated frontend audit of every public page (PT + EN) at
// desktop and mobile widths, using the local Chrome.
// Reports: JS errors, failed requests, broken internal links, horizontal
// overflow, images without alt, heading/meta problems, unlabeled fields,
// tiny tap targets. Writes temporary screenshots/audit/report.json.
// Usage: node scripts/audit.js [baseUrl]
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './screenshot.js';

const BASE = process.argv[2] || process.env.E2E_BASE_URL || 'http://localhost:3100';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'temporary screenshots', 'audit');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = ['index.html', 'tours.html', 'accommodations.html', 'destinations.html', 'services.html', 'gallery.html',
  'package.html?id=sunset-cruise-maputo-bay', 'package.html?id=machangulo-beach-lodge-1-night&type=accommodation',
  'package.html?id=pesca-alto-mar-intermedia', 'car-booking.html', 'charter-booking.html', 'custom-tour.html',
  'account.html', 'booking-status.html', 'privacy.html'];
const urls = [];
for (const p of PAGES) {
  urls.push(p === 'index.html' ? '/index.html' : `/pages/${p}`);
  urls.push(`/en/${p}`);
}

const browser = await launch();
const report = [];
const linkSet = new Set();

for (const url of urls) {
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const page = await browser.newPage();
    const issues = { url, viewport: vp.name, jsErrors: [], failed: [] };
    page.on('pageerror', e => issues.jsErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') issues.jsErrors.push('console: ' + m.text()); });
    page.on('requestfailed', r => issues.failed.push(`${r.failure()?.errorText} ${r.url()}`));
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(BASE)) issues.failed.push(`${r.status()} ${r.url()}`); });
    await page.setViewport(vp);
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 60000 });
    } catch (e) { issues.jsErrors.push('navigation: ' + e.message); }
    await page.evaluate(() => { const p = document.getElementById('preloader'); if (p) p.classList.add('hidden'); });
    await new Promise(r => setTimeout(r, 1200));
    Object.assign(issues, await page.evaluate(() => {
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      const overflowEls = [...document.querySelectorAll('body *')].filter(el => vis(el) && el.getBoundingClientRect().right > window.innerWidth + 2 && !el.closest('[class*="slider"],[class*="track"],[class*="carousel"],.mobile-nav,.table-wrap'))
        .slice(0, 6).map(el => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
      const imgsNoAlt = [...document.images].filter(i => vis(i) && !i.hasAttribute('alt')).map(i => i.src.split('/').pop()).slice(0, 10);
      const brokenImgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.endsWith('/')).map(i => i.src).slice(0, 10);
      const h1 = [...document.querySelectorAll('h1')].filter(vis).map(h => h.textContent.trim().slice(0, 60));
      const unlabeled = [...document.querySelectorAll('input:not([type=hidden]):not([tabindex="-1"]), select, textarea')].filter(vis)
        .filter(el => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(el => el.name || el.id || el.type).slice(0, 10);
      const smallTargets = [...document.querySelectorAll('a, button')].filter(vis).filter(el => { const r = el.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && el.textContent.trim().length < 3; })
        .map(el => el.getAttribute('aria-label') || el.className || el.tagName).slice(0, 8);
      const deadButtons = [...document.querySelectorAll('a[href="#"]')].filter(vis).map(a => a.textContent.trim().slice(0, 40)).slice(0, 10);
      const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin));
      return {
        title: document.title, description: (document.querySelector('meta[name=description]') || {}).content || null,
        lang: document.documentElement.lang, canonical: !!document.querySelector('link[rel=canonical]'),
        ogTitle: !!document.querySelector('meta[property="og:title"]'),
        horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1, overflowEls, imgsNoAlt, brokenImgs, h1, unlabeled, smallTargets, deadButtons, links,
      };
    }));
    issues.links.forEach(l => linkSet.add(l.split('#')[0]));
    delete issues.links;
    await page.screenshot({ path: path.join(OUT, `${vp.name}-${url.replace(/\W+/g, '_')}.png`), fullPage: vp.name === 'mobile' ? false : false });
    report.push(issues);
    await page.close();
  }
}

// Broken internal links
const broken = [];
for (const l of linkSet) {
  try {
    const r = await fetch(l, { redirect: 'manual' });
    if (r.status >= 400) broken.push(`${r.status} ${l}`);
  } catch (e) { broken.push(`ERR ${l}`); }
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ pages: report, brokenLinks: broken }, null, 2));

for (const r of report) {
  const p = [];
  if (r.jsErrors.length) p.push(`JS: ${[...new Set(r.jsErrors)].join(' | ').slice(0, 300)}`);
  if (r.failed.length) p.push(`FAILED: ${[...new Set(r.failed)].join(' | ').slice(0, 300)}`);
  if (r.horizontalScroll) p.push(`H-SCROLL: ${r.overflowEls.join(', ')}`);
  if (r.imgsNoAlt.length) p.push(`NO-ALT: ${r.imgsNoAlt.join(', ')}`);
  if (r.brokenImgs.length) p.push(`BROKEN-IMG: ${r.brokenImgs.join(', ')}`);
  if (r.h1.length !== 1) p.push(`H1x${r.h1.length}: ${r.h1.join(' / ')}`);
  if (r.unlabeled.length) p.push(`UNLABELED: ${r.unlabeled.join(', ')}`);
  if (r.deadButtons.length) p.push(`HREF#: ${r.deadButtons.join(', ')}`);
  if (r.smallTargets.length && r.viewport === 'mobile') p.push(`SMALL-TAP: ${r.smallTargets.join(', ')}`);
  if (!r.description) p.push('NO-DESCRIPTION');
  if (!r.ogTitle) p.push('NO-OG');
  if (p.length) console.log(`\n[${r.viewport}] ${r.url}  (lang=${r.lang})\n  - ${p.join('\n  - ')}`);
}
console.log('\nBROKEN LINKS:', broken.length ? '\n  ' + broken.join('\n  ') : 'none');
