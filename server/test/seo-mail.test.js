// robots.txt / sitemap.xml and e-mail template rendering.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, client } from './helpers.js';
import { renderTemplate, TEMPLATE_NAMES } from '../src/lib/mail-templates.js';

let ctx;
before(async () => { ctx = await setup(); });
after(async () => ctx && ctx.close());

test('robots.txt blocks private areas and points to the sitemap', async () => {
  const r = await client(ctx.app).get('/robots.txt');
  assert.equal(r.status, 200);
  for (const p of ['/admin/', '/api/', '/pages/account.html', '/en/booking-status.html', '/pages/quote.html']) assert.ok(r.raw.includes(`Disallow: ${p}`), p);
  assert.match(r.raw, /Sitemap: http:\/\/localhost\/sitemap\.xml/);
});

test('sitemap lists published packages in both languages with hreflang, not drafts', async () => {
  await ctx.pool.query(`update packages set status = 'draft' where id = 'maputo-city-tour'`);
  const r = await client(ctx.app).get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /xml/);
  assert.ok(r.raw.includes('/pages/package.html?id=sunset-cruise-maputo-bay'));
  assert.ok(r.raw.includes('/en/package.html?id=villa-martins-inhaca&amp;type=accommodation'));
  assert.ok(!r.raw.includes('id=maputo-city-tour'));
  assert.ok(r.raw.includes('hreflang="en"'));
  assert.ok(!r.raw.includes('account.html'));
});

test('every e-mail template renders in PT and EN and escapes user input', () => {
  const data = {
    reference: 'MB-ABC123', customer_name: '<script>x</script>', name: '<b>João</b>', email: 'a@b.c', phone: '+258',
    package_title: 'Sunset', start_date: '2026-11-01', end_date: '2026-11-01', adults: 2, children: 1, total: 3600, currency: 'MZN',
    status: 'confirmed', event: 'confirmed', message: '<img src=x onerror=1>', url: 'https://x/y', items: [{ description: 'Safari', quantity: 2, unit_price: 100 }],
    valid_until: '2026-12-01', destination: 'Inhaca',
  };
  for (const name of TEMPLATE_NAMES) {
    for (const locale of ['pt', 'en']) {
      const m = renderTemplate(name, locale, data);
      assert.ok(m.subject && m.html && m.text, `${name}/${locale}`);
      assert.ok(!m.html.includes('<script>x</script>'), `${name} escapes names`);
      assert.ok(!m.html.includes('<img src=x'), `${name} escapes messages`);
    }
  }
  assert.match(renderTemplate('booking_received', 'en', data).subject, /Booking request/);
  assert.match(renderTemplate('booking_received', 'pt', data).subject, /Pedido de reserva/);
});

test('package pages get server-rendered title, canonical, Open Graph and JSON-LD (real data only)', async () => {
  const g = client(ctx.app);
  const r = await g.get('/pages/package.html?id=kruger-national-park-day-trip');
  assert.equal(r.status, 200);
  assert.match(r.raw, /<title>Kruger National Park Day Trip \| Maputo Blue<\/title>/);
  assert.match(r.raw, /<link rel="canonical" href="http:\/\/localhost\/pages\/package\.html\?id=kruger-national-park-day-trip">/);
  assert.match(r.raw, /hreflang="en" href="http:\/\/localhost\/en\/package\.html\?id=kruger-national-park-day-trip"/);
  assert.match(r.raw, /<meta property="og:image" content="http:\/\/localhost\/assets\/images\//);
  const ld = JSON.parse(r.raw.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(ld['@type'], 'TouristTrip');
  assert.equal(ld.offers.priceCurrency, 'MZN');
  assert.equal(ld.offers.price, '13500');
  assert.equal(ld.aggregateRating, undefined, 'no rating without real reviews');
  // With a published review the rating appears
  await ctx.pool.query(`insert into reviews (package_id, name, rating, comment) values ('kruger-national-park-day-trip','Ana',5,'Óptimo')`);
  const r2 = await g.get('/en/package.html?id=kruger-national-park-day-trip');
  const ld2 = JSON.parse(r2.raw.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(ld2.aggregateRating.reviewCount, 1);
  assert.match(r2.raw, /<link rel="canonical" href="http:\/\/localhost\/en\/package\.html/);
  // Unknown or unpublished ids are not indexed
  const r3 = await g.get('/pages/package.html?id=does-not-exist');
  assert.match(r3.raw, /<meta name="robots" content="noindex, follow">/);
  // Script injection through the id is impossible (strict id pattern)
  const r4 = await g.get('/pages/package.html?id=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.ok(!r4.raw.includes('<script>alert(1)'));
});

test('image variants: whitelisted widths and paths only', async () => {
  const g = client(ctx.app);
  assert.equal((await g.raw('GET', '/img/800/assets/images/../../server/.env')).status, 404);
  assert.equal((await g.raw('GET', '/img/777/logo.webp')).status, 404);
  assert.equal((await g.raw('GET', '/img/400/server/src/app.js')).status, 404);
});
