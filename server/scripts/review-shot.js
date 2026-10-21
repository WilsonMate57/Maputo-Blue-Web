// Full-page screenshot after scrolling through the page (triggers lazy
// loading, scroll-reveal and counters). Usage: node scripts/review-shot.js <url> <out.png> [--mobile]
import { launch } from './screenshot.js';
const [url, out] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const mobile = process.argv.includes('--mobile');
const b = await launch();
const p = await b.newPage();
await p.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
await p.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 3300));
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); }
  window.scrollTo(0, 0);
});
await new Promise(r => setTimeout(r, 2500));
await p.screenshot({ path: out, fullPage: true });
await b.close();
