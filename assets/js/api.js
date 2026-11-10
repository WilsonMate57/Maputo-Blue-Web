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
      invalid_phone: 'Indique um telemóvel válido, com o indicativo do país (ex.: +258 84 123 4567).',
      payment_pending: 'A viagem ainda não está paga na totalidade.',
      unauthenticated: 'A sua sessão terminou. Inicie sessão novamente.',
      quote_expired: 'Esta cotação expirou.',
      message_required: 'Diga-nos o que gostaria de alterar.',
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
      invalid_phone: 'Enter a valid mobile number with its country code (e.g. +27 82 555 1234).',
      payment_pending: 'The trip is not paid in full yet.',
      unauthenticated: 'Your session has ended. Please sign in again.',
      quote_expired: 'This quotation has expired.',
      message_required: 'Tell us what you would like to change.',
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
          sent: 'Por responder', viewed: 'Por responder', declined: 'Recusada', expired: 'Expirada',
          revision_requested: 'Alteração pedida', converted: 'Convertida em reserva', superseded: 'Substituída',
          unpaid: 'Por pagar', partial: 'Pago parcialmente', paid: 'Pago', refunded: 'Reembolsado', awaiting_payment: 'Data disponível — a aguardar pagamento',
          partially_paid: 'Parcialmente paga', overdue: 'Vencida', issued: 'Emitida' },
    en: { pending: 'Pending', confirmed: 'Confirmed', rejected: 'Rejected', cancelled: 'Cancelled', completed: 'Completed',
          new: 'New', under_review: 'Under review', quote_sent: 'Quotation sent', accepted: 'Accepted', closed: 'Closed',
          sent: 'Awaiting your answer', viewed: 'Awaiting your answer', declined: 'Declined', expired: 'Expired',
          revision_requested: 'Changes requested', converted: 'Became a booking', superseded: 'Replaced',
          unpaid: 'Unpaid', awaiting_payment: 'Date available — awaiting payment', partial: 'Partially paid', paid: 'Paid', refunded: 'Refunded',
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

  /* ── Phone numbers: country code + mobile, the same rules as the server (lib/phone.js) ── */
  const DIAL = [['258', 'Moçambique', 'Mozambique'], ['27', 'África do Sul', 'South Africa'], ['268', 'Eswatini', 'Eswatini'],
    ['263', 'Zimbabué', 'Zimbabwe'], ['265', 'Malawi', 'Malawi'], ['255', 'Tanzânia', 'Tanzania'], ['351', 'Portugal', 'Portugal'],
    ['55', 'Brasil', 'Brazil'], ['44', 'Reino Unido', 'United Kingdom'], ['49', 'Alemanha', 'Germany'], ['33', 'França', 'France'],
    ['31', 'Países Baixos', 'Netherlands'], ['39', 'Itália', 'Italy'], ['34', 'Espanha', 'Spain'], ['1', 'EUA / Canadá', 'USA / Canada'],
    ['', 'Outro país', 'Other country']];
  const PT = {
    pt: { code: 'Indicativo', hint: 'Telemóvel. Usamos este número para combinar a viagem consigo.', other: 'Escreva o número com o indicativo, ex.: +44 7700 900123',
      wa: 'Este número tem WhatsApp', waOther: 'Número de WhatsApp (opcional)', waHint: 'Se tiver WhatsApp noutro número, indique-o aqui, com o indicativo.' },
    en: { code: 'Country code', hint: 'Mobile number. We use it to arrange the trip with you.', other: 'Type the number with its country code, e.g. +44 7700 900123',
      wa: 'This number has WhatsApp', waOther: 'WhatsApp number (optional)', waHint: 'If you use WhatsApp on another number, enter it here with its country code.' },
  };
  /** "+…", "00…" or a local Mozambican mobile → "+<digits>", else null. */
  function fullPhone(raw) {
    const s = String(raw || '').replace(/[\s().-]/g, '');
    let d = /^\+\d+$/.test(s) ? s.slice(1) : /^00\d+$/.test(s) ? s.slice(2) : /^8[2-7]\d{7}$/.test(s) ? '258' + s : null;
    if (!d) return null;
    if (d.startsWith('258')) return /^2588[2-7]\d{7}$/.test(d) ? '+' + d : null;
    return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null;
  }
  function phoneField({ name = 'phone', label, value = '', whatsapp = false }) {
    const t = PT[LANG];
    const v = String(value || '').replace(/[\s().-]/g, '');
    const code = (v.startsWith('+') && DIAL.map(x => x[0]).filter(Boolean).sort((a, b) => b.length - a.length).find(c => v.startsWith('+' + c))) || (v ? '' : '258');
    const local = code ? v.slice(code.length + 1) : value;
    return `<div class="mb-field mb-field--full mb-phone" data-phone="${name}"><span>${label} *</span>
      <div class="mb-phone__row">
        <select class="booking-input" name="${name}_cc" aria-label="${t.code}">${DIAL.map(([c, pt, en]) => `<option value="${c}"${c === code ? ' selected' : ''}>${esc(LANG === 'en' ? en : pt)}${c ? ` +${c}` : ''}</option>`).join('')}</select>
        <input class="booking-input" name="${name}" type="tel" inputmode="tel" required maxlength="30" autocomplete="tel" value="${esc(local)}" placeholder="${code === '258' ? '84 123 4567' : ''}" aria-describedby="${name}-hint">
      </div>
      <small id="${name}-hint" data-hint>${code ? t.hint : t.other}</small></div>
      ${whatsapp ? `<label class="booking-check mb-field--full"><input type="checkbox" name="${name}_wa" checked><span>${t.wa}</span></label>
      <label class="mb-field mb-field--full" data-wa-other hidden><span>${t.waOther}</span><input class="booking-input" name="${name}_wa_number" type="tel" inputmode="tel" maxlength="30" placeholder="+258 84 123 4567"><small>${t.waHint}</small></label>` : ''}`;
  }
  function wirePhone(form, name = 'phone') {
    const cc = form.elements[`${name}_cc`], input = form.elements[name], hint = form.querySelector(`[data-phone="${name}"] [data-hint]`);
    const sync = () => { hint.textContent = cc.value ? PT[LANG].hint : PT[LANG].other; input.placeholder = cc.value === '258' ? '84 123 4567' : cc.value ? '' : '+44 7700 900123'; };
    cc.addEventListener('change', sync);
    const wa = form.elements[`${name}_wa`];
    if (wa) wa.addEventListener('change', () => { form.querySelector('[data-wa-other]').hidden = wa.checked; });
  }
  /** { phone, has_whatsapp, whatsapp } in international form, or { error: field name }. */
  function readPhone(form, name = 'phone') {
    const cc = form.elements[`${name}_cc`].value;
    const raw = form.elements[name].value.trim();
    const local = raw.replace(/[\s().-]/g, '').replace(/^0+(?=\d)/, '');
    const phone = cc && !/^(\+|00)/.test(raw) ? fullPhone(`+${cc}${local}`) : fullPhone(raw);
    if (!phone) return { error: name };
    const wa = form.elements[`${name}_wa`];
    if (!wa) return { phone };
    if (wa.checked) return { phone, has_whatsapp: true };
    const other = form.elements[`${name}_wa_number`].value.trim();
    if (!other) return { phone, has_whatsapp: false };
    const whatsapp = fullPhone(other);
    return whatsapp ? { phone, has_whatsapp: false, whatsapp } : { error: `${name}_wa_number` };
  }

  window.MBApi = {
    LANG, ROOT, ApiError, available, idempotencyKey, esc, money, date, statusLabel, downloadPdf, phoneField, wirePhone, readPhone,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b === undefined ? {} : b, o),
    patch: (p, b, o) => request('PATCH', p, b, o),
    errorText: err => (err instanceof ApiError ? err.friendly : ERRORS[LANG].internal),
  };
})();
