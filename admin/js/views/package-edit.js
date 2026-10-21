// Package / accommodation editor: general, PT/EN content, images, pricing,
// price rules, availability model, SEO, revisions. Unknown legacy content
// fields are preserved untouched.
import { $, $$, CATEGORY_LABELS, busy, confirmAction, date, dateTime, del, esc, get, label, modal, money, post, put, today, addDays, toast } from '../core.js';
import { toUrl } from './packages.js';
import { pickImages, editAlt } from './media.js';

const WEEKDAYS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb'], [0, 'Dom']];
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const clone = o => JSON.parse(JSON.stringify(o));

function blank(kind) {
  return {
    id: '', kind, category: kind === 'tour' ? 'island-daytrips' : 'inhaca', status: 'draft', featured: false, promotional: false, sort_order: 999, version: 0,
    content: kind === 'tour'
      ? { title: '', title_en: '', location: '', duration: '', duration_en: '', group_size: '', group_size_en: '', languages: ['Português', 'English'], description: '', description_en: '', images: [], itinerary: [], included: [], included_en: [], excluded: [], excluded_en: [], highlights: [], highlights_en: [] }
      : { name: '', location: '', location_en: '', duration: '2 dias / 1 noite', duration_en: '2 days / 1 night', description: '', description_en: '', images: [], amenities: [], rooms: [], included: [], included_en: [], excluded: [], excluded_en: [], check_in: '', check_out: '' },
    pricing: { currency: 'MZN', unit: 'per_person', adult: 0, child: null, options: [], option_required: false, extras: [], transfers: [], limits: { adults_min: 1, adults_max: 20, children_max: 10, pax_max: null }, nights: kind === 'accommodation' ? 1 : 0 },
    availability: kind === 'tour' ? { unit: 'pax', per_option: false, default_capacity: null } : { unit: 'room', occupancy: 2, default_capacity: null },
    seo: {},
  };
}

export default async function packageEdit(main, [id], { setTitle }) {
  const isNew = id === 'new';
  const cats = await get('/admin/categories');
  let pkg, rules = [], revisions = [];
  if (isNew) {
    const r = await modal({
      title: 'Novo pacote',
      body: `<p>Que tipo de produto quer criar?</p>
        <div class="grid grid--2"><label class="check"><input type="radio" name="kind" value="tour" checked> Tour / experiência</label>
        <label class="check"><input type="radio" name="kind" value="accommodation"> Alojamento</label></div>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Continuar', kind: 'primary', value: 'ok', submit: true }],
    });
    if (!r) { location.hash = '#/packages'; return; }
    pkg = blank(r.values.kind);
  } else {
    const d = await get(`/admin/packages/${encodeURIComponent(id)}`);
    pkg = clone(d.package);
    rules = d.rules;
    revisions = d.revisions;
  }
  let dirty = false;
  let tab = 'general';
  const markDirty = () => { dirty = true; $('#save', main).classList.add('btn--primary'); $('#dirty', main).hidden = false; };
  window.onbeforeunload = () => (dirty ? 'Há alterações por guardar.' : undefined);
  const title = () => pkg.content.title || pkg.content.name || pkg.id || 'Novo pacote';
  setTitle(isNew ? 'Novo pacote' : title());

  main.innerHTML = `
    <div class="page-head">
      <div><a class="link small" href="#/packages"><i class='bx bx-arrow-back'></i> Pacotes</a>
        <h2 style="margin-top:4px;" id="ptitle"></h2></div>
      <div class="page-head__actions">
        <span class="badge badge--pending" id="dirty" hidden>Alterações por guardar</span>
        ${isNew ? '' : `<button type="button" class="btn btn--ghost" id="preview"><i class='bx bx-show'></i>Pré-visualizar</button>`}
        <button type="button" class="btn btn--secondary" id="save"><i class='bx bx-save'></i>${isNew ? 'Criar pacote' : 'Guardar'}</button>
      </div>
    </div>
    <div class="card">
      <div class="tabs" role="tablist">
        ${[['general', 'Geral'], ['content', 'Conteúdo PT / EN'], ['images', 'Imagens'], ['pricing', 'Preços'], ['availability', 'Disponibilidade'], ['seo', 'SEO'], ...(isNew ? [] : [['history', 'Revisões']])]
          .map(([k, l]) => `<button type="button" class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}
      </div>
      <div class="card__body" id="pane" role="tabpanel"></div>
    </div>`;
  const pane = $('#pane', main);
  const updateTitle = () => { $('#ptitle', main).innerHTML = `${esc(title())} <span class="badge badge--${pkg.status}">${label(pkg.status)}</span>`; };
  updateTitle();

  $$('.tab', main).forEach(t => t.addEventListener('click', () => {
    collect();
    tab = t.dataset.tab;
    $$('.tab', main).forEach(x => x.setAttribute('aria-selected', String(x === t)));
    renderTab();
  }));
  pane.addEventListener('input', markDirty);
  pane.addEventListener('change', markDirty);

  /* ── Field helpers ─────────────────────────────────────────── */
  const c = () => pkg.content;
  const text = (key, lbl, opts = {}) => `<label class="field${opts.full ? ' span-all' : ''}"><span>${lbl}</span>${opts.area
    ? `<textarea data-c="${key}" rows="${opts.rows || 4}" maxlength="8000">${esc(c()[key] || '')}</textarea>`
    : `<input data-c="${key}" value="${esc(c()[key] || '')}" maxlength="${opts.max || 300}">`}</label>`;
  const pair = (key, lbl, opts) => text(key, `${lbl} <small>PT</small>`, opts) + text(`${key}_en`, `${lbl} <small>EN</small>`, opts);
  const list = (key, lbl) => `<label class="field"><span>${lbl} <small>(um por linha)</small></span><textarea data-list="${key}" rows="5">${esc((c()[key] || []).join('\n'))}</textarea></label>`;
  const listPair = (key, lbl) => list(key, `${lbl} PT`) + list(`${key}_en`, `${lbl} EN`);

  /** Read the visible tab's inputs back into `pkg`. */
  function collect() {
    $$('[data-c]', pane).forEach(el => { const v = el.value.trim(); if (v || c()[el.dataset.c] !== undefined) c()[el.dataset.c] = v; });
    $$('[data-list]', pane).forEach(el => { const v = el.value.split('\n').map(s => s.trim()).filter(Boolean); if (v.length || c()[el.dataset.list] !== undefined) c()[el.dataset.list] = v; });
    $$('[data-g]', pane).forEach(el => { pkg[el.dataset.g] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value || 0) : el.value; });
    const mp = $('[data-mp]', pane);
    if (mp) {
      const name = $('[data-mp=name]', pane).value.trim(), address = $('[data-mp=address]', pane).value.trim();
      if (name || address || c().meeting_point) c().meeting_point = { ...(c().meeting_point || {}), name, address };
    }
    const itin = $('#itin', pane);
    if (itin) c().itinerary = $$('.repeat__row', itin).map(row => Object.fromEntries($$('[data-k]', row).map(i => [i.dataset.k, i.value.trim()]))).filter(s => s.title || s.description);
    const rooms = $('#rooms', pane);
    if (rooms) c().rooms = $$('.repeat__row', rooms).map(row => {
      const o = Object.fromEntries($$('[data-k]', row).map(i => [i.dataset.k, i.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value.trim()]));
      return o;
    }).filter(r => r.type);
    if (tab === 'pricing') collectPricing();
    if (tab === 'availability') collectAvailability();
    if (tab === 'seo') {
      pkg.seo = {};
      $$('[data-seo]', pane).forEach(el => { if (el.value.trim()) pkg.seo[el.dataset.seo] = el.value.trim(); });
    }
  }

  /* ── Tabs ──────────────────────────────────────────────────── */
  function renderTab() {
    ({ general, content, images, pricing, availability, seo, history })[tab]();
  }

  function general() {
    pane.innerHTML = `
      <div class="grid grid--3">
        <label class="field"><span>Identificador (URL)</span><input data-g="id" value="${esc(pkg.id)}" ${isNew ? 'required pattern="[a-z0-9][a-z0-9-]{1,80}"' : 'disabled'} placeholder="ex.: kayak-inhaca">
          <span class="field__hint">${isNew ? 'Letras minúsculas, números e hífens. Não pode ser alterado depois.' : `Usado no endereço: package.html?id=${esc(pkg.id)}`}</span></label>
        <label class="field"><span>Tipo</span><input value="${label(pkg.kind)}" disabled></label>
        <label class="field"><span>Categoria</span><select data-g="category">${cats[pkg.kind].map(k => `<option value="${k}"${k === pkg.category ? ' selected' : ''}>${esc(CATEGORY_LABELS[k] || k)}</option>`).join('')}</select></label>
        <label class="field"><span>Estado</span><select data-g="status">
          <option value="draft"${pkg.status === 'draft' ? ' selected' : ''}>Rascunho (não visível)</option>
          <option value="published"${pkg.status === 'published' ? ' selected' : ''}>Publicado</option>
          <option value="archived"${pkg.status === 'archived' ? ' selected' : ''}>Arquivado</option></select></label>
        <label class="field"><span>Ordem na listagem</span><input type="number" data-g="sort_order" value="${pkg.sort_order}" min="-10000" max="10000"></label>
        <div class="field"><span>Etiquetas</span>
          <label class="check"><input type="checkbox" data-g="featured"${pkg.featured ? ' checked' : ''}> Em destaque</label>
          <label class="check"><input type="checkbox" data-g="promotional"${pkg.promotional ? ' checked' : ''}> Promocional</label></div>
      </div>
      ${isNew ? '' : `<p class="muted small" style="margin-top:14px;">Versão ${pkg.version} · última alteração ${dateTime(pkg.updated_at)}</p>`}`;
  }

  function content() {
    const tour = pkg.kind === 'tour';
    const mp = c().meeting_point || {};
    pane.innerHTML = `
      <div class="grid grid--2">
        ${tour ? pair('title', 'Título') : text('name', 'Nome do alojamento') + text('name_en', 'Nome <small>EN (opcional)</small>')}
        ${tour ? text('location', 'Local') + text('location_en', 'Local <small>EN</small>') : pair('location', 'Local')}
        ${pair('duration', 'Duração')}
        ${pair('group_size', 'Grupo')}
        ${pair('badge', 'Etiqueta do cartão')}
        ${pair('child_age_note', 'Nota de idade das crianças')}
        ${pair('description', 'Descrição', { area: true, rows: 6 })}
        ${listPair('highlights', 'Destaques')}
        ${listPair('included', 'Incluído')}
        ${listPair('excluded', 'Não incluído')}
        ${listPair('important_info', 'Informações importantes')}
        ${list('languages', 'Línguas')}
        ${tour ? '' : list('amenities', 'Comodidades') + text('check_in', 'Check-in') + text('check_out', 'Check-out')}
        <label class="field"><span>Ponto de encontro — nome</span><input data-mp="name" value="${esc(mp.name || '')}"></label>
        <label class="field"><span>Ponto de encontro — morada</span><input data-mp="address" value="${esc(mp.address || '')}"></label>
      </div>
      <p class="muted small">As informações importantes vazias usam o texto padrão do site (cancelamentos, horários, segurança).</p>
      <h3 style="margin:22px 0 10px;font-size:15px;">${tour ? 'Itinerário' : 'Quartos / unidades'}</h3>
      ${tour ? itineraryEditor() : roomsEditor()}`;
    wireRepeat();
  }

  function itineraryEditor() {
    const steps = c().itinerary || [];
    const row = s => `<div class="repeat__row"><div class="repeat__fields">
        <label class="field"><span>Hora PT</span><input data-k="time" value="${esc(s.time || '')}"></label>
        <label class="field"><span>Hora EN</span><input data-k="time_en" value="${esc(s.time_en || '')}"></label>
        <label class="field"><span>Título PT</span><input data-k="title" value="${esc(s.title || '')}"></label>
        <label class="field"><span>Título EN</span><input data-k="title_en" value="${esc(s.title_en || '')}"></label>
        <label class="field" style="grid-column:1/-1"><span>Descrição PT</span><textarea data-k="description" rows="2">${esc(s.description || '')}</textarea></label>
        <label class="field" style="grid-column:1/-1"><span>Descrição EN</span><textarea data-k="description_en" rows="2">${esc(s.description_en || '')}</textarea></label>
      </div>${rowCtrl()}</div>`;
    return `<div class="repeat" id="itin" data-template="${esc(row({}))}">${steps.map(row).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="itin" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar passo</button>`;
  }

  function roomsEditor() {
    const rooms = c().rooms || [];
    const row = r => `<div class="repeat__row"><div class="repeat__fields">
        <label class="field"><span>Tipo</span><input data-k="type" value="${esc(r.type || '')}"></label>
        <label class="field"><span>Capacidade</span><input type="number" data-k="capacity" min="1" value="${r.capacity ?? ''}"></label>
        <label class="field"><span>Preço indicativo</span><input type="number" data-k="price" min="0" value="${r.price ?? ''}"></label>
        <label class="field" style="grid-column:1/-1"><span>Descrição PT</span><input data-k="description" value="${esc(r.description || '')}"></label>
        <label class="field" style="grid-column:1/-1"><span>Descrição EN</span><input data-k="description_en" value="${esc(r.description_en || '')}"></label>
      </div>${rowCtrl()}</div>`;
    return `<p class="muted small">Informação mostrada na página. O preço cobrado é definido no separador “Preços”.</p>
      <div class="repeat" id="rooms" data-template="${esc(row({}))}">${rooms.map(row).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="rooms" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar quarto</button>`;
  }

  const rowCtrl = () => `<div class="repeat__ctrl">
      <button type="button" class="icon-btn" data-up aria-label="Mover para cima"><i class='bx bx-up-arrow-alt'></i></button>
      <button type="button" class="icon-btn" data-down aria-label="Mover para baixo"><i class='bx bx-down-arrow-alt'></i></button>
      <button type="button" class="icon-btn" data-remove aria-label="Remover"><i class='bx bx-trash'></i></button></div>`;

  function wireRepeat() {
    $$('[data-add]', pane).forEach(b => b.addEventListener('click', () => {
      const box = $('#' + b.dataset.add, pane);
      box.insertAdjacentHTML('beforeend', box.dataset.template);
      markDirty();
      const last = box.lastElementChild.querySelector('input, select, textarea');
      if (last) last.focus();
    }));
  }
  // One delegated handler for every repeatable list (registered once)
  pane.addEventListener('click', e => {
    const row = e.target.closest('.repeat__row');
    if (!row) return;
    if (e.target.closest('[data-remove]')) { row.remove(); markDirty(); }
    else if (e.target.closest('[data-up]') && row.previousElementSibling) { row.parentNode.insertBefore(row, row.previousElementSibling); markDirty(); }
    else if (e.target.closest('[data-down]') && row.nextElementSibling) { row.parentNode.insertBefore(row.nextElementSibling, row); markDirty(); }
  });

  /* ── Images ────────────────────────────────────────────────── */
  function images() {
    const imgs = c().images || [];
    pane.innerHTML = `
      <div class="page-head" style="margin-bottom:12px;">
        <p class="muted" style="margin:0;">Arraste para reordenar. A primeira imagem aparece primeiro na galeria; a capa é usada nos cartões.</p>
        <button type="button" class="btn btn--secondary btn--sm" id="add-img"><i class='bx bx-image-add'></i>Adicionar imagens</button>
      </div>
      ${imgs.length ? `<div class="gallery-list" id="gal">${imgs.map((src, i) => `
        <div class="gallery-row${(c().cover || imgs[0]) === src ? ' is-cover' : ''}" draggable="true" data-src="${esc(src)}">
          <img src="${esc(toUrl(src))}" alt="" loading="lazy">
          <div style="min-width:0;"><div class="t-strong" style="word-break:break-all;font-size:12.5px;">${esc(src.split('/').pop())}</div>
            <div class="muted small">${esc((c().image_alts && c().image_alts[src] && c().image_alts[src].pt) || 'Sem texto alternativo')}</div>
            <label class="check small" style="margin-top:4px;"><input type="radio" name="cover" value="${esc(src)}"${(c().cover || imgs[0]) === src ? ' checked' : ''}> Capa</label></div>
          <div class="repeat__ctrl">
            <button type="button" class="icon-btn" data-alt="${i}" aria-label="Texto alternativo"><i class='bx bx-text'></i></button>
            <button type="button" class="icon-btn" data-mv="-1" aria-label="Mover para cima" ${i === 0 ? 'disabled' : ''}><i class='bx bx-up-arrow-alt'></i></button>
            <button type="button" class="icon-btn" data-mv="1" aria-label="Mover para baixo" ${i === imgs.length - 1 ? 'disabled' : ''}><i class='bx bx-down-arrow-alt'></i></button>
            <button type="button" class="icon-btn" data-rm aria-label="Remover da galeria"><i class='bx bx-trash'></i></button>
          </div>
        </div>`).join('')}</div>` : '<div class="empty"><i class="bx bx-images"></i><p>Este pacote ainda não tem imagens.</p></div>'}
      <p class="muted small" style="margin-top:10px;">Remover uma imagem da galeria não apaga o ficheiro: pode continuar a ser usada noutros pacotes.</p>`;
    const set = arr => { c().images = arr; if (c().cover && !arr.includes(c().cover)) c().cover = arr[0] || ''; markDirty(); images(); };
    $('#add-img', pane).addEventListener('click', async () => {
      const picked = await pickImages(pkg.kind === 'tour' ? 'tours' : 'accommodations');
      if (picked && picked.length) set([...imgs, ...picked.filter(p => !imgs.includes(p))]);
    });
    pane.querySelectorAll('.gallery-row').forEach((row, i) => {
      row.querySelector('[data-rm]').addEventListener('click', () => set(imgs.filter((_, j) => j !== i)));
      row.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
        const a = [...imgs]; const j = i + Number(b.dataset.mv); [a[i], a[j]] = [a[j], a[i]]; set(a);
      }));
      row.querySelector('[data-alt]').addEventListener('click', async () => {
        const r = await editAlt(row.dataset.src, c().image_alts && c().image_alts[row.dataset.src]);
        if (r) { c().image_alts = { ...(c().image_alts || {}), [row.dataset.src]: { pt: r.alt || '', en: r.alt_en || '' } }; images(); }
      });
      row.querySelector('[name=cover]').addEventListener('change', e => { c().cover = e.target.value; markDirty(); images(); });
      row.addEventListener('dragstart', e => { row.classList.add('is-dragging'); e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (Number.isNaN(from) || from === i) return;
        const a = [...imgs]; const [m] = a.splice(from, 1); a.splice(i, 0, m); set(a);
      });
    });
  }

  /* ── Pricing ───────────────────────────────────────────────── */
  function pricing() {
    const p = pkg.pricing;
    const childMode = p.child === 'on_request' ? 'on_request' : p.child === null || p.child === undefined ? 'adult' : 'price';
    const optRow = o => `<div class="repeat__row"><div class="repeat__fields">
        <label class="field"><span>Nome PT</span><input data-k="name" value="${esc(o.name || '')}" required></label>
        <label class="field"><span>Nome EN</span><input data-k="name_en" value="${esc(o.name_en || '')}"></label>
        <label class="field"><span>Preço</span><input type="number" data-k="price" min="0" step="1" value="${o.price ?? ''}" required></label>
        <label class="field"><span>Preço criança</span><input type="number" data-k="child_price" min="0" value="${o.child_price ?? ''}"></label>
        <label class="field"><span>Máx. pessoas</span><input type="number" data-k="max_pax" min="1" value="${o.max_pax ?? ''}"></label>
        <label class="field"><span>Capacidade (texto PT)</span><input data-k="capacity_text" value="${esc(o.capacity_text || '')}"></label>
        <label class="field"><span>Capacidade (texto EN)</span><input data-k="capacity_text_en" value="${esc(o.capacity_text_en || '')}"></label>
        <label class="check"><input type="checkbox" data-k="active"${o.active !== false ? ' checked' : ''}> Activo</label>
        <input type="hidden" data-k="key" value="${esc(o.key || '')}">
      </div>${rowCtrl()}</div>`;
    const exRow = (o, per) => `<div class="repeat__row"><div class="repeat__fields">
        <label class="field"><span>Nome PT</span><input data-k="name" value="${esc(o.name || '')}" required></label>
        <label class="field"><span>Nome EN</span><input data-k="name_en" value="${esc(o.name_en || '')}"></label>
        <label class="field"><span>Preço</span><input type="number" data-k="price" min="0" value="${o.price ?? ''}" required></label>
        <label class="field"><span>Cobrado</span><select data-k="per">${per.map(([v, l]) => `<option value="${v}"${o.per === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" data-k="active"${o.active !== false ? ' checked' : ''}> Activo</label>
        <input type="hidden" data-k="key" value="${esc(o.key || '')}">
      </div>${rowCtrl()}</div>`;
    const PER_EX = [['person', 'por pessoa'], ['booking', 'por reserva'], ['night', 'por noite']];
    const PER_TR = [['booking', 'por reserva'], ['person', 'por pessoa']];
    pane.innerHTML = `
      <div class="grid grid--4">
        <label class="field"><span>Modelo de preço</span><select data-p="unit">
          <option value="per_person"${p.unit === 'per_person' ? ' selected' : ''}>Por pessoa</option>
          <option value="per_group"${p.unit === 'per_group' ? ' selected' : ''}>Por grupo / barco (preço fixo)</option>
          <option value="per_night"${p.unit === 'per_night' ? ' selected' : ''}>Por noite (quarto/unidade)</option></select></label>
        <label class="field"><span>Moeda</span><select data-p="currency">${['MZN', 'USD', 'ZAR', 'EUR'].map(x => `<option${p.currency === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field"><span>Preço base adulto</span><input type="number" data-p="adult" min="0" value="${p.adult}"><span class="field__hint">Preço normal (antes de regras por data).</span></label>
        <label class="field"><span>Crianças</span><select data-p="child_mode">
          <option value="price"${childMode === 'price' ? ' selected' : ''}>Preço próprio</option>
          <option value="adult"${childMode === 'adult' ? ' selected' : ''}>Pagam como adulto</option>
          <option value="on_request"${childMode === 'on_request' ? ' selected' : ''}>Sob consulta</option></select></label>
        <label class="field" data-show="child"><span>Preço criança</span><input type="number" data-p="child" min="0" value="${typeof p.child === 'number' ? p.child : ''}"></label>
        <label class="field"><span>Mín. adultos</span><input type="number" data-l="adults_min" min="0" value="${p.limits.adults_min}"></label>
        <label class="field"><span>Máx. adultos</span><input type="number" data-l="adults_max" min="1" value="${p.limits.adults_max}"></label>
        <label class="field"><span>Máx. crianças</span><input type="number" data-l="children_max" min="0" value="${p.limits.children_max}"></label>
        <label class="field"><span>Máx. total de pessoas</span><input type="number" data-l="pax_max" min="1" value="${p.limits.pax_max ?? ''}"></label>
        ${pkg.kind === 'accommodation' ? `<label class="field"><span>Noites incluídas</span><input type="number" data-p="nights" min="1" value="${p.nights || 1}"></label>` : ''}
      </div>

      <h3 style="margin:22px 0 6px;font-size:15px;">Opções (barcos, viaturas, quartos)</h3>
      <p class="muted small" style="margin:0 0 8px;">Se existirem opções, o cliente escolhe uma e o preço da opção substitui o preço base.</p>
      <div class="repeat" id="opts" data-template="${esc(optRow({}))}">${p.options.map(optRow).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="opts" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar opção</button>

      <h3 style="margin:22px 0 6px;font-size:15px;">Extras opcionais</h3>
      <div class="repeat" id="extras" data-template="${esc(exRow({}, PER_EX))}">${p.extras.map(o => exRow(o, PER_EX)).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="extras" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar extra</button>

      <h3 style="margin:22px 0 6px;font-size:15px;">Transfers privados</h3>
      <div class="repeat" id="transfers" data-template="${esc(exRow({}, PER_TR))}">${p.transfers.map(o => exRow(o, PER_TR)).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="transfers" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar transfer</button>

      ${isNew ? '<p class="alert alert--info" style="margin-top:22px;">Crie o pacote primeiro para adicionar regras de preço por data/época.</p>' : `
      <div class="page-head" style="margin:26px 0 8px;"><h3 style="font-size:15px;">Regras de preço (dias da semana, épocas, datas)</h3>
        <button type="button" class="btn btn--ghost btn--sm" id="add-rule"><i class='bx bx-plus'></i>Nova regra</button></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Regra</th><th>Período</th><th>Dias</th><th>Opção</th><th class="right">Adulto</th><th class="right">Criança</th><th>Prioridade</th><th></th></tr></thead>
        <tbody>${rules.length ? rules.map(r => `<tr><td class="t-strong">${esc(r.label)}${r.active ? '' : ' <span class="badge badge--closed">inactiva</span>'}</td>
          <td class="nowrap">${r.date_from || r.date_to ? `${r.date_from ? date(r.date_from) : '…'} → ${r.date_to ? date(r.date_to) : '…'}` : 'sempre'}</td>
          <td>${r.weekdays ? r.weekdays.map(d => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]).join(', ') : 'todos'}</td>
          <td>${esc(r.option_key || 'todas')}</td>
          <td class="right mono">${r.adult === null ? '—' : money(r.adult, p.currency)}</td><td class="right mono">${r.child === null ? '—' : money(r.child, p.currency)}</td>
          <td>${r.priority}</td>
          <td class="nowrap"><button type="button" class="icon-btn" data-edit-rule="${r.id}" aria-label="Editar regra"><i class='bx bx-edit'></i></button>
            <button type="button" class="icon-btn" data-del-rule="${r.id}" aria-label="Apagar regra"><i class='bx bx-trash'></i></button></td></tr>`).join('')
          : '<tr><td colspan="8" class="muted">Sem regras: aplica-se sempre o preço base.</td></tr>'}</tbody></table></div>
      <p class="muted small">As regras são guardadas de imediato. Quando várias se aplicam à mesma data, ganha a de maior prioridade (e depois a mais específica).</p>`}

      ${isNew ? '' : `
      <div class="card" style="margin-top:22px;background:var(--bg);box-shadow:none;"><div class="card__body">
        <h3 style="font-size:15px;margin-bottom:10px;">Pré-visualizar o efeito no preço</h3>
        <div class="grid grid--4">
          <label class="field"><span>Data</span><input type="date" id="pv-date" value="${addDays(today(), 7)}"></label>
          <label class="field"><span>Adultos</span><input type="number" id="pv-ad" value="2" min="0"></label>
          <label class="field"><span>Crianças</span><input type="number" id="pv-ch" value="0" min="0"></label>
          <div class="field"><span>&nbsp;</span><button type="button" class="btn btn--ghost" id="pv-run"><i class='bx bx-calculator'></i>Calcular</button></div>
        </div>
        <div id="pv-out" style="margin-top:12px;"></div>
      </div></div>`}`;
    const syncChild = () => { $('[data-show=child]', pane).hidden = $('[data-p=child_mode]', pane).value !== 'price'; };
    $('[data-p=child_mode]', pane).addEventListener('change', syncChild);
    syncChild();
    wireRepeat();
    if (!isNew) {
      $('#add-rule', pane).addEventListener('click', () => editRule());
      $$('[data-edit-rule]', pane).forEach(b => b.addEventListener('click', () => editRule(rules.find(r => String(r.id) === b.dataset.editRule))));
      $$('[data-del-rule]', pane).forEach(b => b.addEventListener('click', async () => {
        const r = rules.find(x => String(x.id) === b.dataset.delRule);
        if (!(await confirmAction({ title: 'Apagar regra', text: `Apagar a regra “${esc(r.label)}”? As reservas já feitas mantêm o preço calculado.`, confirm: 'Apagar', kind: 'danger-solid' }))) return;
        try { await busy(b, () => del(`/admin/rules/${r.id}`), 'Regra apagada.'); await reloadRules(); } catch { /* toast */ }
      }));
      $('#pv-run', pane).addEventListener('click', async e => {
        collectPricing();
        const out = $('#pv-out', pane);
        try {
          const r = await busy(e.currentTarget, () => post(`/admin/packages/${encodeURIComponent(pkg.id)}/pricing-preview`, {
            pricing: pkg.pricing, date: $('#pv-date', pane).value, adults: Number($('#pv-ad', pane).value), children: Number($('#pv-ch', pane).value),
            option_key: pkg.pricing.options[0] ? pkg.pricing.options[0].key : null }));
          const cell = q => (q.error ? `<span class="alert">${esc((q.details || [q.error]).join(', '))}</span>` : `<strong class="mono" style="font-size:18px;">${money(q.total, q.currency)}</strong>${q.price_rule ? `<div class="muted small">regra: ${esc(q.price_rule.label)}</div>` : ''}`);
          out.innerHTML = `<div class="diff"><div><span class="muted small">Preço actual (guardado)</span><div>${cell(r.current)}</div></div>
            <div class="is-new"><span class="muted small">Com as alterações por guardar</span><div>${cell(r.proposed)}</div></div></div>`;
        } catch { /* toast */ }
      });
    }
  }

  function collectPricing() {
    if (!$('[data-p=unit]', pane)) return;
    const p = pkg.pricing;
    p.unit = $('[data-p=unit]', pane).value;
    p.currency = $('[data-p=currency]', pane).value;
    p.adult = Number($('[data-p=adult]', pane).value || 0);
    const mode = $('[data-p=child_mode]', pane).value;
    p.child = mode === 'on_request' ? 'on_request' : mode === 'adult' ? null : Number($('[data-p=child]', pane).value || 0);
    $$('[data-l]', pane).forEach(el => { p.limits[el.dataset.l] = el.value === '' ? null : Number(el.value); });
    const n = $('[data-p=nights]', pane); if (n) p.nights = Number(n.value || 1);
    const rows = id => $$(`#${id} .repeat__row`, pane).map(row => {
      const o = {};
      $$('[data-k]', row).forEach(i => {
        const k = i.dataset.k;
        if (i.type === 'checkbox') o[k] = i.checked;
        else if (i.type === 'number') { if (i.value !== '') o[k] = Number(i.value); }
        else if (i.value.trim()) o[k] = i.value.trim();
      });
      if (!o.key) o.key = slug(o.name) || `opt-${Math.random().toString(36).slice(2, 6)}`;
      return o;
    }).filter(o => o.name);
    const uniq = arr => { const seen = new Set(); return arr.map(o => { let k = o.key, i = 2; while (seen.has(k)) k = `${o.key}-${i++}`; seen.add(k); return { ...o, key: k }; }); };
    p.options = uniq(rows('opts'));
    p.extras = uniq(rows('extras'));
    p.transfers = uniq(rows('transfers'));
    p.option_required = p.options.length > 0;
  }

  async function reloadRules() {
    const d = await get(`/admin/packages/${encodeURIComponent(pkg.id)}`);
    rules = d.rules; revisions = d.revisions; pkg.version = d.package.version;
    if (tab === 'pricing') { collectPricing(); pricing(); }
  }

  async function editRule(r) {
    const isEdit = !!r;
    r = r || { label: '', date_from: null, date_to: null, weekdays: null, option_key: null, adult: null, child: null, priority: 10, active: true };
    const res = await modal({
      title: isEdit ? 'Editar regra de preço' : 'Nova regra de preço',
      body: `
        <div class="grid grid--2">
          <label class="field span-2"><span>Nome da regra</span><input name="label" required maxlength="120" value="${esc(r.label)}" placeholder="Ex.: Época alta, Natal, Segunda a Quinta"></label>
          <label class="field"><span>Desde <small>(opcional)</small></span><input type="date" name="date_from" value="${r.date_from || ''}"></label>
          <label class="field"><span>Até <small>(opcional)</small></span><input type="date" name="date_to" value="${r.date_to || ''}"></label>
          <fieldset class="field span-2" style="border:0;padding:0;margin:0;"><span>Dias da semana <small>(vazio = todos)</small></span>
            <div class="chips">${WEEKDAYS.map(([v, l]) => `<label class="check"><input type="checkbox" name="weekdays" data-multi value="${v}"${r.weekdays && r.weekdays.includes(v) ? ' checked' : ''}>${l}</label>`).join('')}</div></fieldset>
          ${pkg.pricing.options.length ? `<label class="field span-2"><span>Opção</span><select name="option_key"><option value="">Todas</option>${pkg.pricing.options.map(o => `<option value="${esc(o.key)}"${r.option_key === o.key ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span>Preço adulto / grupo</span><input type="number" name="adult" min="0" value="${r.adult ?? ''}"></label>
          <label class="field"><span>Preço criança</span><input type="number" name="child" min="0" value="${r.child ?? ''}"></label>
          <label class="field"><span>Prioridade</span><input type="number" name="priority" value="${r.priority}" min="-100" max="1000"></label>
          <label class="check" style="align-self:end;"><input type="checkbox" name="active"${r.active ? ' checked' : ''}> Activa</label>
        </div>`,
      actions: [{ label: 'Cancelar', value: null }, {
        label: 'Guardar regra', kind: 'primary', value: 'ok', submit: true,
        validate: v => (!v.label.trim() ? 'Dê um nome à regra.' : v.adult === null && v.child === null ? 'Indique pelo menos um preço.' : v.date_from && v.date_to && v.date_to < v.date_from ? 'A data final é anterior à inicial.' : null),
        run: v => {
          const body = { label: v.label.trim(), date_from: v.date_from || null, date_to: v.date_to || null, weekdays: (v.weekdays || []).map(Number),
            option_key: v.option_key || null, adult: v.adult, child: v.child, priority: v.priority ?? 0, active: v.active };
          return isEdit ? put(`/admin/rules/${r.id}`, body) : post(`/admin/packages/${encodeURIComponent(pkg.id)}/rules`, body);
        },
      }],
    });
    if (res) { toast('Regra guardada.'); await reloadRules(); }
  }

  /* ── Availability model ────────────────────────────────────── */
  function availability() {
    const a = pkg.availability;
    pane.innerHTML = `
      <div class="grid grid--3">
        <label class="field"><span>Cada reserva ocupa</span><select data-a="unit">
          <option value="pax"${a.unit === 'pax' ? ' selected' : ''}>Lugares (adultos + crianças)</option>
          <option value="unit"${a.unit === 'unit' ? ' selected' : ''}>1 unidade (barco/viatura privada)</option>
          <option value="room"${a.unit === 'room' ? ' selected' : ''}>Quartos (pessoas ÷ ocupação)</option></select></label>
        <label class="field"><span>Capacidade por dia <small>(por defeito)</small></span><input type="number" data-a="default_capacity" min="0" value="${a.default_capacity ?? ''}"><span class="field__hint">Vazio = sem limite online (confirma manualmente).</span></label>
        <label class="field"><span>Pessoas por quarto</span><input type="number" data-a="occupancy" min="1" value="${a.occupancy ?? 2}"></label>
        <label class="check"><input type="checkbox" data-a="per_option"${a.per_option ? ' checked' : ''}> Capacidade separada por opção (ex.: cada barco)</label>
        <label class="field"><span>Antecedência mínima (horas)</span><input type="number" data-a="min_lead_hours" min="0" value="${a.min_lead_hours ?? ''}" placeholder="definição geral"></label>
        <label class="field"><span>Reservas até (dias)</span><input type="number" data-a="max_advance_days" min="1" value="${a.max_advance_days ?? ''}" placeholder="definição geral"></label>
      </div>
      <fieldset class="field" style="border:0;padding:0;margin:18px 0 0;"><span>Dias de operação <small>(nenhum marcado = todos os dias)</small></span>
        <div class="chips">${WEEKDAYS.map(([v, l]) => `<label class="check"><input type="checkbox" data-wd value="${v}"${a.weekdays && a.weekdays.includes(v) ? ' checked' : ''}>${l}</label>`).join('')}</div></fieldset>
      <h3 style="margin:22px 0 6px;font-size:15px;">Épocas de operação</h3>
      <p class="muted small" style="margin:0 0 8px;">Ex.: observação de baleias de 06-01 a 11-30 (mês-dia). Sem épocas = todo o ano.</p>
      <div class="repeat" id="seasons" data-template="${esc(seasonRow({}))}">${(a.seasons || []).map(seasonRow).join('')}</div>
      <button type="button" class="btn btn--ghost btn--sm" data-add="seasons" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar época</button>
      <p class="muted small" style="margin-top:18px;">Bloqueios e capacidades de dias específicos gerem-se em <a class="link" href="#/calendar?id=${esc(pkg.id)}">Disponibilidade</a>.</p>`;
    wireRepeat();
  }
  const seasonRow = s => `<div class="repeat__row"><div class="repeat__fields">
      <label class="field"><span>De (MM-DD)</span><input data-k="from" pattern="\\d{2}-\\d{2}" placeholder="06-01" value="${esc(s.from || '')}"></label>
      <label class="field"><span>Até (MM-DD)</span><input data-k="to" pattern="\\d{2}-\\d{2}" placeholder="11-30" value="${esc(s.to || '')}"></label>
    </div>${rowCtrl()}</div>`;

  function collectAvailability() {
    if (!$('[data-a=unit]', pane)) return;
    const num = sel => { const v = $(`[data-a=${sel}]`, pane).value; return v === '' ? null : Number(v); };
    const wd = $$('[data-wd]:checked', pane).map(i => Number(i.value));
    const seasons = $$('#seasons .repeat__row', pane).map(r => ({ from: $('[data-k=from]', r).value.trim(), to: $('[data-k=to]', r).value.trim() })).filter(s => s.from && s.to);
    pkg.availability = {
      unit: $('[data-a=unit]', pane).value, per_option: $('[data-a=per_option]', pane).checked,
      default_capacity: num('default_capacity'), occupancy: num('occupancy') || 2,
      weekdays: wd.length ? wd : null, seasons: seasons.length ? seasons : null,
      min_lead_hours: num('min_lead_hours'), max_advance_days: num('max_advance_days'),
    };
  }

  /* ── SEO ───────────────────────────────────────────────────── */
  function seo() {
    const s = pkg.seo || {};
    pane.innerHTML = `
      <div class="grid grid--2">
        <label class="field"><span>Título SEO PT <small>(até 60 caracteres)</small></span><input data-seo="title" maxlength="120" value="${esc(s.title || '')}" placeholder="${esc(title())}"></label>
        <label class="field"><span>Título SEO EN</span><input data-seo="title_en" maxlength="120" value="${esc(s.title_en || '')}"></label>
        <label class="field"><span>Descrição PT <small>(até 160 caracteres)</small></span><textarea data-seo="description" rows="3" maxlength="300">${esc(s.description || '')}</textarea></label>
        <label class="field"><span>Descrição EN</span><textarea data-seo="description_en" rows="3" maxlength="300">${esc(s.description_en || '')}</textarea></label>
        <label class="field span-2"><span>Imagem para partilha (Open Graph)</span><select data-seo="og_image"><option value="">Usar a capa</option>
          ${(c().images || []).map(i => `<option value="${esc(i)}"${s.og_image === i ? ' selected' : ''}>${esc(i.split('/').pop())}</option>`).join('')}</select></label>
      </div>
      <p class="muted small">Se ficarem vazios, a página usa o título e a descrição do pacote.</p>`;
  }

  /* ── Revisions ─────────────────────────────────────────────── */
  function history() {
    pane.innerHTML = `<p class="muted">Cada gravação cria uma versão. Restaurar uma versão cria uma nova versão com esse conteúdo (incluindo preços e regras); as reservas existentes não são afectadas.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Versão</th><th>Quando</th><th>Quem</th><th>Alteração</th><th></th></tr></thead><tbody>
      ${revisions.map(r => `<tr><td class="t-strong">v${r.version}${r.version === pkg.version ? ' <span class="badge badge--confirmed badge--plain">actual</span>' : ''}</td><td>${dateTime(r.changed_at)}</td>
        <td>${esc(r.changed_by || 'Importação')}</td><td>${esc(r.via || '')}</td>
        <td>${r.version !== pkg.version ? `<button type="button" class="btn btn--ghost btn--sm" data-restore="${r.version}">Restaurar</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-restore]', pane).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: `Restaurar versão ${b.dataset.restore}`, text: 'O conteúdo, os preços e as regras voltam a essa versão. Alterações por guardar serão perdidas.', confirm: 'Restaurar' }))) return;
      try { await busy(b, () => post(`/admin/packages/${encodeURIComponent(pkg.id)}/restore/${b.dataset.restore}`), 'Versão restaurada.'); dirty = false; window.onbeforeunload = null; packageEdit(main, [pkg.id], { setTitle }); } catch { /* toast */ }
    }));
  }

  /* ── Save / preview ────────────────────────────────────────── */
  async function save() {
    collect();
    const body = { category: pkg.category, status: pkg.status, featured: pkg.featured, promotional: pkg.promotional, sort_order: pkg.sort_order,
      content: pkg.content, pricing: pkg.pricing, availability: pkg.availability, seo: pkg.seo || {} };
    if (isNew) {
      if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(pkg.id || '')) { toast('Indique um identificador válido no separador “Geral”.', 'error'); return false; }
      const saved = await busy($('#save', main), () => post('/admin/packages', { ...body, id: pkg.id, kind: pkg.kind }), 'Pacote criado.');
      dirty = false; window.onbeforeunload = null;
      location.hash = `#/packages/${saved.id}`;
      return true;
    }
    const saved = await busy($('#save', main), () => put(`/admin/packages/${encodeURIComponent(pkg.id)}`, { ...body, version: pkg.version }), 'Alterações guardadas.');
    pkg = clone(saved);
    dirty = false;
    $('#save', main).classList.remove('btn--primary');
    $('#dirty', main).hidden = true;
    updateTitle();
    const d = await get(`/admin/packages/${encodeURIComponent(pkg.id)}`);
    revisions = d.revisions;
    renderTab();
    return true;
  }
  $('#save', main).addEventListener('click', () => save().catch(() => {}));
  const prev = $('#preview', main);
  if (prev) prev.addEventListener('click', async () => {
    if (dirty) {
      const ok = await confirmAction({ title: 'Guardar antes de pré-visualizar?', text: 'A pré-visualização mostra a versão guardada. Guardar agora?', confirm: 'Guardar e pré-visualizar' });
      if (!ok) return;
      try { await save(); } catch { return; }
    }
    window.open(`/pages/package.html?id=${encodeURIComponent(pkg.id)}${pkg.kind === 'accommodation' ? '&type=accommodation' : ''}&preview=1`, '_blank', 'noopener');
  });
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });

  renderTab();
}
