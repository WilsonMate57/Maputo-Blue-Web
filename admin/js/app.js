// ─────────────────────────────────────────────────────────────────────────────
// app.js — Admin shell: authentication gate, hash router, sidebar badges.
// The server enforces the admin role on every /api/admin call; this file only
// decides what to show.
// ─────────────────────────────────────────────────────────────────────────────
import { $, $$, ApiError, errorText, get, post, setUnauthorizedHandler, toast } from './core.js';

const ROUTES = [
  { re: /^\/dashboard$/, key: 'dashboard', title: 'Visão geral', load: () => import('./views/dashboard.js') },
  { re: /^\/bookings$/, key: 'bookings', title: 'Reservas', load: () => import('./views/bookings.js') },
  { re: /^\/bookings\/([0-9a-f-]{36})$/, key: 'bookings', title: 'Reserva', load: () => import('./views/booking-detail.js') },
  { re: /^\/calendar$/, key: 'calendar', title: 'Disponibilidade', load: () => import('./views/calendar.js') },
  { re: /^\/requests$/, key: 'requests', title: 'Pedidos personalizados', load: () => import('./views/requests.js') },
  { re: /^\/requests\/([0-9a-f-]{36})$/, key: 'requests', title: 'Pedido personalizado', load: () => import('./views/request-detail.js') },
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
];

const main = $('#main');
let user = null;
let renderSeq = 0;

/* ── Auth gate ─────────────────────────────────────────────────────────── */
function showLogin(message) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const alert = $('#login-form .alert');
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
    if (r.user.role !== 'admin') {
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

setUnauthorizedHandler(() => { user = null; showLogin('A sessão terminou. Inicie sessão novamente.'); });

$('#logout').addEventListener('click', async () => {
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
  const path = (location.hash.replace(/^#/, '') || '/dashboard').split('?')[0];
  const route = ROUTES.find(r => r.re.test(path));
  if (!route) { location.hash = '#/dashboard'; return; }
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
    const d = await get('/admin/dashboard');
    const set = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n; };
    set('#badge-pending', d.attention.pending);
    set('#badge-requests', d.attention.new_requests);
    set('#badge-mail', d.attention.failed_mail);
  } catch { /* badges are best-effort */ }
}

function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#user-name').textContent = user.name;
  render();
  refreshBadges();
}

window.addEventListener('hashchange', render);
setInterval(() => { if (user && document.visibilityState === 'visible') refreshBadges(); }, 60_000);

(async function boot() {
  try {
    const r = await get('/auth/me');
    if (r.user && r.user.role === 'admin') { user = r.user; start(); }
    else showLogin(r.user ? 'Esta conta não tem acesso de administrador.' : '');
  } catch (err) {
    showLogin(errorText(err));
    toast(errorText(err), 'error');
  }
})();
