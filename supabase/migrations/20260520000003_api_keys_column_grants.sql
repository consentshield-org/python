-- Migration: ADR-1001 Sprint 2.1 — column-level SELECT grants on public.api_keys
--
-- In the prior migrations, `revoke select (key_hash, previous_key_hash) ...
-- from authenticated` was ineffective because Supabase's default table-wide
-- SELECT grant on `authenticated` shadows the column-level revoke. The only
-- way to hide specific columns from a role in PostgreSQL is:
--   1. REVOKE SELECT on the table from the role
--   2. GRANT SELECT on the specific allowed columns
--
-- We then rely on RLS policies for row-level restriction.

revoke select on public.api_keys from authenticated;

grant select (
  id,
  account_id,
  org_id,
  key_prefix,
  name,
  scopes,
  rate_tier,
  created_by,
  created_at,
  last_used_at,
  last_rotated_at,
  expires_at,
  is_active,
  revoked_at,
  revoked_by,
  previous_key_expires_at
) on public.api_keys to authenticated;

-- Note: `key_hash` and `previous_key_hash` are intentionally omitted from the
-- grant list. The only legitimate consumer of hash columns is the
-- `rpc_api_key_verify` SECURITY DEFINER function called by the middleware
-- under the `service_role`.
