-- ADR-0058 Sprint 1.3 — setter for organisations.onboarding_step.
--
-- Sprint 1.1 added the onboarding_step column (0..7) but no setter. The
-- wizard orchestrator advances this value after each step completes so
-- that a wizard refresh restores at the last completed step (the acceptance
-- criterion at the bottom of ADR-0058).
--
-- SECURITY DEFINER so the caller's raw UPDATE privilege on organisations
-- isn't required. Role gate mirrors update_org_industry
-- (ADR-0057 Sprint 1.1): effective_org_role in ('org_admin','admin') is
-- the minimum; account_owner inherits through effective_org_role.
--
-- The step value is clamped to the column's CHECK (0..7) with a clearer
-- error message.

create or replace function public.set_onboarding_step(
  p_org_id uuid,
  p_step   smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
begin
  if p_step is null or p_step < 0 or p_step > 7 then
    raise exception 'invalid_step: must be between 0 and 7' using errcode = '22023';
  end if;

  v_role := public.effective_org_role(p_org_id);
  if v_role is null or v_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  update public.organisations
     set onboarding_step = p_step,
         onboarded_at = case when p_step = 7 then coalesce(onboarded_at, now()) else onboarded_at end
   where id = p_org_id;
end;
$$
-- ---statement-boundary---
revoke execute on function public.set_onboarding_step(uuid, smallint) from public, anon
-- ---statement-boundary---
grant execute on function public.set_onboarding_step(uuid, smallint) to authenticated
-- ---statement-boundary---
comment on function public.set_onboarding_step(uuid, smallint) is
  'ADR-0058: wizard-progress setter. Stamps onboarded_at when p_step=7.'
