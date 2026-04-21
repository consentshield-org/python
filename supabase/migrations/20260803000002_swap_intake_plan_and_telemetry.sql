-- ADR-0058 Sprint 1.5 — in-wizard plan swap + step-completion telemetry.
--
-- 1/3 · `public.swap_intake_plan(p_org_id, p_new_plan_code)` — lets a
--   self-serve customer change plans during onboarding. Only works
--   while the org hasn't been handed off yet (`onboarded_at is null`)
--   and only across the self-serve tier whitelist (Starter ↔ Growth ↔
--   Pro). Enterprise stays a sales conversation and is not swap-able
--   from this path.
--
-- 2/3 · `public.onboarding_step_events` — thin per-step telemetry
--   buffer. Purpose is to let operators see onboarding drop-off +
--   step-elapsed percentiles. Append-only from the customer app;
--   reads are admin-only via the RPC below.
--
-- 3/3 · `public.log_onboarding_step_event(p_org_id, p_step,
--   p_elapsed_ms)` — SECURITY DEFINER writer.

-- ═══════════════════════════════════════════════════════════
-- 1 · swap_intake_plan
-- ═══════════════════════════════════════════════════════════

create or replace function public.swap_intake_plan(
  p_org_id        uuid,
  p_new_plan_code text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role       text;
  v_account_id uuid;
  v_onboarded  timestamptz;
  v_is_active  boolean;
begin
  v_role := public.effective_org_role(p_org_id);
  if v_role is null or v_role not in ('account_owner', 'org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_new_plan_code is null
     or p_new_plan_code not in ('starter', 'growth', 'pro')
  then
    raise exception 'plan_not_swappable: only starter / growth / pro are self-serve'
      using errcode = '22023';
  end if;

  select is_active into v_is_active
    from public.plans
   where plan_code = p_new_plan_code;
  if v_is_active is distinct from true then
    raise exception 'plan_code % is not active', p_new_plan_code
      using errcode = '22023';
  end if;

  select account_id, onboarded_at
    into v_account_id, v_onboarded
    from public.organisations
   where id = p_org_id;
  if v_account_id is null then
    raise exception 'org % not found', p_org_id using errcode = '42704';
  end if;
  if v_onboarded is not null then
    raise exception 'plan swap is only available during onboarding'
      using errcode = '22023';
  end if;

  update public.accounts
     set plan_code = p_new_plan_code
   where id = v_account_id;
end;
$$
-- ---statement-boundary---
revoke execute on function public.swap_intake_plan(uuid, text) from public, anon
-- ---statement-boundary---
grant  execute on function public.swap_intake_plan(uuid, text) to authenticated
-- ---statement-boundary---
comment on function public.swap_intake_plan(uuid, text) is
  'ADR-0058: in-wizard self-serve plan swap. onboarded_at-gated, whitelisted to starter/growth/pro.'
-- ---statement-boundary---
-- ═══════════════════════════════════════════════════════════
-- 2 · onboarding_step_events
-- ═══════════════════════════════════════════════════════════

create table if not exists public.onboarding_step_events (
  id          bigserial primary key,
  org_id      uuid        not null references public.organisations(id) on delete cascade,
  step        smallint    not null check (step between 1 and 7),
  elapsed_ms  int         not null check (elapsed_ms >= 0),
  occurred_at timestamptz not null default now()
)
-- ---statement-boundary---
alter table public.onboarding_step_events enable row level security
-- ---statement-boundary---
-- No customer-facing read / write policies — the table is written
-- via the SECURITY DEFINER RPC and read via an admin RPC (to be added
-- when an admin dashboard surface needs it). RLS-enabled with zero
-- policies is Rule 13 compliant.

create index if not exists onboarding_step_events_org_idx
  on public.onboarding_step_events (org_id, occurred_at desc)
-- ---statement-boundary---
create index if not exists onboarding_step_events_step_idx
  on public.onboarding_step_events (step, occurred_at desc)
-- ---statement-boundary---
-- ═══════════════════════════════════════════════════════════
-- 3 · log_onboarding_step_event
-- ═══════════════════════════════════════════════════════════

create or replace function public.log_onboarding_step_event(
  p_org_id     uuid,
  p_step       smallint,
  p_elapsed_ms int
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
begin
  v_role := public.effective_org_role(p_org_id);
  if v_role is null then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_step is null or p_step < 1 or p_step > 7 then
    raise exception 'invalid_step' using errcode = '22023';
  end if;
  if p_elapsed_ms is null or p_elapsed_ms < 0 then
    raise exception 'invalid_elapsed_ms' using errcode = '22023';
  end if;

  insert into public.onboarding_step_events (org_id, step, elapsed_ms)
  values (p_org_id, p_step, p_elapsed_ms);
end;
$$
-- ---statement-boundary---
revoke execute on function public.log_onboarding_step_event(uuid, smallint, int) from public, anon
-- ---statement-boundary---
grant  execute on function public.log_onboarding_step_event(uuid, smallint, int) to authenticated
-- ---statement-boundary---
comment on function public.log_onboarding_step_event(uuid, smallint, int) is
  'ADR-0058: append-only wizard step telemetry. Elapsed ms from step-enter to step-complete.'
