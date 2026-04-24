-- ADR-1019 Sprint 4.1 — delivery-pipeline backlog metrics + stuck-backlog
-- auto-escalation.
--
-- Two surfaces:
--
--   · admin.delivery_pipeline_backlog(p_org_id uuid default null) — per-org
--     CURRENT delivery_buffer state: undelivered_count, oldest_undelivered_at,
--     oldest_minutes, manual_review_count, last_delivery_error. Feeds the
--     operator panel (UI wiring deferred) + the readiness-flag cron.
--     Distinct from admin.pipeline_delivery_health (audit-log history) and
--     admin.pipeline_stuck_buffers_snapshot (cross-table totals).
--
--   · admin.record_delivery_backlog_stuck(p_org_id uuid, ...) — idempotent
--     INSERT into admin.ops_readiness_flags when an org's backlog crosses
--     10 min. Dedup per org while the flag is pending/in_progress.
--
-- And a 5-min pg_cron job that reads the first and fires the second for
-- every org that qualifies.

-- ═══════════════════════════════════════════════════════════
-- 1/3 · admin.delivery_pipeline_backlog
-- ═══════════════════════════════════════════════════════════
create or replace function admin.delivery_pipeline_backlog(
  p_org_id uuid default null
)
returns table (
  org_id                 uuid,
  org_name               text,
  undelivered_count      bigint,
  oldest_undelivered_at  timestamptz,
  oldest_minutes         bigint,
  manual_review_count    bigint,
  last_delivery_error    text
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  with agg as (
    select
      db.org_id,
      count(*)                                      as undelivered_count,
      min(db.created_at)                            as oldest_undelivered_at,
      count(*) filter (where db.attempt_count >= 10) as manual_review_count,
      -- Surface the most recent delivery_error for this org (ordered by
      -- last_attempted_at) — operators can read it without digging into
      -- the buffer themselves.
      (
        select db2.delivery_error
          from public.delivery_buffer db2
         where db2.org_id = db.org_id
           and db2.delivered_at is null
           and db2.delivery_error is not null
         order by db2.last_attempted_at desc nulls last
         limit 1
      )                                             as last_delivery_error
    from public.delivery_buffer db
    where db.delivered_at is null
      and (p_org_id is null or db.org_id = p_org_id)
    group by db.org_id
  )
  select
    a.org_id,
    coalesce(o.name, '(deleted)') as org_name,
    a.undelivered_count,
    a.oldest_undelivered_at,
    extract(epoch from (now() - a.oldest_undelivered_at))::bigint / 60
                                                    as oldest_minutes,
    a.manual_review_count,
    a.last_delivery_error
  from agg a
  left join public.organisations o on o.id = a.org_id
  order by oldest_minutes desc nulls last, a.undelivered_count desc;
end;
$$;

comment on function admin.delivery_pipeline_backlog(uuid) is
  'ADR-1019 Sprint 4.1. Per-org snapshot of the current '
  'public.delivery_buffer state: undelivered_count, '
  'oldest_undelivered_at + oldest_minutes, manual_review_count '
  '(attempt_count >= 10), last_delivery_error. Pass p_org_id to scope '
  'to one org; null returns the full list ordered by oldest-first. '
  'support-tier gated.';

grant execute on function admin.delivery_pipeline_backlog(uuid) to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 2/3 · admin.record_delivery_backlog_stuck
-- ═══════════════════════════════════════════════════════════
-- Inserts a readiness flag when an org's undelivered backlog has been
-- stuck > 10 minutes. Dedup'd per org within pending / in_progress
-- flags — one open flag per org at a time.

create or replace function admin.record_delivery_backlog_stuck(
  p_org_id            uuid,
  p_undelivered_count bigint,
  p_oldest_minutes    bigint
)
returns boolean
language plpgsql
security definer
set search_path = admin, public, extensions, pg_catalog
as $$
declare
  v_existing_id uuid;
begin
  select id into v_existing_id
    from admin.ops_readiness_flags
   where status in ('pending', 'in_progress')
     and source_adr = 'ADR-1019-backlog-stuck'
     and description like '%org_id=' || p_org_id::text || '%'
   limit 1;

  if found then
    return false;
  end if;

  insert into admin.ops_readiness_flags (
    title, description, source_adr, blocker_type, severity, status, owner
  ) values (
    format('Delivery backlog stuck for %s min', p_oldest_minutes),
    format(
      'public.delivery_buffer rows for this org have not been delivered '
      'in over %s minutes (undelivered_count=%s). Check admin.delivery_pipeline_backlog(''%s'') '
      'for the last_delivery_error; if MANUAL_REVIEW: prefixes appear, '
      'that specific row is already surfaced via '
      'admin.record_delivery_retry_exhausted. Resolve by fixing the '
      'customer''s export_configurations row (credential rotation, '
      'bucket access, is_verified flag) or the cs_managed_r2 bucket '
      'state. org_id=%s',
      p_oldest_minutes,
      p_undelivered_count,
      p_org_id,
      p_org_id
    ),
    'ADR-1019-backlog-stuck',
    'infra',
    case
      when p_oldest_minutes >= 60 then 'critical'
      else 'high'
    end,
    'pending',
    'ops'
  );
  return true;
end;
$$;

comment on function admin.record_delivery_backlog_stuck(uuid, bigint, bigint) is
  'ADR-1019 Sprint 4.1. Called by the 5-min stuck-backlog cron when an '
  'org''s oldest undelivered row crosses 10 minutes. Idempotent per '
  'org within pending / in_progress flags. Severity escalates to '
  'critical at 60 minutes of backlog.';

grant execute on function admin.record_delivery_backlog_stuck(uuid, bigint, bigint)
  to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 3/3 · pg_cron 'delivery-backlog-stuck-check' — every 5 minutes
-- ═══════════════════════════════════════════════════════════
-- Fires the readiness flag for every org past the 10-min threshold.
-- Cron runs as superuser (pg_cron default); calls the SECURITY DEFINER
-- RPC which has the grant chain it needs.

do $$
begin
  perform cron.unschedule('delivery-backlog-stuck-check');
  exception when others then null;
end $$;

select cron.schedule(
  'delivery-backlog-stuck-check',
  '*/5 * * * *',
  $$
  select admin.record_delivery_backlog_stuck(
           b.org_id, b.undelivered_count, b.oldest_minutes
         )
    from admin.delivery_pipeline_backlog() b
   where b.oldest_minutes >= 10
   limit 50;
  $$
);

-- ═══════════════════════════════════════════════════════════
-- Verification queries (run after `bunx supabase db push`):
-- ═══════════════════════════════════════════════════════════
--
--   select * from admin.delivery_pipeline_backlog();
--     → zero rows when nothing is undelivered. When rows exist,
--       ordered by oldest-first with per-org aggregates.
--
--   select jobname, schedule, active from cron.job
--    where jobname = 'delivery-backlog-stuck-check';
--     → 1 row, '*/5 * * * *', active = true.
--
--   -- Live check: insert a probe row with created_at backdated 11 min
--   -- ago, run the cron body manually, assert a readiness flag appears:
--   insert into public.delivery_buffer (org_id, event_type, payload, created_at)
--   values ('<test-org-id>', 'audit_log_entry', '{"probe":true}', now() - interval '11 minutes');
--   -- then run the cron body:
--   select admin.record_delivery_backlog_stuck(b.org_id, b.undelivered_count, b.oldest_minutes)
--     from admin.delivery_pipeline_backlog() b
--    where b.oldest_minutes >= 10;
--   -- assert:
--   select title, severity, status from admin.ops_readiness_flags
--    where source_adr = 'ADR-1019-backlog-stuck' and status = 'pending';
