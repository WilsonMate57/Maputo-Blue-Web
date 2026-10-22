/**
 * portal-ticket.js
 * Ticket page: ?ref=&token= (link from the e-mail / confirmation) or
 * ?id= (signed-in customer). Credentials never include personal data.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const API = window.MBApi;
  const root = document.getElementById('portal-root');
  if (!API || !root || !window.MBTicket) return;
  const EN = API.LANG === 'en';
  const page = `${API.ROOT}${EN ? 'en' : 'pages'}`;
  const p = new URLSearchParams(location.search);

  const fail = msg => {
    root.innerHTML = `<div class="mb-panel mb-panel--narrow"><p class="mb-alert" role="alert">${API.esc(msg)}</p>
      <p style="margin-top:14px;"><a class="mb-link" href="${page}/booking-status.html">${EN ? 'Look up a booking' : 'Consultar uma reserva'}</a></p></div>`;
  };

  (async function start() {
    if (!(await API.available())) return fail(API.errorText(new API.ApiError(0, 'network')));
    let source;
    if (p.get('id')) source = window.MBTicket.accountSource(p.get('id'));
    else if (p.get('ref') && p.get('token')) source = window.MBTicket.guestSource({ reference: p.get('ref').toUpperCase(), token: p.get('token') });
    else return fail(EN ? 'This ticket link is incomplete.' : 'O link deste ticket está incompleto.');
    root.innerHTML = '<div class="mb-panel"><div class="mb-skeleton-line"></div><div class="mb-skeleton-line" style="width:70%"></div></div>';
    try {
      const data = await source.load();
      document.title = `${data.ticket.doc_title} ${data.ticket.reference} | Maputo Blue`;
      window.MBTicket.render(root, data, source);
    } catch (err) {
      if (err.status === 401) {
        root.innerHTML = `<div class="mb-panel mb-panel--narrow"><p>${EN ? 'Please sign in to see this ticket.' : 'Inicie sessão para ver este ticket.'}</p>
          <a class="btn-primary-mb" href="${page}/account.html">${EN ? 'Sign in' : 'Entrar'}</a></div>`;
        return;
      }
      fail(API.errorText(err));
    }
  })();
})();
