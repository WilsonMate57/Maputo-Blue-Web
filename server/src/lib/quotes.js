// ─────────────────────────────────────────────────────────────────────────────
// quotes.js — Quote requests (packages/services chosen by the customer) and
// quotations (prepared by the team, delivered through the channels the team
// chooses, answered from the link or from the customer's account).
//
//   request ──► team generates lines from the chosen items (current prices,
//               editable) ──► draft ──► sent (e-mail | WhatsApp | link)
//                                         └─► accepted / declined / expired
// A quotation is never a booking and never charges anything.
// ─────────────────────────────────────────────────────────────────────────────
import { audit } from './audit.js';
import { enqueueMail, notifyTeam } from './mailer.js';
import { loadPackage } from './catalog.js';
import { computeQuote } from './pricing.js';
import { addDays, todayLocal } from './dates.js';
import { badRequest, conflict } from './errors.js';
import { randomToken, sha256 } from './security.js';

/** Private services offered outside the bookable catalogue (services page). */
export const SERVICES = {
  'boat-charter': { title: 'Aluguer de barco privado', title_en: 'Private boat charter', category: 'services' },
  'tour-car': { title: 'Carro de turismo e safari', title_en: 'Touring & safari car', category: 'services' },
  'airport-transfer': { title: 'Transfer do aeroporto', title_en: 'Airport transfer', category: 'services' },
};
export const CHANNELS = ['email', 'whatsapp', 'link'];

/** Validate the items chosen in the request form and snapshot their titles. */
export async function normalizeRequestItems(db, items = []) {
  const out = [];
  const seen = new Set();
  const ids = [...new Set(items.filter(i => i.package_id).map(i => i.package_id))];
  const { rows } = ids.length
    ? await db.query(`select id, kind, category, content from packages where id = any($1) and status = 'published'`, [ids])
    : { rows: [] };
  const byId = new Map(rows.map(r => [r.id, r]));
  for (const i of items) {
    const key = i.package_id ? `p:${i.package_id}` : `s:${i.service_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i.date && i.date < todayLocal()) throw badRequest('invalid_date');
    if (i.package_id) {
      const p = byId.get(i.package_id);
      if (!p) throw badRequest('invalid_selection', 'Unknown package', ['package_not_found']);
      const c = p.content || {};
      out.push({ kind: 'package', package_id: p.id, package_kind: p.kind, category: p.category,
        title: c.title || c.name || p.id, title_en: c.title_en || c.name_en || c.title || c.name || p.id,
        date: i.date || null, notes: (i.notes || '').trim() || null });
    } else {
      const s = SERVICES[i.service_key];
      if (!s) throw badRequest('invalid_selection', 'Unknown service', ['service_not_found']);
      out.push({ kind: 'service', service_key: i.service_key, ...s, date: i.date || null, notes: (i.notes || '').trim() || null });
    }
  }
  return out;
}

/**
 * Suggested quotation lines for a request: one line per chosen package priced
 * with the current catalogue rules for the requested date and group. Lines
 * that cannot be priced automatically (services, options to choose, prices on
 * request) come back with unit_price null for the team to fill in.
 */
export async function suggestQuoteLines(db, r) {
  const lines = [], warnings = [];
  const currencies = new Set();
  const fallbackDate = r.date_from && r.date_from >= todayLocal() ? r.date_from : addDays(todayLocal(), 7);
  const en = r.locale === 'en';
  const show = d => new Date(d + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'pt-PT', en ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { timeZone: 'UTC' });
  for (const it of r.items || []) {
    const date = it.date || fallbackDate;
    const label = en ? it.title_en : it.title;
    if (it.kind !== 'package') {
      lines.push({ description: `${label}${it.date ? ` — ${show(date)}` : ''}`, quantity: 1, unit_price: null, source: it.service_key });
      warnings.push({ item: label, reason: 'service_manual_price' });
      continue;
    }
    try {
      const { pkg, rules } = await loadPackage(db, it.package_id);
      const q = computeQuote({ pkg, rules, input: { date, adults: r.adults, children: r.children }, today: todayLocal() });
      currencies.add(q.currency);
      // One quotation line per package (its total), with the detail in the description
      const detail = q.lines.map(l => `${en ? l.label_en || l.label : l.label}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}`).join(', ');
      lines.push({ description: `${label} — ${show(date)}${detail ? ` (${detail})` : ''}`, quantity: 1, unit_price: q.child_price_on_request ? null : q.total,
        source: it.package_id, currency: q.currency });
      if (q.child_price_on_request) warnings.push({ item: label, reason: 'child_price_on_request' });
    } catch (err) {
      const { rows: [p] } = await db.query(`select pricing from packages where id = $1`, [it.package_id]);
      if (p && p.pricing && p.pricing.currency) currencies.add(p.pricing.currency);
      lines.push({ description: `${label} — ${show(date)}`, quantity: 1, unit_price: null, source: it.package_id });
      warnings.push({ item: label, reason: (err.details && err.details[0]) || err.code || 'manual_price' });
    }
  }
  return { lines, currency: currencies.size === 1 ? [...currencies][0] : (r.budget_currency || 'MZN'), mixed_currency: currencies.size > 1, warnings };
}

export const quotePageUrl = (cfg, locale, token) =>
  `${cfg.publicBaseUrl}/${locale === 'en' ? 'en' : 'pages'}/quote.html?t=${encodeURIComponent(token)}`;

export function whatsappUrl(phone, { name, reference, url, locale, total }) {
  const digits = String(phone || '').replace(/\D/g, '');
  const text = locale === 'en'
    ? `Hello ${name}, here is your Maputo Blue quotation for request ${reference} (${total}). You can view and accept it here: ${url}`
    : `Olá ${name}, segue a sua cotação da Maputo Blue para o pedido ${reference} (${total}). Pode consultá-la e aceitá-la aqui: ${url}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Deliver a quotation (inside a transaction, quote + request locked by the
 * caller): issues a fresh secret link (older links stop working), marks it
 * sent, and sends it through the chosen channels. Returns the link so the team
 * can share it by WhatsApp or any other channel.
 */
export async function deliverQuote(c, cfg, { quote: q, request: r, channels, actor }) {
  const ch = [...new Set((channels && channels.length ? channels : ['email']).filter(x => CHANNELS.includes(x)))];
  if (!ch.length) throw badRequest('channel_required');
  if (q.valid_until < todayLocal()) throw badRequest('invalid_date', 'Validity date is in the past');
  const token = randomToken(32);
  await c.query(`update quotes set status = 'withdrawn' where request_id = $1 and status = 'sent' and id <> $2`, [r.id, q.id]);
  await c.query(`update quotes set status = 'sent', sent_at = coalesce(sent_at, now()), public_token_hash = $2,
                  channels = (select array(select distinct unnest(channels || $3::text[]))) where id = $1`, [q.id, sha256(token), ch]);
  await c.query(`update custom_requests set status = 'quote_sent', updated_at = now() where id = $1`, [r.id]);
  const url = quotePageUrl(cfg, r.locale, token);
  if (ch.includes('email')) {
    await enqueueMail(c, { key: `quote:${q.id}:issued:${Date.now()}`, to: r.email, template: 'quote_issued', locale: r.locale,
      data: { ...q, items: q.items, reference: r.reference, name: r.name, quote_url: url } });
  }
  const totalLabel = `${q.currency} ${Number(q.total).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  await audit(c, actor, 'request', r.id, 'quote_sent', { quote_id: q.id, channels: ch, total: Number(q.total), currency: q.currency });
  return {
    quote_url: url, channels: ch,
    whatsapp_url: ch.includes('whatsapp') ? whatsappUrl(r.phone, { name: r.name, reference: r.reference, url, locale: r.locale, total: totalLabel }) : null,
  };
}

/** Accept or decline a sent quotation (from the secret link or the account). */
export async function respondToQuote(c, cfg, { quote: q, decision, actor }) {
  if (q.status !== 'sent') throw conflict('quote_closed', 'This quotation can no longer be changed');
  if (q.valid_until < todayLocal()) {
    await c.query(`update quotes set status='expired' where id=$1`, [q.id]);
    throw conflict('quote_expired', 'This quotation has expired');
  }
  const accepted = decision === 'accept';
  await c.query(`update quotes set status=$2, responded_at=now() where id=$1`, [q.id, accepted ? 'accepted' : 'declined']);
  if (accepted) {
    await c.query(`update custom_requests set status='accepted', updated_at=now() where id=$1`, [q.req_id]);
    await enqueueMail(c, { key: `quote:${q.id}:accepted`, to: q.email, template: 'quote_accepted', locale: q.locale, data: { ...q } });
    await notifyTeam(c, { key: `quote:${q.id}:admin_accepted`, template: 'admin_quote_accepted',
      data: { ...q, admin_url: `${cfg.publicBaseUrl}/admin/#/requests/${q.req_id}` } });
  }
  await audit(c, actor || null, 'request', q.req_id, accepted ? 'quote_accepted' : 'quote_declined', { quote_id: q.id });
  return accepted ? 'accepted' : 'declined';
}

/** Customer-facing projection of a quotation. */
export const publicQuote = q => ({
  id: q.id, reference: q.reference, name: q.name, items: q.items, inclusions: q.inclusions, exclusions: q.exclusions, message: q.message,
  currency: q.currency, total: Number(q.total), valid_until: q.valid_until, sent_at: q.sent_at,
  status: q.status === 'sent' && q.valid_until < todayLocal() ? 'expired' : q.status,
});

