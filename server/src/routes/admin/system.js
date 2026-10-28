// ─────────────────────────────────────────────────────────────────────────────
// routes/admin/system.js — Settings (booking, loyalty, notifications),
// e-mail delivery log with retry, and the audit log.
// ─────────────────────────────────────────────────────────────────────────────
import { getSetting } from '../../lib/catalog.js';
import { retryMail } from '../../lib/mailer.js';
import { enqueueAdminWhatsApp, normalizePhone, retryWhatsApp, whatsappConfigured } from '../../lib/whatsapp.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { CATEGORIES } from './packages.js';

const uuid = { type: 'string', pattern: '^[0-9a-f-]{36}$' };
const email = { type: 'string', maxLength: 200, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$' };

const str = n => ({ type: 'string', maxLength: n });
const SETTING_SCHEMAS = {
  company: { type: 'object', properties: {
    trade_name: str(120), legal_name: str(160), phone: str(40), whatsapp: str(40), email: str(200),
    website: str(200), address: str(300), nuit: str(40), licence: str(80) } },
  booking: { type: 'object', properties: {
    pending_holds_capacity: { type: 'boolean' },
    pending_hold_hours: { type: 'integer', minimum: 1, maximum: 720 },
    auto_complete: { type: 'boolean' },
    min_lead_hours: { type: 'integer', minimum: 0, maximum: 720 },
    max_advance_days: { type: 'integer', minimum: 1, maximum: 1095 } } },
  loyalty: { type: 'object', properties: {
    enabled: { type: 'boolean' },
    min_completed_bookings: { type: 'integer', minimum: 1, maximum: 100 },
    window_months: { type: ['integer', 'null'], minimum: 1, maximum: 120 },
    kind: { type: 'string', enum: ['percent', 'fixed'] },
    value: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    max_discount: { type: ['number', 'null'], minimum: 0, maximum: 1e9 },
    categories: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, maxItems: 20 },
    combinable_with_promotions: { type: 'boolean' },
    require_verified_email: { type: 'boolean' } } },
  invoicing: { type: 'object', properties: {
    series_prefix: { type: 'string', pattern: '^[A-Z]{1,6}$' },
    due_days: { type: 'integer', minimum: 0, maximum: 365 },
    issuer: { type: 'object', properties: {
      name: str(160), legal_name: str(200), address: str(400), phone: str(60), email: str(200), nuit: str(40), website: str(200) } },
    tax: { type: 'object', properties: {
      enabled: { type: 'boolean' }, label: str(20), rate: { type: ['number', 'null'], minimum: 0, maximum: 100 }, mode: { type: 'string', enum: ['inclusive'] } } },
    payment_instructions: str(1500), payment_instructions_en: str(1500), footer_note: str(300), footer_note_en: str(300) } },
  notifications: { type: 'object', properties: {
    admin_emails: { type: 'array', items: email, maxItems: 10 },
    admin_whatsapp: { type: 'array', items: { type: 'string', maxLength: 25 }, maxItems: 5 },
    reminder_days_before: { type: 'integer', minimum: 0, maximum: 30 } } },
};

export default async function systemRoutes(app) {
  const { pool, cfg } = app;

  app.get('/settings', async () => ({
    booking: await getSetting(pool, 'booking'),
    loyalty: await getSetting(pool, 'loyalty'),
    notifications: await getSetting(pool, 'notifications'),
    company: await getSetting(pool, 'company'),
    invoicing: await getSetting(pool, 'invoicing'),
    mail_configured: !!cfg.mail.resendApiKey,
    mail_from: cfg.mail.from,
    whatsapp_configured: whatsappConfigured(cfg),
    whatsapp_template: `${cfg.whatsapp.template} (${cfg.whatsapp.language})`,
  }));

  for (const key of Object.keys(SETTING_SCHEMAS)) {
    app.put(`/settings/${key}`, { schema: { body: SETTING_SCHEMAS[key] } }, async req => {
      const prev = await getSetting(pool, key);
      const next = { ...prev, ...req.body };
      if (key === 'invoicing') {
        // Nested groups are merged so a partial form never wipes the issuer details
        next.issuer = { ...(prev.issuer || {}), ...(req.body.issuer || {}) };
        next.tax = { ...(prev.tax || {}), ...(req.body.tax || {}) };
        if (next.tax.enabled && !(Number(next.tax.rate) > 0)) throw badRequest('invalid_setting', 'Set the tax rate before enabling tax');
      }
      if (key === 'loyalty') {
        if (next.kind === 'percent' && next.value > 100) throw badRequest('invalid_setting', 'Percentage cannot exceed 100');
        const all = [...CATEGORIES.tour, ...CATEGORIES.accommodation];
        if (next.categories && next.categories.some(c => !all.includes(c))) throw badRequest('invalid_setting', 'Unknown category');
        if (next.categories && !next.categories.length) next.categories = null;
      }
      if (key === 'notifications' && req.body.admin_whatsapp) {
        const phones = req.body.admin_whatsapp.map(p => [p, normalizePhone(p)]);
        const bad = phones.filter(([, n]) => !n).map(([p]) => p);
        if (bad.length) throw badRequest('invalid_setting', `Invalid WhatsApp number (use international format, e.g. +258 84 123 4567): ${bad.join(', ')}`);
        next.admin_whatsapp = [...new Set(phones.map(([, n]) => `+${n}`))];
      }
      const { rows: [before] } = await pool.query('select value from settings where key = $1', [key]);
      await pool.query(
        `insert into settings (key, value, updated_by, updated_at) values ($1,$2,$3, now())
         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [key, next, req.user.id]);
      await audit(pool, req.user, 'settings', key, 'updated', { before: before ? before.value : null, after: next });
      return next;
    });
  }

  app.get('/mail', {
    schema: { querystring: { type: 'object', properties: { status: { type: 'string', enum: ['queued', 'sending', 'sent', 'failed'] },
      page: { type: 'string', pattern: '^\\d{1,5}$' } } } },
  }, async req => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const params = req.query.status ? [req.query.status] : [];
    const where = req.query.status ? 'where status = $1' : '';
    const [{ rows }, { rows: [{ n }] }] = await Promise.all([
      pool.query(`select id, template, to_email, locale, status, attempts, last_error, next_attempt_at, sent_at, created_at
                    from mail_outbox ${where} order by created_at desc limit 30 offset ${(page - 1) * 30}`, params),
      pool.query(`select count(*)::int n from mail_outbox ${where}`, params),
    ]);
    return { items: rows, total: n, page, page_size: 30 };
  });

  app.post('/mail/:id/retry', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    if (!(await retryMail(pool, req.params.id))) throw notFound('mail_not_found', 'E-mail not found or already sent');
    await audit(pool, req.user, 'mail', req.params.id, 'retry');
    return { ok: true };
  });

  app.get('/whatsapp', async () => {
    const { rows } = await pool.query(
      `select id, template, to_phone, status, attempts, last_error, sent_at, created_at
         from whatsapp_outbox order by created_at desc limit 20`);
    return { items: rows };
  });

  app.post('/whatsapp/test', async req => {
    const n = await enqueueAdminWhatsApp(pool, { key: `test:${Date.now()}`, template: 'test',
      data: { admin_url: `${cfg.publicBaseUrl}/admin/` } });
    if (!n) throw badRequest('no_whatsapp_numbers', 'Add at least one WhatsApp number in Notifications first');
    await audit(pool, req.user, 'whatsapp', 'test', 'queued', { recipients: n });
    return { queued: n };
  });

  app.post('/whatsapp/:id/retry', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async req => {
    if (!(await retryWhatsApp(pool, req.params.id))) throw notFound('whatsapp_not_found', 'Message not found or already sent');
    await audit(pool, req.user, 'whatsapp', req.params.id, 'retry');
    return { ok: true };
  });

  app.get('/audit', {
    schema: { querystring: { type: 'object', properties: { entity_type: { type: 'string', maxLength: 40 }, entity_id: { type: 'string', maxLength: 100 },
      page: { type: 'string', pattern: '^\\d{1,5}$' } } } },
  }, async req => {
    const params = [], where = [];
    if (req.query.entity_type) { params.push(req.query.entity_type); where.push(`a.entity_type = $${params.length}`); }
    if (req.query.entity_id) { params.push(req.query.entity_id); where.push(`a.entity_id = $${params.length}`); }
    const sql = where.length ? 'where ' + where.join(' and ') : '';
    const page = Math.max(Number(req.query.page || 1), 1);
    const { rows } = await pool.query(
      `select a.id, a.at, a.actor_type, u.name as actor_name, a.entity_type, a.entity_id, a.action, a.data
         from audit_log a left join users u on u.id = a.actor_id ${sql} order by a.at desc limit 50 offset ${(page - 1) * 50}`, params);
    return { items: rows, page };
  });
}
