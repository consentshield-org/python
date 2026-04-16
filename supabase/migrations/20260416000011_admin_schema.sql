-- ADR-0027 Sprint 1.1 — Admin schema bootstrap.
--
-- Introduces the `admin` Postgres schema that houses every operator-facing
-- admin table and RPC. The customer-facing `public` schema is untouched.
--
-- Per `docs/admin/architecture/consentshield-admin-schema.md` §1.
-- cs_admin (created in the next migration) is the scoped role that app
-- code uses to SELECT across customer orgs from security-definer RPCs.
-- All admin tables in this schema have RLS gated on the `is_admin` JWT
-- claim (see individual table migrations).

create schema if not exists admin;

revoke all on schema admin from public;
grant usage on schema admin to postgres;
grant create on schema admin to postgres;

comment on schema admin is
  'Operator-facing admin platform. Every write to tables here goes through '
  'admin.* security-definer RPCs that audit-log in the same transaction '
  '(Rule 22 — see docs/admin/architecture/consentshield-admin-platform.md).';

-- Verification:
--   select nspname, nspacl from pg_namespace where nspname = 'admin';
--     → exactly one row; acl shows postgres has USAGE + CREATE.
