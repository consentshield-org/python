-- ADR-0027 Sprint 2.1 — admin.impersonation_sessions + public.org_support_sessions.
--
-- Every impersonation event (Rule 23: time-boxed, reason-required,
-- customer-notified). The admin app starts a session via
-- admin.start_impersonation() (Sprint 3.1) which writes one row here +
-- one audit_log row in the same transaction.
--
-- The table lives in admin.* and has an admin_all RLS policy. A
-- security-invoker view in public.org_support_sessions + a second
-- SELECT-only policy (org_view) gives each customer read access to the
-- impersonation sessions targeting their own org. The two policies are
-- OR'd by Postgres: admin sees everything, customer sees their own.
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.3.

create table admin.impersonation_sessions (
  id                       uuid        primary key default gen_random_uuid(),
  admin_user_id            uuid        not null references admin.admin_users(id),
  target_org_id            uuid        not null references public.organisations(id),
  reason                   text        not null check (reason in ('bug_investigation','data_correction','compliance_query','partner_demo','other')),
  reason_detail            text        not null check (length(reason_detail) >= 10),
  started_at               timestamptz not null default now(),
  expires_at               timestamptz not null,
  ended_at                 timestamptz,
  ended_reason             text        check (ended_reason in ('manual','expired','force_ended','admin_logout')),
  customer_notified_at     timestamptz,
  status                   text        not null default 'active' check (status in ('active','completed','expired','force_ended')),
  actions_summary          jsonb,
  ended_by_admin_user_id   uuid        references admin.admin_users(id)
);

create index impersonation_sessions_admin_idx  on admin.impersonation_sessions (admin_user_id, started_at desc);
create index impersonation_sessions_org_idx    on admin.impersonation_sessions (target_org_id, started_at desc);
create index impersonation_sessions_active_idx on admin.impersonation_sessions (status) where status = 'active';

alter table admin.impersonation_sessions enable row level security;

-- Policy 1: admin sees everything, can write anything (start/end is still
-- always channelled through admin.start_impersonation / end_impersonation
-- RPCs for audit-log symmetry — that's a discipline, not an RLS constraint).
create policy impersonation_sessions_admin_all on admin.impersonation_sessions
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Policy 2: customer sees only impersonation sessions targeting their own
-- org. Read-only. The two SELECT policies are OR'd.
create policy impersonation_sessions_org_view on admin.impersonation_sessions
  for select to authenticated
  using (target_org_id = public.current_org_id());

grant select on admin.impersonation_sessions to authenticated;

-- Customer-side read-through view. security_invoker = true makes the view
-- defer to the invoker's RLS on the underlying table (so the org_view
-- policy above governs what each customer sees).
create view public.org_support_sessions
  with (security_invoker = true) as
  select
    id,
    admin_user_id,
    target_org_id as org_id,
    reason,
    reason_detail,
    started_at,
    ended_at,
    status,
    actions_summary
  from admin.impersonation_sessions;

grant select on public.org_support_sessions to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='impersonation_sessions';
--     → 2 (admin_all + org_view)
--   select count(*) from pg_views where schemaname='public' and viewname='org_support_sessions';
--     → 1
--   select count(*) from pg_indexes where schemaname='admin' and tablename='impersonation_sessions';
--     → 3 (admin/org/active)
