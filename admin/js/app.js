// ─────────────────────────────────────────────────────────────────────────────
// app.js — Admin shell: authentication gate, hash router, sidebar badges.
// The server enforces the staff roles on every /api/admin call; this file only
// decides what to show: managers see bookings, availability, quotations, packages,
// invoices, customers, live chat and site statistics; only the super-administrator sees Team.
// ─────────────────────────────────────────────────────────────────────────────
import { $, $$, ApiError, errorText, get, post, setUnauthorizedHandler, toast } from './core.js';
import { startHub, stopHub } from './chat-hub.js';
import { startI18n } from './i18n.js';

const ROUTES = [
  { re: /^\/dashboard$/, key: 'dashboard', title: 'Visão geral', load: () => import('./views/dashboard.js') },
  { re: /^\/analytics$/, key: 'analytics', title: 'Estatísticas do site', load: () => import('./views/analytics.js') },
  { re: /^\/bookings$/, key: 'bookings', title: 'Reservas', load: () => import('./views/bookings.js') },
  { re: /^\/bookings\/([0-9a-f-]{36})$/, key: 'bookings', title: 'Reserva', load: () => import('./views/booking-detail.js') },
  { re: /^\/invoices$/, key: 'invoices', title: 'Facturas', load: () => import('./views/invoices.js') },
  { re: /^\/invoices\/new$/, key: 'invoices', title: 'Emitir factura', load: () => import('./views/invoice-new.js') },
  { re: /^\/invoices\/([0-9a-f-]{36})$/, key: 'invoices', title: 'Factura', load: () => import('./views/invoice-detail.js') },
  { re: /^\/calendar$/, key: 'calendar', title: 'Disponibilidade', load: () => import('./views/calendar.js') },
  { re: /^\/requests$/, key: 'requests', title: 'Pedidos de cotação', load: () => import('./views/requests.js') },
  { re: /^\/requests\/([0-9a-f-]{36})$/, key: 'requests', title: 'Pedido de cotação', load: () => import('./views/request-detail.js') },
  { re: /^\/chat$/, key: 'chat', title: 'Live Chat', load: () => import('./views/chat.js') },
  { re: /^\/chat\/([0-9a-f-]{36})$/, key: 'chat', title: 'Live Chat', load: () => import('./views/chat.js') },
  { re: /^\/quotations$/, key: 'quotations', title: 'Cotações e propostas', load: () => import('./views/quotations.js') },
  { re: /^\/quotations\/new$/, key: 'quotations', title: 'Nova cotação', load: () => import('./views/quotation-edit.js') },
  { re: /^\/quotations\/([0-9a-f-]{36})\/edit$/, key: 'quotations', title: 'Editar cotação', load: () => import('./views/quotation-edit.js') },
  { re: /^\/quotations\/([0-9a-f-]{36})$/, key: 'quotations', title: 'Cotação', load: () => import('./views/quotation-detail.js') },
  { re: /^\/packages$/, key: 'packages', title: 'Pacotes e alojamentos', load: () => import('./views/packages.js') },
  { re: /^\/packages\/(new|[a-z0-9-]+)$/, key: 'packages', title: 'Editar pacote', load: () => import('./views/package-edit.js') },
  { re: /^\/promotions$/, key: 'promotions', title: 'Promoções', load: () => import('./views/promotions.js') },
  { re: /^\/media$/, key: 'media', title: 'Imagens', load: () => import('./views/media.js') },
  { re: /^\/customers$/, key: 'customers', title: 'Clientes', load: () => import('./views/customers.js') },
  { re: /^\/customers\/([0-9a-f-]{36})$/, key: 'customers', title: 'Cliente', load: () => import('./views/customer-detail.js') },
  { re: /^\/reviews$/, key: 'reviews', title: 'Avaliações', load: () => import('./views/reviews.js') },
  { re: /^\/mail$/, key: 'mail', title: 'E-mails', load: () => import('./views/mail.js') },
  { re: /^\/settings$/, key: 'settings', title: 'Definições', load: () => import('./views/settings.js') },
  { re: /^\/audit$/, key: 'audit', title: 'Registo de actividade', load: () => import('./views/audit.js') },
  { re: /^\/team$/, key: 'team', title: 'Equipa', load: () => import('./views/team.js') },
];

const STAFF = ['manager', 'admin', 'superadmin'];
const MANAGER_AREAS = new Set(['bookings', 'calendar', 'requests', 'quotations', 'invoices', 'packages', 'customers', 'analytics', 'chat']);
const ROLE_NAMES = { superadmin: 'Superadministrador', admin: 'Administrador', manager: 'Gestor' };
const mayOpen = key => (key === 'team' ? user.role === 'superadmin' : user.role !== 'manager' || MANAGER_AREAS.has(key));
const home = () => (user.role === 'manager' ? '/bookings' : '/dashboard');

const main = $('#main');
let user = null;
let renderSeq = 0;

/* ── Auth gate ─────────────────────────────────────────────────────────── */
function showLogin(message, kind) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const alert = $('#login-form .alert');
  alert.classList.toggle('alert--success', kind === 'success');
  alert.hidden = !message;
  alert.textContent = message || '';
  $('#login-form [name=email]').focus();
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await post('/auth/login', { email: f.email.value.trim(), password: f.password.value });
    if (!STAFF.includes(r.user.role)) {
      await post('/auth/logout').catch(() => {});
      return showLogin('Esta conta não tem acesso de administrador.');
    }
    user = r.user;
    f.reset();
    start();
  } catch (err) {
    showLogin(err instanceof ApiError && err.code === 'invalid_credentials' ? 'E-mail ou palavra-passe incorrectos.' : errorText(err));
  } finally {
    btn.disabled = false;
  }
});

setUnauthorizedHandler(() => { user = null; stopHub(); showLogin('A sessão terminou. Inicie sessão novamente.'); });

$('#logout').addEventListener('click', async () => {
  stopHub();
  await post('/auth/logout').catch(() => {});
  user = null;
  showLogin();
});

/* ── Mobile sidebar ─────────────────────────────────────────────────────── */
const sidebar = $('#sidebar');
const backdrop = $('#sidebar-backdrop');
function setMenu(open) {
  sidebar.classList.toggle('is-open', open);
  backdrop.hidden = !open;
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}
$('#menu-toggle').addEventListener('click', () => setMenu(!sidebar.classList.contains('is-open')));
backdrop.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sidebar.classList.contains('is-open')) setMenu(false); });

/* ── Router ─────────────────────────────────────────────────────────────── */
async function render() {
  if (!user) return;
  const seq = ++renderSeq;
  const path = location.hash.replace(/^#/, '').split('?')[0];
  if (!path) { location.hash = '#' + home(); return; }
  const route = ROUTES.find(r => r.re.test(path));
  if (!route || !mayOpen(route.key)) { location.hash = '#' + home(); return; }
  const params = path.match(route.re).slice(1);
  $$('.sidebar__nav a').forEach(a => a.classList.toggle('is-active', a.dataset.route === route.key));
  $('#page-title').textContent = route.title;
  document.title = `${route.title} | Painel Maputo Blue`;
  setMenu(false);
  main.innerHTML = '<div class="card"><div class="card__body"><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:50%"></div></div></div>';
  // Each render gets its own container: a view still loading after the user
  // navigated away keeps writing into its detached container, never the new page.
  const view = document.createElement('div');
  try {
    const mod = await route.load();
    if (seq !== renderSeq) return;
    main.replaceChildren(view);
    await mod.default(view, params, {
      user,
      setTitle: t => { if (seq === renderSeq) { $('#page-title').textContent = t; document.title = `${t} | Painel Maputo Blue`; } },
      refreshBadges,
    });
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err instanceof ApiError && err.status === 401) return;
    main.innerHTML = `<div class="card"><div class="card__body"><p class="alert">${errorText(err)}</p></div></div>`;
    if (!(err instanceof ApiError)) console.error(err);
  }
  main.focus({ preventScroll: true });
}

async function refreshBadges() {
  try {
    const a = await get('/admin/attention');
    const set = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n; };
    set('#badge-pending', a.pending);
    set('#badge-requests', a.new_requests);
    set('#badge-quotes', a.quote_actions);
    set('#badge-mail', a.failed_mail);
    set('#badge-overdue', a.overdue_invoices);
    set('#badge-chat', a.chat_unread);
  } catch { /* badges are best-effort */ }
}

function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = user.name;
  $('#user-initials').textContent = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'MB';
  $('#user-role').textContent = ROLE_NAMES[user.role];
  // Show only the areas this role may open; hide group titles left empty.
  $$('.sidebar__nav a').forEach(a => { a.hidden = !mayOpen(a.dataset.route); });
  $$('.sidebar__nav .sidebar__group').forEach(g => {
    let el = g.nextElementSibling, any = false;
    while (el && !el.classList.contains('sidebar__group')) { if (!el.hidden) any = true; el = el.nextElementSibling; }
    g.hidden = !any;
  });
  render();
  refreshBadges();
  startHub({ refreshBadges, element: $('#chat-presence') });
}

/* ── Quick jump: MB-XXXX opens the booking, "FT 2026/0001" the invoice ── */
$('#gsearch').addEventListener('submit', async e => {
  e.preventDefault();
  const input = e.currentTarget.q;
  const q = input.value.trim();
  if (!q) return;
  try {
    if (/^[A-Za-z]{2}-[A-Za-z0-9]{4,10}$/.test(q)) {
      const r = await get('/admin/bookings?q=' + encodeURIComponent(q.toUpperCase()) + '&page_size=2');
      const hit = r.items.find(b => b.reference === q.toUpperCase());
      if (hit) { location.hash = `#/bookings/${hit.id}`; input.value = ''; return; }
    }
    const inv = await get('/admin/invoices?q=' + encodeURIComponent(q) + '&page_size=2');
    if (inv.items.length === 1) { location.hash = `#/invoices/${inv.items[0].id}`; input.value = ''; return; }
    location.hash = `#/bookings?q=${encodeURIComponent(q)}`;
    input.value = '';
  } catch (err) { toast(errorText(err), 'error'); }
});

window.addEventListener('hashchange', render);
setInterval(() => { if (user && document.visibilityState === 'visible') refreshBadges(); }, 60_000);

/* ── Invitation link (?invite=…): the new team member chooses a password ── */
function showInvite(token) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-form').hidden = true;
  const f = $('#invite-form');
  f.hidden = false;
  const alert = f.querySelector('.alert');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const problem = f.password.value.length < 10 ? 'A palavra-passe tem de ter pelo menos 10 caracteres.'
      : f.password.value !== f.confirm.value ? 'As duas palavras-passe não são iguais.' : '';
    alert.hidden = !problem;
    alert.textContent = problem;
    if (problem) return;
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await post('/auth/reset-password', { token, password: f.password.value });
      history.replaceState(null, '', location.pathname);
      f.hidden = true;
      $('#login-form').hidden = false;
      showLogin('Palavra-passe guardada. Já pode entrar com o seu e-mail.', 'success');
    } catch (err) {
      alert.hidden = false;
      alert.textContent = errorText(err);
    } finally {
      btn.disabled = false;
    }
  });
  f.password.focus();
}

(async function boot() {
  await startI18n();
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite) return showInvite(invite);
  try {
    const r = await get('/auth/me');
    if (r.user && STAFF.includes(r.user.role)) { user = r.user; start(); }
    else showLogin(r.user ? 'Esta conta não tem acesso de administrador.' : '');
  } catch (err) {
    showLogin(errorText(err));
    toast(errorText(err), 'error');
  }
})();
