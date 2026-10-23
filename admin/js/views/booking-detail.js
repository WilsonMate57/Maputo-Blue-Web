// Booking detail: status workflow, edit, payments, notes, e-mails, history.
import { $, METHODS, badge, busy, confirmAction, date, dateTime, errorText, esc, get, label, modal, money, patch, post, toast } from '../core.js';
import { paymentDialog, paymentList, reversalDialog } from '../payments-ui.js';

const ACTIONS = {
  created: 'Pedido criado', status_changed: 'Estado alterado', updated: 'Reserva editada', payment_recorded: 'Pagamento registado',
  cancel_requested: 'Cliente pediu cancelamento', email_resent: 'E-mail reenviado', ticket_emailed: 'Ticket enviado por e-mail',
  ticket_downloaded: 'Ticket descarregado (equipa)', ticket_revoked: 'QR code invalidado', checked_in: 'Check-in registado',
  refund_recorded: 'Reembolso registado', payment_reversed: 'Pagamento estornado', invoice_issued: 'Factura emitida', invoice_cancelled: 'Factura anulada',
};
const TEMPLATES = { booking_received: 'Pedido recebido', booking_ticket: 'Ticket (PDF)', booking_status: 'Actualização de estado', invoice_issued: 'Factura (PDF)', invoice_paid: 'Factura paga', trip_reminder: 'Lembrete da viagem', admin_new_booking: 'Aviso à equipa', admin_cancel_request: 'Aviso de cancelamento' };

const TRANSITIONS = {
  pending: [
    { to: 'confirmed', label: 'Confirmar reserva', kind: 'success', icon: 'bx-check', text: 'Confirma que há disponibilidade? O cliente recebe um e-mail de confirmação.' },
    { to: 'rejected', label: 'Rejeitar', kind: 'danger', icon: 'bx-block', text: 'Rejeitar este pedido? O lugar é libertado e o cliente é avisado por e-mail.' },
    { to: 'cancelled', label: 'Cancelar', kind: 'danger', icon: 'bx-x', text: 'Cancelar este pedido? O lugar é libertado e o cliente é avisado por e-mail.' },
  ],
  confirmed: [
    { to: 'completed', label: 'Marcar como concluída', kind: 'secondary', icon: 'bx-flag', text: 'Marcar a viagem como concluída? Conta para o programa de fidelização do cliente.' },
    { to: 'cancelled', label: 'Cancelar reserva', kind: 'danger', icon: 'bx-x', text: 'Cancelar esta reserva confirmada? O lugar é libertado e o cliente é avisado por e-mail. Registe reembolsos em “Pagamentos”.' },
  ],
};

export default async function bookingDetail(main, [id], { setTitle, refreshBadges }) {
  async function load() {
    const d = await get(`/admin/bookings/${id}`);
    render(d);
  }

  function render(d) {
    const b = d.booking;
    const s = b.price_snapshot || {};
    const q = s.quote || {};
    setTitle(`Reserva ${b.reference}`);
    const activeInvoice = d.invoices.find(i => i.doc_status !== 'cancelled') || null;
    // With an issued invoice, the invoice total is what is owed
    const billTotal = activeInvoice && activeInvoice.doc_status === 'issued' ? Number(activeInvoice.total) : Number(b.total);
    const holdExpired = b.status === 'pending' && (!b.hold_expires_at || new Date(b.hold_expires_at) < new Date());
    const wa = `https://wa.me/${String(b.customer_phone).replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${b.customer_name}, aqui é a Maputo Blue sobre a reserva ${b.reference}.`)}`;
    const lines = (q.lines || []).map(l => `<li><span>${esc(l.label)}${l.quantity > 1 && !l.qty_in_label ? ` × ${l.quantity}` : ''}${l.unit_price !== null && l.quantity > 1 ? ` <span class="muted small">(${money(l.unit_price, b.currency)})</span>` : ''}</span><span class="mono">${l.unit_price === null ? 'sob consulta' : money(l.amount, b.currency)}</span></li>`).join('')
      + (q.discounts || []).map(x => `<li class="is-discount"><span>${esc(x.label)}${x.code ? ` (${esc(x.code)})` : ''}</span><span class="mono">− ${money(x.amount, b.currency)}</span></li>`).join('');

    main.innerHTML = `
      <a class="back" href="#/bookings"><i class='bx bx-arrow-back'></i>Reservas</a>
      <section class="card detail-hero">
        <div>
          <span class="eyebrow">Reserva</span>
          <h2 class="detail-hero__title"><span class="mono">${esc(b.reference)}</span> ${badge(b.status)} ${badge(b.payment_status)}</h2>
          <div class="detail-hero__meta">
            <span><i class='bx bx-user'></i>${esc(b.customer_name)}</span>
            <span><i class='bx bx-map'></i>${esc(s.package?.title || b.package_id)}</span>
            <span><i class='bx bx-calendar'></i>${date(b.start_date)}${b.end_date !== b.start_date ? ` → ${date(b.end_date)}` : ''}</span>
            <span><i class='bx bx-time'></i>Criada ${dateTime(b.created_at)}${b.user_id ? ' · com conta' : ' · sem conta'}</span>
          </div>
        </div>
        <div class="status-actions">
          ${(TRANSITIONS[b.status] || []).map((t, i) => `<button type="button" class="btn btn--${t.kind}" data-t="${i}"><i class='bx ${t.icon}'></i>${t.label}</button>`).join('')}
          ${['pending', 'confirmed'].includes(b.status) ? `<button type="button" class="btn btn--ghost" data-edit><i class='bx bx-edit'></i>Editar</button>` : ''}
          <button type="button" class="btn btn--ghost" data-resend><i class='bx bx-envelope'></i>Reenviar e-mail</button>
        </div>
      </section>
      ${b.cancel_requested_at && ['pending', 'confirmed'].includes(b.status) ? `<p class="alert alert--warn" style="margin:0 0 16px;"><i class='bx bx-error'></i> O cliente pediu o cancelamento em ${dateTime(b.cancel_requested_at)}. Veja o motivo no histórico.</p>` : ''}
      ${b.status === 'pending' ? `<p class="alert ${holdExpired ? 'alert--warn' : 'alert--info'}" style="margin:0 0 16px;">${holdExpired
        ? 'O bloqueio de capacidade deste pedido expirou. Ao confirmar, o sistema volta a verificar a disponibilidade.'
        : `A capacidade está reservada para este pedido até ${dateTime(b.hold_expires_at)}.`}</p>` : ''}

      <div class="cols">
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Viagem</h2></div><div class="card__body">
            <dl class="dl">
              <div><dt>Experiência</dt><dd><a class="link" href="#/packages/${esc(b.package_id)}">${esc(s.package?.title || b.package_id)}</a></dd></div>
              <div><dt>${s.package?.kind === 'accommodation' ? 'Check-in → check-out' : 'Data'}</dt><dd>${date(b.start_date)}${b.end_date !== b.start_date ? ` → ${date(b.end_date)}` : ''}</dd></div>
              <div><dt>Participantes</dt><dd>${b.adults} adulto(s)${b.children ? `, ${b.children} criança(s)` : ''}</dd></div>
              <div><dt>Opção</dt><dd>${esc(b.option_key || '—')}</dd></div>
              <div><dt>Extras</dt><dd>${(b.extras || []).length ? esc(b.extras.join(', ')) : '—'}</dd></div>
              <div><dt>Transfer</dt><dd>${esc(b.transfer_key || '—')}</dd></div>
              <div class="span-all" style="grid-column:1/-1;"><dt>Pedidos do cliente</dt><dd style="font-weight:400;white-space:pre-wrap;">${esc(b.customer_notes || '—')}</dd></div>
            </dl>
            <p class="muted small" style="margin:12px 0 0;">Capacidade ocupada: ${d.allocations.map(a => `${date(a.day)} (${esc(a.resource_key)}) × ${a.quantity}`).join(' · ') || '—'}</p>
          </div></div>

          <div class="card"><div class="card__head"><h2>Preço</h2><span class="muted small">calculado pelo servidor em ${dateTime(s.computed_at)}${q.price_rule ? ` · regra: ${esc(q.price_rule.label)}` : ''}</span></div>
            <div class="card__body"><ul class="lines">${lines}
              <li class="is-total"><span>Total</span><span class="mono">${money(b.total, b.currency)}</span></li></ul>
              ${q.child_price_on_request ? '<p class="alert alert--warn">Preço das crianças sob consulta — combine com o cliente e, se necessário, ajuste o total em “Editar”.</p>' : ''}
              ${s.manual_total ? `<p class="alert alert--info">Total ajustado manualmente: ${esc(s.manual_total.reason)} (${dateTime(s.manual_total.at)}).</p>` : ''}
              <p class="muted small" style="margin:10px 0 0;">Este valor fica guardado com a reserva: alterações futuras de preço no pacote não o afectam.</p>
            </div></div>

          <div class="card"><div class="card__head"><h2>Histórico</h2></div><div class="card__body"><ul class="timeline">
            ${d.history.map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}</strong>
              ${h.data?.from && h.data?.to ? ` ${badge(h.data.from)} → ${badge(h.data.to)}` : ''}
              ${h.data?.message || h.data?.reason ? `<div class="muted">“${esc(h.data.message || h.data.reason)}”</div>` : ''}
              ${h.action === 'updated' && h.data?.before ? `<div class="muted small">${describeChange(h.data.before, h.data.after, b.currency)}</div>` : ''}
              ${['payment_recorded', 'refund_recorded', 'payment_reversed'].includes(h.action) ? `<div class="muted small">${money(h.data.amount, b.currency)} · ${esc(METHODS[h.data.method] || h.data.method)}${h.data.reference ? ` · ${esc(h.data.reference)}` : ''}</div>` : ''}
              ${h.action.startsWith('invoice_') && h.data?.number ? `<div class="muted small"><a class="link" href="#/invoices/${esc(h.data.invoice_id)}">${esc(h.data.number)}</a></div>` : ''}
              <time>${dateTime(h.at)} · ${esc(h.actor_name || (h.actor_type === 'guest' ? 'Cliente' : h.actor_type === 'system' ? 'Sistema' : h.actor_type))}</time></li>`).join('')}
          </ul></div></div>
        </div>

        <div class="stack">
          <div class="card"><div class="card__head"><h2>Cliente</h2></div><div class="card__body">
            <p class="t-strong" style="margin:0;font-size:16px;">${esc(b.customer_name)}</p>
            <ul class="list-plain">
              <li><a class="link" href="mailto:${esc(b.customer_email)}"><i class='bx bx-envelope'></i> ${esc(b.customer_email)}</a></li>
              <li><a class="link" href="tel:${esc(b.customer_phone)}"><i class='bx bx-phone'></i> ${esc(b.customer_phone)}</a>
                <a class="btn btn--ghost btn--sm" href="${wa}" target="_blank" rel="noopener"><i class='bx bxl-whatsapp'></i>WhatsApp</a></li>
              ${b.customer_country ? `<li><span><i class='bx bx-globe'></i> ${esc(b.customer_country)}</span></li>` : ''}
              <li><span class="muted">Idioma dos e-mails</span><span>${b.locale === 'en' ? 'Inglês' : 'Português'}</span></li>
              ${b.user_id ? `<li><a class="link" href="#/customers/${b.user_id}">Ver conta do cliente</a></li>` : ''}
            </ul>
          </div></div>

          <div class="card"><div class="card__head"><h2>Ticket e QR code</h2></div><div class="card__body">
            <div class="status-actions">
              <a class="btn btn--ghost btn--sm" href="/api/admin/bookings/${b.id}/ticket.pdf" download><i class='bx bx-download'></i>PDF</a>
              <button type="button" class="btn btn--ghost btn--sm" data-ticket-email><i class='bx bx-envelope'></i>Enviar ao cliente</button>
              <a class="btn btn--ghost btn--sm" href="${esc(d.verify_url)}" target="_blank" rel="noopener"><i class='bx bx-qr-scan'></i>Página de verificação</a>
              ${b.status === 'confirmed' && !b.checked_in_at ? `<button type="button" class="btn btn--success btn--sm" data-checkin><i class='bx bx-log-in-circle'></i>Check-in</button>` : ''}
              <button type="button" class="btn btn--danger btn--sm" data-revoke><i class='bx bx-block'></i>Invalidar QR</button>
            </div>
            ${b.checked_in_at ? `<p class="alert alert--success">Check-in registado em ${dateTime(b.checked_in_at)}.</p>` : ''}
            <p class="muted small" style="margin:10px 0 0;">O ticket é sempre gerado a partir dos dados guardados desta reserva (versão ${b.ticket_version}). “Invalidar QR” torna inválidos todos os tickets já emitidos; o próximo download gera um QR novo.</p>
            ${d.scans.length ? `<ul class="list-plain" style="margin-top:8px;">${d.scans.map(x => `<li><span>${esc(({ confirmed: 'Válida (confirmada)', pending: 'Pendente', cancelled: 'Cancelada', rejected: 'Rejeitada', completed: 'Concluída', revoked: 'QR substituído', invalid: 'Inválido' })[x.result] || x.result)}<span class="t-sub">${dateTime(x.at)}${x.staff_name ? ` · ${esc(x.staff_name)}` : ' · visitante'}</span></span></li>`).join('')}</ul>` : '<p class="muted small" style="margin:6px 0 0;">O QR ainda não foi lido.</p>'}
          </div></div>

          <div class="card"><div class="card__head"><h2>Factura</h2></div><div class="card__body">
            ${activeInvoice ? `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;">
                <span><a class="t-strong link mono" href="#/invoices/${activeInvoice.id}">${esc(activeInvoice.number || 'Rascunho')}</a>
                <span class="t-sub">${activeInvoice.issue_date ? `Emitida ${date(activeInvoice.issue_date)} · ` : ''}${money(activeInvoice.total, activeInvoice.currency)}</span></span>
                ${badge(activeInvoice.display_status)}</div>`
              : `<p class="muted small" style="margin:0 0 12px;">Esta reserva ainda não tem factura.</p>
                 ${['pending', 'confirmed', 'completed'].includes(b.status) ? `<a class="btn btn--secondary btn--sm" href="#/invoices/new?ref=${encodeURIComponent(b.reference)}"><i class='bx bx-receipt'></i>Emitir factura</a>` : ''}`}
            ${d.invoices.filter(i => i.doc_status === 'cancelled').map(i => `<p class="muted small" style="margin:8px 0 0;">Anulada: <a class="link" href="#/invoices/${i.id}">${esc(i.number)}</a></p>`).join('')}
          </div></div>

          <div class="card"><div class="card__head"><h2>Pagamentos</h2><button type="button" class="btn btn--ghost btn--sm" data-pay><i class='bx bx-plus'></i>Registar</button></div>
            <div class="card__body">
              <div class="money">
                <div><div class="money__k">Total</div><div class="money__v">${money(billTotal, b.currency)}</div></div>
                <div><div class="money__k">Pago</div><div class="money__v money__v--ok">${money(b.amount_paid, b.currency)}</div></div>
                <div><div class="money__k">Em falta</div><div class="money__v ${billTotal - b.amount_paid > 0 ? 'money__v--due' : ''}">${money(Math.max(billTotal - b.amount_paid, 0), b.currency)}</div></div>
              </div>
              <div class="bar" aria-hidden="true"><span style="width:${Math.min(100, billTotal ? (b.amount_paid / billTotal) * 100 : 0)}%"></span></div>
              ${paymentList(d.payments, b.currency, { reversible: true })}
            </div></div>

          <div class="card"><div class="card__head"><h2>Notas internas</h2></div><div class="card__body">
            <form id="note-form"><label class="field"><span class="muted small" style="font-weight:400;">Visíveis apenas para a equipa</span>
              <textarea name="body" rows="3" maxlength="4000" required placeholder="Ex.: cliente pediu almoço vegetariano"></textarea></label>
              <div class="form-actions"><button class="btn btn--secondary btn--sm" type="submit"><i class='bx bx-note'></i>Adicionar nota</button></div></form>
            ${d.notes.map(n => `<div class="note"><div style="white-space:pre-wrap;">${esc(n.body)}</div><div class="note__meta">${esc(n.author || '')} · ${dateTime(n.created_at)}</div></div>`).join('')}
          </div></div>

          <div class="card"><div class="card__head"><h2>E-mails</h2></div><div class="card__body">
            ${d.mails.length ? `<ul class="list-plain">${d.mails.map(m => `<li><span><span class="t-strong">${esc(TEMPLATES[m.template] || m.template)}</span>
              <span class="t-sub">${esc(m.to_email)} · ${dateTime(m.sent_at || m.created_at)}</span>${m.last_error ? `<span class="t-sub" style="color:var(--danger)">${esc(m.last_error)}</span>` : ''}</span>
              <span>${badge(m.status)} ${m.status === 'failed' ? `<button type="button" class="btn btn--ghost btn--sm" data-retry="${m.id}">Tentar de novo</button>` : ''}</span></li>`).join('')}</ul>`
              : '<p class="muted small" style="margin:0;">Sem e-mails.</p>'}
          </div></div>
        </div>
      </div>`;

    main.querySelectorAll('[data-t]').forEach(btn => btn.addEventListener('click', async () => {
      const t = TRANSITIONS[b.status][Number(btn.dataset.t)];
      const v = await confirmAction({
        title: t.label, text: t.text, confirm: t.label, kind: t.kind === 'danger' ? 'danger-solid' : t.kind,
        extra: `<label class="field" style="margin-top:12px;"><span>Mensagem para o cliente <small>(opcional, incluída no e-mail)</small></span><textarea name="message" rows="3" maxlength="1000"></textarea></label>
          <label class="check" style="margin-top:10px;"><input type="checkbox" name="notify" checked> Enviar e-mail ao cliente</label>`,
      });
      if (!v) return;
      try {
        await busy(btn, () => post(`/admin/bookings/${b.id}/status`, { to: t.to, message: v.message || null, notify: v.notify }), `Estado alterado para “${label(t.to)}”.`);
        refreshBadges();
        load();
      } catch { /* toast shown */ }
    }));

    const edit = main.querySelector('[data-edit]');
    if (edit) edit.addEventListener('click', () => editBooking(b));
    main.querySelector('[data-resend]').addEventListener('click', async e => {
      if (!(await confirmAction({ title: 'Reenviar e-mail', text: `Reenviar ao cliente o e-mail correspondente ao estado actual (“${label(b.status)}”), com um novo link de acompanhamento?`, confirm: 'Reenviar' }))) return;
      try { await busy(e.currentTarget, () => post(`/admin/bookings/${b.id}/resend`), 'E-mail colocado na fila de envio.'); load(); } catch { /* toast */ }
    });
    main.querySelector('[data-pay]').addEventListener('click', async () => {
      const r = await paymentDialog({ currency: b.currency, total: billTotal, paid: Number(b.amount_paid), send: body => post(`/admin/bookings/${b.id}/payments`, body) });
      if (r) { toast(r.duplicate ? 'Este pagamento já estava registado.' : 'Pagamento registado.'); load(); }
    });
    main.querySelectorAll('[data-reverse]').forEach(btn => btn.addEventListener('click', async () => {
      const p = d.payments.find(x => x.id === btn.dataset.reverse);
      const r = await reversalDialog({ payment: p, currency: b.currency, send: body => post(`/admin/bookings/${b.id}/payments`, body) });
      if (r) { toast('Pagamento estornado.'); load(); }
    }));
    main.querySelector('[data-ticket-email]').addEventListener('click', async e => {
      if (!(await confirmAction({ title: 'Enviar ticket', text: `Enviar o ticket em PDF para ${esc(b.customer_email)}?`, confirm: 'Enviar' }))) return;
      try { await busy(e.currentTarget, () => post(`/admin/bookings/${b.id}/ticket/email`), 'Ticket colocado na fila de envio.'); load(); } catch { /* toast */ }
    });
    main.querySelector('[data-revoke]').addEventListener('click', async e => {
      if (!(await confirmAction({ title: 'Invalidar QR code', text: 'Todos os tickets já emitidos para esta reserva deixam de ser aceites na verificação. Use isto se um ticket foi partilhado indevidamente. Depois, reenvie o ticket ao cliente.', confirm: 'Invalidar', kind: 'danger-solid' }))) return;
      try { await busy(e.currentTarget, () => post(`/admin/bookings/${b.id}/ticket/revoke`), 'QR invalidado. Reenvie o ticket ao cliente.'); load(); } catch { /* toast */ }
    });
    const ci = main.querySelector('[data-checkin]');
    if (ci) ci.addEventListener('click', async e => {
      if (!(await confirmAction({ title: 'Registar check-in', text: 'Confirma que o cliente se apresentou para esta experiência?', confirm: 'Registar check-in', kind: 'success' }))) return;
      try { await busy(e.currentTarget, () => post(`/admin/bookings/${b.id}/check-in`), 'Check-in registado.'); load(); } catch { /* toast */ }
    });
    main.querySelectorAll('[data-retry]').forEach(btn => btn.addEventListener('click', async () => {
      try { await busy(btn, () => post(`/admin/mail/${btn.dataset.retry}/retry`), 'E-mail colocado de novo na fila.'); load(); } catch { /* toast */ }
    }));
    $('#note-form', main).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.body.value.trim()) return;
      try { await busy(f.querySelector('button'), () => post(`/admin/bookings/${b.id}/notes`, { body: f.body.value.trim() }), 'Nota adicionada.'); load(); } catch { /* toast */ }
    });
  }

  async function editBooking(b) {
    const { package: pkg } = await get(`/admin/packages/${encodeURIComponent(b.package_id)}`);
    const opts = pkg.pricing.options || [];
    const r = await modal({
      title: `Editar ${b.reference}`, wide: true,
      body: `
        <div class="grid grid--2">
          <label class="field"><span>Nome</span><input name="customer_name" required maxlength="120" value="${esc(b.customer_name)}"></label>
          <label class="field"><span>E-mail</span><input name="customer_email" type="email" required value="${esc(b.customer_email)}"></label>
          <label class="field"><span>Telefone</span><input name="customer_phone" required value="${esc(b.customer_phone)}"></label>
          <label class="field"><span>País</span><input name="customer_country" value="${esc(b.customer_country || '')}"></label>
          <label class="field"><span>Data${pkg.kind === 'accommodation' ? ' de check-in' : ''}</span><input name="date" type="date" required value="${b.start_date}"></label>
          ${opts.length ? `<label class="field"><span>Opção</span><select name="option_key">${opts.map(o => `<option value="${esc(o.key)}"${o.key === b.option_key ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : '<div></div>'}
          <label class="field"><span>Adultos</span><input name="adults" type="number" min="0" max="200" value="${b.adults}"></label>
          <label class="field"><span>Crianças</span><input name="children" type="number" min="0" max="200" value="${b.children}"></label>
        </div>
        <p class="alert alert--info">Mudar a data, os participantes ou a opção recalcula o preço com os preços actuais e volta a verificar a disponibilidade. O cálculo anterior fica guardado no histórico.</p>
        <label class="check" style="margin-top:10px;"><input type="checkbox" name="keep_price"> Manter o preço actual (não recalcular)</label>
        <div class="grid grid--2" style="margin-top:12px;">
          <label class="field"><span>Ajustar total manualmente <small>(opcional)</small></span><input name="total_override" type="number" min="0" step="0.01" placeholder="${b.total}"></label>
          <label class="field"><span>Motivo do ajuste</span><input name="override_reason" maxlength="500" placeholder="Obrigatório se ajustar o total"></label>
        </div>
        <label class="check" style="margin-top:10px;"><input type="checkbox" name="notify" checked> Avisar o cliente por e-mail se a viagem ou o preço mudarem</label>`,
      actions: [{ label: 'Cancelar', value: null }, {
        label: 'Guardar alterações', kind: 'primary', value: 'save', submit: true,
        validate: v => (v.total_override !== null && !v.override_reason.trim() ? 'Indique o motivo do ajuste do total.' : null),
        run: v => patch(`/admin/bookings/${b.id}`, {
          customer_name: v.customer_name.trim(), customer_email: v.customer_email.trim(), customer_phone: v.customer_phone.trim(),
          customer_country: v.customer_country.trim() || null, date: v.date, adults: v.adults, children: v.children,
          ...(opts.length ? { option_key: v.option_key } : {}), keep_price: v.keep_price,
          ...(v.total_override !== null ? { total_override: v.total_override, override_reason: v.override_reason.trim() } : {}), notify: v.notify,
        }),
      }],
    });
    if (r) { toast('Reserva actualizada.'); load(); }
  }

  try { await load(); } catch (err) { main.innerHTML = `<p class="alert">${esc(errorText(err))}</p>`; }
}

function describeChange(a, b, cur) {
  const out = [];
  if (a.start_date !== b.start_date) out.push(`data ${date(a.start_date)} → ${date(b.start_date)}`);
  if (a.adults !== b.adults || a.children !== b.children) out.push(`pessoas ${a.adults}+${a.children} → ${b.adults}+${b.children}`);
  if (a.option_key !== b.option_key) out.push(`opção ${a.option_key || '—'} → ${b.option_key || '—'}`);
  if (a.total !== b.total) out.push(`total ${money(a.total, cur)} → ${money(b.total, cur)}`);
  if (a.customer_email !== b.customer_email) out.push(`e-mail ${a.customer_email} → ${b.customer_email}`);
  return esc(out.join(' · ') || 'dados de contacto');
}
