-- ─────────────────────────────────────────────────────────────────────────────
-- 006_company_website.sql — The site's domain is maputoblue.co.mz.
-- Earlier migrations seeded "www.maputoblue.com" as the website printed on
-- tickets, invoices and quotes. Replace it only where it is still that seeded
-- value, so an address typed by an administrator is never overwritten.
-- ─────────────────────────────────────────────────────────────────────────────

update settings
   set value = jsonb_set(value, '{website}', '"www.maputoblue.co.mz"')
 where key = 'company'
   and value->>'website' = 'www.maputoblue.com';

update settings
   set value = jsonb_set(value, '{issuer,website}', '"www.maputoblue.co.mz"')
 where key = 'invoicing'
   and value->'issuer'->>'website' = 'www.maputoblue.com';
