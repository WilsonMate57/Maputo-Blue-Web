// Quote requests list.
import { $, badge, date, debounce, emptyState, esc, get, linkRows, money, pager, qs } from '../core.js';

const STATUSES = [['', 'Todos'], ['new', 'Novos'], ['under_review', 'Em análise'], ['quote_sent', 'Cotação enviada'], ['accepted', 'Aceites'], ['rejected', 'Rejeitados'], ['closed', 'Fechados']];

export default async function requests(main) {
  const state = { status: '', q: '', page: 1 };
  main.innerHTML = `
    <div class="page-head"><div class="chips" role="group" aria-label="Estado">${STATUSES.map(([v, l]) => `<button type="button" class="chip" data-s="${v}" aria-pressed="${v === ''}">${l}</button>`).join('')}</div></div>
    <div class="card"><div class="filters"><label class="field field--search"><span>Pesquisar</span><input type="search" id="rq" placeholder="Referência, nome, e-mail, empresa ou NUIT"></label></div><div id="rlist"></div></div>`;

  async function load() {
    const box = $('#rlist', main);
    box.innerHTML = '<div class="card__body"><div class="skeleton"></div></div>';
    const r = await get('/admin/requests' + qs({ status: state.status, q: state.q, page: state.page }));
    if (!r.items.length) { box.innerHTML = emptyState('bx-map-alt', 'Nenhum pedido encontrado.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Referência</th><th>Cliente</th><th>Pedido</th><th>Datas</th><th>Grupo</th><th class="right">Orçamento</th><th>Estado</th><th>Recebido</th></tr></thead><tbody>
      ${r.items.map(x => `<tr data-href="#/requests/${x.id}">
        <td class="t-strong mono">${esc(x.reference)}</td><td>${x.company ? `<span class="t-strong"><i class='bx bx-buildings'></i> ${esc(x.company)}</span><span class="t-sub">${esc(x.name)} · ${esc(x.email)}</span>` : `${esc(x.name)}<span class="t-sub">${esc(x.email)}</span>`}</td>
        <td>${(x.items || []).length ? esc(x.items.slice(0, 2).map(i => i.title).join(', ')) + (x.items.length > 2 ? `<span class="t-sub">+${x.items.length - 2} item(s)</span>` : '') : esc(x.destination || '—')}</td>
        <td class="nowrap">${x.date_from ? `${date(x.date_from)}${x.date_to ? ` → ${date(x.date_to)}` : ''}` : 'Flexível'}${x.flexible_dates && x.date_from ? '<span class="t-sub">flexível</span>' : ''}</td>
        <td>${x.adults} + ${x.children}</td><td class="right mono">${x.budget ? money(x.budget, x.budget_currency) : '—'}</td>
        <td>${badge(x.status)}</td><td class="muted nowrap">${date(x.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
    box.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    linkRows(box);
  }
  main.querySelectorAll('[data-s]').forEach(c => c.addEventListener('click', () => {
    state.status = c.dataset.s; state.page = 1;
    main.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    load();
  }));
  $('#rq', main).addEventListener('input', debounce(e => { state.q = e.target.value.trim(); state.page = 1; load(); }));
  await load();
}
