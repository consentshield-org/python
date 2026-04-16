-- ADR-0027 Sprint 1.1 — expose the admin schema via PostgREST.
--
-- Supabase's PostgREST layer reads the list of exposed schemas from the
-- `pgrst.db_schemas` setting on the `authenticator` role. By default
-- only `public` + `graphql_public` are exposed. Without this change the
-- admin app cannot SELECT from admin.* or call admin.* RPCs — every
-- request returns "invalid schema: admin".
--
-- The pattern is: alter the role setting + NOTIFY pgrst to reload config.
-- (supabase/config.toml mirrors this for local dev / future `config push`.)
--
-- This change is idempotent — the ALTER overwrites whatever was there.

alter role authenticator set pgrst.db_schemas to 'public, graphql_public, admin';
notify pgrst, 'reload config';

-- Verification:
--   select rolname, rolconfig from pg_roles where rolname = 'authenticator';
--     → rolconfig includes 'pgrst.db_schemas=public, graphql_public, admin'
