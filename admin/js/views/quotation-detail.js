// One proposal: what the customer received, their answer, versions and history,
// and every step from here: send, new version, duplicate, cancel, convert.
import { $, $$, badge, busy, confirmAction, date, dateTime, esc, get, modal, money, post, toast } from '../core.js';

const ACTIONS = {
  quote_drafted: 'Rascunho criado', quote_updated: 'Rascunho alterado', quote_issued: 'Cotação emitida', quote_sent: 'Enviada ao cliente', quote_viewed: 'Cliente abriu a proposta',
  quote_accepted: 'Aceite', quote_declined: 'Recusada', quote_revision_requested: 'Alteração pedida', quote_version_created: 'Nova versão criada', quote_duplicated: 'Duplicada',
  quote_withdrawn: 'Cancelada', quote_expired: 'Expirou', quote_converted: 'Convertida em reserva',
};
const CH = { email: ['E-mail', 'bx-envelope'], whatsapp: ['WhatsApp', 'bxl-whatsapp'], link: ['Link', 'bx-link'] };
const CLIENT_TYPES = { individual: 'Individual', group: 'Grupo', company: 'Empresa', agency: 'Agência', other: 'Outro' };
const ITEM_STATE = {
  available: ['badge--confirmed', 'Disponível'], unavailable: ['badge--rejected', 'Sem disponibilidade'], not_controlled: ['badge--closed', 'Sem controlo de capacidade'], no_date: ['badge--pending', 'Sem data: confirme à mão'],
};
const BLOCKERS = { quote_not_accepted: 'Só uma cotação aceite pode ser convertida.', quote_already_converted: 'Esta cotação já foi convertida.', trip_dates_required: 'Indique as datas da viagem numa nova versão.' };
const ANSWERABLE = ['sent', 'viewed', 'revision_requested'];
const VERSIONABLE = ['issued', ...ANSWERABLE, 'accepted', 'declined', 'expired'];
const CANCELLABLE = ['issued', ...ANSWERABLE, 'accepted'];
const text = s => (s ? `<div style="white-space:pre-line;">${esc(s)}</div>` : '');

async function copyLink(url, btn) {
  try { await navigator.clipboard.writeText(url); } catch { window.prompt('Copie o link:', url); return; }
  toast('Link copiado.');
  if (btn) btn.blur();
}

export default async function quotationDetail(main, [id], { setTitle, refreshBadges }) {
  async function load() {
    const d = await get(`/admin/quotations/${id}`);
    const q = d.quote, cu = q.customer, trip = q.trip;
    const ref = `${q.number}${q.version > 1 ? ` v${q.version}` : ''}`;
    setTitle(`Cotação ${ref}`);
    const latest = d.versions[0].id === q.id;
    const pdf = `/api/admin/quotations/${q.id}/pdf`;
    const hasLineDiscount = q.items.some(i => i.discount_amount > 0);
    main.innerHTML = `
      <a class="back" href="#/quotations"><i class='bx bx-arrow-back'></i>Cotações e propostas</a>
      <section class="card detail-hero">
        <div><h2 class="detail-hero__title"><span class="mono">${esc(ref)}</span> ${badge(q.status)}</h2>
          <div class="detail-hero__meta"><span><i class='bx bx-user'></i>${esc(cu.company || cu.name || '—')}</span>
            <span><i class='bx bx-wallet'></i>${money(q.total, q.currency)}</span>
            <span><i class='bx bx-calendar-x'></i>Válida até ${date(q.valid_until)}</span>
            <span><i class='bx bx-globe'></i>${q.locale === 'en' ? 'English' : 'Português'}</span>
            ${d.request ? `<a class="link" href="#/requests/${d.request.id}"><i class='bx bx-link'></i>Pedido ${esc(d.request.reference)}</a>` : ''}</div></div>
        <div class="status-actions">
          ${q.status === 'draft' ? `<a class="btn btn--primary" href="#/quotations/${q.id}/edit"><i class='bx bx-edit'></i>Continuar a editar</a>` : ''}
          ${q.status === 'accepted' ? `<button type="button" class="btn btn--primary" id="convert"><i class='bx bx-transfer-alt'></i>Converter em reserva</button>` : ''}
          ${['issued', ...ANSWERABLE].includes(q.status) ? `<button type="button" class="btn btn--primary" id="send"><i class='bx bx-send'></i>${q.status === 'issued' ? 'Enviar ao cliente' : 'Enviar de novo'}</button>` : ''}
          ${d.link && ANSWERABLE.includes(q.status) ? `<button type="button" class="btn btn--ghost" id="copy"><i class='bx bx-copy'></i>Copiar link</button>` : ''}
          ${ANSWERABLE.includes(q.status) ? `<button type="button" class="btn btn--ghost" id="record"><i class='bx bx-phone'></i>Registar resposta</button>` : ''}
          ${latest && VERSIONABLE.includes(q.status) ? `<button type="button" class="btn btn--ghost" id="version"><i class='bx bx-git-branch'></i>Nova versão</button>` : ''}
          <button type="button" class="btn btn--ghost" id="duplicate"><i class='bx bx-duplicate'></i>Duplicar</button>
          <a class="btn btn--ghost" href="${pdf}" download><i class='bx bx-download'></i>PDF</a>
          <a class="btn btn--ghost" href="${pdf}?inline=1" target="_blank" rel="noopener"><i class='bx bx-printer'></i>Imprimir</a>
          ${CANCELLABLE.includes(q.status) || q.status === 'draft' ? `<button type="button" class="btn btn--danger" id="cancel">Cancelar</button>` : ''}
        </div>
      </section>
      ${q.status === 'revision_requested' ? `<p class="alert alert--warn"><i class='bx bx-message-rounded-dots'></i><span><strong>O cliente pediu alterações:</strong> ${esc(q.response_message)}</span></p>` : ''}
      ${q.status === 'declined' && q.response_message ? `<p class="alert"><i class='bx bx-x-circle'></i><span><strong>Motivo da recusa:</strong> ${esc(q.response_message)}</span></p>` : ''}
      ${q.status === 'accepted' ? `<p class="alert alert--success"><i class='bx bx-check-circle'></i><span>Aceite em ${dateTime(q.responded_at)}. Confirme a disponibilidade antes de converter: aceitar não reserva nada.</span></p>` : ''}
      ${d.booking ? `<p class="alert alert--success"><i class='bx bx-calendar-check'></i><span>Deu origem à reserva <a class="link mono" href="#/bookings/${d.booking.id}">${esc(d.booking.reference)}</a> ${badge(d.booking.status)}</span></p>` : ''}
      ${q.status === 'superseded' ? `<p class="alert alert--info"><i class='bx bx-info-circle'></i><span>Esta versão foi substituída. <a class="link" href="#/quotations/${d.versions[0].id}">Abrir a versão actual</a>.</span></p>` : ''}
      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Serviços</h2></div><div class="table-wrap"><table class="table">
            <thead><tr><th>Serviço</th><th class="right">Qtd.</th><th class="right">Preço unit.</th>${hasLineDiscount ? '<th class="right">Desconto</th>' : ''}<th class="right">Total</th></tr></thead>
            <tbody>${q.items.map(i => `<tr><td><span class="t-strong">${esc(i.description)}</span>${i.date_from ? `<span class="t-sub">${date(i.date_from)}${i.date_to && i.date_to !== i.date_from ? ` → ${date(i.date_to)}` : ''}</span>` : ''}${i.details ? `<span class="t-sub">${esc(i.details)}</span>` : ''}</td>
              <td class="right">${esc(i.quantity)}</td><td class="right mono nowrap">${money(i.unit_price, q.currency)}</td>${hasLineDiscount ? `<td class="right mono nowrap">${i.discount_amount ? `− ${money(i.discount_amount, q.currency)}` : '—'}</td>` : ''}
              <td class="right mono nowrap">${money(i.amount ?? i.quantity * i.unit_price, q.currency)}</td></tr>`).join('')}</tbody></table></div>
            <div class="card__body"><ul class="lines quote-totals">
              <li><span>Subtotal</span><span class="mono">${money(q.subtotal, q.currency)}</span></li>
              ${q.discount_total ? `<li class="is-discount"><span>Descontos</span><span class="mono">− ${money(q.discount_total, q.currency)}</span></li>` : ''}
              ${(q.fees || []).map(f => `<li><span>${esc(f.label)}</span><span class="mono">${money(f.amount, q.currency)}</span></li>`).join('')}
              <li class="is-total"><span>Total</span><span class="mono">${money(q.total, q.currency)}</span></li></ul></div></div>
          <div class="card"><div class="card__head"><h2>Condições</h2></div><div class="card__body"><dl class="dl">
            ${[['Pagamento', q.payment_terms], ['Depósito', q.deposit_percent ? `${Number(q.deposit_percent)}%` : null], ['Prazo', q.payment_due], ['Incluído', q.inclusions], ['Não incluído', q.exclusions],
              ['Cancelamento', q.cancellation_terms], ['Condições especiais', q.special_conditions], ['Mensagem', q.message]].filter(x => x[1]).map(([k, v]) => `<dt>${k}</dt><dd>${text(v)}</dd>`).join('') || '<dd class="muted">Sem condições registadas.</dd>'}
          </dl></div></div>
          ${(q.itinerary || []).length ? `<div class="card"><div class="card__head"><h2>Itinerário</h2></div><div class="card__body"><ul class="list-plain">${q.itinerary.map(s => `<li><span><span class="t-strong">${esc(s.title || '')}</span><span class="t-sub">${esc(s.description || '')}</span></span></li>`).join('')}</ul></div></div>` : ''}
        </div>
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Cliente</h2></div><div class="card__body"><ul class="list-plain">
            <li><span class="t-strong">${esc(cu.name || '—')}</span>${cu.company ? esc(cu.company) : ''}</li>
            ${cu.email ? `<li><a class="link" href="mailto:${esc(cu.email)}">${esc(cu.email)}</a></li>` : ''}${cu.phone ? `<li><a class="link" href="tel:${esc(cu.phone)}">${esc(cu.phone)}</a></li>` : ''}
            <li><span class="muted">Tipo</span>${esc(CLIENT_TYPES[cu.client_type] || '—')}</li>${cu.country ? `<li><span class="muted">País</span>${esc(cu.country)}</li>` : ''}</ul></div></div>
          <div class="card"><div class="card__head"><h2>Viagem</h2></div><div class="card__body"><ul class="list-plain">
            ${trip.destination ? `<li><span class="muted">Destino</span>${esc(trip.destination)}</li>` : ''}
            ${trip.date_from ? `<li><span class="muted">Datas</span>${date(trip.date_from)}${trip.date_to ? ` → ${date(trip.date_to)}` : ''}</li>` : ''}
            <li><span class="muted">Grupo</span>${trip.adults ?? 0} adulto(s)${trip.children ? `, ${trip.children} criança(s)` : ''}</li>
            ${trip.experience ? `<li><span class="muted">Experiência</span>${esc(trip.experience)}</li>` : ''}</ul></div></div>
          ${q.internal_notes ? `<div class="card"><div class="card__head"><h2>Observações internas</h2></div><div class="card__body">${text(q.internal_notes)}</div></div>` : ''}
          <div class="card"><div class="card__head"><h2>Acompanhamento</h2></div><div class="card__body"><ul class="list-plain">
            <li><span class="muted">Criada por</span>${esc(d.created_by_name || '—')}</li>
            ${q.sent_at ? `<li><span class="muted">Canais</span>${(q.channels || []).map(c => esc(CH[c]?.[0] || c)).join(', ')}</li>` : ''}
            <li><span class="muted">Aberturas</span>${q.view_count}${q.viewed_at ? ` · primeira a ${dateTime(q.viewed_at)}` : ''}</li></ul></div></div>
          ${d.versions.length > 1 ? `<div class="card"><div class="card__head"><h2>Versões</h2></div><div class="card__body"><ul class="list-plain">
            ${d.versions.map(v => `<li><a class="link" href="#/quotations/${v.id}">v${v.version}</a><span>${badge(v.status)} <span class="mono">${money(v.total, v.currency)}</span></span></li>`).join('')}</ul></div></div>` : ''}
          <div class="card"><div class="card__head"><h2>Histórico</h2></div><div class="card__body"><ul class="timeline">
            ${d.history.map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}${h.data.version > 1 ? ` (v${h.data.version})` : ''}</strong>${h.data.message ? `<span class="t-sub">${esc(h.data.message)}</span>` : ''}
              <time>${dateTime(h.at)} · ${esc(h.actor_name || (h.actor_type === 'guest' ? 'Cliente' : 'Sistema'))}</time></li>`).join('')}</ul></div></div>
        </div>
      </div>`;

    const on = (sel, fn) => $(sel, main)?.addEventListener('click', fn);
    on('#copy', e => copyLink(d.link, e.currentTarget));
    on('#send', () => send(q));
    on('#record', () => record(q));
    on('#convert', () => convert(q));
    on('#duplicate', async e => {
      try { const r = await busy(e.currentTarget, () => post(`/admin/quotations/${q.id}/duplicate`), 'Cotação duplicada.'); location.hash = `#/quotations/${r.id}/edit`; } catch { /* toast */ }
    });
    on('#version', async e => {
      const btn = e.currentTarget;
      if (!(await confirmAction({ title: 'Criar nova versão', confirm: 'Criar versão',
        text: q.status === 'accepted'
          ? `<strong>O cliente já aceitou esta cotação.</strong> Quando emitir a nova versão, esta aceitação deixa de valer e o cliente terá de responder de novo.`
          : 'A versão actual continua válida até emitir a nova. Depois fica guardada no histórico.' }))) return;
      try { const r = await busy(btn, () => post(`/admin/quotations/${q.id}/version`)); location.hash = `#/quotations/${r.id}/edit`; } catch { /* toast */ }
    });
    on('#cancel', async e => {
      const btn = e.currentTarget;
      const v = await confirmAction({ title: 'Cancelar cotação', confirm: 'Cancelar cotação', kind: 'danger-solid', text: 'O link deixa de funcionar para o cliente. O histórico mantém-se.',
        extra: `<label class="field"><span>Motivo (opcional)</span><input name="reason" maxlength="500"></label>` });
      if (!v) return;
      try { await busy(btn, () => post(`/admin/quotations/${q.id}/cancel`, { reason: v.reason || undefined }), 'Cotação cancelada.'); load(); refreshBadges(); } catch { /* toast */ }
    });
  }

  async function send(q) {
    const cu = q.customer;
    let delivery = null;
    await modal({
      title: 'Enviar cotação',
      body: `<div class="stack">
        <label class="check check--card"><input type="checkbox" name="ch_email" checked><span><strong><i class='bx bx-envelope'></i> E-mail</strong><span class="t-sub">${esc(cu.email)}, com o PDF em anexo</span></span></label>
        <label class="check check--card"><input type="checkbox" name="ch_whatsapp"><span><strong><i class='bx bxl-whatsapp'></i> WhatsApp</strong><span class="t-sub">${esc(cu.phone)}: abre o WhatsApp com a mensagem pronta</span></span></label>
        <label class="check check--card"><input type="checkbox" name="ch_link"><span><strong><i class='bx bx-link'></i> Link</strong><span class="t-sub">Para partilhar noutro canal</span></span></label></div>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Enviar', kind: 'primary', value: 'ok', submit: true,
        validate: v => (!v.ch_email && !v.ch_whatsapp && !v.ch_link ? 'Escolha pelo menos um canal.' : null),
        run: async v => { delivery = (await post(`/admin/quotations/${q.id}/send`, { channels: ['email', 'whatsapp', 'link'].filter(c => v[`ch_${c}`]) })).delivery; } }],
    });
    if (!delivery) return;
    if (delivery.whatsapp_url) window.open(delivery.whatsapp_url, '_blank', 'noopener');
    await modal({
      title: 'Cotação enviada',
      body: `<p style="margin:0 0 12px;">Enviada por: ${delivery.channels.map(c => `<span class="badge badge--plain">${CH[c][0]}</span>`).join(' ')}</p>
        ${delivery.whatsapp_url ? `<p class="alert alert--info" style="margin:0 0 12px;"><i class='bx bxl-whatsapp'></i><span>O WhatsApp abriu noutra janela. <a class="link" href="${esc(delivery.whatsapp_url)}" target="_blank" rel="noopener">Abrir de novo</a></span></p>` : ''}
        <label class="field"><span>Link da cotação</span><div style="display:flex;gap:8px;"><input class="input" id="q-link" readonly value="${esc(delivery.quote_url)}">
          <button type="button" class="btn btn--ghost" id="q-copy"><i class='bx bx-copy'></i>Copiar</button></div>
          <span class="field__hint">Quem tiver o link pode ver e responder à cotação.</span></label>`,
      actions: [{ label: 'Fechar', kind: 'primary', value: 'ok', submit: true }],
      onOpen: dlg => $('#q-copy', dlg).addEventListener('click', e => copyLink(delivery.quote_url, e.currentTarget)),
    });
    load();
  }

  async function record(q) {
    const r = await modal({
      title: 'Registar resposta do cliente',
      body: `<p class="muted" style="margin-top:0;">Para respostas dadas por telefone, WhatsApp ou pessoalmente. Fica registado com o seu nome.</p>
        <label class="field"><span>Resposta</span><select name="decision"><option value="accept">Aceitou</option><option value="revision">Pediu alterações</option><option value="decline">Recusou</option></select></label>
        <label class="field" style="margin-top:12px;"><span>Nota</span><textarea name="message" rows="3" maxlength="3000"></textarea></label>`,
      actions: [{ label: 'Cancelar', value: null }, { label: 'Registar', kind: 'primary', value: 'ok', submit: true,
        validate: v => (v.decision === 'revision' && !v.message.trim() ? 'Indique o que o cliente pediu.' : null),
        run: v => post(`/admin/quotations/${q.id}/respond`, { decision: v.decision, ...(v.message.trim() ? { message: v.message.trim() } : {}) }) }],
    });
    if (r) { toast('Resposta registada.'); load(); refreshBadges(); }
  }

  async function convert(q) {
    const p = await get(`/admin/quotations/${q.id}/conversion`);
    const problems = p.blockers.map(b => BLOCKERS[b] || b);
    let booking = null;
    await modal({
      title: 'Converter em reserva', wide: true,
      body: `<dl class="dl"><dt>Cliente</dt><dd>${esc(q.customer.company || q.customer.name)}</dd><dt>Datas</dt><dd>${date(p.start_date)}${p.end_date && p.end_date !== p.start_date ? ` → ${date(p.end_date)}` : ''}</dd>
          <dt>Total</dt><dd class="mono">${money(q.total, q.currency)}</dd></dl>
        <div class="table-wrap" style="margin-top:12px;"><table class="table"><thead><tr><th>Serviço</th><th>Data</th><th>Disponibilidade</th></tr></thead><tbody>
          ${p.items.map(i => { const [cls, txt] = ITEM_STATE[i.state]; return `<tr><td>${esc(i.description)}</td><td class="nowrap">${date(i.date)}</td><td><span class="badge badge--plain ${cls}">${txt}</span></td></tr>`; }).join('')}</tbody></table></div>
        ${problems.map(x => `<p class="alert" style="margin-top:12px;">${esc(x)}</p>`).join('')}
        ${p.items.some(i => i.state === 'unavailable') ? `<p class="alert" style="margin-top:12px;">Há serviços sem disponibilidade. Crie uma nova versão com outra data ou liberte capacidade antes de converter.</p>` : ''}
        ${p.items.some(i => i.state === 'not_controlled' || i.state === 'no_date') ? `<p class="muted small" style="margin:12px 0 0;">Os serviços sem controlo de capacidade têm de ser confirmados pela equipa: o sistema não os verifica.</p>` : ''}
        ${p.can_convert ? `<label class="check" style="margin-top:12px;"><input type="checkbox" name="notify" checked> Enviar a confirmação da reserva ao cliente</label>
          <p class="muted small" style="margin:8px 0 0;">A reserva fica confirmada, com a capacidade dos serviços do catálogo ocupada. Nenhum pagamento é registado.</p>` : ''}`,
      actions: p.can_convert ? [{ label: 'Cancelar', value: null }, { label: 'Criar reserva', kind: 'primary', value: 'ok', submit: true,
        run: async v => { booking = (await post(`/admin/quotations/${q.id}/convert`, { notify: v.notify })).booking; } }] : [{ label: 'Fechar', value: null }],
    });
    if (booking) { toast(`Reserva ${booking.reference} criada.`); refreshBadges(); location.hash = `#/bookings/${booking.id}`; }
  }

  await load();
}
