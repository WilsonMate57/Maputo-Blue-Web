// ─────────────────────────────────────────────────────────────────────────────
// pricing-model.js — Structured pricing model, its validation, and the mapping
// to/from the legacy JSON fields used by the public site (price_from,
// price_weekday, child_price, boat_options, …).
//
// pricing = {
//   currency: 'MZN',
//   unit: 'per_person' | 'per_group' | 'per_night',
//   adult: number,                       // base adult (or group/night) price
//   child: number | 'on_request' | null, // null → children pay the adult price
//   options: [{ key, name, name_en, price, child_price?, price_usd?,
//               max_pax?, capacity_text?, capacity_text_en? }],
//   option_required: boolean,
//   extras:    [{ key, name, name_en, price, per: 'person'|'booking'|'night', active }],
//   transfers: [{ key, name, name_en, price, per: 'person'|'booking', active }],
//   limits: { adults_min, adults_max, children_max, pax_max },
//   nights: number                       // accommodation stay length (0 for tours)
// }
// ─────────────────────────────────────────────────────────────────────────────
import { badRequest } from './errors.js';

const KEY_RE = /^[a-z0-9][a-z0-9-_]{0,60}$/;
const UNITS = ['per_person', 'per_group', 'per_night'];
const PER_EXTRA = ['person', 'booking', 'night'];

function money(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9; }

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'opt';
}

/** Validate and normalise a pricing object. Throws AppError(400) on problems. */
export function validatePricing(p) {
  const errs = [];
  if (!p || typeof p !== 'object') throw badRequest('invalid_pricing', 'pricing must be an object');
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) errs.push('currency must be a 3-letter code');
  if (!UNITS.includes(p.unit)) errs.push(`unit must be one of ${UNITS.join(', ')}`);
  if (!money(p.adult)) errs.push('adult price must be a non-negative number');
  if (!(p.child === null || p.child === undefined || p.child === 'on_request' || money(p.child))) errs.push('child price must be a number, "on_request" or null');

  const checkList = (list, name, perValues) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) { errs.push(`${name} must be an array`); return []; }
    const keys = new Set();
    return list.map((o, i) => {
      if (!o || !KEY_RE.test(o.key || '')) errs.push(`${name}[${i}].key is invalid`);
      if (keys.has(o.key)) errs.push(`${name}[${i}].key "${o.key}" is duplicated`);
      keys.add(o.key);
      if (!o.name || typeof o.name !== 'string') errs.push(`${name}[${i}].name is required`);
      if (!money(o.price)) errs.push(`${name}[${i}].price must be a non-negative number`);
      if (perValues && !perValues.includes(o.per)) errs.push(`${name}[${i}].per must be one of ${perValues.join(', ')}`);
      if (o.child_price !== undefined && o.child_price !== null && !money(o.child_price)) errs.push(`${name}[${i}].child_price is invalid`);
      if (o.max_pax !== undefined && o.max_pax !== null && !(Number.isInteger(o.max_pax) && o.max_pax > 0)) errs.push(`${name}[${i}].max_pax is invalid`);
      return { ...o, active: o.active !== false };
    });
  };

  const options   = checkList(p.options, 'options');
  const extras    = checkList(p.extras, 'extras', PER_EXTRA);
  const transfers = checkList(p.transfers, 'transfers', ['person', 'booking']);

  const lim = p.limits || {};
  const limits = {
    adults_min:   Number.isInteger(lim.adults_min) ? lim.adults_min : 1,
    adults_max:   Number.isInteger(lim.adults_max) ? lim.adults_max : 20,
    children_max: Number.isInteger(lim.children_max) ? lim.children_max : 10,
    pax_max:      Number.isInteger(lim.pax_max) ? lim.pax_max : null,
  };
  if (limits.adults_min < 0 || limits.adults_max < limits.adults_min || limits.children_max < 0) errs.push('limits are inconsistent');
  const nights = Number.isInteger(p.nights) && p.nights >= 0 ? p.nights : 0;

  if (errs.length) throw badRequest('invalid_pricing', 'Invalid pricing', errs);
  return {
    currency: p.currency,
    unit: p.unit,
    adult: p.adult,
    child: p.child === undefined ? null : p.child,
    options,
    option_required: options.length > 0 && p.option_required !== false,
    extras,
    transfers,
    limits,
    nights,
    ...(p.child_age_note ? { child_age_note: p.child_age_note } : {}),
  };
}

/** Fields moved out of `content` into the structured pricing model. */
export const LEGACY_PRICE_FIELDS = [
  'price_from', 'price_weekday', 'child_price', 'child_price_weekday', 'price_per_night',
  'currency', 'price_unit', 'price_unit_en', 'boat_options',
];

/**
 * Build {pricing, rules, notes} from a legacy JSON record, reproducing exactly
 * the prices the current public site charges.
 */
export function pricingFromLegacy(item, kind) {
  const notes = [];
  const perBoat = /boat|barco/i.test(`${item.price_unit || ''} ${item.price_unit_en || ''}`);
  const adult = kind === 'accommodation' ? item.price_per_night : item.price_from;

  let child = null;
  if (typeof item.child_price === 'number') child = item.child_price;
  else if (item.child_price === 'consulta') child = 'on_request';
  else if (!item.price_weekday && item.pricing) {
    // Same fallback the current package page applies
    if (typeof item.pricing.children === 'number') child = item.pricing.children;
    else if (item.pricing.regular_vehicle && typeof item.pricing.regular_vehicle.children === 'number') child = item.pricing.regular_vehicle.children;
  }

  const options = (item.boat_options || []).map(b => {
    const m = String(b.capacity_en || b.capacity || '').match(/(\d+)/);
    return {
      key: KEY_RE.test(b.key || '') ? b.key : slug(b.name),
      name: b.name, name_en: b.name_en || b.name,
      price: b.price_mzn,
      ...(b.price_usd ? { price_usd: b.price_usd } : {}),
      ...(m ? { max_pax: Number(m[1]) } : {}),
      capacity_text: b.capacity || '', capacity_text_en: b.capacity_en || '',
    };
  });

  const pricing = validatePricing({
    currency: item.currency || 'MZN',
    unit: perBoat ? 'per_group' : 'per_person',
    adult: typeof adult === 'number' ? adult : 0,
    child,
    options,
    option_required: options.length > 0,
    extras: [],
    transfers: [],
    limits: { adults_min: 1, adults_max: 20, children_max: perBoat ? 0 : 10 },
    nights: kind === 'accommodation' ? 1 : 0,
  });

  if (typeof adult !== 'number') notes.push(`No base price (${kind === 'accommodation' ? 'price_per_night' : 'price_from'}); set to 0 — review before publishing.`);
  if (item.child_price === undefined && child === null && !perBoat) notes.push('No child price: children are charged the adult price (current site behaviour).');
  if (item.pricing) notes.push(`Legacy "pricing" block kept for reference only: ${JSON.stringify(item.pricing)}`);

  const rules = [];
  if (typeof item.price_weekday === 'number') {
    rules.push({
      label: 'Segunda a Quinta / Monday–Thursday',
      weekdays: [1, 2, 3, 4],
      adult: item.price_weekday,
      child: typeof item.child_price_weekday === 'number' ? item.child_price_weekday : null,
      priority: 10,
    });
  }
  return { pricing, rules, notes };
}

/** Weekday rule equivalent to the legacy price_weekday field, if any. */
function legacyWeekdayRule(rules) {
  return (rules || []).find(r => r.active !== false && !r.date_from && !r.date_to && !r.option_key &&
    Array.isArray(r.weekdays) && r.weekdays.slice().sort().join() === '1,2,3,4');
}

/** Legacy price fields for the public JSON (keeps existing renderers working). */
export function legacyPriceFields(pkg, rules) {
  const p = pkg.pricing;
  const out = { currency: p.currency };
  const base = p.options.length && p.unit === 'per_group'
    ? Math.min(...p.options.filter(o => o.active !== false).map(o => o.price))
    : p.adult;
  if (pkg.kind === 'accommodation') out.price_per_night = base;
  else out.price_from = base;
  if (p.child === 'on_request') out.child_price = 'consulta';
  else if (typeof p.child === 'number') out.child_price = p.child;
  const wd = legacyWeekdayRule(rules);
  if (wd) {
    if (wd.adult !== null && wd.adult !== undefined) out.price_weekday = wd.adult;
    if (wd.child !== null && wd.child !== undefined) out.child_price_weekday = wd.child;
  }
  if (p.unit === 'per_group') { out.price_unit = '/barco'; out.price_unit_en = '/boat'; }
  if (p.options.length && p.unit === 'per_group') {
    out.boat_options = p.options.filter(o => o.active !== false).map(o => ({
      key: o.key, name: o.name, name_en: o.name_en, capacity: o.capacity_text, capacity_en: o.capacity_text_en,
      price_mzn: o.price, ...(o.price_usd ? { price_usd: o.price_usd } : {}),
    }));
  }
  return out;
}
