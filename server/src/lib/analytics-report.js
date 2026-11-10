// ─────────────────────────────────────────────────────────────────────────────
// analytics-report.js — The site statistics report: one calculation used by the
// admin screen and by the exports (PDF to share, CSV to work with in Excel), so
// the numbers are always the same. Dates are calendar days in Africa/Maputo.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { addDays, diffDays } from './dates.js';
import { badRequest } from './errors.js';
import { brandFonts } from './pdf-fonts.js';

const TZ = 'Africa/Maputo';
// $1 = first day, $2 = last day (inclusive)
const IN_RANGE = `at >= ($1::date)::timestamp at time zone '${TZ}' and at < ($2::date + 1)::timestamp at time zone '${TZ}'`;

export function checkRange(from, to) {
  const n = diffDays(from, to);
  if (n < 0 || n > 400) throw badRequest('invalid_range', 'Choose a period of up to 400 days');
  return n + 1;
}

async function totals(pool, from, to) {
  const { rows: [t] } = await pool.query(
    `with pv as (select * from analytics_pageviews where ${IN_RANGE}),
          s as (select session_id, count(*) n from pv group by session_id)
     select (select count(*) from pv)::int as pageviews,
            (select count(distinct visitor_hash) from pv)::int as visitors,
            (select count(*) from s)::int as sessions,
            (select coalesce(round(avg(engaged_ms)), 0) from pv where engaged_ms > 0)::int as avg_engaged_ms,
            (select coalesce(round(avg(scroll_pct)), 0) from pv where engaged_ms > 0)::int as avg_scroll,
            (select count(*) from s where n = 1)::int as single_page_sessions,
            (select count(*) from analytics_clicks where ${IN_RANGE})::int as clicks,
            (select count(*) from bookings where created_at >= ($1::date)::timestamp at time zone '${TZ}'
               and created_at < ($2::date + 1)::timestamp at time zone '${TZ}')::int as bookings,
            (select count(*) from custom_requests where created_at >= ($1::date)::timestamp at time zone '${TZ}'
               and created_at < ($2::date + 1)::timestamp at time zone '${TZ}')::int as requests`, [from, to]);
  return t;
}

/** Everything the statistics screen shows for a period, with the previous period of the same length. */
export async function buildReport(pool, from, to, { limit = 20 } = {}) {
  const days = checkRange(from, to);
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const q = sql => pool.query(sql, [from, to]).then(r => r.rows);

  const [current, previous, daily, pages, sources, devices, browsers, clicks, titles] = await Promise.all([
    totals(pool, from, to),
    totals(pool, prevFrom, prevTo),
    q(`select d::date::text as day,
              count(p.id)::int as pageviews, count(distinct p.visitor_hash)::int as visitors
         from generate_series($1::date, $2::date, interval '1 day') d
         left join analytics_pageviews p on (p.at at time zone '${TZ}')::date = d::date
        group by d order by d`),
    q(`select path, max(title) as title, count(*)::int as views, count(distinct visitor_hash)::int as visitors,
              coalesce(round(avg(engaged_ms) filter (where engaged_ms > 0)), 0)::int as avg_ms,
              coalesce(round(avg(scroll_pct) filter (where engaged_ms > 0)), 0)::int as avg_scroll
         from analytics_pageviews where ${IN_RANGE} group by path order by views desc limit ${limit}`),
    q(`select coalesce(utm_source, referrer_host) as source, (utm_source is not null) as campaign,
              count(distinct session_id)::int as sessions
         from analytics_pageviews where ${IN_RANGE} group by 1, 2 order by sessions desc limit ${Math.min(limit, 50)}`),
    q(`select device as name, count(distinct session_id)::int as sessions
         from analytics_pageviews where ${IN_RANGE} group by 1 order by sessions desc`),
    q(`select browser as name, count(distinct session_id)::int as sessions
         from analytics_pageviews where ${IN_RANGE} group by 1 order by sessions desc limit 8`),
    q(`select label, path, max(href) as href, count(*)::int as clicks
         from analytics_clicks where ${IN_RANGE} and label is not null and label <> ''
        group by label, path order by clicks desc limit ${limit}`),
    pool.query(`select id, content->>'title' as title from packages`).then(r => r.rows),
  ]);

  // Package pages are told apart by ?id= — show the package name
  const pkg = Object.fromEntries(titles.map(t => [t.id, t.title]));
  const name = p => {
    const m = /package\.html\?id=([a-z0-9-]+)/.exec(p);
    return m && pkg[m[1]] ? pkg[m[1]] : null;
  };
  for (const p of pages) p.name = name(p.path) || p.title || p.path;
  for (const c of clicks) c.page = name(c.path) || c.path;

  return { from, to, previous: { from: prevFrom, to: prevTo, ...previous }, current, daily, pages, sources, devices, browsers, clicks };
}

/* ── Labels ────────────────────────────────────────────────────────────── */
const L = {
  pt: {
    title: 'Relatório de visitas ao site', period: 'Período', previous: 'Comparado com', generated: 'Gerado em',
    visitors: 'Visitantes', pageviews: 'Visualizações de páginas', sessions: 'Visitas', avgTime: 'Tempo médio por página',
    pagesPerVisit: 'Páginas por visita', exits: 'Saídas na 1.ª página', clicks: 'Cliques registados', leads: 'Pedidos (reservas + cotações)',
    bookings: 'Reservas', requests: 'Pedidos de cotação', scroll: 'Rolagem média', noPrev: 'sem dados antes', same: 'igual',
    daily: 'Visitas por dia', day: 'Dia', pages: 'Páginas mais visitadas', page: 'Página', address: 'Endereço', views: 'Vistas',
    time: 'Tempo médio', sources: 'De onde vêm as visitas', source: 'Origem', direct: 'Directo / desconhecido', campaign: 'campanha',
    devices: 'Dispositivos', device: 'Dispositivo', browsers: 'Navegadores', browser: 'Navegador', share: '%',
    topClicks: 'Botões e links mais clicados', button: 'Botão / link', target: 'Destino',
    scrollShort: 'Rolagem', clicksShort: 'Cliques',
    summary: 'Resumo', metric: 'Indicador', current: 'Período', before: 'Período anterior', change: 'Variação',
    deviceNames: { desktop: 'Computador', tablet: 'Tablet', mobile: 'Telemóvel' },
    method: 'Estatísticas próprias do site, sem cookies. Os visitantes são contados por dia, e as visitas da equipa com sessão iniciada não contam. O mapa de cliques só pode ser visto no painel.',
    empty: 'Sem visitas registadas neste período.', page_n: 'Página',
  },
  en: {
    title: 'Website visits report', period: 'Period', previous: 'Compared with', generated: 'Generated on',
    visitors: 'Visitors', pageviews: 'Page views', sessions: 'Visits', avgTime: 'Average time per page',
    pagesPerVisit: 'Pages per visit', exits: 'Exits on first page', clicks: 'Recorded clicks', leads: 'Requests (bookings + quotations)',
    bookings: 'Bookings', requests: 'Quotation requests', scroll: 'Average scroll', noPrev: 'no earlier data', same: 'same',
    daily: 'Visits per day', day: 'Day', pages: 'Most visited pages', page: 'Page', address: 'Address', views: 'Views',
    time: 'Average time', sources: 'Where visits come from', source: 'Source', direct: 'Direct / unknown', campaign: 'campaign',
    devices: 'Devices', device: 'Device', browsers: 'Browsers', browser: 'Browser', share: '%',
    topClicks: 'Most clicked buttons and links', button: 'Button / link', target: 'Goes to',
    scrollShort: 'Scroll', clicksShort: 'Clicks',
    summary: 'Summary', metric: 'Measure', current: 'Period', before: 'Previous period', change: 'Change',
    deviceNames: { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' },
    method: 'The site\'s own statistics, without cookies. Visitors are counted per day, and visits by signed-in staff do not count. The click map can only be viewed in the panel.',
    empty: 'No visits recorded in this period.', page_n: 'Page',
  },
};

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const seconds = ms => Math.round((ms || 0) / 1000);
const duration = ms => { const s = seconds(ms); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
const fmtDay = (d, lang) => new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-GB' : 'pt-PT', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const num = (n, lang) => Number(n || 0).toLocaleString(lang === 'en' ? 'en-GB' : 'pt-PT', { maximumFractionDigits: 1 });

/** The summary rows, as the screen shows them: [label, current, previous, kind]. */
function summaryRows(r, t) {
  const c = r.current, p = r.previous;
  const pps = x => (x.sessions ? x.pageviews / x.sessions : 0);
  return [
    [t.visitors, c.visitors, p.visitors, 'n'],
    [t.pageviews, c.pageviews, p.pageviews, 'n'],
    [t.sessions, c.sessions, p.sessions, 'n'],
    [t.avgTime, c.avg_engaged_ms, p.avg_engaged_ms, 'ms'],
    [t.pagesPerVisit, pps(c), pps(p), 'd'],
    [t.exits, pct(c.single_page_sessions, c.sessions), pct(p.single_page_sessions, p.sessions), '%', true],
    [t.scroll, c.avg_scroll, p.avg_scroll, '%'],
    [t.clicks, c.clicks, p.clicks, 'n'],
    [t.bookings, c.bookings, p.bookings, 'n'],
    [t.requests, c.requests, p.requests, 'n'],
  ];
}
const changeOf = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);

/* ── CSV (Excel): one file, one section per table ─────────────────────── */
const cell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
};

export function reportCsv(r, lang = 'pt') {
  const t = L[lang === 'en' ? 'en' : 'pt'];
  const out = [];
  const section = (title, head, rows) => { out.push([title], head, ...rows, []); };
  out.push([t.title], [t.period, r.from, r.to], [t.previous, r.previous.from, r.previous.to], []);
  section(t.summary, [t.metric, t.current, t.before, `${t.change} (%)`], summaryRows(r, t).map(([label, cur, prev, kind]) => {
    const v = x => (kind === 'ms' ? seconds(x) : kind === 'd' ? Math.round(x * 10) / 10 : x);
    return [kind === 'ms' ? `${label} (s)` : kind === '%' ? `${label} (%)` : label, v(cur), v(prev), changeOf(cur, prev) ?? ''];
  }));
  section(t.daily, [t.day, t.pageviews, t.visitors], r.daily.map(d => [d.day, d.pageviews, d.visitors]));
  section(t.pages, [t.page, t.address, t.views, t.visitors, `${t.time} (s)`, `${t.scroll} (%)`],
    r.pages.map(p => [p.name, p.path, p.views, p.visitors, seconds(p.avg_ms), p.avg_scroll]));
  section(t.sources, [t.source, t.sessions], r.sources.map(s => [s.source ? `${s.source}${s.campaign ? ` (${t.campaign})` : ''}` : t.direct, s.sessions]));
  const all = r.devices.reduce((a, x) => a + x.sessions, 0);
  section(t.devices, [t.device, t.sessions, t.share], r.devices.map(d => [t.deviceNames[d.name] || d.name, d.sessions, pct(d.sessions, all)]));
  section(t.browsers, [t.browser, t.sessions, t.share], r.browsers.map(b => [b.name, b.sessions, pct(b.sessions, all)]));
  section(t.topClicks, [t.button, t.page, t.target, t.clicks], r.clicks.map(c => [c.label, c.page, c.href || '', c.clicks]));
  return '﻿' + out.map(row => row.map(cell).join(',')).join('\r\n');
}

/* ── PDF: an A4 report to share ───────────────────────────────────────── */
const C = { navy: '#0A2540', teal: '#0089A0', orange: '#D96A00', text: '#334155', muted: '#64748B', line: '#E2E8F0', soft: '#F4F7FB', up: '#047857', down: '#B91C1C' };

let logoCache = null;
async function logoPng(cfg) {
  if (logoCache) return logoCache;
  const file = path.join(cfg.siteRoot, 'logo.webp');
  logoCache = fs.existsSync(file) ? await sharp(fs.readFileSync(file)).resize({ height: 160, withoutEnlargement: true }).png().toBuffer() : null;
  return logoCache;
}

export async function reportPdf(r, cfg, lang = 'pt') {
  lang = lang === 'en' ? 'en' : 'pt';
  const t = L[lang];
  const logo = await logoPng(cfg);
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 48, bottom: 56, left: 48, right: 48 },
    info: { Title: `${t.title} ${r.from} – ${r.to}`, Author: 'Maputo Blue' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(res => doc.on('end', res));
  const F = brandFonts(doc);
  const W = doc.page.width, M = 48, CW = W - 2 * M, BOTTOM = doc.page.height - 70;
  let y = 44;
  const room = h => { if (y + h > BOTTOM) { doc.addPage(); y = 52; } };

  // Header
  if (logo) doc.image(logo, M, y, { height: 46 });
  doc.font(F.heavy).fontSize(18).fillColor(C.navy).text(t.title, M + 60, y + 2, { width: CW - 60 });
  doc.font(F.regular).fontSize(9.5).fillColor(C.muted)
    .text(`${t.period}: ${fmtDay(r.from, lang)} – ${fmtDay(r.to, lang)}   ·   ${t.previous}: ${fmtDay(r.previous.from, lang)} – ${fmtDay(r.previous.to, lang)}`, M + 60, y + 26, { width: CW - 60 });
  y += 60;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(2).strokeColor(C.teal).stroke();
  y += 16;

  if (!r.current.pageviews && !r.previous.pageviews) {
    doc.font(F.regular).fontSize(11).fillColor(C.text).text(t.empty, M, y);
    y = doc.y + 10;
  } else {
    // Summary: 4 × 2 tiles, the change against the previous period under each value
    const tiles = summaryRows(r, t).filter((_, i) => i !== 2 && i !== 6);   // visits and scroll are in the tables
    const cols = 4, gap = 10, tw = (CW - gap * (cols - 1)) / cols, th = 74;
    tiles.forEach(([label, cur, prev, kind, lowerIsBetter], i) => {
      const x = M + (i % cols) * (tw + gap), ty = y + Math.floor(i / cols) * (th + gap);
      doc.roundedRect(x, ty, tw, th, 6).fillColor(C.soft).fill();
      doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(label.toUpperCase(), x + 10, ty + 9, { width: tw - 20, characterSpacing: .3, height: 20 });
      const value = kind === 'ms' ? duration(cur) : kind === '%' ? `${cur}%` : kind === 'd' ? num(cur, lang) : num(cur, lang);
      doc.font(F.heavy).fontSize(17).fillColor(C.navy).text(value, x + 10, ty + 32, { width: tw - 20, lineBreak: false });
      const ch = changeOf(cur, prev);
      const good = ch !== null && (lowerIsBetter ? ch < 0 : ch > 0);
      doc.font(F.bold).fontSize(8).fillColor(ch === null || ch === 0 ? C.muted : good ? C.up : C.down)
        .text(ch === null ? t.noPrev : ch === 0 ? t.same : `${ch > 0 ? '+' : ''}${ch}%`, x + 10, ty + 56, { width: tw - 20, lineBreak: false });
    });
    y += 2 * th + gap + 22;

    // Visits per day: two lines on one scale
    room(200);
    doc.font(F.bold).fontSize(12).fillColor(C.navy).text(t.daily, M, y);
    doc.font(F.regular).fontSize(8.5);
    const legend = [[t.pageviews, C.teal], [t.visitors, C.orange]];
    let lx = W - M;
    for (const [lab, col] of legend.reverse()) {
      const w = doc.widthOfString(lab);
      lx -= w;
      doc.fillColor(C.text).text(lab, lx, y + 3, { lineBreak: false });
      lx -= 18;
      doc.moveTo(lx, y + 8).lineTo(lx + 12, y + 8).lineWidth(2.2).strokeColor(col).stroke();
      lx -= 14;
    }
    y += 22;
    const ch = { x: M + 30, y, w: CW - 30, h: 150 };
    const max = Math.max(1, ...r.daily.flatMap(d => [d.pageviews, d.visitors]));
    const step = 10 ** Math.floor(Math.log10(max));
    const top = Math.ceil(max / step) * step;
    const px = i => ch.x + (r.daily.length > 1 ? (i / (r.daily.length - 1)) * ch.w : ch.w / 2);
    const py = v => ch.y + ch.h - (v / top) * ch.h;
    doc.font(F.regular).fontSize(7.5).fillColor(C.muted);
    for (const v of [0, top / 2, top]) {
      doc.moveTo(ch.x, py(v)).lineTo(ch.x + ch.w, py(v)).lineWidth(.5).strokeColor(C.line).stroke();
      doc.fillColor(C.muted).text(num(v, lang), M - 4, py(v) - 4, { width: 30, align: 'right', lineBreak: false });
    }
    const every = Math.max(1, Math.ceil(r.daily.length / 8));
    r.daily.forEach((d, i) => {
      const last = r.daily.length - 1;
      if (i === last || (i % every === 0 && last - i >= every * 0.6)) doc.fillColor(C.muted).text(`${d.day.slice(8, 10)}/${d.day.slice(5, 7)}`, px(i) - 16, ch.y + ch.h + 5, { width: 32, align: 'center', lineBreak: false });
    });
    for (const [key, col] of [['pageviews', C.teal], ['visitors', C.orange]]) {
      r.daily.forEach((d, i) => (i ? doc.lineTo(px(i), py(d[key])) : doc.moveTo(px(i), py(d[key]))));
      doc.lineWidth(1.8).strokeColor(col).lineJoin('round').stroke();
    }
    y = ch.y + ch.h + 26;

    // Tables
    const table = (title, head, widths, rows, aligns) => {
      if (!rows.length) return;
      room(60);
      doc.font(F.bold).fontSize(12).fillColor(C.navy).text(title, M, y);
      y = doc.y + 6;
      const drawHead = () => {
        doc.rect(M, y, CW, 18).fillColor(C.soft).fill();
        let x = M;
        head.forEach((h, i) => { doc.font(F.bold).fontSize(7.5).fillColor(C.muted).text(h.toUpperCase(), x + 6, y + 6, { width: widths[i] - 12, align: aligns[i], lineBreak: false }); x += widths[i]; });
        y += 20;
      };
      drawHead();
      for (const row of rows) {
        doc.font(F.regular).fontSize(8.5);
        // A cell may be [main, sub]: the sub-line is smaller and muted (a page's address under its name)
        const hOf = (v, i) => (Array.isArray(v)
          ? doc.font(F.bold).fontSize(8.5).heightOfString(v[0], { width: widths[i] - 12 }) + (v[1] ? doc.font(F.regular).fontSize(7.5).heightOfString(v[1], { width: widths[i] - 12 }) + 1 : 0)
          : doc.font(F.regular).fontSize(8.5).heightOfString(String(v), { width: widths[i] - 12 }));
        const h = Math.max(...row.map(hOf)) + 8;
        if (y + h > BOTTOM) { doc.addPage(); y = 52; drawHead(); }
        let x = M;
        row.forEach((v, i) => {
          const o = { width: widths[i] - 12, align: aligns[i] };
          if (Array.isArray(v)) {
            doc.font(F.bold).fontSize(8.5).fillColor(C.navy).text(v[0], x + 6, y + 4, o);
            if (v[1]) doc.font(F.regular).fontSize(7.5).fillColor(C.muted).text(v[1], x + 6, doc.y + 1, o);
          } else doc.font(i === 0 ? F.bold : F.regular).fontSize(8.5).fillColor(i === 0 ? C.navy : C.text).text(String(v), x + 6, y + 4, o);
          x += widths[i];
        });
        y += h;
        doc.moveTo(M, y).lineTo(W - M, y).lineWidth(.5).strokeColor(C.line).stroke();
      }
      y += 18;
    };
    const all = r.devices.reduce((a, x) => a + x.sessions, 0);
    table(t.pages, [t.page, t.views, t.visitors, t.time, t.scrollShort], [CW - 260, 60, 70, 70, 60],
      r.pages.map(p => [[p.name, p.name === p.path ? null : p.path], num(p.views, lang), num(p.visitors, lang), duration(p.avg_ms), `${p.avg_scroll}%`]),
      ['left', 'right', 'right', 'right', 'right']);
    table(t.topClicks, [t.button, t.page, t.clicksShort], [CW * .42, CW * .42, CW * .16],
      r.clicks.map(c => [c.label, c.page, num(c.clicks, lang)]), ['left', 'left', 'right']);
    table(t.sources, [t.source, t.sessions], [CW - 90, 90],
      r.sources.map(s => [s.source ? `${s.source}${s.campaign ? ` (${t.campaign})` : ''}` : t.direct, num(s.sessions, lang)]), ['left', 'right']);
    table(t.devices, [t.device, t.sessions, t.share], [CW - 160, 90, 70],
      r.devices.map(d => [t.deviceNames[d.name] || d.name, num(d.sessions, lang), `${pct(d.sessions, all)}%`]), ['left', 'right', 'right']);
    table(t.browsers, [t.browser, t.sessions, t.share], [CW - 160, 90, 70],
      r.browsers.map(b => [b.name, num(b.sessions, lang), `${pct(b.sessions, all)}%`]), ['left', 'right', 'right']);
  }

  // Footer on every page
  const range = doc.bufferedPageRange();
  const stamp = new Date().toLocaleString(lang === 'en' ? 'en-GB' : 'pt-PT', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 44;
    doc.moveTo(M, fy - 8).lineTo(W - M, fy - 8).lineWidth(.5).strokeColor(C.line).stroke();
    doc.font(F.regular).fontSize(7).fillColor(C.muted).text(t.method, M, fy, { width: CW - 70 });
    doc.text(`${t.generated} ${stamp} · ${t.page_n} ${i + 1}/${range.count}`, W - M - 140, fy + 18, { width: 140, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
