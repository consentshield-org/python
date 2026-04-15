-- Closes S-3 and S-12 from the 2026-04-14 review.
-- S-3: inbound webhook deduplication by event ID.
-- S-12: pg_cron jobs read the orchestrator key from a session setting
--       instead of a baked-in placeholder.

-- Migration role must be a member of cs_orchestrator (true for postgres
-- per migration 010).

-- -----------------------------------------------------------------------------
-- S-3: webhook_events_processed — tiny operational table that records every
-- event ID we have already acted on. Row lives forever (row count is small
-- compared to events, and the index keeps lookups O(log n)).
-- -----------------------------------------------------------------------------

create table if not exists webhook_events_processed (
  source       text not null,
  event_id     text not null,
  org_id       uuid,
  processed_at timestamptz not null default now(),
  primary key (source, event_id)
);

alter table webhook_events_processed enable row level security;

-- Read access: nobody via REST. cs_orchestrator needs select/insert for the
-- dedup check; granted here rather than via a policy to keep the table fully
-- locked down for authenticated/anon callers.
grant select, insert on webhook_events_processed to cs_orchestrator;

create or replace function public.rpc_webhook_mark_processed(
  p_source text,
  p_event_id text,
  p_org_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into webhook_events_processed (source, event_id, org_id)
    values (p_source, p_event_id, p_org_id)
    on conflict (source, event_id) do nothing;
  -- Returns true only if this call actually inserted the row (first time
  -- seeing this event ID). Returns false on replay.
  return found;
end;
$$;

alter function public.rpc_webhook_mark_processed(text, text, uuid) owner to cs_orchestrator;
revoke all on function public.rpc_webhook_mark_processed(text, text, uuid) from public;
grant execute on function public.rpc_webhook_mark_processed(text, text, uuid) to anon;

-- -----------------------------------------------------------------------------
-- S-12: replace the `<cs_orchestrator_key>` placeholder in the pg_cron
-- HTTP-calling jobs with a current_setting() read. The key is injected by
-- the operator once via:
--
--     alter database postgres set app.cs_orchestrator_key to '<actual key>';
--
-- cron jobs then read it via current_setting('app.cs_orchestrator_key', true).
-- -----------------------------------------------------------------------------

-- Unschedule the old jobs (idempotent: missing jobs are silently skipped).
do $$
begin
  perform cron.unschedule('stuck-buffer-detection-hourly');
  exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('sla-reminders-daily');
  exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('security-scan-nightly');
  exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('retention-check-daily');
  exception when others then null;
end $$;

select cron.schedule(
  'stuck-buffer-detection-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/check-stuck-buffers',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cs_orchestrator_key', true)
    )
  );
  $$
);

select cron.schedule(
  'sla-reminders-daily',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/send-sla-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cs_orchestrator_key', true)
    )
  );
  $$
);

select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-security-scans',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cs_orchestrator_key', true)
    )
  );
  $$
);

select cron.schedule(
  'retention-check-daily',
  '30 21 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/check-retention-rules',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cs_orchestrator_key', true)
    )
  );
  $$
);
