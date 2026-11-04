// Visit statistics (first-party, collected by assets/js/analytics.js): totals vs
// the previous period, visits per day, pages, sources, devices, most clicked
// buttons and a click heatmap drawn over the real page.
import { $, $$, addDays, emptyState, esc, get, qs, today } from '../core.js';

const DEVICES = { desktop: 'Computador', tablet: 'Tablet', mobile: 'Telemóvel' };
const DEVICE_W = { desktop: 1366, tablet: 820, mobile: 390 };
const SERIES = [
  { key: 'pageviews', label: 'Visualizações', color: 'var(--viz-1)' },
  { key: 'visitors', label: 'Visitantes', color: 'var(--viz-2)' },
];

const int = n => Number(n || 0).toLocaleString('pt-PT');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const duration = ms => {
  const s = Math.round((ms || 0) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};
const shortDay = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function delta(cur, prev, { lowerIsBetter = false } = {}) {
  if (!prev) return '<span class="kpi__sub">sem dados no período anterior</span>';
  const d = Math.round(((cur - prev) / prev) * 100);
  if (!d) return '<span class="kpi__sub">= período anterior</span>';
  const good = lowerIsBetter ? d < 0 : d > 0;
  return `<span class="kpi__sub"><span class="viz-delta viz-delta--${good ? 'up' : 'down'}"><i class='bx ${d > 0 ? 'bx-up-arrow-alt' : 'bx-down-arrow-alt'}'></i>${Math.abs(d)}%</span> vs período anterior</span>`;
}

/** Two-series line chart (same unit), crosshair + tooltip, legend, direct end labels. */
function lineChart(box, daily) {
  const W = 760, H = 240, M = { t: 16, r: 92, b: 28, l: 44 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;
  const max = Math.max(1, ...daily.flatMap(d => SERIES.map(s => d[s.key])));
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const x = i => M.l + (daily.length > 1 ? (i / (daily.length - 1)) * iw : iw / 2);
  const y = v => M.t + ih - (v / top) * ih;
  const ticks = [0, top / 2, top];
  const every = Math.max(1, Math.ceil(daily.length / 8));
  const path = key => daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const last = daily.length - 1;
  // Direct labels at the line ends, nudged apart when they would overlap
  const ends = SERIES.map(s => ({ s, y: y(daily[last][s.key]) })).sort((a, b) => a.y - b.y);
  if (ends.length === 2 && ends[1].y - ends[0].y < 14) { ends[0].y -= 7; ends[1].y += 7; }

  box.innerHTML = `
    <div class="viz-legend">${SERIES.map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>
    <div class="viz-plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visualizações e visitantes por dia">
        ${ticks.map(t => `<line class="viz-grid" x1="${M.l}" x2="${M.l + iw}" y1="${y(t)}" y2="${y(t)}"/>
          <text class="viz-axis" x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end">${int(t)}</text>`).join('')}
        ${daily.map((d, i) => ((i % every === 0 && last - i >= every / 2) || i === last) ? `<text class="viz-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${shortDay(d.day)}</text>` : '').join('')}
        ${SERIES.map(s => `<path d="${path(s.key)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
        ${ends.map(e => `<circle cx="${x(last)}" cy="${y(daily[last][e.s.key])}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>
          <text class="viz-end" x="${x(last) + 10}" y="${e.y + 4}">${int(daily[last][e.s.key])} ${e.s.label.toLowerCase()}</text>`).join('')}
        <line class="viz-cross" y1="${M.t}" y2="${M.t + ih}" visibility="hidden"/>
        ${SERIES.map(s => `<circle class="viz-dot" data-k="${s.key}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`).join('')}
        <rect class="viz-hit" x="${M.l}" y="${M.t}" width="${iw}" height="${ih}" fill="transparent" tabindex="0" aria-label="Explorar valores por dia"/>
      </svg>
      <div class="viz-tip" hidden></div>
    </div>
    <details class="viz-table"><summary>Ver tabela</summary><div class="table-wrap"><table class="table"><thead><tr><th>Dia</th>
      ${SERIES.map(s => `<th class="right">${s.label}</th>`).join('')}</tr></thead><tbody>
      ${daily.map(d => `<tr><td>${shortDay(d.day)}</td>${SERIES.map(s => `<td class="right mono">${int(d[s.key])}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></details>`;

  const svg = $('svg', box), tip = $('.viz-tip', box), cross = $('.viz-cross', box), hit = $('.viz-hit', box);
  let current = last;
  function show(i) {
    current = Math.max(0, Math.min(last, i));
    const d = daily[current], cx = x(current);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    $$('.viz-dot', svg).forEach(c => { c.setAttribute('cx', cx); c.setAttribute('cy', y(d[c.dataset.k])); c.setAttribute('visibility', 'visible'); });
    tip.replaceChildren();
    const head = document.createElement('div'); head.className = 'viz-tip__head'; head.textContent = shortDay(d.day); tip.appendChild(head);
    for (const s of SERIES) {
      const row = document.createElement('div'); row.className = 'viz-tip__row';
      const sw = document.createElement('i'); sw.style.background = s.color;
      const v = document.createElement('b'); v.textContent = int(d[s.key]);
      row.append(sw, v, document.createTextNode(` ${s.label}`));
      tip.appendChild(row);
    }
    tip.hidden = false;
    const r = svg.getBoundingClientRect(), k = r.width / W;
    const left = cx * k + 12, flip = left + tip.offsetWidth > r.width;
    tip.style.left = `${flip ? cx * k - tip.offsetWidth - 12 : left}px`;
    tip.style.top = `${M.t * k}px`;
  }
  function hide() {
    tip.hidden = true; cross.setAttribute('visibility', 'hidden');
    $$('.viz-dot', svg).forEach(c => c.setAttribute('visibility', 'hidden'));
  }
  hit.addEventListener('pointermove', e => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    show(Math.round(((px - M.l) / iw) * last));
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(current));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(current + (e.key === 'ArrowRight' ? 1 : -1)); }
  });
}

/** Table rows with an inline bar (single series, value in text ink). */
function barRows(rows, { label, value, max, extra = () => '' }) {
  const top = max || Math.max(1, ...rows.map(value));
  return rows.map(r => `<tr><td class="viz-bar-cell"><span class="t-strong">${label(r)}</span>
      <span class="viz-bar" style="width:${Math.max(2, (value(r) / top) * 100)}%"></span></td>
    <td class="right mono">${int(value(r))}</td>${extra(r)}</tr>`).join('');
}

export default async function analytics(main) {
  const state = { from: addDays(today(), -29), to: today(), device: 'desktop', path: '' };
  main.innerHTML = `
    <div class="card" style="margin-bottom:20px;">
      <form class="filters" id="an-filters">
        <label class="field"><span>De</span><input type="date" name="from" value="${state.from}"></label>
        <label class="field"><span>Até</span><input type="date" name="to" value="${state.to}"></label>
        <div class="chips" role="group" aria-label="Períodos rápidos">
          <button type="button" class="chip" data-range="7">7 dias</button>
          <button type="button" class="chip" data-range="30" aria-pressed="true">30 dias</button>
          <button type="button" class="chip" data-range="90">90 dias</button>
          <button type="button" class="chip" data-range="365">12 meses</button>
        </div>
      </form>
      <p class="muted" style="margin:0;padding:10px 20px;font-size:12.5px;">Estatísticas próprias do site, sem cookies. Visitantes são contados por dia; as visitas da equipa com sessão iniciada no painel não contam.</p>
    </div>
    <div id="an-body"></div>
    <div class="card" id="an-heat" style="margin-top:20px;">
      <div class="card__head"><h2>Mapa de cliques</h2>
        <div class="chips" role="group" aria-label="Dispositivo">${Object.entries(DEVICES).map(([k, l]) =>
          `<button type="button" class="chip" data-device="${k}" aria-pressed="${k === state.device}">${l}</button>`).join('')}</div></div>
      <div class="card__body" id="heat-body"></div>
    </div>`;

  const form = $('#an-filters', main), body = $('#an-body', main), heatBody = $('#heat-body', main);

  async function load() {
    body.innerHTML = '<div class="card"><div class="card__body"><div class="skeleton"></div><div class="skeleton"></div></div></div>';
    const d = await get('/admin/analytics' + qs({ from: state.from, to: state.to }));
    const c = d.current, p = d.previous;
    const pps = c.sessions ? (c.pageviews / c.sessions) : 0, ppsPrev = p.sessions ? (p.pageviews / p.sessions) : 0;
    const bounce = pct(c.single_page_sessions, c.sessions), bouncePrev = pct(p.single_page_sessions, p.sessions);
    const leads = c.bookings + c.requests, leadsPrev = p.bookings + p.requests;
    const totalSessions = Math.max(1, d.devices.reduce((a, x) => a + x.sessions, 0));

    body.innerHTML = !c.pageviews && !p.pageviews ? `<div class="card">${emptyState('bx-line-chart', 'Ainda não há visitas registadas neste período. Os dados começam a aparecer assim que o site recebe visitas.')}</div>` : `
      <div class="kpis">
        <div class="card kpi kpi--teal"><div class="kpi__label">Visitantes</div><div class="kpi__icon"><i class='bx bx-user'></i></div>
          <div class="kpi__value">${int(c.visitors)}</div>${delta(c.visitors, p.visitors)}</div>
        <div class="card kpi"><div class="kpi__label">Visualizações de páginas</div><div class="kpi__icon"><i class='bx bx-show'></i></div>
          <div class="kpi__value">${int(c.pageviews)}</div>${delta(c.pageviews, p.pageviews)}</div>
        <div class="card kpi"><div class="kpi__label">Tempo médio por página</div><div class="kpi__icon"><i class='bx bx-time-five'></i></div>
          <div class="kpi__value">${duration(c.avg_engaged_ms)}</div>${delta(c.avg_engaged_ms, p.avg_engaged_ms)}</div>
        <div class="card kpi"><div class="kpi__label">Páginas por visita</div><div class="kpi__icon"><i class='bx bx-layer'></i></div>
          <div class="kpi__value">${pps.toFixed(1).replace('.', ',')}</div>${delta(pps, ppsPrev)}</div>
        <div class="card kpi"><div class="kpi__label">Saídas na 1.ª página</div><div class="kpi__icon"><i class='bx bx-log-out'></i></div>
          <div class="kpi__value">${bounce}%</div>${delta(bounce, bouncePrev, { lowerIsBetter: true })}</div>
        <div class="card kpi kpi--accent"><div class="kpi__label">Pedidos (reservas + cotações)</div><div class="kpi__icon"><i class='bx bx-cart'></i></div>
          <div class="kpi__value">${int(leads)}</div><span class="kpi__sub">${leads <= c.sessions && c.sessions ? `${pct(leads, c.sessions)}% das visitas · ` : ''}${int(c.bookings)} reservas, ${int(c.requests)} cotações${leadsPrev ? ` · antes ${int(leadsPrev)}` : ''}</span></div>
      </div>

      <div class="card" style="margin-bottom:20px;"><div class="card__head"><h2>Visitas por dia</h2><span class="muted">${int(c.sessions)} visitas · rolagem média ${c.avg_scroll}% da página</span></div>
        <div class="card__body" id="an-chart"></div></div>

      <div class="grid grid--2" style="margin-bottom:20px;">
        <div class="card"><div class="card__head"><h2>Páginas mais visitadas</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Página</th><th class="right">Vistas</th><th class="right">Tempo médio</th><th class="right">Rolagem</th></tr></thead><tbody>
          ${barRows(d.pages, { label: r => `${esc(r.name)}<span class="t-sub">${esc(r.path)}</span>`, value: r => r.views,
            extra: r => `<td class="right mono">${duration(r.avg_ms)}</td><td class="right mono">${r.avg_scroll}%</td>` })}
          </tbody></table></div></div>
        <div class="card"><div class="card__head"><h2>Botões e links mais clicados</h2></div>
          ${d.clicks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Botão / link</th><th class="right">Cliques</th></tr></thead><tbody>
          ${barRows(d.clicks, { label: r => `${esc(r.label)}<span class="t-sub">${esc(r.page)}${r.href ? ` → ${esc(r.href)}` : ''}</span>`, value: r => r.clicks })}
          </tbody></table></div>` : emptyState('bx-pointer', 'Sem cliques registados no período.')}</div>
      </div>

      <div class="grid grid--2">
        <div class="card"><div class="card__head"><h2>De onde vêm as visitas</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Origem</th><th class="right">Visitas</th></tr></thead><tbody>
          ${barRows(d.sources, { label: r => (r.source ? `${esc(r.source)}${r.campaign ? '<span class="t-sub">campanha (utm_source)</span>' : ''}` : 'Directo / desconhecido<span class="t-sub">endereço escrito, favoritos ou apps</span>'), value: r => r.sessions })}
          </tbody></table></div></div>
        <div class="card"><div class="card__head"><h2>Dispositivos e navegadores</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Dispositivo</th><th class="right">Visitas</th><th class="right">%</th></tr></thead><tbody>
          ${barRows(d.devices, { label: r => esc(DEVICES[r.name] || r.name), value: r => r.sessions, max: totalSessions,
            extra: r => `<td class="right mono">${pct(r.sessions, totalSessions)}%</td>` })}
          </tbody></table>
          <table class="table"><thead><tr><th>Navegador</th><th class="right">Visitas</th><th class="right">%</th></tr></thead><tbody>
          ${barRows(d.browsers, { label: r => esc(r.name), value: r => r.sessions, max: totalSessions,
            extra: r => `<td class="right mono">${pct(r.sessions, totalSessions)}%</td>` })}
          </tbody></table></div></div>
      </div>`;
    if (c.pageviews || p.pageviews) lineChart($('#an-chart', body), d.daily);
  }

  /* ── Heatmap: clicks drawn over the real page, at the device's width ── */
  let heatSeq = 0;
  async function loadHeat() {
    const seq = ++heatSeq;
    heatBody.innerHTML = '<div class="skeleton"></div>';
    const h = await get('/admin/analytics/heatmap' + qs({ from: state.from, to: state.to, device: state.device, path: state.path }));
    if (seq !== heatSeq) return;
    if (!h.path) { heatBody.innerHTML = emptyState('bx-mouse', `Sem cliques em ${DEVICES[state.device].toLowerCase()} neste período.`); return; }
    state.path = h.path;
    const w = DEVICE_W[state.device];
    heatBody.innerHTML = `
      <div class="heat-tools">
        <label class="field" style="flex:1 1 320px;"><span>Página</span><select id="heat-page">
          ${h.pages.map(p => `<option value="${esc(p.path)}"${p.path === h.path ? ' selected' : ''}>${esc(p.path)} — ${int(p.clicks)} cliques</option>`).join('')}</select></label>
        <div class="heat-legend" aria-hidden="true"><span>Menos cliques</span><i></i><span>Mais cliques</span></div>
      </div>
      <div class="heat-layout">
        <div class="heat-stage" id="heat-stage" style="--w:${w}px"><p class="muted">A carregar a página…</p></div>
        <div class="heat-side"><h3>Mais clicados nesta página</h3>
          ${h.top.length ? `<table class="table"><tbody>${barRows(h.top, { label: r => esc(r.label), value: r => r.clicks })}</tbody></table>`
            : '<p class="muted">Os cliques registados foram fora de botões ou links.</p>'}
          <p class="muted" style="font-size:12px;">${int(h.points.length)} cliques em ${DEVICES[state.device].toLowerCase()} (largura ${w}px). A página é mostrada como está hoje; se o conteúdo mudou no período, as posições podem não coincidir.</p>
        </div>
      </div>`;
    $('#heat-page', heatBody).addEventListener('change', e => { state.path = e.target.value; loadHeat(); });
    renderHeat($('#heat-stage', heatBody), h.path, h.points, w, seq);
  }

  function renderHeat(stage, path, points, w, seq) {
    const frame = document.createElement('iframe');
    frame.title = `Pré-visualização de ${path}`;
    frame.src = `${path}${path.includes('?') ? '&' : '?'}mb_noanalytics=1`;
    frame.width = w; frame.height = 900;
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('tabindex', '-1');
    const canvas = document.createElement('canvas');
    canvas.className = 'heat-canvas';
    const inner = document.createElement('div');
    inner.className = 'heat-inner';
    inner.append(frame, canvas);
    stage.replaceChildren(inner);

    function layout() {
      if (seq !== heatSeq) return;
      let docH = 900;
      try { docH = Math.min(20000, frame.contentDocument.documentElement.scrollHeight); } catch { /* cross-origin: keep default */ }
      frame.height = docH;
      const scale = Math.min(1, stage.clientWidth / w);
      inner.style.transform = `scale(${scale})`;
      stage.style.height = `${Math.ceil(docH * scale)}px`;
      drawHeat(canvas, points, w, docH);
    }
    frame.addEventListener('load', () => { layout(); setTimeout(layout, 1500); setTimeout(layout, 4000); });
    window.addEventListener('resize', layout);
  }

  form.addEventListener('change', () => {
    state.from = form.from.value; state.to = form.to.value;
    $$('[data-range]', form).forEach(c => c.setAttribute('aria-pressed', 'false'));
    load(); loadHeat();
  });
  $$('[data-range]', form).forEach(b => b.addEventListener('click', () => {
    state.to = today(); state.from = addDays(state.to, -(Number(b.dataset.range) - 1));
    form.from.value = state.from; form.to.value = state.to;
    $$('[data-range]', form).forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    load(); loadHeat();
  }));
  $$('[data-device]', main).forEach(b => b.addEventListener('click', () => {
    state.device = b.dataset.device; state.path = '';
    $$('[data-device]', main).forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    loadHeat();
  }));

  await Promise.all([load(), loadHeat()]);
}

/**
 * Density heatmap: clicks accumulate as soft spots (half resolution), then the
 * density is coloured on one sequential ramp, light orange → deep red.
 */
const RAMP = [[253, 186, 116], [249, 115, 22], [194, 65, 12], [124, 45, 18]];
function drawHeat(canvas, points, w, h) {
  const k = 0.5, cw = Math.ceil(w * k), ch = Math.ceil(h * k), r = Math.round(22 * k * 2);
  canvas.width = cw; canvas.height = ch;
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, cw, ch);
  if (!points.length) return;
  const stamp = document.createElement('canvas');
  stamp.width = stamp.height = r * 2;
  const s = stamp.getContext('2d');
  const g = s.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  s.fillStyle = g; s.fillRect(0, 0, r * 2, r * 2);
  ctx.globalAlpha = points.length > 2000 ? 0.06 : points.length > 300 ? 0.12 : 0.25;
  for (const [px, py] of points) ctx.drawImage(stamp, px * cw - r, py * k - r);
  ctx.globalAlpha = 1;
  const img = ctx.getImageData(0, 0, cw, ch), data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!a) continue;
    const t = a / 255, seg = Math.min(RAMP.length - 2, Math.floor(t * (RAMP.length - 1)));
    const f = t * (RAMP.length - 1) - seg, c0 = RAMP[seg], c1 = RAMP[seg + 1];
    data[i] = c0[0] + (c1[0] - c0[0]) * f;
    data[i + 1] = c0[1] + (c1[1] - c0[1]) * f;
    data[i + 2] = c0[2] + (c1[2] - c0[2]) * f;
    data[i + 3] = Math.min(220, 60 + a * 1.4);
  }
  ctx.putImageData(img, 0, 0);
}
