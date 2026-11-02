-- ─────────────────────────────────────────────────────────────────────────────
-- 010_staff_roles.sql — Three staff levels: superadmin (creates and manages the
-- team's accounts), admin (everything else) and manager (bookings, availability,
-- packages, invoices and customers only). The oldest active administrator
-- becomes the super-administrator, so the panel keeps an owner after deploy.
-- ─────────────────────────────────────────────────────────────────────────────

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('customer','manager','admin','superadmin'));

update users set role = 'superadmin', updated_at = now()
 where id = (select id from users where role = 'admin' and disabled_at is null order by created_at limit 1)
   and not exists (select 1 from users where role = 'superadmin');
