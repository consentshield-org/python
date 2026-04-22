# ADR-1019: `deliver-consent-events` Edge Function — the missing R2 export path

**Status:** Proposed
**Date proposed:** 2026-04-23
**Date completed:** —
**Superseded by:** —

---

## Context

### The gap

`docs/architecture/consentshield-definitive-architecture.md`, ADR-0022, ADR-0023, ADR-0012, and ADR-1014 all reference a `deliver-consent-events` Edge Function as the canonical path for exporting buffered rows to customer-owned R2 storage. The schema is in place — `public.delivery_buffer` (`id, org_id, event_type, payload jsonb, export_config_id, attempt_count, first/last_attempted_at, delivered_at, delivery_error, created_at`) has existed since migration `20260413000004_buffer_tables.sql`; `public.export_configurations` (`org_id, storage_provider, bucket_name, path_prefix, region, write_credential_enc, is_verified`) has existed since migration `20260413000003_operational_tables.sql`; `cs_delivery` role has SELECT + UPDATE(delivered_at) + DELETE privileges per migration `20260413000010_scoped_roles.sql`. **Only the function itself is missing.** `ls supabase/functions/` shows `process-consent-event` (DEPA artefact fan-out), `process-artefact-revocation`, `run-consent-probes`, et al. — but no `deliver-consent-events`.

This gap blocks:

- **ADR-1014 Sprint 3.2** — "Positive: valid event → buffer row → delivered → R2 object hash matches input payload" cannot run.
- **ADR-0022** — artefact revocation emits `deletion_receipts` rows marked `delivered_at IS NULL` that will never actually deliver.
- **ADR-0023** — the expiry pipeline stages `delivery_buffer` rows for `artefact_expiry_deletion` + `consent_expiry_alert` event_types that will never actually deliver.
- **Rule 4** — the customer's canonical compliance record is maintained in customer-owned R2 (ConsentShield's own buffer is transient). Today that promise is aspirational: buffer rows accumulate indefinitely (only the `buffer_lifecycle` cron deletes *delivered* rows; no undelivered row ever ages out to "delivered").

### Scoping constraints

- **CLAUDE.md Rule 1 / 2** — delivery is the lifecycle step that makes buffer rows disposable. Any implementation MUST mark `delivered_at` and issue the DELETE in the same transaction the confirmed upload resolves.
- **CLAUDE.md Rule 3** — this path carries `consent_events` / `tracker_observations` / `audit_log` payloads; it must never carry FHIR-shaped content. (Artefact revocation pipelines that could carry FHIR were already fenced at the producer via ADR-0022; this function's only duty is to export the scoped payload untouched.)
- **CLAUDE.md Rule 5** — must use `cs_delivery`. Never `service_role`, never `cs_worker`, never `cs_orchestrator`.
- **CLAUDE.md Rule 11** — customer R2 credentials in `export_configurations.write_credential_enc` are stored encrypted with a per-org key derived from `HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`. The function decrypts only in-memory, only while the request is in flight; no plaintext credential ever crosses a durable boundary.
- **CLAUDE.md Rule 18** — Sentry `beforeSend` must strip `delivery_buffer.payload`; only the exception class + delivery-target metadata (bucket, object key, attempt_count) may reach Sentry.

### Why now

Four open ADRs are stuck waiting for this function. The schema has been stable for ~10 days. Cloudflare R2 has an S3-compatible API with a Deno-compatible client (`@aws-sdk/client-s3` works in Supabase Edge Functions via esm.sh). The encryption primitives exist (`app/src/lib/encryption/org-key.ts`). Shipping this function is the single highest-unblock move in the pipeline track.

## Decision

Build `supabase/functions/deliver-consent-events/` as a Supabase Edge Function running under `cs_delivery`, invoked via (a) AFTER INSERT trigger on `delivery_buffer` (primary path — hybrid trigger+polling pattern per the `feedback_hybrid_trigger_over_polling` cerebrum note) and (b) pg_cron every 60 s (safety net for missed invocations). Per-row flow:

1. Row arrives via trigger or poll. Function reads `{id, org_id, event_type, payload, export_config_id}` — RLS + column grants enforce the read fence.
2. Function loads the `export_configurations` row for `org_id`. Refuses to proceed if `is_verified = false` — operator must have validated credentials before the function is willing to spend an upload attempt.
3. Function decrypts `write_credential_enc` using the per-org key. Payload is never logged; credential is only held in the request-scoped closure.
4. Function serialises `payload` to canonical JSON (sorted keys, UTF-8, LF-terminated) so content-hash comparisons are reproducible, then uploads to `<bucket>/<path_prefix>/<event_type>/<YYYY>/<MM>/<DD>/<row_id>.json` with `Content-Type: application/json; charset=utf-8`, `x-amz-meta-cs-row-id: <row.id>`, `x-amz-meta-cs-org-id: <row.org_id>`, `x-amz-meta-cs-event-type: <row.event_type>`, `x-amz-meta-cs-created-at: <ISO>` (no PII in metadata headers — row id + org id + event type + timestamp only).
5. On 2xx upload: `UPDATE delivery_buffer SET delivered_at = now()` **AND** `DELETE FROM delivery_buffer WHERE id = $1` in the SAME transaction. The `buffer_lifecycle` cron (migration `20260413000013`) still runs but is now the second line of defence, not the primary delete path.
6. On 4xx/5xx upload: `UPDATE delivery_buffer SET attempt_count = attempt_count + 1, last_attempted_at = now(), delivery_error = <sanitised error>`. Exponential backoff: next retry not before `first_attempted_at + 2^attempt_count minutes` (capped at 60 min). After `attempt_count >= 10`, row transitions to manual-review state and an operator alert fires (ADR-1018 status page + ADR-1017 readiness flag).

Exported event_types (current delivery_buffer producers):

| event_type | Producer ADR | Payload shape |
|---|---|---|
| `consent_event` | ADR-0021 (`process-consent-event` Edge Function stages after artefact creation) | `consent_events` row + linked `consent_artefacts[].id` |
| `artefact_revocation` | ADR-0022 (`process-artefact-revocation`) | `artefact_revocations` row + connector fan-out plan |
| `artefact_expiry_deletion` | ADR-0023 (`process-artefact-expiry`) | `data_scope` snapshot at expiry |
| `consent_expiry_alert` | ADR-0023 | advisory row (no enforcement side) |
| `tracker_observation` | Worker, batched | `tracker_observations` row |
| `audit_log_entry` | many | `audit_log` row |
| `rights_request_event` | ADR-0022 / rights workflow | `rights_request_events` row |
| `deletion_receipt` | ADR-0022 | `deletion_receipts` row |

Unknown `event_type` values must **not** error — the function logs a structured warning and marks the row `delivery_error = 'unknown_event_type:<value>'` without uploading. Producer ADRs add the event_type before writing; delivery tolerates lag.

## Consequences

### Enables

- ADR-1014 Sprint 3.2 positive (delivered → R2 object hash match) becomes testable. The E2E harness uploads to a per-fixture R2 bucket (or a MinIO container), reads the `delivery_buffer` row, confirms DELETE fired, fetches the R2 object, hashes it, compares to the canonical-serialised input.
- ADR-0022 + ADR-0023 downstream pipelines stop being aspirational — revocations and expiries actually reach customer storage.
- Rule 4 (customer owns the compliance record) is real rather than a promise.
- V2-BACKLOG entry `R2-exports-for-SaaS-customers` can close.

### New constraints

- **Per-org credential rotation** — `export_configurations.write_credential_enc` must be rotatable without downtime. The encrypted cell is replaced atomically; any in-flight request uses the old credential and retries with the new one on the next attempt. No cross-org key leakage because the per-org derivation key is distinct.
- **Export verification gate** — producers must not stage rows to a buffer for orgs without a verified `export_configurations` row. Gate TBD: either producer-side check (fail the operation) OR delivery-side refusal (rows accumulate in `unknown_event_type` state). Sprint 1.3 decides.
- **R2 outage posture** — a multi-hour R2 outage could grow `delivery_buffer` to millions of rows for active customers. Partition the index. `check_stuck_buffers` (existing cron) must be updated to include the new metric + page an operator when undelivered_count > 10k for any single org.

### New failure modes

- Credential-decrypt failure — the function must surface this as a deterministic error (not a silent retry loop). Manual operator intervention only.
- R2 bucket deleted / permissions revoked — 403/404 on upload; exponential backoff escalates to manual-review after ~6 hours. Operator alert.
- Payload contains FHIR-shaped content — impossible by Rule 3 at the producer, but if it ever happens, the function must refuse to upload and file an immediate ADR-1017 readiness flag. Defence in depth.

---

## Implementation Plan

### Phase 1 — Foundation

**Goal:** Confirm the schema + role + credential encryption primitives are actually shippable in a Deno Edge Function runtime.

#### Sprint 1.1 — Role + grants + migration sanity check

**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] Verify `cs_delivery` existing grants on `delivery_buffer` (SELECT + UPDATE(delivered_at) + DELETE) and `export_configurations` (SELECT) are correct for the planned flow. No new migration expected — but if one is needed, it ships here.
- [ ] Verify the buffer_lifecycle cron's `delivered_at IS NOT NULL AND delivered_at < now() - interval '5 minutes'` DELETE still makes sense given the per-row synchronous DELETE in this ADR's flow. (Answer: yes — cron becomes second line of defence against rows that hit the UPDATE but somehow skipped the DELETE.)
- [ ] Existing undelivered rows in the dev DB: audit + backfill `delivery_error = 'pre-deliver-consent-events'` so the first real delivery run doesn't try to re-upload ancient test fixtures.

**Testing plan:**
- [ ] `select role, grant_type, privilege_type from information_schema.role_table_grants where grantee = 'cs_delivery'` matches expected.

#### Sprint 1.2 — R2 SDK + credential decryption in Edge runtime

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Prove `@aws-sdk/client-s3@^3` loads in Supabase Edge Functions (Deno) via `https://esm.sh/@aws-sdk/client-s3@3.645.0` (or pinned version). Tree-shaken import: `S3Client`, `PutObjectCommand` only.
- [ ] Port `app/src/lib/encryption/org-key.ts` logic to the Edge runtime. Key derivation matches exactly (same inputs → same ciphertext). Test: encrypt a known plaintext in app code, decrypt in Edge Function, compare.
- [ ] Decide on R2 endpoint discovery: Cloudflare R2 uses `https://<account_id>.r2.cloudflarestorage.com`. `account_id` must be stored alongside the credential (schema addition) OR derived from the bucket (not reliable). Propose schema change: `export_configurations.r2_account_id text` — additive, nullable for non-R2 storage_providers.

**Testing plan:**
- [ ] Round-trip encrypt (app-side) → decrypt (Edge-side) on a 128-byte plaintext succeeds.
- [ ] Manual upload to a test R2 bucket with a known credential succeeds via the SDK from a local Deno REPL.

### Phase 2 — Delivery function core

#### Sprint 2.1 — Deliver one row end-to-end

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `supabase/functions/deliver-consent-events/index.ts` — request handler accepting `{delivery_buffer_id: uuid}` via body OR `{scan: true}` via body for the cron path. Calls `cs_delivery` pool (via `CS_DELIVERY_DATABASE_URL` matching the Vault-style pattern other Edge Functions use).
- [ ] `index.ts::deliverOne(id)` — (a) `SELECT` row with `export_config_id` join, (b) refuse if `is_verified=false`, (c) decrypt credential, (d) serialise payload canonically, (e) PUT to R2, (f) in one transaction `UPDATE delivered_at = now()` + `DELETE`.
- [ ] Structured logs: `{fn:'deliver-consent-events', row_id, org_id, event_type, bucket, object_key, attempt, duration_ms, outcome}` — never the payload.
- [ ] Sentry `beforeSend` hook stripping `payload` + `write_credential_enc` from any error capture.

**Testing plan:**
- [ ] Unit: given a mock row + mock S3 client that succeeds, function updates+deletes the row. Given a mock S3 that 403s, function increments attempt_count + preserves the row.
- [ ] Integration (requires R2 test credentials): seed a real `delivery_buffer` row on a test org with a verified export_config, invoke the function, assert R2 object exists with correct metadata headers + canonical-serialised body + assert the DB row is gone.

#### Sprint 2.2 — Batch + backoff

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] `index.ts::deliverBatch(limit=200)` — ORDER BY `first_attempted_at NULLS FIRST, created_at` (oldest undelivered first, never-attempted first). Respects per-row backoff: `first_attempted_at + LEAST(2^attempt_count, 60) * interval '1 minute' <= now()`.
- [ ] Per-request budget: max 200 rows per invocation, max 25 s total wall time (leaves 5 s headroom in the 30s Edge Function ceiling). Remaining rows picked up on the next cron tick.
- [ ] Soft-fail on individual row errors — one bad row does not halt the batch. Log + increment + move on.

**Testing plan:**
- [ ] Integration: seed 5 rows, invoke batch, assert 5 R2 objects + 5 DB deletes + 0 errors logged.
- [ ] Integration: seed 3 rows + 1 row with a broken export_config (unverified), invoke batch, assert 3 delivered, 1 remains with `delivery_error` set, `attempt_count > 0` on the broken row.

#### Sprint 2.3 — Unknown event_type handling + operator alerts

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Unknown `event_type` → log structured warning + set `delivery_error = 'unknown_event_type:<value>'` + leave row in place (no increment). Producer ADRs add the type first; delivery tolerates lag.
- [ ] After `attempt_count >= 10`, row transitions to manual-review: `delivery_error` prefixed with `MANUAL_REVIEW:`, `admin.ops_readiness_flags` row inserted with `blocker_type='infra'`, severity `high`, details include `{row_id, org_id, event_type, last_attempted_at}`. Dedupe by `(org_id, event_type, 'delivery_retry_exhausted')` so one alert per org per event_type at a time.

**Testing plan:**
- [ ] Inject a row with `event_type='bogus_test_type'` — assert log line + `delivery_error` populated + row not deleted.
- [ ] Simulate 10 failed attempts on a row — assert the readiness_flag appears exactly once (idempotent).

### Phase 3 — Triggering

#### Sprint 3.1 — AFTER INSERT trigger (primary path) + pg_cron safety net

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Migration `20260804NNNNNN_deliver_consent_events_trigger.sql`:
  - `trigger_deliver_consent_events()` — AFTER INSERT on `public.delivery_buffer` fires `net.http_post` to the function with `{delivery_buffer_id: NEW.id}`. Uses the existing `cs_orchestrator_key` Vault JWT pattern from `process-artefact-revocation`. Fail-silent (the cron catches any missed invocations).
  - `pg_cron` entry running `deliver-consent-events` every 60 s with `{scan: true}` — batch mode, 200-row budget, picks up anything the trigger missed.
- [ ] `supabase/config.toml` — `[functions.deliver-consent-events] verify_jwt = false` (matches the body-level-auth pattern other trigger-fired functions use; Supabase rotated the HS256 signing secret per Terminal B's 2026-04-22 notes).

**Testing plan:**
- [ ] `INSERT INTO delivery_buffer (…)` from psql → function fires within 5 s → row is delivered + deleted.
- [ ] Disable the trigger, insert 10 rows, wait 65 s → cron picks them all up.

### Phase 4 — Cutover + observability

#### Sprint 4.1 — Metrics + status-page integration

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Update `check_stuck_buffers` cron (existing) to surface per-org `undelivered_count`, `oldest_undelivered`, `last_delivery_error` metrics via an admin RPC.
- [ ] ADR-1018 status page — add `delivery-pipeline` subsystem. State flips to `degraded` when `undelivered_count > 1000` for any org or `oldest_undelivered > 10 minutes`; `down` when > 10k or > 1 hour.
- [ ] ADR-1017 readiness flag auto-fires when a single org crosses 10 min of undelivered backlog — actionable runbook link included.

**Testing plan:**
- [ ] Seed 1500 undelivered rows against a test org → status page shows `degraded` within one cron tick.
- [ ] Resolve the backlog → status flips back to `operational`.

---

## Test Results

_To be filled as sprints complete._

## Changelog References

_To be filled as sprints complete._

## Acceptance criteria

- A `consent_events` row delivered via the process-consent-event pipeline reaches a customer's R2 bucket within 60 s of the AFTER INSERT on `consent_events`, with the canonical-serialised JSON body + the required metadata headers. Confirmed via ADR-1014 Sprint 3.2 positive (hash match).
- A connector-mapped revocation reaches a `deletion_receipts` row AND a `delivery_buffer` row; both are delivered to R2; both are deleted from their respective tables within 5 minutes.
- Customer R2 write credential rotation (replace `write_credential_enc`) takes effect on the next attempt without any row loss; in-flight requests using the old credential retry with the new one on the next backoff cycle.
- Undelivered backlog > 10 minutes triggers a status-page `degraded` state + a readiness flag; no operator action is required to surface the issue.
- CLAUDE.md Rules 1–11 (esp. Rule 2 for delete-after-deliver, Rule 5 for cs_delivery, Rule 11 for per-org key derivation) all hold.
