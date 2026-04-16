-- Make the ADR-0009 security-definer RPCs actually work over the REST API.
--
-- Observed failure on the first live deploy:
--   1. Anon calls rpc_get_rights_portal (owned by cs_orchestrator, security
--      definer). The function body SELECTs from `organisations`.
--   2. `organisations` has RLS; the existing policy filters by
--      `id = current_org_id()`, which internally calls `auth.jwt()`.
--   3. cs_orchestrator has no USAGE on schema `auth`, so `auth.jwt()` fails
--      with "permission denied for schema auth".
--   4. Even if auth.jwt() returned NULL, the RLS predicate wouldn't match.
--
-- Fix: let scoped roles bypass RLS inside their own security-definer
-- functions. BYPASSRLS applies to the role regardless of the outer JWT,
-- because security-definer runs with owner's privileges.
--
-- Note: an earlier version of this migration also ran
--   grant usage on schema auth to cs_orchestrator, cs_delivery;
-- That command is a silent no-op on hosted Supabase: the `auth` schema is
-- owned by `supabase_auth_admin`, so `postgres` (the role that runs
-- migrations) cannot grant privileges on it. The command emits
-- `WARNING: no privileges were granted for "auth"` and changes nothing.
-- The grant has been removed; any RPC that needs `auth.uid()` must use
-- the `public.current_uid()` helper introduced in 20260415000001.

alter role cs_orchestrator bypassrls;
alter role cs_delivery      bypassrls;
