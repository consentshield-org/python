# Changelog — API

API route changes.

## [ADR-1003 Sprint 1.2 — zero-storage event bridge] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.2

### Added — route
- `app/src/app/api/internal/zero-storage-event/route.ts` — bearer-authed POST on a new shared secret `WORKER_BRIDGE_SECRET`. Body: `{kind, org_id, event_fingerprint, timestamp, payload}`. Status mapping: uploaded=202, mode_not_zero_storage/no_export_config/unverified_export_config=409, decrypt_failed/endpoint_failed/upload_failed=502, bad input=400, bad bearer=401. Runs under `csOrchestrator()`.

### Added — orchestrator
- `app/src/lib/delivery/zero-storage-bridge.ts` — `processZeroStorageEvent(pg, req, deps?)`. Defensive stale-KV guard (re-reads `storage_mode` from the DB; refuses if not zero_storage). Reads `export_configurations`, decrypts credentials via `org-crypto`, canonicalises the payload via `canonical-json` (reusing ADR-1019 primitives), uploads to R2 via `sigv4.putObject` with metadata headers `cs-org-id`, `cs-kind`, `cs-event-fingerprint`, `cs-timestamp`. Object layout: `<path_prefix>zero_storage/<kind>/<YYYY>/<MM>/<DD>/<fingerprint>.json` — fingerprint is caller-supplied so Worker retries produce idempotent PUTs.

### Design amendment — bridge architecture
The proposal called for the Worker to invoke `process-consent-event` Edge Function directly. Amended to a Next.js bridge because (a) the Deno Edge Function can't use Node-native `sigv4.ts` / `org-crypto.ts` without porting, (b) ADR-1025's bridge pattern is the established convention for scheduled storage work. The canonical payload lands in customer R2 without any Edge Function detour.

### Trust boundary
`WORKER_BRIDGE_SECRET` is a **new** shared secret (Worker wrangler + Vercel env), distinct from `STORAGE_PROVISION_SECRET`. The two trust domains rotate independently. Worker→Next.js and pg_cron→Next.js stay separated.

### Tested
- `app/tests/delivery/zero-storage-bridge.test.ts` — 8 tests. stale-KV guard / no_export_config / unverified / endpoint_failed (customer_r2) / decrypt_failed / upload_failed (putObject throws) / happy path asserting correct object key + metadata headers + NO INSERT/UPDATE/DELETE in pg query log / unparseable timestamp falls back to now().
- `bun run lint` + `bun run build` + worker `bunx tsc --noEmit` — all clean.

### Operator follow-up
- Generate `WORKER_BRIDGE_SECRET` (32-byte hex). `wrangler secret put WORKER_BRIDGE_SECRET` (Worker) + `vercel env add WORKER_BRIDGE_SECRET` (Vercel customer-app project).
- `wrangler secret put ZERO_STORAGE_BRIDGE_URL=https://app.consentshield.in/api/internal/zero-storage-event`.
- `bunx supabase db push` for the Sprint 1.2 migration.
- Smoke: flip a test org → POST event → R2 bucket shows an object.

## [ADR-1003 Sprint 1.1 — storage-mode sync route + helpers] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.1

### Added — route
- `app/src/app/api/internal/storage-mode-sync/route.ts` — bearer-authed POST (shared `STORAGE_PROVISION_SECRET`). Reads `public.org_storage_modes_snapshot()` and PUTs the resulting jsonb to Cloudflare KV at key `storage_modes:v1` via the CF REST KV API. Returns `{ok, kv_key, org_count, payload_bytes, duration_ms}`. Triggered by the AFTER UPDATE trigger on `organisations.storage_mode` (per-change refresh) + the `storage-mode-kv-sync` pg_cron (60 s safety net).

### Added — helpers
- `worker/src/storage-mode.ts` — `getStorageMode(env, orgId)` + `isZeroStorage(env, orgId)` + `isStorageMode` type guard. Reads the bundled KV key, module-scope 60 s cache, fail-safe fallback to `'standard'` on any missing / malformed / unknown-org case. **Rule 16 intact** — zero npm deps.
- `app/src/lib/storage/mode.ts` — `getStorageMode(pg, orgId)` via `public.get_storage_mode`. No KV layer on the Next.js side — single indexed SELECT is cheaper than a CF round-trip and immediately correct.

### Tested
- `app/tests/worker/storage-mode.test.ts` — 13 tests. KV hit, miss, malformed value, unknown-org fallback, cache TTL honoured (one KV read covers many lookups), cache re-read after TTL, type guard, `isZeroStorage` branches. PASS.
- `app/tests/storage/mode.test.ts` — 5 tests. Type guard + RPC call shape + null/empty/unknown fallbacks. PASS.
- `bun run lint` clean. `bun run build` clean. `cd worker && bunx tsc --noEmit` clean.

### Deferred
- Sprint 1.2 (Worker write-path branches — `events.ts` / `observations.ts`): zero-storage bypass of `consent_events` + `tracker_observations` INSERT.
- Sprint 1.3 (Edge Function branches + invariant test): `process-consent-event` zero-storage path; tests/integration/zero-storage-invariant.test.ts.

## [ADR-1019 Sprint 2.3 — unknown event_type + manual-review escalation] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 2, Sprint 2.3

### Added — orchestrator
- `KNOWN_EVENT_TYPES` constant in `app/src/lib/delivery/deliver-events.ts` — the 8 event_type strings from the ADR Decision table (consent_event, artefact_revocation, artefact_expiry_deletion, consent_expiry_alert, tracker_observation, audit_log_entry, rights_request_event, deletion_receipt). Producers MUST add a type here before staging rows with it.
- Unknown event_type path: sets `delivery_error='unknown_event_type:<value>'` + `last_attempted_at=now()`, **does NOT bump attempt_count**, short-circuits the rest of deliverOne. Row stays visible until a producer ADR lands the type or an operator cleans it up.

### Changed — markFailure
- `markFailure` now runs `UPDATE … RETURNING attempt_count, org_id, event_type`. When the post-failure count equals `MANUAL_REVIEW_THRESHOLD = 10`, a second UPDATE sets `delivery_error = 'MANUAL_REVIEW: ' + error`, then `admin.record_delivery_retry_exhausted(...)` fires (best-effort — RPC failure is swallowed; the prefixed error is the load-bearing signal). Escalation fires exactly once per row because Sprint 2.2's candidate SELECT already excludes rows at/above the threshold.

### Tested
- `app/tests/delivery/escalation.test.ts` — 5 tests. Unknown-type quarantine, unknown-type short-circuits config fence, escalation triggers at count 10 (MANUAL_REVIEW UPDATE + RPC call shape verified), no escalation below 10, RPC failure swallowed without rolling back the MANUAL_REVIEW update.
- `bunx vitest run tests/delivery/` — 37/37 PASS (32 prior + 5 new).
- `bun run lint` + `bun run build` clean.
- Pre-existing Sprint 2.1 / 2.2 tests still PASS after the markFailure refactor (they stub `[]` for the RETURNING response → markFailure returns early → no escalation path on attempt_count=0 or 1).

### Schema
- Migration `20260804000045_adr1019_s23_delivery_retry_exhausted.sql` — `admin.record_delivery_retry_exhausted` RPC + grants. See CHANGELOG-schema.md.

### Deferred to Sprint 4.1
- Structured logging of the outcome line + Sentry `beforeSend` hardening.

## [ADR-1019 Sprint 2.2 — batch + backoff] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 2, Sprint 2.2

### Added — batch API
- `deliverBatch(pg, limit=200, deps?)` in `app/src/lib/delivery/deliver-events.ts`. Candidate SELECT respects the manual-review threshold (`attempt_count < 10`) and the exponential-backoff gate (`last_attempted_at + LEAST(power(2, attempt_count)::int, 60) * interval '1 minute' <= now()`). ORDER BY `first_attempted_at NULLS FIRST, created_at` — oldest-first. Per-request wall-time budget `270_000 ms` (matches ADR-1025 storage-route convention). Soft-fails on individual row throws: caught, counted as `upload_failed`, best-effort `markFailure` with `batch_exception:` prefix. One bad row never halts the batch.
- `DeliverBatchDeps` extends `DeliverDeps` with `deliverOneFn?: typeof deliverOne` for test isolation.
- `BatchSummary` return shape: `{attempted, delivered, quarantined, budgetExceeded, outcomes}` where `outcomes` is the full `Record<DeliverOutcome, number>`.

### Changed — route
- `/api/internal/deliver-consent-events` now accepts `{scan: true, limit?}` alongside `{delivery_buffer_id}`. `limit` clamped to `[1, 500]`. `export const maxDuration = 300` pinned to give the 270s batch budget headroom under Fluid Compute.

### Amendment
Proposal's 25 s budget targeted the 30 s Supabase Edge Function ceiling. Under Next.js Fluid Compute the hard cap is 300 s, so the budget lifts to 270 s — same figure the ADR-1025 storage orchestrators use.

### Tested
- `app/tests/delivery/deliver-batch.test.ts` — 7 tests. Empty queue / happy batch of 3 / mixed outcomes / budget exceeded (stops early) / soft-fail on deliverOne throw + markFailure called / candidate query shape / caller-provided limit. PASS.
- `bunx vitest run tests/delivery/` — 32/32 PASS (25 Sprint 2.1 + 7 Sprint 2.2).
- `bun run lint` + `bun run build` clean.

### Deferred to Sprint 2.3
- Unknown-event_type quarantine + manual-review escalation at `attempt_count >= 10` → readiness flag.
- Structured logging wiring (`DeliverOneResult` / `BatchSummary` through pino or the existing log adapter).
- Sentry `beforeSend` hardening to strip `payload` + `write_credential_enc` from error captures.

## [ADR-1019 Sprint 2.1 — deliver-one orchestrator + internal route] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 2, Sprint 2.1

### Added — orchestrator
- `app/src/lib/delivery/deliver-events.ts` — `deliverOne(pg, rowId, deps?)`. Single-round-trip SELECT + LEFT JOIN on `export_configurations`; quarantines rows with missing/unverified config, unsupported provider, decrypt failure, or upload failure (all set `delivery_error` + bump `attempt_count`; row kept for retry). On confirmed 2xx PUT, marks `delivered_at=now()` AND `DELETE` in a single `pg.begin(...)` transaction (Rule 2 — buffer tables are transient). Returns a structured `DeliverOneResult` shape, never the payload.
- `app/src/lib/delivery/canonical-json.ts` — `canonicalJson(v)` with recursive sorted keys, JSON-escaped strings, and a trailing LF. Content-hash reproducibility for ADR-1014 Sprint 3.2 positive.
- `app/src/lib/delivery/object-key.ts` — `objectKeyFor(prefix, row)` → `<prefix><event_type>/<YYYY>/<MM>/<DD>/<id>.json`. UTC date partition.

### Added — route
- `app/src/app/api/internal/deliver-consent-events/route.ts` — bearer-authed POST (`STORAGE_PROVISION_SECRET`). Accepts `{delivery_buffer_id: uuid}` in Sprint 2.1. `{scan: true}` returns 501 until Sprint 2.2 lands the batch path. Status-code mapping: `delivered|already_delivered`=200, `not_found`=404, recoverable failure (quarantine)=202, malformed body=400, bad bearer=401.

### Changed — sigv4
- `app/src/lib/storage/sigv4.ts` — `PutObjectOptions` gains an optional `metadata?: Record<string, string>`. Keys lower-cased and `x-amz-meta-`-prefixed, merged into the alphabetical canonical-headers block, and included in `SignedHeaders`. Pre-existing callers (verify probe, migrate, audit export) are unaffected — the 7 existing sigv4 unit tests still PASS.

### Tested
- `app/tests/delivery/canonical-json.test.ts` — 10 tests.
- `app/tests/delivery/object-key.test.ts` — 7 tests.
- `app/tests/delivery/deliver-events.test.ts` — 8 tests covering every `DeliverOutcome`; happy path verifies the canonical body, the correct object key, all four metadata headers, and the tx UPDATE + DELETE sequence.
- `bun run lint` — 0 violations. `bun run build` — Next.js 16 clean.
- Live E2E deferred to Sprint 3.1 where the trigger/cron wiring exercises the full round-trip.

### Deferred to Sprint 2.2+
- `deliverBatch(limit=200)` + exponential backoff — Sprint 2.2.
- Unknown event_type warning + manual-review escalation at `attempt_count >= 10` — Sprint 2.3.
- Sentry `beforeSend` hardening + structured logging wiring — Sprint 2.3 error-handling pass.

## [ADR-1019 Sprint 1.2 — endpoint derivation helper] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 1, Sprint 1.2

### Amendment
The proposal's Sprint 1.2 was about validating Deno-runtime viability (esm.sh SDK load + porting org-key.ts to Deno). After the Sprint 1.1 amendment moved the orchestrator to a Next.js route, both items became moot — the Node-native primitives already exist (ADR-0040 + ADR-1025). Sprint 1.2 reduces to the one live sub-task: where the S3-compatible endpoint comes from for each provider.

### Added — shared helper
- `app/src/lib/storage/endpoint.ts` — `endpointForProvider(provider, region?, deps?)`. Extracted from the inline `endpointFor()` in `nightly-verify.ts`. Provider rules: `cs_managed_r2` → `https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com` (throws if env unset); `customer_s3` → `https://s3.<region>.amazonaws.com` (defaults to `us-east-1`); `customer_r2` (BYOK R2) → throws with a clear message (account id not persisted today; additive column deferred until first BYOK-R2 customer); unknown → throws.

### Changed
- `app/src/lib/storage/nightly-verify.ts` — inline `endpointFor()` reduced to a 1-line pass-through to the shared helper.

### Schema decision
- The proposal suggested adding `export_configurations.r2_account_id text`. Rejected: speculative. `cs_managed_r2` uses the env-var account; `customer_s3` is region-scoped; `customer_r2` is deferred. Re-evaluate when the first BYOK-R2 customer is onboarded.

### Tested
- `app/tests/storage/endpoint.test.ts` — 8 tests (all four provider branches + env-unset + region-default + `process.env` fallback). PASS.
- `app/tests/storage/nightly-verify.test.ts` — existing 6 tests still PASS after the refactor.
- `bun run lint` — 0 violations.

## [ADR-1019 Sprint 1.1 — cs_delivery as third Next.js LOGIN role] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route (amended from Edge Function)
**Sprint:** Phase 1, Sprint 1.1

### Design amendment
Same revision applied to every scheduled storage orchestrator this quarter: Supabase Edge Function (Deno) → Next.js API route (Node). Rationale: `sigv4.ts` + `org-crypto.ts` are Node-native; ADR-0040 already delivers to R2 from a Next.js route using the same primitive. Rule 5 least-privilege separation is preserved by adding `cs_delivery` as a third Next.js LOGIN role (alongside `cs_api` for `/api/v1/*` and `cs_orchestrator` for internal orchestration), not by broadening `cs_orchestrator`.

### Added — client helper
- `app/src/lib/api/cs-delivery-client.ts` — `csDelivery()` returns a module-scope postgres.js singleton. Supavisor transaction-mode pool, `prepare: false`, `max: 5`, `ssl: 'require'`. Mirrors `cs-orchestrator-client.ts` exactly; only the env var + role differ. Used by the Sprint 2.1 orchestrator + `/api/internal/deliver-consent-events` route (to land in Sprint 2.1).

### Added — operator scripts
- `scripts/adr-1019-sprint-11-grants-audit.sql` — read-only; asserts `cs_delivery` has SELECT/UPDATE(delivered_at)/DELETE on all 10 buffer tables, SELECT on `export_configurations`, EXECUTE on `decrypt_secret(bytea, text)`, `login=t`, `bypassrls=t`. Idempotent; safe to rerun.
- `scripts/adr-1019-sprint-11-backfill.sql` — quarantines pre-existing undelivered rows (delivery_error='pre-deliver-consent-events', attempt_count=10) so the first real delivery run never re-uploads ancient test fixtures. Idempotent.

### Deferred to Sprint 2.1
- The orchestrator (`app/src/lib/delivery/deliver-events.ts`) and route (`/api/internal/deliver-consent-events`) are Sprint 2.1 deliverables. Sprint 1.1 ships the primitives.

### Tested
- Static grants analysis from migrations 20260413000010 + 20260414000010 + 20260414000006 confirms `cs_delivery` has all expected grants + role attributes. No new migration required.
- Helper DX: `csDelivery()` without the env var throws a clear, actionable error (same shape as `csOrchestrator()`).
- `bun run lint` — 0 violations on the new file.

### Operator follow-up (next session, pre-Sprint 2.1)
Password rotation + Vercel env addition + grants audit + backfill are operator runbook steps documented in ADR-1019 § Test Results.

## [ADR-1025 Sprint 4.2 — monthly storage usage snapshots + admin chargeback panel] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 4, Sprint 4.2

### Added — orchestrator
- `app/src/lib/storage/fetch-usage.ts` — `captureStorageUsageSnapshots(pg, deps?)`. Iterates every `cs_managed_r2` export_configurations row (joined with `public.accounts` + `public.plans` for plan code + ceiling), calls CF R2 usage API (`GET /accounts/{id}/r2/buckets/{bucket}/usage`), upserts a `storage_usage_snapshots` row per org. Captures `{payloadSize, metadataSize, objectCount}`. `over_ceiling` is computed server-side as a generated column on the table (`payload_bytes + metadata_bytes > plan_ceiling_bytes`, null-ceiling never over). 270 s time budget. Failures recorded on the snapshot row's `error_text` field so data gaps are visible in the admin widget.

### Added — route
- `app/src/app/api/internal/storage-usage-snapshot/route.ts` — bearer-authed POST (same `STORAGE_PROVISION_SECRET` as Sprint 2.1+). Driven by `pg_cron 'storage-usage-snapshot-monthly'` on the 1st of each month at 04:30 IST. Returns the summary for operator inspection.

### Added — admin surface
- `admin/src/app/(operator)/storage-usage/page.tsx` — server component. Pulls last 90 days of snapshots via `admin.storage_usage_snapshots_query` (support-tier gated SECURITY DEFINER RPC). Shows:
  - Aggregate stats card: orgs tracked / total bytes stored / estimated monthly cost at $0.015/GiB-month (CF R2 standard pricing, excludes Class A/B ops).
  - Per-org table: latest snapshot per org sorted by over-ceiling status first then by usage descending. Columns: Org, Plan, Bucket, Usage, Objects, Ceiling, Status (OVER/ok/error), Snapshot date.
  - Over-ceiling rows highlighted red.

### Tested
- `app/tests/storage/fetch-usage.test.ts` — 7 tests. Empty queue / happy path with over-ceiling classification / CF 500 recorded / CF success=false recorded / enterprise plan (null ceiling) never flagged over / budget_exceeded trip mid-sweep / missing CLOUDFLARE_ACCOUNT_ID throws.
- `bunx vitest run tests/storage/` — 115/115 PASS (108 pre-existing + 7 new).
- Lint clean: app 248 files, 0 violations; admin 0 violations. Both apps build clean.

### Scope boundary
- **Class A/B ops cost tracking deferred**: the `/usage` endpoint only returns storage metrics. Operation counts come from CF's GraphQL analytics API — separate integration. Storage dominates ≥95% of the monthly bill for ConsentShield's write-pattern, so storage-only tracking captures the load-bearing chargeback signal.
- **Razorpay line-item generation deferred**: manual chargeback for first customers; automated invoice line items land with the ADR-0050 billing rewrite.
- **Customer-facing usage display deferred**: the `org_select` RLS policy on `storage_usage_snapshots` is in place; a customer-facing widget on the dashboard storage panel is a small UI-only follow-up after the first monthly snapshot exists.

## [ADR-1025 Sprint 4.1 — nightly verify + rotation RPC + retention cleanup] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 4, Sprint 4.1

### Scope expansion vs the original ADR
The ADR scoped Sprint 4.1 to nightly verify + rotation RPC. Added the retention-cleanup cron that Sprint 3.2 deferred — all three storage-hygiene surfaces land together so the operational picture is complete in one sprint.

### Added — shared helper
- `app/src/lib/storage/org-crypto.ts` — consolidates `deriveOrgKey` / `decryptCredentials` / `encryptCredentials` / `normaliseBytea` used by the three new orchestrators. provision-org.ts + migrate-org.ts keep their inline copies for now (zero-risk — they'll consolidate in a later cleanup); this sprint's new modules use the shared helper.

### Added — orchestrator helpers
- `app/src/lib/storage/nightly-verify.ts` — `verifyAllVerifiedConfigs(pg, deps?)`. Reads every `is_verified=true` export_configurations row, decrypts creds via org-crypto, runs `runVerificationProbe`. On failure: atomic `is_verified=false` flip + `export_verification_failures` INSERT. Time budget 270 s (safe under Fluid Compute 300 s cap). Emits a summary `{checked, succeeded, failed, budget_exceeded, failures[]}`. One bad row doesn't stall the sweep.
- `app/src/lib/storage/rotate-org.ts` — `rotateStorageCredentials(pg, orgId, deps?)`. Mints a fresh bucket-scoped token for the existing CS-managed bucket, sleeps 5 s for CF edge propagation, probes with the new creds, encrypts + atomically swaps `write_credential_enc`, revokes the old token. Probe failure → revokes the **new** token, leaves old in place, records `last_rotation_error`. Encrypt failure → same rollback. Only valid for `cs_managed_r2` — BYOK rotation is the customer's responsibility. Returns `{rotated | not_eligible | not_found | failed}`.
- `app/src/lib/storage/retention-cleanup.ts` — `processRetentionCleanup(pg, deps?)`. Picks up to 50 storage_migrations rows where `mode='forward_only' AND state='completed' AND retention_until < now() AND retention_processed_at IS NULL`. Per row: mint fresh cleanup token → list + delete every object via sigv4 S3 API (hand-rolled ListObjectsV2 + existing `deleteObject`) → revoke cleanup token → DELETE bucket via CF REST API → mark `retention_processed_at`. Per-bucket failures record on `storage_migrations.error_text` without stalling the sweep.

### Added — routes
- `app/src/app/api/internal/storage-verify/route.ts` — bearer-authed POST. Calls `verifyAllVerifiedConfigs`; returns the summary. Called by pg_cron at 02:00 IST.
- `app/src/app/api/internal/storage-rotate/route.ts` — bearer-authed POST, `{org_id}` body. Calls `rotateStorageCredentials`. Invoked by the admin RPC dispatch.
- `app/src/app/api/internal/storage-retention-cleanup/route.ts` — bearer-authed POST. Calls `processRetentionCleanup`. Called by pg_cron at 03:00 IST.

### Auth chain
All three routes reuse `STORAGE_PROVISION_SECRET` (same trust boundary as Sprints 2.1 + 3.2). Three separate Vault URLs (one per route) let dispatch functions target the right endpoint; bearer is shared.

### Tested
- `app/tests/storage/nightly-verify.test.ts` — 6 tests. Zero rows / all-pass / probe failure triggers atomic flip + failure record / decrypt-error-as-failure (no throw) / budget_exceeded trip mid-sweep / unknown-provider surfaces endpoint-derivation error.
- `app/tests/storage/rotate-org.test.ts` — 6 tests. not_found / not_eligible (BYOK) / happy path / probe failure revokes NEW not OLD / encrypt failure rolls back / revoke-old failure swallowed as best-effort.
- `app/tests/storage/retention-cleanup.test.ts` — 6 tests. Empty queue / happy path / missing-bucket snapshot / bucket-delete 409 / cleanup-token mint failure / missing CLOUDFLARE_ACCOUNT_ID.
- `bunx vitest run tests/storage/` — 108/108 PASS (90 pre-existing + 18 new).
- `bun run lint` — 246 files, 0 violations. `bun run build` — Next.js 16 clean.
- 1 migration applied to dev Supabase; 3 Vault secrets seeded via postgres user.

### Scope boundary
Live E2E deferred until first-customer BYOK flow. The three surfaces exercise naturally: the nightly-verify cron runs every night against production rows once they exist; rotation is operator-triggered and safe to smoke-test manually; retention cleanup fires 30 days after any forward_only migration.

## [ADR-1025 Sprint 3.2 — storage migration orchestrator + customer migrate route + status polling] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 3, Sprint 3.2

### Design amendment
Same revision as Sprint 2.1 + 3.1: Supabase Edge Function (Deno) → Next.js API route (Node). The chunk chain is driven by `public.dispatch_migrate_storage` + `net.http_post`; each route invocation processes one chunk then self-fires the next. `pg_cron` re-kicks stuck migrations every minute. Mode names aligned: `cutover_forward_only` → `forward_only`.

### Added — routes
- `app/src/app/api/internal/migrate-storage/route.ts` — POST bearer-authed (reuses `STORAGE_PROVISION_SECRET`). Calls `processMigrationChunk`; on `in_flight` self-schedules the next chunk via `pg``select public.dispatch_migrate_storage(...)```.
- `app/src/app/api/orgs/[orgId]/storage/byok-migrate/route.ts` — customer-facing initiator. Auth chain: `requireOrgAccess(['org_admin'])` → body/Turnstile/schema validation → `runVerificationProbe` against the supplied target creds → encrypt via `public.encrypt_secret` + org-derived key → INSERT `storage_migrations` row with `to_credential_enc`. The AFTER INSERT trigger fires the first chunk dispatch automatically. Returns `{migration_id, mode}`.
- `app/src/app/api/orgs/[orgId]/storage/migrations/[migrationId]/route.ts` — customer-facing GET for status polling. Reads via the authed Supabase client + `org_select` RLS policy. Returns `{id, state, mode, objects_total, objects_copied, started_at, completed_at, error_text}`.

### Added — orchestrator library
- `app/src/lib/storage/migrate-org.ts` — `processMigrationChunk(pg, migrationId, deps?)`. Two modes:
  - **`forward_only`**: probe target → atomic transaction swaps `export_configurations` (storage_provider, bucket_name, region, write_credential_enc, is_verified=true) + marks `storage_migrations` completed with `retention_until = now + 30 days` (Phase 4 cron will delete the old CS-managed bucket at that point) + wipes `to_credential_enc`.
  - **`copy_existing`**: first-chunk probe → loop `ListObjectsV2` from source → per-key `presignGet + fetch + putObject` up to CHUNK_OBJECT_LIMIT (200 objects) or CHUNK_TIME_BUDGET_MS (240 s) whichever hits first. Progress committed every 20 objects so a crash mid-chunk only loses up to 20 copies. When the list returns empty/untruncated → atomic cutover.
  - **Resume**: every iteration writes `last_copied_key`; next chunk invocation re-lists with `start-after=<last_copied_key>` so already-copied objects aren't re-copied.
  - **Credential decrypt**: inline HMAC-SHA256 key derivation (matches `@consentshield/encryption.deriveOrgKey`) + `public.decrypt_secret` via direct SQL. cs_orchestrator already has EXECUTE on the function from the initial pgcrypto migration.
- Hand-rolled sigv4 for `ListObjectsV2` (not in `sigv4.ts` which only has per-object helpers). Same signing primitives as the existing `deriveSigningKey` / `formatAmzDate` / `sha256Hex`.

### Updated
- `app/src/app/(dashboard)/dashboard/settings/storage/_components/byok-form.tsx` — Sprint 3.1's form expanded with a stage machine: `entering → validating → validated → migrating → done` (+ `probe_failed` / `transport_failed` branches). Validated stage shows a mode picker (forward_only / copy_existing) with explanatory copy. Migrating stage polls the status endpoint every 3 s. Secret is wiped from form state immediately after the `byok-migrate` POST succeeds — the server already has the encrypted copy by then. Turnstile resets on every terminal state so the user has to re-solve for another attempt.

### Tested
- `app/tests/storage/migrate-org.test.ts` — 10 tests, 146 ms. Not-found + two terminal-short-circuit guards; forward_only happy + probe-rejection failure + already-copying skip-transition; copy_existing zero-objects → direct cutover, truncated → in_flight, resume-from-cursor (no probe on re-entry); null-guard when `to_credential_enc` is wiped.
- `app/tests/storage/byok-migrate-route.test.ts` — 17 tests, 155 ms. Happy path (migration_id returned, credentials never in response body) + 3 auth branches + 8 × missing-field + invalid-provider + invalid-mode + Turnstile failure (probe never runs) + probe failure (zero DB writes) + exclusion-constraint 409.
- `bunx vitest run tests/storage/` — 90/90 PASS (63 pre-existing + 27 new).
- Lint + build clean: 239 files, 0 violations, Next.js 16 build 0 errors / 0 warnings.

### Scope boundary
- **Live E2E deferred** until a customer has BYOK creds to test with. Same reason as Sprint 3.1 — validation/migration can't be meaningfully exercised without real third-party storage credentials.
- **Retention cleanup cron** (actually deleting the CS-managed bucket after 30 days): covered by the `retention_until` column landing now, but the delete-after-retention cron ships in Phase 4 Sprint 4.1 alongside the nightly verify cron (same storage-hygiene cadence).
- **Admin-triggered migration** (`admin.storage_migrate` RPC) is implemented in this sprint; the admin-console UI panel to call it ships in a later admin-surface sprint.

## [ADR-1025 Sprint 3.1 — BYOK credential validation route + settings UI] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 3, Sprint 3.1

### Design amendment
Original ADR called for a Postgres RPC `admin.byok_validate_credentials`. Revised to a Next.js-only route — the verification probe (PUT/GET/sha256/DELETE via sigv4) is Node-native and can't run inside Postgres. Same rationale as the Sprint 2.1 amendment. The route owns auth, Turnstile, rate-limit, and the probe call; no DB writes happen in Sprint 3.1 (persistence lands in Sprint 3.2's migration Edge Function).

### Added — route
- `app/src/app/api/orgs/[orgId]/storage/byok-validate/route.ts` — POST, Node runtime. Auth chain: `requireOrgAccess(['org_admin'])` (account_owner folds to org_admin via `effective_org_role`, ADR-0044) → body parse → `verifyTurnstileToken` → `checkRateLimit('byok-validate:<user_id>', 5, 60)` → `runVerificationProbe` in-process against the supplied credentials. Returns `{ok: true, probe_id, duration_ms}` (HTTP 200) on success or `{ok: false, failed_step, error}` (HTTP 200 — structured failure) on probe rejection. Transport errors (401/403/429/400) have plain JSON envelopes. Credentials stay in request memory only; never logged, never persisted by this route.
- `app/src/app/(dashboard)/dashboard/settings/storage/page.tsx` — server component. Shows current `export_configurations` row (provider label + bucket + region + status badge). Gates the BYOK form on `effective_org_role === 'org_admin'`; non-owners see a notice directing them to the account owner. Orgs already on BYOK see a "contact support for rotation" notice (rotation is a migration concern handled in Sprint 3.2 + Sprint 4.1).
- `app/src/app/(dashboard)/dashboard/settings/storage/_components/byok-form.tsx` — client component. Provider selector (R2 / S3) with sensible per-provider defaults, bucket, region, endpoint, access_key_id, secret_access_key fields. Turnstile rendered via the shared `window.turnstile` API (same `Window` interface augmentation the rights-request form uses). On `ok=true`: green "Credentials validated" panel with probe id + round-trip ms, form locks, secret wiped from state, Turnstile reset. On `ok=false`: red panel naming the failed step + error + plain-English "common fixes" copy. Transport failures render amber panels.

### Reused (no new shared helpers)
- `@/lib/auth/require-org-role` — role gate with account_owner → org_admin folding (ADR-0044).
- `@/lib/rights/turnstile` — server-side Turnstile verification.
- `@/lib/rights/rate-limit` — Upstash-Redis-backed rate limiter, 5/hour per user. Dev fallback: in-memory counter with a one-time warning.
- `@/lib/storage/verify.runVerificationProbe` — the 4-step PUT/GET/sha256/DELETE probe from Sprint 1.3, re-used verbatim.

### Tested
- `app/tests/storage/byok-validate-route.test.ts` — Vitest, 18 tests, 214 ms. Module-mocks the four collaborators + drives `POST()` directly with hand-built Request objects. Coverage: happy path + credential-absence-from-response assertion; three auth rejection branches; Turnstile failure; rate-limit 429 with `Retry-After`; rate-limit key is scoped per-user (asserted); invalid JSON; 7 × missing-required-field; invalid-provider; probe-failure passthrough with credential-absence assertion.
- `bunx vitest run tests/storage/` — 63/63 PASS (45 pre-existing + 18 new).
- Lint + build clean: 235 files scanned, 0 violations; Next.js 16 build 0 errors / 0 warnings.

### Scope boundary
Sprint 3.1 is the **validation** step. It never writes to `export_configurations` — Sprint 3.2 owns the migration Edge Function that copies objects + swaps the pointer. The "Ready to migrate" success panel is a stub that sets up the next-sprint handoff. Manual smoke against real third-party credentials is deferred to Sprint 3.2 close-out (first-customer BYOK flow) because the route can't be meaningfully exercised without real creds.

## [ADR-1025 Sprint 2.1 — customer-storage auto-provisioning orchestrator + /api/internal/provision-storage] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 2, Sprint 2.1

### Design revision vs the ADR's original shape
The ADR originally proposed a Supabase Edge Function (Deno) for the provisioning orchestrator. Revised to a Next.js API route (Node) because `cf-provision.ts` / `verify.ts` / `sigv4.ts` are Node-native; porting them to Deno means dual-maintenance (no shared `@consentshield/storage` package yet). Precedent: ADR-1017's probe orchestrator made the same move. Auth (cs_orchestrator direct-Postgres via `csOrchestrator()`) and idempotency guarantees are unchanged. Provisioning runs once per org at signup — Fluid Compute's ~300 ms cold start is immaterial.

### Added
- `app/src/lib/storage/provision-org.ts` — pure orchestrator helper. `provisionStorageForOrg(pg, orgId, deps?)` runs the 7-step flow: short-circuit-if-verified → createBucket → createBucketScopedToken → 5 s propagation → runVerificationProbe → encrypt + UPSERT export_configurations → flip is_verified. On probe failure: records to `public.export_verification_failures`, best-effort revokes the fresh token, returns without writing credentials. All I/O goes through the injected `pg` client + cf-provision + verify — dep-injection surface for full unit-test coverage. Inline HMAC-SHA256 key derivation matches `@consentshield/encryption.deriveOrgKey` so ciphertext round-trips through `decryptForOrg` on the read path.
- `app/src/app/api/internal/provision-storage/route.ts` — thin Next.js POST route (Node runtime, `force-dynamic`). Pattern mirrors `/api/internal/invitation-dispatch`: `STORAGE_PROVISION_SECRET` bearer, JSON body `{org_id}`, returns `{status, config_id, bucket_name, probe?}`. Maps `CfProvisionError` codes to HTTP statuses (auth/config → 500, transient → 502). Verification-failure is reported as a 200 with `status: 'verification_failed'` — it's a recorded outcome, not a transport error.
- `scripts/verify-adr-1025-sprint-21.ts` — live E2E harness. Seeds fixture account + org via service-role Supabase client, deletes stale `export_configurations` row, calls `provisionStorageForOrg` twice, asserts status transitions `provisioned` → `already_provisioned` + DB state (`storage_provider='cs_managed_r2'`, `bucket_name` matches `deriveBucketName(org_id)`, `is_verified=true`, non-empty `write_credential_enc`). All 4 steps green in 13.38 s against real CF + real Supabase dev DB.
- `STORAGE_PROVISION_SECRET` — new 32-byte base64 secret in `.secrets`, `.env.local`, `app/.env.local`. Vault seed is operator-action (see CHANGELOG-schema).

### Changed
- Unit test infra: two TS fixups from the Sprint 1.2 amendment — cast `makeFetchMock`'s return to `typeof fetch & {mock: ...}` so tsc accepts it as a `fetchFn` arg; cast `deps.runVerificationProbe` to `ReturnType<typeof vi.fn>` in the probe-arg assertion. Runtime tests were always green; these just satisfy `tsc --noEmit` in tests/.

### Tested
- `cd app && bunx vitest run tests/storage/` — 45/45 PASS in 319 ms. New: 9 provision-org tests (happy path; two idempotency branches; two probe-failure branches; two config-error branches; two CF-error-propagation branches).
- `bunx tsx scripts/verify-adr-1025-sprint-21.ts` — 4 steps PASS in 13.38 s. Real CF bucket `cs-cust-ac2660b366c0091817c8` (derived from fixture org_id), real probe (1512 ms), real encrypted credential persisted to `public.export_configurations`.
- Lint clean: `bun run lint` → 231 files, 0 violations.

### Scope boundary
Sprint 2.1 proves the orchestration pipeline against real infrastructure. The trigger-path (AFTER INSERT on data_inventory → net.http_post → route) is wired in `supabase/migrations/20260804000036_provision_storage_dispatch.sql` and applied to the dev DB but will remain dormant until the operator seeds two Vault secrets: `cs_provision_storage_url` (reachable app URL) + `cs_provision_storage_secret` (matches `STORAGE_PROVISION_SECRET`). Until then, `dispatch_provision_storage` soft-returns NULL on missing vault — the trigger no-ops silently, and the 5-minute safety-net cron catches the backlog once seeded. Sprint 2.2 builds the customer-facing UI surfaces (Step-7 soft banner + dashboard storage panel); Sprint 4.1 adds the nightly verify cron + rotation RPC; Phase 3 adds the BYOK escape hatch.

## [ADR-1025 Sprint 1.2 amendment — /user/tokens endpoint + two-token architecture + live E2E verification] — 2026-04-23

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 1, Sprint 1.2 (amendment to commit 9c4f06c)

### Why this amendment
The first live end-to-end run (`scripts/verify-adr-1025-sprint-11.ts` against the real CF account) surfaced that Sprint 1.2's `createBucketScopedToken` was implemented against a hypothetical `/accounts/{id}/r2/tokens` endpoint that does not exist. CF R2 bucket-scoped S3 credentials are minted via the **general user-level account-API-tokens endpoint** (`POST /user/tokens`) with a specific policy shape, then derived from the response. Mocked unit tests didn't catch this — they matched the hypothetical shape. Only running against CF surfaced the 404. Per the docs-vs-code-drift memory, amending Sprint 1.2 in place rather than opening a new sprint.

### Changed — cf-provision.ts
- `createBucketScopedToken` now hits `POST /user/tokens` (user-level auth, `CLOUDFLARE_API_TOKEN` / `cfut_` prefix) with a policy payload: `policies=[{effect:"allow", resources:{com.cloudflare.edge.r2.bucket.<account>_default_<bucket>: "*"}, permission_groups:[{id:"2efd5506f9c8494dacb1fa10a3e7d5b6"}]}]` (Workers R2 Storage Bucket Item Write, covers object read/write/delete on a single bucket). Derives S3 credentials from the response: `access_key_id = result.id`, `secret_access_key = sha256hex(result.value)`. The raw token `value` is discarded after hashing — never persisted.
- `revokeBucketToken` now hits `DELETE /user/tokens/{id}` with user-level auth (was `/accounts/{id}/r2/tokens/{id}` which 404s).
- `cfFetch` gains an `auth: 'account' | 'user'` parameter (defaults to `'account'`). `createBucket` / `revokeBucket` use `'account'` against the cfat_ token; `createBucketScopedToken` / `revokeBucketToken` use `'user'` against the cfut_ token.
- `requireEnv` now reads BOTH `CLOUDFLARE_ACCOUNT_API_TOKEN` (R2 bucket CRUD) and `CLOUDFLARE_API_TOKEN` (token mint/revoke). Clear error if either is missing.

### Two-token architecture (platform constraint, not design choice)
CF enforces this at the protocol level: `/user/tokens` strictly requires user-level auth and rejects account tokens with `9109 Valid user-level authentication not found` regardless of scopes. `/accounts/{id}/r2/buckets` strictly requires account-level auth. There's no single credential that covers both. The two tokens are:
- `CLOUDFLARE_ACCOUNT_API_TOKEN` (cfat_) — account-level, scope `R2 Storage:Edit`. Bucket CRUD.
- `CLOUDFLARE_API_TOKEN` (cfut_) — user-level, scopes `User API Tokens:Edit` + `Workers R2 Storage:Edit`. Token mint/revoke via /user/tokens. Shared with existing KV-invalidation + wrangler deploy uses.

### Tested
- `app/tests/storage/cf-provision.test.ts` — rewritten unit tests: 20 tests (was 18). New assertions: endpoint path must be `/user/tokens` (not `/accounts/{id}/...`), Authorization header carries the correct per-call token, body shape matches the CF policy format, `secret_access_key = sha256hex(result.value)`, raw `value` never surfaces in the returned envelope. Config-missing coverage for both tokens. `cd app && bunx vitest run tests/storage/` — 29/29 PASS in 146 ms.
- `scripts/verify-adr-1025-sprint-11.ts` — new live E2E harness. 7 steps against the real CF account: derive bucket name → create bucket (APAC) → mint bucket-scoped token → 5-second propagation wait → run verification probe (1358 ms PUT/GET/hash/DELETE) → revoke token → poll up to 60 s for revocation to reach the R2 edge (took ~6 s) → sweep bucket via a fresh cleanup token + hand-rolled sigv4 ListObjectsV2 → delete bucket. All 7 steps PASS in 24.67 s. Script is idempotent — rerun against the same fixture org_id reuses the same bucket name and cleans up every stray.

### Operational notes discovered during live E2E
- **Token propagation delay:** newly-minted bucket-scoped tokens take ~5 s to reach the R2 edge before S3 sigv4 PUT succeeds. ADR-1025 Phase 2 Sprint 2.1's Edge Function must sleep ≥ 5 s after `createBucketScopedToken` (or retry the verification probe with backoff) before reporting provisioning success.
- **Revocation propagation delay:** `DELETE /user/tokens/{id}` returns 200 immediately, but the R2 edge takes another ~5-10 s to reject sigv4 requests from the revoked credential. Not a correctness issue for ADR-1025 — the production flow revokes a token only as part of BYOK migration (ADR-1025 Phase 3) where the window is closed by a separate cutover barrier, or during rotation (Phase 4 Sprint 4.1) where overlap is fine.
- **CF docs' S3-credential derivation is accurate:** `access_key_id = token.id` + `secret_access_key = sha256hex(token.value)`. No extra steps. Hex encoding (not base64).

## [ADR-1025 Sprint 1.1 — CF account API token + STORAGE_NAME_SALT provisioned; env-var rename] — 2026-04-23

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 1, Sprint 1.1

### Operator work (completed)
- Minted a new account-level Cloudflare API token `CLOUDFLARE_ACCOUNT_API_TOKEN` (`cfat_` prefix) carrying `Account → R2 Storage → Edit`. Stored in `.secrets`, `.env.local`, `app/.env.local`.
- Verified scope: `curl -H "Authorization: Bearer $CLOUDFLARE_ACCOUNT_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/<account_id>/r2/buckets` returns 200.
- The pre-existing `CLOUDFLARE_API_TOKEN` (`cfut_` user-level) stays in place for its existing KV-invalidation + `wrangler deploy` uses. Two tokens, two scopes — no consolidation.
- Generated `STORAGE_NAME_SALT` — 32-byte base64 random, `crypto.randomBytes(32).toString('base64')`. Stored in the same three env files.

### Changed
- `app/src/lib/storage/cf-provision.ts` — env reads renamed from `CF_ACCOUNT_ID` / `CF_ACCOUNT_API_TOKEN` to `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ACCOUNT_API_TOKEN`. Aligns with the project-wide `CLOUDFLARE_*` secret-naming convention already used for `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_KV_NAMESPACE_ID`.
- `app/tests/storage/cf-provision.test.ts` — `vi.stubEnv` calls + one test-name string updated to match.
- `.secrets` — fixed two pre-existing typos: `CLOURDFLARE_API_TOKEN` → `CLOUDFLARE_API_TOKEN` (key on line 16; token value unchanged), `CLOUDFLADE_S3_CREDENTIALS_SECRET_ACCESS_KEY` → `CLOUDFLARE_S3_CREDENTIALS_SECRET_ACCESS_KEY` (key on line 21; secret value unchanged). Nothing in code was reading the typo'd forms, so these are purely reference-file corrections — no runtime impact.

### Tested
- `cd app && bunx vitest run tests/storage/cf-provision.test.ts tests/storage/verify.test.ts` — 26/26 PASS in 238 ms after rename.

### Scope boundary
Sprint 1.1 closes the operator step that Sprint 1.2 + 1.3 (shipped earlier today in commit `9c4f06c`) flagged as gating runtime-green. Live end-to-end bucket provisioning against the dev CF account (create bucket → mint token → PUT-GET-DELETE via sigv4 → revoke token → verify revocation) remains pending but is no longer blocked — the `cfat_` token + salt are in place. The rotation runbook (`docs/runbooks/cf-account-token-rotation.md`) is deferred to close with Phase 2 Sprint 2.1's Edge Function landing.

## [ADR-1025 Sprint 1.2 + 1.3 — CF R2 provisioning primitives + verification probe] — 2026-04-23

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 1, Sprints 1.2 + 1.3

### Added — Sprint 1.2 (CF provisioning library)
- `app/src/lib/storage/cf-provision.ts` — zero-npm-dep Cloudflare R2 provisioning primitives. Exports:
  - `deriveBucketName(orgId)` — sha256(orgId + salt) → `cs-cust-<20-hex>`, deterministic.
  - `createBucket(name, locationHint='apac', opts?)` — 201 + 409-idempotent-reuse.
  - `createBucketScopedToken(bucketName, opts?)` — returns `{token_id, access_key_id, secret_access_key}`; secret is one-shot and callers MUST encrypt before it leaves scope.
  - `revokeBucketToken(tokenId, opts?)` — 404-idempotent.
  - `r2Endpoint()` — account-scoped S3-compat URL.
  - `CfProvisionError` with error-code discriminator.
  - Internal `cfFetch` retry shim: 3 attempts × exp backoff × 30s budget; retries 429 + 5xx + network; 401/403/404/409 fail fast.

### Added — Sprint 1.3 (verification probe)
- `app/src/lib/storage/verify.ts` — `runVerificationProbe(config, deps?)`. 4-step probe: PUT a canonical JSON sentinel → presigned-GET + sha256 re-hash → DELETE sentinel. DELETE failure degrades to `ok=true + failedStep='delete'` (bucket lifecycle sweeps the sentinel). Every dependency (putObject, presignGet, deleteObject, fetch, Date.now, randomBytes) is dependency-injection'd for deterministic unit tests.
- `app/src/lib/storage/sigv4.ts` — added `deleteObject(SigV4Options)` mirroring the existing `putObject` pattern (DELETE method, empty-payload hash, no content-type / content-length). 404 idempotent-success.

### Tested
- `app/tests/storage/cf-provision.test.ts` — Vitest, 18 tests, 177 ms. Covers `deriveBucketName` determinism + collision-resistance + salt-sensitivity + config-missing; `createBucket` 201 / 409-idempotent-GET / 429-retry / 5xx-retry / 5xx-exhaust / 401-no-retry / network-retry; `createBucketScopedToken` credentials-present / credentials-missing-in-200-surfaces-error; `revokeBucketToken` 200 / 404-idempotent / 401-surface; `r2Endpoint` happy + config-missing.
- `app/tests/storage/verify.test.ts` — Vitest, 8 tests, 119 ms. Happy path full-4-step, DELETE failure (ok=true semantics), PUT throws (downstream skipped), GET 404, GET network error, content-hash mismatch (silent-rewrite detection), probe-id + key format, body-composition includes only the four documented fields (probe_id / storage_provider / timestamp / cs_version).

### Scope boundary
**Runtime-green gated on Sprint 1.1 operator step** (create `CF_ACCOUNT_API_TOKEN` + `STORAGE_NAME_SALT` + `CF_ACCOUNT_ID` envs). The 26 unit tests prove library + probe correctness via mocked `fetch` + injected sigv4 primitives; a real-bucket test against the dev CF account lands once the operator step completes. **Readiness-flag emission on probe failure** is deferred to Phase 2 Sprint 2.1's Edge Function — keeping the probe pure (no DB side-effects) is the cleaner boundary; the Edge Function wraps the probe + calls `admin.ops_readiness_flags` insertion when needed.

## [ADR-1014 Sprint 3.6 — admin impersonation audit trail + invoice-issuance negative] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.6 — Admin impersonation + invoice issuance

### Added
- `tests/admin/impersonation-audit-trail.test.ts` — Vitest, 3 tests. Asserts `admin.start_impersonation` and `admin.end_impersonation` each write exactly one row to `admin.admin_audit_log` (actions `impersonate_start` + `impersonate_end`) sharing the same `impersonation_session_id`; separately covers a triage-during-impersonation path that updates a rights_request and captures the activity in the session's `actions_summary`.
- `tests/admin/invoice-issuance.test.ts` — Vitest, 4 tests. Happy path (intra-state GST: CGST 9_000 + SGST 9_000 at 18% on a 100_000-paise subtotal; total 118_000 paise; invoice row at status='draft'), inter-state GST (IGST-only variant), no-active-issuer negative (retire all issuers + call `billing_issue_invoice` → raises `No active issuer`; public.invoices count unchanged), cross-reference to the existing immutable-field matrix in `tests/admin/invoice-immutability.test.ts`.

### Tested
- `bunx vitest run tests/admin/impersonation-audit-trail.test.ts tests/admin/invoice-issuance.test.ts` — 7/7 PASS in 14.57 s against dev Supabase.

### Scope boundary
Sprint 3.6 writes the two specific slices the existing admin-test suite didn't have: (1) the audit-log trail assertion for impersonation (existing `rpcs.test.ts` covers session state transitions, not the audit-row side) and (2) the Rule-19 "no active issuer" negative (existing `billing-invoice-list.test.ts` exercises issuance only with active issuers). The immutable-field trigger matrix in `invoice-immutability.test.ts` (10 cases) remains the authoritative coverage for Sprint 3.6's fourth deliverable — not duplicated here.

### Notes while writing
- `admin.admin_audit_log` uses `occurred_at`, not `created_at`. PostgREST returns `data: null, error: null` (not an error) when `.eq` / `.gt` filter on a non-existent column — caught during initial test runs.
- `billing` schema isn't exposed over PostgREST (supabase-js returns `Invalid schema: billing` on direct table reads). Used `admin.billing_issuer_list()` RPC to enumerate issuers instead.
- `billing_issuer_activate` refuses retired issuers → cannot revive the retired set after the negative test. Fix: seed a fresh issuer + activate it as the last step of the test so downstream files inherit a clean active-issuer state.

### Why
Closes ADR-1014 Phase 3's admin-surface lane. Both halves of the sprint (impersonation audit + invoice issuance Rule 19) touch compliance-critical code paths that would have been hard to debug post-incident if regressed: an impersonation that didn't audit-log would silently violate the admin accountability promise in ADR-0027; an invoice issued without an active issuer would violate Rule 19 (GSTIN / legal_name carried from the active issuer at issuance time, not hard-coded).

## [ADR-1014 Sprint 3.5 — DEPA artefact full-lifecycle composition test] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.5 — DEPA artefact lifecycle

### Added
- `tests/depa/artefact-lifecycle.test.ts` — Vitest, 4 tests, 8.67 s. Walks a single artefact through every state transition end-to-end via the cs_api library helpers (no raw service-role RPC calls — migration 20260801000009 revoked service_role EXECUTE on the v1 RPCs):
  - **Full lifecycle** — `recordConsent` → verify `granted` → `revokeArtefact` → verify `revoked` → double-revoke returns `idempotent_replay:true` with the original `revocation_record_id` + exactly one `artefact_revocations` row → third revoke still idempotent.
  - **Expiry cron simulation** — a separate active artefact has `expires_at` forced into the past + `enforce_artefact_expiry()` invoked → `consent_artefacts.status='expired'` + `consent_artefact_index` row DELETEd + `verifyConsent` returns `never_consented` (documented semantics — the `expired` status only surfaces in the race window before the enforce tick runs).
  - **Post-expiry revoke** — `revokeArtefact` on the expired artefact returns `{ok:false, kind:'artefact_terminal_state', detail:'expired'}`; zero new revocation rows written.
  - **Never-consented** — verify against a fresh identifier returns `status='never_consented', active_artefact_id=null`.

### Architectural observation
Sprint 3.5's test surfaces the intentional-but-subtle expire-then-verify semantics: the expiry cascade DELETEs the index row, so `verifyConsent` falls into its "not found" branch and returns `never_consented`. The `expired` status from verify only fires in the race window between `expires_at < now()` and the next `enforce_artefact_expiry` tick, when the index row still exists with `validity_state='active'`. The authoritative `consent_artefacts` row is preserved with `status='expired'` for audit. Captured in the test body + the ADR-1014 Sprint 3.5 section so future refactors don't silently flip the semantics.

### Scope boundary
Sprint 3.5 complements — does not duplicate — the existing DEPA coverage:
- `tests/integration/consent-revoke.test.ts` (ADR-1002 Sprint 3.2) — 10 branch-level revoke negatives (cross-org, reason_code_missing, unknown_actor_type, already-replaced terminal-state, etc.).
- `tests/depa/revocation-pipeline.test.ts` (ADR-0022 Sprint 1.4) — cascade precision + replacement-chain freeze.
- `tests/depa/expiry-pipeline.test.ts` (ADR-0023) — enforce cascade + `send_expiry_alerts` idempotency.
Sprint 3.5 owns the full-lifecycle composition proof across the four states.

### Why
Phase 3's pattern is "one canonical full-pipeline test per surface" — Sprint 3.1 for signup intake, 3.3 for public rights-request, 3.4 for deletion callback. Sprint 3.5 closes the DEPA artefact lane with a single end-to-end transition proof that threads the user-visible helpers (`recordConsent`, `verifyConsent`, `revokeArtefact`) through every terminal state. When a future refactor breaks any single hop, this one test fails with a clear message about which transition drifted.

## [ADR-1014 Sprint 3.4 — deletion-receipt callback RPC + signature helper tests] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.4 — Deletion connector end-to-end

### Added
- `tests/integration/deletion-receipt-confirm.test.ts` — Vitest RPC contract test for `public.rpc_deletion_receipt_confirm`. 12 tests covering:
  - State machine: `not_found`, `invalid_state` (pending row cannot be confirmed), `already_confirmed` (replay on confirmed/completed row returns `already_confirmed:true` without mutating; only one audit row emitted), race (noop).
  - Happy path: `awaiting_callback → confirmed` + `response_payload` shape + `confirmed_at` timestamp + derived `audit_log` row with `event_type='deletion_confirmed'` + `entity_type='deletion_receipt'`.
  - Reported-status variants: `partial`, `failed`, unknown-value-mapped-to-confirmed.
  - Overdue / retry-window query: mirrors `check-stuck-deletions` Edge Function pattern — `status='awaiting_callback' AND (next_retry_at IS NULL OR next_retry_at <= now())`. Asserts (1) stale rows are picked up, (2) future `next_retry_at` excludes a row (backoff in effect), (3) 30-day cutoff per `check-stuck-deletions`, (4) confirmed rows excluded regardless of age.
- `app/tests/rights/deletion-callback-signing.test.ts` — Vitest unit test for `app/src/lib/rights/callback-signing.ts`. 14 tests covering `signCallback` (determinism, hex-format, per-id uniqueness, throws on missing secret) + `verifyCallback` (happy path, one-hex-flip tampering, short-sig, long-sig, empty, wrong-receipt-id, missing-secret returns false not throws, key-rotation mismatch) + `buildCallbackUrl` (env + explicit override).

### Tested
- `bunx vitest run tests/integration/deletion-receipt-confirm.test.ts` — 12/12 PASS in 6.79 s (after the schema fix in migration 20260804000030 — see CHANGELOG-schema).
- `cd app && bunx vitest run tests/rights/deletion-callback-signing.test.ts` — 14/14 PASS in 109 ms.

### Scope boundary
Same RPC-contract approach as Sprints 3.1 / 3.3. Route-handler signature-verification is tested via helper-level unit tests on `verifyCallback` (the route is a thin wrapper that calls it, then dispatches to the RPC if true). Connector-webhook outbound dispatch (the HMAC-signed URL delivered to the customer's webhook) lives in the `check-stuck-deletions` + `send-sla-reminders` Edge Functions and isn't under test here — Sprint 3.7's negative-control pair sweep is the natural home for that coverage.

### Why
Closes the Worker's deletion-callback state machine + signature verifier. The tests immediately surfaced a latent schema gap (cs_orchestrator missing SELECT on deletion_receipts) that would have broken the first real customer deletion callback; the schema fix ships alongside in migration 20260804000030.

## [ADR-1014 Sprint 3.3 — rights-request public RPC contract test] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.3 — Rights request end-to-end

### Added
- `tests/integration/rights-request-public.test.ts` — Vitest RPC-level contract test for the public rights-request flow. 13 tests covering:
  - `rpc_rights_request_create` — input validation (invalid request_type → 22023, invalid email → 22023, unknown org → P0002); happy path (row columns + request_id shape + `turnstile_verified=true` persisted + `status='new'` + OTP fields stored); all 4 `request_type` values accepted (`erasure`/`access`/`correction`/`nomination`).
  - `rpc_rights_request_verify_otp` — happy path (row flipped to `email_verified=true` + `otp_hash=null` + derived `rights_request_events` row with `event_type='created'` + derived `audit_log` row with `event_type='rights_request_created'`); negatives: `not_found` (unknown id), `invalid_otp` (wrong hash increments `otp_attempts`, row stays pending), `too_many_attempts` (5 wrong attempts lock future retries even with correct hash), `expired` (`otp_expires_at` in past → `expired` branch, row stays pending), `already_verified` (double-verify → `already_verified` branch), `no_otp_issued` (null `otp_hash` → `no_otp_issued`).
  - Cross-org side-effect isolation — verifying request A in org-1 must not mutate request B in org-2 (asserts `email_verified`, `otp_hash`, `otp_attempts` all unchanged on the sibling org).

### Tested
- `bunx vitest run tests/integration/rights-request-public.test.ts` — 13/13 PASS in 11.63 s against dev Supabase.
- Cleanup via `afterAll`: tracked-id purge of created `rights_requests` rows + `cleanupTestOrg` for both seeded test orgs.

### Scope boundary
As with Sprint 3.1's signup-intake test, this covers the RPC-level contract surface (the DB-side branching state machine). Route-handler-level concerns — Turnstile verification at `/api/public/rights-request`, 5/60s per-IP + 3/hour per-email rate limits, Resend OTP email dispatch — live at the Node route layer and are covered by unit tests on the helper modules (`app/src/lib/rights/turnstile.ts`, `rate-limit.ts`, `email.ts`, `otp.ts`, `fingerprint.ts`).

### Why
ADR-1005 Sprint 5.1 (Terminal B, 2026-04-22) shipped the AUTHENTICATED `/v1/rights/requests` surface with 17 integration tests. Sprint 3.3 closes the companion PUBLIC-side flow — the Turnstile-gated / OTP-verified rights portal that's the primary DPDP §13 surface for data principals. Covering the `rpc_rights_request_verify_otp` state machine (including the `too_many_attempts` lockout and the cross-org isolation proof) is the load-bearing piece; with the RPCs under test the route handler becomes a thin-wrapper concern.

## [ADR-1014 Sprint 3.1 — signup-intake RPC contract test (closes ADR-0058 Sprint 1.5 deferred item)] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.1 — Signup → onboard → first consent
**Closes:** ADR-0058 Sprint 1.5's deferred `tests/integration/signup-intake.test.ts`

### Added
- `tests/integration/signup-intake.test.ts` — Vitest RPC-level contract test for `public.create_signup_intake(email, plan_code, org_name, ip)`. 11 tests covering all 6 branches defined by migration `20260803000006_signup_intake_explicit_status.sql`:
  - `created` — fresh email + active plan returns `{branch, id, token}` with a 48-hex token; invitation row has `origin='marketing_intake'`, `role='account_owner'`, `account_id=null`, `org_id=null`, `accepted_at=null`, `revoked_at=null`, ~14-day expiry window.
  - `created` (org_name trim variant) — whitespace-only `org_name` stores as null.
  - `already_invited` — submitting the same email twice within the pending window returns the existing id; token is NOT leaked; only one row exists for the email.
  - `already_invited` (case-insensitive variant) — upper-case email re-submission collides with a lower-case pending invitation.
  - `existing_customer` — email belongs to a non-admin `auth.users` row → branch returned, no invitation row created.
  - `admin_identity` — email belongs to an admin-flagged (`app_metadata.is_admin=true`) user → Rule 12 fence, no invitation row created.
  - `invalid_email` — malformed input + empty string.
  - `invalid_plan` — unknown plan_code + null plan_code.
  - Branch precedence — `invalid_plan` is evaluated before `invalid_email`, matching the SQL function body order.

### Tested
- `bunx vitest run tests/integration/signup-intake.test.ts` — 11/11 PASS in 5.54 s against the dev Supabase.
- Cleanup: `afterAll` purges test-seeded invitations (by tracked email set) + `auth.users` rows (by tracked id set); swallowed-error on deleteUser so one failed cleanup doesn't break the suite.

### Scope boundary
This closes the RPC-level contract test — the DB-side branching logic. Route-handler-level concerns (Turnstile verification, 5/60s per-IP rate limit, 3/hour per-email rate limit, Resend dispatch roundtrip) stay on unit/route-handler tests where mocks are tractable; this test exercises the authoritative branching source of truth.

### Why
ADR-0058 shipped the signup-intake RPC on 2026-04-12 with the integration test deferred twice (Sprint 1.1 → Sprint 1.5 → V2 backlog) because CI didn't yet have a headless-browser harness or an auth-mock. Sprint 3.1's scope reads as "close ADR-0058's deferred integration test" — and since the RPC is the authoritative branching surface (the route handler is a thin wrapper adding Turnstile + rate-limit), testing the RPC directly via service role gives the same coverage without the wizard-level plumbing. The wizard-level browser-driven test belongs in Sprint 3.2+ under the evidence-graded pipeline spec.

## [ADR-1005 Phase 2 Sprint 2.1 — /v1/integrations/{connector_id}/test_delete] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 2 Sprint 2.1

### Added
- `app/src/lib/consent/test-delete.ts` — `triggerTestDelete` helper over `rpc_test_delete_trigger`; discriminated error union (`api_key_binding`, `connector_not_found`, `connector_inactive`, `rate_limit_exceeded`, `unknown`).
- `app/src/app/api/v1/integrations/[connector_id]/test_delete/route.ts` — POST handler, scope `write:deletion`; 422 on malformed `connector_id`, 404 on cross-org or unknown, 422 on inactive, 429 on rate-limit, 202 on success.
- `app/public/openapi.yaml` — new path `/integrations/{connector_id}/test_delete` + `TestDeleteResponse` schema.

### Tested
- [x] `cd app && bun run lint` — PASS
- [x] `cd app && bun run build` — PASS (route present in build output)
- [x] `cd app && bunx tsc --noEmit` — PASS
- [x] `bunx vitest run tests/integration/test-delete-api.test.ts` — 6/6 PASS

## [ADR-1004 Sprint 1.5 — /api/orgs/[orgId]/regulatory-exemptions] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention + material-change re-consent
**Sprint:** Phase 1 Sprint 1.5

### Added
- `GET /api/orgs/[orgId]/regulatory-exemptions` — returns `{ platform: ExemptionRow[], overrides: ExemptionRow[] }`, each row augmented with `legal_review_status` ('reviewed' | 'pending' based on `reviewed_at`). Ordered by precedence ascending, then `statute_code`. Authenticated only; RLS filters overrides to the caller's org (platform defaults are visible to every authenticated member).
- `POST /api/orgs/[orgId]/regulatory-exemptions` — inserts a per-org exemption override. Pre-checks `current_account_role() === 'account_owner'` → 403 otherwise; RLS insert policy remains the fence. Error mapping: `23505` (unique statute_code) → 409 with "update it instead" hint; `42501` (RLS block) → 403. Validates: sector ∈ {saas, edtech, healthcare, ecommerce, hrtech, fintech, bfsi, general, all}; `statute` + `statute_code` non-empty; `data_categories` non-empty string array.

### Tested
- [x] `bun run lint` — 0 warnings, 0 errors — PASS
- [x] `bun run build` — route present (`ƒ /api/orgs/[orgId]/regulatory-exemptions`) — PASS
- [x] RLS + account_owner gate — covered by existing `tests/integration/retention-exemptions.test.ts` (Sprint 1.1). The POST route is a thin pass-through to the same SQL INSERT whose RLS policy the test already verifies.

## [ADR-1018 Sprint 1.4 — /api/_health liveness] — 2026-04-22

**ADR:** ADR-1018 — Self-hosted status page
**Sprint:** 1.4 probe cron + health endpoints

### Added
- `GET /api/health` + `HEAD /api/health` — unauthenticated liveness for the customer-app Next.js runtime. Returns `{ ok: true, surface: 'customer_app', at: iso }` + `Cache-Control: no-store`. No DB round-trip, no secrets, no cookies. Used by `run-status-probes` as the probe target for the `verification_api` and `dashboard` subsystems (single unauthenticated endpoint — avoids provisioning a dedicated probe API key). Path is outside `app/src/proxy.ts` matcher, so the Bearer gate does not fire.

### Tested
- [x] Local `bun run lint` — 0 warnings, 0 errors — PASS
- [x] Path not in `proxy.ts` matcher (`/api/v1/:path*` is the only `/api` entry in the matcher) — PASS

## [ADR-1016 — 3 orphan-scope v1 GET endpoints] — 2026-04-22

**ADR:** ADR-1016 — v1 API close-out for `read:audit`, `read:security`, `read:score`

### Added
- `GET /v1/audit` (`read:audit`, org-scoped) — `app/src/app/api/v1/audit/route.ts` + `app/src/lib/api/audit.ts`. Keyset-paginated audit_log. Filters: `event_type`, `entity_type`, `created_after`, `created_before`, `cursor`, `limit` (1..200 default 50). Error mapping: `api_key_binding` → 403; `bad_cursor` → 422.
- `GET /v1/security/scans` (`read:security`, org-scoped) — `app/src/app/api/v1/security/scans/route.ts` + `app/src/lib/api/security.ts`. Keyset-paginated security_scans. Filters: `property_id`, `severity` (critical/high/medium/low/info), `signal_key`, `scanned_after`, `scanned_before`, `cursor`, `limit`.
- `GET /v1/score` (`read:score`, org-scoped) — `app/src/app/api/v1/score/route.ts` + `app/src/lib/api/score.ts`. Single-row DEPA compliance envelope with fixed `max_score: 20`. Returns null-envelope for orgs whose nightly refresh cron has not run.
- `app/public/openapi.yaml` — 3 new paths + 5 new schemas (AuditLogItem / AuditLogListResponse / SecurityScanItem / SecurityScanListResponse / DepaScoreResponse) all with examples. Each path description documents the buffer-lifecycle caveat ("serves recent window only; canonical audit lives in customer storage") for `/v1/audit` and `/v1/security/scans`.

### Tested
- [x] 21 new integration tests across 3 files (9 audit + 9 security + 3 score) all PASS.
- [x] `bunx @redocly/cli lint app/public/openapi.yaml` — 0 errors.
- [x] Full integration suite — 189/189 PASS.

## [ADR-1005 Sprint 5.1 — v1 Rights API (POST + GET /v1/rights/requests)] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 5, Sprint 5.1

### Added
- `app/src/app/api/v1/rights/requests/route.ts`:
  - `POST /v1/rights/requests` (scope `write:rights`, org-scoped keys only) — creates a rights_requests row with identity attested by the API caller (no Turnstile/OTP). Body: `{ type, requestor_name, requestor_email, request_details?, identity_verified_by, captured_via? }`. Full field validation (422 problem+json on missing or malformed fields). Error mapping: `api_key_binding` → 403; `invalid_request_type` / `invalid_requestor_email` / `identity_verified_by_missing` / `requestor_name_missing` → 422; unknown → 500. Response: 201 with the created envelope.
  - `GET /v1/rights/requests` (scope `read:rights`, org-scoped keys only) — keyset-paginated list. Query params: `status`, `request_type`, `captured_via`, `created_after`, `created_before`, `cursor`, `limit` (1..200, default 50). Date + enum validation upstream (422). Error mapping: `api_key_binding` → 403; `bad_cursor` → 422.
- `app/src/lib/api/rights.ts`:
  - `createRightsRequest(input)` — wraps `rpc_rights_request_create_api` via the cs_api pool. Discriminated error union covers fence + validation + unknown.
  - `listRightsRequests(input)` — wraps `rpc_rights_request_list`. Same error shape.
  - Full type envelope: `RightsRequestType`, `RightsRequestStatus`, `RightsCapturedVia`, `RightsRequestCreatedEnvelope`, `RightsRequestItem`, `RightsRequestListEnvelope`.
- `app/public/openapi.yaml`:
  - `POST /rights/requests` + `GET /rights/requests` paths with request + response examples.
  - 4 new schemas: `RightsRequestCreateRequest`, `RightsRequestCreatedResponse`, `RightsRequestItem`, `RightsRequestListResponse`. All OpenAPI 3.1-compliant (`type: [X, "null"]` for nullable fields).

### Tested
- [x] `bunx @redocly/cli lint app/public/openapi.yaml` — 0 errors, 1 cosmetic warning (pre-existing missing info.license; tracked for ADR-1006).
- [x] `cd app && bun run build` — pass. `bun run lint` — pass. `bunx tsc --noEmit` — pass.
- [x] `tests/integration/rights-api.test.ts` — 17/17 PASS.
- [x] Full integration suite — 146/146 PASS (was 129 pre-sprint).

## [ADR-1013 Sprint 1.1 — cs_orchestrator direct-Postgres] — 2026-04-21

**ADR:** ADR-1013 — cs_orchestrator direct-Postgres migration (Next.js runtime)
**Sprint:** Phase 1 Sprint 1.1 — client + caller migration

### Added
- `app/src/lib/api/cs-orchestrator-client.ts` — direct port of `cs-api-client.ts`. Lazy-initialised `postgres.js` pool reading `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL`. Same transaction-pool sizing + TLS + `prepare: false` settings as the cs_api client.

### Changed
- `app/src/app/api/public/signup-intake/route.ts` — drops `createClient(url, CS_ORCHESTRATOR_ROLE_KEY)` + `.rpc(...)`; switches to `csOrchestrator()` with tagged-template SQL against `public.create_signup_intake`. Error handling moves from `{data, error}` destructuring to try/catch. The explicit-branch contract (created / already_invited / existing_customer / admin_identity / invalid_email / invalid_plan) is unchanged.
- `app/src/app/api/internal/invitation-dispatch/route.ts` — drops `createClient(...)` scaffolding; hands `csOrchestrator()` to `dispatchInvitationById`.
- `app/src/lib/invitations/dispatch.ts::dispatchInvitationById` — accepts a `postgres.js` `Sql` instance instead of `SupabaseClient`. Three read/update operations against `public.invitations` migrated to tagged-template queries.

### Removed
- `CS_ORCHESTRATOR_ROLE_KEY` references (and the `SUPABASE_URL` const that only existed to feed it to `createClient`) from both routes. This env var is on Supabase's HS256 rotation kill-timer; ADR-1009 established direct-Postgres as the escape hatch.

### Tested
- [x] `cd app && bun run build` — clean.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] End-to-end — verified 2026-04-21. cs_orchestrator password rotated, `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` wired, app dev restarted, marketing `/signup` → app `signup-intake` (direct-Postgres as cs_orchestrator) → create_signup_intake RPC → in-process dispatcher → marketing `/api/internal/send-email` relay → Resend → invite email landed in recipient inbox.

## [ADR-1013 Sprint 2.2 + ADR COMPLETED — run-probes direct-Postgres] — 2026-04-21

**ADR:** ADR-1013 — `cs_orchestrator` direct-Postgres migration (Next.js runtime) **(COMPLETED)**
**Sprint:** Phase 2 Sprint 2.2 — last Next.js JWT caller migrated

### Changed
- `app/src/app/api/internal/run-probes/route.ts` — migrated off `createClient(…, CS_ORCHESTRATOR_ROLE_KEY)` onto `csOrchestrator()` + `postgres.js` tagged templates. Five operations rewritten: due-probe scan (with `is_active = true and (next_run_at is null or next_run_at <= now())`), tracker_signatures select, web_properties select, consent_probe_runs insert, consent_probes scheduling update. `jsonb` columns serialised via `JSON.stringify` + `::jsonb` cast so postgres.js's strict template-parameter typing accepts the payloads. `runProbe` helper signature changed from `(supabase: SupabaseClient, probe, signatures)` to `(sql: Sql, probe, signatures)`.

### Post-condition
- `grep -rln CS_ORCHESTRATOR_ROLE_KEY app/src` returns zero code hits (one comment hit in run-probes/route.ts explaining the migration history). Next.js runtime fully off HS256.

### Tested
- [x] `cd app && bun run build / lint` — clean.

## [ADR-1013 Sprint 2.1 — remaining invitation-domain callers + doc sync] — 2026-04-21

**ADR:** ADR-1013 — `cs_orchestrator` direct-Postgres migration (Next.js runtime)
**Sprint:** Phase 2 Sprint 2.1 — env + doc cleanup + small-caller migration

### Changed
- `app/src/app/api/public/lookup-invitation/route.ts` — migrated off `createClient(…, CS_ORCHESTRATOR_ROLE_KEY)` onto `csOrchestrator()` + tagged-template SQL calling `public.lookup_pending_invitation_by_email`. Same external contract; brings the route into ADR-1013 compliance so it survives Supabase's HS256 rotation.
- `app/src/app/api/internal/invites/route.ts` — same migration for the HMAC-gated marketing-invite stub route. `postgres.js` throws with `err.code === '23505'` on the unique-violation branch (previously `error.code` from supabase-js); catch reshaped accordingly to preserve the 409 `pending_invite_already_exists` response.

### Scope note
- `/api/internal/run-probes` still holds a `createClient(…, CS_ORCHESTRATOR_ROLE_KEY)` — tracked as ADR-1013 Sprint 2.2 (deferred, non-blocking single caller in a different domain).

### Tested
- [x] `cd app && bun run build / lint` — clean.

## [ADR-0058 Sprint 1.5 close-out — resend-link endpoint] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding (Sprint 1.5 `[ ]` resend-link form → `[x]`)

### Added
- `app/src/app/api/public/resend-intake-link/route.ts` — `POST`. Looks up the most-recent pending intake for the caller-supplied email via the cs_orchestrator direct-Postgres pool, clears the `email_dispatched_at` watermark, then fires `dispatchInvitationById` in-process so the marketing Resend relay re-sends the existing invite. Per-IP 5/60s + per-email 3/hour rate-limits mirror `/api/public/signup-intake`; dev-bypass active when `NODE_ENV !== 'production'` or `RATE_LIMIT_BYPASS=1`. Existence-leak parity: every non-rate-limit path returns `{ ok: true }` — no probe signal distinguishing "no such intake" from "sent".

### Tested
- [x] `cd app && bun run build / lint` — clean.

## [ADR-0058 follow-up — structured JSON errors + dev rate-limit bypass] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Changed
- `app/src/app/api/orgs/[orgId]/properties/route.ts` — POST handler wrapped in top-level try/catch. Every error path now returns `{ error: message }` JSON (500) + `console.error('api.orgs.properties.post.failed', ...)`. Previously the `checkPlanLimit` RPC failure threw unhandled, Next.js served an empty 500 body without CORS headers, and the client saw "Unexpected end of JSON input" — root cause invisible.
- `app/src/app/api/public/signup-intake/route.ts` — dev rate-limit bypass: when `NODE_ENV !== 'production'` (or explicit `RATE_LIMIT_BYPASS=1`), both buckets (5/60s per IP + 3/hour per email) are skipped. Prevents the developer from locking their own IP out for an hour during iteration. Never set in prod.

### Tested
- [x] `cd app && bun run build / lint` — clean.
- [x] End-to-end Step 5 verified after the two follow-up RPC fixes landed (commits `588da52` + `c784237`).

## [ADR-0058 follow-up — email-first /signup + /login polish] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Added
- `app/src/app/api/public/lookup-invitation/route.ts` — `POST`. Per-IP 5/60s + per-email 10/hour rate-limits (aggressive per-email probes get the same `{found: false}` shape as a real miss — no timing distinction). Calls `public.lookup_pending_invitation_by_email` via `cs_orchestrator` and returns `{found, token?, origin?}` so the client can route to `/signup?invite=…` (operator invite) or `/onboarding?token=…` (intake).

### Changed
- `app/src/app/(public)/signup/page.tsx` — no-token path replaced. Instead of "ConsentShield is invitation-only during our beta" copy, renders an email-lookup form. On match → client router pushes to the right URL based on `origin`; on miss → "We couldn't find an invitation for that email" + "Try a different email" button + mailto support.
- `app/src/app/(public)/login/page.tsx` — dropped the `?reason=operator_session_cleared` amber banner (rare in prod, noise in dev). Subtitle reworded from "No password. We'll email you a one-time code" to "Use the email on your ConsentShield account — we'll send a one-time code" so it's unambiguous the flow is for existing customers.

### Tested
- [x] `cd app && bun run build / lint` — clean.

## [ADR-0058 follow-up — drop dispatch trigger, synchronous callers] — 2026-04-21

**ADR:** ADR-0058 (follow-up; no new ADR)

### Removed
- The AFTER INSERT trigger `invitations_dispatch_after_insert` (migration 20260803000007) — no longer needed; every caller now dispatches synchronously.
- The pg_cron job `invitation-dispatch-retry` — same reason.

### Added
- `app/src/lib/invitations/dispatch.ts::dispatchInvitationById(supabase, invitationId, env)` — extracted helper: reads the row, renders the email, POSTs to marketing's relay, stamps the watermark columns. Tagged-union result. Idempotent.
- `app/src/lib/invitations/dispatch.ts::resolveDispatchEnv()` — centralised env-var fallbacks for the three callers.

### Changed
- `app/src/app/api/internal/invitation-dispatch/route.ts` — now a thin wrapper over `dispatchInvitationById`. Still bearer-gated. Not called by the DB anymore; surfaces remain for admin-side + manual retry.
- `app/src/app/api/public/signup-intake/route.ts` — on `created` branch, calls `dispatchInvitationById` in-process before responding. Failure is logged; the row write is not rolled back (operator can retry via the internal route).
- `admin/src/app/(operator)/accounts/actions.ts::createOperatorIntakeAction` — after `admin.create_operator_intake` returns, POSTs to app's `/api/internal/invitation-dispatch` with the new id + shared bearer. Fire-and-forget; `console.warn` on non-2xx.

### Env
- Admin now needs `INVITATION_DISPATCH_SECRET` + `NEXT_PUBLIC_APP_URL` to dispatch.
- Vault secrets `cs_invitation_dispatch_url` + `cs_invitation_dispatch_secret` are vestigial after this commit; can be dropped with `vault.delete_secret(...)` when the operator wants.

### Tested
- [x] Build + lint clean on app/, admin/, marketing/.
- [x] `bunx supabase db push` — migration applied.
- [x] End-to-end email send — verified 2026-04-21. With `RESEND_API_KEY` set on marketing and `cs_orchestrator` migrated to direct-Postgres (ADR-1013), the synchronous-dispatch path delivers an invite email end-to-end.

## [ADR-0058 follow-up — explicit signup-intake status + relay rewire] — 2026-04-21

**ADR:** ADR-0058 (follow-up; no new ADR)

### Changed
- `app/src/app/api/public/signup-intake/route.ts` — existence-leak parity removed per product decision 2026-04-21. Response now carries an explicit `status` field (`created | already_invited | existing_customer | admin_identity | invalid_email | invalid_plan`) with matching HTTP status (202 / 200 / 409 / 409 / 400 / 400). Rationale: Turnstile + per-IP 5/60s + per-email 3/hour remain the enumeration ceiling; the UX win of "you already have an account" outweighs the residual leak.
- `app/src/app/api/internal/invitation-dispatch/route.ts` — no longer calls Resend directly. Relays the rendered email payload (`{to, subject, html, text}`) to marketing's `/api/internal/send-email` with the shared `INVITATION_DISPATCH_SECRET` bearer. `RESEND_API_KEY` + `RESEND_FROM` removed from this file's env dependencies — those live on marketing/ now. New dev default for the marketing origin: `http://localhost:3002` (matches marketing dev port); prod default: `https://consentshield.in`; override via `NEXT_PUBLIC_MARKETING_URL`.
- `app/src/app/api/internal/invitation-dispatch/route.ts` dispatch-failure telemetry now writes `relay_<status>` / `relay_unconfigured` instead of `resend_<status>` into `invitations.email_last_error`. The pg_cron safety-net still retries 503s (relay_unconfigured) naturally; 502s are Resend upstream errors.

### Tested
- [x] Build + lint clean on app/ and marketing/.
- [ ] End-to-end dispatch — deferred until secrets land.

## [ADR-1012 Sprint 1.3] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.3 — /v1/plans

### Added
- `GET /v1/plans` — public tier table. Active plans only, cheapest first, NULL-priced plans (enterprise "talk to us") last. No scope gate (any valid Bearer). Handler: `app/src/app/api/v1/plans/route.ts`. OpenAPI: new path + `PlanItem` + `PlanListResponse` schemas with a populated 5-row example.
- `app/src/lib/api/plans.ts` — `listPlans()` helper over the cs_api pool.

### Tested
- [x] 4 new integration tests in `tests/integration/plans.test.ts` (envelope shape, ordering invariant, safe-subset, rate-tier triangulation with `TIER_LIMITS`).

## [ADR-1012 Sprint 1.2] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.2 — discovery endpoints

### Added
- `GET /v1/purposes` — lists purpose_definitions for the caller's org (ordered alphabetically by purpose_code). Scope: `read:consent`. Org-scoped Bearer required (account-scoped → 400). Handler: `app/src/app/api/v1/purposes/route.ts`. OpenAPI: new path + `PurposeItem` + `PurposeListResponse` schemas with examples.
- `GET /v1/properties` — lists web_properties for the caller's org (ordered by created_at asc). Scope: `read:consent`. Org-scoped Bearer required. Handler: `app/src/app/api/v1/properties/route.ts`. OpenAPI: new path + `PropertyItem` + `PropertyListResponse` schemas with examples. `event_signing_secret` deliberately NOT in envelope.
- `app/src/lib/api/discovery.ts` — `listPurposes(params)` and `listProperties(params)` helpers over the cs_api pool.

### Tested
- [x] 9 new integration tests in `tests/integration/discovery.test.ts` (both helpers, incl. cross-org fence probe + safe-subset assertion for property envelope).
- [x] 125/125 full integration suite PASS.

### Incidental
- `tests/integration/mrs-sharma.e2e.test.ts` step 3 perf assertion relaxed from `<10s` to `<25s` — pre-existing flake under full-suite DB contention; tipped by adding one more test file. ADR-1008 owns the real p99 SLO.

## [ADR-1012 Sprint 1.1] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.1 — introspection endpoints

### Added
- `GET /v1/keys/self` — Bearer token introspection. Returns key metadata (id, account_id, org_id, name, prefix, scopes, rate_tier, lifecycle timestamps). No scope gate. Handler: `app/src/app/api/v1/keys/self/route.ts`. OpenAPI: new path + `KeySelfResponse` schema with request + response examples.
- `GET /v1/usage` — per-day request_count + p50/p95 latency for the Bearer's last N days (?days=1..30, default 7). No scope gate. Handler: `app/src/app/api/v1/usage/route.ts`. OpenAPI: new path + `UsageResponse` + `UsageDayRow` schemas with a populated example series.
- `app/src/lib/api/introspection.ts` — `keySelf(params)` and `keyUsageSelf(params)` helpers over the cs_api pool, following the same postgres.js tagged-template pattern as `lib/consent/*.ts`.

### Tested
- [x] 6 new integration tests in `tests/integration/introspection.test.ts` (both helpers).
- [x] 116/116 full integration suite PASS.

## [ADR-0058 Sprint 1.5] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.5 — Admin operator-intake + polish

### Added
- `app/src/app/(public)/onboarding/actions.ts::logStepCompletion` — server action wrapping `public.log_onboarding_step_event` for wizard step-timing telemetry. Fire-and-forget from the orchestrator.
- `app/src/app/(public)/onboarding/actions.ts::swapPlan` — server action wrapping `public.swap_intake_plan`. Returns tagged-union result; raw RPC errors surfaced for the in-wizard plan-swap modal.
- `admin/src/app/(operator)/accounts/actions.ts::createOperatorIntakeAction` — server action wrapping `admin.create_operator_intake`. Returns `{id, token}`. Used by the new-intake page's `<NewIntakeForm>`.

### Tested
- [x] Build + lint clean (see CHANGELOG-dashboard.md [ADR-0058 Sprint 1.5]).

## [ADR-0058 Sprint 1.4] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.4 — Onboarding status + snippet-verify routes

### Added
- `app/src/app/api/orgs/[orgId]/onboarding/status/route.ts` — `GET`. Membership-gated (explicit `org_memberships` check on top of RLS). Returns `{onboarding_step, onboarded_at, first_consent_at}` for Step 7 polling.
- `app/src/app/api/orgs/[orgId]/onboarding/verify-snippet/route.ts` — `POST`. SSRF-defended server fetch of the user's registered URL with a regex scan for `<script[^>]+banner\.js`. Layering:
  - Scheme allow-list (http / https only).
  - Hostname block-list: `localhost`, `0.0.0.0`, `metadata.google.internal`, `instance-data`, `instance-data.ec2.internal`; `*.internal` and `*.local` suffix refused.
  - DNS resolution via `node:dns/promises.lookup({all:true, verbatim:true})`; every resolved address checked against RFC1918 (10/8, 172.16/12, 192.168/16) + loopback (127/8, ::1) + link-local (169.254/16, fe80:) + CGNAT (100.64/10) + ULA (fc00::/7) + multicast (224/4, ff…) + reserved (0.0.0.0/8, 224+); literal IPs in the URL itself also screened.
  - 5-second `AbortController` timeout; 256 KB response cap with early-abort on banner-regex match.
  - `redirect: 'manual'` — redirects never followed; returned as `redirect_not_followed_<status>` reason.
  - On pass: `UPDATE web_properties SET snippet_verified_at, snippet_last_seen_at` for the caller-owned property. Response body is always `{verified, reason?, verified_at?}` — raw HTML is never exposed.

### Tested
- [x] Build + lint clean (see CHANGELOG-dashboard.md [ADR-0058 Sprint 1.4]).
- [ ] Manual / integration test deferred to Sprint 1.5 polish (planned): happy path + `private_ip` + `metadata.google.internal` + `snippet_not_found` + timeout + redirect.

## [ADR-0058 Sprint 1.3] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.3 — Wizard shell + Steps 1–4

### Added
- `app/src/app/(public)/onboarding/actions.ts` — server actions `setOnboardingStep`, `updateIndustry`, `seedDataInventory`, `applyTemplate`, `listTemplatesForSector`. Thin wrappers over the existing RPCs; tagged-union result shape for client island consumption.

### Changed
- `app/src/proxy.ts` — matcher extended with `/onboarding` + `/onboarding/:path*` so the Rule 12 admin-identity gate covers the onboarding surface.

### Tested
- [x] Build + lint clean (see CHANGELOG-dashboard.md [ADR-0058 Sprint 1.3]).

## [ADR-0058 Sprint 1.2] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.2 — (marketing-side; see CHANGELOG-marketing.md)

## [ADR-0058 Sprint 1.1] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.1 — Public intake endpoint + origin-aware dispatch

### Added
- `app/src/app/api/public/signup-intake/route.ts` — `POST` + `OPTIONS`. Mirrors the rights-request pattern: per-IP rate limit (5/60s), per-email rate limit (3/hour) for anti-enumeration, Turnstile verify, then `create_signup_intake` RPC via service-role client. CORS allow-list hard-coded (`https://consentshield.in`, `https://www.consentshield.in`, `http://localhost:3002`). Always returns `{ok:true}` 202 on the success path regardless of internal branch (no existence leak).

### Changed
- `app/src/app/api/internal/invitation-dispatch/route.ts` — selects `origin` from the invitation row; routes the email CTA URL: `marketing_intake | operator_intake → ${APP_BASE_URL}/onboarding?token=`; `operator_invite` keeps the existing `/signup?invite=` URL.
- `app/src/lib/invitations/dispatch-email.ts` — `DispatchInput` adds optional `origin`; new copy variants for `marketing_intake` ("Welcome to ConsentShield — continue your setup") and `operator_intake` ("Your ConsentShield account is ready to set up"). Default origin (unset) preserves the legacy `operator_invite` copy verbatim — back-compat for existing call sites.

### Tested
- [x] `bunx vitest run tests/invitation-dispatch.test.ts` — 11/11 PASS (4 new origin-aware copy tests added; legacy 7 unchanged).

## [V2 C-2 drift check] — 2026-04-21

**ADR:** ADR-1001 V2 C-2 (no separate ADR; inline implementation)

### Added
- `tests/integration/rate-tier-drift.test.ts` — two assertions: (a) every row in `public.plans` has a matching `TIER_LIMITS` entry with identical `perHour` + `burst`; (b) every value in the `api_keys.rate_tier` CHECK enum has a `TIER_LIMITS` entry. Runs on every CI vitest pass.

### Changed
- `app/src/lib/api/rate-limits.ts` — `TIER_LIMITS` is now `export`ed (was module-local) so the drift test can read it directly.

### Tested
- [x] 2/2 drift assertions PASS against current `public.plans` (5 rows: enterprise/growth/pro/starter/trial_starter).

## [ADR-1009 Sprint 2.3] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.3 — runtime swap (service-role → cs_api pool)

### Changed
- `app/src/lib/api/auth.ts` — rewritten to call `rpc_api_key_verify` + `rpc_api_key_status` via the `csApi()` postgres.js pool. `makeServiceClient` helper removed; `getKeyStatus` no longer does a direct `api_keys` SELECT (cs_api has no table grants). Code comment replaced (old comment claimed the Worker uses the service key, which was never true; new comment describes the direct-Postgres pattern).
- `app/src/lib/api/log-request.ts` — fire-and-forget `rpc_api_request_log_insert` over `csApi`. Swallows errors so telemetry failures don't cascade into 5xx on the user-facing path.
- `app/src/lib/consent/verify.ts`, `record.ts`, `read.ts`, `revoke.ts`, `deletion.ts` — each helper rewritten to call its target RPC via postgres.js tagged-template SQL (`select rpc_name(${p1}::type, ...)`). Error classification preserved: `42501` + `api_key_*` → `api_key_binding` 403; `22023` → validation 422; `P0001` property/artefact-not-found → 404.

### Removed
- Every `SUPABASE_SERVICE_ROLE_KEY` reference from `app/src/`. Verified via `grep -rn "SUPABASE_SERVICE_ROLE_KEY" app/src` → empty. Rule 5 now clean in the customer app runtime.

### Tested
- [x] 106/106 integration + cs_api smoke PASS (no behavioural change; only the transport swap).
- [x] `bun run lint` + `bun run build` clean.

## [ADR-1009 Sprint 2.1 — scope amendment] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.1 — cs_api role activation

### Added
- `app/src/lib/api/cs-api-client.ts` — singleton `postgres.js` pool connecting as cs_api against the Supavisor transaction pooler (port 6543). Fluid-Compute-safe: module-scope instance reused across concurrent requests. Lazy-init throws on first use if `SUPABASE_CS_API_DATABASE_URL` is unset, so `next build` stays clean. `isCsApiConfigured()` lets test/smoke paths skip gracefully.
- `postgres@3.4.9` — new dep (root + app), exact-pinned. Rule 15 justification in the ADR.
- `tests/integration/cs-api-role.test.ts` — skip-when-env-missing smoke suite (5 assertions: rpc_api_key_verify context, rpc_api_key_status enum, api_keys SELECT denied, consent_events / organisations SELECT denied, rpc_consent_record not-yet-granted).

### Removed
- `scripts/mint-role-jwt.ts` — dead-on-arrival given the HS256 → ECC P-256 rotation. Preserved in history at commit `b6f41a2`.

### Tested
- [x] 100/100 integration tests pass + 5 skipped (cs_api smoke waits for env).
- [x] `bun run lint` clean; `bun run build` clean.

## [ADR-1009 Sprint 1.2] — 2026-04-20

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 1 Sprint 1.2 — DB tenant fence on read RPCs

### Changed
- `app/src/lib/consent/verify.ts` — `verifyConsent` and `verifyConsentBatch` each gain required `keyId` param + `api_key_binding` error kind.
- `app/src/lib/consent/read.ts` — same change across `listArtefacts`, `getArtefact`, `listEvents`.
- `app/src/lib/consent/deletion.ts` — same change on `listDeletionReceipts`.
- `app/src/app/api/v1/consent/verify/route.ts`, `app/src/app/api/v1/consent/verify/batch/route.ts`, `app/src/app/api/v1/consent/artefacts/route.ts`, `app/src/app/api/v1/consent/artefacts/[id]/route.ts`, `app/src/app/api/v1/consent/events/route.ts`, `app/src/app/api/v1/deletion/receipts/route.ts` — each route threads `context.key_id` into its helper and maps `api_key_binding` → 403.
- Five integration test files updated to pass `keyId` through to read helpers; `consent-verify.test.ts` + `artefact-event-read.test.ts` additionally seed an `otherKeyId` for cross-org cases.
- New explicit cross-org fence test in `consent-verify.test.ts`: org-bound keyId with `p_org_id=otherOrg` → `api_key_binding` 403.

### Tested
- [x] 100/100 integration suite PASS.

## [ADR-1009 Sprint 1.1] — 2026-04-20

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 1 Sprint 1.1 — DB tenant fence on mutating RPCs

### Changed
- `app/src/lib/consent/record.ts`, `revoke.ts`, `deletion.ts`: each helper gains a required `keyId` param, threaded as `p_key_id` to the underlying RPC. New `api_key_binding` error kind in each discriminated-union error type; detects 42501 and any `api_key_*` / `org_id_missing` / `org_not_found` error messages surfaced by `assert_api_key_binding`.
- `app/src/app/api/v1/consent/record/route.ts`, `app/src/app/api/v1/consent/artefacts/[id]/revoke/route.ts`, `app/src/app/api/v1/deletion/trigger/route.ts`: each route passes `context.key_id` into its helper and maps `api_key_binding` → 403 Forbidden (`API key does not authorise access to this organisation`).
- `tests/rls/helpers.ts`: new `seedApiKey(org, { scopes?, orgScoped? })` helper inserts a test `api_keys` row and returns `{ keyId }`.
- Five integration test files updated to seed a key in `beforeAll` and thread `keyId` through every mutating-helper call.

### Tested
- See CHANGELOG-schema.md § ADR-1009 Sprint 1.1 — 123/123 PASS.

## [ADR-1002 Sprint 5.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement (**COMPLETED**)
**Sprint:** Sprint 5.1 — Exit gate: Mrs. Sharma e2e + OpenAPI sign-off

### Added
- `tests/integration/mrs-sharma.e2e.test.ts` — 10-step §11 BFSI worked example against the live dev DB. Exercises every endpoint shipped in Phases 1–4:
  1. `POST /v1/consent/record` — 5-purpose banking consent with `client_request_id`
  2. `GET /v1/consent/verify` — `granted` + `active_artefact_id`
  3. `POST /v1/consent/verify/batch` — 10,000 identifiers (Sharma at index 7,142 `granted`, 9,999 `never_consented`, order preserved, < 10s)
  4. `POST /v1/consent/artefacts/{id}/revoke` — marketing withdrawal
  5. `GET /v1/consent/verify` — `revoked` with `revocation_record_id` pointer
  6. `GET /v1/consent/artefacts` — 5 rows (4 active, 1 revoked)
  7. `GET /v1/consent/artefacts/{id}` — detail + revocation record
  8. `GET /v1/consent/events` — Mode B event surfaced
  9. `POST /v1/deletion/trigger` — erasure_request sweeps remaining 4 → all 5 revoked
  10. `GET /v1/deletion/receipts` — seeded fixture observable (live Edge Function fan-out is a staging check)

### Changed
- **ADR-1002 status: Completed.** All 8 sprints shipped; `ADR-index.md` flipped.
- OpenAPI stub at `app/public/openapi.yaml` now covers all 10 v1 paths with full error matrices.
- No whitepaper §5 / §11 response-shape drift detected — no whitepaper amendments required this sprint.

### Tested
- [x] 10/10 PASS — Mrs. Sharma e2e (10.81s)
- [x] 121/121 PASS — full integration + DEPA suite
- [x] `cd app && bun run build` — PASS; all 10 v1 routes in manifest
- [x] `bun run lint` — PASS

## [ADR-1002 Sprint 4.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 4.1 — Deletion API (`POST /v1/deletion/trigger` + `GET /v1/deletion/receipts`)

### Added
- `app/src/app/api/v1/deletion/trigger/route.ts` — POST. Scope `write:deletion`. Body validation (missing fields list; reason enum; purpose_codes / scope_override array + element-type; actor_type enum; actor_ref). Maps RPC errors: 404 property_not_found; 501 retention_mode_not_yet_implemented; 422 on unknown_reason / purpose_codes_required_for_consent_revoked / unknown_actor_type / invalid_identifier. Returns 202 on success (deletion_receipts created asynchronously).
- `app/src/app/api/v1/deletion/receipts/route.ts` — GET. Scope `read:deletion`. Optional filters: status, connector_id, artefact_id, issued_after, issued_before, cursor, limit. ISO date + limit validation at route layer.
- `app/src/lib/consent/deletion.ts` — `triggerDeletion` + `listDeletionReceipts` helpers; typed envelopes (`DeletionTriggerEnvelope`, `DeletionReceiptRow`) + error kinds.
- `app/public/openapi.yaml` — `DeletionTriggerRequest` / `DeletionTriggerResponse` / `DeletionReceiptRow` / `DeletionReceiptsResponse` schemas + two new path entries (`/deletion/trigger`, `/deletion/receipts`).

### Tested
- [x] 14/14 PASS — `tests/integration/deletion-api.test.ts`
- [x] 111/111 full integration + DEPA — no regressions
- [x] `cd app && bun run build` — PASS; both routes in manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1002 Sprint 3.2] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 3.2 — Revoke artefact (`POST /v1/consent/artefacts/{id}/revoke`)

### Added
- `app/src/app/api/v1/consent/artefacts/[id]/revoke/route.ts` — POST handler. Scope `write:artefacts` (403), 400 for account-scoped keys, JSON+shape validation (422: missing reason_code; actor_type not in user|operator|system; non-string reason_notes/actor_ref), maps RPC errors to 404 (`artefact_not_found`) / 409 (`artefact_terminal_state`) / 422 (`reason_code_missing`, `unknown_actor_type`).
- `app/src/lib/consent/revoke.ts` — `revokeArtefact(...)` helper + typed `RevokeEnvelope` / `RevokeError`. Service-role client.
- `app/public/openapi.yaml` — `RevokeRequest` + `RevokeResponse` schemas + `/consent/artefacts/{id}/revoke` POST path with 200/401/403/404/409/410/422/429 matrix.

### Tested
- [x] 10/10 PASS — `tests/integration/consent-revoke.test.ts`
- [x] 97/97 full integration + DEPA suite — no regressions
- [x] `cd app && bun run build` — PASS; revoke route in manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1002 Sprint 3.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 3.1 — Artefact + event read endpoints

### Added
- `app/src/app/api/v1/consent/artefacts/route.ts` — GET. `read:artefacts` scope. Parses optional query filters (property_id, data_principal_identifier, identifier_type, status, purpose_code, expires_before, expires_after, cursor, limit). Limit + date ISO validation at the route layer. Maps `bad_cursor` / `bad_filters` / `invalid_identifier` to 422.
- `app/src/app/api/v1/consent/artefacts/[id]/route.ts` — GET. `read:artefacts` scope. Returns detail envelope; null result → 404.
- `app/src/app/api/v1/consent/events/route.ts` — GET. `read:consent` scope. Parses optional filters (property_id, created_after, created_before, source=web|api|sdk, cursor, limit). 422 on bad cursor / malformed filter.
- `app/src/lib/consent/read.ts` — three helpers (`listArtefacts`, `getArtefact`, `listEvents`) + typed envelopes / error kinds. Shared service-role client.
- `app/src/lib/api/v1-helpers.ts` — `readContext` / `respondV1` / `gateScopeOrProblem` / `requireOrgOrProblem` — extracted to remove boilerplate duplication across the four v1 handlers now live (_ping, verify, verify/batch, record, artefacts, artefacts/[id], events).
- `app/public/openapi.yaml` — three new path entries (`/consent/artefacts`, `/consent/artefacts/{id}`, `/consent/events`) + 6 new schemas (`ArtefactListItem`, `ArtefactListResponse`, `ArtefactRevocation`, `ArtefactDetail`, `EventListItem`, `EventListResponse`).

### Tested
- [x] 17/17 PASS — `tests/integration/artefact-event-read.test.ts`
- [x] 87/87 full integration + DEPA — no regressions
- [x] `cd app && bun run build` — PASS; three new routes in manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1002 Sprint 2.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 2.1 — Mode B consent record (`POST /v1/consent/record`)

### Added
- `app/src/app/api/v1/consent/record/route.ts` — POST handler. Reads proxy-injected API context, enforces `write:consent` scope (403), 400 for account-scoped keys, JSON-parse + per-field shape validation (422 with precise detail; per-array-element type checks), captured_at ISO 8601 parse-check, maps RPC errors to 404 / 422 / 500. 201 for new records, 200 for idempotent replay.
- `app/src/lib/consent/record.ts` — `recordConsent(...)` helper + `RecordEnvelope` / `RecordedArtefact` / `RecordError` types. Service-role client (same carve-out as verify + Bearer auth). Typed error kinds: `property_not_found` / `captured_at_stale` / `captured_at_missing` / `purposes_empty` / `invalid_purpose_ids` / `invalid_identifier` / `unknown`.
- `app/public/openapi.yaml` — `RecordRequest`, `RecordResponse`, `RecordedArtefact` schemas + `/consent/record` POST path entry with full response matrix (200/201/401/403/404/410/422/429).

### Tested
- [x] 10/10 PASS — `tests/integration/consent-record.test.ts`
- [x] `cd app && bun run build` — PASS; `/api/v1/consent/record` in route manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1002 Sprint 1.3] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 1.3 — `POST /v1/consent/verify/batch` route + helper + OpenAPI

### Added
- `app/src/app/api/v1/consent/verify/batch/route.ts` — POST handler. Reads proxy-injected API context, enforces `read:consent` scope (403), 400 for account-scoped keys, JSON-parse / shape / per-element validation (422 with precise detail), cap of 10,000 identifiers at route layer (413), maps RPC errors to 404 / 413 / 422 / 500.
- `app/src/lib/consent/verify.ts` — `verifyConsentBatch(...)` helper + `VerifyBatchEnvelope` / `VerifyBatchResultRow` / `VerifyBatchError` types. Shares the service-role client factory with the single-verify helper.
- `app/public/openapi.yaml` — added `VerifyBatchRequest`, `VerifyBatchResponse`, `VerifyBatchResultRow` schemas + `/consent/verify/batch` POST path with 200/401/403/404/410/413/422/429.

### Tested
- [x] 8/8 PASS — `tests/integration/consent-verify-batch.test.ts`
- [x] `cd app && bun run build` — PASS; `/api/v1/consent/verify/batch` in route manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1002 Sprint 1.2] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 1.2 — `GET /v1/consent/verify` route + helper + OpenAPI

### Added
- `app/src/app/api/v1/consent/verify/route.ts` — GET handler. Reads proxy-injected API context, enforces `read:consent` scope (403), validates query params (422 with explicit list of missing names), rejects account-scoped keys (400), maps RPC errors to 404 / 422 / 500. Always calls `logApiRequest`.
- `app/src/lib/consent/verify.ts` — `verifyConsent(...)` helper wrapping `rpc_consent_verify` via the service-role client. Returns a typed envelope (`VerifyEnvelope`) or a typed error (`property_not_found` | `invalid_identifier` | `unknown`).
- `app/public/openapi.yaml` — added `VerifyResponse` schema + `/consent/verify` GET path entry (required query params, `bearerAuth` with `read:consent`, response shapes for 200/401/403/404/410/422/429).

### Tested
- [x] 9/9 PASS — `tests/integration/consent-verify.test.ts`
- [x] `cd app && bun run build` — PASS; `/api/v1/consent/verify` in route manifest
- [x] `bun run lint` — PASS (0 errors, 0 warnings)

## [ADR-1001 Sprint 3.1] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-Marketing + Public API Foundation
**Sprint:** Sprint 3.1 — End-to-end smoke + security review

### Added
- `tests/integration/api-keys.e2e.test.ts` — 13-test end-to-end suite: create → entropy validation → verify → rotate → dual-window → request log + usage RPC → revoke → 410. Documents the rotate+revoke/401 edge case.
- `docs/reviews/2026-04-20-api-key-security-review.md` — security review checklist: threat model, token-in-URL avoidance, logging redaction, key-prefix ergonomics, column-level REVOKE, rate-limit bucket design. 0 blocking / 0 should-fix.

### Changed
- `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` — Appendix E: `cs_live_*` API keys and rate-tier enforcement moved from Roadmap Q2 2026 to **Shipping today**.
- `docs/V2-BACKLOG.md` — C-1 (rotate+revoke 401 vs 410) and C-2 (static rate-tier sync) added.
- ADR-1001 status: **Completed**.

### Tested
- [x] 13/13 PASS — `bunx vitest run tests/integration/api-keys.e2e.test.ts`

## [ADR-1001 Sprint 2.4] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-Marketing + Public API Foundation
**Sprint:** Sprint 2.4 — Rate limiter + request logging + OpenAPI stub

### Added
- `app/src/lib/api/rate-limits.ts` — `limitsForTier(rateTier)` static map (mirrors `public.plans.api_rate_limit_per_hour` + `api_burst`). No DB query per request.
- `app/src/lib/api/log-request.ts` — `logApiRequest(context, route, method, status, latencyMs)` fire-and-forget helper; calls `rpc_api_request_log_insert` via service-role client; swallows errors.
- `app/public/openapi.yaml` — OpenAPI 3.1 stub: `bearerAuth` security scheme, `/_ping` endpoint, 401/410/429 response schemas.

### Changed
- `app/src/proxy.ts` — after Bearer verification: rate-check via `checkRateLimit('api_key:<key_id>', perHour, 60)`; 429 + `Retry-After` + `X-RateLimit-Limit` on breach; injects `x-cs-t` (epoch ms) for route latency tracking.
- `app/src/lib/api/context.ts` — added `requestStart: 'x-cs-t'` to `API_HDR`.
- `app/src/app/api/v1/_ping/route.ts` — reads `x-cs-t` to compute latency; calls `logApiRequest` on 200.

### Tested
- [x] `cd app && bun run build` — PASS (0 errors, 0 warnings)
- [x] `bun run lint` — PASS

## [ADR-1001 Sprint 2.2] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-Marketing + Public API Foundation
**Sprint:** Sprint 2.2 — Bearer middleware + request context

### Added
- `app/src/lib/api/auth.ts` — `verifyBearerToken(authHeader)`: parses `Bearer cs_live_*`, calls `rpc_api_key_verify` (service_role only per migration 20260520000001), distinguishes revoked (410) from invalid (401) via secondary `api_keys` hash lookup. `problemJson()` RFC 7807 body builder.
- `app/src/lib/api/context.ts` — `getApiContext()` reads injected headers into `ApiKeyContext`; `assertScope()` returns 403 response for missing scopes; `buildApiContextHeaders()` used by proxy.ts to stamp context onto the request.
- `app/src/app/api/v1/_ping/route.ts` — canary GET returns `{ ok, org_id, account_id, scopes, rate_tier }` from proxy-injected headers.
- `tests/integration/api-middleware.test.ts` — 6 unit-style integration tests for `verifyBearerToken` (valid, missing, malformed ×2, invalid, revoked).

### Changed
- `app/src/proxy.ts` — added `/api/v1/:path*` to `config.matcher`; added Bearer gate branch that skips `/api/v1/deletion-receipts/*`, validates the token, injects context headers on success, or returns RFC 7807 problem+json (401 / 410).
- `vitest.config.ts` — added `tests/integration/**/*.test.ts` to include list.

### Tested
- [x] 6/6 integration tests — PASS (`bunx vitest run tests/integration/api-middleware.test.ts`)
- [x] `cd app && bun run build` — clean (0 errors, 0 warnings)
- [x] `cd app && bunx tsc --noEmit` — clean

## [ADR-0050 Sprint 2.3] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — invoice history + download + webhook reconciliation

### Added
- `admin/src/app/api/admin/billing/invoices/[invoiceId]/download/route.ts` — GET. Admin proxy enforces `is_admin` + AAL2 before the handler runs. Calls `admin.billing_invoice_detail` first (which enforces the tier + issuer-scope rule and raises for a retired-issuer invoice viewed by a platform_operator). On success, 307-redirects to a 5-minute presigned R2 URL via `presignInvoicePdfUrl`. Returns 409 if the row has no PDF yet (still draft).

### Changed
- `app/src/app/api/webhooks/razorpay/route.ts` — handles `invoice.paid` events. Verbatim-insert already happens (unchanged); the new branch calls `public.rpc_razorpay_reconcile_invoice_paid` with payload `invoice.id` + `invoice.order_id` + `invoice.paid_at` (unix seconds → ISO), then stamps `processed_outcome` as `reconciled:<previous_status>→<new_status>` on match or `reconcile_orphan:<reason>` otherwise. Subscription-event path (ADR-0034) unchanged.

### Tested
- [x] Admin + customer app `bun run build` + `bun run lint` — clean.
- [x] Reconciliation behaviour covered by `tests/billing/webhook-reconciliation.test.ts` (5/5 PASS).

## [ADR-0050 Sprint 2.2] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing

### Added
- `admin/src/lib/storage/sigv4.ts` — admin-side copy of the ADR-0040 hand-rolled AWS sigv4 helper (PUT object + presigned GET). Per the monorepo "share narrowly" discipline, infrastructure glue is duplicated across app/ and admin/ rather than promoted to a shared package.
- `admin/src/lib/billing/render-invoice.ts` — deterministic PDFKit invoice renderer. CreationDate is stamped from `invoice.issue_date` (not wall clock) so identical inputs produce byte-identical output, which is what lets the SHA-256 travel with the invoice row as its content anchor.
- `admin/src/lib/billing/r2-invoices.ts` — R2 upload wrapper over the sigv4 helper. Uploads under `invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf`; computes the SHA-256 server-side before upload; returns `{r2Key, sha256, bytes}`. `presignInvoicePdfUrl(r2Key, expiresIn)` returns short-TTL signed GET URLs.
- `admin/src/lib/billing/resend-invoice.ts` — Resend REST dispatch with the PDF attached as base64. No `@resend/node` dependency (Rule 15).
- `admin/src/app/api/admin/billing/invoices/issue/route.ts` — POST. Validates body → calls `admin.billing_issue_invoice` → loads `admin.billing_invoice_pdf_envelope` → renders PDF → uploads to R2 → `admin.billing_finalize_invoice_pdf` → `sendInvoiceEmail` → `admin.billing_stamp_invoice_email`. Response envelope carries `{invoice_id, invoice_number, pdf_r2_key, pdf_sha256, bytes, email_message_id}`. On post-insert failure the draft invoice survives; operators can recover via a new issuance call (FY sequence gaps are legal).
- `app/` workspace: **no change**. PDF + R2 + Resend-with-attachment live admin-side so customer-app identities never touch the invoice issuance path (Rule 12). The ADR originally placed the handler under `app/src/app/api/admin/billing/...`; that path is retracted in favour of the admin-side location shipped here.

### Tested
- [x] `bun run build` on `admin/` — compiles; `/api/admin/billing/invoices/issue` in the route manifest.
- [x] `bun run lint` on `admin/` — clean.
- [x] `bun run build` + `bun run lint` on `app/` — clean (no regression from workspace install of pdfkit into admin).
- [x] Manual verification of PDF render + R2 upload + Resend dispatch pending on a real issuer + account (infra action: set `R2_INVOICES_BUCKET` + `RESEND_FROM` on the admin Vercel project; flip one issuer to active; run curl).

## [ADR-0049 Phase 2.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Added
- `app/src/app/api/webhooks/sentry/route.ts` — HMAC-SHA256 verify on raw body via `SENTRY_WEBHOOK_SECRET` (timing-safe compare). Filters info/debug, returns 200 on unhandled payload shapes so Sentry doesn't retry, upserts into `public.sentry_events` on `sentry_id` conflict for idempotent retries. Uses the anon key — no service-role.

## [ADR-0049 Phase 1.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Added
- `app/src/lib/rights/rate-limit-log.ts` — fire-and-forget `logRateLimitHit()` posting to `public.rate_limit_events` via the anon REST API. SHA-256s the bucket key. Callers never await; errors swallowed.
- Wired into `app/src/app/api/public/rights-request/route.ts` + `verify-otp/route.ts` — on 429, logger fires before the response.

## [ADR-0045 Sprint 1.2] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle

### Added
- `admin/src/lib/supabase/service.ts` — service-role client factory. Accepts `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. Scoped to admin Route Handlers per CLAUDE.md Rule 5 carve-out.
- `admin/src/lib/admin/invite-email.ts` — Resend dispatch for OTP-based admin invites.
- `admin/src/lib/admin/lifecycle.ts` — shared orchestration (`inviteAdmin`, `changeAdminRole`, `disableAdmin`) — Route Handlers AND Server Actions delegate here.
- `admin/src/app/api/admin/users/invite/route.ts` — POST. Creates auth user + calls admin_invite_create + sends invite email. Rolls back auth user if the RPC refuses.
- `admin/src/app/api/admin/users/[adminId]/role/route.ts` — PATCH. `admin_change_role` + `auth.admin.updateUserById` sync. Returns 207 on db/auth drift.
- `admin/src/app/api/admin/users/[adminId]/disable/route.ts` — POST. `admin_disable` + `app_metadata.is_admin=false` flip. Same 207 pattern.

## [ADR-0034 Sprint 2.2] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations

### Added
- `admin/src/lib/razorpay/client.ts` — typed fetch wrapper. Reads `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`; throws `RazorpayEnvError` on missing env. `issueRefund({paymentId, amountPaise, notes})` returns typed response. `subscriptionDashboardUrl(id)` helper. `RazorpayApiError` wraps HTTP failures with status + parsed payload.
- `admin/src/app/(operator)/billing/actions.ts` extended — `createRefund` now does the full round-trip: pending row → Razorpay → flip via mark_issued / mark_failed. Missing env or payment id degrades to `status:'pending'` with surfaced warning.

## [ADR-0044 Phase 2.5] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.5 — invitation email dispatch

### Added
- `app/src/app/api/internal/invitation-dispatch/route.ts` — POST handler. Called by the Postgres AFTER-INSERT trigger on `public.invitations` (via pg_net) and by the `invitation-dispatch-retry` pg_cron safety-net. Bearer-authenticated with `INVITATION_DISPATCH_SECRET` (the same value as the `cs_invitation_dispatch_secret` Vault secret). Idempotent: the first successful Resend call stamps `email_dispatched_at`; later calls skip. Failures record `email_last_error` + increment `email_dispatch_attempts` so stuck dispatches surface in the admin console.
- `app/src/lib/invitations/dispatch-email.ts` — pure template builder. Role-switch yields subject + heading + body; single HTML shell with a CTA button + plain-text alternative.

### Notes
- Required env vars: `INVITATION_DISPATCH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`. Without `RESEND_API_KEY` the dispatcher returns 503 and records `email_last_error='RESEND_API_KEY not configured'` so the retry cron can pick it up once the key is set.
- Required Vault secrets: `cs_invitation_dispatch_url` (the public URL of the route above), `cs_invitation_dispatch_secret` (same value as the env var). Both must be set before any invite-email will leave the DB; missing Vault secrets yield a soft-null return from `public.dispatch_invitation_email` so the pg_cron retry covers the bootstrap window.

## [ADR-0039] — 2026-04-17

**ADR:** ADR-0039 — Connector OAuth (Mailchimp + HubSpot)
**Sprint:** 1.2 — provider modules + connect/callback routes

### Added
- `app/src/lib/connectors/oauth/types.ts` — shared `OAuthProviderConfig` + `TokenBundle` contracts.
- `app/src/lib/connectors/oauth/mailchimp.ts` — Mailchimp provider. Exchange-code handler fetches metadata endpoint to capture `server_prefix` alongside the long-lived access token. No refresh (Mailchimp tokens don't expire).
- `app/src/lib/connectors/oauth/hubspot.ts` — HubSpot provider. Exchange + refresh share a common `exchangeOrRefresh()` helper. Captures `portal_id` from the account-info endpoint.
- `app/src/lib/connectors/oauth/registry.ts` — dispatch by provider id; `listConfiguredOAuthProviders()` returns only providers with populated client_id/secret env vars.
- `app/src/app/api/integrations/oauth/[provider]/connect/route.ts` — GET starts the handshake. Generates 48-char random state, writes `oauth_states`, redirects to the provider's authorize URL. Admin/owner gated.
- `app/src/app/api/integrations/oauth/[provider]/callback/route.ts` — GET validates state (exists, not consumed, not expired, provider matches, initiator matches), consumes it, exchanges code for tokens, encrypts the bundle via `encryptForOrg`, upserts `integration_connectors` (distinguishes OAuth rows from API-key rows via `(OAuth)` display-name suffix). Redirects back to `/dashboard/integrations` with `?oauth_connected=<provider>` or `?oauth_error=<code>`.

## [ADR-0041] — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox
**Sprints:** 1.1 dep · 1.2 sandbox script · 1.3 orchestrator · 1.5 signature-match

### Added
- `app/package.json` — `@vercel/sandbox@1.10.0` (exact pin per Rule 16). Adds the SDK for creating / managing Firecracker microVMs programmatically.
- `app/sandbox-scripts/probe-runner.mjs` + `package.json` + `README.md` — Playwright scenario executed inside the sandbox. Reads `/tmp/probe-input.json`, sets the consent cookie on the target domain, navigates with `waitUntil:networkidle`, snapshots script/iframe/img srcs + intercepted network URLs + final cookies + title, prints one JSON blob to stdout. No signature matching inside the sandbox — keeps the payload minimal.
- `app/src/app/api/internal/run-probes/route.ts` — POST handler. Bearer-authenticated via `PROBE_CRON_SECRET`. Iterates active `consent_probes` due a run. For each: creates a Vercel Sandbox (`node24`, allow-all network, 2-min timeout), copies `sandbox-scripts/**` in, installs deps + Playwright Chromium, drops the probe config at `/tmp/probe-input.json`, runs the scenario, parses stdout, applies `matchSignatures` + `computeViolations` (shared helper), INSERTs `consent_probe_runs`, bumps `consent_probes.last_run_at` + `next_run_at` per schedule, stops the sandbox.
- `app/src/lib/probes/signature-match.ts` — pure module. Exports `matchSignatures(urls, sigs)` + `computeViolations(detections, consentState)` + `overallStatus(violations)`. Unit-tested in `app/tests/probes/signature-match.test.ts` (10/10 PASS).

### Tested
- [x] `cd app && bunx vitest run tests/probes/signature-match.test.ts` — 10/10 PASS.
- [x] `cd app && bunx tsc --noEmit` — clean.
- [x] `cd app && bun run build` — zero errors / zero warnings; `/api/internal/run-probes` + `/dashboard/probes` in the route manifest.
- [ ] End-to-end sandbox smoke — deploy-time step requiring operator to set `PROBE_CRON_SECRET` on Vercel + `vercel_app_url` + `probe_cron_secret` in Supabase Vault. Documented in ADR-0041 closeout.

## [ADR-0042] — 2026-04-17

**ADR:** ADR-0042 — Signup Idempotency Regression Test

### Added
- `app/src/lib/auth/bootstrap-org.ts` — `ensureOrgBootstrap(supabase, user)` helper. Returns a typed discriminator: `skipped` (existing member | no metadata), `bootstrapped`, or `failed`.
- `app/tests/auth/bootstrap-org.test.ts` — 4 unit tests with a minimal SupabaseClient mock: existing-member skip, no-metadata skip, successful RPC call with correct params, RPC failure discriminator.

### Changed
- `app/src/app/auth/callback/route.ts` — delegates to `ensureOrgBootstrap`. Redirect logic unchanged; runtime behaviour identical.

### Tested
- [x] `cd app && bunx vitest run tests/auth/bootstrap-org.test.ts` — 4/4 PASS.
- [x] `cd app && bunx vitest run` — 9 files, 53/53 PASS.

## [ADR-0040] — 2026-04-17

**ADR:** ADR-0040 — Audit R2 Upload Pipeline
**Sprints:** 1.1 sigv4 · 1.4 delivery-target branch

### Added
- `app/src/lib/storage/sigv4.ts` — hand-rolled AWS sigv4 signer. Exports `putObject({ endpoint, region, bucket, key, body, accessKeyId, secretAccessKey, contentType? })` and `presignGet({...expiresIn?})`. Built on Node `crypto` built-ins only (no new npm dep per Rule #14). Unit-tested in `app/tests/storage/sigv4.test.ts` against AWS-documented constants + deterministic signing-key chain + presigned URL shape (7/7 PASS).

### Changed
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` — after building the ZIP, checks `export_configurations.is_verified`. When true: decrypts credentials via `decryptForOrg`, sigv4-PUTs the archive to `s3://<bucket>/<path_prefix>audit-exports/<org_id>/audit-export-<ts>.zip`, records `delivery_target='r2'` + `r2_bucket` + `r2_object_key` on `audit_export_manifests`, bumps `export_configurations.last_export_at`, and returns JSON `{ delivery, bucket, object_key, size_bytes, download_url, expires_in }` with a 1-hour presigned GET URL. Falls back to the ADR-0017 direct-download path on R2 upload failure (logged) or when no verified config exists.

## [ADR-0037] — 2026-04-17

**ADR:** ADR-0037 — DEPA Completion
**Sprints:** 1.2 rights fingerprint · 1.3 CSV export · 1.4 Audit DEPA section

### Added
- `app/src/lib/rights/fingerprint.ts` — `deriveRequestFingerprint(request, orgId)` helper. sha256(userAgent + ipTruncated + orgId) matching the Cloudflare Worker formula at `worker/src/events.ts:118`. Also exports `extractClientIp` and `truncateIp`.
- `app/src/app/api/orgs/[orgId]/artefacts.csv/route.ts` — GET handler streams `text/csv` for Consent Artefacts honouring the same filters as `/dashboard/artefacts`. Auth via `organisation_members`; no pagination (full filtered result set).

### Changed
- `app/src/app/api/public/rights-request/route.ts` — derives the session fingerprint from incoming request headers and passes it to `rpc_rights_request_create` as `p_session_fingerprint`. No UI or payload change required on the portal form.
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` — ZIP now includes `depa/purpose_definitions.json`, `depa/purpose_connector_mappings.json` (connector display names resolved server-side), `depa/artefacts_summary.csv` (counts by status × framework × purpose_code — no PII), and `depa/compliance_metrics.json`. `manifest.json` + `audit_export_manifests.section_counts` both reflect the DEPA additions.

## [ADR-0025 Sprint 1.2] — 2026-04-17

**ADR:** ADR-0025 — DEPA Score Dimension
**Sprint:** 1.2 — score API endpoint

### Added
- `app/src/app/api/orgs/[orgId]/depa-score/route.ts` — `GET` endpoint returning `{ total, coverage_score, expiry_score, freshness_score, revocation_score, computed_at, stale }`. Auth via `supabase.auth.getUser()` + `organisation_members` membership check. Reads cached row from `depa_compliance_metrics`; falls back to a live `compute_depa_score` RPC call when the cache is empty (flags `stale: true`). Flags `stale: true` when cached `computed_at` is older than 25 hours.

## Review fix-batch — 2026-04-16

**Source:** `docs/reviews/2026-04-16-phase2-completion-review.md` (N-S2)

### Fixed
- `src/app/api/orgs/[orgId]/audit-export/route.ts` — the
  `audit_export_manifests` INSERT was previously awaited but its
  error was never inspected, so a silent insert failure could ship
  a ZIP with no audit-trail row (breaking rule #4's customer-owned-
  record guarantee). Capture `{ error }`, return HTTP 500 with the
  Supabase error message before serving the ZIP.

### Tested
- [x] `bun run test` — 86/86 still passing.
- [x] `bun run build` — clean.

## ADR-0018 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0018 — Pre-built Deletion Connectors (Phase 1)

### Added
- `VALID_CONNECTOR_TYPES` in
  `src/app/api/orgs/[orgId]/integrations/route.ts` now accepts
  `mailchimp` and `hubspot` alongside `webhook`. Per-type required-
  field validation and per-type `configPayload` shape (api_key +
  audience_id for Mailchimp; api_key for HubSpot).

### Changed
- `src/lib/rights/deletion-dispatch.ts`: refactored the single
  inline webhook dispatch into a per-type switch. `dispatchWebhook`
  (existing logic moved verbatim), `dispatchMailchimp`
  (DELETE /3.0/lists/{audience}/members/{md5(email)} with HTTP
  Basic auth), `dispatchHubspot`
  (DELETE /crm/v3/objects/contacts/{email}?idProperty=email with
  Bearer auth). Synchronous-API dispatchers mark the receipt
  `confirmed` on 2xx/404; `dispatch_failed` otherwise with the
  provider's response body in `failure_reason`.

### Tested
- [x] `tests/rights/connectors.test.ts` — 5 new tests for the
  Mailchimp + HubSpot dispatchers via mocked `global.fetch`
  (URL shape, auth header, 204/404/5xx branches, missing-config
  rejection).
- [x] `bun run test` — 81 → 86 PASS.
- [x] `bun run lint` + `bun run build` — clean.

## ADR-0017 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0017 — Audit Export Package (Phase 1)

### Added
- `src/app/api/orgs/[orgId]/audit-export/route.ts`: authenticated
  `POST`. Runs the aggregator RPC, pipes every section into a JSZip
  archive, records a manifest row, returns the archive as an
  `application/zip` attachment. `delivery_target = 'direct_download'`
  for Phase 1; the R2 upload flow is V2-X3.
- `jszip@3.10.1` in `dependencies`, exact-pinned.

### Tested
- [x] Build + lint + test — clean (81/81 pass).

## ADR-0010 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0010 — Distributed Rate Limiter
**Sprint:** Phase 1, Sprint 1.1

### Added
- `@upstash/redis@1.37.0` — REST client for the Vercel Marketplace
  Upstash integration. Exact-pinned.
- `tests/rights/rate-limit.test.ts` — four-case Vitest covering the
  in-memory fallback (fresh / within-limit / exceed / reset-after-window).

### Changed
- `src/lib/rights/rate-limit.ts` — replaces the module-scoped `Map`
  with an Upstash-backed fixed-window counter. `checkRateLimit` is
  now `async`. Primary path: pipeline of `SET NX EX` + `INCR` + `PTTL`,
  one REST round trip. Falls back to the original in-memory Map when
  `KV_REST_API_URL` / `KV_REST_API_TOKEN` (aliased as
  `UPSTASH_REDIS_REST_*`) are unset, with a one-time console warning.
- `src/app/api/public/rights-request/route.ts` and
  `.../verify-otp/route.ts` — both now `await checkRateLimit(...)`
  and use `rl:` key-prefix (`rl:rights:<ip>`, `rl:rights-otp:<ip>`).

### Tested
- [x] `bun run test` — 43 / 43 PASS (was 39, +4 new for rate-limit)
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] Live smoke against Upstash (`scripts/smoke-test-rate-limit.ts`) — PASS; 5 allowed / 2 denied / retry=60s / no fallback warning. Upstash DB: `upstash-kv-citrine-blanket`.

## ADR-0008 Sprint 1.3 — 2026-04-14

**ADR:** ADR-0008 — Browser Auth Hardening
**Sprint:** Phase 1, Sprint 1.3

### Changed
- `src/lib/rights/turnstile.ts` — `TURNSTILE_SECRET_KEY` is now required when
  `NODE_ENV === 'production'`; `verifyTurnstileToken` throws if unset.
  Development mode still falls back to Cloudflare's always-pass test key, but
  now logs a one-time warning. The outgoing `fetch` to the Turnstile endpoint
  now carries an 8-second `AbortSignal.timeout` (also closes S-4 from the
  2026-04-14 review).

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] `bun run test` — 39 / 39 PASS

## B-5 remediation — 2026-04-14

### Changed
- `src/app/api/webhooks/razorpay/route.ts` — unresolved `org_id` now returns
  **422** (with a machine-readable error body) instead of a silent 200. The
  lookup fallback to `razorpay_subscription_id` is preserved. Razorpay will
  retry on non-2xx, buying time for investigation instead of losing the event.

## ADR-0013 Sprint 1.1 — 2026-04-15

### Added
- `src/app/auth/callback/route.ts` — single post-signup / post-confirmation
  handler. Exchanges `?code=…` for a session if present, then runs
  `rpc_signup_bootstrap_org` when the user has no org membership and has
  `org_name` in `user_metadata`. Redirects to `/dashboard` on success,
  `/login?error=…` on failure.

### Removed
- `src/app/api/auth/signup/route.ts` — superseded by `/auth/callback`.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS (38 routes; `/auth/callback` present,
  `/api/auth/signup` gone)
- [x] `bun run test` — 39 / 39 PASS

## S-3 / S-6 remediation — 2026-04-14

### Changed
- `src/app/api/webhooks/razorpay/route.ts` — reads
  `x-razorpay-event-id`, calls `rpc_webhook_mark_processed` before the state
  transition, returns `{received:true, duplicate:true}` on replays.
- `src/lib/encryption/crypto.ts` — adds a 60-second in-process cache for
  per-org derived keys. Eliminates the per-call round trip to
  `organisations.encryption_salt` during hot paths (e.g. batch deletion
  dispatch).

## ADR-0009 Sprint 2.1 + 3.1 — 2026-04-14

### Changed
- `src/app/(public)/rights/[orgId]/page.tsx` — uses anon client + `rpc_get_rights_portal`.
- `src/app/(public)/privacy/[orgId]/page.tsx` — uses anon client + `rpc_get_privacy_notice`.
- `src/app/api/auth/signup/route.ts` — calls `rpc_signup_bootstrap_org` under
  the user's JWT. `userId` body field is no longer trusted (auth.uid() wins).
- `src/app/api/webhooks/razorpay/route.ts` — signature verify stays in Node,
  state transitions delegated to `rpc_razorpay_apply_subscription`.
- `src/app/api/orgs/[orgId]/rights-requests/[id]/events/route.ts` —
  `rpc_rights_event_append`.
- `src/app/api/orgs/[orgId]/banners/[bannerId]/publish/route.ts` —
  `rpc_banner_publish`; Cloudflare KV invalidation + grace-period secret
  storage remain in Node because they need the CF API token.
- `src/app/api/orgs/[orgId]/integrations/route.ts` —
  `rpc_integration_connector_create`.
- `src/lib/billing/gate.ts`, `src/lib/encryption/crypto.ts`,
  `src/lib/rights/deletion-dispatch.ts` — all now take a `SupabaseClient`
  parameter instead of creating an internal service-role client.

Net effect: `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
Service-role key is now only used by migrations.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS (38 routes)
- [x] `bun run test` — 39/39 PASS

## ADR-0009 Sprint 1.1 — 2026-04-14

**ADR:** ADR-0009 — Scoped-Role Enforcement in REST Paths
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `src/app/api/public/rights-request/route.ts` — now calls
  `rpc_rights_request_create` via the anon key. Service-role client removed.
- `src/app/api/public/rights-request/verify-otp/route.ts` — now calls
  `rpc_rights_request_verify_otp` via the anon key. OTP state transitions,
  rights_request_events insert, and audit_log insert all happen atomically
  server-side.
- `src/app/api/v1/deletion-receipts/[id]/route.ts` — now calls
  `rpc_deletion_receipt_confirm` via the anon key. Signature verification
  still happens in Node. Replays and racing updates now return 409.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] `bun run test` — 39 / 39 PASS

## [ADR-0050 Sprint 3.1] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.1

### Changed
- `admin/src/lib/billing/build-export-zip.ts` — extracted pure ZIP+CSV assembly into a standalone function so it is testable without Next.js runtime or real R2.
- `admin/src/app/(operator)/billing/export/actions.ts` — refactored to call `buildExportZip(envelope, fetchInvoicePdf)` via the extracted module.
- `admin/src/lib/billing/r2-invoices.ts` — updated to support manifest-driven multi-PDF fetch for export flow.
- `admin/src/lib/storage/sigv4.ts` — minor fixes to SigV4 signing for R2 presigned URL generation.

### Tested
- [x] `tests/billing/invoice-export-contents.test.ts` — 7/7 PASS (unit-testable without runtime; validates CSV structure, SHA-256, audit round-trip)

## [ADR-0050 Sprint 3.2] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.2

### Changed
- `app/src/app/api/webhooks/razorpay/route.ts` — Extended to handle `dispute.created`, `dispute.won`, `dispute.lost`, `dispute.closed` events. After the verbatim insert, calls `rpc_razorpay_dispute_upsert` to create/update the structured dispute row. Dispute entity type added to payload type.

### Tested
- [x] `cd app && bunx tsc --noEmit` — PASS

## [ADR-0054 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0054 — Customer-facing billing portal
**Sprint:** Phase 1, Sprint 1.1

### Added
- `app/src/app/api/billing/invoices/[invoiceId]/pdf/route.ts` — GET handler that calls `get_account_invoice_pdf_key` (enforces scope via SECURITY DEFINER RPC), presigns a 15-minute R2 URL, and 302-redirects. Returns 401 if unauthenticated, 403 on role denial, 404 on not-found/void/unavailable.

### Note
- Route path is `/api/billing/*`, not `/api/orgs/[orgId]/billing/*` — invoices are account-scoped, not org-scoped. The caller's account context is resolved server-side via the RPC, not URL parameter.

## [ADR-0046 Phase 4] — 2026-04-20

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 4 — DPIA export extension

### Changed
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` — extended ADR-0017 audit ZIP with an `sdf/` section: `sdf_status.json` + `dpia_records.json` + `data_auditor_engagements.json`. `section_counts` in manifest.json extended; no breaking change to the existing shape. Rule 3 respected — categories + references only.

### Note
- SDF files are emitted for all orgs (even non-SDF) so ZIP shape stays stable across customers. Empty arrays for orgs with no DPIA records / engagements.

## [ADR-0052 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0052 — Razorpay dispute contest submission

### Added
- `admin/src/lib/razorpay/client.ts` — extended with `uploadDocument()` (multipart POST to `/v1/documents`, zero-dep encoding per Rule 15) and `contestDispute()` (JSON POST to `/v1/disputes/{id}/contest`).
- `admin/src/lib/billing/r2-disputes.ts` — new `fetchEvidenceBundle(r2Key)` helper.
- `submitContestViaRazorpay(disputeId)` server action — orchestrates bundle fetch → doc upload → contest submit → response persistence.

### Changed
- `admin/.env.local` — added `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (test mode) for admin-side Razorpay API access.
- `scripts/check-env-isolation.ts` — removed `RAZORPAY_KEY_SECRET` from the admin-blocked list (admin genuinely needs it for refund + contest flows). `RAZORPAY_WEBHOOK_SECRET` stays customer-only.

### Tested
- [x] `tests/billing/dispute-contest-razorpay.test.ts` — 6/6 PASS via mocked fetch (multipart shape, contest JSON shape, summary/amount validators, RazorpayApiError surface)
