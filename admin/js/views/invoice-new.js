// Issue an invoice from a booking reference:
//   1. find the booking (authoritative data from the server)
//   2. review everything that will be printed, billing details, payments
//   3. issue (number allocated by the server) or save a draft
import { $, METHODS, ApiError, badge, busy, confirmAction, date, dateTime, errorText, esc, formValues, get, hashQuery, money, post, today } from '../core.js';
import { invoiceDoc } from '../invoice-doc.js';
import { paymentList } from '../payments-ui.js';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default async function invoiceNew(main) {
  const initial = hashQuery().get('ref') || '';
  main.innerHTML = `
    <a class="back" href="#/invoices"><i class='bx bx-arrow-back'></i>Facturas</a>
    <div class="page-head"><div><span class="eyebrow">Finanças</span><h2>Emitir factura</h2>
      <p class="page-head__sub">Localize a reserva pela referência, confirme os dados e emita. A emissão e o registo de pagamentos são operações separadas.</p></div></div>
    <ol class="steps" id="steps"><li class="is-current">Reserva</li><li>Rever</li><li>Emitir</li></ol>
    <div class="card" style="margin-bottom:20px;"><div class="card__body">
      <form class="lookup" id="lookup" novalidate>
        <label class="field"><span>Referência da reserva</span><input name="reference" required placeholder="MB-XXXXXX" maxlength="20" autocomplete="off" value="${esc(initial)}" spellcheck="false"></label>
        <button type="submit" class="btn btn--secondary" style="min-height:52px;"><i class='bx bx-search'></i>Procurar reserva</button>
      </form>
      <p class="alert" id="lookup-error" role="alert" hidden></p>
    </div></div>
    <div id="review"></div>`;

  const steps = n => $('#steps', main).querySelectorAll('li').forEach((li, i) => {
    li.classList.toggle('is-current', i === n); li.classList.toggle('is-done', i < n);
  });
  const review = $('#review', main);
  const err = $('#lookup-error', main);

  $('#lookup', main).addEventListener('submit', async e => {
    e.preventDefault();
    const ref = e.currentTarget.reference.value.trim().toUpperCase();
    err.hidden = true;
    review.innerHTML = '';
    steps(0);
    if (!/^[A-Z]{2}-[A-Z0-9]{4,10}$/.test(ref)) { err.hidden = false; err.textContent = 'Indique uma referência válida, por exemplo MB-7UWSVJ.'; return; }
    try {
      const d = await busy(e.currentTarget.querySelector('button'), () => get(`/admin/invoices/lookup?reference=${encodeURIComponent(ref)}`));
      render(d);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex instanceof ApiError && ex.status === 404 ? `Não existe nenhuma reserva com a referência ${ref}.` : errorText(ex);
    }
  });

  function render(d) {
    const b = d.booking, p = d.preview;
    if (d.existing_invoice) {
      const x = d.existing_invoice;
      steps(1);
      review.innerHTML = `<div class="card"><div class="card__body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;justify-content:space-between;">
        <div><span class="eyebrow">${x.doc_status === 'draft' ? 'Rascunho existente' : 'Factura já emitida'}</span>
          <h3 style="font-size:20px;margin-top:4px;">${esc(x.number || 'Rascunho')} ${badge(x.display_status)}</h3>
          <p class="muted" style="margin:4px 0 0;">A reserva ${esc(b.reference)} já tem ${x.doc_status === 'draft' ? 'um rascunho' : 'uma factura'} — não é criada outra. ${money(x.total, b.currency)} · pago ${money(x.amount_paid, b.currency)}</p></div>
        <a class="btn btn--secondary" href="#/invoices/${x.id}"><i class='bx bx-right-arrow-alt'></i>Abrir ${x.doc_status === 'draft' ? 'rascunho' : 'factura'}</a></div></div>`;
      return;
    }
    steps(1);
    const blocked = p.problems.length > 0;
    review.innerHTML = `
      <div class="cols">
        <div class="stack">
          ${blocked ? `<p class="alert" style="margin:0;"><i class='bx bx-block'></i>${p.problems.map(x => errorText(new ApiError(409, x))).join(' ')}</p>` : ''}
          <div id="doc">${invoiceDoc({ ...p, number: null }, { paid: p.amount_paid })}</div>
          <div class="card"><div class="card__head"><h2>Reserva ${esc(b.reference)}</h2><a class="link small" href="#/bookings/${b.id}">Abrir reserva</a></div>
            <div class="card__body"><dl class="dl">
              <div><dt>Estado da reserva</dt><dd>${badge(b.status)}</dd></div>
              <div><dt>Pagamento</dt><dd>${badge(b.payment_status)}</dd></div>
              <div><dt>Criada em</dt><dd>${dateTime(b.created_at)}</dd></div>
              <div><dt>Data do serviço</dt><dd>${date(b.start_date)}${b.end_date !== b.start_date ? ` → ${date(b.end_date)}` : ''}</dd></div>
              <div><dt>Participantes</dt><dd>${b.adults} adulto(s)${b.children ? `, ${b.children} criança(s)` : ''}</dd></div>
              <div><dt>Moeda</dt><dd>${esc(b.currency)}</dd></div>
            </dl>
            ${b.manual_total ? `<p class="alert alert--info"><i class='bx bx-info-circle'></i>Total acordado manualmente: ${esc(b.manual_total.reason || '')}. A diferença aparece como “Ajuste de preço acordado”.</p>` : ''}
            <h3 style="font-size:14px;margin:18px 0 0;">Pagamentos já registados</h3>
            ${paymentList(d.payments, b.currency)}
            ${d.previous_invoices.length ? `<p class="muted small" style="margin:12px 0 0;">Facturas anuladas desta reserva: ${d.previous_invoices.map(i => `<a class="link" href="#/invoices/${i.id}">${esc(i.number)}</a>`).join(', ')}</p>` : ''}
          </div></div>
        </div>

        <form class="card" id="issue-form" novalidate style="position:sticky;top:calc(var(--topbar-h) + 16px);">
          <div class="card__head"><h2>Dados da factura</h2></div>
          <div class="card__body">
            <div class="grid">
              <label class="field"><span>Nome de facturação</span><input name="name" required maxlength="160" value="${esc(p.customer.name)}"></label>
              <label class="field"><span>E-mail</span><input name="email" type="email" required maxlength="200" value="${esc(p.customer.email)}"></label>
              <label class="field"><span>NUIT do cliente <small>(se o cliente pedir)</small></span><input name="nuit" maxlength="40" inputmode="numeric"></label>
              <label class="field"><span>Morada de facturação <small>(opcional)</small></span><input name="address" maxlength="300"></label>
              <label class="field"><span>Data de vencimento</span><input name="due_date" type="date" min="${today()}" value="${p.due_date}"></label>
              <label class="field"><span>Observações <small>(impressas)</small></span><textarea name="notes" rows="2" maxlength="1000"></textarea></label>
            </div>
            <hr style="border:0;border-top:1px solid var(--border);margin:18px 0 14px;">
            <label class="check"><input type="checkbox" name="with_payment"${p.balance > 0 ? '' : ' disabled'}> O cliente já pagou — registar o pagamento verificado</label>
            <div id="pay-fields" hidden style="margin-top:12px;">
              <div class="grid grid--2">
                <label class="field"><span>Valor (${esc(b.currency)})</span><input name="amount" type="number" min="0.01" step="0.01" value="${p.balance}" max="${p.balance}"></label>
                <label class="field"><span>Método</span><select name="method">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
                <label class="field"><span>Data</span><input name="payment_date" type="date" max="${today()}" value="${today()}"></label>
                <label class="field"><span>Ref. transacção</span><input name="reference" maxlength="120"></label>
              </div>
              <label class="check check--card" style="margin-top:12px;"><input type="checkbox" name="verified"><span><strong>Confirmo que verifiquei que o dinheiro foi recebido</strong>
                <span class="t-sub">Sem esta confirmação a factura não é emitida com o pagamento.</span></span></label>
            </div>
            <label class="check" style="margin-top:14px;"><input type="checkbox" name="send_email" checked> Enviar a factura por e-mail a ${esc(p.customer.email)}</label>
            <p class="alert" data-form-error role="alert" hidden></p>
            <div class="form-actions" style="justify-content:space-between;">
              <button type="button" class="btn btn--ghost" data-draft ${blocked ? 'disabled' : ''}><i class='bx bx-save'></i>Guardar rascunho</button>
              <button type="submit" class="btn btn--primary" ${blocked ? 'disabled' : ''}><i class='bx bx-check-circle'></i>Emitir factura</button>
            </div>
            <p class="muted small" style="margin:12px 0 0;">Ao emitir, o servidor atribui o número seguinte da série (${esc(p.issuer.name || '')}). Uma factura emitida não pode ser alterada — correcções fazem-se por anulação e nova emissão.</p>
          </div>
        </form>
      </div>`;

    const form = $('#issue-form', review);
    const errBox = form.querySelector('[data-form-error]');
    const payFields = $('#pay-fields', form);
    form.with_payment.addEventListener('change', () => { payFields.hidden = !form.with_payment.checked; });
    const key = newKey();

    const body = issue => {
      const v = formValues(form);
      const out = {
        booking_reference: b.reference, issue,
        billing: { name: v.name.trim(), email: v.email.trim(), nuit: v.nuit.trim() || null, address: v.address.trim() || null },
        notes: v.notes.trim() || null, due_date: v.due_date || null,
      };
      if (issue) out.send_email = !!v.send_email;
      if (issue && v.with_payment) {
        out.payment = { amount: v.amount, method: v.method, payment_date: v.payment_date, reference: v.reference.trim() || undefined, verified: !!v.verified, idempotency_key: key };
      }
      return out;
    };
    const problem = issue => {
      const v = formValues(form);
      if (!v.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) return 'Indique o nome e um e-mail de facturação válido.';
      if (issue && v.with_payment) {
        if (!(v.amount > 0) || Math.round(v.amount * 100) > Math.round(p.balance * 100)) return `O valor do pagamento deve estar entre 0,01 e ${money(p.balance, b.currency)}.`;
        if (!v.verified) return 'Confirme que verificou a recepção do dinheiro, ou desmarque o pagamento.';
      }
      return null;
    };
    const fail = ex => { errBox.hidden = false; errBox.textContent = errorText(ex); };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errBox.hidden = true;
      const pr = problem(true);
      if (pr) { errBox.hidden = false; errBox.textContent = pr; return; }
      const data = body(true);
      const paidAfter = Math.round(p.amount_paid * 100) + (data.payment ? Math.round(data.payment.amount * 100) : 0);
      const after = paidAfter <= 0 ? 'unpaid' : paidAfter >= Math.round(p.total * 100) ? 'paid' : 'partially_paid';
      const ok = await confirmAction({
        title: 'Emitir factura', confirm: 'Emitir factura', kind: 'primary',
        text: `Vai ser emitida uma factura de <strong>${money(p.total, b.currency)}</strong> para <strong>${esc(data.billing.name)}</strong> (reserva ${esc(b.reference)}).`,
        extra: `<ul class="list-plain" style="margin-top:10px;">
          <li><span>Estado de pagamento após emissão</span><span>${badge(after)}</span></li>
          <li><span>E-mail ao cliente</span><span>${data.send_email ? 'Sim' : 'Não'}</span></li></ul>
          <p class="muted small" style="margin:10px 0 0;">O número é atribuído agora e não pode ser reutilizado.</p>`,
      });
      if (!ok) return;
      steps(2);
      try {
        const inv = await busy(form.querySelector('[type=submit]'), () => post('/admin/invoices', data), 'Factura emitida.');
        location.hash = `#/invoices/${inv.id}`;
      } catch (ex) { steps(1); fail(ex); }
    });
    form.querySelector('[data-draft]').addEventListener('click', async ev => {
      errBox.hidden = true;
      const pr = problem(false);
      if (pr) { errBox.hidden = false; errBox.textContent = pr; return; }
      try {
        const inv = await busy(ev.currentTarget, () => post('/admin/invoices', body(false)), 'Rascunho guardado.');
        location.hash = `#/invoices/${inv.id}`;
      } catch (ex) { fail(ex); }
    });
  }

  if (initial) $('#lookup', main).requestSubmit();
  else $('#lookup [name=reference]', main).focus();
}
