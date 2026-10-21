// Customer accounts list.
import { $, badge, date, debounce, emptyState, esc, get, linkRows, pager, qs } from '../core.js';

export default async function customers(main) {
  const state = { q: '', role: '', page: 1 };
  main.innerHTML = `
    <div class="card"><div class="filters">
      <label class="field field--search"><span>Pesquisar</span><input type="search" id="cq" placeholder="Nome, e-mail ou telefone"></label>
      <label class="field"><span>Tipo</span><select id="cr"><option value="">Todos</option><option value="customer">Clientes</option><option value="admin">Administradores</option></select></label>
    </div><div id="clist"></div></div>
    <p class="muted small" style="margin-top:12px;">Clientes que reservam sem conta aparecem apenas nas reservas. Ao criarem conta e confirmarem o e-mail, as reservas anteriores ficam associadas automaticamente.</p>`;

  async function load() {
    const box = $('#clist', main);
    const r = await get('/admin/customers' + qs({ q: state.q, role: state.role, page: state.page }));
    if (!r.items.length) { box.innerHTML = emptyState('bx-user', 'Nenhuma conta encontrada.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Contacto</th><th>Tipo</th><th>E-mail</th><th>Reservas</th><th>Concluídas</th><th>Registo</th></tr></thead><tbody>
      ${r.items.map(u => `<tr data-href="#/customers/${u.id}"><td class="t-strong">${esc(u.name)}${u.disabled_at ? ' <span class="badge badge--disabled">Desactivada</span>' : ''}</td>
        <td>${esc(u.email)}<span class="t-sub">${esc(u.phone || '')}</span></td><td>${badge(u.role)}</td>
        <td>${u.email_verified_at ? '<span class="badge badge--confirmed badge--plain">Confirmado</span>' : '<span class="badge badge--pending badge--plain">Por confirmar</span>'}</td>
        <td>${u.bookings}</td><td>${u.completed}</td><td class="muted nowrap">${date(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
    box.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    linkRows(box);
  }
  $('#cq', main).addEventListener('input', debounce(e => { state.q = e.target.value.trim(); state.page = 1; load(); }));
  $('#cr', main).addEventListener('change', e => { state.role = e.target.value; state.page = 1; load(); });
  await load();
}
