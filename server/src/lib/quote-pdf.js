// ─────────────────────────────────────────────────────────────────────────────
// quote-pdf.js — A4 PDF of a quotation, rendered from the stored quotation
// (lines, total, validity) and its request. Same identity as the invoice:
// logo, issuer details and DM Sans. A quotation is not a booking nor a tax
// document, and the footer says so.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { brandFonts } from './pdf-fonts.js';
import { invoiceSettings } from './invoices.js';
import { todayLocal } from './dates.js';

const L = {
  pt: {
    title: 'Cotação', ref: 'Pedido', sent: 'Data', valid: 'Válida até', to: 'Para', trip: 'Viagem', dates: 'Datas', group: 'Grupo',
    adults: 'adulto(s)', children: 'criança(s)', flexible: 'datas flexíveis', desc: 'Descrição', qty: 'Qtd.', unit: 'Preço unit.', amount: 'Valor',
    total: 'Total', incl: 'Incluído', excl: 'Não incluído', message: 'Mensagem da equipa', nuit: 'NUIT', page: 'Página', attn: 'A/c',
    status: { sent: 'A AGUARDAR RESPOSTA', accepted: 'ACEITE', declined: 'RECUSADA', expired: 'EXPIRADA', withdrawn: 'RETIRADA', draft: 'RASCUNHO' },
    note: 'Esta cotação não é uma reserva nem um documento fiscal. Os preços são válidos até à data indicada e sujeitos a disponibilidade.',
  },
  en: {
    title: 'Quotation', ref: 'Request', sent: 'Date', valid: 'Valid until', to: 'For', trip: 'Trip', dates: 'Dates', group: 'Group',
    adults: 'adult(s)', children: 'child(ren)', flexible: 'flexible dates', desc: 'Description', qty: 'Qty', unit: 'Unit price', amount: 'Amount',
    total: 'Total', incl: 'Included', excl: 'Not included', message: 'Message from our team', nuit: 'NUIT', page: 'Page', attn: 'Attn',
    status: { sent: 'AWAITING YOUR ANSWER', accepted: 'ACCEPTED', declined: 'DECLINED', expired: 'EXPIRED', withdrawn: 'WITHDRAWN', draft: 'DRAFT' },
    note: 'This quotation is not a booking nor a tax document. Prices are valid until the date shown and subject to availability.',
  },
};
const C = { navy: '#0A2540', teal: '#00838F', text: '#334155', muted: '#64748B', line: '#E2E8F0', soft: '#F4F7FB' };
const STATUS_COLORS = { sent: '#B45309', accepted: '#047857', declined: '#B91C1C', expired: '#B91C1C', withdrawn: '#475569', draft: '#475569' };
const fmtMoney = (n, cur) => `${cur} ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d, lang) => (d ? new Date((/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T12:00:00Z' : d))
  .toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Maputo' }) : '—');

let logoCache = null;
async function logoPng(cfg) {
  if (logoCache) return logoCache;
  const file = path.join(cfg.siteRoot, 'logo.webp');
  logoCache = fs.existsSync(file) ? await sharp(fs.readFileSync(file)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer() : null;
  return logoCache;
}

/** Load a quotation with its request (null if it does not exist). */
export async function loadQuoteForPdf(db, quoteId) {
  const { rows: [q] } = await db.query(
    `select q.*, r.reference, r.name, r.email, r.phone, r.locale, r.date_from, r.date_to, r.flexible_dates, r.adults, r.children, r.billing
       from quotes q join custom_requests r on r.id = q.request_id where q.id = $1`, [quoteId]);
  return q || null;
}

export const quoteFilename = q => `cotacao-${q.reference}.pdf`;

export async function renderQuotePdf(db, cfg, q) {
  const lang = q.locale === 'en' ? 'en' : 'pt';
  const t = L[lang];
  const issuer = (await invoiceSettings(db)).issuer || {};
  const status = q.status === 'sent' && q.valid_until < todayLocal() ? 'expired' : q.status;
  const logo = await logoPng(cfg);
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 48, bottom: 60, left: 50, right: 50 },
    info: { Title: `${t.title} ${q.reference}`, Author: issuer.name || 'Maputo Blue' } });
  const chunks = [];
  doc.on('data', ch => chunks.push(ch));
  const done = new Promise(r => doc.on('end', r));
  const W = doc.page.width, M = 50, CW = W - 2 * M;
  const F = brandFonts(doc);

  // Header: logo + issuer (left), title + reference (right)
  let y = 44;
  if (logo) doc.image(logo, M, y, { height: 54 });
  const ix = M + (logo ? 70 : 0);
  doc.font(F.bold).fontSize(14).fillColor(C.navy).text(issuer.name || 'Maputo Blue', ix, y + 2, { width: 250 });
  doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text([
    issuer.address, issuer.phone, issuer.email, issuer.website, issuer.nuit ? `${t.nuit}: ${issuer.nuit}` : null,
  ].filter(Boolean).join('\n'), ix, doc.y + 2, { width: 250, lineGap: 1 });
  const headBottom = doc.y;
  doc.font(F.heavy).fontSize(24).fillColor(C.navy).text(t.title.toUpperCase(), W - M - 220, y, { width: 220, align: 'right', characterSpacing: 1.5 });
  let my = y + 34;
  for (const [k, v] of [[t.ref, q.reference], [t.sent, fmtDate(q.sent_at || q.created_at, lang)], [t.valid, fmtDate(q.valid_until, lang)]]) {
    doc.font(F.regular).fontSize(8.5).fillColor(C.muted).text(`${k}:`, W - M - 220, my, { width: 220, align: 'right' });
    doc.font(F.bold).fontSize(9).fillColor(C.navy).text(v, W - M - 220, my + 10, { width: 220, align: 'right' });
    my += 24;
  }
  y = Math.max(headBottom, my) + 10;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 16;

  // Status pill
  const sc = STATUS_COLORS[status] || C.muted;
  const sText = t.status[status] || status;
  doc.font(F.bold).fontSize(9);
  const sw = doc.widthOfString(sText) + 24;
  doc.roundedRect(W - M - sw, y, sw, 22, 11).lineWidth(1.4).strokeColor(sc).stroke();
  doc.fillColor(sc).text(sText, W - M - sw, y + 6, { width: sw, align: 'center' });

  // For (left) + trip (right)
  const colW = (CW - 24) / 2;
  doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.to.toUpperCase(), M, y, { characterSpacing: 0.6 });
  const co = q.billing && q.billing.company_name ? q.billing : null;
  if (co) {
    // Requested on behalf of a company: company first, then the contact person
    doc.font(F.bold).fontSize(11).fillColor(C.navy).text(co.company_name, M, doc.y + 3, { width: colW });
    doc.font(F.regular).fontSize(9).fillColor(C.text).text([co.nuit ? `${t.nuit}: ${String(co.nuit).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')}` : null, co.address].filter(Boolean).join('\n'), M, doc.y + 2, { width: colW, lineGap: 1 });
    doc.font(F.bold).fontSize(9).fillColor(C.navy).text(`${t.attn}: ${q.name}`, M, doc.y + 6, { width: colW });
  } else {
    doc.font(F.bold).fontSize(11).fillColor(C.navy).text(q.name, M, doc.y + 3, { width: colW });
  }
  doc.font(F.regular).fontSize(9).fillColor(C.text).text([q.email, q.phone].filter(Boolean).join('\n'), M, doc.y + 2, { width: colW, lineGap: 1 });
  const leftBottom = doc.y;
  const sx = M + colW + 24;
  doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.trip.toUpperCase(), sx, y + 30, { characterSpacing: 0.6 });
  const dates = q.date_from ? `${fmtDate(q.date_from, lang)}${q.date_to && q.date_to !== q.date_from ? ` – ${fmtDate(q.date_to, lang)}` : ''}` : '—';
  doc.font(F.regular).fontSize(9).fillColor(C.text)
    .text(`${t.dates}: ${dates}${q.flexible_dates ? ` (${t.flexible})` : ''}`, sx, doc.y + 3, { width: colW })
    .text(`${t.group}: ${q.adults} ${t.adults}${q.children ? `, ${q.children} ${t.children}` : ''}`, sx, doc.y + 1, { width: colW });
  y = Math.max(leftBottom, doc.y) + 20;

  // Lines
  const cols = [{ k: 'desc', w: CW - 250 }, { k: 'qty', w: 50, a: 'right' }, { k: 'unit', w: 95, a: 'right' }, { k: 'amount', w: 105, a: 'right' }];
  const header = () => {
    doc.rect(M, y, CW, 22).fillColor(C.navy).fill();
    let x = M + 8;
    doc.font(F.bold).fontSize(8).fillColor('#FFFFFF');
    for (const c of cols) { doc.text(t[c.k].toUpperCase(), x, y + 7, { width: c.w - 12, align: c.a || 'left', characterSpacing: 0.4 }); x += c.w; }
    y += 22;
  };
  header();
  for (const it of q.items || []) {
    doc.font(F.regular).fontSize(9.5);
    const h = Math.max(doc.heightOfString(it.description, { width: cols[0].w - 12 }), 11) + 12;
    if (y + h > doc.page.height - 160) { doc.addPage(); y = 56; header(); }
    let x = M + 8;
    const cells = [it.description, String(it.quantity), fmtMoney(it.unit_price, q.currency), fmtMoney(it.quantity * it.unit_price, q.currency)];
    cols.forEach((c, i) => { doc.fillColor(C.text).text(cells[i], x, y + 6, { width: c.w - 12, align: c.a || 'left' }); x += c.w; });
    y += h;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(C.line).stroke();
  }
  y += 12;
  doc.rect(W - M - 258, y, 258, 28).fillColor(C.soft).fill();
  doc.font(F.bold).fontSize(12).fillColor(C.navy).text(t.total, W - M - 250, y + 8, { width: 120 })
    .text(fmtMoney(q.total, q.currency), W - M - 130, y + 8, { width: 122, align: 'right' });
  y += 44;

  const block = (title, body) => {
    if (!body) return;
    if (y > doc.page.height - 140) { doc.addPage(); y = 56; }
    doc.font(F.bold).fontSize(9.5).fillColor(C.navy).text(title, M, y, { width: CW });
    doc.font(F.regular).fontSize(9).fillColor(C.text).text(body, M, doc.y + 3, { width: CW, lineGap: 1.5 });
    y = doc.y + 12;
  };
  block(t.incl, q.inclusions);
  block(t.excl, q.exclusions);
  block(t.message, q.message);

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 46;
    doc.moveTo(M, fy - 8).lineTo(W - M, fy - 8).lineWidth(0.6).strokeColor(C.line).stroke();
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(t.note, M, fy, { width: CW - 70 });
    doc.text(`${t.page} ${i + 1}/${range.count}`, W - M - 60, fy, { width: 60, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
