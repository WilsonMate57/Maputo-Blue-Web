// Bookings: search, filters, pagination, CSV export.
import { $, badge, date, debounce, emptyState, esc, get, hashQuery, linkRows, money, pager, qs, setHashQuery } from '../core.js';

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
const STATUS_PT = { pending: 'Pendentes', confirmed: 'Confirmadas', completed: 'Concluídas', cancelled: 'Canceladas', rejected: 'Rejeitadas' };

export default async function bookings(main) {
  const q = hashQuery();
  const state = {
    q: q.get('q') || '', status: q.get('status') || '', package_id: q.get('package_id') || '',
    from: q.get('from') || '', to: q.get('to') || '', date_field: q.get('date_field') || 'start_date',
    cancel_requested: q.get('cancel_requested') || '', sort: q.get('sort') || 'created_desc', page: Number(q.get('page') || 1),
  };
  const packages = await get('/admin/packages');
  const selected = new Set(state.status.split(',').filter(Boolean));

  main.innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Operação</span><h2>Reservas</h2><p class="page-head__sub">Pedidos, confirmações e pagamentos. Abra uma reserva para confirmar, registar pagamentos ou emitir a factura.</p></div>
      <div class="page-head__actions"><a class="btn btn--ghost" id="csv" href="#"><i class='bx bx-download'></i>Exportar CSV</a></div>
    </div>
    <div class="card">
      <div class="filters" style="padding-bottom:12px;">
        <div class="seg" role="group" aria-label="Filtrar por estado">
          <button type="button" data-status="" aria-pressed="${!selected.size}">Todas</button>
          ${STATUSES.map(s => `<button type="button" data-status="${s}" aria-pressed="${selected.has(s)}">${STATUS_PT[s]}</button>`).join('')}
          <button type="button" data-cancelreq aria-pressed="${!!state.cancel_requested}"><i class='bx bx-error-circle'></i>Pedidos de cancelamento</button>
        </div>
      </div>
      <form class="filters" id="filters" role="search" style="border-radius:0;background:var(--surface);">
        <label class="field field--search"><span>Pesquisar</span><input type="search" name="q" value="${esc(state.q)}" placeholder="Referência, nome, e-mail ou telefone"></label>
        <label class="field"><span>Pacote</span><select name="package_id"><option value="">Todos</option>
          ${packages.map(p => `<option value="${esc(p.id)}"${p.id === state.package_id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <label class="field"><span>Data de</span><select name="date_field">
          <option value="start_date"${state.date_field === 'start_date' ? ' selected' : ''}>Viagem / check-in</option>
          <option value="created_at"${state.date_field === 'created_at' ? ' selected' : ''}>Criação do pedido</option></select></label>
        <label class="field"><span>De</span><input type="date" name="from" value="${esc(state.from)}"></label>
        <label class="field"><span>Até</span><input type="date" name="to" value="${esc(state.to)}"></label>
        <label class="field"><span>Ordenar</span><select name="sort">
          <option value="created_desc">Mais recentes</option><option value="created_asc">Mais antigos</option>
          <option value="date_asc">Data da viagem ↑</option><option value="date_desc">Data da viagem ↓</option></select></label>
      </form>
      <div id="list"></div>
    </div>`;
  $('[name=sort]', main).value = state.sort;

  const list = $('#list', main);
  const filterParams = () => ({ q: state.q, status: [...selected].join(','), package_id: state.package_id, from: state.from, to: state.to,
    date_field: state.date_field, cancel_requested: state.cancel_requested, sort: state.sort });

  async function load() {
    setHashQuery({ ...filterParams(), page: state.page > 1 ? state.page : '' });
    $('#csv', main).href = '/api/admin/bookings.csv' + qs(filterParams());
    list.innerHTML = '<div class="card__body"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
    const r = await get('/admin/bookings' + qs({ ...filterParams(), page: state.page, page_size: 25 }));
    if (!r.items.length) { list.innerHTML = emptyState('bx-calendar-x', 'Nenhuma reserva encontrada com estes filtros.'); return; }
    list.innerHTML = `<div class="table-wrap"><table class="table table--stack">
      <thead><tr><th>Referência</th><th>Cliente</th><th>Experiência</th><th>Data</th><th>Pessoas</th><th class="right">Total</th><th>Estado</th><th>Pagamento</th><th>Criada</th></tr></thead>
      <tbody>${r.items.map(b => `
        <tr data-href="#/bookings/${b.id}">
          <td data-label="Referência" class="t-strong mono nowrap">${esc(b.reference)}${b.cancel_requested_at && ['pending', 'confirmed'].includes(b.status) ? ' <i class="bx bx-error-circle" style="color:var(--danger)" title="Cancelamento pedido"></i>' : ''}</td>
          <td data-label="Cliente">${esc(b.customer_name)}<span class="t-sub">${esc(b.customer_email)}</span></td>
          <td data-label="Experiência">${esc(b.package_title)}${b.option_key ? `<span class="t-sub">${esc(b.option_key)}</span>` : ''}</td>
          <td data-label="Data" class="nowrap">${date(b.start_date)}</td>
          <td data-label="Pessoas">${b.adults}${b.children ? ` + ${b.children}` : ''}</td>
          <td data-label="Total" class="right mono nowrap">${money(b.total, b.currency)}</td>
          <td data-label="Estado">${badge(b.status)}${b.status === 'pending' && b.hold_expires_at && new Date(b.hold_expires_at) < new Date() ? '<span class="t-sub">bloqueio expirado</span>' : ''}</td>
          <td data-label="Pagamento">${badge(b.payment_status)}</td>
          <td data-label="Criada" class="nowrap muted">${date(b.created_at)}</td>
        </tr>`).join('')}</tbody></table></div>`;
    list.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    linkRows(list);
  }

  const form = $('#filters', main);
  form.addEventListener('input', debounce(e => { if (e.target.name === 'q') { state.q = e.target.value.trim(); state.page = 1; load(); } }, 350));
  form.addEventListener('change', e => { if (e.target.name && e.target.name !== 'q') { state[e.target.name] = e.target.value; state.page = 1; load(); } });
  form.addEventListener('submit', e => e.preventDefault());
  main.querySelectorAll('[data-status]').forEach(chip => chip.addEventListener('click', () => {
    const s = chip.dataset.status;
    if (!s) selected.clear(); else selected.has(s) ? selected.delete(s) : selected.add(s);
    main.querySelectorAll('[data-status]').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.status ? selected.has(c.dataset.status) : !selected.size)));
    state.page = 1;
    load();
  }));
  const cr = main.querySelector('[data-cancelreq]');
  cr.addEventListener('click', () => { state.cancel_requested = state.cancel_requested ? '' : '1'; cr.setAttribute('aria-pressed', String(!!state.cancel_requested)); state.page = 1; load(); });
  await load();
}
