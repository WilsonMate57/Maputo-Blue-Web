-- ─────────────────────────────────────────────────────────────────────────────
-- 005_request_billing.sql — Company details when a quotation is requested on
-- behalf of a company: {company_name, nuit, address}. Null for individuals.
-- Additive only.
-- ─────────────────────────────────────────────────────────────────────────────
alter table custom_requests add column billing jsonb;
