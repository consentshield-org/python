-- ADR-1003 Sprint 1.4 follow-up — re-publish public.get_storage_mode as
-- SECURITY DEFINER.
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Problem surfaced during Phase 1 operator smoke tests on 2026-04-25.
-- recordConsent (app/src/lib/consent/record.ts) does a pre-flight lookup
-- `select public.get_storage_mode(orgId)` via the cs_api connection BEFORE
-- branching to the zero-storage prepare RPC. The existing get_storage_mode
-- is `language sql` / stable / no SECURITY DEFINER — so the body
-- (`select from public.organisations ...`) runs in cs_api's context and
-- triggers the organisations RLS policy. The policy evaluates
-- `current_org_id()` which (transitively) references the `auth` schema,
-- and cs_api has no USAGE on `auth` per Supabase's auth-schema lockdown
-- (see feedback_no_auth_uid_in_scoped_rpcs). Result: the recordConsent
-- call fails with 42501 "permission denied for schema auth" before it
-- ever gets to the mode branch, classified by the Node helper as
-- api_key_binding.
--
-- Fix: SECURITY DEFINER so the body runs as owner (postgres, bypassrls +
-- has auth USAGE). The function stays STABLE for planner-cache reuse.
-- Single-statement select against `public.organisations` — no write path,
-- no user-controlled SQL, no injection surface. Grant unchanged
-- (cs_api / cs_orchestrator / cs_delivery / cs_admin EXECUTE).

create or replace function public.get_storage_mode(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(storage_mode, 'standard')
    from public.organisations
   where id = p_org_id
$$;

comment on function public.get_storage_mode(uuid) is
  'ADR-1003 Sprint 1.1, amended Sprint 1.4 follow-up (2026-04-25): '
  'SECURITY DEFINER so scoped roles (cs_api / cs_orchestrator / '
  'cs_delivery / cs_admin) can resolve storage_mode without tripping the '
  'public.organisations RLS policy that transitively references schema '
  'auth. Returns standard | insulated | zero_storage; falls back to '
  'standard when the org is missing. STABLE so the planner caches within '
  'a statement.';

-- Grants are preserved by CREATE OR REPLACE (confirmed in Sprint 1.4
-- gotcha #4). Re-stated here for clarity so a future grep lands both in
-- the same file.
grant execute on function public.get_storage_mode(uuid)
  to cs_api, cs_orchestrator, cs_delivery, cs_admin;

-- Verification:
--   select pg_get_functiondef('public.get_storage_mode(uuid)'::regprocedure);
--   → must contain `SECURITY DEFINER` and `STABLE`.
