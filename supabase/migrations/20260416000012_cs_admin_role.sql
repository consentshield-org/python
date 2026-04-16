-- ADR-0027 Sprint 1.1 — cs_admin scoped role.
--
-- Third scoped role (alongside cs_worker, cs_delivery, cs_orchestrator).
-- BYPASSRLS applies to SELECTs — used by security-definer admin RPCs that
-- read across customer orgs (e.g. admin.suspend_org reads all orgs'
-- state to generate the old_value snapshot before writing).
--
-- No inherent write privilege on public.*. Every admin mutation to a
-- customer table flows through an admin.* RPC that audit-logs in the
-- same transaction.
--
-- Per `docs/admin/architecture/consentshield-admin-schema.md` §2. The
-- `grant ... with set true` clause is required for Postgres 16 GRANT
-- ROLE separation — the pooler's `authenticator` user needs to assume
-- cs_admin per session (reference: 20260413000011_scoped_roles_set_option.sql).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cs_admin') then
    create role cs_admin nologin noinherit bypassrls;
  end if;
end $$;

-- Postgres 16 GRANT ROLE separation: allow authenticator to SET ROLE cs_admin.
grant cs_admin to authenticator with set true;

-- Admin SELECT across customer orgs (BYPASSRLS handles the cross-org read).
grant usage on schema public to cs_admin;
grant select on all tables in schema public to cs_admin;

-- Admin helpers + RPCs live in admin schema; cs_admin needs USAGE.
grant usage on schema admin to cs_admin;

-- Make future tables in public.* automatically grant SELECT to cs_admin
-- so new customer tables (e.g. DEPA artefact tables from ADR-0020) inherit
-- the cross-org read capability without a per-table follow-up migration.
alter default privileges in schema public grant select on tables to cs_admin;

-- Verification:
--   select rolname, rolbypassrls, rolcanlogin, rolinherit
--     from pg_roles where rolname = 'cs_admin';
--     → exactly one row: rolbypassrls=true, rolcanlogin=false, rolinherit=false
--   select count(*) from information_schema.role_table_grants
--     where grantee = 'cs_admin' and privilege_type = 'SELECT' and table_schema = 'public';
--     → matches the count of public tables (every table granted).
