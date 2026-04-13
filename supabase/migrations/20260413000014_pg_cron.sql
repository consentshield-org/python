-- Migration 014: Scheduled Jobs (pg_cron)
-- NOTE: pg_cron must be enabled in Supabase dashboard (Database → Extensions) before running this.
-- All Edge Function calls use cs_orchestrator key, NOT service_role_key.

-- Sweep: every 15 minutes — clean orphaned delivered rows
select cron.schedule(
  'buffer-sweep-15min',
  '*/15 * * * *',
  $$ select sweep_delivered_buffers(); $$
);

-- Stuck detection: every hour — alert if delivery pipeline is broken
select cron.schedule(
  'stuck-buffer-detection-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/check-stuck-buffers',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- SLA reminders: daily at 08:00 IST (02:30 UTC)
select cron.schedule(
  'sla-reminders-daily',
  '30 2 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/send-sla-reminders',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- Security scan: daily at 02:00 IST (20:30 UTC previous day)
select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/run-security-scans',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- Retention check: daily at 03:00 IST (21:30 UTC previous day)
select cron.schedule(
  'retention-check-daily',
  '30 21 * * *',
  $$
  select net.http_post(
    url := 'https://xlqiakmkdjycfiioslgs.supabase.co/functions/v1/check-retention-rules',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);
