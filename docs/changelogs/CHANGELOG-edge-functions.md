# Changelog — Edge Functions

Supabase Edge Function changes.

## S-7 remediation — 2026-04-14

### Changed
- `supabase/functions/send-sla-reminders/index.ts` — removed the silent
  `SUPABASE_SERVICE_ROLE_KEY` fallback. The function now throws at boot if
  `SUPABASE_ORCHESTRATOR_ROLE_KEY` is unset. Rule #5 prohibits running any
  Edge Function under the master key.

### Required operator action
- `supabase secrets set SUPABASE_ORCHESTRATOR_ROLE_KEY=<value>` before
  redeploying the function.
