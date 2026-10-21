// Package & accommodation list.
import { $, CATEGORY_LABELS, badge, emptyState, esc, get, label, linkRows, money } from '../core.js';

export default async function packages(main) {
  const list = await get('/admin/packages');
  const state = { kind: '', status: '', q: '' };

  main.innerHTML = `
    <div class="page-head">
      <div class="chips" role="group" aria-label="Tipo">
        <button type="button" class="chip" data-kind="" aria-pressed="true">Todos (${list.length})</button>
        <button type="button" class="chip" data-kind="tour" aria-pressed="false">Tours (${list.filter(p => p.kind === 'tour').length})</button>
        <button type="button" class="chip" data-kind="accommodation" aria-pressed="false">Alojamentos (${list.filter(p => p.kind === 'accommodation').length})</button>
      </div>
      <div class="page-head__actions"><a class="btn btn--primary" href="#/packages/new"><i class='bx bx-plus'></i>Novo pacote</a></div>
    </div>
    <div class="card">
      <div class="filters">
        <label class="field field--search"><span>Pesquisar</span><input type="search" id="pq" placeholder="Nome ou identificador"></label>
        <label class="field"><span>Estado</span><select id="ps"><option value="">Todos</option><option value="published">Publicados</option><option value="draft">Rascunhos</option><option value="archived">Arquivados</option></select></label>
      </div>
      <div id="plist"></div>
    </div>`;

  function render() {
    const q = state.q.toLowerCase();
    const items = list.filter(p => (!state.kind || p.kind === state.kind) && (!state.status || p.status === state.status) &&
      (!q || p.title.toLowerCase().includes(q) || p.id.includes(q)));
    const box = $('#plist', main);
    if (!items.length) { box.innerHTML = emptyState('bx-package', 'Nenhum pacote encontrado.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Pacote</th><th>Tipo</th><th>Categoria</th><th class="right">Preço base</th><th>Capacidade</th><th>Próximas reservas</th><th>Estado</th></tr></thead>
      <tbody>${items.map(p => `
        <tr data-href="#/packages/${esc(p.id)}">
          <td style="width:64px;"><img src="${esc(toUrl(p.cover || p.first_image))}" alt="" loading="lazy" style="width:56px;height:42px;object-fit:cover;border-radius:6px;background:var(--bg);"></td>
          <td><span class="t-strong">${esc(p.title)}</span><span class="t-sub mono">${esc(p.id)}</span>
            ${p.featured ? '<span class="badge badge--quote_sent badge--plain">Destaque</span> ' : ''}${p.promotional ? '<span class="badge badge--pending badge--plain">Promoção</span>' : ''}</td>
          <td>${badge(p.kind)}</td>
          <td>${esc(CATEGORY_LABELS[p.category] || p.category)}</td>
          <td class="right mono nowrap">${money(p.base_price, p.currency)}<span class="t-sub">${esc(label(p.unit))}</span></td>
          <td>${p.default_capacity === null ? '<span class="muted">sem limite</span>' : esc(p.default_capacity)}</td>
          <td>${p.upcoming}</td>
          <td>${badge(p.status)}</td>
        </tr>`).join('')}</tbody></table></div>`;
    linkRows(box);
  }

  main.querySelectorAll('[data-kind]').forEach(c => c.addEventListener('click', () => {
    state.kind = c.dataset.kind;
    main.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    render();
  }));
  $('#pq', main).addEventListener('input', e => { state.q = e.target.value.trim(); render(); });
  $('#ps', main).addEventListener('change', e => { state.status = e.target.value; render(); });
  render();
}

/** Content stores '../assets/...' (relative to /pages/); the admin lives in /admin/. */
export function toUrl(p) {
  if (!p) return '../logo.webp';
  return '/' + String(p).replace(/^(\.\.\/|\.\/|\/)+/, '');
}
