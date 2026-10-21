/**
 * portal-quote.js
 * Shows a custom-tour quotation (link from the e-mail, ?t=<token>) and lets
 * the customer accept or decline it.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const API = window.MBApi;
  const root = document.getElementById('portal-root');
  if (!API || !root) return;
  const { LANG, esc, money } = API;
  const EN = LANG === 'en';

  const T = EN ? {
    missing: 'This quotation link is incomplete. Please open the link from your e-mail.',
    title: 'Your personalised quotation', ref: 'Request', valid: 'Valid until', item: 'Item', qty: 'Qty', price: 'Price', amount: 'Amount',
    total: 'Total', incl: 'Included', excl: 'Not included', accept: 'Accept quotation', decline: 'Decline',
    confirmAccept: 'Accept this quotation? Our team will contact you to finalise the booking and payment.',
    confirmDecline: 'Decline this quotation?',
    accepted: 'Thank you! You accepted this quotation. Our team will contact you shortly to finalise everything.',
    declined: 'You declined this quotation. If you would like a different proposal, just reply to our e-mail.',
    expired: 'This quotation has expired. Contact us for an updated proposal.', withdrawn: 'This quotation is no longer valid.',
  } : {
    missing: 'O link da cotação está incompleto. Abra o link do seu e-mail.',
    title: 'A sua cotação personalizada', ref: 'Pedido', valid: 'Válida até', item: 'Item', qty: 'Qtd.', price: 'Preço', amount: 'Valor',
    total: 'Total', incl: 'Incluído', excl: 'Não incluído', accept: 'Aceitar cotação', decline: 'Recusar',
    confirmAccept: 'Aceitar esta cotação? A nossa equipa vai contactá-lo para finalizar a reserva e o pagamento.',
    confirmDecline: 'Recusar esta cotação?',
    accepted: 'Obrigado! Aceitou esta cotação. A nossa equipa vai contactá-lo em breve para finalizar tudo.',
    declined: 'Recusou esta cotação. Se quiser uma proposta diferente, basta responder ao nosso e-mail.',
    expired: 'Esta cotação expirou. Contacte-nos para uma proposta actualizada.', withdrawn: 'Esta cotação já não é válida.',
  };

  const token = new URLSearchParams(location.search).get('t');

  function render(q, msg = '') {
    const rows = q.items.map(i => `<tr><td>${esc(i.description)}</td><td>${i.quantity}</td><td>${money(i.unit_price, q.currency)}</td><td>${money(i.quantity * i.unit_price, q.currency)}</td></tr>`).join('');
    const state = { accepted: T.accepted, declined: T.declined, expired: T.expired }[q.status];
    root.innerHTML = `
      <div class="mb-panel" style="max-width:760px;margin-inline:auto;">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:center;">
          <div><h2 style="margin:0;">${T.title}</h2><p class="mb-booking-item__meta" style="margin:4px 0 0;">${T.ref} ${esc(q.reference)} · ${T.valid} ${esc(API.date(q.valid_until))}</p></div>
          <span class="mb-status mb-status--${q.status}">${API.statusLabel(q.status === 'sent' ? 'pending' : q.status)}</span>
        </div>
        ${q.message ? `<p style="margin:18px 0 0;">${esc(q.message)}</p>` : ''}
        <div style="overflow-x:auto;">
          <table class="mb-quote-table">
            <thead><tr><th>${T.item}</th><th>${T.qty}</th><th>${T.price}</th><th>${T.amount}</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td colspan="3">${T.total}</td><td>${money(q.total, q.currency)}</td></tr></tfoot>
          </table>
        </div>
        ${q.inclusions ? `<p><strong>${T.incl}:</strong> ${esc(q.inclusions)}</p>` : ''}
        ${q.exclusions ? `<p><strong>${T.excl}:</strong> ${esc(q.exclusions)}</p>` : ''}
        ${msg}
        ${state ? `<p class="mb-alert mb-alert--${q.status === 'accepted' ? 'success' : 'info'}">${state}</p>` : ''}
        ${q.status === 'sent' ? `<div class="mb-form-actions">
          <button type="button" class="btn-primary-mb" data-decision="accept"><i class='bx bx-check'></i>${T.accept}</button>
          <button type="button" class="btn-outline-mb" data-decision="decline">${T.decline}</button></div>` : ''}
      </div>`;
    root.querySelectorAll('[data-decision]').forEach(btn => btn.addEventListener('click', async () => {
      const accept = btn.dataset.decision === 'accept';
      if (!confirm(accept ? T.confirmAccept : T.confirmDecline)) return;
      root.querySelectorAll('[data-decision]').forEach(b => { b.disabled = true; });
      try { render(await API.post(`/quotes/${encodeURIComponent(token)}/respond`, { decision: btn.dataset.decision })); }
      catch (err) { render(q, `<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`); }
    }));
  }

  (async function start() {
    if (!token) { root.innerHTML = `<p class="mb-alert" role="alert">${T.missing}</p>`; return; }
    root.innerHTML = '<div class="mb-panel"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:70%"></div></div>';
    try { render(await API.get(`/quotes/${encodeURIComponent(token)}`)); }
    catch (err) { root.innerHTML = `<p class="mb-alert" role="alert">${esc(err.status === 404 ? T.withdrawn : API.errorText(err))}</p>`; }
  })();
})();
