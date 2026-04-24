-- ADR-1027 Sprint 1.2 — admin.admin_dashboard_tiles() RPC.
--
-- Single round-trip returns everything the operator dashboard renders:
--
--   * Org-tier metrics — mirrors the existing admin.platform_metrics_daily
--     snapshot (total orgs, active orgs, consents, artefacts, rights,
--     worker errors, buffer age). Sourced from the same table so the
--     refresh cadence stays aligned with admin.refresh_platform_metrics().
--
--   * Account-tier metrics — computed live (low cardinality; public.accounts
--     is tens to thousands of rows). Sprint 1.2's additions:
--       - accounts_total        : count of all accounts
--       - accounts_by_plan      : [{plan_code, display_name, count}]
--       - accounts_by_status    : [{status, count}]
--       - orgs_per_account_p50  : p50 of count(organisations) grouped by account
--       - orgs_per_account_p90  : p90 of the same distribution
--       - orgs_per_account_max  : max of the same distribution
--       - trial_to_paid_rate_30d: percentage of accounts whose trial ended
--                                 in the last 30 days AND who are now
--                                 status = 'active' (paying)
--
-- Gated by admin.require_admin('support') — same tier as the existing
-- dashboard queries. No writes.

create or replace function admin.admin_dashboard_tiles()
returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_metrics         record;
  v_accounts_total  bigint;
  v_by_plan         jsonb;
  v_by_status       jsonb;
  v_orgs_p50        numeric;
  v_orgs_p90        numeric;
  v_orgs_max        bigint;
  v_trial_denom     bigint;
  v_trial_numer     bigint;
  v_trial_rate      numeric;
begin
  perform admin.require_admin('support');

  -- Latest platform_metrics_daily snapshot (may be null on a fresh DB).
  select *
    into v_metrics
    from admin.platform_metrics_daily
   order by metric_date desc
   limit 1;

  -- Account-tier counts.
  select count(*) into v_accounts_total from public.accounts;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'plan_code',    p.plan_code,
             'display_name', p.display_name,
             'count',        coalesce(c.n, 0)
           ) order by p.base_price_inr nulls last, p.plan_code
         ), '[]'::jsonb)
    into v_by_plan
    from public.plans p
    left join (
      select plan_code, count(*)::bigint as n
        from public.accounts
       group by plan_code
    ) c on c.plan_code = p.plan_code
   where p.is_active;

  select coalesce(jsonb_agg(
           jsonb_build_object('status', status, 'count', n)
           order by case status
             when 'trial'     then 1
             when 'active'    then 2
             when 'past_due'  then 3
             when 'suspended' then 4
             when 'cancelled' then 5
             else 6
           end
         ), '[]'::jsonb)
    into v_by_status
    from (
      select status, count(*)::bigint as n
        from public.accounts
       group by status
    ) s;

  -- Orgs-per-account distribution. Uses a CTE of counts grouped by
  -- account, then percentile_cont over that.
  with counts as (
    select count(*)::int as n
      from public.organisations
     group by account_id
  )
  select
      coalesce(percentile_cont(0.5) within group (order by n), 0),
      coalesce(percentile_cont(0.9) within group (order by n), 0),
      coalesce(max(n), 0)
    into v_orgs_p50, v_orgs_p90, v_orgs_max
    from counts;

  -- Trial-to-paid conversion over the last 30 days.
  -- Denominator: accounts whose trial_ends_at fell inside the last 30d
  --              (everyone who reached the trial-ending moment).
  -- Numerator:   subset of those whose status is now 'active' (paying).
  select count(*)
    into v_trial_denom
    from public.accounts
   where trial_ends_at is not null
     and trial_ends_at >= now() - interval '30 days'
     and trial_ends_at <  now();

  select count(*)
    into v_trial_numer
    from public.accounts
   where trial_ends_at is not null
     and trial_ends_at >= now() - interval '30 days'
     and trial_ends_at <  now()
     and status = 'active';

  v_trial_rate := case
    when v_trial_denom = 0 then null
    else round(100.0 * v_trial_numer / v_trial_denom, 1)
  end;

  return jsonb_build_object(
    'generated_at',    now(),
    'org_tier', case
      when v_metrics is null then null
      else jsonb_build_object(
        'metric_date',                v_metrics.metric_date,
        'refreshed_at',               v_metrics.refreshed_at,
        'total_orgs',                 v_metrics.total_orgs,
        'active_orgs',                v_metrics.active_orgs,
        'total_consents',             v_metrics.total_consents,
        'total_artefacts_active',     v_metrics.total_artefacts_active,
        'total_artefacts_revoked',    v_metrics.total_artefacts_revoked,
        'total_rights_requests_open', v_metrics.total_rights_requests_open,
        'rights_requests_breached',   v_metrics.rights_requests_breached,
        'worker_errors_24h',          v_metrics.worker_errors_24h,
        'delivery_buffer_max_age_min',v_metrics.delivery_buffer_max_age_min
      )
    end,
    'account_tier', jsonb_build_object(
      'accounts_total',           v_accounts_total,
      'accounts_by_plan',         v_by_plan,
      'accounts_by_status',       v_by_status,
      'orgs_per_account_p50',     v_orgs_p50,
      'orgs_per_account_p90',     v_orgs_p90,
      'orgs_per_account_max',     v_orgs_max,
      'trial_to_paid_rate_30d',   v_trial_rate,
      'trial_to_paid_numerator',  v_trial_numer,
      'trial_to_paid_denominator',v_trial_denom
    )
  );
end;
$$;

grant execute on function admin.admin_dashboard_tiles() to cs_admin;

comment on function admin.admin_dashboard_tiles() is
  'ADR-1027 Sprint 1.2. Single round-trip payload for the operator '
  'dashboard — both org-tier snapshot (from platform_metrics_daily) and '
  'account-tier live metrics (accounts by plan, orgs-per-account '
  'distribution, trial-to-paid conversion last 30d). support+.';

-- Verification:
--   select admin.admin_dashboard_tiles();
--   → jsonb envelope with org_tier + account_tier keys.
