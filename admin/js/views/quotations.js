// Proposals: indicators, list with filters, and reports. All numbers come from
// the server; money is shown per currency, because nothing is converted.
import { $, addDays, badge, date, debounce, emptyState, esc, get, hashQuery, linkRows, money, pager, qs, setHashQuery, today } from '../core.js';

const FILTERS = [['', 'Todas'], ['draft', 'Rascunhos'], ['issued,sent,viewed', 'Por responder'], ['revision_requested', 'Alteração pedida'], ['accepted', 'Aceites'],
  ['converted', 'Convertidas'], ['declined', 'Recusadas'], ['expired', 'Expiradas'], ['withdrawn', 'Canceladas']];
const CLIENT_TYPES = { individual: 'Individual', group: 'Grupo', company: 'Empresa', agency: 'Agência', other: 'Outro' };
const RANGES = [['30', '30 dias'], ['90', '90 dias'], ['365', '12 meses'], ['', 'Sempre']];
const monthName = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const rate = (a, b) => (b ? `${Math.round(a / b * 1000) / 10}%` : '—');

export default async function quotations(main) {
  const query = hashQuery();
  const state = { status: query.get('status') || '', q: '', page: 1, range: '90' };
  main.innerHTML = `
    <div class="page-head"><div class="chips" role="group" aria-label="Período">${RANGES.map(([v, l]) => `<button type="button" class="chip" data-r="${v}" aria-pressed="${v === state.range}">${l}</button>`).join('')}</div>
      <div class="page-head__actions"><a class="btn btn--primary" href="#/quotations/new"><i class='bx bx-plus'></i>Nova cotação</a></div></div>
    <div id="stats"></div>
    <div class="card" style="margin-top:20px;">
      <div class="filters"><div class="chips" role="group" aria-label="Estado">${FILTERS.map(([v, l]) => `<button type="button" class="chip" data-s="${v}" aria-pressed="${v === state.status}">${l}</button>`).join('')}</div>
        <label class="field field--search"><span>Pesquisar</span><input type="search" id="qq" placeholder="Número, cliente, empresa ou destino"></label></div>
      <div id="qlist"></div></div>`;

  async function loadStats() {
    const box = $('#stats', main);
    const from = state.range ? addDays(today(), -Number(state.range)) : undefined;
    const d = await get('/admin/quotations/stats' + qs({ from, to: state.range ? today() : undefined }));
    const tile = (label, value, sub, kind = '', icon = 'bx-file') => `<div class="card kpi ${kind}"><div class="kpi__label">${label}</div><span class="kpi__icon"><i class='bx ${icon}'></i></span><div class="kpi__value">${value}</div><div class="kpi__sub">${sub}</div></div>`;
    box.innerHTML = `
      <div class="kpis">
        ${tile('Emitidas', d.issued, `${d.sent} enviadas`, 'kpi--navy', 'bx-file')}
        ${tile('A aguardar resposta', d.awaiting, `${d.revision} com alteração pedida`, 'kpi--accent', 'bx-time-five')}
        ${tile('Aceites', d.accepted, `${d.declined} recusadas · ${d.expired} expiradas`, 'kpi--green', 'bx-check-circle')}
        ${tile('Taxa de conversão', d.conversion_rate === null ? '—' : `${d.conversion_rate}%`, `${d.converted} convertidas em reserva`, 'kpi--teal', 'bx-transfer-alt')}
      </div>
      <div class="cols cols--even" style="margin-top:20px;">
        <div class="card"><div class="card__head"><h2>Valor das propostas</h2><span class="muted">não é receita</span></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Moeda</th><th class="right">Emitido</th><th class="right">Aceite</th><th class="right">Convertido</th></tr></thead><tbody>
            ${d.money.length ? d.money.map(m => `<tr><td class="t-strong">${esc(m.currency)}</td><td class="right mono">${money(m.issued_value, m.currency)}</td><td class="right mono">${money(m.accepted_value || 0, m.currency)}</td><td class="right mono">${money(m.converted_value || 0, m.currency)}</td></tr>`).join('')
              : '<tr><td colspan="4" class="muted">Sem propostas no período.</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card__head"><h2>Por mês</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Mês</th><th class="right">Emitidas</th><th class="right">Aceites</th><th class="right">Convertidas</th><th class="right">Conversão</th></tr></thead><tbody>
            ${d.months.length ? d.months.map(m => `<tr><td>${esc(monthName(m.month))}</td><td class="right">${m.issued}</td><td class="right">${m.accepted}</td><td class="right">${m.converted}</td><td class="right">${rate(m.converted, m.issued)}</td></tr>`).join('')
              : '<tr><td colspan="5" class="muted">Sem propostas no período.</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card__head"><h2>Por tipo de cliente</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Tipo</th><th class="right">Emitidas</th><th class="right">Convertidas</th><th class="right">Conversão</th></tr></thead><tbody>
            ${d.client_types.length ? d.client_types.map(t => `<tr><td>${esc(CLIENT_TYPES[t.client_type] || t.client_type)}</td><td class="right">${t.issued}</td><td class="right">${t.converted}</td><td class="right">${rate(t.converted, t.issued)}</td></tr>`).join('')
              : '<tr><td colspan="4" class="muted">Sem propostas no período.</td></tr>'}</tbody></table></div></div>
      </div>`;
  }

  async function load() {
    const box = $('#qlist', main);
    box.innerHTML = '<div class="card__body"><div class="skeleton"></div></div>';
    const r = await get('/admin/quotations' + qs({ status: state.status, q: state.q, page: state.page }));
    if (!r.items.length) { box.innerHTML = emptyState('bx-file', 'Nenhuma cotação encontrada.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Número</th><th>Cliente</th><th>Destino</th><th class="right">Total</th><th>Validade</th><th>Estado</th><th>Criada por</th></tr></thead><tbody>
      ${r.items.map(x => `<tr data-href="#/quotations/${x.id}${x.status === 'draft' ? '/edit' : ''}">
        <td class="t-strong mono nowrap">${esc(x.number)}${x.version > 1 ? ` <span class="muted">v${x.version}</span>` : ''}</td>
        <td><span class="t-strong">${esc(x.customer.company || x.customer.name || '—')}</span><span class="t-sub">${esc(x.customer.email || '')}</span></td>
        <td>${esc(x.trip.destination || '—')}${x.trip.date_from ? `<span class="t-sub">${date(x.trip.date_from)}</span>` : ''}</td>
        <td class="right mono nowrap">${money(x.total, x.currency)}</td><td class="nowrap">${date(x.valid_until)}</td>
        <td>${badge(x.status)}${x.booking_reference ? `<span class="t-sub mono">${esc(x.booking_reference)}</span>` : ''}</td>
        <td class="muted">${esc(x.created_by_name || '—')}</td></tr>`).join('')}</tbody></table></div>`;
    box.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    linkRows(box);
  }

  main.querySelectorAll('[data-s]').forEach(c => c.addEventListener('click', () => {
    state.status = c.dataset.s; state.page = 1;
    main.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    setHashQuery({ status: state.status });
    load();
  }));
  main.querySelectorAll('[data-r]').forEach(c => c.addEventListener('click', () => {
    state.range = c.dataset.r;
    main.querySelectorAll('[data-r]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    loadStats();
  }));
  $('#qq', main).addEventListener('input', debounce(e => { state.q = e.target.value.trim(); state.page = 1; load(); }));
  await Promise.all([loadStats(), load()]);
}
