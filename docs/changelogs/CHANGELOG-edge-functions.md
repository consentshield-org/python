# Changelog — Edge Functions

Supabase Edge Function changes.

## ADR-0041 deprecation note — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox

### Deprecated
- `supabase/functions/run-consent-probes/index.ts` — static-HTML probe runner shipped in ADR-0016. Has a documented false-positive on inline-JS conditional loads. No cron invokes it after migration `20260425000003_probe_cron_vercel.sql`. Stays deployed for rollback; remove after a stable window with the v2 runner in production.

## ADR-0038 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0038 — Operational Observability
**Sprint:** 1.1 — watchdog + stuck-buffer Edge Functions

### Added
- `supabase/functions/check-cron-health/index.ts` — reads `public.cron_health_snapshot(24)`, flags jobs with ≥3 failures in 24h. For each qualifying job: one `audit_log` row with `event_type='operational_alert_emitted'` + one aggregated email via Resend. 20-hour dedup guard checks `audit_log.payload.alert_key='cron-health:daily'`. Deployed with `--no-verify-jwt`. Returns `{status: 'healthy'|'alerted'|'deduped', ...}`.
- `supabase/functions/check-stuck-buffers/index.ts` — calls `detect_stuck_buffers()` RPC; for any buffer table with `stuck_count > 0` older than 1h, writes one aggregated `audit_log` row + email. Same 20-hour dedup with `alert_key='stuck-buffers:hourly'`. Deployed with `--no-verify-jwt`.
- New optional Supabase secret `OPERATOR_ALERT_EMAIL`; falls back to `RESEND_FROM` when unset.

### Tested
- [x] `check-cron-health` smoke via `curl`: returns `{"status":"healthy","jobs_inspected":13}` (no job ≥3 failures).
- [x] `check-stuck-buffers` smoke: first call `{"status":"alerted","stuck_tables":8}` + writes `audit_log` row + sends email; second call within 20h `{"status":"deduped","stuck_tables":8}` (dedup guard honoured, no duplicate row).

## ADR-0022 Sprint 1.3 — 2026-04-17

**ADR:** ADR-0022 — `process-artefact-revocation` Edge Function + Revocation Dispatch
**Sprint:** Phase 1, Sprint 1.3 — Edge Function

### Added
- `supabase/functions/process-artefact-revocation/index.ts` — Deno Edge Function running as `cs_orchestrator`. Fans out an artefact revocation into `deletion_receipts` rows: one per active connector in `purpose_connector_mappings` scoped to the artefact's `purpose_definition_id`. For each mapping, computes `scoped_fields = intersection(mapping.data_categories, artefact.data_scope)` and inserts a `deletion_receipts` row with `trigger_type='consent_revoked'`, `trigger_id=<revocation_id>`, `artefact_id` populated, `status='pending'`, and `request_payload = { artefact_id, data_scope=scoped_fields, reason='consent_revoked', revocation_reason }`. Guards: artefact must be in `revoked` status (cascade trigger ran), revocation's `dispatched_at` must be NULL (idempotency fast-path). On success, atomically marks `artefact_revocations.dispatched_at = now()` with an `is(null)` guard. Handles `23505` unique violations (sibling invocation already wrote the receipt) by counting as skipped, not an error.

### Deployed
- `bunx supabase functions deploy process-artefact-revocation --no-verify-jwt` — hosted dev. Same JWT-verify pattern as `process-consent-event` and `sync-admin-config-to-kv` (the cron Authorization header is `Bearer cs_orchestrator_key`, a Vault-stored opaque token, not a real project JWT).

### Schema support
- `supabase/migrations/20260420000002_revocation_dispatch_grants.sql` — grants `cs_orchestrator` the two missing privileges needed by the function: `SELECT on artefact_revocations` (to fetch the row being dispatched) and `UPDATE (dispatched_at) on artefact_revocations` (to close the idempotency gate). These were not covered by ADR-0020's 20260418000005 which only granted INSERT for customer-initiated revocations.

### Tested
- [x] Smoke test via `curl` with fabricated IDs returns `200 { reason: 'revocation_not_found' }` — function reachable, auth chain intact, no crash.
- [x] `tests/depa/revocation-pipeline.test.ts` — 3/3 — PASS (10.4 cascade precision; 10.7 frozen chain raises; 10.10 sibling isolation). Duration 15.1s.
- [x] `bun run test:rls` — 10 files, **141/141** — PASS (baseline 138 post-ADR-0032 + 3 new). Duration 105.5s.

## ADR-0027 Sprint 3.2 — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 3, Sprint 3.2 — sync-admin-config-to-kv

### Added
- `supabase/functions/sync-admin-config-to-kv/index.ts` — reads the consolidated admin snapshot via `rpc('admin_config_snapshot')` using `CS_ORCHESTRATOR_ROLE_KEY`, PUTs the JSON blob to Cloudflare KV at `admin:config:v1` via the CF REST API. Returns `mode: 'wrote'` on success, `mode: 'dry_run'` (with the snapshot) when any of `CF_ACCOUNT_ID` / `CF_API_TOKEN` / `CF_KV_NAMESPACE_ID` are missing — lets operators preview what would sync before the infra credentials are set.

### Deployed
- `bunx supabase functions deploy sync-admin-config-to-kv --no-verify-jwt` — hosted dev. The cron sends a `Bearer cs_orchestrator_key` which is a valid project JWT, but the Edge Function's own auth is on the DB side (the orchestrator role key used by the Supabase client), not the incoming bearer. `--no-verify-jwt` matches the pattern used by `process-consent-event` (ADR-0021).

### Pending
- Supabase secrets to set for real (non-dry-run) sync: `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`. Operator task, not part of the ADR sprint.

## ADR-0021 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0021 — `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron
**Sprint:** Phase 1, Sprint 1.1

### Added
- `supabase/functions/process-consent-event/index.ts` — DEPA artefact fan-out. Reads a `consent_events` row, looks up the banner's purposes JSONB + matching `purpose_definitions`, inserts one `consent_artefacts` row per accepted purpose with `ON CONFLICT (consent_event_id, purpose_code) DO NOTHING`, populates `consent_artefact_index`, and updates `consent_events.artefact_ids` with a guarded update. Runs as `cs_orchestrator`. Deployed with `--no-verify-jwt` to accept the `sb_secret_*` Vault token used by the trigger + cron.

### Deployed
- `bunx supabase functions deploy process-consent-event --no-verify-jwt` — hosted dev.

### Tested
- [x] Direct smoke (`curl -X POST` with nonexistent event_id) — returns 200 `{skipped: true, reason: event_not_found}` — PASS
- [x] `tests/depa/consent-event-pipeline.test.ts` — 2/2 (artefact creation + idempotency under race) — PASS
- [x] Full `bun run test:rls` — 135/135 across 8 files — PASS

## ADR-0016 Sprint 1 — 2026-04-16

**ADR:** ADR-0016 — Consent Probes (static HTML analysis v1)
**Sprint:** Phase 1

### Added
- `supabase/functions/run-consent-probes/index.ts`: hourly probe
  runner. For each `consent_probes` row due for a run, fetches the
  property URL and inspects the HTML for tracker patterns (two-pass:
  structured `src`/`href` attributes first, then full-body substring
  match for URLs referenced in inline JS). Classifies detections
  against each tracker signature's `category`; flags violations when
  the tracker's category is not consented AND the signature is not
  functional. Inserts one row per run into `consent_probe_runs`;
  updates `consent_probes.last_run_at`, `last_result`, `next_run_at`
  based on `schedule`.
- Acknowledged v1 limitation: static analysis cannot distinguish
  conditional (`if (consented) { load() }`) from unconditional
  script loads when the URL appears in inline JS. A v2 follow-up
  with a headless-browser backend will handle this.

### Deployment
- `supabase functions deploy run-consent-probes --no-verify-jwt`.

### Tested
- [x] Live probe run: Demo Violator → 2 violations (GA4 + Meta Pixel),
  Demo Blog → 1 violation (GA4 referenced in conditional block —
  documented v1 false positive).

## ADR-0015 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0015 — Security Posture Scanner
**Sprint:** Phase 1, Sprint 1.1

### Added
- `supabase/functions/run-security-scans/index.ts`: nightly posture
  scan. For every `web_properties` row it fetches the URL over HTTPS
  and inspects response headers for HSTS, CSP, X-Frame-Options, and
  Referrer-Policy, plus TLS reachability. Emits one row per finding
  into `security_scans` (already a buffer table with the
  `cs_orchestrator` INSERT grant from migration 010). Writes
  `posture_finding` audit events for every non-info finding. Zero
  dependencies beyond `supabase-js`.

### Deployment
- `supabase functions deploy run-security-scans --no-verify-jwt`.

### Tested
- [x] Manual `net.http_post` — 200 OK, 18 findings from 6 properties.

## ADR-0011 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0011 — Deletion Retry and Timeout
**Sprint:** Phase 1, Sprint 1.1

### Added
- `supabase/functions/check-stuck-deletions/index.ts`: hourly
  retry/timeout engine for `deletion_receipts.status =
  'awaiting_callback'`. Decrypts connector config via per-org
  HMAC-SHA256 key derivation (Deno Web Crypto) + the `decrypt_secret`
  RPC. Re-POSTs to the customer webhook with the same signature
  contract the Next.js dispatcher uses. Backoff `[1h, 6h, 24h]`;
  after three failures, flips `status = 'failed'` and emits
  `deletion_retry_exhausted` to `audit_log`. Skips receipts whose
  `requested_at` is older than 30 days (beyond the DPDP SLA).
- `MASTER_ENCRYPTION_KEY` pushed to the Supabase Functions secrets
  via `supabase secrets set` — required for connector-config
  decryption inside Deno.

### Deployment
- `supabase functions deploy check-stuck-deletions --no-verify-jwt`.
  The `--no-verify-jwt` flag is currently required because the
  vault-stored `cs_orchestrator_key` is in the new `sb_secret_*`
  format, which the Edge Function gateway rejects with
  `UNAUTHORIZED_INVALID_JWT_FORMAT`. The same class of failure
  affects the four pre-existing HTTP cron jobs; captured as a
  known issue (see ADR-0011 Architecture Changes).

### Tested
- [x] Manually triggered via `select net.http_post(...)` using the
  vault orchestrator key. Response: `200 OK`,
  `{"ok":true,"scanned":0,"retried":0,"failed":0,"skipped":0}`.

## send-sla-reminders redeploy — 2026-04-16

### Changed
- Redeployed with `supabase functions deploy send-sla-reminders
  --no-verify-jwt`. Same reason as `check-stuck-deletions`: the
  vault-stored orchestrator key is in `sb_secret_*` format, which
  the gateway rejected as `UNAUTHORIZED_INVALID_JWT_FORMAT`. The
  function still authenticates against PostgREST with the same key
  at the data layer; only the gateway-level JWT check is skipped.
- Verified live: `net.http_post` → `200 OK, {"sent":0}`.

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
