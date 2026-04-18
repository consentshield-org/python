-- ADR-0050 Sprint 1 — admin.billing_account_summary
--
-- Per-account billing summary RPC. Returns three pieces:
--   · subscription_state — plan + effective plan + Razorpay identity +
--     period/trial end dates. No next-charge amount until Sprint 2
--     (invoice pipeline) knows how to compute it.
--   · plan_history — base plan (effective from account creation) + every
--     comp/override grant AND revocation as separate events in
--     chronological order. Source field is 'base' / 'comp' / 'override';
--     action field is 'granted' / 'revoked'.
--   · outstanding_balance_paise — 0 until Sprint 2 (no invoices yet).
--
-- Gated on admin.require_admin('support') per the same tier rules as the
-- rest of the billing read RPCs (ADR-0034 → ADR-0048). Future billing
-- write RPCs (ADR-0050 Sprint 2) will require platform_owner once that
-- tier lands in Sprint 2.1.

create or replace function admin.billing_account_summary(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_account          public.accounts%rowtype;
  v_plan             public.plans%rowtype;
  v_effective_plan   text;
  v_subscription     jsonb;
  v_plan_history     jsonb;
begin
  perform admin.require_admin('support');

  select * into v_account from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account % not found', p_account_id using errcode = 'P0002';
  end if;

  select * into v_plan from public.plans where plan_code = v_account.plan_code;
  v_effective_plan := public.account_effective_plan(p_account_id);

  v_subscription := jsonb_build_object(
    'plan_code',                v_account.plan_code,
    'effective_plan_code',      v_effective_plan,
    'plan_display_name',        v_plan.display_name,
    'base_price_inr',           v_plan.base_price_inr,
    'status',                   v_account.status,
    'current_period_ends_at',   v_account.current_period_ends_at,
    'trial_ends_at',            v_account.trial_ends_at,
    'razorpay_customer_id',     v_account.razorpay_customer_id,
    'razorpay_subscription_id', v_account.razorpay_subscription_id,
    'next_charge_amount_paise', null
  );

  with events as (
    select
      v_account.created_at as effective_from,
      v_account.plan_code  as plan_code,
      'base'::text         as source,
      'granted'::text      as action,
      null::uuid           as adjustment_id,
      null::uuid           as actor_user_id,
      null::text           as reason
    union all
    select
      pa.starts_at,
      pa.plan,
      pa.kind,
      'granted'::text,
      pa.id,
      pa.granted_by,
      pa.reason
    from public.plan_adjustments pa
    where pa.account_id = p_account_id
    union all
    select
      pa.revoked_at,
      pa.plan,
      pa.kind,
      'revoked'::text,
      pa.id,
      pa.revoked_by,
      null::text
    from public.plan_adjustments pa
    where pa.account_id = p_account_id
      and pa.revoked_at is not null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'effective_from', effective_from,
        'plan_code',      plan_code,
        'source',         source,
        'action',         action,
        'adjustment_id',  adjustment_id,
        'actor_user_id',  actor_user_id,
        'reason',         reason
      )
      order by effective_from asc
    ),
    '[]'::jsonb
  )
  into v_plan_history
  from events;

  return jsonb_build_object(
    'subscription_state',       v_subscription,
    'plan_history',             v_plan_history,
    'outstanding_balance_paise', 0
  );
end;
$$;

comment on function admin.billing_account_summary(uuid) is
  'ADR-0050 Sprint 1 — per-account billing summary. Subscription state, '
  'plan history (base + grants + revocations in chronological order), and '
  'outstanding balance (0 until Sprint 2 invoice pipeline).';

grant execute on function admin.billing_account_summary(uuid) to cs_admin;
