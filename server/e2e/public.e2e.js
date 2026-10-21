// ─────────────────────────────────────────────────────────────────────────────
// public.e2e.js — Browser end-to-end checks of the public site against a
// running server (default http://localhost:3100). Uses the local Chrome.
// Run: npm run test:e2e        (server must be running with a dev database)
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../scripts/screenshot.js';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3100';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'temporary screenshots', 'e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const run = Date.now().toString(36);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser;
const errors = [];
before(async () => { browser = await launch(); });
after(async () => { if (browser) await browser.close(); });

async function open(url, { mobile = false } = {}) {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(`${url}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(404|net::ERR)/.test(m.text())) errors.push(`${url}: ${m.text()}`); });
  await page.setViewport(mobile ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 900 });
  await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => { const p = document.getElementById('preloader'); if (p) p.classList.add('hidden'); });
  await sleep(700); // the preloader fades out for 0.5s and still captures clicks meanwhile
  return page;
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

let booking;

test('package page: calendar → server quote → booking request → reference', async () => {
  const page = await open('/pages/package.html?id=sunset-cruise-maputo-bay');
  await page.waitForSelector('.mb-cal__day:not([disabled])', { timeout: 15000 });
  await page.click('.mb-cal__day:not([disabled])');
  await page.click('#adults-plus');
  await page.waitForFunction(() => /MZN\s3,600/.test(document.getElementById('booking-total').textContent), { timeout: 10000 });
  await page.click('#booking-whatsapp-btn');
  await page.waitForSelector('dialog.mb-dialog[open] form');
  // Submitting empty shows validation, nothing is sent
  await page.click('[data-submit]');
  assert.ok(await page.$eval('dialog .mb-alert', el => !el.hidden));
  await page.type('dialog input[name=name]', 'Teste E2E');
  await page.type('dialog input[name=email]', `e2e-${run}@example.com`);
  await page.type('dialog input[name=phone]', '+258 84 000 0000');
  await page.click('dialog input[name=consent]');
  await page.click('[data-submit]');
  await page.waitForSelector('dialog .mb-ref', { timeout: 15000 });
  const ref = await page.$eval('dialog .mb-ref', el => el.textContent.trim());
  assert.match(ref, /^MB-[A-Z0-9]{6}$/);
  booking = { ref, statusHref: await page.$eval('dialog .mb-dialog__actions a', a => a.href) };
  await page.screenshot({ path: path.join(SHOTS, 'booking-success.png') });
  await page.close();
});

test('booking status page shows the pending booking from the e-mail link', async () => {
  const page = await browser.newPage();
  await page.goto(booking.statusHref, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.mb-ref');
  assert.equal(await page.$eval('.mb-ref', el => el.textContent.trim()), booking.ref);
  assert.match(await page.$eval('.mb-status', el => el.textContent), /Pendente/);
  await page.screenshot({ path: path.join(SHOTS, 'booking-status.png'), fullPage: true });
  await page.close();
});

test('custom tour request: steps → summary → reference', async () => {
  const page = await open('/en/custom-tour.html');
  await page.waitForSelector('#portal-root form');
  await page.type('input[name=destination]', 'Inhaca & Kruger');
  await page.click('.mb-chip input[value=safaris] + span');
  await page.click('button[type=submit]');
  await page.waitForSelector('input[name=adults]');
  await page.click('button[type=submit]');
  await page.waitForSelector('input[name=accommodation]');
  await page.type('input[name=accommodation]', 'Beach lodge');
  await page.click('button[type=submit]');
  await page.waitForSelector('input[name=name]');
  await page.type('input[name=name]', 'E2E Custom');
  await page.type('input[name=email]', `e2e-custom-${run}@example.com`);
  await page.type('input[name=phone]', '+27 82 000 0000');
  await page.click('button[type=submit]');
  await page.waitForSelector('.mb-detail');
  await page.click('input[name=consent]');
  await page.click('button[type=submit]');
  await page.waitForSelector('.mb-ref', { timeout: 15000 });
  assert.match(await page.$eval('.mb-ref', el => el.textContent), /^TR-/);
  await page.close();
});

test('account: register → dashboard → sign out → sign in', async () => {
  const page = await open('/pages/account.html?tab=register');
  await page.waitForSelector('input[name=name]');
  await page.type('input[name=name]', 'Cliente E2E');
  await page.type('input[name=email]', `e2e-account-${run}@example.com`);
  await page.type('input[name=password]', 'e2e-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-logout]', { timeout: 10000 });
  assert.match(await page.$eval('.mb-panel h2', el => el.textContent), /Cliente/);
  await page.screenshot({ path: path.join(SHOTS, 'account-dashboard.png'), fullPage: true });
  await page.click('[data-logout]');
  await page.waitForSelector('input[name=password]');
  await page.type('input[name=email]', `e2e-account-${run}@example.com`);
  await page.type('input[name=password]', 'e2e-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-logout]', { timeout: 10000 });
  // Account link in the navbar shows the signed-in state
  await page.goto(BASE + '/pages/tours.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('.navbar-account-link.is-signed-in', { timeout: 10000 });
  await page.close();
});

test('responsive: no horizontal scrolling on phones', async () => {
  for (const url of ['/pages/package.html?id=dia-de-praia-santa-maria-machangulo', '/pages/account.html', '/en/custom-tour.html', '/pages/booking-status.html', '/pages/privacy.html']) {
    const page = await open(url, { mobile: true });
    await sleep(800);
    assert.ok(await noHorizontalScroll(page), `${url} scrolls horizontally on mobile`);
    await page.screenshot({ path: path.join(SHOTS, `mobile-${url.replace(/\W+/g, '_')}.png`), fullPage: true });
    await page.close();
  }
});

test('no JavaScript errors were logged', () => {
  assert.deepEqual(errors, []);
});
