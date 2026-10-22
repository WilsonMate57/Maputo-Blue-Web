// Invoice detail: document, money summary, payments (record / refund /
// reverse), PDF (current + original), e-mail, cancel / correct, history.
// Only actions valid for the current status are shown.
import { METHODS, badge, busy, confirmAction, date, dateTime, del, esc, get, modal, money, patch, post, today, toast } from '../core.js';
import { invoiceDoc } from '../invoice-doc.js';
import { paymentDialog, paymentList, reversalDialog } from '../payments-ui.js';

const ACTIONS = {
  draft_saved: 'Rascunho criado', draft_updated: 'Rascunho editado', draft_deleted: 'Rascunho apagado', issued: 'Factura emitida',
  document_archived: 'PDF original arquivado', payment_recorded: 'Pagamento registado', refund_recorded: 'Reembolso registado',
  payment_reversed: 'Pagamento estornado', payment_status_changed: 'Estado de pagamento actualizado', cancelled: 'Factura anulada',
  emailed: 'Enviada por e-mail', pdf_downloaded: 'PDF descarregado',
};
const WARNINGS = {
  booking_total_changed: 'O total da reserva foi alterado depois da emissão. Para corrigir, anule e emita uma nova factura.',
  booking_cancelled: 'A reserva foi cancelada. Se houve devolução de dinheiro, registe o reembolso; anule a factura se aplicável.',
};

export default async function invoiceDetail(main, [id], { setTitle, refreshBadges }) {
  async function load() { render(await get(`/admin/invoices/${id}`)); }

  function render(d) {
    const inv = d.invoice, b = d.booking;
    const issued = inv.doc_status === 'issued', draft = inv.doc_status === 'draft';
    setTitle(draft ? 'Rascunho de factura' : `Factura ${inv.number}`);
    const pct = inv.total ? Math.min(100, Math.max(0, (inv.amount_paid / inv.total) * 100)) : 0;
    const replaced = d.related.find(r => r.id !== inv.replaces_invoice_id);
    const replaces = d.related.find(r => r.id === inv.replaces_invoice_id);

    main.innerHTML = `
      <a class="back" href="#/invoices"><i class='bx bx-arrow-back'></i>Facturas</a>
      <section class="card detail-hero">
        <div>
          <span class="eyebrow">${draft ? 'Rascunho' : 'Factura'}</span>
          <h2 class="detail-hero__title"><span class="mono">${esc(inv.number || 'Sem número')}</span> ${badge(inv.display_status)}</h2>
          <div class="detail-hero__meta">
            <span><i class='bx bx-user'></i>${esc(inv.customer.name)}</span>
            <span><i class='bx bx-calendar-check'></i>Reserva <a class="link" href="#/bookings/${b.id}">${esc(b.reference)}</a> ${badge(b.status)}</span>
            ${inv.issue_date ? `<span><i class='bx bx-calendar'></i>Emitida ${date(inv.issue_date)}</span>` : ''}
            ${inv.due_date ? `<span><i class='bx bx-time-five'></i>Vence ${date(inv.due_date)}</span>` : ''}
          </div>
        </div>
        <div class="status-actions">
          ${issued ? `<button type="button" class="btn btn--primary" data-pay><i class='bx bx-wallet'></i>Registar pagamento</button>` : ''}
          ${draft ? `<button type="button" class="btn btn--primary" data-issue><i class='bx bx-check-circle'></i>Emitir factura</button>
                     <button type="button" class="btn btn--ghost" data-edit><i class='bx bx-edit'></i>Editar</button>
                     <button type="button" class="btn btn--danger" data-delete><i class='bx bx-trash'></i>Apagar rascunho</button>` : ''}
          ${!draft ? `<a class="btn btn--ghost" href="/api/admin/invoices/${inv.id}/pdf" download><i class='bx bx-download'></i>PDF</a>
                      <a class="btn btn--ghost" href="/api/admin/invoices/${inv.id}/pdf?inline=1" target="_blank" rel="noopener"><i class='bx bx-printer'></i>Imprimir</a>` : ''}
          ${issued ? `<button type="button" class="btn btn--ghost" data-email><i class='bx bx-envelope'></i>Enviar ao cliente</button>
                      <button type="button" class="btn btn--danger" data-cancel><i class='bx bx-block'></i>Anular / corrigir</button>` : ''}
        </div>
      </section>

      ${d.warnings.map(w => `<p class="alert alert--warn" style="margin:0 0 16px;"><i class='bx bx-error'></i>${esc(WARNINGS[w] || w)}</p>`).join('')}
      ${inv.doc_status === 'cancelled' ? `<p class="alert" style="margin:0 0 16px;"><i class='bx bx-block'></i>Anulada em ${dateTime(inv.cancelled_at)}. Motivo: ${esc(inv.cancel_reason)}${replaced ? ` · Substituída por <a class="link" href="#/invoices/${replaced.id}">${esc(replaced.number)}</a>` : ''}</p>` : ''}
      ${replaces ? `<p class="alert alert--info" style="margin:0 0 16px;"><i class='bx bx-info-circle'></i>Esta factura substitui <a class="link" href="#/invoices/${replaces.id}">${esc(replaces.number)}</a> (anulada).</p>` : ''}
      ${draft ? `<p class="alert alert--info" style="margin:0 0 16px;"><i class='bx bx-info-circle'></i>Rascunho: ainda sem número e não visível para o cliente. Os valores são recalculados a partir da reserva no momento da emissão.</p>` : ''}

      <div class="cols">
        <div class="stack">${invoiceDoc(inv, { status: badge(inv.display_status), paid: inv.amount_paid })}</div>
        <div class="stack">
          <div class="card"><div class="card__head"><h2>Pagamentos</h2>${issued ? `<button type="button" class="btn btn--ghost btn--sm" data-pay><i class='bx bx-plus'></i>Registar</button>` : ''}</div>
            <div class="card__body">
              <div class="money">
                <div><div class="money__k">Total</div><div class="money__v">${money(inv.total, inv.currency)}</div></div>
                <div><div class="money__k">Pago</div><div class="money__v money__v--ok">${money(inv.amount_paid, inv.currency)}</div></div>
                <div><div class="money__k">Em dívida</div><div class="money__v ${inv.balance > 0 ? 'money__v--due' : ''}">${money(Math.max(inv.balance, 0), inv.currency)}</div></div>
              </div>
              <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Percentagem paga"><span style="width:${pct}%"></span></div>
              ${paymentList(d.payments, inv.currency, { reversible: issued })}
              ${inv.paid_at ? `<p class="alert alert--success"><i class='bx bx-check-circle'></i>Paga na totalidade em ${dateTime(inv.paid_at)}.</p>` : ''}
            </div></div>

          ${d.document ? `<div class="card"><div class="card__head"><h2>Documento original</h2></div><div class="card__body">
            <p class="small" style="margin:0;">PDF arquivado no momento da emissão (${Math.round(d.document.bytes / 1024)} KB). Não muda com pagamentos posteriores.</p>
            <p class="muted small mono" style="margin:6px 0 10px;word-break:break-all;" title="SHA-256">SHA-256 ${esc(d.document.sha256)}</p>
            <a class="btn btn--ghost btn--sm" href="/api/admin/invoices/${inv.id}/original.pdf" download><i class='bx bx-file'></i>Descarregar original</a></div></div>` : ''}

          <div class="card"><div class="card__head"><h2>Histórico</h2></div><div class="card__body"><ul class="timeline">
            ${d.history.map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}</strong>
              ${h.data?.from && h.data?.to ? ` ${badge(h.data.from)} → ${badge(h.data.to)}` : ''}
              ${h.data?.amount !== undefined && h.action !== 'issued' ? `<div class="muted small">${money(h.data.amount, inv.currency)}${h.data.method ? ` · ${esc(METHODS[h.data.method] || h.data.method)}` : ''}${h.data.reference ? ` · ${esc(h.data.reference)}` : ''}</div>` : ''}
              ${h.data?.reason ? `<div class="muted small">“${esc(h.data.reason)}”</div>` : ''}
              <time>${dateTime(h.at)} · ${esc(h.actor_name || (h.actor_type === 'system' ? 'Sistema' : h.actor_type))}</time></li>`).join('') || '<li class="muted">Sem registos.</li>'}
          </ul></div></div>
        </div>
      </div>`;

    const send = body => post(`/admin/invoices/${inv.id}/payments`, body);
    main.querySelectorAll('[data-pay]').forEach(btn => btn.addEventListener('click', async () => {
      const r = await paymentDialog({ currency: inv.currency, total: inv.total, paid: inv.amount_paid, send });
      if (!r) return;
      toast(r.duplicate ? 'Este pagamento já estava registado.' : r.invoice.pay_status === 'paid' ? 'Pagamento registado — factura PAGA.' : 'Pagamento registado.');
      refreshBadges(); load();
    }));
    main.querySelectorAll('[data-reverse]').forEach(btn => btn.addEventListener('click', async () => {
      const p = d.payments.find(x => x.id === btn.dataset.reverse);
      const r = await reversalDialog({ payment: p, currency: inv.currency, send });
      if (r) { toast('Pagamento estornado.'); refreshBadges(); load(); }
    }));
    const on = (sel, fn) => { const el = main.querySelector(sel); if (el) el.addEventListener('click', fn); };
    on('[data-email]', async e => {
      if (!(await confirmAction({ title: 'Enviar factura', text: `Enviar a factura ${esc(inv.number)} em PDF para ${esc(inv.customer.email)}?`, confirm: 'Enviar' }))) return;
      try { await busy(e.currentTarget, () => post(`/admin/invoices/${inv.id}/email`), 'Factura colocada na fila de envio.'); load(); } catch { /* toast */ }
    });
    on('[data-cancel]', async () => {
      const r = await modal({
        title: `Anular ${inv.number}`,
        body: `<p>A factura fica anulada e o número <strong>${esc(inv.number)}</strong> continua registado (não é reutilizado). Os pagamentos ficam associados à reserva.</p>
          <label class="field" style="margin-top:12px;"><span>Motivo da anulação</span><textarea name="reason" rows="2" required minlength="3" maxlength="500" placeholder="Ex.: correcção do número de participantes"></textarea></label>
          <label class="check check--card" style="margin-top:12px;"><input type="checkbox" name="reissue" checked><span><strong>Emitir de imediato uma factura corrigida</strong>
            <span class="t-sub">Com os dados actuais da reserva e um novo número.</span></span></label>
          <label class="check" style="margin-top:10px;"><input type="checkbox" name="send_email"> Enviar a nova factura ao cliente</label>`,
        actions: [{ label: 'Voltar', value: null }, {
          label: 'Anular factura', kind: 'danger-solid', value: 'ok', submit: true,
          validate: v => (v.reason.trim().length < 3 ? 'Indique o motivo da anulação.' : null),
          run: async v => { modalResult = await post(`/admin/invoices/${inv.id}/cancel`, { reason: v.reason.trim(), reissue: v.reissue, send_email: v.send_email }); },
        }],
      });
      if (!r) return;
      toast(modalResult.cancelled ? `Factura anulada. Nova factura: ${modalResult.invoice.number}.` : 'Factura anulada.');
      refreshBadges();
      if (modalResult.cancelled) location.hash = `#/invoices/${modalResult.invoice.id}`; else load();
    });
    on('[data-issue]', async e => {
      const ok = await confirmAction({ title: 'Emitir factura', confirm: 'Emitir', kind: 'primary',
        text: `Emitir esta factura de <strong>${money(inv.total, inv.currency)}</strong> para ${esc(inv.customer.name)}? O número é atribuído agora e a factura deixa de poder ser editada.`,
        extra: `<label class="check" style="margin-top:12px;"><input type="checkbox" name="send_email" checked> Enviar ao cliente por e-mail</label>` });
      if (!ok) return;
      try { await busy(e.currentTarget, () => post(`/admin/invoices/${inv.id}/issue`, { send_email: ok.send_email }), 'Factura emitida.'); load(); } catch { /* toast */ }
    });
    on('[data-delete]', async e => {
      if (!(await confirmAction({ title: 'Apagar rascunho', text: 'O rascunho é apagado. Não afecta a reserva nem os pagamentos.', confirm: 'Apagar', kind: 'danger-solid' }))) return;
      try { await busy(e.currentTarget, () => del(`/admin/invoices/${inv.id}`), 'Rascunho apagado.'); location.hash = '#/invoices'; } catch { /* toast */ }
    });
    on('[data-edit]', async () => {
      const c = inv.customer;
      const r = await modal({
        title: 'Editar rascunho',
        body: `<div class="grid grid--2">
          <label class="field"><span>Nome de facturação</span><input name="name" maxlength="160" value="${esc(c.name || '')}"></label>
          <label class="field"><span>E-mail</span><input name="email" type="email" maxlength="200" value="${esc(c.email || '')}"></label>
          <label class="field"><span>NUIT do cliente</span><input name="nuit" maxlength="40" value="${esc(c.nuit || '')}"></label>
          <label class="field"><span>Vencimento</span><input name="due_date" type="date" min="${today()}" value="${esc(inv.due_date || '')}"></label>
          <label class="field span-2"><span>Morada</span><input name="address" maxlength="300" value="${esc(c.address || '')}"></label>
          <label class="field span-2"><span>Observações</span><textarea name="notes" rows="2" maxlength="1000">${esc(inv.notes || '')}</textarea></label></div>`,
        actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar', kind: 'primary', value: 'ok', submit: true,
          run: v => patch(`/admin/invoices/${inv.id}`, { billing: { name: v.name.trim(), email: v.email.trim(), nuit: v.nuit.trim() || null, address: v.address.trim() || null },
            notes: v.notes.trim() || null, due_date: v.due_date || null }) }],
      });
      if (r) { toast('Rascunho actualizado.'); load(); }
    });
  }
  let modalResult = null;
  await load();
}
