// ─────────────────────────────────────────────────────────────────────────────
// pricing.js — Authoritative price calculation (pure functions, no I/O).
// The server is the only place a booking total is computed; whatever the
// browser shows is a preview fetched from POST /api/quote.
// ─────────────────────────────────────────────────────────────────────────────
import { weekday } from './dates.js';
import { badRequest } from './errors.js';

const round2 = n => Math.round(n * 100) / 100;

/** Pick the price rule that applies to a date/option (highest priority, then most specific). */
export function matchRule(rules, date, optionKey) {
  const wd = weekday(date);
  const candidates = (rules || []).filter(r =>
    r.active !== false &&
    (!r.date_from || date >= r.date_from) &&
    (!r.date_to || date <= r.date_to) &&
    (!r.weekdays || r.weekdays.length === 0 || r.weekdays.includes(wd)) &&
    (!r.option_key || r.option_key === optionKey));
  const specificity = r => (r.date_from || r.date_to ? 2 : 0) + (r.option_key ? 1 : 0);
  candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0) || specificity(b) - specificity(a) || (b.id || 0) - (a.id || 0));
  return candidates[0] || null;
}

/** Resolve unit prices for a date (and option) after applying price rules. */
export function unitPrices(pricing, rules, date, optionKey) {
  const option = optionKey ? pricing.options.find(o => o.key === optionKey) : null;
  let adult = option ? option.price : pricing.adult;
  let child = option && option.child_price !== undefined && option.child_price !== null ? option.child_price : pricing.child;
  const rule = matchRule(rules, date, optionKey);
  if (rule) {
    if (rule.adult !== null && rule.adult !== undefined) adult = Number(rule.adult);
    if (rule.child !== null && rule.child !== undefined) child = Number(rule.child);
  }
  return { adult, child, rule: rule ? { id: rule.id, label: rule.label } : null, option };
}

/** Is a promotion applicable to this booking? (dates use Maputo calendar) */
export function promotionApplies(promo, ctx) {
  if (!promo.active) return false;
  if (promo.starts_at && ctx.today < promo.starts_at) return false;
  if (promo.ends_at && ctx.today > promo.ends_at) return false;
  if (promo.travel_from && ctx.date < promo.travel_from) return false;
  if (promo.travel_to && ctx.date > promo.travel_to) return false;
  if (promo.package_ids && promo.package_ids.length && !promo.package_ids.includes(ctx.packageId)) return false;
  if (promo.categories && promo.categories.length && !promo.categories.includes(ctx.category)) return false;
  if (promo.min_pax && ctx.pax < promo.min_pax) return false;
  if (promo.min_total && ctx.subtotal < Number(promo.min_total)) return false;
  if (promo.usage_limit && promo.used_count >= promo.usage_limit) return false;
  if (promo.code && (!ctx.code || ctx.code.toUpperCase() !== promo.code.toUpperCase())) return false;
  return true;
}

function discountAmount(kind, value, max, base) {
  let amt = kind === 'percent' ? base * Number(value) / 100 : Number(value);
  if (max !== null && max !== undefined) amt = Math.min(amt, Number(max));
  return round2(Math.min(amt, base));
}

/**
 * Compute a full quote.
 * @param {object} args
 *   pkg        { id, kind, category, pricing }
 *   rules      price_rules rows
 *   input      { date, adults, children, option_key, extras:[{key, quantity?}], transfer_key, promo_code }
 *   promotions active promotion rows
 *   loyalty    { eligible, kind, value, max_discount, categories, combinable_with_promotions } | null
 *   today      'YYYY-MM-DD'
 */
export function computeQuote({ pkg, rules, input, promotions = [], loyalty = null, today }) {
  const p = pkg.pricing;
  const adults = input.adults | 0;
  const children = input.children | 0;
  const pax = adults + children;
  const L = p.limits || {};
  const errors = [];

  if (adults < (L.adults_min ?? 1)) errors.push('adults_min');
  if (L.adults_max && adults > L.adults_max) errors.push('adults_max');
  if (children > (L.children_max ?? 10)) errors.push('children_max');
  if (L.pax_max && pax > L.pax_max) errors.push('pax_max');

  let optionKey = input.option_key || null;
  if (p.options.length) {
    if (!optionKey && p.option_required) {
      if (p.options.length === 1) optionKey = p.options[0].key;
      else errors.push('option_required');
    }
    if (optionKey) {
      const opt = p.options.find(o => o.key === optionKey && o.active !== false);
      if (!opt) errors.push('option_invalid');
      else if (opt.max_pax && pax > opt.max_pax) errors.push('option_capacity');
    }
  } else if (optionKey) {
    errors.push('option_invalid');
  }
  if (errors.length) throw badRequest('invalid_selection', 'Invalid selection', errors);

  const { adult, child, rule, option } = unitPrices(p, rules, input.date, optionKey);
  const nights = p.nights || 0;
  const nightMul = p.unit === 'per_night' ? Math.max(nights, 1) : 1;
  const lines = [];
  const notes = [];
  let childOnRequest = false;

  if (p.unit === 'per_person') {
    lines.push({ type: 'adult', label: 'Adultos', label_en: 'Adults', quantity: adults, unit_price: adult, amount: round2(adults * adult) });
    if (children > 0) {
      if (child === 'on_request') {
        childOnRequest = true;
        lines.push({ type: 'child', label: 'Crianças (preço sob consulta)', label_en: 'Children (price on request)', quantity: children, unit_price: null, amount: 0 });
        notes.push('child_price_on_request');
      } else {
        const cp = typeof child === 'number' ? child : adult;
        lines.push({ type: 'child', label: 'Crianças', label_en: 'Children', quantity: children, unit_price: cp, amount: round2(children * cp) });
      }
    }
  } else if (p.unit === 'per_group') {
    const name = option ? option.name : 'Embarcação privada';
    const name_en = option ? (option.name_en || option.name) : 'Private charter';
    lines.push({ type: 'group', label: name, label_en: name_en, quantity: 1, unit_price: adult, amount: round2(adult) });
  } else { // per_night — price per unit per night
    lines.push({ type: 'night', label: option ? option.name : 'Alojamento', label_en: option ? (option.name_en || option.name) : 'Accommodation', quantity: nightMul, unit_price: adult, amount: round2(nightMul * adult) });
    if (children > 0 && typeof child === 'number') {
      lines.push({ type: 'child', label: 'Crianças', label_en: 'Children', quantity: children * nightMul, unit_price: child, amount: round2(children * nightMul * child) });
    }
  }

  // Optional extras
  const seenExtras = new Set();
  for (const sel of input.extras || []) {
    const key = typeof sel === 'string' ? sel : sel.key;
    if (seenExtras.has(key)) continue;
    seenExtras.add(key);
    const ex = p.extras.find(e => e.key === key && e.active !== false);
    if (!ex) throw badRequest('invalid_selection', 'Invalid extra', ['extra_invalid']);
    const qty = ex.per === 'person' ? pax : ex.per === 'night' ? Math.max(nights, 1) : 1;
    lines.push({ type: 'extra', key: ex.key, label: ex.name, label_en: ex.name_en || ex.name, quantity: qty, unit_price: ex.price, amount: round2(qty * ex.price) });
  }

  // Private transfer
  if (input.transfer_key) {
    const tr = p.transfers.find(t => t.key === input.transfer_key && t.active !== false);
    if (!tr) throw badRequest('invalid_selection', 'Invalid transfer', ['transfer_invalid']);
    const qty = tr.per === 'person' ? pax : 1;
    lines.push({ type: 'transfer', key: tr.key, label: tr.name, label_en: tr.name_en || tr.name, quantity: qty, unit_price: tr.price, amount: round2(qty * tr.price) });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));

  // Discounts: best of (non-combinable single promo) vs (sum of combinable promos);
  // loyalty is added only if allowed to combine, otherwise the larger one wins.
  const ctx = { today, date: input.date, packageId: pkg.id, category: pkg.category, pax, subtotal, code: input.promo_code || null };
  const applicable = promotions.filter(pr => promotionApplies(pr, ctx))
    .map(pr => ({ source: 'promotion', promotion_id: pr.id, code: pr.code || null, label: pr.name, combinable: pr.combinable,
                  amount: discountAmount(pr.kind, pr.value, pr.max_discount, subtotal) }));
  const single = applicable.filter(d => !d.combinable).sort((a, b) => b.amount - a.amount)[0];
  const combo = applicable.filter(d => d.combinable);
  const comboSum = combo.reduce((s, d) => s + d.amount, 0);
  let discounts = single && single.amount >= comboSum ? [single] : combo;

  if (loyalty && loyalty.eligible && (!loyalty.categories || !loyalty.categories.length || loyalty.categories.includes(pkg.category))) {
    const lAmt = discountAmount(loyalty.kind, loyalty.value, loyalty.max_discount, subtotal);
    const lDisc = { source: 'loyalty', label: 'Desconto de fidelização', label_en: 'Loyalty discount', amount: lAmt };
    const promoSum = discounts.reduce((s, d) => s + d.amount, 0);
    if (loyalty.combinable_with_promotions) discounts = [...discounts, lDisc];
    else if (lAmt > promoSum) discounts = [lDisc];
  }
  if (input.promo_code && !discounts.some(d => d.code && d.code.toUpperCase() === input.promo_code.toUpperCase())) {
    notes.push('promo_code_not_applied');
  }

  let discountTotal = round2(discounts.reduce((s, d) => s + d.amount, 0));
  if (discountTotal > subtotal) discountTotal = subtotal;
  const total = round2(subtotal - discountTotal);

  return {
    package_id: pkg.id,
    currency: p.currency,
    unit: p.unit,
    date: input.date,
    nights,
    adults, children,
    option_key: optionKey,
    price_rule: rule,
    unit_prices: { adult, child },
    lines,
    subtotal,
    discounts,
    discount_total: discountTotal,
    total,
    child_price_on_request: childOnRequest,
    notes,
  };
}
