-- ADR-0027 Sprint 1.1 — admin.admin_users (ordered before admin_audit_log
-- because the audit log FK-references this table).
--
-- One row per admin operator. Extends auth.users with admin-specific
-- metadata (display name, admin_role tier, hardware-key enrolment count,
-- bootstrap flag, status lifecycle).
--
-- Row lifecycle:
--   * Created by admin.create_admin() RPC (ADR-0027 Sprint 3.1; not yet
--     implemented) or the one-shot scripts/bootstrap-admin.ts (Sprint 4.1)
--   * Never hard-deleted by the app; admin.disable_admin() flips status
--     to 'disabled' and sets disabled_at + disabled_reason
--   * Cascade-deletes only if the underlying auth.users row is deleted
--     (via `on delete cascade` on the FK) — that's a Supabase Auth-side
--     action and requires service-role access.
--
-- Per `docs/admin/architecture/consentshield-admin-schema.md` §3.1.

create table admin.admin_users (
  id                          uuid        primary key references auth.users(id) on delete cascade,
  display_name                text        not null,
  admin_role                  text        not null check (admin_role in ('platform_operator','support','read_only')),
  status                      text        not null default 'active' check (status in ('active','disabled','suspended')),
  hardware_keys_registered    int         not null default 0,
  bootstrap_admin             boolean     not null default false,
  created_at                  timestamptz not null default now(),
  created_by                  uuid        references admin.admin_users(id),
  disabled_at                 timestamptz,
  disabled_reason             text,
  last_admin_action_at        timestamptz,
  notes                       text
);

-- Exactly zero or one bootstrap admin may exist at any time.
create unique index admin_users_one_bootstrap_idx
  on admin.admin_users (bootstrap_admin) where bootstrap_admin = true;

alter table admin.admin_users enable row level security;

-- Admins may read + write their own records through security-definer RPCs
-- in Sprint 3.1. Direct writes are blocked by the RPC pattern; the policy
-- below permits SELECT from the admin app's JWT path.
create policy admin_users_admin_only on admin.admin_users
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Authenticated reaches the table via the is_admin RLS policy.
grant select, insert, update, delete on admin.admin_users to authenticated;

-- cs_admin reads admin.* for cross-referencing in security-definer RPCs.
grant select on admin.admin_users to cs_admin;

-- Verification:
--   select count(*) from pg_policies where schemaname = 'admin' and tablename = 'admin_users';
--     → 1
--   select count(*) from pg_indexes where schemaname = 'admin' and tablename = 'admin_users';
--     → 1 (the bootstrap unique index; the PK index is in pg_class not pg_indexes)
--   select rowsecurity from pg_tables where schemaname = 'admin' and tablename = 'admin_users';
--     → t
