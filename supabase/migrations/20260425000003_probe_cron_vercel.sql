-- ADR-0041 Sprint 1.3 — swap consent-probes-hourly to the Vercel orchestrator.
--
-- The static-HTML Supabase Edge Function run-consent-probes is deprecated
-- (ADR-0016 false-positive path). New target: the Next.js API route
-- /api/internal/run-probes which uses Vercel Sandbox + Playwright to load
-- each probe target in a real browser.
--
-- Depends on:
--   - Vault secret `vercel_app_url` — the base URL of the customer app's
--     Vercel deployment (e.g., https://app.consentshield.in). Create with:
--       select vault.create_secret(
--         'https://app.consentshield.in',
--         'vercel_app_url'
--       );
--   - Vault secret `probe_cron_secret` — the shared token the Next.js
--     route checks. Create with:
--       select vault.create_secret('<random 32+ byte hex>', 'probe_cron_secret');

-- Unschedule the old Supabase Edge Function target.
do $$ begin perform cron.unschedule('consent-probes-hourly');
exception when others then null; end $$;

-- Re-schedule pointing at the Vercel orchestrator.
select cron.schedule(
  'consent-probes-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'vercel_app_url' limit 1)
           || '/api/internal/run-probes',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'probe_cron_secret' limit 1),
      'Content-Type',  'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verification:
--   select jobname, schedule, active from cron.job
--    where jobname = 'consent-probes-hourly';
--    → 1 row, schedule '0 * * * *', active = true, command targets /api/internal/run-probes.
