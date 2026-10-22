// Payment dialogs shared by the booking and invoice screens. Money is only
// recorded after the administrator ticks "I verified the money was received";
// each opened dialog carries its own idempotency key, so a double click or a
// retried request never records the same payment twice.
import { METHODS, PAY_KINDS, dateTime, date, esc, modal, money, today } from './core.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * @param {object} o  { currency, total, paid, send: body => Promise, allowRefund }
 * Resolves with the server response or null when cancelled.
 */
export async function paymentDialog({ currency, total, paid, send, allowRefund = true, title = 'Registar pagamento' }) {
  const outstanding = Math.max(0, Math.round((total - paid) * 100) / 100);
  const key = newKey();
  let result = null;
  const r = await modal({
    title,
    body: `
      ${allowRefund ? `<div class="seg" role="group" aria-label="Tipo de movimento" style="margin-bottom:14px;">
        <button type="button" data-kind="payment" aria-pressed="true"><i class='bx bx-down-arrow-circle'></i>Pagamento recebido</button>
        <button type="button" data-kind="refund" aria-pressed="false" ${paid > 0 ? '' : 'disabled'}><i class='bx bx-up-arrow-circle'></i>Reembolso ao cliente</button>
      </div>` : ''}
      <input type="hidden" name="kind" value="payment">
      <div class="money" style="margin-bottom:16px;">
        <div><div class="money__k">Total</div><div class="money__v">${money(total, currency)}</div></div>
        <div><div class="money__k">Pago</div><div class="money__v">${money(paid, currency)}</div></div>
        <div><div class="money__k">Em dívida</div><div class="money__v ${outstanding ? 'money__v--due' : 'money__v--ok'}">${money(outstanding, currency)}</div></div>
      </div>
      <div class="grid grid--2">
        <label class="field"><span>Valor (${esc(currency)})</span><input name="amount" type="number" min="0.01" step="0.01" required value="${outstanding || ''}" inputmode="decimal">
          <span class="field__hint" data-hint>Máximo: ${money(outstanding, currency)}</span></label>
        <label class="field"><span>Método</span><select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="field"><span>Data do pagamento</span><input name="payment_date" type="date" required max="${today()}" value="${today()}"></label>
        <label class="field"><span>Referência da transacção <small>(recomendado)</small></span><input name="reference" maxlength="120" placeholder="Ex.: ID M-Pesa, nº do talão"></label>
        <label class="field span-2"><span>Nota <small>(opcional)</small></span><input name="note" maxlength="500"></label>
      </div>
      <label class="check check--card" style="margin-top:14px;"><input type="checkbox" name="verified">
        <span><strong data-verify-title>Confirmo que verifiquei que o dinheiro foi recebido</strong>
        <span class="t-sub" data-verify-sub>Por exemplo no extracto bancário ou na conta M-Pesa/e-Mola. Sem esta confirmação nada é registado.</span></span></label>`,
    onOpen(dlg) {
      const kindInput = dlg.querySelector('[name=kind]');
      const amount = dlg.querySelector('[name=amount]');
      const hint = dlg.querySelector('[data-hint]');
      dlg.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
        dlg.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        kindInput.value = b.dataset.kind;
        const refund = b.dataset.kind === 'refund';
        amount.value = refund ? '' : outstanding || '';
        hint.textContent = refund ? `Máximo: ${money(paid, currency)} (valor já pago)` : `Máximo: ${money(outstanding, currency)}`;
        dlg.querySelector('[data-verify-title]').textContent = refund ? 'Confirmo que o reembolso foi efectivamente pago ao cliente' : 'Confirmo que verifiquei que o dinheiro foi recebido';
      }));
    },
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Registar', kind: 'primary', value: 'ok', submit: true,
      validate: v => {
        const max = v.kind === 'refund' ? paid : outstanding;
        if (!(v.amount > 0)) return 'Indique um valor maior que zero.';
        if (Math.round(v.amount * 100) > Math.round(max * 100)) return `O valor máximo é ${money(max, currency)}.`;
        if (!v.verified) return 'Confirme a verificação do dinheiro antes de registar.';
        return null;
      },
      run: async v => {
        result = await send({ kind: v.kind, amount: v.amount, method: v.method, payment_date: v.payment_date,
          reference: v.reference.trim() || undefined, note: v.note.trim() || undefined, verified: true, idempotency_key: key });
      },
    }],
  });
  return r ? result : null;
}

/** Reverse one earlier payment (bounced transfer, entry recorded by mistake). */
export async function reversalDialog({ payment, currency, send }) {
  let result = null;
  const r = await modal({
    title: 'Estornar pagamento',
    body: `<p>O pagamento de <strong>${money(payment.amount, currency)}</strong> (${esc(METHODS[payment.method] || payment.method)}${payment.reference ? ` · ${esc(payment.reference)}` : ''}, ${date(payment.payment_date)}) deixa de contar como recebido.
      O registo original mantém-se no histórico.</p>
      <label class="field" style="margin-top:12px;"><span>Motivo</span><input name="note" required maxlength="500" placeholder="Ex.: transferência devolvida pelo banco"></label>
      <label class="check check--card" style="margin-top:12px;"><input type="checkbox" name="verified"><span><strong>Confirmo que este valor não foi recebido ou foi devolvido</strong></span></label>`,
    actions: [{ label: 'Cancelar', value: null }, {
      label: 'Estornar', kind: 'danger-solid', value: 'ok', submit: true,
      validate: v => (!v.note.trim() ? 'Indique o motivo.' : !v.verified ? 'Confirme antes de estornar.' : null),
      run: async v => { result = await send({ kind: 'reversal', reverses_payment_id: payment.id, note: v.note.trim(), verified: true, idempotency_key: newKey() }); },
    }],
  });
  return r ? result : null;
}

/** Payment rows (payments, refunds, reversals) with an optional reverse button. */
export function paymentList(payments, currency, { reversible = false } = {}) {
  if (!payments.length) return '<p class="muted small" style="margin:14px 0 0;">Nenhum pagamento registado. Os pagamentos só contam depois de verificados e registados aqui.</p>';
  return `<ul class="pay-list">${payments.map(p => {
    const out = p.amount < 0;
    return `<li class="${p.reversed ? 'is-reversed' : ''}">
      <span class="pay-list__ic ${out ? 'pay-list__ic--out' : ''}"><i class='bx ${p.kind === 'payment' ? 'bx-down-arrow-alt' : p.kind === 'refund' ? 'bx-up-arrow-alt' : 'bx-undo'}'></i></span>
      <span><span class="t-strong">${esc(PAY_KINDS[p.kind] || p.kind)} · ${esc(METHODS[p.method] || p.method)}</span>
        <span class="t-sub">${date(p.payment_date)}${p.reference ? ` · ${esc(p.reference)}` : ''}${p.recorded_by_name ? ` · registado por ${esc(p.recorded_by_name)}` : ''}</span>
        ${p.note ? `<span class="t-sub">${esc(p.note)}</span>` : ''}
        ${p.reversed ? '<span class="t-sub" style="color:var(--danger)">Estornado</span>' : ''}
        ${p.verified_at ? `<span class="t-sub" title="Verificado em ${esc(dateTime(p.verified_at))}"><i class='bx bx-check-shield' style="color:var(--success)"></i> verificado</span>` : ''}</span>
      <span style="text-align:right;"><span class="pay-list__amt">${out ? '− ' : ''}${money(Math.abs(p.amount), currency)}</span>
        ${reversible && p.kind === 'payment' && !p.reversed ? `<br><button type="button" class="link small" data-reverse="${p.id}">Estornar</button>` : ''}</span>
    </li>`;
  }).join('')}</ul>`;
}
