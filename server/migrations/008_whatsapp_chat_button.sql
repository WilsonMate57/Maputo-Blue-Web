-- ─────────────────────────────────────────────────────────────────────────────
-- 008_whatsapp_chat_button.sql — Booking alerts carry the customer's number for
-- the "Conversar com o cliente" button (https://wa.me/<number>) of the
-- WhatsApp template set in WHATSAPP_TEMPLATE_CHAT. Null → template without button.
-- ─────────────────────────────────────────────────────────────────────────────

alter table whatsapp_outbox add column chat_phone text;
