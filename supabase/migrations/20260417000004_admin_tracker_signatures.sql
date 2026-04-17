-- ADR-0027 Sprint 2.1 — admin.tracker_signature_catalogue.
--
-- Promotes the seed file supabase/seed/tracker_signatures.sql to a
-- managed table the operator can edit live. Worker reads via Cloudflare
-- KV (synced by sync-admin-config-to-kv Edge Function in Sprint 3.2).
--
-- NOTES on what this migration does NOT do:
--
-- 1. It does NOT bulk-load from public.tracker_signatures (the customer
--    table populated from the seed file). Two blockers:
--      a) Shape mismatch — public.tracker_signatures.detection_rules is
--         a jsonb array of {type, pattern, confidence} objects; the admin
--         catalogue is a flat row per signature. Mapping requires jsonb
--         unnesting + one-to-many fan-out.
--      b) created_by is NOT NULL references admin.admin_users — but no
--         admin user exists until ADR-0027 Sprint 4.1 bootstrap. A bulk
--         INSERT before bootstrap would violate the FK.
--    The import happens via admin.import_tracker_signature_pack() RPC
--    (Sprint 3.1) invoked by the operator post-bootstrap. The seed file
--    remains the source of truth for the customer-side worker KV until
--    the operator populates the catalogue.
--
-- 2. signature_type check constraint includes 'resource_url' in addition
--    to the four types listed in schema doc §3.6. The seed file uses
--    resource_url for some signatures (e.g. google-analytics.com/g/collect)
--    and the import RPC in Sprint 3.1 will use this value. Documented as
--    an amendment to consentshield-admin-schema.md §3.6 in the ADR's
--    Architecture Changes section.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.6.

create table admin.tracker_signature_catalogue (
  id                  uuid        primary key default gen_random_uuid(),
  signature_code      text        not null unique,
  display_name        text        not null,
  vendor              text        not null,
  signature_type      text        not null check (signature_type in ('script_src','resource_url','cookie_name','localstorage_key','dom_attribute')),
  pattern             text        not null,
  category            text        not null check (category in ('analytics','marketing','functional','social','advertising','other')),
  severity            text        not null default 'info' check (severity in ('info','warn','critical')),
  status              text        not null default 'active' check (status in ('active','deprecated')),
  created_at          timestamptz not null default now(),
  created_by          uuid        not null references admin.admin_users(id),
  notes               text
);

create index tracker_signature_catalogue_active_idx
  on admin.tracker_signature_catalogue (status, category)
  where status = 'active';

alter table admin.tracker_signature_catalogue enable row level security;

create policy tracker_signatures_admin on admin.tracker_signature_catalogue
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.tracker_signature_catalogue to authenticated;

-- Verification:
--   select count(*) from pg_policies
--     where schemaname='admin' and tablename='tracker_signature_catalogue'; → 1
--   select count(*) from admin.tracker_signature_catalogue; → 0 (populated by RPC post-bootstrap)
