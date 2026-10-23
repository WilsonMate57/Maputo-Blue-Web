// Quote request detail: chosen packages/services, status workflow, notes,
// quotations generated from the chosen items and delivered through the
// channels the team picks (e-mail, WhatsApp, shareable link). Customers with
// an account also see the quotation there.
import { $, $$, CATEGORY_LABELS, addDays, badge, busy, confirmAction, date, dateTime, esc, get, label, modal, money, post, toast, today } from '../core.js';

const ACTIONS = {
  created: 'Pedido recebido', status_changed: 'Estado alterado', quote_sent: 'Cotação enviada', quote_drafted: 'Rascunho de cotação',
  quote_withdrawn: 'Cotação retirada', quote_accepted: 'Cliente aceitou a cotação', quote_declined: 'Cliente recusou a cotação',
};
const CH = { email: ['E-mail', 'bx-envelope'], whatsapp: ['WhatsApp', 'bxl-whatsapp'], link: ['Link partilhado', 'bx-link'] };
const WARN = {
  service_manual_price: 'serviço sem preço de catálogo — indique o valor',
  child_price_on_request: 'preço de criança sob consulta',
  option_required: 'escolha a opção (barco/quarto) e o preço',
  manual_price: 'preço a confirmar',
};

/** Channel checkboxes (e-mail ticked by default). */
const channelFields = (r, account) => `
  <fieldset class="field" style="border:0;padding:0;margin:14px 0 0;"><span>Enviar por</span>
    <div class="grid grid--3" style="margin-top:6px;">
      <label class="check check--card"><input type="checkbox" name="ch_email" checked><span><strong><i class='bx bx-envelope'></i> E-mail</strong><span class="t-sub">${esc(r.email)}</span></span></label>
      <label class="check check--card"><input type="checkbox" name="ch_whatsapp"><span><strong><i class='bx bxl-whatsapp'></i> WhatsApp</strong><span class="t-sub">${esc(r.phone)} — abre o WhatsApp com a mensagem pronta</span></span></label>
      <label class="check check--card"><input type="checkbox" name="ch_link"><span><strong><i class='bx bx-link'></i> Link</strong><span class="t-sub">Para partilhar noutro canal (SMS, Messenger…)</span></span></label>
    </div>
    <p class="muted small" style="margin:8px 0 0;"><i class='bx bx-user-check'></i> ${account && account.linked ? 'O cliente vê também esta cotação na sua conta e pode aceitá-la lá.' : 'O cliente não tem conta associada: a cotação chega apenas pelos canais escolhidos.'}</p>
  </fieldset>`;
const channelsOf = v => ['email', 'whatsapp', 'link'].filter(c => v[`ch_${c}`]);

/** After sending: show the link, open WhatsApp if chosen. */
async function deliveryResult(d) {
  if (d.whatsapp_url) window.open(d.whatsapp_url, '_blank', 'noopener');
  await modal({
    title: 'Cotação enviada',
    body: `<p style="margin:0 0 12px;">Enviada por: ${d.channels.map(c => `<span class="badge badge--plain">${CH[c][0]}</span>`).join(' ')}</p>
      ${d.whatsapp_url ? `<p class="alert alert--info" style="margin:0 0 12px;"><i class='bx bxl-whatsapp'></i>O WhatsApp abriu numa nova janela com a mensagem e o link prontos a enviar. <a class="link" href="${esc(d.whatsapp_url)}" target="_blank" rel="noopener">Abrir de novo</a></p>` : ''}
      <label class="field"><span>Link da cotação</span>
        <div style="display:flex;gap:8px;"><input class="input" id="q-link" readonly value="${esc(d.quote_url)}">
          <button type="button" class="btn btn--ghost" id="q-copy"><i class='bx bx-copy'></i>Copiar</button></div>
        <span class="field__hint">Quem tiver o link pode ver e aceitar a cotação. Partilhar de novo gera um link novo e desactiva este.</span></label>`,
    actions: [{ label: 'Fechar', kind: 'primary', value: 'ok', submit: true }],
    onOpen: dlg => $('#q-copy', dlg).addEventListener('click', async e => {
      const inp = $('#q-link', dlg);
      try { await navigator.clipboard.writeText(inp.value); } catch { inp.select(); document.execCommand('copy'); }
      e.currentTarget.innerHTML = `<i class='bx bx-check'></i>Copiado`;
    }),
  });
}

export default async function requestDetail(main, [id], { setTitle, refreshBadges }) {
  let d;
  async function load() {
    d = await get(`/admin/requests/${id}`);
    const r = d.request;
    setTitle(`Pedido ${r.reference}`);
    const items = r.items || [];
    const wa = `https://wa.me/${String(r.phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${r.name}, aqui é a Maputo Blue sobre o seu pedido ${r.reference}.`)}`;
    const open = !['accepted', 'closed'].includes(r.status);
    main.innerHTML = `
      <a class="back" href="#/requests"><i class='bx bx-arrow-back'></i>Pedidos de cotação</a>
      <section class="card detail-hero">
        <div>
          <span class="eyebrow">Pedido de cotação</span>
          <h2 class="detail-hero__title"><span class="mono">${esc(r.reference)}</span> ${badge(r.status)}</h2>
          <div class="detail-hero__meta">
            <span><i class='bx bx-user'></i>${esc(r.name)}</span>
            <span><i class='bx bx-calendar'></i>${r.date_from ? `${date(r.date_from)}${r.date_to ? ` → ${date(r.date_to)}` : ''}${r.flexible_dates ? ' (flexíveis)' : ''}` : 'Datas por definir'}</span>
            <span><i class='bx bx-group'></i>${r.adults} adulto(s)${r.children ? `, ${r.children} criança(s)` : ''}</span>
            <span><i class='bx bx-time'></i>Recebido ${dateTime(r.created_at)}</span>
          </div>
        </div>
        <div class="status-actions">
          ${open ? `<button type="button" class="btn btn--primary" id="new-quote"><i class='bx bx-calculator'></i>Gerar cotação</button>` : ''}
          ${d.next_statuses.filter(s => s !== 'quote_sent' && s !== 'accepted').map(s => `<button type="button" class="btn ${s === 'rejected' ? 'btn--danger' : 'btn--ghost'}" data-to="${s}">${s === 'under_review' ? 'Marcar em análise' : s === 'rejected' ? 'Rejeitar' : s === 'closed' ? 'Fechar' : label(s)}</button>`).join('')}
        </div>
      </section>
      <p class="alert alert--info" style="margin:0 0 16px;"><i class='bx bx-info-circle'></i>Uma cotação não é uma reserva. Quando o cliente aceitar, crie as reservas necessárias ou combine os detalhes directamente.</p>
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Experiências e serviços pedidos</h2><span class="muted">${items.length} item(s)</span></div><div class="card__body">
            ${items.length ? `<ul class="list-plain">${items.map(i => `<li><span>
                ${i.kind === 'package' ? `<a class="t-strong link" href="#/packages/${esc(i.package_id)}">${esc(i.title)}</a>` : `<span class="t-strong">${esc(i.title)}</span>`}
                <span class="t-sub">${esc(i.kind === 'package' ? (CATEGORY_LABELS[i.category] || (i.package_kind === 'accommodation' ? 'Alojamento' : i.category)) : 'Serviço privado')}${i.notes ? ` · ${esc(i.notes)}` : ''}</span></span>
                <span class="small">${i.date ? date(i.date) : '<span class="muted">datas da viagem</span>'}</span></li>`).join('')}</ul>`
              : '<p class="muted" style="margin:0;">O cliente não escolheu itens do catálogo — veja as ideias abaixo.</p>'}
          </div></div>

          <div class="card"><div class="card__head"><h2>Detalhes do pedido</h2></div><div class="card__body"><dl class="dl">
            <div><dt>Destino / ideias</dt><dd style="font-weight:400;white-space:pre-wrap;">${esc([r.destination, r.activities].filter(Boolean).join('\n') || '—')}</dd></div>
            <div><dt>Interesses</dt><dd>${r.categories.length ? esc(r.categories.map(c => CATEGORY_LABELS[c] || (c === 'accommodation' ? 'Alojamento' : c)).join(', ')) : '—'}</dd></div>
            <div><dt>Alojamento</dt><dd style="font-weight:400;">${esc(r.accommodation || '—')}</dd></div>
            <div><dt>Transporte</dt><dd style="font-weight:400;">${esc(r.transport || '—')}</dd></div>
            <div><dt>Orçamento</dt><dd>${r.budget ? money(r.budget, r.budget_currency) : '—'}</dd></div>
            <div><dt>Idioma</dt><dd>${r.locale === 'en' ? 'Inglês' : 'Português'}</dd></div>
            <div style="grid-column:1/-1;"><dt>Pedidos especiais</dt><dd style="font-weight:400;white-space:pre-wrap;">${esc(r.special_requests || '—')}</dd></div>
          </dl></div></div>

          <div class="card"><div class="card__head"><h2>Cotações</h2></div><div class="card__body">
            ${d.quotes.length ? d.quotes.map(q => `<div class="card" style="box-shadow:none;margin-bottom:10px;"><div class="card__body">
              <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;"><strong class="mono" style="font-size:18px;">${money(q.total, q.currency)}</strong>
                <span>${badge(q.status)} <span class="muted small">válida até ${date(q.valid_until)}</span></span></div>
              <ul class="lines" style="margin-top:8px;">${q.items.map(i => `<li><span>${esc(i.description)}${Number(i.quantity) !== 1 ? ` × ${i.quantity}` : ''}</span><span class="mono">${money(i.quantity * i.unit_price, q.currency)}</span></li>`).join('')}</ul>
              ${q.inclusions ? `<p class="small"><strong>Incluído:</strong> ${esc(q.inclusions)}</p>` : ''}${q.exclusions ? `<p class="small"><strong>Não incluído:</strong> ${esc(q.exclusions)}</p>` : ''}
              ${(q.channels || []).length ? `<p class="small" style="margin:8px 0 0;">Enviada por: ${q.channels.map(c => `<span class="badge badge--plain"><i class='bx ${CH[c][1]}'></i>${CH[c][0]}</span>`).join(' ')}</p>` : ''}
              <p class="muted small" style="margin:6px 0 0;">Criada por ${esc(q.created_by_name || '—')} em ${dateTime(q.created_at)}${q.sent_at ? ` · enviada ${dateTime(q.sent_at)}` : ''}${q.responded_at ? ` · resposta ${dateTime(q.responded_at)}` : ''}</p>
              <div class="form-actions form-actions--start" style="margin-top:10px;">
                ${q.status === 'draft' ? `<button type="button" class="btn btn--primary btn--sm" data-send="${q.id}"><i class='bx bx-send'></i>Enviar ao cliente</button>` : ''}
                <a class="btn btn--ghost btn--sm" href="/api/admin/quotes/${q.id}/pdf" download><i class='bx bx-download'></i>PDF</a>
                ${q.status === 'sent' ? `<button type="button" class="btn btn--ghost btn--sm" data-share="${q.id}"><i class='bx bx-share-alt'></i>Partilhar de novo</button>` : ''}
                ${['draft', 'sent'].includes(q.status) ? `<button type="button" class="btn btn--danger btn--sm" data-withdraw="${q.id}">Retirar</button>` : ''}
              </div></div></div>`).join('') : '<p class="muted" style="margin:0;">Ainda não há cotações. Use “Gerar cotação”.</p>'}
          </div></div>

          <div class="card"><div class="card__head"><h2>Histórico</h2></div><div class="card__body"><ul class="timeline">
            ${d.history.map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}</strong>${h.data && h.data.to ? ` → ${badge(h.data.to)}` : ''}
              ${h.data && h.data.channels ? `<div class="muted small">${h.data.channels.map(c => CH[c] ? CH[c][0] : c).join(', ')}</div>` : ''}
              <time>${dateTime(h.at)} · ${esc(h.actor_name || (h.actor_type === 'guest' ? 'Cliente' : h.actor_type))}</time></li>`).join('')}</ul></div></div>
        </div>
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Cliente</h2></div><div class="card__body">
            ${r.billing && r.billing.company_name ? `<div style="padding:10px 12px;border-radius:10px;background:var(--bg);margin-bottom:10px;">
              <span class="eyebrow"><i class='bx bx-buildings'></i>Pedido em nome de empresa</span>
              <p class="t-strong" style="margin:4px 0 0;font-size:15px;">${esc(r.billing.company_name)}</p>
              <p class="small" style="margin:2px 0 0;">${r.billing.nuit ? `NUIT ${esc(String(r.billing.nuit).replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3'))}` : '<span class="muted">NUIT não indicado</span>'}${r.billing.address ? `<br>${esc(r.billing.address)}` : ''}</p>
            </div><span class="muted small">Pessoa de contacto</span>` : ''}
            <p class="t-strong" style="margin:0;font-size:16px;">${esc(r.name)}</p>
            <ul class="list-plain"><li><a class="link" href="mailto:${esc(r.email)}"><i class='bx bx-envelope'></i> ${esc(r.email)}</a></li>
              <li><a class="link" href="tel:${esc(r.phone)}"><i class='bx bx-phone'></i> ${esc(r.phone)}</a>
                <a class="btn btn--ghost btn--sm" href="${wa}" target="_blank" rel="noopener"><i class='bx bxl-whatsapp'></i>WhatsApp</a></li>
              <li><span>${d.account && d.account.linked ? `<i class='bx bx-user-check' style="color:var(--success)"></i> Com conta — vê as cotações na sua conta` : d.account ? `<i class='bx bx-user'></i> Tem conta mas o e-mail não está confirmado` : `<i class='bx bx-user-x'></i> Sem conta`}</span>
                ${d.account ? `<a class="link small" href="#/customers/${d.account.user_id}">Ver conta</a>` : ''}</li></ul></div></div>
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
    const deliver = (path, title, text) => async () => {
      let res = null;
      const ok = await modal({ title, body: `<p style="margin:0;">${text}</p>${channelFields(r, d.account)}`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Enviar', kind: 'primary', value: 'ok', submit: true,
          validate: v => (channelsOf(v).length ? null : 'Escolha pelo menos um canal.'),
          run: async v => { res = await post(path, { channels: channelsOf(v) }); } }] });
      if (ok && res) { await deliveryResult(res.delivery); load(); }
    };
    $$('[data-send]', main).forEach(b => b.addEventListener('click', deliver(`/admin/quotes/${b.dataset.send}/send`, 'Enviar cotação',
      'Cotações enviadas anteriormente para este pedido deixam de ser válidas.')));
    $$('[data-share]', main).forEach(b => b.addEventListener('click', deliver(`/admin/quotes/${b.dataset.share}/share`, 'Partilhar de novo',
      'É gerado um link novo; o link enviado antes deixa de funcionar.')));
    $$('[data-withdraw]', main).forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Retirar cotação', text: 'O cliente deixa de a poder aceitar.', confirm: 'Retirar', kind: 'danger-solid' }))) return;
      try { await busy(b, () => post(`/admin/quotes/${b.dataset.withdraw}/withdraw`), 'Cotação retirada.'); load(); } catch { /* toast */ }
    }));
    const nq = $('#new-quote', main);
    if (nq) nq.addEventListener('click', async e => {
      const s = await busy(e.currentTarget, () => get(`/admin/requests/${r.id}/quote-suggestion`)).catch(() => null);
      quoteForm(r, s);
    });
    $('#note-form', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.body.value.trim()) return;
      try { await busy(f.querySelector('button'), () => post(`/admin/requests/${r.id}/notes`, { body: f.body.value.trim() }), 'Nota adicionada.'); load(); } catch { /* toast */ }
    });
  }

  async function quoteForm(r, suggestion) {
    const lines = suggestion && suggestion.lines.length ? suggestion.lines : [{}];
    const currency = (suggestion && suggestion.currency) || r.budget_currency || 'MZN';
    const row = (i = {}) => `<div class="repeat__row"><div class="repeat__fields" style="grid-template-columns:3fr 1fr 1.2fr;">
        <label class="field"><span>Descrição</span><input data-k="description" maxlength="300" value="${esc(i.description || '')}"></label>
        <label class="field"><span>Qtd.</span><input type="number" data-k="quantity" min="0.5" step="0.5" value="${i.quantity ?? 1}"></label>
        <label class="field"><span>Preço unit.</span><input type="number" data-k="unit_price" min="0" step="0.01" value="${i.unit_price ?? ''}"${i.unit_price === null ? ' class="is-invalid" placeholder="indicar"' : ''}></label>
      </div><div class="repeat__ctrl"><button type="button" class="icon-btn" data-rm aria-label="Remover linha"><i class='bx bx-trash'></i></button></div></div>`;
    let delivery = null;
    const res = await modal({
      title: `Cotação para ${r.reference}`, wide: true,
      body: `${suggestion && suggestion.lines.length ? `<p class="alert alert--info" style="margin:0 0 12px;"><i class='bx bx-calculator'></i>Linhas geradas a partir dos itens escolhidos pelo cliente, com os preços actuais para ${r.adults} adulto(s)${r.children ? ` e ${r.children} criança(s)` : ''}. Pode ajustar tudo antes de enviar.</p>` : ''}
        ${suggestion && suggestion.warnings.length ? `<p class="alert alert--warn" style="margin:0 0 12px;"><i class='bx bx-error'></i>A completar: ${suggestion.warnings.map(w => `${esc(w.item)} — ${esc(WARN[w.reason] || WARN.manual_price)}`).join('; ')}.</p>` : ''}
        ${suggestion && suggestion.mixed_currency ? `<p class="alert alert--warn" style="margin:0 0 12px;">Os itens têm moedas diferentes: confirme a moeda e os valores.</p>` : ''}
        <div id="q-items" class="repeat">${lines.map(row).join('')}</div>
        <button type="button" class="btn btn--ghost btn--sm" id="q-add" style="margin-top:8px;"><i class='bx bx-plus'></i>Adicionar linha</button>
        <div class="grid grid--3" style="margin-top:14px;">
          <label class="field"><span>Moeda</span><select name="currency">${['MZN', 'USD', 'ZAR', 'EUR'].map(c => `<option${currency === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
          <label class="field"><span>Válida até</span><input type="date" name="valid_until" required min="${today()}" value="${addDays(today(), 14)}"></label>
          <div class="field"><span>Total</span><strong id="q-total" class="mono" style="font-size:20px;padding-top:6px;">—</strong></div>
          <label class="field span-all"><span>Incluído</span><textarea name="inclusions" rows="2" maxlength="3000"></textarea></label>
          <label class="field span-all"><span>Não incluído</span><textarea name="exclusions" rows="2" maxlength="3000"></textarea></label>
          <label class="field span-all"><span>Mensagem ao cliente</span><textarea name="message" rows="3" maxlength="3000"></textarea></label>
        </div>
        ${channelFields(r, d.account)}`,
      actions: [{ label: 'Cancelar', value: null },
        { label: 'Guardar rascunho', kind: 'ghost', value: 'draft', validate: (v, f) => validate(f), run: (v, f) => submit(v, f, false) },
        { label: 'Enviar ao cliente', kind: 'primary', value: 'send', submit: true,
          validate: (v, f) => validate(f) || (channelsOf(v).length ? null : 'Escolha pelo menos um canal de envio.'),
          run: async (v, f) => { const q = await submit(v, f, true); delivery = q.delivery; } }],
      onOpen: dlg => {
        const box = $('#q-items', dlg);
        const total = () => {
          const t = items(dlg).reduce((s, i) => s + i.quantity * i.unit_price, 0);
          $('#q-total', dlg).textContent = money(t, $('[name=currency]', dlg).value);
        };
        $('#q-add', dlg).addEventListener('click', () => { box.insertAdjacentHTML('beforeend', row()); });
        box.addEventListener('click', e => { if (e.target.closest('[data-rm]') && box.children.length > 1) { e.target.closest('.repeat__row').remove(); total(); } });
        box.addEventListener('input', e => { if (e.target.dataset.k === 'unit_price' && e.target.value !== '') e.target.classList.remove('is-invalid'); });
        dlg.addEventListener('input', total);
        dlg.addEventListener('change', total);
        total();
      },
    });
    if (!res) return;
    if (res.action === 'send' && delivery) await deliveryResult(delivery);
    else toast('Rascunho guardado.');
    load();

    function items(root) {
      return $$('#q-items .repeat__row', root).map(r2 => ({
        description: $('[data-k=description]', r2).value.trim(), quantity: Number($('[data-k=quantity]', r2).value || 0),
        unit_price: $('[data-k=unit_price]', r2).value === '' ? null : Number($('[data-k=unit_price]', r2).value),
      })).filter(i => i.description);
    }
    function validate(f) {
      const it = items(f);
      if (!it.length) return 'Adicione pelo menos uma linha com descrição.';
      if (it.some(i => i.unit_price === null)) return 'Indique o preço de todas as linhas.';
      return f.valid_until.value < today() ? 'A validade não pode ser no passado.' : null;
    }
    function submit(v, f, send) {
      return post(`/admin/requests/${r.id}/quotes`, { items: items(f), currency: v.currency, valid_until: v.valid_until,
        inclusions: v.inclusions || undefined, exclusions: v.exclusions || undefined, message: v.message || undefined, send,
        ...(send ? { channels: channelsOf(v) } : {}) });
    }
  }

  await load();
}
