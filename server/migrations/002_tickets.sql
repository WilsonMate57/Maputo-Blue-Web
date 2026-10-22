-- ─────────────────────────────────────────────────────────────────────────────
-- 002_tickets.sql — Booking tickets, QR validation and company details.
-- Additive only (safe to roll back the code without touching the data).
-- ─────────────────────────────────────────────────────────────────────────────

-- The QR code carries HMAC(reference|ticket_version). Incrementing the version
-- revokes every previously issued ticket/QR for that booking.
alter table bookings add column ticket_version integer not null default 1;
alter table bookings add column checked_in_at timestamptz;
alter table bookings add column checked_in_by uuid references users(id) on delete set null;

-- Every QR verification (public or staff) is logged for the operations team.
create table ticket_scans (
  id          bigserial primary key,
  booking_id  uuid references bookings(id) on delete cascade,
  reference   text not null,
  at          timestamptz not null default now(),
  result      text not null,           -- confirmed | pending | cancelled | rejected | completed | revoked | invalid
  staff_id    uuid references users(id) on delete set null,
  ip_hash     text
);
create index ticket_scans_booking_idx on ticket_scans (booking_id, at desc);

-- Company details printed on tickets and e-mails. Empty fields are not shown;
-- fiscal/licence numbers are left empty until configured by the administrator.
insert into settings (key, value) values ('company', '{
  "trade_name": "Maputo Blue",
  "legal_name": "",
  "phone": "+258 84 712 1666",
  "whatsapp": "+258847121666",
  "email": "maputoblue.info@gmail.com",
  "website": "www.maputoblue.com",
  "address": "Marina de Maputo, Av. 25 de Setembro, Maputo, Moçambique",
  "nuit": "",
  "licence": ""
}') on conflict (key) do nothing;
