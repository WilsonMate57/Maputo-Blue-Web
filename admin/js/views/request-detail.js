// Quote request detail: chosen packages/services, status workflow, notes, and the
// proposals made from it. Proposals are built and sent in Cotações e propostas.
import { $, $$, CATEGORY_LABELS, badge, busy, date, dateTime, esc, get, label, money, post } from '../core.js';

const ACTIONS = {
  created: 'Pedido recebido', status_changed: 'Estado alterado', quote_sent: 'Cotação enviada', quote_drafted: 'Rascunho de cotação',
  quote_withdrawn: 'Cotação cancelada', quote_accepted: 'Cliente aceitou a cotação', quote_declined: 'Cliente recusou a cotação',
  quote_issued: 'Cotação emitida', quote_updated: 'Rascunho alterado', quote_viewed: 'Cliente abriu a proposta', quote_revision_requested: 'Cliente pediu alterações',
  quote_version_created: 'Nova versão criada', quote_expired: 'Cotação expirou', quote_converted: 'Cotação convertida em reserva',
};
const CH = { email: ['E-mail', 'bx-envelope'], whatsapp: ['WhatsApp', 'bxl-whatsapp'], link: ['Link partilhado', 'bx-link'] };
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
          ${open ? `<a class="btn btn--primary" href="#/quotations/new?request=${r.id}"><i class='bx bx-calculator'></i>Gerar cotação</a>` : ''}
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
            ${d.quotes.length ? `<ul class="list-plain">${d.quotes.map(q => `<li><span><a class="link mono" href="#/quotations/${q.id}${q.status === 'draft' ? '/edit' : ''}">${esc(q.number)}${q.version > 1 ? ` v${q.version}` : ''}</a>
              <span class="t-sub">Criada por ${esc(q.created_by_name || '—')} em ${dateTime(q.created_at)} · válida até ${date(q.valid_until)}</span></span>
              <span>${badge(q.status)} <span class="mono">${money(q.total, q.currency)}</span></span></li>`).join('')}</ul>` : '<p class="muted" style="margin:0;">Ainda não há cotações. Use “Gerar cotação”.</p>'}
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
    $('#note-form', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.body.value.trim()) return;
      try { await busy(f.querySelector('button'), () => post(`/admin/requests/${r.id}/notes`, { body: f.body.value.trim() }), 'Nota adicionada.'); load(); } catch { /* toast */ }
    });
  }

  await load();
}
