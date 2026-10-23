-- ─────────────────────────────────────────────────────────────────────────────
-- 004_quote_requests.sql — Packages/services chosen in a quote request and
-- the channels a quotation was sent through. Additive only.
-- ─────────────────────────────────────────────────────────────────────────────

-- [{kind: 'package'|'service', package_id, service_key, title, title_en, category, date, notes}]
alter table custom_requests add column items jsonb not null default '[]';

-- How the team delivered the quotation: e-mail, WhatsApp and/or a shared link.
-- Quotations are always visible in the customer's account when the request is
-- linked to it, whatever the channel.
alter table quotes add column channels text[] not null default '{}';
