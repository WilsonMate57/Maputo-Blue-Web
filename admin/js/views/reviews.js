// Review moderation (publish / hide). Reviews are never edited by the team.
import { $, $$, badge, busy, date, emptyState, esc, get, pager, patch, qs } from '../core.js';

const stars = n => '<span style="color:#F59E0B;letter-spacing:1px;" aria-label="' + n + ' estrelas">' + '★'.repeat(n) + '<span style="color:#CBD5E1">' + '★'.repeat(5 - n) + '</span></span>';

export default async function reviews(main) {
  const state = { status: '', page: 1 };
  main.innerHTML = `
    <div class="page-head"><div class="chips" role="group" aria-label="Estado">
      <button type="button" class="chip" data-s="" aria-pressed="true">Todas</button>
      <button type="button" class="chip" data-s="published" aria-pressed="false">Publicadas</button>
      <button type="button" class="chip" data-s="hidden" aria-pressed="false">Ocultas</button></div></div>
    <div class="card" id="rv"></div>`;

  async function load() {
    const box = $('#rv', main);
    const r = await get('/admin/reviews' + qs({ status: state.status, page: state.page }));
    if (!r.items.length) { box.innerHTML = emptyState('bx-star', 'Sem avaliações.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Avaliação</th><th>Pacote</th><th>Autor</th><th>Data</th><th>Estado</th><th></th></tr></thead><tbody>
      ${r.items.map(x => `<tr><td style="max-width:460px;">${stars(x.rating)}<div style="white-space:pre-wrap;margin-top:4px;">${esc(x.comment)}</div></td>
        <td>${esc(x.package_title || x.package_id)}</td>
        <td>${esc(x.name)}${x.verified ? '<span class="t-sub"><i class="bx bx-badge-check"></i> reserva verificada</span>' : ''}${x.source === 'firestore' ? '<span class="t-sub">importada</span>' : ''}</td>
        <td class="nowrap muted">${date(x.created_at)}</td><td>${badge(x.status)}</td>
        <td><button type="button" class="btn btn--ghost btn--sm" data-id="${x.id}" data-to="${x.status === 'published' ? 'hidden' : 'published'}">${x.status === 'published' ? 'Ocultar' : 'Publicar'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
    box.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    $$('[data-to]', box).forEach(b => b.addEventListener('click', async () => {
      try { await busy(b, () => patch(`/admin/reviews/${b.dataset.id}`, { status: b.dataset.to }), b.dataset.to === 'hidden' ? 'Avaliação ocultada.' : 'Avaliação publicada.'); load(); } catch { /* toast */ }
    }));
  }
  main.querySelectorAll('[data-s]').forEach(c => c.addEventListener('click', () => {
    state.status = c.dataset.s; state.page = 1;
    main.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    load();
  }));
  await load();
}
