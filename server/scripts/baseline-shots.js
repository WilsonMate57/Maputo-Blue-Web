// Viewport (above-the-fold) + full-page screenshots of the key pages at fixed
// sizes, for before/after comparison of redesigns.
// Usage: node scripts/baseline-shots.js <outDir> [baseUrl]
// Admin pages are captured when ADMIN_EMAIL / ADMIN_PASSWORD are set.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './screenshot.js';

const out = process.argv[2];
const base = process.argv[3] || 'http://localhost:3100';
if (!out) { console.error('usage: node scripts/baseline-shots.js <outDir> [baseUrl]'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

const PAGES = [
  ['home', '/index.html'],
  ['tours', '/pages/tours.html'],
  ['package', '/pages/package.html?id=santa-maria-inhaca-portugueses'],
  ['accommodations', '/pages/accommodations.html'],
  ['destinations', '/pages/destinations.html'],
  ['services', '/pages/services.html'],
  ['account', '/pages/account.html'],
  ['status', '/pages/booking-status.html'],
  ['custom-tour', '/pages/custom-tour.html'],
  ['home-en', '/en/index.html'],
];
const ADMIN = [['admin-dashboard', '/admin/#/dashboard'], ['admin-bookings', '/admin/#/bookings'], ['admin-invoices', '/admin/#/invoices']];
const VIEWPORTS = { d: { width: 1440, height: 900 }, m: { width: 390, height: 844, isMobile: true, hasTouch: true } };

const settle = async p => {
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 1200));
};

const b = await launch();
for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const p = await b.newPage();
  await p.setViewport(size);
  for (const [name, url] of PAGES) {
    await p.goto(base + url, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2200));
    await settle(p);
    await p.screenshot({ path: path.join(out, `${vp}-${name}-fold.png`) });
    await p.screenshot({ path: path.join(out, `${vp}-${name}-full.png`), fullPage: true });
  }
  if (process.env.ADMIN_EMAIL) {
    await p.goto(base + '/admin/', { waitUntil: 'networkidle0' });
    if (await p.$('#login:not([hidden])')) {
      await p.type('#login-form [name=email]', process.env.ADMIN_EMAIL);
      await p.type('#login-form [name=password]', process.env.ADMIN_PASSWORD);
      await Promise.all([p.waitForSelector('#app:not([hidden])', { timeout: 15000 }).catch(() => {}), p.click('#login-form button[type=submit]')]);
    }
    for (const [name, url] of ADMIN) {
      await p.goto(base + url, { waitUntil: 'networkidle0' }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      await p.screenshot({ path: path.join(out, `${vp}-${name}-fold.png`) });
    }
  }
  await p.close();
}
await b.close();
console.log('saved to', out);
