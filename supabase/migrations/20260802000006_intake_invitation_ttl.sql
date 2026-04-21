-- ADR-0058 Sprint 1.1 — TTL cron for abandoned intake invitations.
--
-- Marketing + operator intakes carry a 14-day expiry on the
-- invitation row itself. This cron sweeps any that lapsed without
-- being accepted or revoked, deletes the row, and logs the event to
-- admin.admin_audit_log so operators can spot abandonment patterns.
--
-- Operator-issued member invites (origin='operator_invite') are NOT
-- swept here — those follow the original ADR-0044 cleanup rules
-- (revoke from admin UI; manual handling).
--
-- Schedule: nightly at 02:30 IST (21:00 UTC). Picked to sit between
-- the existing pg_cron jobs (DEPA refresh 19:30 UTC, security scans
-- 22:00 UTC) so failures are easier to attribute in the cron-health
-- dashboard.

create or replace function public.fn_sweep_expired_intake_invitations()
returns int
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_swept int := 0;
  r record;
begin
  for r in
    select id, invited_email, plan_code, origin, created_at, expires_at
      from public.invitations
     where origin in ('marketing_intake', 'operator_intake')
       and accepted_at is null
       and revoked_at is null
       and expires_at < now()
     for update
  loop
    insert into admin.admin_audit_log (
      admin_user_id, action, target_table, target_pk,
      org_id, old_value, reason
    ) values (
      null,                        -- system action
      'sweep_expired_intake',
      'public.invitations',
      r.id::text,
      null,
      jsonb_build_object(
        'email', r.invited_email,
        'plan_code', r.plan_code,
        'origin', r.origin,
        'created_at', r.created_at,
        'expires_at', r.expires_at
      ),
      'TTL elapsed without acceptance (ADR-0058 M6 sweep)'
    );

    delete from public.invitations where id = r.id;
    v_swept := v_swept + 1;
  end loop;

  return v_swept;
end;
$$;

revoke execute on function public.fn_sweep_expired_intake_invitations() from public;
revoke execute on function public.fn_sweep_expired_intake_invitations() from anon;
revoke execute on function public.fn_sweep_expired_intake_invitations() from authenticated;
grant execute on function public.fn_sweep_expired_intake_invitations() to cs_orchestrator;

comment on function public.fn_sweep_expired_intake_invitations() is
  'ADR-0058: nightly TTL sweep for abandoned marketing/operator intake invitations.';

-- pg_cron job. Idempotent: dropping + recreating preserves the schedule.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('adr-0058-sweep-intakes')
      where exists (select 1 from cron.job where jobname = 'adr-0058-sweep-intakes');
    perform cron.schedule(
      'adr-0058-sweep-intakes',
      '0 21 * * *',
      $cron$select public.fn_sweep_expired_intake_invitations();$cron$
    );
  end if;
end $$;
