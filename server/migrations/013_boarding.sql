-- 013_boarding.sql — Boarding needs the trip paid in full; the team may
-- authorise an exception, with a reason. Also the customer's WhatsApp number
-- when it differs from the phone. Adds columns only.

alter table bookings
  add column customer_has_whatsapp   boolean not null default true,
  add column customer_whatsapp       text,                       -- only when it differs from the phone
  add column boarding_override_at    timestamptz,
  add column boarding_override_by    uuid references users(id) on delete set null,
  add column boarding_override_reason text;
