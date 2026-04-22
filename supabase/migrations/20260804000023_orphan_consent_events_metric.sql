-- ADR-1004 Phase 3 Sprint 3.1 — orphan-consent-events metric + monitor cron.
--
-- "Orphan" here means a consent_events row whose artefact_ids array is
-- still empty 10+ minutes after insertion. The primary dispatch path
-- (ADR-0021 trigger_process_consent_event) fires on INSERT; the
-- safety-net cron retries every 5 minutes. If an event is still
-- orphaned at 10+ minutes, the dispatch pipeline has genuinely failed
-- for it.
--
-- This migration adds:
--   1. depa_compliance_metrics.orphan_count + orphan_window_* columns.
--   2. public.vw_orphan_consent_events — per-org orphan count in the
--      (10 min, 24 h) window.
--   3. refresh_orphan_consent_events_metric() — SECURITY DEFINER RPC
--      that upserts depa_compliance_metrics.orphan_count per org.
--   4. pg_cron schedule 'orphan-consent-events-monitor' every 5 min.
--
-- Notification-channel delivery (ADR-1004 Phase 3 Sprint 3.1 spec item
-- 3) is deferred to an ADR-1005 Phase 6 follow-up: the orphan metric
-- now lands in depa_compliance_metrics and is visible in the
-- Compliance Health widget (Sprint 3.2); hooking it into the Sprint
-- 6.1 NotificationAdapter dispatcher is the next sprint once the real
-- Slack/Teams/PagerDuty adapters land in 6.2/6.3.

-- ============================================================================
-- 1. Schema: depa_compliance_metrics.orphan_*
-- ============================================================================

alter table public.depa_compliance_metrics
  add column if not exists orphan_count          integer     not null default 0,
  add column if not exists orphan_computed_at    timestamptz,
  add column if not exists orphan_window_start   timestamptz,
  add column if not exists orphan_window_end     timestamptz;

comment on column public.depa_compliance_metrics.orphan_count is
  'ADR-1004 Phase 3 Sprint 3.1. Count of consent_events rows with empty '
  'artefact_ids in the (now() - 24h, now() - 10min) window. Updated '
  'every 5 minutes by refresh_orphan_consent_events_metric(). Non-zero '
  'means the ADR-0021 dispatch pipeline has genuinely failed for at '
  'least one event.';

-- ============================================================================
-- 2. View: vw_orphan_consent_events
-- ============================================================================

create or replace view public.vw_orphan_consent_events as
  select ce.org_id,
         count(*)::integer     as orphan_count,
         min(ce.created_at)    as oldest_orphan_at,
         max(ce.created_at)    as newest_orphan_at
    from public.consent_events ce
   where ce.artefact_ids = '{}'
     and ce.created_at between now() - interval '24 hours'
                           and now() - interval '10 minutes'
   group by ce.org_id;

comment on view public.vw_orphan_consent_events is
  'ADR-1004 Phase 3 Sprint 3.1. Per-org orphan consent_events in the '
  '10min..24h window. Consumed by refresh_orphan_consent_events_metric.';

grant select on public.vw_orphan_consent_events to authenticated, cs_orchestrator;

-- RLS is enforced at the underlying consent_events table. Views inherit
-- invoker semantics by default (security_invoker=true on PG ≥ 15; we
-- rely on that here because customers should only see their own rows
-- when reading the view directly from the dashboard if ever needed).
alter view public.vw_orphan_consent_events set (security_invoker = true);

-- ============================================================================
-- 3. Refresh RPC
-- ============================================================================

create or replace function public.refresh_orphan_consent_events_metric()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_window_start timestamptz := now() - interval '24 hours';
  v_window_end   timestamptz := now() - interval '10 minutes';
  v_upserts      integer     := 0;
  r              record;
begin
  -- Upsert one row per org. For orgs with NO orphans, set orphan_count=0
  -- on any existing metric row so stale non-zero values clear on their
  -- own. We don't INSERT zero rows for orgs that have never had a metric
  -- row — those get one via the nightly depa-score-refresh anyway.
  update public.depa_compliance_metrics m
     set orphan_count        = 0,
         orphan_computed_at  = now(),
         orphan_window_start = v_window_start,
         orphan_window_end   = v_window_end
   where not exists (
           select 1 from public.vw_orphan_consent_events v
            where v.org_id = m.org_id
         );

  -- Upsert actual orphan counts.
  for r in
    select org_id, orphan_count from public.vw_orphan_consent_events
  loop
    insert into public.depa_compliance_metrics as m (
      org_id, orphan_count, orphan_computed_at,
      orphan_window_start, orphan_window_end
    ) values (
      r.org_id, r.orphan_count, now(),
      v_window_start, v_window_end
    )
    on conflict (org_id) do update
      set orphan_count        = excluded.orphan_count,
          orphan_computed_at  = excluded.orphan_computed_at,
          orphan_window_start = excluded.orphan_window_start,
          orphan_window_end   = excluded.orphan_window_end;

    v_upserts := v_upserts + 1;
  end loop;

  return v_upserts;
end;
$$;

comment on function public.refresh_orphan_consent_events_metric() is
  'ADR-1004 Phase 3 Sprint 3.1. Refreshes depa_compliance_metrics.orphan_count '
  'from vw_orphan_consent_events. Scheduled every 5 minutes. Returns '
  'the count of orgs whose orphan metric was upserted.';

grant execute on function public.refresh_orphan_consent_events_metric()
  to authenticated, cs_orchestrator, service_role;

-- ============================================================================
-- 4. pg_cron schedule
-- ============================================================================

do $$ begin
  perform cron.unschedule('orphan-consent-events-monitor');
exception when others then null; end $$;

select cron.schedule(
  'orphan-consent-events-monitor',
  '*/5 * * * *',
  $$select public.refresh_orphan_consent_events_metric()$$
);

-- Verification:
--   select count(*) from pg_views where viewname = 'vw_orphan_consent_events';
--     -> 1
--   select count(*) from cron.job where jobname = 'orphan-consent-events-monitor';
--     -> 1
