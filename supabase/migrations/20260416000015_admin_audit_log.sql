-- ADR-0027 Sprint 1.1 — admin.admin_audit_log (partitioned, append-only).
--
-- Permanent record of every admin action. Rule 22 says: every admin write
-- to a customer table goes through a security-definer RPC that inserts
-- one row here IN THE SAME TRANSACTION as the mutation. The RPCs land in
-- Sprint 3.1.
--
-- The table is partitioned by month (occurred_at). The first partition
-- exists for the current month; subsequent partitions are created by the
-- admin-create-next-audit-partition pg_cron job (scheduled in Sprint 3.1).
--
-- Append-only invariant: REVOKE insert, update, delete from authenticated
-- AND cs_admin. Writes happen only inside security-definer functions
-- running as postgres (the function owner), which bypasses this revoke.
-- Even a malicious admin RPC written with elevated privilege cannot
-- DELETE from the audit log from the app-code path.
--
-- The FK to admin.impersonation_sessions is added in ADR-0027 Sprint 2.1
-- when the impersonation_sessions table lands. For now, the column is a
-- plain uuid — an audit row can reference an impersonation session id
-- that doesn't exist yet (harmless; the FK retrofit in Sprint 2.1 catches
-- any stray references).
--
-- Per `docs/admin/architecture/consentshield-admin-schema.md` §3.2.

create table admin.admin_audit_log (
  id                       bigserial   not null,
  occurred_at              timestamptz not null default now(),
  admin_user_id            uuid        not null references admin.admin_users(id),
  action                   text        not null,
  target_table             text,
  target_id                uuid,
  target_pk                text,
  org_id                   uuid        references public.organisations(id),
  impersonation_session_id uuid,                               -- FK added in Sprint 2.1
  old_value                jsonb,
  new_value                jsonb,
  reason                   text        not null check (length(reason) >= 10),
  request_ip               inet,
  request_ua               text,
  api_route                text,
  primary key (id, occurred_at)
)
partition by range (occurred_at);

-- First partition for the current month (2026-04).
create table admin.admin_audit_log_2026_04
  partition of admin.admin_audit_log
  for values from ('2026-04-01') to ('2026-05-01');

-- Index once per parent table (partitions inherit).
create index admin_audit_log_admin_idx  on admin.admin_audit_log (admin_user_id, occurred_at desc);
create index admin_audit_log_org_idx    on admin.admin_audit_log (org_id, occurred_at desc) where org_id is not null;
create index admin_audit_log_action_idx on admin.admin_audit_log (action, occurred_at desc);
create index admin_audit_log_session_idx on admin.admin_audit_log (impersonation_session_id) where impersonation_session_id is not null;

alter table admin.admin_audit_log enable row level security;

-- Read-only policy for admins.
create policy admin_audit_log_read on admin.admin_audit_log
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Explicit revokes enforce the append-only invariant: even cs_admin
-- (owner of admin schema usage) cannot mutate rows via direct query.
revoke insert, update, delete on admin.admin_audit_log from authenticated, cs_admin;
grant select on admin.admin_audit_log to authenticated, cs_admin;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='admin_audit_log';
--     → 1 (SELECT-only policy)
--   select count(*) from pg_policies
--     where schemaname='admin' and tablename='admin_audit_log' and cmd in ('INSERT','UPDATE','DELETE');
--     → 0
--   select count(*) from pg_tables where schemaname='admin' and tablename like 'admin_audit_log_%';
--     → 1 (the 2026-04 partition)
--   select count(*) from pg_indexes where schemaname='admin' and tablename='admin_audit_log';
--     → 4 (admin/org/action/session)
