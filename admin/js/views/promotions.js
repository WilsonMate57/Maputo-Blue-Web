// Promotions & discount codes.
import { $, $$, CATEGORY_LABELS, badge, busy, confirmAction, date, del, emptyState, esc, get, modal, money, post, put, toast } from '../core.js';

export default async function promotions(main) {
  const [packages, cats] = await Promise.all([get('/admin/packages'), get('/admin/categories')]);
  const allCats = [...cats.tour, ...cats.accommodation];

  main.innerHTML = `
    <div class="page-head"><p class="muted" style="margin:0;max-width:720px;">Promoções sem código aplicam-se automaticamente quando as condições são cumpridas. Com código, o cliente introduz-o na reserva. O desconto é sempre calculado no servidor.</p>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" id="new"><i class='bx bx-plus'></i>Nova promoção</button></div></div>
    <div class="card" id="list"></div>`;

  async function load() {
    const list = await get('/admin/promotions');
    const box = $('#list', main);
    if (!list.length) { box.innerHTML = emptyState('bx-purchase-tag-alt', 'Ainda não há promoções.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Promoção</th><th>Desconto</th><th>Aplica-se a</th><th>Validade</th><th>Condições</th><th>Utilizações</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map(p => `<tr>
        <td><span class="t-strong">${esc(p.name)}</span><span class="t-sub mono">${p.code ? esc(p.code) : 'automática'}</span></td>
        <td class="nowrap">${p.kind === 'percent' ? `${p.value}%` : money(p.value)}${p.max_discount ? `<span class="t-sub">máx. ${money(p.max_discount)}</span>` : ''}</td>
        <td>${p.package_ids ? `${p.package_ids.length} pacote(s)` : p.categories ? esc(p.categories.map(c => CATEGORY_LABELS[c] || c).join(', ')) : 'Todos'}</td>
        <td class="nowrap">${p.starts_at || p.ends_at ? `${p.starts_at ? date(p.starts_at) : '…'} → ${p.ends_at ? date(p.ends_at) : '…'}` : 'Sem limite'}
          ${p.travel_from || p.travel_to ? `<span class="t-sub">viagens ${p.travel_from ? date(p.travel_from) : '…'} → ${p.travel_to ? date(p.travel_to) : '…'}</span>` : ''}</td>
        <td class="small">${[p.min_pax ? `mín. ${p.min_pax} pessoas` : '', p.min_total ? `mín. ${money(p.min_total)}` : '', p.combinable ? 'acumulável' : ''].filter(Boolean).join(' · ') || '—'}</td>
        <td>${p.used_count}${p.usage_limit ? ` / ${p.usage_limit}` : ''}</td>
        <td>${p.active ? badge('published') : badge('closed')}</td>
        <td class="nowrap"><button type="button" class="icon-btn" data-edit="${p.id}" aria-label="Editar"><i class='bx bx-edit'></i></button>
          <button type="button" class="icon-btn" data-del="${p.id}" aria-label="Apagar ou desactivar"><i class='bx bx-trash'></i></button></td></tr>`).join('')}
    </tbody></table></div>`;
    $$('[data-edit]', box).forEach(b => b.addEventListener('click', () => edit(list.find(p => p.id === b.dataset.edit))));
    $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
      const p = list.find(x => x.id === b.dataset.del);
      if (!(await confirmAction({ title: 'Remover promoção', text: p.used_count ? 'Esta promoção já foi usada: será desactivada (as reservas mantêm o desconto).' : `Apagar a promoção “${esc(p.name)}”?`, confirm: p.used_count ? 'Desactivar' : 'Apagar', kind: 'danger-solid' }))) return;
      try { await busy(b, () => del(`/admin/promotions/${p.id}`), 'Promoção removida.'); load(); } catch { /* toast */ }
    }));
  }

  async function edit(p) {
    const isEdit = !!p;
    p = p || { name: '', code: '', kind: 'percent', value: 10, active: true, combinable: false };
    const sel = new Set(p.package_ids || []);
    const csel = new Set(p.categories || []);
    const r = await modal({
      title: isEdit ? 'Editar promoção' : 'Nova promoção', wide: true,
      body: `<div class="grid grid--3">
          <label class="field span-2"><span>Nome</span><input name="name" required maxlength="120" value="${esc(p.name)}" placeholder="Ex.: Época baixa 2026"></label>
          <label class="field"><span>Código <small>(vazio = automática)</small></span><input name="code" maxlength="40" pattern="[A-Za-z0-9_-]*" value="${esc(p.code || '')}" style="text-transform:uppercase;"></label>
          <label class="field"><span>Tipo</span><select name="kind"><option value="percent"${p.kind === 'percent' ? ' selected' : ''}>Percentagem</option><option value="fixed"${p.kind === 'fixed' ? ' selected' : ''}>Valor fixo</option></select></label>
          <label class="field"><span>Valor</span><input type="number" name="value" min="0" step="0.01" required value="${p.value ?? ''}"></label>
          <label class="field"><span>Desconto máximo</span><input type="number" name="max_discount" min="0" value="${p.max_discount ?? ''}"></label>
          <label class="field"><span>Válida de <small>(data do pedido)</small></span><input type="date" name="starts_at" value="${p.starts_at || ''}"></label>
          <label class="field"><span>Válida até</span><input type="date" name="ends_at" value="${p.ends_at || ''}"></label>
          <label class="field"><span>Limite de utilizações</span><input type="number" name="usage_limit" min="1" value="${p.usage_limit ?? ''}"></label>
          <label class="field"><span>Viagens a partir de</span><input type="date" name="travel_from" value="${p.travel_from || ''}"></label>
          <label class="field"><span>Viagens até</span><input type="date" name="travel_to" value="${p.travel_to || ''}"></label>
          <label class="field"><span>Mínimo de pessoas</span><input type="number" name="min_pax" min="1" value="${p.min_pax ?? ''}"></label>
          <label class="field"><span>Valor mínimo</span><input type="number" name="min_total" min="0" value="${p.min_total ?? ''}"></label>
          <label class="check"><input type="checkbox" name="combinable"${p.combinable ? ' checked' : ''}> Acumulável com outras promoções</label>
          <label class="check"><input type="checkbox" name="active"${p.active ? ' checked' : ''}> Activa</label>
        </div>
        <fieldset class="field" style="border:0;padding:0;margin:16px 0 0;"><span>Categorias <small>(nenhuma = todas)</small></span>
          <div class="chips">${allCats.map(k => `<label class="check"><input type="checkbox" name="categories" data-multi value="${k}"${csel.has(k) ? ' checked' : ''}>${esc(CATEGORY_LABELS[k] || k)}</label>`).join('')}</div></fieldset>
        <fieldset class="field" style="border:0;padding:0;margin:16px 0 0;"><span>Pacotes específicos <small>(nenhum = todos)</small></span>
          <div style="max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;display:grid;gap:4px;">
          ${packages.map(x => `<label class="check"><input type="checkbox" name="package_ids" data-multi value="${esc(x.id)}"${sel.has(x.id) ? ' checked' : ''}>${esc(x.title)}</label>`).join('')}</div></fieldset>`,
      actions: [{ label: 'Cancelar', value: null }, {
        label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
        validate: v => (!v.name.trim() ? 'Dê um nome à promoção.' : !(v.value > 0) ? 'Indique um valor maior que zero.' : v.kind === 'percent' && v.value > 100 ? 'A percentagem não pode passar de 100.' : null),
        run: v => {
          const body = { name: v.name.trim(), code: v.code.trim() ? v.code.trim().toUpperCase() : null, kind: v.kind, value: v.value,
            max_discount: v.max_discount, package_ids: v.package_ids.length ? v.package_ids : null, categories: v.categories.length ? v.categories : null,
            starts_at: v.starts_at || null, ends_at: v.ends_at || null, travel_from: v.travel_from || null, travel_to: v.travel_to || null,
            min_pax: v.min_pax, min_total: v.min_total, usage_limit: v.usage_limit, combinable: v.combinable, active: v.active };
          return isEdit ? put(`/admin/promotions/${p.id}`, body) : post('/admin/promotions', body);
        },
      }],
    });
    if (r) { toast('Promoção guardada.'); load(); }
  }

  $('#new', main).addEventListener('click', () => edit());
  await load();
}
