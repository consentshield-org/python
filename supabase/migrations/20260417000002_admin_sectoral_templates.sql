-- ADR-0027 Sprint 2.1 — admin.sectoral_templates + public.list_sectoral_templates_for_sector.
--
-- Sector-specific purpose-definition seed packs. Customer onboarding
-- (W9 in customer alignment) reads published templates via a
-- security-definer function in public; admin-side CRUD happens through
-- admin.*_sectoral_template_* RPCs (Sprint 3.1) that audit-log writes.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.4.

create table admin.sectoral_templates (
  id                  uuid        primary key default gen_random_uuid(),
  template_code       text        not null,
  display_name        text        not null,
  description         text        not null,
  sector              text        not null,
  version             int         not null default 1,
  status              text        not null default 'draft' check (status in ('draft','published','deprecated')),
  purpose_definitions jsonb       not null,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid        not null references admin.admin_users(id),
  published_at        timestamptz,
  published_by        uuid        references admin.admin_users(id),
  deprecated_at       timestamptz,
  superseded_by_id    uuid        references admin.sectoral_templates(id),
  unique (template_code, version)
);

create index sectoral_templates_published_idx
  on admin.sectoral_templates (sector, status, version desc)
  where status = 'published';

alter table admin.sectoral_templates enable row level security;

create policy sectoral_templates_admin on admin.sectoral_templates
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.sectoral_templates to authenticated;

-- Customer-facing helper. Returns published templates for the requested
-- sector + 'general' fallback. SECURITY DEFINER because customer JWT has
-- no is_admin claim; without this wrapper RLS denies the SELECT.
create or replace function public.list_sectoral_templates_for_sector(p_sector text)
returns table (
  template_code       text,
  display_name        text,
  description         text,
  version             int,
  purpose_definitions jsonb
)
language sql
security definer
set search_path = admin, public
as $$
  select template_code, display_name, description, version, purpose_definitions
    from admin.sectoral_templates
   where status = 'published'
     and sector in (p_sector, 'general')
   order by sector desc, version desc;
$$;

grant execute on function public.list_sectoral_templates_for_sector(text) to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='sectoral_templates'; → 1
--   select count(*) from pg_proc
--     where proname='list_sectoral_templates_for_sector' and pronamespace='public'::regnamespace; → 1
