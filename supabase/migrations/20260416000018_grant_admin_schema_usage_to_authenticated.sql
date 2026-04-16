-- ADR-0027 Sprint 1.1 follow-up — grant USAGE on schema admin to authenticated.
--
-- Without this, any PostgREST request from an authenticated JWT to an
-- admin.* table returns "permission denied for schema admin" even before
-- RLS policies get a chance to evaluate. The is_admin RLS filter is still
-- the row-level gate; this grant is the schema-level prerequisite.
--
-- anon role explicitly does NOT receive this grant — the anon JWT should
-- fail at the schema-usage check, never reaching RLS.

grant usage on schema admin to authenticated;

-- Cache nudge so the change takes effect immediately.
notify pgrst, 'reload schema';

-- Verification:
--   select has_schema_privilege('authenticated', 'admin', 'USAGE') → t
--   select has_schema_privilege('anon', 'admin', 'USAGE') → f
