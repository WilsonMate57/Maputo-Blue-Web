// ─────────────────────────────────────────────────────────────────────────────
// screenshot.js — Capture pages with the locally installed Chrome/Edge.
// Usage: node scripts/screenshot.js <url> [out.png] [--mobile] [--full]
// Screenshots go to "<site>/temporary screenshots/" by default (git-ignored).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);

export function chromePath() {
  const p = CANDIDATES.find(c => fs.existsSync(c));
  if (!p) throw new Error('No Chrome/Edge found — set CHROME_PATH');
  return p;
}

export async function launch() {
  return puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--lang=pt-PT'] });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [url, outArg] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const mobile = process.argv.includes('--mobile');
  const full = process.argv.includes('--full');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'temporary screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const out = outArg ? path.resolve(outArg) : path.join(dir, `shot-${Date.now()}.png`);
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true } : { width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3500)); // preloader
  await page.screenshot({ path: out, fullPage: full });
  await browser.close();
  console.log(out);
}
