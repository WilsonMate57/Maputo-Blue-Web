/**
 * portal-quote.js
 * Shows a proposal (link from the e-mail or WhatsApp, ?t=<token>) and lets the
 * customer accept it, decline it or ask for changes.
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
    title: 'Your personalised quotation', ref: 'Reference', issued: 'Issued', valid: 'Valid until', for: 'Prepared for',
    dest: 'Destination', dates: 'Dates', duration: 'Duration', group: 'Group', adults: 'adult(s)', children: 'child(ren)', days: 'day(s)', nights: 'night(s)', experience: 'Experience',
    services: 'Services', qty: 'Quantity', unit: 'Unit price', pax: 'participants', subtotal: 'Subtotal', discounts: 'Discounts', total: 'Total',
    payment: 'Payment terms', deposit: 'Deposit required', due: 'Payment deadline', incl: 'Included', excl: 'Not included', itinerary: 'Itinerary', notes: 'Notes',
    conditions: 'Commercial terms', cancel: 'Cancellation policy',
    accept: 'Accept proposal', decline: 'Decline', revise: 'Request changes',
    confirmAccept: 'Accept this proposal? Our team will confirm availability and contact you to finalise the booking and payment.',
    declineTitle: 'Decline this proposal', declineHint: 'Would you like to tell us why? (optional)', declineSend: 'Decline proposal',
    reviseTitle: 'What should we change?', reviseHint: 'Tell us what you would like to change.', reviseSend: 'Send request', cancelBtn: 'Back',
    pdf: 'Download PDF', notice: 'This proposal is not a confirmed booking or an invoice. Availability is confirmed by our team after your answer.',
    accepted: 'Thank you! You accepted this proposal. Our team will confirm availability and contact you shortly. Your booking is not confirmed yet.',
    converted: 'This proposal has become a booking. Our team has sent you the details.',
    declined: 'You declined this proposal. If you would like a different one, just reply to our e-mail.',
    revision: 'We received your request for changes. Our team will send you a new version. You can still accept this one while it is valid.',
    expired: 'This proposal has expired. Contact us for an updated one.', superseded: 'This version was replaced by a newer one. Please use the latest link we sent you.',
    withdrawn: 'This quotation is no longer valid.',
  } : {
    missing: 'O link da cotação está incompleto. Abra o link do seu e-mail.',
    title: 'A sua cotação personalizada', ref: 'Referência', issued: 'Emitida', valid: 'Válida até', for: 'Preparada para',
    dest: 'Destino', dates: 'Datas', duration: 'Duração', group: 'Grupo', adults: 'adulto(s)', children: 'criança(s)', days: 'dia(s)', nights: 'noite(s)', experience: 'Experiência',
    services: 'Serviços', qty: 'Quantidade', unit: 'Preço unitário', pax: 'participantes', subtotal: 'Subtotal', discounts: 'Descontos', total: 'Total',
    payment: 'Condições de pagamento', deposit: 'Depósito exigido', due: 'Prazo de pagamento', incl: 'Incluído', excl: 'Não incluído', itinerary: 'Itinerário', notes: 'Observações',
    conditions: 'Condições comerciais', cancel: 'Política de cancelamento',
    accept: 'Aceitar proposta', decline: 'Recusar', revise: 'Pedir alterações',
    confirmAccept: 'Aceitar esta proposta? A nossa equipa vai confirmar a disponibilidade e contactá-lo para finalizar a reserva e o pagamento.',
    declineTitle: 'Recusar esta proposta', declineHint: 'Quer dizer-nos o motivo? (opcional)', declineSend: 'Recusar proposta',
    reviseTitle: 'O que devemos alterar?', reviseHint: 'Diga-nos o que gostaria de mudar.', reviseSend: 'Enviar pedido', cancelBtn: 'Voltar',
    pdf: 'Descarregar PDF', notice: 'Esta proposta não é uma reserva confirmada nem uma factura. A disponibilidade é confirmada pela nossa equipa depois da sua resposta.',
    accepted: 'Obrigado! Aceitou esta proposta. A nossa equipa vai confirmar a disponibilidade e contactá-lo em breve. A reserva ainda não está confirmada.',
    converted: 'Esta proposta deu origem a uma reserva. A nossa equipa enviou-lhe os detalhes.',
    declined: 'Recusou esta proposta. Se quiser uma proposta diferente, basta responder ao nosso e-mail.',
    revision: 'Recebemos o seu pedido de alterações. A nossa equipa vai enviar-lhe uma nova versão. Enquanto for válida, ainda pode aceitar esta.',
    expired: 'Esta proposta expirou. Contacte-nos para uma proposta actualizada.', superseded: 'Esta versão foi substituída por uma mais recente. Use o último link que lhe enviámos.',
    withdrawn: 'Esta cotação já não é válida.',
  };

  const token = new URLSearchParams(location.search).get('t');
  const period = (a, b) => (a ? `${esc(API.date(a))}${b && b !== a ? ` → ${esc(API.date(b))}` : ''}` : '');
  const fact = (k, v) => (v ? `<div class="mb-proposal__fact"><span>${k}</span><strong>${v}</strong></div>` : '');
  const section = (title, body) => (body ? `<section class="mb-proposal__section"><h3>${title}</h3>${body}</section>` : '');
  const para = s => (s ? `<p>${esc(s)}</p>` : '');

  function render(q, msg = '') {
    const trip = q.trip || {};
    const duration = [trip.days ? `${trip.days} ${T.days}` : '', trip.nights ? `${trip.nights} ${T.nights}` : ''].filter(Boolean).join(' · ');
    const group = trip.adults || trip.children ? `${trip.adults || 0} ${T.adults}${trip.children ? `, ${trip.children} ${T.children}` : ''}` : '';
    const lines = q.items.map(i => {
      const meta = [period(i.date_from, i.date_to), i.participants ? `${i.participants} ${T.pax}` : ''].filter(Boolean).join(' · ');
      return `<li class="mb-proposal__line">
        <div><strong>${esc(i.description)}</strong>${meta ? `<small>${meta}</small>` : ''}${i.details ? `<small>${esc(i.details)}</small>` : ''}
          <small>${T.qty}: ${i.quantity} · ${T.unit}: ${money(i.unit_price, q.currency)}${i.discount_amount ? ` · − ${money(i.discount_amount, q.currency)}` : ''}</small></div>
        <span>${money(i.amount, q.currency)}</span></li>`;
    }).join('');
    const open = ['sent', 'viewed', 'revision_requested'].includes(q.status);
    const state = { accepted: T.accepted, converted: T.converted, declined: T.declined, revision_requested: T.revision, expired: T.expired, superseded: T.superseded }[q.status];
    const good = q.status === 'accepted' || q.status === 'converted';
    const payment = [para(q.payment_terms), q.deposit_percent ? `<p><strong>${T.deposit}:</strong> ${Number(q.deposit_percent)}%</p>` : '', q.payment_due ? `<p><strong>${T.due}:</strong> ${esc(q.payment_due)}</p>` : ''].join('');
    const itinerary = (q.itinerary || []).map(s => `<div class="mb-proposal__step"><strong>${esc(s.title || '')}</strong>${para(s.description)}</div>`).join('');
    root.innerHTML = `
      <div class="mb-panel mb-proposal">
        <div class="mb-proposal__head">
          <div><h2>${T.title}</h2>
            <p class="mb-booking-item__meta">${T.ref} <strong>${esc(q.reference)}</strong>${q.issued_at ? ` · ${T.issued} ${esc(API.date(q.issued_at.slice(0, 10)))}` : ''} · ${T.valid} ${esc(API.date(q.valid_until))}</p></div>
          <span class="mb-status mb-status--${q.status}">${API.statusLabel(q.status)}</span>
        </div>
        ${state ? `<p class="mb-alert mb-alert--${good ? 'success' : 'info'}">${state}</p>` : ''}
        ${msg}
        ${para(q.message)}
        <div class="mb-proposal__facts">
          ${fact(T.for, esc(q.customer.company || q.customer.name))}
          ${fact(T.dest, esc(trip.destination || ''))}
          ${fact(T.dates, period(trip.date_from, trip.date_to))}
          ${fact(T.duration, duration)}
          ${fact(T.group, group)}
          ${fact(T.experience, esc(trip.experience || ''))}
        </div>
        ${section(T.services, `<ul class="mb-proposal__lines">${lines}</ul>`)}
        <dl class="mb-proposal__totals">
          <div><dt>${T.subtotal}</dt><dd>${money(q.subtotal, q.currency)}</dd></div>
          ${q.discount_total ? `<div class="is-discount"><dt>${T.discounts}</dt><dd>− ${money(q.discount_total, q.currency)}</dd></div>` : ''}
          ${(q.fees || []).map(f => `<div><dt>${esc(f.label)}</dt><dd>${money(f.amount, q.currency)}</dd></div>`).join('')}
          <div class="is-total"><dt>${T.total}</dt><dd>${money(q.total, q.currency)}</dd></div>
        </dl>
        ${section(T.payment, payment)}
        ${section(T.incl, para(q.inclusions))}
        ${section(T.excl, para(q.exclusions))}
        ${section(T.itinerary, itinerary)}
        ${section(T.notes, para(trip.customer_notes))}
        ${section(T.conditions, para(q.special_conditions))}
        ${section(T.cancel, para(q.cancellation_terms))}
        ${open ? `<div class="mb-form-actions">
          <button type="button" class="btn-primary-mb" data-decision="accept"><i class='bx bx-check'></i>${T.accept}</button>
          <button type="button" class="btn-outline-mb" data-open="revision">${T.revise}</button>
          <button type="button" class="btn-outline-mb" data-open="decline">${T.decline}</button></div>
        <form class="mb-proposal__answer" data-form hidden>
          <label class="mb-field mb-field--full"><span data-form-title></span><small data-form-hint></small>
            <textarea class="booking-input" name="message" rows="3" maxlength="3000"></textarea></label>
          <div class="mb-form-actions"><button type="submit" class="btn-primary-mb" data-form-send></button>
            <button type="button" class="btn-outline-mb" data-form-back>${T.cancelBtn}</button></div>
        </form>` : ''}
        <p class="mb-proposal__foot"><a class="mb-link" href="/api/quotes/${encodeURIComponent(token)}/pdf" download><i class='bx bx-download'></i> ${T.pdf}</a></p>
        <p class="mb-proposal__notice">${T.notice}</p>
        ${q.issuer ? `<p class="mb-proposal__notice">${[q.issuer.name, q.issuer.phone, q.issuer.email, q.issuer.website].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      </div>`;

    const answer = async (decision, message) => {
      root.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try { render(await API.post(`/quotes/${encodeURIComponent(token)}/respond`, { decision, ...(message ? { message } : {}) })); }
      catch (err) { render(q, `<p class="mb-alert" role="alert">${esc(API.errorText(err))}</p>`); }
    };
    root.querySelector('[data-decision]')?.addEventListener('click', () => { if (confirm(T.confirmAccept)) answer('accept'); });

    const form = root.querySelector('[data-form]');
    if (!form) return;
    let decision = null;
    root.querySelectorAll('[data-open]').forEach(btn => btn.addEventListener('click', () => {
      decision = btn.dataset.open;
      const rev = decision === 'revision';
      form.querySelector('[data-form-title]').textContent = rev ? T.reviseTitle : T.declineTitle;
      form.querySelector('[data-form-hint]').textContent = rev ? T.reviseHint : T.declineHint;
      form.querySelector('[data-form-send]').textContent = rev ? T.reviseSend : T.declineSend;
      form.message.required = rev;
      form.hidden = false;
      form.message.focus();
    }));
    form.querySelector('[data-form-back]').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const message = form.message.value.trim();
      if (decision === 'revision' && !message) { form.message.focus(); return; }
      answer(decision, message);
    });
  }

  (async function start() {
    if (!token) { root.innerHTML = `<p class="mb-alert" role="alert">${T.missing}</p>`; return; }
    root.innerHTML = '<div class="mb-panel"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:70%"></div></div>';
    try { render(await API.get(`/quotes/${encodeURIComponent(token)}`)); }
    catch (err) { root.innerHTML = `<p class="mb-alert" role="alert">${esc(err.status === 404 ? T.withdrawn : API.errorText(err))}</p>`; }
  })();
})();
