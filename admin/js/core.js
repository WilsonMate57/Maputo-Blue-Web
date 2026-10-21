// ─────────────────────────────────────────────────────────────────────────────
// core.js — API client, formatting, escaping and UI primitives (toasts,
// modal dialogs, confirmations, pagination) shared by every admin view.
// ─────────────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}

const ERR = {
  unauthenticated: 'A sessão terminou. Inicie sessão novamente.',
  admin_only: 'Esta conta não tem acesso de administrador.',
  network: 'Sem ligação ao servidor.',
  version_conflict: 'Outra pessoa alterou este registo. Recarregue a página e tente de novo.',
  insufficient_capacity: 'Não há capacidade suficiente nessa data.',
  date_unavailable: 'Essa data está fechada.',
  invalid_transition: 'Esta mudança de estado não é permitida.',
  availability_conflict: 'Há reservas confirmadas nos dias escolhidos.',
  file_in_use: 'Esta imagem ainda é usada por um pacote.',
  protected_file: 'As imagens originais do site não podem ser apagadas aqui.',
  rate_limited: 'Demasiados pedidos. Aguarde um momento.',
  internal: 'Erro inesperado no servidor.',
};

export function errorText(err) {
  if (!(err instanceof ApiError)) return ERR.internal;
  const base = ERR[err.code] || err.message || ERR.internal;
  const det = Array.isArray(err.details) && err.details.length && typeof err.details[0] === 'string' ? `: ${err.details.join('; ')}` : '';
  return base + det;
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, path, body, { raw = false } = {}) {
  let res;
  const isForm = body instanceof FormData;
  try {
    res = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', ERR.network);
  }
  if (raw && res.ok) return res;
  const data = (res.headers.get('content-type') || '').includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, (data && data.error) || 'internal', (data && data.message) || res.statusText, data && data.details);
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    throw err;
  }
  return data;
}
export const get = p => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = p => api('DELETE', p);

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

/* ── Formatting ─────────────────────────────────────────────────────────── */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, cur = 'MZN') => (n === null || n === undefined ? '—' : `${cur} ${Number(n).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}`);
export const date = d => {
  if (!d) return '—';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return dt.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const dateTime = d => (d ? new Date(d).toLocaleString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo' }).format(new Date());
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export const LABELS = {
  pending: 'Pendente', confirmed: 'Confirmada', rejected: 'Rejeitada', cancelled: 'Cancelada', completed: 'Concluída',
  unpaid: 'Por pagar', partial: 'Parcial', paid: 'Pago', refunded: 'Reembolsado',
  new: 'Novo', under_review: 'Em análise', quote_sent: 'Cotação enviada', accepted: 'Aceite', closed: 'Fechado',
  draft: 'Rascunho', sent: 'Enviada', declined: 'Recusada', expired: 'Expirada', withdrawn: 'Retirada',
  published: 'Publicado', archived: 'Arquivado', hidden: 'Oculta', queued: 'Em fila', sending: 'A enviar', failed: 'Falhou',
  tour: 'Tour', accommodation: 'Alojamento', admin: 'Administrador', customer: 'Cliente',
  per_person: 'Por pessoa', per_group: 'Por grupo / barco', per_night: 'Por noite',
  open: 'Aberto', limited: 'Limitado', full: 'Esgotado',
};
export const label = s => LABELS[s] || s;
export const badge = s => `<span class="badge badge--${esc(s)}">${esc(label(s))}</span>`;

export const CATEGORY_LABELS = {
  'island-daytrips': 'Passeios às ilhas', 'beach-daytrips': 'Praia / sunset', safaris: 'Safaris', transfers: 'Transfers',
  'maputo-city-tour': 'City tour Maputo', 'whale-watching': 'Observação de baleias', 'fishing-charters': 'Pesca desportiva',
  inhaca: 'Inhaca', machangulo: 'Machangulo',
};

/* ── DOM helpers ────────────────────────────────────────────────────────── */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function html(strings, ...vals) { return strings.reduce((out, s, i) => out + s + (i < vals.length ? vals[i] : ''), ''); }
export const skeleton = (n = 4) => `<div class="card"><div class="card__body">${'<div class="skeleton"></div>'.repeat(n)}</div></div>`;
export const emptyState = (icon, text) => `<div class="empty"><i class='bx ${icon}'></i><p>${esc(text)}</p></div>`;

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' toast--error' : ''}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class='bx ${kind === 'error' ? 'bx-error-circle' : 'bx-check-circle'}'></i><span>${esc(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
}

/** Run an async action with a busy button and error toast. Returns the result or undefined. */
export async function busy(btn, fn, success) {
  if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i>${esc(btn.textContent.trim())}`; }
  try {
    const r = await fn();
    if (success) toast(success);
    return r;
  } catch (err) {
    toast(errorText(err), 'error');
    throw err;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.html; }
  }
}

/**
 * Open a modal dialog. `body` is HTML; `actions` = [{label, kind, value}].
 * Resolves with the clicked action value (and form values when a <form> is present) or null.
 */
export function modal({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal${wide ? ' modal--wide' : ''}`;
    dlg.setAttribute('aria-labelledby', 'modal-title');
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <div class="modal__head"><h2 id="modal-title">${esc(title)}</h2>
          <button type="button" class="icon-btn" data-x aria-label="Fechar"><i class='bx bx-x'></i></button></div>
        <div class="modal__body">${body}</div>
        <div class="modal__foot">${actions.map((a, i) => `<button type="${a.submit ? 'submit' : 'button'}" class="btn btn--${a.kind || 'ghost'}" data-i="${i}">${a.label}</button>`).join('')}</div>
      </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let result = null;
    const finish = v => { result = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.querySelector('[data-x]').addEventListener('click', () => finish(null));
    dlg.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', async e => {
      e.preventDefault();
      const a = actions[Number(b.dataset.i)];
      if (a.value === null || a.value === undefined) return finish(null);
      const values = formValues(form);
      if (a.validate) {
        const problem = a.validate(values, form);
        let alertEl = form.querySelector('.alert[data-modal-alert]');
        if (problem) {
          if (!alertEl) { alertEl = document.createElement('p'); alertEl.className = 'alert'; alertEl.dataset.modalAlert = ''; form.querySelector('.modal__body').appendChild(alertEl); }
          alertEl.textContent = problem;
          return;
        }
      }
      if (a.run) {
        try { await busy(b, () => a.run(values, form)); } catch { return; }
      }
      finish({ action: a.value, values });
    }));
    form.addEventListener('submit', e => { e.preventDefault(); const sb = dlg.querySelector('button[type=submit]'); if (sb) sb.click(); });
    dlg.showModal();
    if (onOpen) onOpen(dlg);
    const first = dlg.querySelector('.modal__body input:not([type=hidden]), .modal__body select, .modal__body textarea');
    (first || dlg.querySelector('[data-i]')).focus();
  });
}

/** Confirmation dialog for consequential actions. */
export async function confirmAction({ title, text, confirm = 'Confirmar', kind = 'primary', extra = '' }) {
  const r = await modal({ title, body: `<p>${text}</p>${extra}`, actions: [{ label: 'Cancelar', value: null }, { label: confirm, kind, value: 'ok', submit: true }] });
  return r && r.action === 'ok' ? r.values : null;
}

export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') {
      if (el.dataset.multi !== undefined) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); }
      else out[el.name] = el.checked;
    } else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

export function pager(total, page, pageSize, onPage) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const el = document.createElement('div');
  el.className = 'pager';
  el.innerHTML = `<span class="muted">${total} registo(s) · página ${page} de ${pages}</span>
    <div class="page-head__actions">
      <button type="button" class="btn btn--ghost btn--sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}><i class='bx bx-chevron-left'></i>Anterior</button>
      <button type="button" class="btn btn--ghost btn--sm" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>Seguinte<i class='bx bx-chevron-right'></i></button>
    </div>`;
  el.querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
  return el;
}

/** Make table rows with data-href clickable and keyboard accessible. */
export function linkRows(root) {
  root.querySelectorAll('tr[data-href]').forEach(tr => {
    tr.classList.add('is-clickable');
    tr.tabIndex = 0;
    const go = () => { location.hash = tr.dataset.href; };
    tr.addEventListener('click', e => { if (!e.target.closest('a, button, input, select')) go(); });
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Query string inside the hash, e.g. #/bookings?status=pending */
export const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');

/** Replace the hash query without re-rendering the view. */
export function setHashQuery(obj) {
  const base = location.hash.split('?')[0] || '#/';
  const q = qs(obj);
  history.replaceState(null, '', base + q);
}
