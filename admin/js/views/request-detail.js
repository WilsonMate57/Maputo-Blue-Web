// Custom request detail: status workflow, notes, quotations (draft / send / withdraw).
import { $, $$, CATEGORY_LABELS, addDays, badge, busy, confirmAction, date, dateTime, esc, get, label, modal, money, post, toast, today } from '../core.js';

const ACTIONS = { created: 'Pedido recebido', status_changed: 'Estado alterado', quote_sent: 'Cotação enviada', quote_drafted: 'Rascunho de cotação', quote_withdrawn: 'Cotação retirada', quote_accepted: 'Cliente aceitou a cotação', quote_declined: 'Cliente recusou a cotação' };

export default async function requestDetail(main, [id], { setTitle, refreshBadges }) {
  async function load() {
    const d = await get(`/admin/requests/${id}`);
    const r = d.request;
    setTitle(`Pedido ${r.reference}`);
    const wa = `https://wa.me/${String(r.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${r.name}, aqui é a Maputo Blue sobre o seu pedido ${r.reference}.`)}`;
    main.innerHTML = `
      <div class="page-head">
        <div><a class="link small" href="#/requests"><i class='bx bx-arrow-back'></i> Pedidos</a>
          <h2 class="mono" style="margin-top:4px;">${esc(r.reference)} ${badge(r.status)}</h2>
          <p class="muted small" style="margin:4px 0 0;">Recebido em ${dateTime(r.created_at)}</p></div>
        <div class="status-actions">
          ${d.next_statuses.filter(s => s !== 'quote_sent' && s !== 'accepted').map(s => `<button type="button" class="btn ${s === 'rejected' ? 'btn--danger' : 'btn--ghost'}" data-to="${s}">${s === 'under_review' ? 'Marcar em análise' : s === 'rejected' ? 'Rejeitar' : s === 'closed' ? 'Fechar' : label(s)}</button>`).join('')}
          ${['accepted', 'closed'].includes(r.status) ? '' : `<button type="button" class="btn btn--primary" id="new-quote"><i class='bx bx-file'></i>Preparar cotação</button>`}
        </div>
      </div>
      <p class="alert alert--info" style="margin:0 0 16px;">Um pedido personalizado não é uma reserva. Quando o cliente aceitar a cotação, crie as reservas necessárias ou combine os detalhes directamente.</p>
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Pedido</h2></div><div class="card__body"><dl class="dl">
            <div><dt>Destino</dt><dd>${esc(r.destination || '—')}</dd></div>
            <div><dt>Interesses</dt><dd>${r.categories.length ? esc(r.categories.map(c => CATEGORY_LABELS[c] || (c === 'accommodation' ? 'Alojamento' : c)).join(', ')) : '—'}</dd></div>
            <div><dt>Datas</dt><dd>${r.date_from ? `${date(r.date_from)}${r.date_to ? ` → ${date(r.date_to)}` : ''}` : '—'}${r.flexible_dates ? ' (flexíveis)' : ''}</dd></div>
            <div><dt>Grupo</dt><dd>${r.adults} adulto(s), ${r.children} criança(s)</dd></div>
            <div><dt>Alojamento</dt><dd style="font-weight:400;">${esc(r.accommodation || '—')}</dd></div>
            <div><dt>Transporte</dt><dd style="font-weight:400;">${esc(r.transport || '—')}</dd></div>
            <div><dt>Orçamento</dt><dd>${r.budget ? money(r.budget, r.budget_currency) : '—'}</dd></div>
            <div><dt>Idioma</dt><dd>${r.locale === 'en' ? 'Inglês' : 'Português'}</dd></div>
            <div style="grid-column:1/-1;"><dt>Actividades</dt><dd style="font-weight:400;white-space:pre-wrap;">${esc(r.activities || '—')}</dd></div>
            <div style="grid-column:1/-1;"><dt>Pedidos especiais</dt><dd style="font-weight:400;white-space:pre-wrap;">${esc(r.special_requests || '—')}</dd></div>
          </dl></div></div>

          <div class="card"><div class="card__head"><h2>Cotações</h2></div><div class="card__body">
            ${d.quotes.length ? d.quotes.map(q => `<div class="card" style="box-shadow:none;margin-bottom:10px;"><div class="card__body">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><strong class="mono" style="font-size:16px;">${money(q.total, q.currency)}</strong>
                <span>${badge(q.status)} <span class="muted small">válida até ${date(q.valid_until)}</span></span></div>
              <ul class="lines" style="margin-top:8px;">${q.items.map(i => `<li><span>${esc(i.description)} × ${i.quantity}</span><span class="mono">${money(i.quantity * i.unit_price, q.currency)}</span></li>`).join('')}</ul>
              ${q.inclusions ? `<p class="small"><strong>Incluído:</strong> ${esc(q.inclusions)}</p>` : ''}${q.exclusions ? `<p class="small"><strong>Não incluído:</strong> ${esc(q.exclusions)}</p>` : ''}
              <p class="muted small" style="margin:6px 0 0;">Criada por ${esc(q.created_by_name || '—')} em ${dateTime(q.created_at)}${q.sent_at ? ` · enviada ${dateTime(q.sent_at)}` : ''}${q.responded_at ? ` · resposta ${dateTime(q.responded_at)}` : ''}</p>
              <div class="form-actions form-actions--start" style="margin-top:10px;">
                ${q.status === 'draft' ? `<button type="button" class="btn btn--primary btn--sm" data-send="${q.id}"><i class='bx bx-send'></i>Enviar ao cliente</button>` : ''}
                ${['draft', 'sent'].includes(q.status) ? `<button type="button" class="btn btn--danger btn--sm" data-withdraw="${q.id}">Retirar</button>` : ''}
              </div></div></div>`).join('') : '<p class="muted" style="margin:0;">Ainda não há cotações.</p>'}
          </div></div>

          <div class="card"><div class="card__head"><h2>Histórico</h2></div><div class="card__body"><ul class="timeline">
            ${d.history.map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}</strong>${h.data && h.data.to ? ` → ${badge(h.data.to)}` : ''}
              <time>${dateTime(h.at)} · ${esc(h.actor_name || (h.actor_type === 'guest' ? 'Cliente' : h.actor_type))}</time></li>`).join('')}</ul></div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Contacto</h2></div><div class="card__body">
            <p class="t-strong" style="margin:0;font-size:16px;">${esc(r.name)}</p>
            <ul class="list-plain"><li><a class="link" href="mailto:${esc(r.email)}"><i class='bx bx-envelope'></i> ${esc(r.email)}</a></li>
              <li><a class="link" href="tel:${esc(r.phone)}"><i class='bx bx-phone'></i> ${esc(r.phone)}</a>
                <a class="btn btn--ghost btn--sm" href="${wa}" target="_blank" rel="noopener"><i class='bx bxl-whatsapp'></i>WhatsApp</a></li>
              ${r.user_id ? `<li><a class="link" href="#/customers/${r.user_id}">Ver conta do cliente</a></li>` : ''}</ul></div></div>
          <div class="card"><div class="card__head"><h2>Notas internas</h2></div><div class="card__body">
            <form id="note-form"><label class="field"><textarea name="body" rows="3" maxlength="4000" required placeholder="Visível apenas para a equipa"></textarea></label>
              <div class="form-actions"><button class="btn btn--secondary btn--sm" type="submit">Adicionar nota</button></div></form>
            ${d.notes.map(n => `<div class="note"><div style="white-space:pre-wrap;">${esc(n.body)}</div><div class="note__meta">${esc(n.author || '')} · ${dateTime(n.created_at)}</div></div>`).join('')}
          </div></div>
        </div>
      </div>`;

    $$('[data-to]', main).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Alterar estado', text: `Mudar o pedido para “${label(b.dataset.to)}”?`, confirm: 'Alterar' }))) return;
      try { await busy(b, () => post(`/admin/requests/${r.id}/status`, { to: b.dataset.to }), 'Estado alterado.'); refreshBadges(); load(); } catch { /* toast */ }
    }));
    $$('[data-send]', main).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Enviar cotação', text: `Enviar esta cotação por e-mail para ${esc(r.email)}? Cotações enviadas anteriormente deixam de ser válidas.`, confirm: 'Enviar' }))) return;
      try { await busy(b, () => post(`/admin/quotes/${b.dataset.send}/send`), 'Cotação enviada.'); load(); } catch { /* toast */ }
    }));
    $$('[data-withdraw]', main).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Retirar cotação', text: 'O cliente deixa de a poder aceitar.', confirm: 'Retirar', kind: 'danger-solid' }))) return;
      try { await busy(b, () => post(`/admin/quotes/${b.dataset.withdraw}/withdraw`), 'Cotação retirada.'); load(); } catch { /* toast */ }
    }));
    const nq = $('#new-quote', main);
    if (nq) nq.addEventListener('click', () => quoteForm(r));
    $('#note-form', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.body.value.trim()) return;
      try { await busy(f.querySelector('button'), () => post(`/admin/requests/${r.id}/notes`, { body: f.body.value.trim() }), 'Nota adicionada.'); load(); } catch { /* toast */ }
    });
  }

  async function quoteForm(r) {
    const row = (i = {}) => `<div class="repeat__row"><div class="repeat__fields" style="grid-template-columns:3fr 1fr 1fr;">
        <label class="field"><span>Descrição</span><input data-k="description" maxlength="300" value="${esc(i.description || '')}"></label>
        <label class="field"><span>Qtd.</span><input type="number" data-k="quantity" min="0.5" step="0.5" value="${i.quantity ?? 1}"></label>
        <label class="field"><span>Preço unit.</span><input type="number" data-k="unit_price" min="0" value="${i.unit_price ?? ''}"></label>
      </div><div class="repeat__ctrl"><button type="button" class="icon-btn" data-rm aria-label="Remover linha"><i class='bx bx-trash'></i></button></div></div>`;
    const res = await modal({
      title: `Cotação para ${r.reference}`, wide: true,
      body: `<div id="q-items" class="repeat">${row()}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="q-add" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar linha</button>
        <div class="grid grid--3" style="margin-top:14px;">
          <label class="field"><span>Moeda</span><select name="currency">${['MZN', 'USD', 'ZAR', 'EUR'].map(c => `<option${(r.budget_currency || 'MZN') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Válida até</span><input type="date" name="valid_until" required min="${today()}" value="${addDays(today(), 14)}"></label>
          <div class="field"><span>Total</span><strong id="q-total" class="mono" style="font-size:18px;padding-top:6px;">—</strong></div>
          <label class="field span-all"><span>Incluído</span><textarea name="inclusions" rows="2" maxlength="3000"></textarea></label>
          <label class="field span-all"><span>Não incluído</span><textarea name="exclusions" rows="2" maxlength="3000"></textarea></label>
          <label class="field span-all"><span>Mensagem ao cliente</span><textarea name="message" rows="3" maxlength="3000"></textarea></label>
        </div>`,
      actions: [{ label: 'Cancelar', value: null },
        { label: 'Guardar rascunho', kind: 'ghost', value: 'draft', validate: (v, f) => validate(f), run: (v, f) => submit(v, f, false) },
        { label: 'Enviar ao cliente', kind: 'primary', value: 'send', submit: true, validate: (v, f) => validate(f), run: (v, f) => submit(v, f, true) }],
      onOpen: dlg => {
        const box = $('#q-items', dlg);
        const total = () => {
          const t = items(dlg).reduce((s, i) => s + i.quantity * i.unit_price, 0);
          $('#q-total', dlg).textContent = money(t, $('[name=currency]', dlg).value);
        };
        $('#q-add', dlg).addEventListener('click', () => { box.insertAdjacentHTML('beforeend', row()); });
        box.addEventListener('click', e => { if (e.target.closest('[data-rm]') && box.children.length > 1) { e.target.closest('.repeat__row').remove(); total(); } });
        dlg.addEventListener('input', total);
        dlg.addEventListener('change', total);
      },
    });
    if (res) { toast(res.action === 'send' ? 'Cotação enviada ao cliente.' : 'Rascunho guardado.'); load(); }

    function items(root) {
      return $$('#q-items .repeat__row', root).map(row => ({
        description: $('[data-k=description]', row).value.trim(), quantity: Number($('[data-k=quantity]', row).value || 0), unit_price: Number($('[data-k=unit_price]', row).value || 0),
      })).filter(i => i.description);
    }
    function validate(f) { return items(f).length ? (f.valid_until.value < today() ? 'A validade não pode ser no passado.' : null) : 'Adicione pelo menos uma linha com descrição.'; }
    function submit(v, f, send) {
      return post(`/admin/requests/${r.id}/quotes`, { items: items(f), currency: v.currency, valid_until: v.valid_until,
        inclusions: v.inclusions || undefined, exclusions: v.exclusions || undefined, message: v.message || undefined, send });
    }
  }

  await load();
}
