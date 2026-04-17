-- ADR-0027 Sprint 2.1 — admin.feature_flags + public.get_feature_flag.
--
-- Global + per-org feature flag store. Both apps read; only admin writes.
-- Customer read via security-definer public.get_feature_flag(p_flag_key),
-- which resolves org-scope first then falls back to global scope.
--
-- NOTE on schema doc deviation: §3.9 specifies a composite primary key
-- using `coalesce(org_id, '0000...')` to let NULL org_id represent the
-- global scope without conflicting with a real org_id of all zeros.
-- PostgreSQL rejects expressions in PRIMARY KEY; only plain column names
-- are allowed. This migration uses a surrogate `id` PK + a unique index
-- over the same expression, which preserves the intended uniqueness
-- semantics. Documented as an amendment to consentshield-admin-schema.md
-- §3.9 in the ADR's Architecture Changes section.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.9.

create table admin.feature_flags (
  id              uuid        primary key default gen_random_uuid(),
  flag_key        text        not null,
  scope           text        not null check (scope in ('global','org')),
  org_id          uuid        references public.organisations(id),
  value           jsonb       not null,
  description     text        not null,
  set_by          uuid        not null references admin.admin_users(id),
  set_at          timestamptz not null default now(),
  expires_at      timestamptz
);

create unique index feature_flags_key_scope_org_uq
  on admin.feature_flags (flag_key, scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index feature_flags_org_idx on admin.feature_flags (org_id) where org_id is not null;

alter table admin.feature_flags enable row level security;

create policy feature_flags_admin_all on admin.feature_flags
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.feature_flags to authenticated;

-- Customer resolver. SECURITY DEFINER so customer JWT (no is_admin claim)
-- can still read their own org's override + global flags without seeing
-- other orgs' overrides.
create or replace function public.get_feature_flag(p_flag_key text)
returns jsonb
language sql
security definer
set search_path = admin, public
as $$
  select coalesce(
    (select value from admin.feature_flags
       where flag_key = p_flag_key
         and scope = 'org'
         and org_id = public.current_org_id()
         and (expires_at is null or expires_at > now())),
    (select value from admin.feature_flags
       where flag_key = p_flag_key
         and scope = 'global'
         and (expires_at is null or expires_at > now()))
  );
$$;

grant execute on function public.get_feature_flag(text) to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='feature_flags'; → 1
--   select count(*) from pg_proc where proname='get_feature_flag' and pronamespace='public'::regnamespace; → 1
