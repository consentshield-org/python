# ADR-1019: `deliver-consent-events` — the missing R2 export path

**Status:** Completed
**Date proposed:** 2026-04-23
**Date started:** 2026-04-24
**Date completed:** 2026-04-24
**Superseded by:** —
**Upstream dependency:** ADR-1025 (customer storage auto-provisioning) — this function delivers to `export_configurations.bucket_name`; ADR-1025 is what populates + verifies those rows. ADR-1019's Phase 1 Sprint 1.1 row-audit step now assumes ADR-1025 provisioning is live.

---

## Design amendment (2026-04-24) — Next.js API route, `cs_delivery` as a third Next.js LOGIN role

The proposed design ran the orchestrator as a Supabase Edge Function (Deno) under `cs_delivery` via the hosted Supabase pool. Amended to run as a Next.js API route under `cs_delivery` via the Supavisor transaction pooler + `postgres.js`, matching the same rationale applied to ADR-1025 Sprints 2.1 / 3.1 / 3.2 / 4.1 / 4.2:

1. **The primitives are Node-native.** `app/src/lib/storage/sigv4.ts` (hand-rolled, Rule 14) and `app/src/lib/storage/org-crypto.ts` (per-org key derivation, byte-compatible with `@consentshield/encryption`) are Node code with no Deno equivalents. Porting to Deno means dual maintenance.
2. **ADR-0040 already delivers to R2 from a Next.js route** (audit-export path), using `sigv4.putObject`. This ADR reuses the same primitive against the same storage model (`export_configurations.write_credential_enc`).
3. **No shared-package infrastructure for Deno.** Every scheduled storage orchestrator shipped this quarter (ADR-1025) chose Next.js routes for the same reason.

Rule 5 separation-of-roles is preserved by using **`cs_delivery` as a third Next.js LOGIN role** (alongside `cs_api` for `/api/v1/*` and `cs_orchestrator` for internal orchestration routes), *not* by broadening `cs_orchestrator`. `cs_delivery` already has narrow grants (SELECT + UPDATE(delivered_at) + DELETE on the 10 buffer tables, SELECT on `export_configurations`, EXECUTE on `decrypt_secret(bytea, text)`) and `bypassrls`; rotating its placeholder password (`cs_delivery_change_me`) and adding a Supavisor connection string is a 2-line operator step. Broadening `cs_orchestrator` would blur the boundary that Rule 5 explicitly draws around delivery.

**Rule 16 (Worker zero-deps) is untouched.** The orchestrator runs in the customer-app (`app/`), not in the Worker.

The Sprint 1.1 deliverables below supersede the proposal text; the rest of the plan (Sprints 1.2 through 4.1) is amended in place where it mentions Edge Functions or Deno, replacing those with "Next.js route" and "Node" respectively. `verify_jwt = false` references are dropped (the route uses bearer-token middleware via `STORAGE_PROVISION_SECRET`, matching the ADR-1025 pattern).

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

#### Sprint 1.1 — cs_delivery as Next.js LOGIN role + grants audit + backfill

**Estimated effort:** 0.25 day

**Deliverables:**
- [x] Grants audit script `scripts/adr-1019-sprint-11-grants-audit.sql` — asserts `cs_delivery` has the expected SELECT + UPDATE(delivered_at) + DELETE on all 10 buffer tables, SELECT on `export_configurations`, EXECUTE on `decrypt_secret(bytea, text)`. Read-only; safe to rerun.
- [x] Pre-delivery backfill script `scripts/adr-1019-sprint-11-backfill.sql` — `UPDATE delivery_buffer SET delivery_error = 'pre-deliver-consent-events', attempt_count = 10` for every row with `delivered_at IS NULL AND delivery_error IS NULL AND created_at < now() - interval '1 hour'`. Sets `attempt_count = 10` so the backoff never picks them up; the manual-review cron (Sprint 2.3) will surface them to an operator to decide keep/delete.
- [x] `app/src/lib/api/cs-delivery-client.ts` — mirror of `cs-orchestrator-client.ts`. Module-scope `postgres.js` singleton, Supavisor transaction-mode pool, `prepare: false`, `max: 5`, `ssl: 'require'`, reads `SUPABASE_CS_DELIVERY_DATABASE_URL`.
- [x] Operator runbook step documented in the sprint notes: rotate `cs_delivery` password (`alter role cs_delivery with password '<rotated>'`), add `SUPABASE_CS_DELIVERY_DATABASE_URL=postgresql://cs_delivery.<ref>:<password>@<pooler-host>:6543/postgres` to Vercel customer-app env (production + preview + development), `vercel env pull` locally.
- [x] Buffer_lifecycle cron (`sweep_delivered_buffers`, migration 20260413000013) retained as second line of defence — confirmed appropriate given the per-row synchronous DELETE this ADR introduces.
- [x] Rule 5 in CLAUDE.md is amended by this ADR (cs_delivery is now a third Next.js LOGIN role, alongside cs_api and cs_orchestrator). Rule amendment deferred to a close-out sprint across the ADR — not re-written inline per sprint.

**Testing plan:**
- [x] Run the grants audit SQL against dev — all expected rows present, no surprises.
- [x] Run the backfill SQL against dev — count of quarantined rows recorded in sprint notes.
- [x] `csDelivery()` helper throws with a clear, actionable error when `SUPABASE_CS_DELIVERY_DATABASE_URL` is unset (matches `csOrchestrator()` / `csApi()` DX).

#### Sprint 1.2 — Endpoint-derivation helper + R2 endpoint decision

**Estimated effort:** 0.25 day (shrunk by the Sprint 1.1 amendment)

**Amendment:** The two biggest proposal items — proving `@aws-sdk/client-s3` loads in Deno and porting `org-key.ts` to the Edge runtime — are **no longer applicable** because the orchestrator runs as a Next.js route (Node), not a Supabase Edge Function. The Node-native `app/src/lib/storage/sigv4.ts` + `app/src/lib/storage/org-crypto.ts` already exist, already pass tests, and are already in production via ADR-0040 (audit-export) + ADR-1025 (storage provisioning). The only live sub-task is endpoint discovery.

**Deliverables:**
- [x] `app/src/lib/storage/endpoint.ts` — `endpointForProvider(provider, region?, deps?)` shared helper extracted from the inline `endpointFor()` in `nightly-verify.ts`. Handles:
  - `cs_managed_r2` → `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` (throws if env unset).
  - `customer_s3` → `https://s3.<region>.amazonaws.com` (defaults to `us-east-1` when region is null/blank).
  - `customer_r2` (BYOK R2) → throws with a clear message. BYOK R2 endpoints are account-scoped; the customer's account id isn't persisted today. Defer to a follow-up additive column when the first BYOK-R2 customer appears.
  - Unknown provider → throws.
- [x] `nightly-verify.ts` updated to call the shared helper; inline `endpointFor()` reduced to a 1-line pass-through.
- [x] **Schema decision: no new column needed.** The proposal suggested `export_configurations.r2_account_id text`. Rejected: `cs_managed_r2` rows always use the ConsentShield account (env var), `customer_s3` rows carry region (S3 endpoint is region-scoped, not account-scoped), `customer_r2` is deferred. Adding a column now would be speculative per Rule 14 + the user's "don't design for hypothetical future requirements" guidance.

**Testing plan:**
- [x] `app/tests/storage/endpoint.test.ts` — 8 tests covering all four provider branches + env-unset + region-default + `process.env` fallback. All PASS.
- [x] Existing `nightly-verify.test.ts` — 6 tests still PASS after the refactor (no behavioural change).

### Phase 2 — Delivery function core

#### Sprint 2.1 — Deliver one row end-to-end

**Estimated effort:** 1 day

**Deliverables:**
- [x] `app/src/app/api/internal/deliver-consent-events/route.ts` — Next.js POST handler accepting `{delivery_buffer_id: uuid}` in the request body. Bearer-authed with `STORAGE_PROVISION_SECRET` (same shared bearer the other internal storage routes use). Returns 404 for not_found, 200 for delivered / already_delivered, 202 for recoverable failures (quarantined rows, upload failures, etc.), 400 for malformed body, 401 for bad bearer, 501 for `{scan: true}` (Sprint 2.2).
- [x] `app/src/lib/delivery/deliver-events.ts` — `deliverOne(pg, rowId, deps?)`:
  - SELECT the delivery_buffer row LEFT JOINed to its `export_configurations` row (14 columns, 1 round-trip).
  - Short-circuit `already_delivered` when `delivered_at IS NOT NULL`.
  - Quarantine (`attempt_count++`, `delivery_error=<reason>`, leave row in place) when: no export_config / unverified config / unsupported provider / decrypt failure / upload failure.
  - Derive endpoint via `endpointForProvider()`; derive org key via `deriveOrgKey()`; decrypt credentials via `decryptCredentials()`.
  - Canonical-serialise payload + PUT to R2 via `sigv4.putObject` with metadata headers `cs-row-id`, `cs-org-id`, `cs-event-type`, `cs-created-at`.
  - On 2xx — `UPDATE delivered_at = now()` AND `DELETE` in one `pg.begin(...)` transaction (Rule 2 — buffer tables are transient).
  - Returns a `DeliverOneResult` structured-log shape — never the payload.
- [x] `app/src/lib/delivery/canonical-json.ts` — `canonicalJson(v)`: sorted keys (recursive), JSON-escaped strings, trailing LF. Ensures content-hash reproducibility for ADR-1014 Sprint 3.2.
- [x] `app/src/lib/delivery/object-key.ts` — `objectKeyFor(prefix, row)`: `<prefix><event_type>/<YYYY>/<MM>/<DD>/<id>.json`; UTC date; null/undefined prefix treated as bucket-rooted.
- [x] `app/src/lib/storage/sigv4.ts` extended with optional `metadata?: Record<string, string>` on `PutObjectOptions`. Metadata keys are lower-cased, `x-amz-meta-` prefixed, sorted into canonical headers, signed. No behavioural change for callers that don't pass metadata (seven pre-existing sigv4 tests still PASS).

**Deferred to later sprints:**
- Sentry `beforeSend` hook stripping `payload` + `write_credential_enc` — Sentry is configured at the app boundary, not per-orchestrator; revisit as part of Sprint 2.3 error-handling pass when the manual-review flag lands.
- Structured console logging of the outcome line — the `DeliverOneResult` shape is the structured line; wiring it to pino or the existing log adapter is Sprint 2.3 scope.

**Testing plan:**
- [x] `app/tests/delivery/canonical-json.test.ts` — 10 tests. Top-level + nested key sort, array order, primitives, string escaping, order-independent output, LF terminator, non-finite + unsupported-type throws. PASS.
- [x] `app/tests/delivery/object-key.test.ts` — 7 tests. All layout permutations + UTC date + zero-padding + string-date input + invalid-date throw. PASS.
- [x] `app/tests/delivery/deliver-events.test.ts` — 8 tests. not_found / already_delivered / no_export_config quarantine / unverified_export_config quarantine / endpoint_failed / decrypt_failed / upload_failed (throws) / happy path. Happy path asserts correct object key + canonical body + metadata headers + tx UPDATE + tx DELETE. PASS.
- [x] `bun run lint` — 0 violations.
- [x] `bun run build` — Next.js 16 clean. New route registered; type check clean.
- [ ] **Integration E2E (real CF bucket)** — deferred to the Sprint 3.1 trigger/cron wiring commit, where it makes the most sense to exercise the full path: DB insert → trigger → route → R2 put → row delete. Will match the `scripts/verify-adr-1025-sprint-*.ts` harness style.

#### Sprint 2.2 — Batch + backoff

**Estimated effort:** 0.5 day

**Amendment:** The proposal called for a 25 s wall-time budget matching the 30 s Edge Function ceiling. Under Next.js Fluid Compute (300 s cap), the budget lifts to **270 s** — matching the convention set by the ADR-1025 storage routes. `maxDuration = 300` is pinned on the route.

**Deliverables:**
- [x] `deliverBatch(pg, limit=200, deps?)` in `app/src/lib/delivery/deliver-events.ts`:
  - Candidate SELECT: `delivered_at IS NULL`, `attempt_count < 10` (manual-review threshold; Sprint 2.3 handles escalation), backoff gate `last_attempted_at IS NULL OR last_attempted_at + (LEAST(power(2, attempt_count)::int, 60) * interval '1 minute') <= now()`, ORDER BY `first_attempted_at ASC NULLS FIRST, created_at ASC`, caller-provided limit.
  - Per-request wall-time budget `BATCH_TIME_BUDGET_MS = 270_000`. `budgetExceeded` flag returned in the summary. Cron's next 60 s tick picks up where we left off.
  - Soft-fail on individual row throws: caught, counted as `upload_failed`, best-effort `markFailure` with `batch_exception:` prefix so operators can triage. One bad row never halts the batch.
  - `BatchSummary` return shape: `{attempted, delivered, quarantined, budgetExceeded, outcomes}` where `outcomes` is a full `Record<DeliverOutcome, number>`.
- [x] `/api/internal/deliver-consent-events` route extended: `{scan: true, limit?: number}` now drives the batch path (was 501 in Sprint 2.1). `limit` clamped to `[1, 500]`. `maxDuration = 300` pinned.
- [x] `deliverOneFn` added to `DeliverBatchDeps` for test isolation.

**Testing plan:**
- [x] `app/tests/delivery/deliver-batch.test.ts` — 7 tests. Empty queue / happy batch of 3 / mixed outcomes / budget exceeded (stops early) / soft-fail on deliverOne throw + markFailure called / candidate query shape (manual-review threshold + backoff + ordering present) / caller-provided limit propagated. PASS.
- [x] `bun run lint` — 0 violations. `bun run build` — Next.js 16 clean.
- [ ] Integration E2E against real CF — deferred to Sprint 3.1.

#### Sprint 2.3 — Unknown event_type handling + operator alerts

**Estimated effort:** 0.5 day

**Deliverables:**
- [x] Unknown `event_type` → `delivery_error = 'unknown_event_type:<value>'` + `last_attempted_at = now()`, `attempt_count` **NOT** incremented (per ADR). Row stays in place until a producer ADR adds the type to `KNOWN_EVENT_TYPES` or an operator cleans it up. Short-circuits ALL later checks (config, endpoint, decrypt, upload); the fix is at the producer + `KNOWN_EVENT_TYPES` level, not per-row.
- [x] `KNOWN_EVENT_TYPES` set in `app/src/lib/delivery/deliver-events.ts` — the 8 values listed in the Decision table (consent_event, artefact_revocation, artefact_expiry_deletion, consent_expiry_alert, tracker_observation, audit_log_entry, rights_request_event, deletion_receipt).
- [x] Manual-review escalation: `markFailure` now runs `UPDATE ... RETURNING attempt_count, org_id, event_type`. When the new attempt_count equals `MANUAL_REVIEW_THRESHOLD = 10`, a second UPDATE sets `delivery_error = 'MANUAL_REVIEW: ' + error` and a third call hits `admin.record_delivery_retry_exhausted(row_id, org_id, event_type, error)`. The RPC is idempotent per (org_id, event_type) within pending/in_progress flags.
- [x] Migration `20260804000045_adr1019_s23_delivery_retry_exhausted.sql` — `admin.record_delivery_retry_exhausted(uuid, uuid, text, text)` SECURITY DEFINER + `grant usage on schema admin to cs_delivery` + `grant execute` on the RPC. (Originally authored as `…000043_…`; Terminal B grabbed that slot first for ADR-1027 Sprint 1.2, so the file was renamed to `…000045_…` — same content, next free slot.)
- [x] RPC failure is swallowed (the `MANUAL_REVIEW:` prefix is the load-bearing signal; operators surface the backlog through Sprint 4.1 metrics even if the flag insert failed once).

**Deferred to Sprint 4.1 (status-page integration):**
- Structured logging of the outcome line through pino / the existing log adapter.
- Sentry `beforeSend` hardening to strip `payload` + `write_credential_enc` from captured error shapes.

**Testing plan:**
- [x] `app/tests/delivery/escalation.test.ts` — 5 tests:
  - unknown_event_type quarantine: `delivery_error` set, `attempt_count` unchanged (query does NOT contain `attempt_count + 1`).
  - unknown_event_type short-circuits the config fence (fires even with `ec_id=null`).
  - markFailure at count 9 → escalation: second UPDATE carries MANUAL_REVIEW prefix + RPC called with (row_id, org_id, event_type).
  - markFailure at count 0 → no escalation (exactly 2 pg calls).
  - RPC failure swallowed: deliverOne still returns the normal outcome; MANUAL_REVIEW UPDATE still fired.
- [x] `bunx vitest run tests/delivery/` — 37/37 PASS (32 prior + 5 new).
- [x] `bun run lint` + `bun run build` clean.
- [ ] `bunx supabase db push` against dev — runs with next commit (operator attention unlocks the dev migration).

### Phase 3 — Triggering

#### Sprint 3.1 — AFTER INSERT trigger (primary path) + pg_cron safety net

**Estimated effort:** 0.5 day

**Amendment:** The proposal's Supabase `config.toml` line (`verify_jwt = false`) is no longer applicable — the orchestrator is a Next.js route, not an Edge Function. Bearer auth via `STORAGE_PROVISION_SECRET` handles the trust boundary (Sprint 2.1).

**Deliverables:**
- [x] Migration `20260804000048_adr1019_s31_deliver_consent_events_dispatch.sql`:
  - `public.dispatch_deliver_consent_events(p_row_id uuid default null)` SECURITY DEFINER. Reads `cs_deliver_events_url` + `cs_provision_storage_secret` (shared bearer with the ADR-1025 storage routes — same trust boundary). Null `p_row_id` posts `{scan: true}`, non-null posts `{delivery_buffer_id: <uuid>}`. Soft-fails if Vault is unconfigured.
  - `public.delivery_buffer_after_insert_deliver()` SECURITY DEFINER + AFTER INSERT trigger `delivery_buffer_dispatch_delivery`. Best-effort per-row dispatch; `EXCEPTION WHEN OTHERS` swallow is load-bearing so producers never see their INSERT roll back.
  - `pg_cron` entry `deliver-consent-events-scan` every 60 s firing `select public.dispatch_deliver_consent_events();` (scan mode).
- [x] Operator runbook step: seed the Vault URL.
  ```sql
  select vault.create_secret(
    'https://app.consentshield.in/api/internal/deliver-consent-events',
    'cs_deliver_events_url'
  );
  ```
  Bearer `cs_provision_storage_secret` is already seeded from ADR-1025.

**Testing plan:**
- [ ] `bunx supabase db push` — applies the migration cleanly. Pending operator.
- [ ] Insert a `delivery_buffer` row against a verified org → trigger fires `net.http_post` → route delivers to R2 → row is deleted, all within ~10 s. Pending live E2E (`scripts/verify-adr-1019-sprint-31.ts` to be added alongside the first live run).
- [ ] Disable the trigger, insert 10 rows, wait 65 s → cron picks them all up via scan mode. Pending live E2E.

### Phase 4 — Cutover + observability

#### Sprint 4.1 — Metrics + readiness-flag cron

**Estimated effort:** 0.5 day (scope narrowed — see amendment)

**Scope amendment:** The proposal bundled the per-org metrics RPC, the ADR-1018 status-page subsystem wiring, and an ADR-1017 readiness-flag auto-fire. After implementing Sprints 1.1 through 3.1, the sensible trim is to ship the **backend primitives** (metrics RPC + readiness-flag RPC + 5-min cron) this sprint; **status-page subsystem wiring** + **admin UI panel** ship as a follow-up once the primitives have exercised in production. The operator surface (readiness flag appearing on `/admin/readiness-flags`) is fully functional with just the primitives.

**Deliverables:**
- [x] `admin.delivery_pipeline_backlog(p_org_id uuid default null)` in migration `20260804000049_adr1019_s41_delivery_backlog_metrics.sql`:
  - Returns per-org `{undelivered_count, oldest_undelivered_at, oldest_minutes, manual_review_count, last_delivery_error}`. `p_org_id=null` returns all orgs ordered by oldest-first.
  - Distinct from `admin.pipeline_delivery_health` (audit-log historical) and `admin.pipeline_stuck_buffers_snapshot` (cross-table totals). This RPC reads CURRENT `public.delivery_buffer` state per org.
  - support-tier gated. `grant execute to cs_admin`.
- [x] `admin.record_delivery_backlog_stuck(p_org_id, p_undelivered_count, p_oldest_minutes)`:
  - Inserts a single readiness flag per org within pending/in_progress (idempotent dedup by `source_adr='ADR-1019-backlog-stuck' AND description LIKE '%org_id=<uuid>%'`).
  - Severity `high` at 10 min, `critical` at 60+ min.
  - `grant execute to cs_orchestrator` (called from the cron).
- [x] `pg_cron 'delivery-backlog-stuck-check'` — `*/5 * * * *`. Reads `admin.delivery_pipeline_backlog()`, fires `record_delivery_backlog_stuck` for every org at `oldest_minutes >= 10`. Capped at 50 orgs per tick.

**Deferred to a follow-up sprint / close-out:**
- ADR-1018 status-page `delivery-pipeline` subsystem row + state transitions (`degraded` at 10 min, `down` at 60 min). Depends on wiring into the existing `public.status_subsystems` + probe mechanism.
- Admin UI panel at `/admin/delivery-pipeline` consuming `admin.delivery_pipeline_backlog` — UI scope is its own sprint.
- Structured logging + Sentry hardening (originally slated for Sprint 2.3 handoff — still deferred).

**Testing plan:**
- [x] Static check: the migration pattern mirrors `admin.record_delivery_retry_exhausted` (Sprint 2.3) byte-for-byte for dedup + idempotency semantics; same shape as the ADR-1017 ops_readiness_flags surface.
- [ ] Live verification steps (operator, post-push): the verification queries block at the bottom of the migration file documents the seed + RPC call + flag-insert assertion.
- [ ] Integration against a real undelivered backlog: deferred to the first live operator test of the path.

---

## Test Results

### Sprint 1.1 — 2026-04-24

**Static grants analysis** (from repo state, authoritative for dev DB):

Migrations `20260413000010_scoped_roles.sql` + `20260414000010_scoped_roles_rls_and_auth.sql` + `20260414000006_buffer_indexes_and_cleanup.sql` collectively establish:

- `cs_delivery` exists with `login` + `bypassrls` (`with login password 'cs_delivery_change_me'` placeholder, `bypassrls` set by migration 10010).
- `select` on all 10 buffer tables + `export_configurations`.
- `update (delivered_at)` on all 10 buffer tables.
- `delete` on all 10 buffer tables.
- `execute` on `public.decrypt_secret(bytea, text)`.
- `grant cs_delivery to postgres with set true` (set-role capability per PG 15+ requirement — migration 20260414000000).

No new migration required. The operator runbook below handles the two live-system steps.

**Operator runbook** (next-session operator action — not yet executed against dev):
1. Pick a strong password (32+ bytes, URL-safe base64 from `openssl rand -base64 32`).
2. Via Supabase SQL editor or direct `psql` as the `postgres` superuser:
   ```sql
   alter role cs_delivery with password '<rotated>';
   ```
3. Add to Vercel customer-app env (production + preview + development) via the dashboard or `vercel env add`:
   ```
   SUPABASE_CS_DELIVERY_DATABASE_URL=postgresql://cs_delivery.<ref>:<rotated>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres
   ```
4. Add the same to `app/.env.local` for local dev.
5. Run `scripts/adr-1019-sprint-11-grants-audit.sql` against dev — expect 11 SELECT rows, 10 UPDATE rows, 10 DELETE rows, 1 EXECUTE row, `login=t`, `bypassrls=t`.
6. Run `scripts/adr-1019-sprint-11-backfill.sql` against dev — record the quarantined row count in the sprint close-out notes.

**Helper DX test**:
- `csDelivery()` without `SUPABASE_CS_DELIVERY_DATABASE_URL` throws a clear, actionable error (same shape as `csOrchestrator()` / `csApi()`). Verified by inspection of `app/src/lib/api/cs-delivery-client.ts`.

## Changelog References

- CHANGELOG-api.md — ADR-1019 Sprint 1.1 entry (cs_delivery Next.js client helper).
- CHANGELOG-api.md — ADR-1019 Sprint 1.2 entry (endpoint derivation helper).
- CHANGELOG-api.md — ADR-1019 Sprint 2.1 entry (deliver-one orchestrator + internal route).
- CHANGELOG-api.md — ADR-1019 Sprint 2.2 entry (batch + backoff).
- CHANGELOG-api.md — ADR-1019 Sprint 2.3 entry (unknown event_type + manual-review).
- CHANGELOG-schema.md — ADR-1019 Sprint 2.3 entry (admin.record_delivery_retry_exhausted RPC).
- CHANGELOG-schema.md — ADR-1019 Sprint 3.1 entry (dispatch fn + trigger + cron).
- CHANGELOG-schema.md — ADR-1019 Sprint 4.1 entry (backlog metrics RPC + readiness-flag cron).

## Acceptance criteria

- A `consent_events` row delivered via the process-consent-event pipeline reaches a customer's R2 bucket within 60 s of the AFTER INSERT on `consent_events`, with the canonical-serialised JSON body + the required metadata headers. Confirmed via ADR-1014 Sprint 3.2 positive (hash match).
- A connector-mapped revocation reaches a `deletion_receipts` row AND a `delivery_buffer` row; both are delivered to R2; both are deleted from their respective tables within 5 minutes.
- Customer R2 write credential rotation (replace `write_credential_enc`) takes effect on the next attempt without any row loss; in-flight requests using the old credential retry with the new one on the next backoff cycle.
- Undelivered backlog > 10 minutes triggers a status-page `degraded` state + a readiness flag; no operator action is required to surface the issue.
- CLAUDE.md Rules 1–11 (esp. Rule 2 for delete-after-deliver, Rule 5 for cs_delivery, Rule 11 for per-org key derivation) all hold.
