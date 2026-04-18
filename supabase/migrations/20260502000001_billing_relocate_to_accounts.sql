-- ADR-0034 Sprint 1.1 amendment — follow-up to ADR-0044 Phase 0
-- (migration 20260428000002_accounts_and_plans.sql).
--
-- Phase 0 moved plan + Razorpay identity from organisations to accounts
-- and dropped organisations.plan / razorpay_subscription_id /
-- razorpay_customer_id. My Sprint 1.1 migration shipped refunds and
-- plan_adjustments scoped to org_id, and org_effective_plan() read
-- organisations.plan — both are now incorrect. Refunds are account-
-- level (subscription lives on the account), and comp / override grants
-- are account-level too (operators grant free Pro to an account, not
-- to one specific org within it).
--
-- This migration rewires Sprint 1.1 artefacts onto the accounts layer:
--
--   public.refunds.org_id          → public.refunds.account_id
--   public.plan_adjustments.org_id → public.plan_adjustments.account_id
--   drop public.org_effective_plan → create public.account_effective_plan
--   rewrite all 6 admin.billing_* RPCs with p_account_id
--
-- `public.current_plan()` (Phase 0) is the caller-facing reader; it
-- does NOT take an account id, so it cannot replace account_effective_plan.
-- The admin RPCs look up any account's effective plan, so this helper
-- stays separate.

-- ═══════════════════════════════════════════════════════════
-- 1 · refunds — add account_id, backfill, drop org_id
-- ═══════════════════════════════════════════════════════════

alter table public.refunds
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

update public.refunds r
   set account_id = o.account_id
  from public.organisations o
 where o.id = r.org_id
   and r.account_id is null;

alter table public.refunds
  alter column account_id set not null;

drop index if exists refunds_org_created_idx;

alter table public.refunds
  drop column if exists org_id;

create index if not exists refunds_account_created_idx
  on public.refunds (account_id, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- 2 · plan_adjustments — add account_id, backfill, drop org_id,
--     rebuild partial-unique index
-- ═══════════════════════════════════════════════════════════

alter table public.plan_adjustments
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

update public.plan_adjustments pa
   set account_id = o.account_id
  from public.organisations o
 where o.id = pa.org_id
   and pa.account_id is null;

alter table public.plan_adjustments
  alter column account_id set not null;

drop index if exists plan_adjustments_unrevoked_uniq;
drop index if exists plan_adjustments_org_idx;

alter table public.plan_adjustments
  drop column if exists org_id;

-- Same now()-in-predicate restriction as bug-250: partial index stays
-- keyed on revoked_at is null only. Expiry filtering is in the RPCs.
create unique index if not exists plan_adjustments_unrevoked_uniq
  on public.plan_adjustments (account_id, kind)
  where revoked_at is null;

create index if not exists plan_adjustments_account_idx
  on public.plan_adjustments (account_id, kind, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- 3 · Replace org_effective_plan → account_effective_plan
-- ═══════════════════════════════════════════════════════════

drop function if exists public.org_effective_plan(uuid);

create or replace function public.account_effective_plan(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with active_adj as (
    select kind, plan
      from public.plan_adjustments
     where account_id = p_account_id
       and revoked_at is null
       and (expires_at is null or expires_at > now())
  )
  select coalesce(
    (select plan from active_adj where kind = 'override' limit 1),
    (select plan from active_adj where kind = 'comp'     limit 1),
    (select plan_code from public.accounts where id = p_account_id)
  );
$$;

comment on function public.account_effective_plan(uuid) is
  'ADR-0034 Sprint 1.1 (post ADR-0044 Phase 0). Canonical effective-plan '
  'resolution for an account: active override > active comp > accounts.plan_code. '
  'Use this when admin code needs any account''s effective plan; use '
  'public.current_plan() for the caller''s own plan.';

grant execute on function public.account_effective_plan(uuid)
  to authenticated, cs_orchestrator, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4 · Rewire admin.billing_* RPCs to account_id
-- ═══════════════════════════════════════════════════════════

-- Drop old signatures first (parameter types or return types changed).
drop function if exists admin.billing_payment_failures_list(int);
drop function if exists admin.billing_refunds_list(int);
drop function if exists admin.billing_create_refund(uuid, text, bigint, text);
drop function if exists admin.billing_plan_adjustments_list(text);
drop function if exists admin.billing_upsert_plan_adjustment(uuid, text, text, timestamptz, text);
drop function if exists admin.billing_revoke_plan_adjustment(uuid, text);

-- 4.1 · billing_payment_failures_list — aggregate by account_id.
-- audit_log rows still carry org_id (they were written by
-- rpc_razorpay_apply_subscription before Phase 0). We join to
-- organisations → accounts to roll up per-account counts.
create or replace function admin.billing_payment_failures_list(
  p_window_days int default 7
)
returns table (
  account_id                uuid,
  account_name              text,
  plan_code                 text,
  effective_plan            text,
  razorpay_subscription_id  text,
  last_failed_at            timestamptz,
  retries                   bigint,
  last_payment_id           text
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_window_days is null or p_window_days < 1 or p_window_days > 90 then
    raise exception 'p_window_days must be between 1 and 90';
  end if;

  return query
  with failures as (
    select o.account_id,
           al.created_at,
           al.payload
      from public.audit_log al
      join public.organisations o on o.id = al.org_id
     where al.event_type = 'payment_failed'
       and al.created_at >= now() - (p_window_days || ' days')::interval
       and o.account_id is not null
  ),
  per_account as (
    select f.account_id,
           max(f.created_at) as last_failed_at,
           count(*)          as retries,
           (array_agg(f.payload->>'payment_id' order by f.created_at desc))[1]      as last_payment_id,
           (array_agg(f.payload->>'subscription_id' order by f.created_at desc))[1] as razorpay_subscription_id
      from failures f
     group by f.account_id
  )
  select pa.account_id,
         coalesce(a.name, '(deleted)')                    as account_name,
         a.plan_code,
         public.account_effective_plan(pa.account_id)     as effective_plan,
         coalesce(pa.razorpay_subscription_id, a.razorpay_subscription_id) as razorpay_subscription_id,
         pa.last_failed_at,
         pa.retries,
         pa.last_payment_id
    from per_account pa
    left join public.accounts a on a.id = pa.account_id
   order by pa.last_failed_at desc;
end;
$$;

grant execute on function admin.billing_payment_failures_list(int) to cs_admin;

-- 4.2 · billing_refunds_list
create or replace function admin.billing_refunds_list(
  p_limit int default 50
)
returns table (
  id                   uuid,
  account_id           uuid,
  account_name         text,
  razorpay_payment_id  text,
  razorpay_refund_id   text,
  amount_paise         bigint,
  reason               text,
  status               text,
  failure_reason       text,
  requested_by         uuid,
  issued_at            timestamptz,
  created_at           timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500';
  end if;

  return query
  select r.id, r.account_id,
         coalesce(a.name, '(deleted)') as account_name,
         r.razorpay_payment_id, r.razorpay_refund_id,
         r.amount_paise, r.reason, r.status, r.failure_reason,
         r.requested_by, r.issued_at, r.created_at
    from public.refunds r
    left join public.accounts a on a.id = r.account_id
   order by r.created_at desc
   limit p_limit;
end;
$$;

grant execute on function admin.billing_refunds_list(int) to cs_admin;

-- 4.3 · billing_create_refund
create or replace function admin.billing_create_refund(
  p_account_id          uuid,
  p_razorpay_payment_id text,
  p_amount_paise        bigint,
  p_reason              text
)
returns uuid
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
begin
  perform admin.require_admin('support');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'amount_paise must be > 0';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;

  insert into public.refunds
    (account_id, razorpay_payment_id, amount_paise, reason, status, requested_by)
  values
    (p_account_id, p_razorpay_payment_id, p_amount_paise, p_reason, 'pending', v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_create_refund', 'public.refunds', v_id, null,
     null,
     jsonb_build_object(
       'account_id', p_account_id,
       'razorpay_payment_id', p_razorpay_payment_id,
       'amount_paise', p_amount_paise,
       'status', 'pending'
     ),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.billing_create_refund(uuid, text, bigint, text) to cs_admin;

-- 4.4 · billing_plan_adjustments_list
create or replace function admin.billing_plan_adjustments_list(
  p_kind text default null
)
returns table (
  id           uuid,
  account_id   uuid,
  account_name text,
  kind         text,
  plan         text,
  starts_at    timestamptz,
  expires_at   timestamptz,
  reason       text,
  granted_by   uuid,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  if p_kind is not null and p_kind not in ('comp','override') then
    raise exception 'p_kind must be ''comp'', ''override'', or null';
  end if;

  return query
  select pa.id, pa.account_id,
         coalesce(a.name, '(deleted)') as account_name,
         pa.kind, pa.plan, pa.starts_at, pa.expires_at,
         pa.reason, pa.granted_by, pa.created_at
    from public.plan_adjustments pa
    left join public.accounts a on a.id = pa.account_id
   where pa.revoked_at is null
     and (pa.expires_at is null or pa.expires_at > now())
     and (p_kind is null or pa.kind = p_kind)
   order by pa.created_at desc;
end;
$$;

grant execute on function admin.billing_plan_adjustments_list(text) to cs_admin;

-- 4.5 · billing_upsert_plan_adjustment
-- Plan codes now align with public.plans (trial_starter instead of trial).
create or replace function admin.billing_upsert_plan_adjustment(
  p_account_id uuid,
  p_kind       text,
  p_plan       text,
  p_expires_at timestamptz,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_id    uuid;
  v_prev  uuid;
begin
  perform admin.require_admin('platform_operator');
  if p_kind not in ('comp','override') then
    raise exception 'p_kind must be ''comp'' or ''override''';
  end if;
  if not exists (
    select 1 from public.plans where plan_code = p_plan and is_active = true
  ) then
    raise exception 'p_plan must reference an active row in public.plans';
  end if;
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;

  -- Revoke any unrevoked row of the same (account, kind).
  update public.plan_adjustments
     set revoked_at = now(),
         revoked_by = v_admin
   where account_id = p_account_id
     and kind       = p_kind
     and revoked_at is null
  returning id into v_prev;

  insert into public.plan_adjustments
    (account_id, kind, plan, expires_at, reason, granted_by)
  values
    (p_account_id, p_kind, p_plan, p_expires_at, p_reason, v_admin)
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_upsert_plan_adjustment', 'public.plan_adjustments', v_id, null,
     case when v_prev is null then null
          else jsonb_build_object('revoked_id', v_prev) end,
     jsonb_build_object(
       'account_id', p_account_id, 'kind', p_kind, 'plan', p_plan, 'expires_at', p_expires_at
     ),
     p_reason);

  return v_id;
end;
$$;

grant execute on function admin.billing_upsert_plan_adjustment(uuid, text, text, timestamptz, text) to cs_admin;

-- 4.6 · billing_revoke_plan_adjustment — signature unchanged (uses adjustment_id)
create or replace function admin.billing_revoke_plan_adjustment(
  p_adjustment_id uuid,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_row   public.plan_adjustments%rowtype;
begin
  perform admin.require_admin('platform_operator');
  if length(p_reason) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select * into v_row from public.plan_adjustments where id = p_adjustment_id;
  if v_row.id is null then
    raise exception 'plan adjustment not found';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'already revoked';
  end if;

  update public.plan_adjustments
     set revoked_at = now(),
         revoked_by = v_admin
   where id = p_adjustment_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_revoke_plan_adjustment', 'public.plan_adjustments',
     p_adjustment_id, null,
     jsonb_build_object(
       'account_id', v_row.account_id, 'kind', v_row.kind,
       'plan', v_row.plan, 'expires_at', v_row.expires_at
     ),
     jsonb_build_object('revoked_at', now()),
     p_reason);
end;
$$;

grant execute on function admin.billing_revoke_plan_adjustment(uuid, text) to cs_admin;

-- Verification:
--   select column_name from information_schema.columns
--    where table_name='refunds' and column_name in ('org_id','account_id');
--    → one row, 'account_id'.
--
--   select column_name from information_schema.columns
--    where table_name='plan_adjustments' and column_name in ('org_id','account_id');
--    → one row, 'account_id'.
--
--   select public.account_effective_plan('00000000-0000-0000-0000-000000000000'); → null
