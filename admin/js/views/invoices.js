// Invoices: financial summary (invoiced vs received vs outstanding), status
// tabs, search, filters, pagination, CSV export of the filtered records.
import { $, METHODS, addDays, badge, date, debounce, emptyState, esc, get, hashQuery, linkRows, money, pager, qs, setHashQuery, today } from '../core.js';

const TABS = [
  ['', 'Todas'], ['unpaid', 'Por pagar'], ['partially_paid', 'Parcialmente pagas'], ['overdue', 'Vencidas'],
  ['paid', 'Pagas'], ['draft', 'Rascunhos'], ['cancelled', 'Anuladas'], ['refunded', 'Reembolsadas'],
];

export default async function invoices(main) {
  const q = hashQuery();
  const state = {
    q: q.get('q') || '', status: q.get('status') || '', method: q.get('method') || '',
    from: q.get('from') || '', to: q.get('to') || '', sort: q.get('sort') || 'issued_desc', page: Number(q.get('page') || 1),
  };
  const period = { from: addDays(today(), -30), to: today() };

  main.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Finanças</span><h2>Facturas</h2>
        <p class="page-head__sub">O valor facturado não é dinheiro recebido: só contam como recebidos os pagamentos verificados e registados.</p></div>
      <div class="page-head__actions">
        <a class="btn btn--ghost" id="csv" href="#"><i class='bx bx-download'></i>Exportar CSV</a>
        <a class="btn btn--primary" href="#/invoices/new"><i class='bx bx-plus'></i>Emitir factura</a>
      </div>
    </div>

    <section class="card" style="margin-bottom:20px;" aria-labelledby="fin-title">
      <div class="card__head"><h2 id="fin-title">Resumo financeiro</h2>
        <div class="chips" role="group" aria-label="Período do resumo">
          <button type="button" class="chip" data-range="7">7 dias</button>
          <button type="button" class="chip" data-range="30" aria-pressed="true">30 dias</button>
          <button type="button" class="chip" data-range="90">90 dias</button>
          <button type="button" class="chip" data-range="365">12 meses</button>
        </div></div>
      <div class="card__body" id="summary"><div class="skeleton"></div><div class="skeleton"></div></div>
    </section>

    <div class="card">
      <div class="filters" style="padding-bottom:12px;">
        <div class="seg" role="group" aria-label="Filtrar por estado" id="tabs">
          ${TABS.map(([k, l]) => `<button type="button" data-status="${k}" aria-pressed="${state.status === k}">${l}</button>`).join('')}
        </div>
      </div>
      <form class="filters" id="filters" role="search" style="border-radius:0;background:var(--surface);">
        <label class="field field--search"><span>Pesquisar</span><input type="search" name="q" value="${esc(state.q)}" placeholder="Nº da factura, referência da reserva, cliente ou e-mail"></label>
        <label class="field"><span>Método de pagamento</span><select name="method"><option value="">Todos</option>
          ${Object.entries(METHODS).map(([k, v]) => `<option value="${k}"${state.method === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Emitida de</span><input type="date" name="from" value="${esc(state.from)}"></label>
        <label class="field"><span>até</span><input type="date" name="to" value="${esc(state.to)}"></label>
        <label class="field"><span>Ordenar</span><select name="sort">
          <option value="issued_desc">Mais recentes</option><option value="issued_asc">Mais antigas</option>
          <option value="number_desc">Número ↓</option><option value="balance_desc">Maior saldo em dívida</option><option value="due_asc">Vencimento mais próximo</option></select></label>
      </form>
      <div id="list"></div>
    </div>`;
  $('[name=sort]', main).value = state.sort;

  const list = $('#list', main);
  const filterParams = () => ({ q: state.q, status: state.status, method: state.method, from: state.from, to: state.to, sort: state.sort });

  async function loadSummary() {
    const box = $('#summary', main);
    const s = await get('/admin/invoices/summary' + qs(period));
    if (!s.currencies.length) { box.innerHTML = emptyState('bx-receipt', 'Ainda não há facturas nem pagamentos neste período.'); return; }
    box.innerHTML = s.currencies.map(c => {
      const series = s.series.filter(x => x.currency === c.currency);
      const max = Math.max(1, ...series.map(x => Math.max(x.invoiced, x.received)));
      return `
      ${s.currencies.length > 1 ? `<h3 style="font-size:14px;margin:0 0 10px;">${esc(c.currency)}</h3>` : ''}
      <div class="kpis" style="margin-bottom:16px;">
        <div class="card kpi kpi--navy"><div class="kpi__label">Facturado no período</div><span class="kpi__icon"><i class='bx bx-receipt'></i></span>
          <div class="kpi__value">${money(c.invoiced, c.currency)}</div><div class="kpi__sub">${c.issued} factura(s) emitida(s)</div></div>
        <div class="card kpi kpi--green"><div class="kpi__label">Recebido no período</div><span class="kpi__icon"><i class='bx bx-wallet'></i></span>
          <div class="kpi__value">${money(c.net_received, c.currency)}</div><div class="kpi__sub">${c.returned ? `${money(c.received, c.currency)} recebidos − ${money(c.returned, c.currency)} devolvidos` : 'pagamentos verificados'}</div></div>
        <div class="card kpi kpi--accent"><div class="kpi__label">Em dívida (hoje)</div><span class="kpi__icon"><i class='bx bx-time-five'></i></span>
          <div class="kpi__value">${money(c.outstanding_now, c.currency)}</div><div class="kpi__sub">${c.open_now} factura(s) em aberto</div></div>
        <div class="card kpi kpi--red"><div class="kpi__label">Vencido (hoje)</div><span class="kpi__icon"><i class='bx bx-error'></i></span>
          <div class="kpi__value">${money(c.overdue_now, c.currency)}</div><div class="kpi__sub">não é receita até ser pago</div></div>
      </div>
      <div class="grid grid--2" style="align-items:end;">
        <div>
          <div class="chart" role="img" aria-label="Facturado e recebido por ${s.granularity === 'month' ? 'mês' : 'dia'}">
            ${series.length ? series.map(x => `<div class="chart__col" title="${esc(x.key)} · facturado ${money(x.invoiced, c.currency)} · recebido ${money(x.received, c.currency)}">
              <span class="chart__inv" style="height:${(x.invoiced / max) * 100}%"></span><span class="chart__rec" style="height:${(Math.max(x.received, 0) / max) * 100}%"></span></div>`).join('')
              : '<p class="muted small" style="margin:auto;">Sem movimentos no período.</p>'}
          </div>
          ${series.length ? `<div class="chart-axis"><span>${esc(series[0].key)}</span><span>${esc(series.at(-1).key)}</span></div>` : ''}
          <div class="chart-legend"><span><i style="background:#BFDBFE"></i>Facturado</span><span><i style="background:var(--sea-green-dark)"></i>Recebido</span></div>
        </div>
        <ul class="list-plain">
          <li><span>Pagas</span><button type="button" class="link" data-jump="paid">${c.paid}</button></li>
          <li><span>Parcialmente pagas</span><button type="button" class="link" data-jump="partially_paid">${c.partially_paid}</button></li>
          <li><span>Por pagar</span><button type="button" class="link" data-jump="unpaid">${c.unpaid}</button></li>
          <li><span>Vencidas</span><button type="button" class="link" data-jump="overdue">${c.overdue}</button></li>
        </ul>
      </div>`;
    }).join('<hr style="border:0;border-top:1px solid var(--border);margin:20px 0;">');
    box.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
      state.status = b.dataset.jump; state.from = period.from; state.to = period.to; state.page = 1;
      $('[name=from]', main).value = state.from; $('[name=to]', main).value = state.to;
      syncTabs(); load();
    }));
  }

  function syncTabs() {
    main.querySelectorAll('#tabs [data-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.status === state.status)));
  }

  async function load() {
    setHashQuery({ ...filterParams(), page: state.page > 1 ? state.page : '' });
    $('#csv', main).href = '/api/admin/invoices.csv' + qs(filterParams());
    list.innerHTML = '<div class="card__body"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    const r = await get('/admin/invoices' + qs({ ...filterParams(), page: state.page, page_size: 25 }));
    if (!r.items.length) {
      list.innerHTML = emptyState('bx-receipt', state.q || state.status || state.method || state.from
        ? 'Nenhuma factura encontrada com estes filtros.'
        : 'Ainda não emitiu facturas. Comece por “Emitir factura” e indique a referência da reserva.');
      return;
    }
    list.innerHTML = `<div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>Factura</th><th>Reserva</th><th>Cliente</th><th>Emissão</th><th>Vencimento</th>
        <th class="right">Total</th><th class="right">Pago</th><th class="right">Em dívida</th><th>Estado</th><th>Método</th></tr></thead>
      <tbody>${r.items.map(i => `
        <tr data-href="#/invoices/${i.id}">
          <td data-label="Factura" class="t-strong mono nowrap">${esc(i.number || 'Rascunho')}</td>
          <td data-label="Reserva" class="mono nowrap">${esc(i.booking_reference)}</td>
          <td data-label="Cliente">${esc(i.customer_name)}<span class="t-sub">${esc(i.service || '')}</span></td>
          <td data-label="Emissão" class="nowrap">${date(i.issue_date)}</td>
          <td data-label="Vencimento" class="nowrap${i.display_status === 'overdue' ? '" style="color:var(--danger);font-weight:700;' : ''}">${date(i.due_date)}</td>
          <td data-label="Total" class="right mono nowrap">${money(i.total, i.currency)}</td>
          <td data-label="Pago" class="right mono nowrap">${money(i.amount_paid, i.currency)}</td>
          <td data-label="Em dívida" class="right mono nowrap t-strong">${i.doc_status === 'issued' ? money(Math.max(i.balance, 0), i.currency) : '—'}</td>
          <td data-label="Estado">${badge(i.display_status)}</td>
          <td data-label="Método" class="small">${(i.methods || '').split(',').filter(Boolean).map(m => esc(METHODS[m] || m)).join(', ') || '—'}</td>
        </tr>`).join('')}</tbody></table></div>`;
    list.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    linkRows(list);
  }

  const form = $('#filters', main);
  form.addEventListener('input', debounce(e => { if (e.target.name === 'q') { state.q = e.target.value.trim(); state.page = 1; load(); } }, 350));
  form.addEventListener('change', e => { if (e.target.name && e.target.name !== 'q') { state[e.target.name] = e.target.value; state.page = 1; load(); } });
  form.addEventListener('submit', e => e.preventDefault());
  main.querySelectorAll('#tabs [data-status]').forEach(b => b.addEventListener('click', () => { state.status = b.dataset.status; state.page = 1; syncTabs(); load(); }));
  main.querySelectorAll('[data-range]').forEach(chip => chip.addEventListener('click', () => {
    main.querySelectorAll('[data-range]').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
    period.to = today(); period.from = addDays(period.to, -Number(chip.dataset.range));
    loadSummary();
  }));
  await Promise.all([loadSummary(), load()]);
}
