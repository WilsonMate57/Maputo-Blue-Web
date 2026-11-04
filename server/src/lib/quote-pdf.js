// ─────────────────────────────────────────────────────────────────────────────
// quote-pdf.js — A4 PDF of a proposal, in the proposal's language. Same identity
// as the invoice: logo, company details and DM Sans. An issued version keeps the
// PDF made at issue (quote_documents); only drafts and quotations from before
// that archive are rendered on demand. A quotation is not a booking, an invoice
// or a receipt, and the footer says so.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { brandFonts } from './pdf-fonts.js';
import { invoiceSettings } from './invoices.js';
import { computeQuoteTotals } from './quote-totals.js';

const L = {
  pt: {
    title: 'Cotação', number: 'N.º', issued: 'Data de emissão', valid: 'Válida até', to: 'Cliente', trip: 'Detalhes da viagem', dest: 'Destino', dates: 'Datas', duration: 'Duração',
    group: 'Participantes', adults: 'adulto(s)', children: 'criança(s)', days: 'dia(s)', nights: 'noite(s)', experience: 'Experiência', notes: 'Observações', country: 'País',
    desc: 'Descrição', qty: 'Qtd.', unit: 'Preço unit.', disc: 'Desconto', amount: 'Total', subtotal: 'Subtotal', discounts: 'Descontos', total: 'Total', currency: 'Moeda',
    payment: 'Condições de pagamento', deposit: 'Depósito exigido', due: 'Prazo de pagamento', incl: 'Serviços incluídos', excl: 'Serviços não incluídos', itinerary: 'Itinerário',
    conditions: 'Condições comerciais', cancel: 'Política de cancelamento', validity: 'Validade', validity_text: d => `Esta proposta é válida até ${d}. Os preços e a disponibilidade só ficam garantidos com a confirmação da reserva.`,
    message: 'Mensagem da equipa', nuit: 'NUIT', page: 'Página', attn: 'A/c', draft: 'RASCUNHO', version: 'versão', pax: 'pax',
    thanks: 'Obrigado por considerar a Maputo Blue para a sua viagem.',
    note: 'Esta cotação não é uma factura, um recibo nem uma reserva confirmada.',
  },
  en: {
    title: 'Quotation', number: 'No.', issued: 'Issue date', valid: 'Valid until', to: 'Customer', trip: 'Trip details', dest: 'Destination', dates: 'Dates', duration: 'Duration',
    group: 'Participants', adults: 'adult(s)', children: 'child(ren)', days: 'day(s)', nights: 'night(s)', experience: 'Experience', notes: 'Notes', country: 'Country',
    desc: 'Description', qty: 'Qty', unit: 'Unit price', disc: 'Discount', amount: 'Total', subtotal: 'Subtotal', discounts: 'Discounts', total: 'Total', currency: 'Currency',
    payment: 'Payment terms', deposit: 'Deposit required', due: 'Payment deadline', incl: 'Included services', excl: 'Services not included', itinerary: 'Itinerary',
    conditions: 'Commercial terms', cancel: 'Cancellation policy', validity: 'Validity', validity_text: d => `This proposal is valid until ${d}. Prices and availability are only guaranteed once the booking is confirmed.`,
    message: 'Message from our team', nuit: 'NUIT', page: 'Page', attn: 'Attn', draft: 'DRAFT', version: 'version', pax: 'pax',
    thanks: 'Thank you for considering Maputo Blue for your trip.',
    note: 'This quotation is not an invoice, a receipt or a confirmed booking.',
  },
};
const C = { navy: '#0A2540', teal: '#00838F', text: '#334155', muted: '#64748B', line: '#E2E8F0', soft: '#F4F7FB', green: '#047857', amber: '#B45309' };
const fmtMoney = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d, lang) => (d ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d)
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Maputo' }) : '—');
const span = (a, b, lang) => (a ? `${fmtDate(a, lang)}${b && b !== a ? ` – ${fmtDate(b, lang)}` : ''}` : null);

let logoCache = null;
async function logoPng(cfg) {
  if (logoCache) return logoCache;
  const file = path.join(cfg.siteRoot, 'logo.webp');
  logoCache = fs.existsSync(file) ? await sharp(fs.readFileSync(file)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer() : null;
  return logoCache;
}

export const quoteFilename = q => `cotacao-${q.number}${q.version > 1 ? `-v${q.version}` : ''}.pdf`;

/** The document of a proposal: the archived one when it was issued, otherwise rendered now. */
export async function quotePdf(db, cfg, q) {
  const { rows: [doc] } = await db.query('select pdf from quote_documents where quote_id = $1', [q.id]);
  return doc ? doc.pdf : renderQuotePdf(db, cfg, q);
}

/** E-mail attachment: `attach_quote` in the outbox job names the proposal. */
export function quoteAttachments(pool, cfg) {
  return async job => {
    const id = job.data && job.data.attach_quote;
    if (!id) return [];
    const { rows: [q] } = await pool.query('select * from quotes where id = $1', [id]);
    return q ? [{ filename: quoteFilename(q), content: (await quotePdf(pool, cfg, q)).toString('base64') }] : [];
  };
}

export async function renderQuotePdf(db, cfg, q) {
  const lang = q.locale === 'en' ? 'en' : 'pt';
  const t = L[lang];
  const issuer = q.issuer || (await invoiceSettings(db)).issuer || {};
  const money = computeQuoteTotals({ items: q.items, discount: q.discount, fees: q.fees });
  const cu = q.customer || {}, trip = q.trip || {};
  const logo = await logoPng(cfg);
  const ref = q.version > 1 ? `${q.number} (${t.version} ${q.version})` : q.number;
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 48, bottom: 70, left: 50, right: 50 },
    info: { Title: `${t.title} ${ref}`, Author: issuer.name || 'Maputo Blue' } });
  const chunks = [];
  doc.on('data', ch => chunks.push(ch));
  const done = new Promise(r => doc.on('end', r));
  const W = doc.page.width, H = doc.page.height, M = 50, CW = W - 2 * M, BOTTOM = H - 78;
  const F = brandFonts(doc);
  let y = 44;
  const newPage = () => { doc.addPage(); y = 52; };
  const room = h => { if (y + h > BOTTOM) newPage(); };

  // Header: logo + company (left), title + number and dates (right)
  if (logo) doc.image(logo, M, y, { height: 54 });
  const ix = M + (logo ? 70 : 0);
  doc.font(F.bold).fontSize(14).fillColor(C.navy).text(issuer.name || 'Maputo Blue', ix, y + 2, { width: 240 });
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text([
    issuer.address, issuer.phone, issuer.email, issuer.website, issuer.nuit ? `${t.nuit}: ${issuer.nuit}` : null,
  ].filter(Boolean).join('\n'), ix, doc.y + 2, { width: 240, lineGap: 1 });
  const headBottom = doc.y;
  doc.font(F.heavy).fontSize(24).fillColor(C.navy).text(t.title.toUpperCase(), W - M - 200, y, { width: 200, align: 'right', characterSpacing: 1.5 });
  let my = y + 34;
  for (const [k, v] of [[t.number, ref], [t.issued, fmtDate(q.issued_at || q.created_at, lang)], [t.valid, fmtDate(q.valid_until, lang)]]) {
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(`${k}:`, W - M - 200, my, { width: 200, align: 'right' });
    doc.font(F.bold).fontSize(9).fillColor(C.navy).text(v, W - M - 200, my + 10, { width: 200, align: 'right' });
    my += 24;
  }
  y = Math.max(headBottom, my) + 10;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 16;
  if (q.status === 'draft') {
    doc.font(F.bold).fontSize(9).fillColor(C.amber).text(t.draft, M, y, { width: CW, align: 'right', characterSpacing: 1 });
    y += 16;
  }

  // Customer (left) and trip (right)
  const colW = (CW - 24) / 2, sx = M + colW + 24, top = y;
  const label = (s, x, at) => doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(s.toUpperCase(), x, at, { characterSpacing: 0.6 });
  label(t.to, M, top);
  doc.font(F.bold).fontSize(11).fillColor(C.navy).text(cu.company || cu.name || '—', M, doc.y + 3, { width: colW });
  const who = [cu.company && cu.name ? `${t.attn}: ${cu.name}` : null, cu.nuit ? `${t.nuit}: ${cu.nuit}` : null, cu.address, cu.email, cu.phone, cu.country ? `${t.country}: ${cu.country}` : null];
  doc.font(F.regular).fontSize(9).fillColor(C.text).text(who.filter(Boolean).join('\n'), M, doc.y + 2, { width: colW, lineGap: 1 });
  const leftBottom = doc.y;
  label(t.trip, sx, top);
  const duration = [trip.days ? `${trip.days} ${t.days}` : null, trip.nights ? `${trip.nights} ${t.nights}` : null].filter(Boolean).join(' · ');
  const tripRows = [
    trip.destination ? `${t.dest}: ${trip.destination}` : null,
    trip.date_from ? `${t.dates}: ${span(trip.date_from, trip.date_to, lang)}` : null,
    duration ? `${t.duration}: ${duration}` : null,
    `${t.group}: ${trip.adults ?? 1} ${t.adults}${trip.children ? `, ${trip.children} ${t.children}` : ''}`,
    trip.experience ? `${t.experience}: ${trip.experience}` : null,
  ];
  doc.font(F.regular).fontSize(9).fillColor(C.text).text(tripRows.filter(Boolean).join('\n'), sx, doc.y + 3, { width: colW, lineGap: 1.5 });
  y = Math.max(leftBottom, doc.y) + 20;

  // Services
  const hasDiscount = money.items.some(i => i.discount_amount > 0);
  const cols = hasDiscount
    ? [{ k: 'desc', w: CW - 325 }, { k: 'qty', w: 35, a: 'right' }, { k: 'unit', w: 90, a: 'right' }, { k: 'disc', w: 100, a: 'right' }, { k: 'amount', w: 100, a: 'right' }]
    : [{ k: 'desc', w: CW - 230 }, { k: 'qty', w: 40, a: 'right' }, { k: 'unit', w: 90, a: 'right' }, { k: 'amount', w: 100, a: 'right' }];
  const header = () => {
    doc.rect(M, y, CW, 22).fillColor(C.navy).fill();
    let x = M + 8;
    doc.font(F.bold).fontSize(8).fillColor('#FFFFFF');
    for (const c of cols) { doc.text(t[c.k].toUpperCase(), x, y + 7, { width: c.w - 12, align: c.a || 'left', characterSpacing: 0.4 }); x += c.w; }
    y += 22;
  };
  header();
  for (const it of money.items) {
    const when = span(it.date_from, it.date_to, lang);
    const sub = [when, it.participants ? `${it.participants} ${t.pax}` : null, it.details].filter(Boolean).join(' · ');
    const dw = cols[0].w - 12;
    doc.font(F.bold).fontSize(9.5);
    const hTitle = doc.heightOfString(it.description, { width: dw });
    doc.font(F.regular).fontSize(8.5);
    const hSub = sub ? doc.heightOfString(sub, { width: dw }) + 2 : 0;
    const h = Math.max(hTitle + hSub, 11) + 12;
    if (y + h > BOTTOM) { newPage(); header(); }
    doc.font(F.bold).fontSize(9.5).fillColor(C.navy).text(it.description, M + 8, y + 6, { width: dw });
    if (sub) doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(sub, M + 8, doc.y + 2, { width: dw });
    let x = M + 8 + cols[0].w;
    const cells = [String(it.quantity), fmtMoney(it.unit_price, q.currency), ...(hasDiscount ? [it.discount_amount ? `- ${fmtMoney(it.discount_amount, q.currency)}` : '—'] : []), fmtMoney(it.amount, q.currency)];
    doc.font(F.regular).fontSize(9).fillColor(C.text);
    cols.slice(1).forEach((c, i) => { doc.text(cells[i], x, y + 6, { width: c.w - 12, align: 'right', lineBreak: false }); x += c.w; });
    y += h;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(C.line).stroke();
  }
  y += 12;

  // Financial summary
  const rows = [[t.subtotal, fmtMoney(money.subtotal, q.currency)]];
  if (money.discount_total) rows.push([t.discounts, `- ${fmtMoney(money.discount_total, q.currency)}`, C.green]);
  for (const f of money.fees) rows.push([f.label, fmtMoney(f.amount, q.currency)]);
  room(rows.length * 16 + 40);
  const tx0 = W - M - 258;
  for (const [k, v, color] of rows) {
    doc.font(F.regular).fontSize(9.5).fillColor(color || C.text).text(k, tx0 + 8, y, { width: 130 });
    doc.text(v, tx0 + 128, y, { width: 122, align: 'right' });
    y += 16;
  }
  y += 2;
  doc.rect(tx0, y, 258, 28).fillColor(C.soft).fill();
  doc.font(F.bold).fontSize(12).fillColor(C.navy).text(`${t.total} (${q.currency})`, tx0 + 8, y + 8, { width: 120 })
    .text(fmtMoney(money.total, q.currency), tx0 + 128, y + 8, { width: 122, align: 'right' });
  y += 44;

  // Complementary information
  const block = (title, body) => {
    if (!body) return;
    room(46);
    doc.font(F.bold).fontSize(9.5).fillColor(C.navy).text(title, M, y, { width: CW });
    doc.font(F.regular).fontSize(9).fillColor(C.text).text(body, M, doc.y + 3, { width: CW, lineGap: 1.5 });
    y = doc.y + 12;
  };
  block(t.message, q.message);
  block(t.payment, [q.payment_terms, q.deposit_percent ? `${t.deposit}: ${Number(q.deposit_percent)}%` : null, q.payment_due ? `${t.due}: ${q.payment_due}` : null].filter(Boolean).join('\n'));
  block(t.incl, q.inclusions);
  block(t.excl, q.exclusions);
  if ((q.itinerary || []).length) {
    room(46);
    doc.font(F.bold).fontSize(9.5).fillColor(C.navy).text(t.itinerary, M, y, { width: CW });
    y = doc.y + 4;
    for (const s of q.itinerary) {
      doc.font(F.regular).fontSize(9);
      const h = doc.heightOfString(s.description || ' ', { width: CW, lineGap: 1.5 }) + 16;
      room(h);
      doc.font(F.bold).fontSize(9).fillColor(C.teal).text(s.title || '', M, y, { width: CW });
      if (s.description) doc.font(F.regular).fontSize(9).fillColor(C.text).text(s.description, M, doc.y + 1, { width: CW, lineGap: 1.5 });
      y = doc.y + 6;
    }
    y += 6;
  }
  block(t.notes, trip.customer_notes);
  block(t.conditions, q.special_conditions);
  block(t.cancel, q.cancellation_terms);
  block(t.validity, t.validity_text(fmtDate(q.valid_until, lang)));

  // Footer on every page
  const range = doc.bufferedPageRange();
  const contacts = [issuer.phone, issuer.email, issuer.website].filter(Boolean).join('  ·  ');
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = H - 58;
    doc.moveTo(M, fy - 8).lineTo(W - M, fy - 8).lineWidth(0.6).strokeColor(C.line).stroke();
    doc.font(F.bold).fontSize(8).fillColor(C.navy).text(t.thanks, M, fy, { width: CW - 80, lineBreak: false });
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(`${q.number}  ·  ${t.page} ${i + 1}/${range.count}`, W - M - 140, fy, { width: 140, align: 'right', lineBreak: false });
    doc.text(contacts, M, fy + 12, { width: CW, lineBreak: false });
    doc.text(t.note, M, fy + 23, { width: CW, lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
