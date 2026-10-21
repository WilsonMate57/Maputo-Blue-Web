// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/index.js — Everything under /api/admin requires an
// authenticated user whose role (read from the database) is 'admin'.
// ─────────────────────────────────────────────────────────────────────────────
import { requireAdmin } from '../../lib/auth.js';
import bookings from './bookings.js';
import packages from './packages.js';
import availability from './availability.js';
import promotions from './promotions.js';
import requests from './requests.js';
import customers from './customers.js';
import media from './media.js';
import system from './system.js';

export default async function adminRoutes(app) {
  app.addHook('onRequest', requireAdmin);
  await app.register(bookings);
  await app.register(packages);
  await app.register(availability);
  await app.register(promotions);
  await app.register(requests);
  await app.register(customers);
  await app.register(media);
  await app.register(system);
}
