// Audit log viewer.
import { $, dateTime, emptyState, esc, get, qs } from '../core.js';

const ENTITY = { booking: 'Reserva', package: 'Pacote', availability: 'Disponibilidade', promotion: 'Promoção', request: 'Pedido', user: 'Utilizador', review: 'Avaliação', media: 'Imagem', settings: 'Definições', mail: 'E-mail', catalog: 'Catálogo' };
const LINK = { booking: id => `#/bookings/${id}`, package: id => `#/packages/${id}`, request: id => `#/requests/${id}`, user: id => `#/customers/${id}` };

export default async function audit(main) {
  const state = { entity_type: '', page: 1 };
  main.innerHTML = `
    <div class="card"><div class="filters">
      <label class="field"><span>Tipo</span><select id="at"><option value="">Todos</option>${Object.entries(ENTITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    </div><div id="al"></div></div>`;

  async function load() {
    const box = $('#al', main);
    const r = await get('/admin/audit' + qs(state));
    if (!r.items.length) { box.innerHTML = emptyState('bx-history', 'Sem registos.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Quando</th><th>Quem</th><th>Registo</th><th>Acção</th><th>Detalhes</th></tr></thead><tbody>
      ${r.items.map(a => `<tr><td class="nowrap muted">${dateTime(a.at)}</td>
        <td>${esc(a.actor_name || ({ guest: 'Visitante', system: 'Sistema' }[a.actor_type] || a.actor_type))}</td>
        <td>${esc(ENTITY[a.entity_type] || a.entity_type)}${LINK[a.entity_type] && /^[0-9a-z-]+$/.test(a.entity_id) ? `<a class="link t-sub mono" href="${LINK[a.entity_type](a.entity_id)}">${esc(a.entity_id.slice(0, 40))}</a>` : `<span class="t-sub mono">${esc(a.entity_id.slice(0, 40))}</span>`}</td>
        <td class="t-strong">${esc(a.action)}</td>
        <td><details><summary class="link small">ver</summary><pre class="json">${esc(JSON.stringify(a.data, null, 2))}</pre></details></td></tr>`).join('')}
    </tbody></table></div>
    <div class="pager"><span class="muted">Página ${r.page}</span><div class="page-head__actions">
      <button type="button" class="btn btn--ghost btn--sm" id="ap" ${r.page <= 1 ? 'disabled' : ''}>Anterior</button>
      <button type="button" class="btn btn--ghost btn--sm" id="an" ${r.items.length < 50 ? 'disabled' : ''}>Seguinte</button></div></div>`;
    $('#ap', box).addEventListener('click', () => { state.page--; load(); });
    $('#an', box).addEventListener('click', () => { state.page++; load(); });
  }
  $('#at', main).addEventListener('change', e => { state.entity_type = e.target.value; state.page = 1; load(); });
  await load();
}
