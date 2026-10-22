// Lists elements wider than the viewport (horizontal scroll culprits) on small screens.
// Usage: node scripts/overflow-check.js [baseUrl] [width]
import { launch } from './screenshot.js';
const base = process.argv[2] || 'http://localhost:3100';
const width = Number(process.argv[3] || 360);
const pages = [
  '/index.html', '/en/index.html', '/pages/tours.html', '/pages/destinations.html', '/pages/accommodations.html',
  '/pages/services.html', '/pages/package.html?id=santa-maria-inhaca-portugueses', '/pages/charter-booking.html?boat=5',
  '/pages/custom-tour.html', '/pages/account.html', '/pages/booking-status.html', '/pages/gallery.html', '/pages/privacy.html',
];
const b = await launch();
let bad = 0;
for (const path of pages) {
  const p = await b.newPage();
  await p.setViewport({ width, height: 800, isMobile: true, hasTouch: true });
  await p.goto(base + path, { waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  const res = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') {
        // report only the outermost culprit
        if (!out.some(o => o.el.contains(el))) out.push({ el, d: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)}` });
      }
    }
    return { scroll: document.documentElement.scrollWidth - vw, items: out.slice(0, 6).map(o => o.d) };
  });
  if (res.scroll > 0) bad++;
  console.log(`${res.scroll > 0 ? 'OVERFLOW ' + res.scroll + 'px' : 'ok'}  ${path}${res.scroll > 0 ? '\n   ' + res.items.join('\n   ') : ''}`);
  await p.close();
}
await b.close();
process.exitCode = bad ? 1 : 0;
