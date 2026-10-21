// Administration workflow: catalogue, prices, availability, images, history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { setup, client, adminClient, bookingBody, nextWeekday } from './helpers.js';

let ctx, admin;
before(async () => {
  ctx = await setup();
  admin = await adminClient(ctx.app, ctx.pool);
});
after(async () => ctx && ctx.close());

const newPackage = {
  id: 'kayak-inhaca-test', kind: 'tour', category: 'island-daytrips', status: 'published',
  content: { title: 'Kayak em Inhaca <script>alert(1)</script>', title_en: 'Inhaca Kayak', description: 'Remar nos mangais.',
    location: 'Inhaca', duration: '4 horas', images: [], itinerary: [] },
  pricing: { currency: 'MZN', unit: 'per_person', adult: 3000, child: 2000,
    extras: [{ key: 'lunch', name: 'Almoço', name_en: 'Lunch', price: 800, per: 'person' }],
    transfers: [{ key: 'hotel', name: 'Transfer privado', name_en: 'Private transfer', price: 1500, per: 'booking' }] },
  availability: { unit: 'pax', default_capacity: 6 },
};

let historical;

test('1–2. admin creates a package and it appears on the public site', async () => {
  const r = await admin.post('/api/admin/packages', newPackage);
  assert.equal(r.status, 201, r.raw);
  const pub = await client(ctx.app).get('/api/catalog/tours');
  const p = pub.body.find(x => x.id === newPackage.id);
  assert.ok(p, 'package listed publicly');
  assert.equal(p.price_from, 3000);
  assert.equal(p.title.includes('<'), false, 'HTML stripped from content');
  assert.equal(p.booking.extras[0].key, 'lunch');
  // Unknown categories are refused
  const bad = await admin.post('/api/admin/packages', { ...newPackage, id: 'bad-cat', category: 'space-travel' });
  assert.equal(bad.status, 400);
});

test('booking with extras + transfer before the price change (historical snapshot)', async () => {
  const res = await client(ctx.app).post('/api/bookings', bookingBody({ package_id: newPackage.id, adults: 2, children: 1, extras: ['lunch'], transfer_key: 'hotel' }));
  assert.equal(res.status, 201, res.raw);
  // 2×3000 + 2000 + 3×800 + 1500
  assert.equal(res.body.booking.total, 11900);
  historical = res.body.booking;
});

test('3–4. admin updates the price; new quotes use it; old bookings keep their snapshot', async () => {
  const cur = await admin.get(`/api/admin/packages/${newPackage.id}`);
  const preview = await admin.post(`/api/admin/packages/${newPackage.id}/pricing-preview`, {
    pricing: { ...cur.body.package.pricing, adult: 3500 }, date: nextWeekday(3), adults: 2 });
  assert.equal(preview.body.current.total, 6000);
  assert.equal(preview.body.proposed.total, 7000);
  const upd = await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur.body.package.version, pricing: { ...cur.body.package.pricing, adult: 3500 } });
  assert.equal(upd.status, 200, upd.raw);
  // Stale version is rejected (optimistic locking)
  const stale = await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur.body.package.version, status: 'draft' });
  assert.equal(stale.status, 409);
  const q = await client(ctx.app).post('/api/quote', { package_id: newPackage.id, date: nextWeekday(3), adults: 2 });
  assert.equal(q.body.total, 7000);
  const { rows: [b] } = await ctx.pool.query('select total, price_snapshot from bookings where id = $1', [historical.id]);
  assert.equal(b.total, 11900);
  assert.equal(b.price_snapshot.quote.unit_prices.adult, 3000);
  // Revision history recorded, and restore works
  const det = await admin.get(`/api/admin/packages/${newPackage.id}`);
  assert.ok(det.body.revisions.length >= 2);
  const restore = await admin.post(`/api/admin/packages/${newPackage.id}/restore/1`);
  assert.equal(restore.status, 200);
  assert.equal(restore.body.pricing.adult, 3000);
});

test('seasonal + date-specific price rules', async () => {
  const xmas = '2026-12-24';
  const r = await admin.post(`/api/admin/packages/${newPackage.id}/rules`, { label: 'Natal', date_from: '2026-12-20', date_to: '2026-12-31', adult: 4500, priority: 5 });
  assert.equal(r.status, 201, r.raw);
  const q = await client(ctx.app).post('/api/quote', { package_id: newPackage.id, date: xmas, adults: 1 });
  assert.equal(q.body.total, 4500);
  assert.equal(q.body.price_rule.label, 'Natal');
  assert.equal((await admin.del(`/api/admin/rules/${r.body.id}`)).status, 200);
  const q2 = await client(ctx.app).post('/api/quote', { package_id: newPackage.id, date: xmas, adults: 1 });
  assert.equal(q2.body.total, 3000);
});

test('5–6. availability changes are reflected publicly and validated against confirmed bookings', async () => {
  const date = historical.start_date;
  let cal = await client(ctx.app).get(`/api/availability/${newPackage.id}?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].remaining, 3); // capacity 6 − 3 pending
  await admin.post(`/api/admin/bookings/${historical.id}/status`, { to: 'confirmed' });
  const conflict = await admin.put(`/api/admin/availability/${newPackage.id}/days`, { from: date, to: date, capacity: 2 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'availability_conflict');
  const closeConflict = await admin.put(`/api/admin/availability/${newPackage.id}/days`, { from: date, to: date, closed: true });
  assert.equal(closeConflict.status, 409);
  const ok = await admin.put(`/api/admin/availability/${newPackage.id}/days`, { from: date, to: date, capacity: 4 });
  assert.equal(ok.status, 200);
  cal = await client(ctx.app).get(`/api/availability/${newPackage.id}?from=${date}&to=${date}`);
  assert.equal(cal.body.days[0].remaining, 1);
  assert.equal(cal.body.days[0].status, 'limited');
  const adm = await admin.get(`/api/admin/availability/${newPackage.id}?from=${date}&to=${date}`);
  assert.equal(adm.body.days[0].bookings[0].reference, historical.reference);
  // Weekday/season model
  const cur = await admin.get(`/api/admin/packages/${newPackage.id}`);
  await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur.body.package.version,
    availability: { ...cur.body.package.availability, seasons: [{ from: '06-01', to: '11-30' }] } });
  cal = await client(ctx.app).get(`/api/availability/${newPackage.id}?from=2026-12-10&to=2026-12-10`);
  assert.equal(cal.body.days[0].status, 'closed');
  assert.equal(cal.body.days[0].reason, 'out_of_season');
});

test('7–8. admin uploads images, reorders the gallery, sets cover and alt; changes persist', async () => {
  const png = await sharp({ create: { width: 2600, height: 1200, channels: 3, background: '#1EA896' } }).png().toBuffer();
  const boundary = '----mbtest';
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\ntours/test\r\n`),
    ...['Praia Azul.png', 'praia-azul.png'].flatMap(name => [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from('\r\n')]),
    Buffer.from(`--${boundary}--\r\n`),
  ];
  const up = await admin.raw('POST', '/api/admin/media/upload', Buffer.concat(parts), { 'content-type': `multipart/form-data; boundary=${boundary}` });
  assert.equal(up.status, 201, up.raw);
  assert.deepEqual(up.body.map(f => f.path), ['assets/images/tours/test/praia-azul.webp', 'assets/images/tours/test/praia-azul-2.webp']);
  assert.equal(up.body[0].width, 2000); // resized
  assert.ok(fs.existsSync(path.join(ctx.siteRoot, 'assets/images/tours/test/praia-azul.webp')));

  // A file that is not an image is rejected even with an image extension
  const fake = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folder"\r\n\r\ntours/test\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evil.png"\r\nContent-Type: image/png\r\n\r\n<?php echo 1; ?>\r\n--${boundary}--\r\n`)]);
  assert.equal((await admin.raw('POST', '/api/admin/media/upload', fake, { 'content-type': `multipart/form-data; boundary=${boundary}` })).status, 400);

  const cur = await admin.get(`/api/admin/packages/${newPackage.id}`);
  const images = [up.body[1].content_path, up.body[0].content_path]; // reordered
  const save = await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur.body.package.version,
    content: { ...cur.body.package.content, images, cover: up.body[0].content_path } });
  assert.equal(save.status, 200, save.raw);
  const alt = await admin.patch('/api/admin/media', { path: up.body[0].path, alt: 'Praia azul em Inhaca', alt_en: 'Blue beach in Inhaca' });
  assert.equal(alt.status, 200, alt.raw);
  const pub = await client(ctx.app).get(`/api/catalog/packages/${newPackage.id}`);
  assert.deepEqual(pub.body.images, images);
  assert.equal(pub.body.cover, up.body[0].content_path);
  assert.equal(pub.body.image_alts[up.body[0].content_path].en, 'Blue beach in Inhaca');
  // In-use image cannot be deleted; after removing it from the gallery it can
  assert.equal((await admin.del(`/api/admin/media?path=${up.body[1].path}`)).status, 409);
  const cur2 = await admin.get(`/api/admin/packages/${newPackage.id}`);
  const removed = await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur2.body.package.version,
    content: { ...cur2.body.package.content, images: [up.body[0].content_path] } });
  assert.equal(removed.status, 200, removed.raw);
  const delOk = await admin.del(`/api/admin/media?path=${up.body[1].path}`);
  assert.equal(delOk.status, 200, delOk.raw);
  // Invalid image paths in content are refused
  const cur3 = await admin.get(`/api/admin/packages/${newPackage.id}`);
  const bad = await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur3.body.package.version,
    content: { ...cur3.body.package.content, images: ['javascript:alert(1)'] } });
  assert.equal(bad.status, 400);
});

test('unpublished packages are hidden and cannot be booked', async () => {
  const cur = await admin.get(`/api/admin/packages/${newPackage.id}`);
  await admin.put(`/api/admin/packages/${newPackage.id}`, { version: cur.body.package.version, status: 'draft' });
  const g = client(ctx.app);
  assert.equal((await g.get(`/api/catalog/packages/${newPackage.id}`)).status, 404);
  assert.equal((await g.post('/api/bookings', bookingBody({ package_id: newPackage.id }))).status, 404);
  // …but the admin can preview it
  assert.equal((await admin.get(`/api/admin/packages/${newPackage.id}/public`)).status, 200);
});

test('promotions apply automatically or with a code and are validated', async () => {
  const p = await admin.post('/api/admin/promotions', { name: 'Black Friday', code: 'bf25', kind: 'percent', value: 25, package_ids: ['sunset-cruise-maputo-bay'] });
  assert.equal(p.status, 201, p.raw);
  assert.equal((await admin.post('/api/admin/promotions', { name: 'Bad', kind: 'percent', value: 150 })).status, 400);
  const g = client(ctx.app);
  const date = nextWeekday(3);
  const noCode = await g.post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date, adults: 2 });
  assert.equal(noCode.body.discount_total, 0);
  const withCode = await g.post('/api/quote', { package_id: 'sunset-cruise-maputo-bay', date, adults: 2, promo_code: 'BF25' });
  assert.equal(withCode.body.total, 2700);
  const book = await g.post('/api/bookings', bookingBody({ adults: 2, promo_code: 'bf25' }));
  assert.equal(book.body.booking.total, 2700);
  const { rows: [pr] } = await ctx.pool.query('select used_count from promotions where id = $1', [p.body.id]);
  assert.equal(pr.used_count, 1);
});

test('settings validation and audit trail', async () => {
  assert.equal((await admin.put('/api/admin/settings/loyalty', { kind: 'percent', value: 120 })).status, 400);
  const ok = await admin.put('/api/admin/settings/booking', { pending_hold_hours: 24 });
  assert.equal(ok.body.pending_hold_hours, 24);
  const log = await admin.get('/api/admin/audit?entity_type=settings');
  assert.ok(log.body.items.some(i => i.entity_id === 'booking' && i.action === 'updated'));
});
