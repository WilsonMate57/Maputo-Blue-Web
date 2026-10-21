// Image library: browse folders, upload (converted to WebP on the server),
// alt text / captions, delete unused uploads. Also exports the image picker
// used by the package editor.
import { $, $$, ApiError, api, busy, confirmAction, emptyState, esc, get, modal, patch, toast } from '../core.js';

const kb = n => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

async function upload(folder, files) {
  const fd = new FormData();
  fd.append('folder', folder);
  for (const f of files) {
    if (f.size > 12 * 1024 * 1024) throw new ApiError(400, 'file_too_large', `${f.name}: máximo 12 MB por imagem`);
    fd.append('file', f, f.name);
  }
  return api('POST', '/admin/media/upload', fd);
}

function folderOptions(folders, current) {
  return folders.map(f => `<option value="${esc(f)}"${f === current ? ' selected' : ''}>${esc(f)}</option>`).join('');
}

/** Edit alt text / caption of one image. Returns the saved media row or null. */
export async function editAlt(contentPath, current = {}) {
  const r = await modal({
    title: 'Texto alternativo da imagem',
    body: `<img src="/${esc(String(contentPath).replace(/^(\.\.\/|\/)+/, ''))}" alt="" style="max-height:180px;border-radius:8px;margin-bottom:12px;">
      <div class="grid grid--2">
        <label class="field"><span>Texto alternativo PT</span><input name="alt" maxlength="300" value="${esc(current.pt || current.alt || '')}" placeholder="Descreva a imagem"></label>
        <label class="field"><span>Texto alternativo EN</span><input name="alt_en" maxlength="300" value="${esc(current.en || current.alt_en || '')}"></label>
        <label class="field"><span>Legenda PT <small>(opcional)</small></span><input name="caption" maxlength="300" value="${esc(current.caption || '')}"></label>
        <label class="field"><span>Legenda EN</span><input name="caption_en" maxlength="300" value="${esc(current.caption_en || '')}"></label>
      </div><p class="muted small">O texto alternativo é lido por leitores de ecrã e motores de busca.</p>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
      run: v => patch('/admin/media', { path: contentPath, alt: v.alt || null, alt_en: v.alt_en || null, caption: v.caption || null, caption_en: v.caption_en || null }) }],
  });
  if (!r) return null;
  toast('Texto alternativo guardado.');
  return r.values;
}

/** Modal picker: choose existing images or upload new ones. Resolves to content paths. */
export async function pickImages(defaultTop = 'tours') {
  const folders = await get('/admin/media/folders');
  let folder = folders.find(f => f.startsWith(defaultTop + '/')) || folders[0];
  const picked = new Set();
  const r = await modal({
    title: 'Escolher imagens', wide: true,
    body: `<div class="filters" style="padding:0 0 12px;">
        <label class="field"><span>Pasta</span><select id="pk-folder">${folderOptions(folders, folder)}</select></label>
        <label class="btn btn--ghost" style="align-self:end;"><i class='bx bx-upload'></i>Carregar novas<input type="file" id="pk-up" accept="${ACCEPT}" multiple hidden></label>
      </div>
      <div id="pk-grid" class="media-grid" style="max-height:52vh;overflow:auto;"></div>
      <p class="muted small" id="pk-count" style="margin:10px 0 0;">0 seleccionada(s)</p>`,
    actions: [{ label: 'Cancelar', value: null }, { label: 'Adicionar à galeria', kind: 'primary', value: 'ok', submit: true }],
    onOpen: dlg => {
      const grid = $('#pk-grid', dlg);
      const count = () => { $('#pk-count', dlg).textContent = `${picked.size} seleccionada(s)`; };
      async function load() {
        grid.innerHTML = '<div class="skeleton"></div>';
        const items = await get(`/admin/media?folder=${encodeURIComponent(folder)}`);
        grid.innerHTML = items.length ? items.map(m => `<button type="button" class="media-item${picked.has(m.content_path) ? ' is-picked' : ''}" data-p="${esc(m.content_path)}" aria-pressed="${picked.has(m.content_path)}" style="padding:0;cursor:pointer;text-align:left;">
            <img src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy"><span class="media-item__body"><span class="media-item__name">${esc(m.path.split('/').pop())}</span></span></button>`).join('')
          : emptyState('bx-image', 'Pasta vazia.');
        $$('[data-p]', grid).forEach(b => b.addEventListener('click', () => {
          const p = b.dataset.p;
          picked.has(p) ? picked.delete(p) : picked.add(p);
          b.classList.toggle('is-picked', picked.has(p));
          b.setAttribute('aria-pressed', String(picked.has(p)));
          count();
        }));
      }
      $('#pk-folder', dlg).addEventListener('change', e => { folder = e.target.value; load(); });
      $('#pk-up', dlg).addEventListener('change', async e => {
        const files = [...e.target.files];
        if (!files.length) return;
        try {
          const saved = await busy(null, () => upload(folder, files), `${files.length} imagem(ns) carregada(s).`);
          saved.forEach(s => picked.add(s.content_path));
          count();
          await load();
        } catch { /* toast */ }
        e.target.value = '';
      });
      load();
    },
  });
  return r ? [...picked] : null;
}

export default async function media(main) {
  const folders = await get('/admin/media/folders');
  let folder = folders.find(f => f.startsWith('tours/')) || folders[0];
  main.innerHTML = `
    <div class="card" style="margin-bottom:18px;"><div class="filters">
      <label class="field" style="flex:2 1 260px;"><span>Pasta</span><select id="folder">${folderOptions(folders, folder)}</select></label>
      <label class="field field--search"><span>Filtrar</span><input type="search" id="mq" placeholder="Nome do ficheiro"></label>
    </div></div>
    <div class="card" style="margin-bottom:18px;"><div class="card__body">
      <div class="dropzone" id="drop"><i class='bx bx-cloud-upload' style="font-size:30px;"></i>
        <p style="margin:6px 0;">Arraste imagens para aqui ou <label class="link" style="cursor:pointer;">escolha ficheiros<input type="file" id="files" accept="${ACCEPT}" multiple hidden></label></p>
        <p class="muted small" style="margin:0;">JPG, PNG, WebP ou AVIF até 12 MB. São convertidas para WebP (máx. 2000 px) e guardadas na pasta seleccionada.</p></div>
    </div></div>
    <div class="card"><div class="card__body"><div id="grid" class="media-grid"></div></div></div>`;
  let items = [];

  async function load() {
    $('#grid', main).innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    items = await get(`/admin/media?folder=${encodeURIComponent(folder)}`);
    render();
  }

  function render() {
    const q = $('#mq', main).value.trim().toLowerCase();
    const list = items.filter(m => !q || m.path.toLowerCase().includes(q));
    const grid = $('#grid', main);
    if (!list.length) { grid.innerHTML = emptyState('bx-image', 'Nenhuma imagem nesta pasta.'); return; }
    grid.innerHTML = list.map(m => `
      <div class="media-item">
        <img src="${esc(m.url)}" alt="${esc(m.alt || '')}" loading="lazy">
        <div class="media-item__body">
          <span class="media-item__name">${esc(m.path.split('/').pop())}</span>
          <span class="muted">${kb(m.bytes)}${m.width ? ` · ${m.width}×${m.height}` : ''}</span>
          <span class="muted">${m.used_by.length ? `Usada em ${m.used_by.length} pacote(s)` : 'Não usada em pacotes'}</span>
          ${m.alt ? `<span>“${esc(m.alt)}”</span>` : '<span class="muted">Sem texto alternativo</span>'}
        </div>
        <div class="media-item__actions">
          <button type="button" class="icon-btn" data-copy="${esc(m.content_path)}" aria-label="Copiar caminho" title="Copiar caminho"><i class='bx bx-copy'></i></button>
          <button type="button" class="icon-btn" data-alt="${esc(m.content_path)}" aria-label="Texto alternativo" title="Texto alternativo"><i class='bx bx-text'></i></button>
          ${m.uploaded ? `<button type="button" class="icon-btn" data-del="${esc(m.path)}" aria-label="Apagar" title="Apagar" ${m.used_by.length ? 'disabled' : ''}><i class='bx bx-trash'></i></button>` : ''}
        </div>
      </div>`).join('');
    $$('[data-copy]', grid).forEach(b => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Caminho copiado.'); } catch { toast(b.dataset.copy); }
    }));
    $$('[data-alt]', grid).forEach(b => b.addEventListener('click', async () => {
      const m = items.find(x => x.content_path === b.dataset.alt);
      if (await editAlt(m.content_path, m)) load();
    }));
    $$('[data-del]', grid).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Apagar imagem', text: `Apagar definitivamente <strong>${esc(b.dataset.del.split('/').pop())}</strong>? Esta acção não pode ser anulada.`, confirm: 'Apagar', kind: 'danger-solid' }))) return;
      try { await busy(b, () => api('DELETE', `/admin/media?path=${encodeURIComponent(b.dataset.del)}`), 'Imagem apagada.'); load(); } catch { /* toast */ }
    }));
  }

  async function doUpload(files) {
    if (!files.length) return;
    try { await busy(null, () => upload(folder, files), `${files.length} imagem(ns) carregada(s).`); load(); } catch { /* toast */ }
  }

  $('#folder', main).addEventListener('change', e => { folder = e.target.value; load(); });
  $('#mq', main).addEventListener('input', render);
  $('#files', main).addEventListener('change', e => { doUpload([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop', main);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-over'); doUpload([...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))); });
  await load();
}
