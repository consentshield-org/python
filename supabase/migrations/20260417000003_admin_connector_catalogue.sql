-- ADR-0027 Sprint 2.1 — admin.connector_catalogue + FK on public.integration_connectors.
--
-- Global catalogue of pre-built deletion connectors. Maps to the existing
-- customer-side ADR-0018 pre-built connectors (Mailchimp, HubSpot) and
-- any future addition.
--
-- NOTE on name deviation from the schema doc + ADR: the doc refers to the
-- customer-side table as `public.integrations`. The actual table is
-- `public.integration_connectors` (see migration 20260413000003 L187).
-- The FK column is added there. Tracked as an amendment in the ADR-0027
-- Architecture Changes section.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.5.

create table admin.connector_catalogue (
  id                          uuid        primary key default gen_random_uuid(),
  connector_code              text        not null,
  display_name                text        not null,
  vendor                      text        not null,
  version                     text        not null,
  status                      text        not null default 'active' check (status in ('active','deprecated','retired')),
  supported_purpose_codes     text[]      not null,
  required_credentials_schema jsonb       not null,
  webhook_endpoint_template   text        not null,
  documentation_url           text,
  retention_lock_supported    boolean     not null default false,
  created_at                  timestamptz not null default now(),
  created_by                  uuid        not null references admin.admin_users(id),
  deprecated_at               timestamptz,
  deprecated_replacement_id   uuid        references admin.connector_catalogue(id),
  cutover_deadline            timestamptz,
  unique (connector_code, version)
);

create index connector_catalogue_active_idx
  on admin.connector_catalogue (status, connector_code)
  where status = 'active';

alter table admin.connector_catalogue enable row level security;

create policy connector_catalogue_admin on admin.connector_catalogue
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.connector_catalogue to authenticated;

-- Customer-side cross-reference. Nullable — existing rows are unaffected;
-- new rows set by the customer UI (ADR-0018 follow-up) when they pick a
-- pre-built connector from the catalogue.
alter table public.integration_connectors
  add column connector_catalogue_id uuid references admin.connector_catalogue(id);

create index integration_connectors_catalogue_idx
  on public.integration_connectors (connector_catalogue_id)
  where connector_catalogue_id is not null;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='connector_catalogue'; → 1
--   select count(*) from information_schema.columns
--     where table_schema='public' and table_name='integration_connectors'
--       and column_name='connector_catalogue_id'; → 1
