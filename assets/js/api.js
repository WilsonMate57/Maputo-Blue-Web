/**
 * api.js
 * Small client for the Maputo Blue backend (/api). Exposes window.MBApi.
 * Every call degrades gracefully: when the API is unreachable (e.g. the site
 * is served as static files) callers fall back to the original behaviour.
 *
 * @copyright  2026 Maputo Blue. All rights reserved.
 * @author     Wilson Creative Studio
 * @license    Proprietary — Unauthorised use or distribution is prohibited.
 */
(function () {
  'use strict';

  const LANG = document.documentElement.lang.startsWith('en') ? 'en' : 'pt';
  const BASE = '/api';

  /** Human messages for the stable error codes returned by the server. */
  const ERRORS = {
    pt: {
      network: 'Sem ligação ao servidor. Verifique a sua internet e tente novamente.',
      timeout: 'O servidor demorou demasiado a responder. Tente novamente.',
      validation: 'Verifique os campos assinalados.',
      rate_limited: 'Demasiadas tentativas. Aguarde alguns minutos e tente de novo.',
      date_unavailable: 'A data escolhida não está disponível. Escolha outra data.',
      insufficient_capacity: 'Não há lugares suficientes nesta data. Reduza o número de pessoas ou escolha outra data.',
      invalid_selection: 'A selecção não é válida para este pacote.',
      invalid_date: 'Escolha uma data válida.',
      package_not_found: 'Este pacote já não está disponível.',
      booking_not_found: 'Não encontrámos nenhuma reserva com estes dados.',
      consent_required: 'Aceite a política de privacidade para continuar.',
      invalid_credentials: 'E-mail ou palavra-passe incorrectos.',
      email_taken: 'Já existe uma conta com este e-mail.',
      password_too_short: 'A palavra-passe deve ter pelo menos 10 caracteres.',
      invalid_token: 'Este link é inválido ou expirou.',
      unauthenticated: 'A sua sessão terminou. Inicie sessão novamente.',
      quote_expired: 'Esta cotação expirou.',
      quote_closed: 'Esta cotação já foi respondida.',
      internal: 'Ocorreu um erro inesperado. Tente novamente.',
    },
    en: {
      network: 'Cannot reach the server. Check your connection and try again.',
      timeout: 'The server took too long to respond. Please try again.',
      validation: 'Please check the highlighted fields.',
      rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
      date_unavailable: 'The selected date is not available. Please choose another date.',
      insufficient_capacity: 'Not enough places on this date. Reduce the number of guests or choose another date.',
      invalid_selection: 'This selection is not valid for this package.',
      invalid_date: 'Please choose a valid date.',
      package_not_found: 'This package is no longer available.',
      booking_not_found: 'We could not find a booking with these details.',
      consent_required: 'Please accept the privacy policy to continue.',
      invalid_credentials: 'E-mail or password is incorrect.',
      email_taken: 'An account with this e-mail already exists.',
      password_too_short: 'The password must be at least 10 characters long.',
      invalid_token: 'This link is invalid or has expired.',
      unauthenticated: 'Your session has ended. Please sign in again.',
      quote_expired: 'This quotation has expired.',
      quote_closed: 'This quotation has already been answered.',
      internal: 'An unexpected error occurred. Please try again.',
    },
  };

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status; this.code = code; this.details = details;
    }
    get friendly() { return (ERRORS[LANG][this.code]) || this.message || ERRORS[LANG].internal; }
  }

  async function request(method, path, body, { timeout = 15000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new ApiError(0, err.name === 'AbortError' ? 'timeout' : 'network', ERRORS[LANG].network);
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(res.status, (data && data.error) || 'internal', (data && data.message) || res.statusText, data && data.details);
    }
    return data;
  }

  let healthPromise = null;
  /** Is the backend reachable? (cached per page load) */
  function available() {
    if (!healthPromise) {
      healthPromise = request('GET', '/health', undefined, { timeout: 4000 }).then(() => true).catch(() => false);
    }
    return healthPromise;
  }

  /** Random key so a retried submission is never stored twice. */
  function idempotencyKey() {
    const a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function money(amount, currency) {
    if (amount === null || amount === undefined) return '—';
    return `${currency || 'MZN'} ${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  }

  function date(d, opts) {
    if (!d) return '';
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
    return dt.toLocaleDateString(LANG === 'en' ? 'en-GB' : 'pt-PT', opts || { day: '2-digit', month: 'long', year: 'numeric' });
  }

  const STATUS = {
    pt: { pending: 'Pendente', confirmed: 'Confirmada', rejected: 'Rejeitada', cancelled: 'Cancelada', completed: 'Concluída',
          new: 'Novo', under_review: 'Em análise', quote_sent: 'Cotação enviada', accepted: 'Aceite', closed: 'Fechado',
          unpaid: 'Por pagar', partial: 'Pago parcialmente', paid: 'Pago', refunded: 'Reembolsado',
          partially_paid: 'Parcialmente paga', overdue: 'Vencida', issued: 'Emitida' },
    en: { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed',
          new: 'New', under_review: 'Under review', quote_sent: 'Quotation sent', accepted: 'Accepted', closed: 'Closed',
          unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', refunded: 'Refunded',
          partially_paid: 'Partially paid', overdue: 'Overdue', issued: 'Issued' },
  };
  const statusLabel = s => STATUS[LANG][s] || s;

  /** POST credentials, receive a PDF and save it (no secret ever goes in a URL). */
  async function downloadPdf(path, body, filename) {
    const res = await fetch(BASE + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, (data && data.error) || 'internal', (data && data.message) || res.statusText);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Path prefix from the current page to the site root ('' or '../'). */
  const ROOT = /\/(pages|en)\//.test(location.pathname) ? '../' : '';

  window.MBApi = {
    LANG, ROOT, ApiError, available, idempotencyKey, esc, money, date, statusLabel, downloadPdf,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b === undefined ? {} : b, o),
    patch: (p, b, o) => request('PATCH', p, b, o),
    errorText: err => (err instanceof ApiError ? err.friendly : ERRORS[LANG].internal),
  };
})();
