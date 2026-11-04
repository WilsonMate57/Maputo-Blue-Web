// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/index.js — Everything under /api/admin requires a staff account
// (role read from the database):
//   superadmin  everything, plus the team's accounts (team.js);
//   admin       everything except the team's accounts;
//   manager     only the routes in MANAGER_ROUTES: bookings, availability,
//               packages, invoices, customers, quotations, live chat and site
//               statistics.
//               Any route not listed there is refused, so new features stay closed to managers by default.
// ─────────────────────────────────────────────────────────────────────────────
import { requireStaff } from '../../lib/auth.js';
import { forbidden } from '../../lib/errors.js';
import bookings from './bookings.js';
import packages from './packages.js';
import availability from './availability.js';
import promotions from './promotions.js';
import requests from './requests.js';
import quotations from './quotations.js';
import customers from './customers.js';
import media from './media.js';
import system from './system.js';
import invoices from './invoices.js';
import team from './team.js';
import analytics from './analytics.js';
import chat from './chat.js';

// "METHOD /path" as declared in the route files (prefix /api/admin removed).
const MANAGER_ROUTES = [
  /^GET \/attention$/,
  /^(GET|POST|PATCH) \/bookings(\.csv|\/.*)?$/,
  /^POST \/mail\/:id\/retry$/,                         // resend a booking e-mail
  /^(GET|PUT) \/availability\/:id(\/days)?$/,
  /^GET \/categories$/,
  /^(GET|POST|PUT) \/packages(\/.*)?$/,
  /^(PUT|DELETE) \/rules\/:ruleId$/,
  /^GET \/media(\/folders)?$/, /^POST \/media\/upload$/, /^PATCH \/media$/,   // package photos
  /^(GET|POST|PATCH|DELETE) \/invoices(\.csv|\/.*)?$/,
  /^GET \/customers(\/:id)?$/, /^POST \/customers\/:id\/notes$/,
  /^(GET|POST) \/requests(\/.*)?$/, /^(GET|POST) \/quotes\/.*$/,
  /^(GET|POST|PATCH) \/quotations(\/.*)?$/, /^GET \/contacts$/,
  /^GET \/analytics(\/heatmap)?$/,
  /^(GET|POST|PATCH|DELETE) \/chat\/.*$/,
];

export function managerMayUse(method, url) {
  const key = `${method} ${url.replace(/^\/api\/admin/, '')}`;
  return MANAGER_ROUTES.some(re => re.test(key));
}

export default async function adminRoutes(app) {
  app.addHook('onRequest', requireStaff);
  app.addHook('onRequest', async req => {
    if (req.user.role === 'manager' && !managerMayUse(req.method, req.routeOptions.url || ''))
      throw forbidden('role_forbidden', 'Your account does not have access to this area');
  });
  await app.register(bookings);
  await app.register(packages);
  await app.register(availability);
  await app.register(promotions);
  await app.register(requests);
  await app.register(quotations);
  await app.register(customers);
  await app.register(media);
  await app.register(system);
  await app.register(invoices);
  await app.register(team);
  await app.register(analytics);
  await app.register(chat);
}
