-- ADR-1012 Sprint 1.3 — rpc_plans_list for GET /v1/plans.
--
-- Public tier metadata. No key-binding fence — anyone with a valid Bearer
-- can see the plan table, same semantics as /v1/_ping.
--
-- Filtered to is_active = true (inactive plans are a soft-delete signal;
-- never list them to API consumers). razorpay_plan_id deliberately
-- excluded — internal integration key; leak-avoidance.

create or replace function public.rpc_plans_list()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_items jsonb;
begin
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'plan_code',                  p.plan_code,
               'display_name',               p.display_name,
               'max_organisations',          p.max_organisations,
               'max_web_properties_per_org', p.max_web_properties_per_org,
               'base_price_inr',             p.base_price_inr,
               'trial_days',                 p.trial_days,
               'api_rate_limit_per_hour',    p.api_rate_limit_per_hour,
               'api_burst',                  p.api_burst
             )
             order by
               -- NULL prices (enterprise "talk to us") last; otherwise cheapest first.
               p.base_price_inr nulls last,
               p.plan_code asc
           ),
           '[]'::jsonb
         )
    into v_items
    from public.plans p
   where p.is_active = true;

  return jsonb_build_object('items', v_items);
end;
$$;

revoke all on function public.rpc_plans_list() from public;
revoke execute on function public.rpc_plans_list() from anon, authenticated;
grant execute on function public.rpc_plans_list() to cs_api;

comment on function public.rpc_plans_list() is
  'ADR-1012 Sprint 1.3 — /v1/plans. Lists active plans with public-facing '
  'fields (plan_code, display_name, limits, pricing, rate tier). '
  'razorpay_plan_id is NOT in the envelope — internal integration key.';
