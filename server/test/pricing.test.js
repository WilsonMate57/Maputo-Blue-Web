// Unit tests for the pure pricing engine and legacy mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote, matchRule } from '../src/lib/pricing.js';
import { pricingFromLegacy, legacyPriceFields, validatePricing } from '../src/lib/pricing-model.js';

const base = { id: 'p', kind: 'tour', category: 'island-daytrips' };
const pricing = validatePricing({ currency: 'MZN', unit: 'per_person', adult: 6000, child: 5000,
  extras: [{ key: 'lunch', name: 'Almoço', price: 1000, per: 'person' }, { key: 'photos', name: 'Fotos', price: 2500, per: 'booking' }],
  transfers: [{ key: 'hotel', name: 'Transfer do hotel', price: 1500, per: 'booking' }] });
const today = '2026-10-21';

test('per-person total with children, extras and transfer', () => {
  const q = computeQuote({ pkg: { ...base, pricing }, rules: [], today,
    input: { date: '2026-11-07', adults: 2, children: 1, extras: ['lunch', 'photos'], transfer_key: 'hotel' } });
  // 2×6000 + 1×5000 + 3×1000 + 2500 + 1500
  assert.equal(q.subtotal, 24000);
  assert.equal(q.total, 24000);
  assert.equal(q.lines.length, 5);
});

test('weekday rule overrides adult & child price (Mon–Thu)', () => {
  const rules = [{ id: 1, label: 'Mon-Thu', weekdays: [1, 2, 3, 4], adult: 5000, child: 2750, priority: 10, active: true }];
  const mon = computeQuote({ pkg: { ...base, pricing }, rules, today, input: { date: '2026-10-26', adults: 1, children: 1 } });
  const sat = computeQuote({ pkg: { ...base, pricing }, rules, today, input: { date: '2026-10-31', adults: 1, children: 1 } });
  assert.equal(mon.total, 7750);
  assert.equal(sat.total, 11000);
});

test('date-specific rule beats a weekday rule of equal priority', () => {
  const rules = [
    { id: 1, label: 'wd', weekdays: [1, 2, 3, 4], adult: 5000, priority: 10, active: true },
    { id: 2, label: 'xmas', date_from: '2026-12-21', date_to: '2026-12-31', adult: 9000, priority: 10, active: true },
  ];
  assert.equal(matchRule(rules, '2026-12-22', null).id, 2);
  assert.equal(matchRule(rules, '2026-12-15', null).id, 1);
});

test('children without a child price pay the adult price; "on_request" is flagged', () => {
  const p1 = validatePricing({ currency: 'MZN', unit: 'per_person', adult: 1250, child: null });
  assert.equal(computeQuote({ pkg: { ...base, pricing: p1 }, rules: [], today, input: { date: '2026-11-01', adults: 1, children: 2 } }).total, 3750);
  const p2 = validatePricing({ currency: 'MZN', unit: 'per_person', adult: 19950, child: 'on_request' });
  const q = computeQuote({ pkg: { ...base, pricing: p2 }, rules: [], today, input: { date: '2026-11-01', adults: 2, children: 1 } });
  assert.equal(q.total, 39900);
  assert.equal(q.child_price_on_request, true);
});

test('per-group (boat) pricing ignores passenger count and enforces option capacity', () => {
  const p = validatePricing({ currency: 'MZN', unit: 'per_group', adult: 27000, options: [
    { key: 'small', name: 'Lancha Pequena', price: 27000, max_pax: 3 }, { key: 'big', name: 'Lancha Média', price: 45000, max_pax: 8 }] });
  const q = computeQuote({ pkg: { ...base, pricing: p }, rules: [], today, input: { date: '2026-11-01', adults: 5, children: 0, option_key: 'big' } });
  assert.equal(q.total, 45000);
  assert.throws(() => computeQuote({ pkg: { ...base, pricing: p }, rules: [], today, input: { date: '2026-11-01', adults: 5, option_key: 'small' } }),
    e => e.details.includes('option_capacity'));
  assert.throws(() => computeQuote({ pkg: { ...base, pricing: p }, rules: [], today, input: { date: '2026-11-01', adults: 2 } }),
    e => e.details.includes('option_required'));
});

test('promotions: best non-combinable vs combinable sum, code required, caps', () => {
  const promos = [
    { id: 'a', name: '10%', kind: 'percent', value: 10, active: true, combinable: false },
    { id: 'b', name: '500 off', kind: 'fixed', value: 500, active: true, combinable: true },
    { id: 'c', name: '700 off', kind: 'fixed', value: 700, active: true, combinable: true },
    { id: 'd', name: 'CODE 50%', kind: 'percent', value: 50, max_discount: 3000, code: 'VIP', active: true, combinable: false },
    { id: 'e', name: 'expired', kind: 'percent', value: 90, ends_at: '2026-01-01', active: true },
  ];
  const run = code => computeQuote({ pkg: { ...base, pricing }, rules: [], today, promotions: promos,
    input: { date: '2026-11-07', adults: 2, children: 0, promo_code: code } });
  const noCode = run(null);        // subtotal 12000: 10% = 1200 vs 500+700 = 1200 → tie: single wins
  assert.equal(noCode.discount_total, 1200);
  const vip = run('vip');           // 50% of 12000 = 6000 capped at 3000
  assert.equal(vip.discount_total, 3000);
  assert.equal(vip.total, 9000);
  const bad = run('NOPE');
  assert.ok(bad.notes.includes('promo_code_not_applied'));
});

test('loyalty discount only when eligible; not combined unless allowed', () => {
  const promos = [{ id: 'a', name: '10%', kind: 'percent', value: 10, active: true }];
  const loyalty = { eligible: true, kind: 'percent', value: 15, combinable_with_promotions: false };
  const q = computeQuote({ pkg: { ...base, pricing }, rules: [], today, promotions: promos, loyalty,
    input: { date: '2026-11-07', adults: 2, children: 0 } });
  assert.deepEqual(q.discounts.map(d => d.source), ['loyalty']);
  assert.equal(q.discount_total, 1800);
  const q2 = computeQuote({ pkg: { ...base, pricing }, rules: [], today, promotions: promos, loyalty: { ...loyalty, combinable_with_promotions: true },
    input: { date: '2026-11-07', adults: 2, children: 0 } });
  assert.equal(q2.discount_total, 3000);
  const q3 = computeQuote({ pkg: { ...base, pricing }, rules: [], today, loyalty: { ...loyalty, eligible: false },
    input: { date: '2026-11-07', adults: 2, children: 0 } });
  assert.equal(q3.discount_total, 0);
});

test('invalid extras / transfers / limits are rejected', () => {
  const pk = { ...base, pricing };
  assert.throws(() => computeQuote({ pkg: pk, rules: [], today, input: { date: '2026-11-07', adults: 1, extras: ['nope'] } }));
  assert.throws(() => computeQuote({ pkg: pk, rules: [], today, input: { date: '2026-11-07', adults: 1, transfer_key: 'nope' } }));
  assert.throws(() => computeQuote({ pkg: pk, rules: [], today, input: { date: '2026-11-07', adults: 0 } }));
  assert.throws(() => computeQuote({ pkg: pk, rules: [], today, input: { date: '2026-11-07', adults: 21 } }));
});

test('legacy mapping round-trips the public price fields', () => {
  const item = { price_from: 3600, price_weekday: 5500, child_price: 1750, child_price_weekday: 2750, currency: 'MZN' };
  const { pricing: p, rules } = pricingFromLegacy(item, 'tour');
  const out = legacyPriceFields({ kind: 'tour', pricing: p }, rules.map((r, i) => ({ ...r, id: i + 1, active: true })));
  assert.deepEqual(out, { currency: 'MZN', price_from: 3600, child_price: 1750, price_weekday: 5500, child_price_weekday: 2750 });
  const boat = pricingFromLegacy({ price_from: 27000, price_unit: '/barco', currency: 'MZN',
    boat_options: [{ key: 'lancha-pequena', name: 'Lancha Pequena', capacity: 'Até 3 Passageiros', price_mzn: 27000 }] }, 'tour');
  assert.equal(boat.pricing.unit, 'per_group');
  assert.equal(boat.pricing.options[0].max_pax, 3);
});
