// ─────────────────────────────────────────────────────────────────────────────
// quote-totals.js — The money of a proposal, computed in integer cents:
//   line      gross = quantity × unit price; net = gross − line discount
//   subtotal  sum of gross lines
//   discounts line discounts + global discount (on what is left after them)
//   total     subtotal − discounts + fees
// Lines without a price count as zero (a draft may have them; issuing refuses).
// ─────────────────────────────────────────────────────────────────────────────
const toCents = n => Math.round(Number(n || 0) * 100);
const money = c => c / 100;

function discountCents(d, baseC) {
  if (!d || !Number(d.value)) return 0;
  const c = d.kind === 'percent' ? Math.round(baseC * Math.min(Number(d.value), 100) / 100) : toCents(d.value);
  return Math.min(Math.max(c, 0), baseC);
}

export function computeQuoteTotals({ items = [], discount = null, fees = [] }) {
  const lines = items.map(i => {
    const grossC = Math.round(toCents(i.unit_price) * Number(i.quantity || 0));
    const discC = discountCents(i.discount, grossC);
    return { ...i, gross: money(grossC), discount_amount: money(discC), amount: money(grossC - discC), _g: grossC, _d: discC };
  });
  const subtotalC = lines.reduce((s, l) => s + l._g, 0);
  const lineDiscC = lines.reduce((s, l) => s + l._d, 0);
  const globalC = discountCents(discount, subtotalC - lineDiscC);
  const feeRows = (fees || []).filter(f => f.label && Number(f.amount)).map(f => ({ label: f.label, amount: money(toCents(f.amount)) }));
  const feesC = feeRows.reduce((s, f) => s + toCents(f.amount), 0);
  return {
    items: lines.map(({ _g, _d, ...l }) => l),
    fees: feeRows,
    subtotal: money(subtotalC),
    line_discount_total: money(lineDiscC),
    global_discount: money(globalC),
    discount_total: money(lineDiscC + globalC),
    fees_total: money(feesC),
    total: money(subtotalC - lineDiscC - globalC + feesC),
  };
}
