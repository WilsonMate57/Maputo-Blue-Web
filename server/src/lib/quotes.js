// ─────────────────────────────────────────────────────────────────────────────
// quotes.js — Quote requests (packages/services chosen by the customer) and
// commercial proposals (quotations) prepared by the team, with or without a
// request, delivered through the channels the team chooses and answered from
// the link or from the customer's account.
//
//   draft ──► issued ──► sent ──► viewed ──► accepted ──► converted (booking)
//                                    ├─► declined
//                                    └─► revision_requested ──► new version
//   Open proposals past their validity become expired. A new version replaces
//   the previous ones once issued (superseded). Issued versions never change.
// A quotation is never a booking, an invoice or income, and never charges anything.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { audit } from './audit.js';
import { enqueueMail, notifyTeam } from './mailer.js';
import { getSetting, loadPackage } from './catalog.js';
import { computeQuote } from './pricing.js';
import { addDays, diffDays, todayLocal } from './dates.js';
import { badRequest, conflict, notFound } from './errors.js';
import { sha256 } from './security.js';
import { isStaff } from './auth.js';
import { computeQuoteTotals } from './quote-totals.js';
import { invoiceSettings } from './invoices.js';
import { renderQuotePdf } from './quote-pdf.js';

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
  for (const it of r.items || []) {
    const date = it.date || fallbackDate;
    const label = en ? it.title_en : it.title;
    if (it.kind !== 'package') {
      lines.push({ kind: 'service', service_key: it.service_key, description: label, date_from: it.date || null, quantity: 1, unit_price: null, source: it.service_key });
      warnings.push({ item: label, reason: 'service_manual_price' });
      continue;
    }
    try {
      const { pkg, rules } = await loadPackage(db, it.package_id);
      const q = computeQuote({ pkg, rules, input: { date, adults: r.adults, children: r.children }, today: todayLocal() });
      currencies.add(q.currency);
      // One quotation line per package (its total), with the detail in the description
      const detail = q.lines.map(l => `${en ? l.label_en || l.label : l.label}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}`).join(', ');
      lines.push({ kind: 'package', package_id: it.package_id, description: `${label}${detail ? ` (${detail})` : ''}`, date_from: date, quantity: 1,
        unit_price: q.child_price_on_request ? null : q.total, source: it.package_id, currency: q.currency });
      if (q.child_price_on_request) warnings.push({ item: label, reason: 'child_price_on_request' });
    } catch (err) {
      const { rows: [p] } = await db.query(`select pricing from packages where id = $1`, [it.package_id]);
      if (p && p.pricing && p.pricing.currency) currencies.add(p.pricing.currency);
      lines.push({ kind: 'package', package_id: it.package_id, description: label, date_from: date, quantity: 1, unit_price: null, source: it.package_id });
      warnings.push({ item: label, reason: (err.details && err.details[0]) || err.code || 'manual_price' });
    }
  }
  return { lines, currency: currencies.size === 1 ? [...currencies][0] : (r.budget_currency || 'MZN'), mixed_currency: currencies.size > 1, warnings };
}

export { computeQuoteTotals };

// Issued and not yet answered: these expire
const OPEN = ['issued', 'sent', 'viewed', 'revision_requested'];
const ANSWERABLE = ['sent', 'viewed', 'revision_requested'];
const VERSIONABLE = [...OPEN, 'accepted', 'declined', 'expired'];
/** What the customer may still open; withdrawn proposals and drafts are never public. */
export const PUBLIC_STATUSES = ['sent', 'viewed', 'accepted', 'declined', 'revision_requested', 'expired', 'converted', 'superseded'];
const DEFAULT_VALIDITY_DAYS = 14;

export const quoteRef = q => (q.version > 1 ? `${q.number} v${q.version}` : q.number);

/** Every step is kept under the proposal (all versions), and under its request when it has one. */
async function log(c, actor, q, action, data = {}) {
  await audit(c, actor, 'quote', q.group_id, action, { quote_id: q.id, number: q.number, version: q.version, ...data });
  if (q.request_id) await audit(c, actor, 'request', q.request_id, action, { quote_id: q.id, ...data });
}

export const quotePageUrl = (cfg, locale, token) =>
  `${cfg.publicBaseUrl}/${locale === 'en' ? 'en' : 'pages'}/quote.html?t=${encodeURIComponent(token)}`;

/** The secret link is derived, so the team can copy it again; only its hash is stored. */
const linkToken = (cfg, q, nonce) => crypto.createHmac('sha256', cfg.ticketSecret).update(`quote|${q.id}|${nonce}`).digest('base64url');
export const currentLink = (cfg, q) => (q.token_nonce > 0 ? quotePageUrl(cfg, q.locale, linkToken(cfg, q, q.token_nonce)) : null);

export function whatsappUrl(phone, { name, reference, url, locale, total }) {
  const digits = String(phone || '').replace(/\D/g, '');
  const text = locale === 'en'
    ? `Hello ${name}, here is your Maputo Blue quotation ${reference} (${total}). You can view and accept it here: ${url}`
    : `Olá ${name}, segue a sua cotação da Maputo Blue ${reference} (${total}). Pode consultá-la e aceitá-la aqui: ${url}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const text = (v, n = 3000) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

function cleanCustomer(x = {}) {
  return { name: text(x.name, 160), company: text(x.company, 160), email: text(x.email, 200)?.toLowerCase() || null, phone: text(x.phone, 40),
    country: text(x.country, 80), client_type: x.client_type || 'individual', nuit: text(x.nuit, 40), address: text(x.address, 300) };
}

function cleanTrip(x = {}) {
  const span = x.date_from && x.date_to && x.date_to >= x.date_from ? diffDays(x.date_from, x.date_to) : null;
  return { destination: text(x.destination, 200), date_from: x.date_from || null, date_to: x.date_to || null,
    days: x.days ?? (span === null ? null : span + 1), nights: x.nights ?? span,
    adults: x.adults ?? 1, children: x.children ?? 0, experience: text(x.experience, 200), customer_notes: text(x.customer_notes) };
}

/** Everything the team edits in a proposal, with the money computed here. */
function proposalValues(b) {
  const t = computeQuoteTotals({ items: b.items || [], discount: b.discount, fees: b.fees });
  return {
    customer: cleanCustomer(b.customer), trip: cleanTrip(b.trip), locale: b.locale === 'en' ? 'en' : 'pt', currency: b.currency, valid_until: b.valid_until,
    items: t.items, discount: b.discount && Number(b.discount.value) ? b.discount : null, fees: t.fees,
    subtotal: t.subtotal, discount_total: t.discount_total, fees_total: t.fees_total, total: t.total,
    inclusions: text(b.inclusions), exclusions: text(b.exclusions), message: text(b.message), payment_terms: text(b.payment_terms),
    deposit_percent: b.deposit_percent ?? null, payment_due: text(b.payment_due, 300), cancellation_terms: text(b.cancellation_terms),
    special_conditions: text(b.special_conditions), itinerary: (b.itinerary || []).filter(s => s.title || s.description), internal_notes: text(b.internal_notes),
  };
}
const JSON_COLUMNS = new Set(['customer', 'trip', 'items', 'discount', 'fees', 'itinerary']);
const toParam = (k, v) => (JSON_COLUMNS.has(k) && v !== null ? JSON.stringify(v) : v);

/** Find or create the contact behind a proposal, by e-mail. */
async function upsertContact(c, cu, actor) {
  if (!cu.email || !cu.name) return null;
  const { rows: [row] } = await c.query(
    `insert into contacts (name, company, email, phone, country, client_type, nuit, address, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (lower(email)) do update set name = excluded.name, company = coalesce(excluded.company, contacts.company),
       phone = coalesce(excluded.phone, contacts.phone), country = coalesce(excluded.country, contacts.country),
       client_type = excluded.client_type, nuit = coalesce(excluded.nuit, contacts.nuit), address = coalesce(excluded.address, contacts.address), updated_at = now()
     returning id`,
    [cu.name, cu.company, cu.email, cu.phone, cu.country, cu.client_type, cu.nuit, cu.address, actor ? actor.id : null]);
  return row.id;
}

/** Account that sees the proposal: only one that proved it owns the e-mail. */
async function verifiedAccount(c, email) {
  if (!email) return null;
  const { rows: [u] } = await c.query(
    `select id from users where lower(email) = $1 and email_verified_at is not null and role = 'customer'`, [email]);
  return u ? u.id : null;
}

async function nextNumber(c) {
  const year = Number(todayLocal().slice(0, 4));
  const { rows: [s] } = await c.query(
    `insert into quote_sequences (year, last_seq) values ($1, 1)
     on conflict (year) do update set last_seq = quote_sequences.last_seq + 1 returning last_seq`, [year]);
  return `COT-${year}-${String(s.last_seq).padStart(4, '0')}`;
}

export const requestCustomer = r => ({ name: r.name, email: r.email, phone: r.phone, company: r.billing?.company_name, nuit: r.billing?.nuit,
  address: r.billing?.address, client_type: r.billing?.company_name ? 'company' : 'individual' });
export const requestTrip = r => ({ destination: r.destination, date_from: r.date_from, date_to: r.date_to, adults: r.adults, children: r.children });

export async function createProposal(c, { body, actor, request = null }) {
  const v = proposalValues(body);
  const contactId = await upsertContact(c, v.customer, actor);
  const userId = (request && request.user_id) || await verifiedAccount(c, v.customer.email);
  const cols = Object.keys(v);
  const { rows: [q] } = await c.query(
    `insert into quotes (number, request_id, contact_id, user_id, status, created_by, ${cols.join(', ')})
     values ($1,$2,$3,$4,'draft',$5, ${cols.map((_, i) => `$${i + 6}`).join(', ')}) returning *`,
    [await nextNumber(c), request ? request.id : null, contactId, userId, actor.id, ...cols.map(k => toParam(k, v[k]))]);
  await log(c, actor, q, 'quote_drafted', { total: q.total, currency: q.currency });
  return q;
}

/** Only drafts change; anything already issued gets a new version instead. */
export async function updateDraft(c, { quote: q, body, actor }) {
  if (q.status !== 'draft') throw conflict('quote_locked', 'Issued proposals change through a new version');
  const v = proposalValues(body);
  const contactId = await upsertContact(c, v.customer, actor);
  const cols = Object.keys(v);
  const { rows: [u] } = await c.query(
    `update quotes set ${cols.map((k, i) => `${k} = $${i + 3}`).join(', ')}, contact_id = $2, updated_at = now() where id = $1 returning *`,
    [q.id, contactId, ...cols.map(k => toParam(k, v[k]))]);
  await log(c, actor, u, 'quote_updated', { total: u.total, currency: u.currency });
  return u;
}

/** What stops a draft from being issued; the panel explains each code. */
export function issueProblems(q) {
  const p = [];
  if (!q.customer.name) p.push('customer_name');
  if (!q.customer.email) p.push('customer_email');
  if (!q.customer.phone) p.push('customer_phone');
  if (!(q.items || []).length) p.push('no_items');
  if ((q.items || []).some(i => i.unit_price === null || i.unit_price === undefined)) p.push('price_missing');
  if (q.valid_until < todayLocal()) p.push('validity_past');
  return p;
}

async function issuerDetails(c) {
  const { issuer = {} } = await invoiceSettings(c);
  const co = await getSetting(c, 'company');
  return { name: issuer.name || co.trade_name, legal_name: issuer.legal_name || co.legal_name, nuit: issuer.nuit || co.nuit, address: issuer.address || co.address,
    phone: issuer.phone || co.phone, email: issuer.email || co.email, website: issuer.website || co.website };
}

/** Freeze a draft: company details and archived PDF; earlier versions are replaced. */
export async function issueQuote(c, cfg, { quote: q, actor }) {
  if (q.status !== 'draft') throw conflict('quote_not_draft');
  const problems = issueProblems(q);
  if (problems.length) throw badRequest('quote_incomplete', 'The proposal cannot be issued yet', problems);
  const { rows: [u] } = await c.query(
    `update quotes set status = 'issued', issued_at = now(), issuer = $2, updated_at = now() where id = $1 returning *`,
    [q.id, JSON.stringify(await issuerDetails(c))]);
  const pdf = await renderQuotePdf(c, cfg, u);
  await c.query('insert into quote_documents (quote_id, pdf, sha256) values ($1,$2,$3)',
    [u.id, pdf, crypto.createHash('sha256').update(pdf).digest('hex')]);
  const { rows: replaced } = await c.query(
    `update quotes set status = 'superseded', updated_at = now() where group_id = $1 and id <> $2 and status = any($3) returning version`,
    [u.group_id, u.id, VERSIONABLE]);
  await log(c, actor, u, 'quote_issued', { total: u.total, currency: u.currency, replaces: replaced.map(r => r.version) });
  return u;
}

/**
 * Send a proposal (inside a transaction, proposal locked by the caller). A
 * draft is issued first. The link stays the same unless `rotate` is set, which
 * disables the previous one. Returns the link so the team can share it.
 */
export async function deliverQuote(c, cfg, { quote, channels, actor, rotate = false }) {
  const ch = [...new Set((channels && channels.length ? channels : ['email']).filter(x => CHANNELS.includes(x)))];
  if (!ch.length) throw badRequest('channel_required');
  const q = quote.status === 'draft' ? await issueQuote(c, cfg, { quote, actor }) : quote;
  if (q.valid_until < todayLocal()) throw badRequest('invalid_date', 'Validity date is in the past');
  const nonce = rotate || !q.token_nonce ? q.token_nonce + 1 : q.token_nonce;
  const token = linkToken(cfg, q, nonce);
  if (q.request_id) {
    await c.query(`update quotes set status = 'withdrawn', updated_at = now() where request_id = $1 and status in ('sent','viewed') and group_id <> $2`, [q.request_id, q.group_id]);
    await c.query(`update custom_requests set status = 'quote_sent', updated_at = now() where id = $1`, [q.request_id]);
  }
  await c.query(
    `update quotes set status = case when status = 'issued' then 'sent' else status end, sent_at = coalesce(sent_at, now()), public_token_hash = $2, token_nonce = $3,
            channels = (select array(select distinct unnest(channels || $4::text[]))), updated_at = now() where id = $1`,
    [q.id, sha256(token), nonce, ch]);
  const url = quotePageUrl(cfg, q.locale, token);
  const reference = quoteRef(q);
  if (ch.includes('email')) {
    await enqueueMail(c, { key: `quote:${q.id}:issued:${Date.now()}`, to: q.customer.email, template: 'quote_issued', locale: q.locale, data: {
      name: q.customer.name, reference, quote_url: url, attach_quote: q.id, items: q.items, currency: q.currency,
      global_discount: computeQuoteTotals(q).global_discount, fees_total: q.fees_total, total: q.total, valid_until: q.valid_until, message: q.message, inclusions: q.inclusions, exclusions: q.exclusions } });
  }
  const totalLabel = `${q.currency} ${Number(q.total).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  await log(c, actor, q, 'quote_sent', { channels: ch, total: Number(q.total), currency: q.currency });
  return {
    quote_url: url, channels: ch,
    whatsapp_url: ch.includes('whatsapp') ? whatsappUrl(q.customer.phone, { name: q.customer.name, reference, url, locale: q.locale, total: totalLabel }) : null,
  };
}

const COPIED = `request_id, contact_id, user_id, locale, customer, trip, internal_notes, items, discount, fees, subtotal, discount_total, fees_total, total, currency,
  inclusions, exclusions, message, payment_terms, deposit_percent, payment_due, cancellation_terms, special_conditions, itinerary`;

const validityDays = async c => Number((await getSetting(c, 'quotes')).validity_days) || DEFAULT_VALIDITY_DAYS;

/** A draft of the next version. The current one stays valid until that draft is issued. */
export async function newVersion(c, { quote: q, actor }) {
  if (q.status === 'converted') throw conflict('quote_converted', 'This proposal already became a booking');
  if (!VERSIONABLE.includes(q.status)) throw conflict('quote_not_versionable');
  const { rows: [open] } = await c.query(`select * from quotes where group_id = $1 and status = 'draft'`, [q.group_id]);
  if (open) return open;
  const { rows: [{ v }] } = await c.query('select max(version) + 1 as v from quotes where group_id = $1', [q.group_id]);
  const { rows: [n] } = await c.query(
    `insert into quotes (number, group_id, version, replaces_id, status, valid_until, created_by, ${COPIED})
     select number, group_id, $2, id, 'draft', $3, $4, ${COPIED} from quotes where id = $1 returning *`,
    [q.id, v, q.valid_until < todayLocal() ? addDays(todayLocal(), await validityDays(c)) : q.valid_until, actor.id]);
  await log(c, actor, n, 'quote_version_created', { from_version: q.version, from_status: q.status });
  return n;
}

/** A new proposal with its own number, e.g. from an expired one; the original stays as it was. */
export async function duplicateQuote(c, { quote: q, actor }) {
  const { rows: [n] } = await c.query(
    `insert into quotes (number, duplicated_from, status, valid_until, created_by, ${COPIED})
     select $2, id, 'draft', $3, $4, ${COPIED} from quotes where id = $1 returning *`,
    [q.id, await nextNumber(c), addDays(todayLocal(), await validityDays(c)), actor.id]);
  await log(c, actor, n, 'quote_duplicated', { from: quoteRef(q) });
  return n;
}

export async function cancelQuote(c, { quote: q, actor, reason }) {
  if (!['draft', ...OPEN, 'accepted'].includes(q.status)) throw conflict('quote_not_open');
  await c.query(`update quotes set status = 'withdrawn', updated_at = now() where id = $1`, [q.id]);
  await log(c, actor, q, 'quote_withdrawn', { from: q.status, reason: reason || null });
}

/**
 * The customer's answer, from the secret link or the account; the team can
 * also record one given by phone. Accepting confirms nothing: the team still
 * checks availability before converting to a booking.
 */
export async function respondToQuote(c, cfg, { quote: q, decision, message = null, actor }) {
  if (!ANSWERABLE.includes(q.status)) throw conflict('quote_closed', 'This quotation can no longer be changed');
  if (q.valid_until < todayLocal()) throw conflict('quote_expired', 'This quotation has expired');
  const note = text(message);
  if (decision === 'revision' && !note) throw badRequest('message_required', 'Tell us what should change');
  const status = { accept: 'accepted', decline: 'declined', revision: 'revision_requested' }[decision];
  await c.query(`update quotes set status = $2, responded_at = now(), response_message = $3, updated_at = now() where id = $1`, [q.id, status, note]);
  const accepted = decision === 'accept';
  if (accepted && q.request_id) await c.query(`update custom_requests set status = 'accepted', updated_at = now() where id = $1`, [q.request_id]);
  const data = { name: q.customer.name, reference: quoteRef(q), total: q.total, currency: q.currency, message: note, admin_url: `${cfg.publicBaseUrl}/admin/#/quotations/${q.id}` };
  if (!isStaff(actor)) {
    if (accepted) await enqueueMail(c, { key: `quote:${q.id}:accepted`, to: q.customer.email, template: 'quote_accepted', locale: q.locale, data });
    await notifyTeam(c, { key: `quote:${q.id}:admin_${status}:${Date.now()}`,
      template: { accepted: 'admin_quote_accepted', declined: 'admin_quote_declined', revision_requested: 'admin_quote_revision' }[status], data });
  }
  await log(c, actor || null, q, { accepted: 'quote_accepted', declined: 'quote_declined', revision_requested: 'quote_revision_requested' }[status], { message: note });
  return status;
}

/** The customer opened the proposal; the team opening it does not count. */
export async function markViewed(db, q, actor) {
  if (isStaff(actor)) return q;
  const { rows: [u] } = await db.query(
    `update quotes set view_count = view_count + 1, viewed_at = coalesce(viewed_at, now()),
            status = case when status = 'sent' then 'viewed' else status end where id = $1 returning status`, [q.id]);
  if (!q.viewed_at) await log(db, null, q, 'quote_viewed');
  return { ...q, status: u.status };
}

/** Background job: open proposals past their validity. Accepted ones keep their answer. */
export async function expireQuotes(db) {
  const { rows } = await db.query(
    `update quotes set status = 'expired', updated_at = now() where status = any($1) and valid_until < $2 returning *`, [OPEN, todayLocal()]);
  for (const q of rows) await log(db, null, q, 'quote_expired', { __system: true });
  return rows.length;
}

/** Customer-facing projection: no internal notes, contacts, tokens or staff. */
export function publicQuote(q) {
  const t = computeQuoteTotals({ items: q.items, discount: q.discount, fees: q.fees });
  const { name, company, email, phone, country } = q.customer;
  return {
    id: q.id, reference: quoteRef(q), version: q.version, name, customer: { name, company, email, phone, country }, locale: q.locale,
    trip: q.trip, currency: q.currency, valid_until: q.valid_until, issued_at: q.issued_at, sent_at: q.sent_at, responded_at: q.responded_at,
    items: t.items.map(i => ({ description: i.description, details: i.details || null, date_from: i.date_from || null, date_to: i.date_to || null, quantity: i.quantity,
      participants: i.participants ?? null, unit_price: i.unit_price, discount_amount: i.discount_amount, amount: i.amount })),
    subtotal: t.subtotal, discount_total: t.discount_total, fees: t.fees, fees_total: t.fees_total, total: t.total,
    inclusions: q.inclusions, exclusions: q.exclusions, message: q.message, payment_terms: q.payment_terms, deposit_percent: q.deposit_percent,
    payment_due: q.payment_due, cancellation_terms: q.cancellation_terms, special_conditions: q.special_conditions, itinerary: q.itinerary,
    issuer: q.issuer ? { name: q.issuer.name, phone: q.issuer.phone, email: q.issuer.email, website: q.issuer.website } : null,
    status: OPEN.includes(q.status) && q.valid_until < todayLocal() ? 'expired' : q.status,
  };
}

export async function loadQuote(c, id, { lock = false } = {}) {
  const { rows: [ref] } = await c.query('select request_id from quotes where id = $1', [id]);
  if (!ref) throw notFound('quote_not_found');
  // Lock order: request, then proposal
  if (lock && ref.request_id) await c.query('select 1 from custom_requests where id = $1 for update', [ref.request_id]);
  const { rows: [q] } = await c.query(`select * from quotes where id = $1 ${lock ? 'for update' : ''}`, [id]);
  return q;
}
