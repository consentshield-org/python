-- Replace the pg_cron jobs once more. Migration 008 switched from literal
-- placeholders to `current_setting('app.cs_orchestrator_key', true)`, but
-- hosted Supabase forbids ALTER DATABASE / ALTER ROLE SET for arbitrary
-- GUC parameters. The correct host-compatible mechanism is Supabase Vault.
--
-- Operator one-time action (not in this migration — Vault secrets do not
-- belong in source control):
--     select vault.create_secret('<orchestrator key>', 'cs_orchestrator_key');

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
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
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
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
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
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
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
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cs_orchestrator_key' limit 1)
    )
  );
  $$
);
