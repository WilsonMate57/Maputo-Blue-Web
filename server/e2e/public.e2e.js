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
  try { await page.waitForSelector('dialog.mb-dialog[open] form', { timeout: 8000 }); }
  catch (e) { await page.screenshot({ path: path.join(SHOTS, 'FAIL-dialog.png') }); console.log('dlg', await page.evaluate(() => [document.querySelector('dialog.mb-dialog')?.open, document.querySelector('.mb-cal__hint')?.textContent, document.getElementById('booking-total').textContent])); throw e; }
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
  booking = { ref, statusHref: await page.$eval('dialog .mb-dialog__actions a[href*="booking-status"]', a => a.href), ticketHref: await page.$eval('dialog .mb-dialog__actions a[href*="ticket.html"]', a => a.href) };
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

test('ticket: from the confirmation to the ticket page, PDF download and QR verification', async () => {
  const page = await open(new URL(booking.ticketHref).pathname + new URL(booking.ticketHref).search);
  await page.waitForSelector('.ticket', { timeout: 15000 });
  assert.equal(await page.$eval('.ticket__ref strong', el => el.textContent.trim()), booking.ref);
  assert.match(await page.$eval('.ticket .mb-status', el => el.textContent), /Pendente/);
  assert.ok(await page.$('.ticket__qr svg'), 'QR rendered');
  // The PDF endpoint used by the download button returns a real PDF
  const pdf = await page.evaluate(async (ref, token) => {
    const r = await fetch('/api/bookings/ticket.pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref, token }) });
    const buf = new Uint8Array(await r.arrayBuffer());
    return { type: r.headers.get('content-type'), head: String.fromCharCode(...buf.slice(0, 5)), size: buf.length };
  }, booking.ref, new URL(booking.statusHref).searchParams.get('token'));
  assert.match(pdf.type, /application\/pdf/);
  assert.equal(pdf.head, '%PDF-');
  // Download button works without errors
  await page.click('[data-act=pdf]');
  await sleep(800);
  assert.equal(await page.$eval('.ticket-wrap .mb-alert, #portal-root > .mb-alert', el => el.hidden).catch(() => true), true);
  // Copy reference
  await page.click('[data-act=copy]');
  // QR → verification page shows the live (pending) status and no personal data
  const verifyHref = await page.evaluate(async (ref, token) => (await (await fetch('/api/bookings/ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: ref, token }) })).json()).ticket.verify_url, booking.ref, new URL(booking.statusHref).searchParams.get('token'));
  const v = await open(new URL(verifyHref).pathname + new URL(verifyHref).search, { mobile: true });
  await v.waitForSelector('.verify__result');
  assert.match(await v.$eval('.verify__result h2', el => el.textContent), /pendente/i);
  assert.ok(!(await v.$eval('.verify', el => el.textContent)).includes('Teste E2E'), 'no customer name on the public page');
  assert.ok(await noHorizontalScroll(v));
  await v.screenshot({ path: path.join(SHOTS, 'verify-mobile.png') });
  await page.close(); await v.close();
});

test('custom tour request: steps → summary → reference', async () => {
  const page = await open('/en/custom-tour.html');
  await page.waitForSelector('.qp-card[data-key="sunset-cruise-maputo-bay"]');
  // Nothing chosen and no idea described → asked to choose
  await page.click('button[type=submit]');
  await page.waitForSelector('.mb-form-msg .mb-alert');
  await page.click('.qp-card[data-key="sunset-cruise-maputo-bay"]');
  await page.click('.qp-card[data-key="svc:boat-charter"]');
  assert.equal(await page.$eval('.qp__count', el => el.textContent), '2 selected');
  await page.type('textarea[name=activities]', 'Inhaca & Kruger');
  // Viewport only: a full-page capture of the image grid makes headless Chrome fail to capture
  await page.screenshot({ path: path.join(SHOTS, 'quote-picker.png') });
  await page.click('button[type=submit]');
  await page.waitForSelector('input[name=adults]');
  assert.equal(await page.$$eval('[data-item-date]', els => els.length), 2);
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
  assert.equal(await page.$$eval('.qp-sum li', els => els.length), 2);
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
  assert.match(await page.$eval('.acct__profile strong', el => el.textContent), /Cliente/);
  await page.screenshot({ path: path.join(SHOTS, 'account-dashboard.png'), fullPage: true });
  // Invoices tab: issued invoices only — none yet for a new account
  await page.click('[data-tab=invoices]');
  await page.waitForFunction(() => /Ainda não há facturas/.test(document.querySelector('#account-pane').textContent), { timeout: 10000 });
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
  for (const url of ['/pages/package.html?id=dia-de-praia-santa-maria-machangulo', '/pages/account.html', '/en/custom-tour.html', '/pages/booking-status.html', '/pages/privacy.html', '/pages/tours.html', '/en/verify.html', '/pages/ticket.html']) {
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
