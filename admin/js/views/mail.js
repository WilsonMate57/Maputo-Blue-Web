// E-mail outbox: delivery status and manual retry.
import { $, $$, badge, busy, dateTime, emptyState, esc, get, pager, post, qs } from '../core.js';

const TEMPLATES = {
  booking_received: 'Pedido de reserva recebido', booking_ticket: 'Ticket da reserva (PDF)', booking_status: 'Actualização de reserva', trip_reminder: 'Lembrete de viagem',
  request_received: 'Pedido personalizado recebido', quote_issued: 'Cotação enviada', quote_accepted: 'Cotação aceite',
  verify_email: 'Confirmação de e-mail', reset_password: 'Recuperação de palavra-passe',
  admin_new_booking: 'Equipa: novo pedido', admin_cancel_request: 'Equipa: pedido de cancelamento', admin_new_request: 'Equipa: novo pedido personalizado', admin_quote_accepted: 'Equipa: cotação aceite',
};

export default async function mail(main, _p, { refreshBadges }) {
  const settings = await get('/admin/settings');
  const state = { status: '', page: 1 };
  main.innerHTML = `
    ${settings.mail_configured ? `<p class="alert alert--success" style="margin:0 0 16px;">Envio de e-mail configurado (remetente: ${esc(settings.mail_from)}).</p>`
      : '<p class="alert alert--warn" style="margin:0 0 16px;">O envio de e-mail ainda não está configurado no servidor (RESEND_API_KEY). Os e-mails ficam registados como “Falhou” e podem ser reenviados depois de configurar.</p>'}
    <div class="page-head"><div class="chips" role="group" aria-label="Estado">
      ${[['', 'Todos'], ['failed', 'Falharam'], ['queued', 'Em fila'], ['sent', 'Enviados']].map(([v, l]) => `<button type="button" class="chip" data-s="${v}" aria-pressed="${v === ''}">${l}</button>`).join('')}</div>
      <div class="page-head__actions"><button type="button" class="btn btn--ghost" id="retry-all"><i class='bx bx-refresh'></i>Reenviar todos os que falharam</button></div></div>
    <div class="card" id="ml"></div>`;

  async function load() {
    const box = $('#ml', main);
    const r = await get('/admin/mail' + qs({ status: state.status, page: state.page }));
    if (!r.items.length) { box.innerHTML = emptyState('bx-envelope', 'Sem e-mails.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>E-mail</th><th>Destinatário</th><th>Estado</th><th>Tentativas</th><th>Data</th><th></th></tr></thead><tbody>
      ${r.items.map(m => `<tr><td class="t-strong">${esc(TEMPLATES[m.template] || m.template)}<span class="t-sub">${m.locale.toUpperCase()}</span></td>
        <td>${esc(m.to_email)}</td><td>${badge(m.status)}${m.last_error ? `<span class="t-sub" style="color:var(--danger)">${esc(m.last_error)}</span>` : ''}</td>
        <td>${m.attempts}</td><td class="nowrap muted">${dateTime(m.sent_at || m.created_at)}</td>
        <td>${m.status === 'failed' ? `<button type="button" class="btn btn--ghost btn--sm" data-retry="${m.id}">Tentar de novo</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
    box.appendChild(pager(r.total, r.page, r.page_size, p => { state.page = p; load(); }));
    $$('[data-retry]', box).forEach(b => b.addEventListener('click', async () => {
      try { await busy(b, () => post(`/admin/mail/${b.dataset.retry}/retry`), 'E-mail colocado de novo na fila.'); refreshBadges(); load(); } catch { /* toast */ }
    }));
  }
  $('#retry-all', main).addEventListener('click', async e => {
    const r = await get('/admin/mail?status=failed');
    try {
      await busy(e.currentTarget, async () => { for (const m of r.items) await post(`/admin/mail/${m.id}/retry`); }, `${r.items.length} e-mail(s) colocado(s) na fila.`);
      refreshBadges(); load();
    } catch { /* toast */ }
  });
  main.querySelectorAll('[data-s]').forEach(c => c.addEventListener('click', () => {
    state.status = c.dataset.s; state.page = 1;
    main.querySelectorAll('[data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === c)));
    load();
  }));
  await load();
}
