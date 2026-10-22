// ─────────────────────────────────────────────────────────────────────────────
// admin.e2e.js — Browser checks of the admin dashboard against a running
// server with a dev database. Needs an admin account:
//   ADMIN_PASSWORD=... npm run create-admin -- admin@maputoblue.local "Admin"
// Env: E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { launch } from '../scripts/screenshot.js';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3100';
const EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@maputoblue.local';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'dev-admin-password-1';
const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'temporary screenshots', 'admin');
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let browser, page;
const errors = [];

before(async () => {
  browser = await launch();
  page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.setViewport({ width: 1440, height: 900 });
});
after(async () => { if (browser) await browser.close(); });

async function go(hash) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await sleep(250);
  await page.waitForFunction(() => !document.querySelector('#main .skeleton'), { timeout: 15000 });
  const alert = await page.$eval('#main', el => (el.querySelector(':scope > .card .alert, :scope > div > .card > .card__body > .alert:not(.alert--info):not(.alert--warn):not(.alert--success)') || {}).textContent || '');
  assert.equal(alert, '', `${hash} shows an error: ${alert}`);
}
const shot = name => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
async function clickText(selector, text) {
  const handles = await page.$$(selector);
  for (const h of handles) {
    if ((await h.evaluate(el => el.textContent)).includes(text)) { await h.click(); return; }
  }
  throw new Error(`No ${selector} containing "${text}"`);
}

test('non-admin and wrong credentials are refused', async () => {
  await page.goto(BASE + '/admin/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login:not([hidden])');
  await page.type('#login-form [name=email]', EMAIL);
  await page.type('#login-form [name=password]', 'wrong-password');
  await page.click('#login-form [type=submit]');
  await page.waitForFunction(() => !document.querySelector('#login-form .alert').hidden);
  assert.match(await page.$eval('#login-form .alert', el => el.textContent), /incorrectos/);
});

test('admin signs in and sees the dashboard', async () => {
  await page.$eval('#login-form [name=password]', el => { el.value = ''; });
  await page.type('#login-form [name=password]', PASSWORD);
  await page.click('#login-form [type=submit]');
  await page.waitForSelector('#app:not([hidden]) .kpis', { timeout: 15000 });
  await shot('dashboard');
});

test('every section loads without errors', async () => {
  for (const h of ['#/bookings', '#/invoices', '#/invoices/new', '#/calendar', '#/requests', '#/packages', '#/promotions', '#/media', '#/customers', '#/reviews', '#/mail', '#/settings', '#/audit']) {
    await go(h);
    await sleep(300);
    await shot(h.replace(/\W+/g, '_'));
  }
});

test('booking workflow: open a pending booking, confirm it, add a note and a payment', async () => {
  // Create a fresh pending booking through the public API (as a guest would)
  const booking = await page.evaluate(async () => {
    const cal = await fetch('/api/availability/sunset-cruise-maputo-bay').then(r => r.json());
    const day = cal.days.find(d => d.status === 'open' || d.status === 'limited').day;
    const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      package_id: 'sunset-cruise-maputo-bay', date: day, adults: 2, children: 0, locale: 'pt', consent: true,
      idempotency_key: 'e2e-admin-' + Date.now(), customer: { name: 'Admin E2E', email: 'admin-e2e@example.com', phone: '+258840000099' } }) });
    return res.json();
  });
  await go('#/bookings?status=pending');
  await page.waitForSelector(`tr[data-href="#/bookings/${booking.booking.id}"]`);
  await page.click(`tr[data-href="#/bookings/${booking.booking.id}"]`);
  await page.waitForSelector('.status-actions');
  await clickText('.status-actions button', 'Confirmar reserva');
  await page.waitForSelector('dialog.modal[open]');
  await page.type('dialog.modal textarea[name=message]', 'Até breve! Traga protector solar.');
  await page.click('dialog.modal button[type=submit]');
  await page.waitForFunction(() => /Confirmada/.test(document.querySelector('.detail-hero__title').textContent), { timeout: 10000 });
  await page.type('#note-form textarea', 'Nota de teste E2E');
  await page.click('#note-form button');
  await page.waitForFunction(() => /Nota de teste E2E/.test(document.querySelector('#main').textContent));
  // Centre it first: the sticky topbar must not cover the click target
  await page.$eval('[data-pay]', el => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-pay]');
  try { await page.waitForSelector('dialog.modal[open] [name=amount]', { timeout: 8000 }); } catch (e) { await shot('FAIL-pay'); throw e; }
  await page.$eval('dialog.modal [name=amount]', el => { el.value = '500'; });
  // Without the verification tick nothing is recorded
  await page.click('dialog.modal button[type=submit]');
  await page.waitForSelector('dialog.modal[open] .alert[data-modal-alert]');
  await page.click('dialog.modal [name=verified]');
  await page.click('dialog.modal button[type=submit]');
  await page.waitForFunction(() => /Parcial|Pago/.test(document.querySelector('.detail-hero__title').textContent), { timeout: 10000 });
  await shot('booking-detail');
});

test('invoices: unknown reference refused; issue from a reference; partial then full payment → PAGA', async () => {
  const booking = await page.evaluate(async () => {
    const cal = await fetch('/api/availability/sunset-cruise-maputo-bay').then(r => r.json());
    const day = cal.days.find(d => d.status === 'open' || d.status === 'limited').day;
    const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      package_id: 'sunset-cruise-maputo-bay', date: day, adults: 2, children: 0, locale: 'pt', consent: true,
      idempotency_key: 'e2e-inv-' + Date.now(), customer: { name: 'Factura E2E', email: 'factura-e2e@example.com', phone: '+258840000077' } }) });
    return (await res.json()).booking;
  });
  await go('#/invoices/new');
  await page.type('#lookup [name=reference]', 'MB-ZZZZZZ');
  await page.click('#lookup button[type=submit]');
  await page.waitForFunction(() => !document.getElementById('lookup-error').hidden);
  assert.match(await page.$eval('#lookup-error', el => el.textContent), /Não existe nenhuma reserva/);

  await page.$eval('#lookup [name=reference]', el => { el.value = ''; });
  await page.type('#lookup [name=reference]', booking.reference.toLowerCase());
  await page.click('#lookup button[type=submit]');
  await page.waitForSelector('#issue-form');
  assert.match(await page.$eval('.doc', el => el.textContent), new RegExp(booking.reference));
  await shot('invoice-review');
  // Issue with a partial payment that was already verified
  await page.click('#issue-form [name=with_payment]');
  await page.$eval('#issue-form [name=amount]', el => { el.value = '1000'; });
  await page.type('#issue-form [name=reference]', 'MP-E2E-1');
  await page.click('#issue-form [name=send_email]');
  await page.click('#issue-form button[type=submit]');
  await page.waitForFunction(() => /verificou/.test(document.querySelector('[data-form-error]').textContent));
  await page.click('#issue-form [name=verified]');
  await page.click('#issue-form button[type=submit]');
  await page.waitForSelector('dialog.modal[open]');
  await page.click('dialog.modal button[type=submit]');
  await page.waitForSelector('.detail-hero__title', { timeout: 15000 });
  const title = await page.$eval('.detail-hero__title', el => el.textContent);
  assert.match(title, /FT \d{4}\/\d{4}/);
  assert.match(title, /Parcialmente paga/);
  await shot('invoice-detail-partial');
  // Record the rest from the invoice → PAGA
  await page.$eval('[data-pay]', el => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-pay]');
  await page.waitForSelector('dialog.modal[open] [name=amount]');
  assert.equal(await page.$eval('dialog.modal [name=amount]', el => el.value), '2600');
  await page.click('dialog.modal [name=verified]');
  await page.click('dialog.modal button[type=submit]');
  await page.waitForFunction(() => /Pago/.test(document.querySelector('.detail-hero__title').textContent), { timeout: 10000 });
  // Headless Chrome answers fetch() of any response carrying Content-Disposition with an
  // empty 204, so the document is checked over HTTP with the same session cookie.
  const href = await page.$eval('a[href$="/pdf"]', a => a.href);
  assert.match(href, /\/api\/admin\/invoices\/[0-9a-f-]{36}\/pdf$/);
  const cookie = (await page.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(href, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  await shot('invoice-detail-paid');
  // Duplicate attempt from the reference screen points to the existing invoice
  await go(`#/invoices/new?ref=${booking.reference}`);
  await page.waitForFunction(() => /já emitida/i.test(document.getElementById('review').textContent), { timeout: 10000 });
  await go('#/invoices');
  await page.waitForSelector('#summary .kpi');
  await shot('invoices');
});

test('package editor: change a price, see the preview, save, and restore', async () => {
  const before = await page.evaluate(() => fetch('/api/catalog/packages/sunset-cruise-maputo-bay').then(r => r.json()));
  const base = before.price_from;
  await go('#/packages/sunset-cruise-maputo-bay');
  await clickText('.tab', 'Preços');
  await page.waitForSelector('[data-p=adult]');
  await page.$eval('[data-p=adult]', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, base + 100);
  await page.click('#pv-run');
  try { await page.waitForSelector('#pv-out .diff', { timeout: 8000 }); } catch (e) { await shot('FAIL-pricing'); throw e; }
  const totals = await page.$$eval('#pv-out .diff strong', els => els.map(e => Number(e.textContent.replace(/\D/g, ''))));
  assert.deepEqual(totals, [base * 2, (base + 100) * 2]);
  await shot('package-pricing');
  await page.click('#save');
  await page.waitForFunction(() => document.getElementById('dirty').hidden, { timeout: 10000 });
  const pub = await page.evaluate(() => fetch('/api/catalog/packages/sunset-cruise-maputo-bay').then(r => r.json()));
  assert.equal(pub.price_from, base + 100);
  // Restore the previous version
  await clickText('.tab', 'Revisões');
  await page.waitForSelector('[data-restore]');
  await page.click('[data-restore]');
  await page.waitForSelector('dialog.modal[open]');
  await page.click('dialog.modal button[type=submit]');
  await sleep(1500);
  const back = await page.evaluate(() => fetch('/api/catalog/packages/sunset-cruise-maputo-bay').then(r => r.json()));
  assert.equal(back.price_from, base);
  for (const t of ['Geral', 'Conteúdo', 'Imagens', 'Disponibilidade', 'SEO']) { await clickText('.tab', t); await sleep(200); }
  await clickText('.tab', 'Imagens');
  await shot('package-images');
});

test('calendar: set capacity on a day and see it publicly', async () => {
  await go('#/calendar?id=farol-inhaca-tour');
  await page.waitForSelector('.cal__day');
  const day = await page.$$eval('.cal__day:not(.cal__day--closed)', els => els[els.length - 1].dataset.day);
  await page.click(`.cal__day[data-day="${day}"]`);
  await page.select('#days-form [name=op]', 'capacity');
  await page.$eval('#days-form [name=capacity]', el => { el.value = '7'; });
  await page.click('#days-form [type=submit]');
  await page.waitForFunction(d => /7\/7 livres|livres de 7/.test(document.querySelector(`.cal__day[data-day="${d}"]`).textContent + document.getElementById('day-info').textContent), { timeout: 10000 }, day);
  const pub = await page.evaluate(d => fetch(`/api/availability/farol-inhaca-tour?from=${d}&to=${d}`).then(r => r.json()), day);
  assert.equal(pub.days[0].remaining, 7);
  await shot('calendar');
});

test('promotion: create one from the dashboard', async () => {
  await go('#/promotions');
  await page.click('#new');
  await page.waitForSelector('dialog.modal[open] [name=name]');
  await page.type('dialog.modal [name=name]', 'E2E Promo');
  await page.type('dialog.modal [name=code]', `E2E${Date.now().toString(36).toUpperCase()}`);
  await page.click('dialog.modal button[type=submit]');
  await page.waitForFunction(() => /E2E Promo/.test(document.querySelector('#list').textContent), { timeout: 10000 });
});

test('media: upload an image (converted to WebP)', async () => {
  await go('#/media');
  const tmp = path.join(SHOTS, 'upload-test.png');
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#00bcd4' } }).png().toFile(tmp);
  await page.select('#folder', 'tours/sea-activities');
  await sleep(500);
  const input = await page.$('#files');
  await input.uploadFile(tmp);
  await page.waitForFunction(() => /upload-test/.test(document.getElementById('grid').textContent), { timeout: 15000 });
  // Clean up: delete the uploaded (unused) file through the UI
  const del = await page.$('[data-del*="upload-test"]');
  await del.click();
  await page.waitForSelector('dialog.modal[open]');
  await page.click('dialog.modal button[type=submit]');
  await page.waitForFunction(() => !/upload-test/.test(document.getElementById('grid').textContent), { timeout: 10000 });
  fs.rmSync(tmp, { force: true });
});

test('mobile layout: sidebar toggles and no horizontal scroll', async () => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const h of ['#/dashboard', '#/bookings', '#/invoices', '#/invoices/new', '#/calendar', '#/requests', '#/packages', '#/packages/sunset-cruise-maputo-bay', '#/promotions', '#/media', '#/customers', '#/reviews', '#/mail', '#/settings', '#/audit']) {
    await go(h);
    await sleep(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `horizontal scroll on mobile: ${h}`);
  }
  await go('#/bookings');
  await page.click('#menu-toggle');
  await page.waitForSelector('.sidebar.is-open');
  await shot('mobile-menu');
  await page.click('#sidebar-backdrop');
  await go('#/dashboard');
  await shot('mobile-dashboard');
  await page.setViewport({ width: 1440, height: 900 });
});

test('no JavaScript errors were logged', () => {
  assert.deepEqual(errors, []);
});
