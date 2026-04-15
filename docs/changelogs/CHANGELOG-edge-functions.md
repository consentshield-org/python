# Changelog — Edge Functions

Supabase Edge Function changes.

## S-7 remediation — 2026-04-14

### Changed
- `supabase/functions/send-sla-reminders/index.ts` — removed the silent
  `SUPABASE_SERVICE_ROLE_KEY` fallback. The function now throws at boot if
  `SUPABASE_ORCHESTRATOR_ROLE_KEY` is unset. Rule #5 prohibits running any
  Edge Function under the master key.

### Required operator action
- `supabase secrets set CS_ORCHESTRATOR_ROLE_KEY=<value>` before
  redeploying the function. (Supabase reserves the `SUPABASE_` prefix for
  its own managed secrets; the env var name was reverted to
  `CS_ORCHESTRATOR_ROLE_KEY` after the `supabase secrets set` command
  rejected the `SUPABASE_` variant.)

## 2026-04-15 — deployed

- `send-sla-reminders` deployed via `supabase functions deploy
  send-sla-reminders` with `CS_ORCHESTRATOR_ROLE_KEY` set. Boot-time
  check verified by `supabase functions logs send-sla-reminders`.
