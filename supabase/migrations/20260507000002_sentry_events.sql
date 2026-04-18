-- ADR-0049 Phase 2 Sprint 2.1 — sentry_events ingestion.
--
-- Closes V2-S1. Sentry internal-integration webhooks post here; the
-- admin Security panel renders rows inline instead of link-out only.
--
-- Shape mirrors worker_errors + rate_limit_events:
--   * operational log (no org_id FK, non-customer-facing)
--   * RLS: INSERT to anon (webhook runs unauthenticated + HMAC-verified
--     at the route layer), no SELECT policy for customers, SELECT to
--     cs_admin for the SECURITY DEFINER RPC path.
--   * 7-day retention cron
--
-- Dedup: Sentry can retry a webhook delivery if the first attempt
-- times out. `sentry_id` is unique, so the route handler can upsert-
-- on-conflict and stay idempotent.

create table if not exists public.sentry_events (
  id            uuid        primary key default gen_random_uuid(),
  sentry_id     text        not null,
  project_slug  text        not null,
  level         text        not null check (level in ('fatal','error','warning','info','debug')),
  title         text        not null,
  culprit       text,
  event_url     text,
  user_count    int         not null default 0,
  payload       jsonb,
  received_at   timestamptz not null default now()
);

create unique index if not exists sentry_events_sentry_id_uniq
  on public.sentry_events (sentry_id);

create index if not exists sentry_events_received_idx
  on public.sentry_events (received_at desc);

create index if not exists sentry_events_project_level_idx
  on public.sentry_events (project_slug, level, received_at desc);

alter table public.sentry_events enable row level security;

-- No customer-facing SELECT policy. admin reads via SECURITY DEFINER
-- RPC only.
grant insert on public.sentry_events to anon, authenticated;
revoke update, delete on public.sentry_events from anon, authenticated;
grant select on public.sentry_events to cs_admin;

-- 7-day cleanup cron, 03:45 UTC (one minute after rate-limit cleanup).
do $$
begin
  perform cron.unschedule('sentry-events-cleanup-daily');
exception when others then null;
end $$;

select cron.schedule(
  'sentry-events-cleanup-daily',
  '45 3 * * *',
  $$delete from public.sentry_events where received_at < now() - interval '7 days'$$
);

-- ═══════════════════════════════════════════════════════════
-- admin.security_sentry_events_list
-- Returns rows over the window, newest first. The UI can group by
-- project+level client-side; the RPC keeps the row-level detail so
-- the deep-link to Sentry can point at the exact event.
-- ═══════════════════════════════════════════════════════════
create or replace function admin.security_sentry_events_list(
  p_window_hours int default 24
)
returns table (
  id            uuid,
  sentry_id     text,
  project_slug  text,
  level         text,
  title         text,
  culprit       text,
  event_url     text,
  user_count    int,
  received_at   timestamptz
)
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
begin
  perform admin.require_admin('support');
  if p_window_hours is null or p_window_hours < 1 or p_window_hours > 168 then
    raise exception 'p_window_hours must be between 1 and 168';
  end if;

  return query
  select se.id, se.sentry_id, se.project_slug, se.level,
         se.title, se.culprit, se.event_url, se.user_count, se.received_at
    from public.sentry_events se
   where se.received_at >= now() - (p_window_hours || ' hours')::interval
   order by se.received_at desc
   limit 500;
end;
$$;

grant execute on function admin.security_sentry_events_list(int) to cs_admin;

comment on function admin.security_sentry_events_list(int) is
  'ADR-0049 Phase 2.1. Reads public.sentry_events newest-first over '
  'p_window_hours (clamped [1,168]). support+.';
