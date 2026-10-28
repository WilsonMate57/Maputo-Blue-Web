// ─────────────────────────────────────────────────────────────────────────────
// index.js — Production entry point: migrations, HTTP server, background jobs.
// ─────────────────────────────────────────────────────────────────────────────
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { processOutbox, resendTransport } from './lib/mailer.js';
import { runBookingMaintenance } from './lib/bookings.js';
import { ticketAttachments } from './lib/tickets.js';
import { invoiceAttachments } from './lib/invoices.js';
import { cloudApiTransport, processWhatsAppOutbox, whatsappConfigured } from './lib/whatsapp.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await migrate(pool);

const transport = resendTransport(cfg.mail);
const app = await buildApp({ cfg, pool, mailTransport: transport, logger: { level: cfg.env === 'production' ? 'info' : 'warn' } });
await app.listen(typeof cfg.port === 'number' ? { port: cfg.port, host: cfg.host } : { path: cfg.port });
console.log(`\n  ✦ Maputo Blue server  ➜  ${typeof cfg.port === 'number' ? `http://${cfg.host}:${cfg.port}` : cfg.port}  (${cfg.env})`);
if (!cfg.mail.resendApiKey) console.log('  ! RESEND_API_KEY not set — e-mails stay in the outbox as "failed" until configured.');
if (!whatsappConfigured(cfg)) console.log('  · WhatsApp alerts off (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set).');

const timers = [];
if (cfg.jobs) {
  let mailBusy = false, maintBusy = false;
  const tickets = ticketAttachments(pool, cfg), invoices = invoiceAttachments(pool, cfg);
  const mailAttachments = async job => [...await tickets(job), ...await invoices(job)];
  timers.push(setInterval(async () => {
    if (mailBusy) return; mailBusy = true;
    try { await processOutbox(pool, transport, { log: m => app.log.warn(m), attachments: mailAttachments }); } catch (e) { app.log.error(e); } finally { mailBusy = false; }
  }, 20_000));
  let waBusy = false;
  const waTransport = cloudApiTransport(cfg.whatsapp);
  timers.push(setInterval(async () => {
    if (waBusy) return; waBusy = true;
    try { await processWhatsAppOutbox(pool, waTransport, { log: m => app.log.warn(m) }); } catch (e) { app.log.error(e); } finally { waBusy = false; }
  }, 20_000));
  const maintenance = async () => {
    if (maintBusy) return; maintBusy = true;
    try {
      await runBookingMaintenance(pool, cfg);
      await pool.query(`delete from sessions where expires_at < now()`);
      await pool.query(`delete from auth_tokens where expires_at < now() - interval '7 days'`);
    } catch (e) { app.log.error(e); } finally { maintBusy = false; }
  };
  timers.push(setInterval(maintenance, 60 * 60_000));
  setTimeout(maintenance, 10_000);
}

const shutdown = async () => {
  timers.forEach(clearInterval);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep serving after a stray rejected promise, but leave a trace in the log
process.on('unhandledRejection', err => app.log.error(err));
