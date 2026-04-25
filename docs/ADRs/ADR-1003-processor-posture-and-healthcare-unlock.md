# ADR-1003: Processor Posture + Healthcare Category Unlock

**Status:** In Progress
**Date proposed:** 2026-04-19
**Date started:** 2026-04-24
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 3
**Depends on:** ADR-1001 (API keys), ADR-1002 (verify + record endpoints)
**Related gaps:** G-041, G-006, G-005, G-042, G-046

---

## Context

Section 2 of the v2.0 whitepaper makes a first-order claim: three processing modes (Standard, Insulated, Zero-Storage) answer the BFSI and healthcare buyer's question *"where does our data live?"* §2.2 positions Zero-Storage enforcement as "Security Rule 9 — a non-negotiable architectural constraint." §8 positions zero-persistence of regulated content as the single most important architectural claim for BFSI and healthcare procurement.

The verification sweep found that the `storage_mode` column exists on the org record (migration `20260413000003_operational_tables.sql`) but *nothing inspects it at runtime*. A zero-storage org today is indistinguishable from a standard org in the data plane; the claim is declarative-only. The BYOS credential-validation flow exists as SigV4 plumbing (ADR-0040) but lacks the scope-down probe and UX promised in §2.3. The healthcare sector seed — the starting point for every ABDM clinic customer — doesn't exist; only BFSI is seeded. And the sandbox org provisioning claimed in §12.1 / §14 ("free sandbox within the hour") has no flow.

These gaps together block the BFSI Enterprise category (Zero-Storage mandatory per RBI outsourcing posture) and the Healthcare category (Zero-Storage mandatory for FHIR; plus no SKU without the template).

## Decision

Deliver processor-posture enforcement and the healthcare category unlock:

1. **G-041** — `storage_mode` enforcement at every write path. Worker, Edge Functions, `/v1/consent/record` consult the mode and branch persistence strategy. Zero-storage orgs have zero rows in `consent_events`, `consent_artefacts`, or `delivery_buffer` after any number of events. Invariant-tested.
2. **G-006** — BYOS credential validation flow. Customer pastes S3/R2 creds; platform does PutObject, HeadObject, and probes for scope-down (rejects GetObject / ListBucket / DeleteObject permissions). Tested against AWS S3, Cloudflare R2, and one compatible provider.
3. **G-005** — Zero-Storage end-to-end validation. TTL-bounded `consent_artefact_index` refreshing from customer storage. Memory-only `delivery_buffer` path. Four-week internal or launch-partner deployment.
4. **G-042** — Healthcare sector template seed: ABDM/DISHA-aligned purposes, retention rules, connector-mapping defaults, zero-storage default.
5. **G-046** — Sandbox org provisioning. Self-serve button creates `org_test_<nanoid>` with the chosen sector template, no billing, 1000/hr rate limits, test-principal generator.

## Consequences

- Every whitepaper claim about "ConsentShield doesn't hold regulated content" becomes a structurally enforced claim, not a policy document. Security Rule 9 has runtime teeth.
- The BFSI Enterprise category is sell-ready (Zero-Storage defensible against RBI outsourcing scrutiny).
- The Healthcare bundle has a SKU — clinics get DEPA artefact capture with a ABDM-aligned starting point on day one.
- Procurement-to-go-live compresses: prospects can provision a sandbox in minutes, wire one integration, demo end-to-end, and inform internal stakeholders before formal contracting.
- Standard mode remains unchanged. Existing Standard-mode orgs need no migration.
- Moving between modes remains a managed migration (not self-serve) as spec'd in §2.2.

---

## Implementation Plan

### Phase 1: `storage_mode` runtime enforcement (G-041)

#### Sprint 1.1: Mode resolver + KV cache

**Estimated effort:** 1 day

**Amendments (2026-04-24):**

1. **Single bundled KV key** at `storage_modes:v1` holding the whole `{<org_id>: <mode>}` map, not one key per org. Rationale: Worker hot path is per-request, not per-org; one KV read per instance-warmup serves every distinct org in that instance. Matches `sync-admin-config-to-kv` (ADR-0027 Sprint 3.2). Scales to ≥ 10k orgs (< 200KB payload vs KV's 25MB value limit) and mode changes are rare ("managed migration" per §2.2).
2. **Gated write RPC landed now**, not deferred to ADR-0044 integration. There is no storage_mode write site in running code today; future callers go through `admin.set_organisation_storage_mode(p_org_id, p_new_mode, p_reason)` (platform_operator+ gate, audit-logged, fires dispatch). This is the ADR-0044 plan-gating extension.

**Deliverables:**
- [x] Migration `20260804000050_adr1003_s11_storage_mode_resolver.sql`:
  - `public.get_storage_mode(p_org_id)` STABLE, granted to cs_api / cs_orchestrator / cs_delivery / cs_admin.
  - `public.org_storage_modes_snapshot()` SECURITY DEFINER, returns jsonb map.
  - `admin.set_organisation_storage_mode(...)` platform_operator+ gated, audit-logged as `adr1003_storage_mode_change` (or `_noop` for same-value flips).
  - `public.dispatch_storage_mode_sync()` SECURITY DEFINER via `net.http_post` + Vault URL + shared `cs_provision_storage_secret` bearer.
  - AFTER UPDATE OF storage_mode trigger with `IS DISTINCT FROM` guard + EXCEPTION swallow.
  - `pg_cron 'storage-mode-kv-sync'` every minute (safety net).
- [x] `app/src/app/api/internal/storage-mode-sync/route.ts` — bearer-authed POST. Reads `org_storage_modes_snapshot()`, PUTs JSON to CF KV at `storage_modes:v1` via CF REST API. Returns `{ok, kv_key, org_count, payload_bytes, duration_ms}`.
- [x] `worker/src/storage-mode.ts` — `getStorageMode(env, orgId)` + `isZeroStorage(env, orgId)`. Reads the bundled KV key, module-scope 60 s cache, fail-safe to `'standard'` on missing key / unknown org / malformed value.
- [x] `app/src/lib/storage/mode.ts` — `getStorageMode(pg, orgId)` via `public.get_storage_mode`. No KV layer on the Next.js side — a single indexed SELECT is cheaper than a CF API round-trip and immediately correct.
- [x] Operator runbook step: seed `cs_storage_mode_sync_url` in Vault (the bearer is already shared from ADR-1025).

**Testing plan:**
- [x] `app/tests/worker/storage-mode.test.ts` — 13 tests. Type guard, KV hit/miss/malformed, unknown-org fallback, cache TTL honoured (one KV read covers many lookups), cache re-reads after TTL. PASS.
- [x] `app/tests/storage/mode.test.ts` — 5 tests. Type guard + Next.js helper RPC call shape + null/empty/unknown fallbacks. PASS.
- [x] `bun run lint` — 0 violations. `bun run build` — Next.js 16 clean. `cd worker && bunx tsc --noEmit` — clean.
- [ ] Live: flip a test org via `admin.set_organisation_storage_mode(...)` → assert KV bundle updated within 5 s → Worker reads the new mode within 60 s. Pending operator (needs the Vault URL seed + `bunx supabase db push`).

**Status:** `[x] complete (code); live verification pending operator runbook step.`

#### Sprint 1.2: Worker branch paths

**Estimated effort:** 2 days

**Amendments (2026-04-24):**

1. **Bridge architecture instead of direct Edge-Function invocation.** Worker branches for zero_storage orgs and POSTs the full canonical payload (via `ctx.waitUntil` for fire-and-forget latency) to a new Next.js bridge route `/api/internal/zero-storage-event`. The bridge uploads the payload to the customer's R2 bucket via `sigv4.putObject` (reusing the ADR-1019 primitive). Reasons: (a) the Edge Function (Deno) can't use `app/src/lib/storage/sigv4.ts` and `org-crypto.ts` without porting; (b) ADR-1025's bridge-style pattern is the established convention for scheduled storage work; (c) the Worker-to-Next.js trust boundary uses a fresh shared secret `WORKER_BRIDGE_SECRET` (separate from `STORAGE_PROVISION_SECRET` so the two trust domains rotate independently).
2. **Mode-flip precondition added in `admin.set_organisation_storage_mode`.** Flipping an org to `zero_storage` now requires a verified `export_configurations` row (`is_verified=true`). Without that precondition the bridge has nowhere to PUT and events would be silently dropped.
3. **Graceful fallback when the bridge is unconfigured.** The Worker checks `isBridgeConfigured(env)` before taking the zero_storage branch. When URL or secret is absent (Miniflare harness, misconfigured prod), the Worker falls through to the standard INSERT path — bias is "still writing" over "silently dropping."
4. **Sprint 1.3 scope narrowed to `consent_artefact_index` TTL + invariant test.** Sprint 1.2 lands the full bypass path (Worker → bridge → R2). Sprint 1.3 adds the index writes (so `/v1/consent/verify` can answer for zero_storage orgs) plus the integration-level invariant test. Until 1.3 lands, verify-reads for zero_storage events return "not found" — a feature gap, not data loss.

**Deliverables:**
- [x] Migration `20260804000051_adr1003_s12_zero_storage_gate.sql` — amends `admin.set_organisation_storage_mode` with the zero_storage precondition check.
- [x] `app/src/lib/delivery/zero-storage-bridge.ts` — `processZeroStorageEvent(pg, req, deps?)` orchestrator. Reads `export_configurations`, decrypts credentials via `org-crypto`, canonicalises the payload, uploads to R2 via `sigv4.putObject` with metadata headers (`cs-org-id`, `cs-kind`, `cs-event-fingerprint`, `cs-timestamp`). Object layout: `<prefix>zero_storage/<kind>/<YYYY>/<MM>/<DD>/<fingerprint>.json`. Defensive KV-stale guard: re-reads `storage_mode` from the DB and refuses if the org isn't actually zero_storage.
- [x] `app/src/app/api/internal/zero-storage-event/route.ts` — bearer-authed POST on `WORKER_BRIDGE_SECRET`. Validates `{kind, org_id, event_fingerprint, timestamp, payload}` body. Runs under `csOrchestrator()`.
- [x] `worker/src/zero-storage-bridge.ts` — `postToBridge(env, params)` + `isBridgeConfigured(env)`. Fetch-based client; returns structured `{sent, reason, status?, detail?}` result. Rule 16 intact (zero npm deps).
- [x] `worker/src/index.ts` — `Env` extended with `ZERO_STORAGE_BRIDGE_URL` + `WORKER_BRIDGE_SECRET` (both optional — Miniflare / dev fall through).
- [x] `worker/src/events.ts` + `worker/src/observations.ts` — branch on `isZeroStorage(env, org_id)` before the INSERT path. `ctx.waitUntil(postToBridge(...))` schedules the POST without blocking the response. Bridge-send failures are logged via `logWorkerError` (bubbles to `worker_errors` table → admin dashboard).

**Testing plan:**
- [x] `app/tests/worker/zero-storage-bridge.test.ts` — 7 tests. `isBridgeConfigured` branches; `postToBridge` happy-path + not_configured + non_2xx + network_error.
- [x] `app/tests/delivery/zero-storage-bridge.test.ts` — 8 tests. Stale-KV guard / no_export_config / unverified / endpoint_failed / decrypt_failed / upload_failed / happy path (verifies object key + metadata headers + NO INSERT/UPDATE/DELETE in the query log) / unparseable timestamp uses `now()`.
- [x] Full worker suite 41/41 PASS (existing banner / events / observations / blocked-ip / role-guard + storage-mode + zero-storage-bridge).
- [x] `bun run lint` + `bun run build` + `cd worker && bunx tsc --noEmit` — all clean.
- [ ] Live verification: flip a test org to zero_storage (after provisioning R2 per Sprint 1.1 precondition) + seed `ZERO_STORAGE_BRIDGE_URL` in wrangler + operator posts an event against the live Worker. Pending operator.

**Operator follow-up (pre-activation):**
- Generate + set `WORKER_BRIDGE_SECRET` — `wrangler secret put WORKER_BRIDGE_SECRET` + `vercel env add WORKER_BRIDGE_SECRET`.
- Set `ZERO_STORAGE_BRIDGE_URL=https://app.consentshield.in/api/internal/zero-storage-event` — `wrangler secret put`.
- `bunx supabase db push` from repo root to apply the migration.
- Smoke: flip a test org → POST an event → R2 bucket shows an object at `<prefix>zero_storage/consent_event/<date>/<fp>.json`.

**Status:** `[x] complete (code + unit tests); live verification pending operator runbook step.`

#### Sprint 1.3: Bridge `consent_artefact_index` seed + invariant test

**Estimated effort:** 2 days

**Deliverables:**
- [x] Bridge orchestrator (`app/src/lib/delivery/zero-storage-bridge.ts`) writes `consent_artefact_index` (TTL-bounded, 24h) after a successful R2 upload — best-effort, never blocks the upload, never persists to `consent_artefacts`. **Amendment vs proposal:** the proposal said "extend `process-consent-event` Edge Function." We landed the work in the Next.js bridge instead, since the zero-storage path already lives there (Sprint 1.2) and Deno Edge Functions can't use Node-native `sigv4.ts` / `org-crypto.ts` without porting.
- [x] `delivery_buffer`: zero-storage path remains transient — Worker `ctx.waitUntil(postToBridge(...))` returns 202; bridge does inline R2 PUT; no durable row anywhere. (Already true since Sprint 1.2; explicitly re-asserted by the invariant test.)
- [x] Migration `20260804000052_adr1003_s13_zero_storage_artefact_index.sql` — `grant insert on public.consent_artefact_index to cs_orchestrator`. cs_orchestrator already had SELECT + UPDATE on a few specific columns; INSERT was missing.
- [x] Invariant test: create zero-storage org, run 10 bridge events × 2 purposes, assert zero rows across `consent_events`, `consent_artefacts`, `delivery_buffer`, `artefact_revocations`, `audit_log` for that org_id, AND 20 rows in `consent_artefact_index` with the right shape. **Amendment vs proposal:** narrowed from 1000 to 10 events — large enough to assert the invariant, small enough to keep the integration suite under a minute on dev DB. Sprint 3.2 owns the 100K-event load test.
- [x] Counter-test for a Standard org: bridge call refuses with `mode_not_zero_storage`, AND a direct INSERT into `consent_events` succeeds (proves the buffer-table absence is a bridge-code property, not a schema lock-out).
- [x] Idempotency case: replaying the same `event_fingerprint` → ON CONFLICT DO NOTHING → `BridgeResult.indexed = 0`, no error.
- [x] Runbook `docs/runbooks/zero-storage-restart.md` documenting the durability posture (`ctx.waitUntil` is not a buffer; R2 is the durability layer; index seed is best-effort) + the five common failure modes and the operator response for each.

**Testing plan:**
- [x] `app/tests/delivery/zero-storage-bridge.test.ts` extended to 15 tests — all PASS via `bunx vitest run tests/delivery/zero-storage-bridge.test.ts` (tested 2026-04-24).
- [x] `tests/integration/zero-storage-invariant.test.ts` — written; live run pending operator `bunx supabase db push` (queued with migrations 45 / 48 / 49 / 50 / 51 / 52). Skip-on-missing-env in `SUPABASE_CS_ORCHESTRATOR_DATABASE_URL` + `MASTER_ENCRYPTION_KEY`.
- [x] Root `vitest.config.ts` now exposes the `@/` alias → `app/src` so cross-tree integration tests can import production modules.

**Status:** `[x] complete (code + unit tests; integration test pending the queued migration push by operator).`

#### Sprint 1.4: `rpc_consent_record` storage_mode fence (Mode B closure)

**Estimated effort:** 1 day

Closes the follow-up flagged in Sprint 3.1's Deferred block: today `rpc_consent_record` writes to `consent_events` + `consent_artefacts` + `consent_artefact_index` regardless of the org's `storage_mode`. For zero_storage orgs this violates the Sprint 1.3 invariant on the Mode B write path (Worker path — Mode A — is already covered).

Also closes the secondary gap flagged in Terminal A's handoff: the Sprint 1.3 bridge seeds `consent_artefact_index` rows with `identifier_hash = NULL` (Worker path is anonymous), so `/v1/consent/verify` on zero_storage orgs always returns `never_consented`. Mode B knows the identifier — the bridge must write `identifier_hash` when the caller supplies it.

**Design choices:**

1. **Fence at the RPC, not at the helper.** `rpc_consent_record` reads `get_storage_mode(p_org_id)` as its first check; if `zero_storage` it raises `storage_mode_requires_bridge` with errcode `P0003`. Even if a future Node caller forgets to branch, the SQL refuses. Defense-in-depth.
2. **Separate `rpc_consent_record_prepare_zero_storage` RPC for the zero-storage path.** cs_api EXECUTE; SECURITY DEFINER; does the same validation surface as `rpc_consent_record` (assert_api_key_binding, property, captured_at, purposes, identifier normalisation + hash), but writes nothing — returns the canonical fingerprint + purpose metadata + deterministic artefact_ids so the Node side can feed the bridge. This keeps validation in one SQL place for both paths.
3. **Deterministic fingerprint** = `substr(encode(sha256(org_id || property_id || identifier_hash || coalesce(client_request_id, captured_at::text)), 'hex'), 1, 32)`. Same `client_request_id` → same fingerprint → same artefact_ids → ON CONFLICT DO NOTHING on index → idempotent. Mirrors the Worker path's `zs-<fingerprint>-<purpose_code>` artefact scheme.
4. **Bridge extends to carry `identifier_hash` + `identifier_type` through the payload.** `indexAcceptedPurposes` writes them into `consent_artefact_index` when present. Worker path (Mode A) continues to pass neither — falls through to NULL. Backward-compatible.
5. **Envelope shape.** Mode B zero_storage returns `event_id = "zs-<fingerprint>"` (string, not UUID) + `created_at = captured_at` + `artefact_ids` with deterministic ids + `idempotent_replay`. The `event_id` contract widens from "UUID" to "opaque string" — only consumed by the `/v1/consent/record` HTTP response; no internal caller indexes on it.

**Deliverables:**
- [x] Migration `20260804000054_adr1003_s14_rpc_consent_record_mode_fence.sql`:
  - Amend `rpc_consent_record`: top-of-function `if public.get_storage_mode(p_org_id) = 'zero_storage' then raise exception 'storage_mode_requires_bridge' using errcode = 'P0003'`.
  - New `public.rpc_consent_record_prepare_zero_storage(...)` SECURITY DEFINER; cs_api EXECUTE. Validates, hashes identifier, computes fingerprint, returns canonical jsonb envelope.
- [x] `app/src/lib/delivery/zero-storage-bridge.ts` — `BridgeRequest.payload` optionally carries `identifier_hash` + `identifier_type`; `indexAcceptedPurposes` writes them when present. No change to R2 layout (payload goes through `canonicalJson` unchanged).
- [x] `app/src/lib/consent/record.ts` — upfront `get_storage_mode` check via cs_api. Zero-storage branch calls `rpc_consent_record_prepare_zero_storage` + `processZeroStorageEvent` (via cs_orchestrator) + returns `"zs-<fingerprint>"` envelope. Safety-net catch for `storage_mode_requires_bridge` errcode P0003 (handles race between mode check and RPC call). New error kind `zero_storage_bridge_failed` mapped to 502 Bad Gateway in the `/v1/consent/record` route (honest upstream-failure signal for retries).

**Testing plan:**
- [x] Unit — `app/tests/consent/record.test.ts` — 7 tests. Standard path unchanged, api_key_binding classification, zero-storage happy path (prepare RPC → bridge → envelope), idempotent_replay flag, replay-not-flagged-on-indexError, zero_storage_bridge_failed on upload_failed, race recovery on P0003.
- [x] Unit — `app/tests/delivery/zero-storage-bridge.test.ts` extended with two Sprint 1.4 cases: identifier_hash propagates to INSERT when payload carries it; Worker-path payload writes NULL.
- [x] Integration — `tests/integration/zero-storage-invariant.test.ts` Mode B suite: seed api_key for zero org, call `recordConsent` with identifier, assert 0 buffer rows + 2 index rows + rows carry salted-sha256 identifier_hash + identifier_type='email'. Idempotent-replay case: second call with same `client_request_id` returns `idempotent_replay=true` + same deterministic artefact_ids.
- [x] `bun run lint` + `bun run build` + `cd worker && bunx tsc --noEmit` — all clean (app lint + check-no-service-role; next build 48/48 routes; worker tsc silent).
- [x] Full local vitest sweep across `delivery` / `worker` / `storage` / `consent` — 245/245 PASS.
- [x] Live: operator pushed migration 54 (2026-04-25). Live run of the integration test surfaced a latent permissions gap — `recordConsent`'s cs_api pre-flight `select public.get_storage_mode(orgId)` ran the plain-SQL function body in cs_api's context, tripping the organisations RLS policy → `permission denied for schema auth`. Closed by migration 57 (`get_storage_mode` re-published SECURITY DEFINER), test-setup hardened (storage_mode flip via service-client since Sprint 1.1 revoked direct UPDATE from cs_orchestrator), and Mode B assertion narrowed (`identifier_hash IS NOT NULL` so Sprint 1.3's cumulative Mode A rows don't count against the expected-2 total). 5/5 integration tests PASS against live DB with `--reporter=verbose`.

**Status:** `[x] complete (code + unit tests + integration test + live verification — Sprint 4.1 Phase 1 operator runbook ran on 2026-04-25; migration 57 follow-up shipped).`

### Phase 2: BYOS credential validation (G-006)

#### Sprint 2.1: Credential-validation UX

**Estimated effort:** 3 days

**Deliverables:**
- [x] `/dashboard/settings/storage` page already exists from ADR-1025 Sprint 3.1; Sprint 2.1 amended the BYOK form (`byok-form.tsx`) to render a 5-row probe-check breakdown (PutObject must pass; HeadObject / GetObject / ListObjectsV2 / DeleteObject must each 403) with per-check status and an aggregated remediation copy.
- [x] `app/src/lib/storage/validate.ts` — `runScopeDownProbe` orchestrator:
  - PutObject the `cs-probe-<nanoid>.txt` sentinel; must return 2xx.
  - HeadObject + GetObject on the same key; each must return 4xx (R2 + S3 collapse HeadObject into the s3:GetObject permission).
  - ListObjectsV2 on the bucket root; must return 4xx.
  - DeleteObject on the sentinel key; must return 4xx. **The sentinel object stays in the customer's bucket by design** — a correctly-scoped credential cannot delete it. UI surfaces this with a hint to add a lifecycle rule expiring `cs-probe-*` after 1 day.
  - 5xx or transport errors map to `outcome='error'`; 2xx where we expected deny maps to `over_scoped`; non-2xx where we expected allow maps to `under_scoped`. Any non-`expected` outcome fails the probe.
  - Remediation copy names the specific over-scoped IAM action(s) (s3:GetObject / s3:ListBucket / s3:DeleteObject). Fallback copy for PUT-side failures asks for `s3:PutObject` / "Object Write".
- [x] `app/src/lib/storage/sigv4.ts` — added probe-friendly `probeHeadObject`, `probeGetObject`, `probeListObjectsV2`, `probeDeleteObject` that return `{status}` for any HTTP response (including 4xx) rather than throwing. Sigv4-signed. Share the empty-payload hash and signing chain with the existing `deleteObject` helper.
- [x] `app/src/app/api/orgs/[orgId]/storage/byok-validate/route.ts` — swapped the 4-step PUT/GET/sha256/DELETE verification probe (ADR-1025 semantics) for the 5-check scope-down probe for every BYOK provider. Response envelope now carries `{ok, probe_id, duration_ms, checks, remediation?, orphan_object_key?}`. The ADR-1025 round-trip verify stays where it belongs — provisioning CS-managed buckets (which own full creds).
- [x] Encrypted storage with per-org key derivation is unchanged — the Sprint 2.1 validate route stays stateless and never persists credentials; the byok-migrate route owns the encryption step.

**Testing plan:**
- [x] Unit — over-scoped credential (admin-grade, all probes return 2xx) → `ok=false`, remediation names all three over-scoped actions.
- [x] Unit — correctly-scoped PutObject-only credential → `ok=true`, remediation unset.
- [x] Unit — under-scoped PUT (403) → `ok=false`, early-out; remaining probes not invoked; remediation names `s3:PutObject`.
- [x] Unit — partial over-scoping (e.g., DELETE only) → remediation names exactly the over-scoped action.
- [x] Unit — network error on a deny-expected probe → `outcome='error'` (inconclusive; fails the overall probe) with remediation mentioning transport errors.
- [x] Unit — 5xx on a deny-expected probe → `outcome='error'` (not `expected`).
- [x] Unit — deterministic probeId when `randomBytesFn` is injected.
- [x] Sigv4 — probe helpers resolve (not throw) on 403; HEAD sets method=HEAD; LIST hits bucket root with `?list-type=2`.
- [ ] Manual test on AWS S3, Cloudflare R2, DigitalOcean Spaces — deferred to operator validation against real buckets.

**Status:** `[x] complete (code + unit tests; live manual tests across AWS / R2 / Spaces pending operator).`

#### Sprint 2.2: Documentation + migration procedure

**Estimated effort:** 2 days

**Deliverables:**
- [x] `docs/customer-docs/byos-aws-s3.md` — complete write-only IAM policy JSON, bucket creation (aws s3api commands), IAM user + access key sequence, pasting into the dashboard, expected probe output, orphan `cs-probe-*` lifecycle rule, credential rotation procedure, troubleshooting table keyed to the probe-check outcomes.
- [x] `docs/customer-docs/byos-cloudflare-r2.md` — R2 bucket creation (wrangler + dashboard), honest coverage of R2's permission scopes versus ConsentShield's scope-down probe (the standard "Object Read & Write" scope fails the probe; users need R2 custom permissions), S3 compatibility notes (region=auto, account-scoped endpoint, lifecycle via S3 API), troubleshooting table.
- [x] `docs/runbooks/standard-to-insulated-migration.md` — operator + customer runbook for the migration cut-over. Pre-flight SQL queries, cut-over-mode comparison (`forward_only` vs `copy_existing`), live monitoring queries, stuck-row diagnosis + manual advance, post-cut-over validation, one-way rollback procedure with the explicit caveat that ConsentShield cannot pull records back from the customer's bucket.

**Testing plan:**
- [ ] Self-test: follow the AWS doc from scratch, end-to-end, on a fresh AWS account. Deferred to operator validation.
- [ ] Self-test: follow the R2 doc from scratch on a fresh Cloudflare account. Deferred to operator validation.

**Status:** `[x] complete (docs written; end-to-end self-tests pending operator run against fresh AWS + Cloudflare accounts).`

### Phase 3: Zero-Storage end-to-end validation (G-005)

#### Sprint 3.1: TTL-bounded index behaviour

**Estimated effort:** 3 days

**Amendment vs proposal.** The proposal called for "on read, if entry stale, fetch from customer storage and repopulate". That is incompatible with Sprint 2.1's scope-down invariant (ConsentShield's BYOK credential has `PutObject` only — NOT `GetObject` / `ListBucket` / `DeleteObject`). Sprint 3.1 therefore amends the refresh mechanism: instead of auto-pulling from the customer's bucket, we extend TTL for rows that are proven hot by recent verify traffic. Cold rows expire; customer-driven replay via `/v1/consent/record` is the re-hydration path. An automated fetch-from-R2 would require either relaxing scope-down (unacceptable — breaks audit-record immutability) or a customer-side re-signing Worker (deferred architecture decision; not in this phase).

**Deliverables:**
- [x] `consent_artefact_index` for zero-storage orgs gets a TTL (default 24h) — **shipped in Sprint 1.3** via `expires_at = now() + 24h` at bridge-write time.
- [x] Hot-row refresh: `consent_artefact_index.last_verified_at timestamptz` column (migration `20260804000053`) + partial index `idx_consent_artefact_index_hot_rows` for the hot-row query. `rpc_consent_verify` and `rpc_consent_verify_batch` stamp `last_verified_at = now()` on `granted` hits (single UPDATE in the single case; one batched UPDATE keyed by artefact-id array in the batch case).
- [x] Background `refresh-zero-storage-index` pg_cron (hourly at `:15`) — calls `public.refresh_zero_storage_index_hot_rows()`. Extends `expires_at` by 24h on rows where `last_verified_at > now() - 1h` AND `expires_at < now() + 1h`. Cold rows expire naturally. Idempotent within an hour; non-throwing (transient errors leave work for the next run).
- [x] Incident runbook `docs/runbooks/zero-storage-restart.md` — **shipped in Sprint 1.3**; amended in Sprint 3.1 with a "Verify cache refresh" section + operator-facing metrics queries + the explicit statement that auto-refresh-from-R2 is not shipped.

**Deferred to Sprint 3.2 / follow-up ADR:**
- Customer-driven replay infrastructure. For now, a customer whose cold row has expired re-hydrates via `POST /v1/consent/record` (Mode B) with the original event body. Dashboards + CLI tooling to help the customer find what to replay is a separate feature.
- The architectural question of whether `rpc_consent_record` should honour `storage_mode` and route zero_storage inserts to the bridge (today it writes to `consent_events`, which violates the zero-storage invariant for Mode B inserts). Flagged here; not in scope for Sprint 3.1. Shippable as a focused follow-up.

**Testing plan:**
- [x] Integration — hot row + cold row seeded; run `refresh_zero_storage_index_hot_rows()` directly; assert the hot row's `expires_at` extends by 24h while the cold row's is untouched. Second case: non-zero_storage org with a hot row → no extension (refresh is zero_storage-only). See `tests/integration/zero-storage-hot-row-refresh.test.ts`.
- [ ] 100K-event invariant load test — Sprint 3.2.
- [ ] Live: flip a test org, run a verify batch of 1000, wait for the next cron tick, confirm `last_verified_at` is populated and `expires_at` extends. Pending operator `bunx supabase db push` (migration 53 queued with the earlier 50 / 51 / 52).

**Status:** `[x] complete (code + integration test; live verification pending operator migration push).`

#### Sprint 3.2: Load test + gap inventory

**Estimated effort:** 4 days

**Deliverables:**
- [ ] Staging load test: 100K consent events in zero-storage mode, measured invariant + end-to-end latency
- [ ] Gap inventory document `docs/design/zero-storage-feature-matrix.md`: what works in Standard but degrades / requires special handling in Zero-Storage (re-export from buffer not possible; consent re-display requires customer-storage fetch; audit reconstruction from customer's bucket)
- [ ] Launch-partner onboarding plan (internal test tenant acceptable if no external partner ready)

**Testing plan:**
- [ ] Load test report in `docs/benchmarks/zero-storage-100k.md`
- [ ] Launch partner (or internal tenant) runs for 4 weeks with daily invariant-check cron; any non-zero count triggers investigation

**Status:** `[ ] planned`

### Phase 4: Healthcare sector template (G-042)

#### Sprint 4.1: Healthcare template seed

**Estimated effort:** 2 days

**Deliverables:**
- [x] Migration `20260804000056_adr1003_s41_healthcare_template_seed.sql` adding a `healthcare` row to `admin.sectoral_templates` with:
  - Purposes: `teleconsultation`, `prescription_dispensing`, `lab_report_access`, `insurance_claim_share_abdm`, `appointment_reminders`, `marketing`, `research_broad_consent`
  - Data scopes per purpose (labels only — no content values per Security Rule 3)
  - Retention rules: DISHA 7 years for clinical records (2555-day default on `teleconsultation`/`lab_report_access`); ICMR 5 years on `research_broad_consent`; 1-2 year defaults on consent-only purposes
  - `default_storage_mode='zero_storage'` (new column on `admin.sectoral_templates`) gate enforced at apply time
  - `connector_defaults` (new jsonb column) carries `appointment_reminder_vendor` (messaging) + `emr_vendor` (EMR) placeholders for the admin templates panel
- [x] `public.apply_sectoral_template` re-published with the storage_mode gate (raises SQLSTATE `P0004` when the org's storage_mode does not match the template's `default_storage_mode`). BFSI Starter (default_storage_mode NULL) unaffected.
- [x] Admin templates panel (ADR-0030) detail page surfaces `default_storage_mode` pill and `connector_defaults` section. List page already auto-includes published Healthcare row. BFSI + Healthcare both show as Published.
- [x] `docs/customer-docs/healthcare-onboarding.md` — single-doctor clinic flow + multi-doctor practice/hospital flow + zero-storage operational realities.

**Testing plan:**
- [x] Integration test `tests/integration/healthcare-template.test.ts`:
  - Asserts seeded row shape (7 purposes by code, `default_storage_mode='zero_storage'`, `connector_defaults` for both vendor slots).
  - Apply to a zero_storage test org → succeeds; `materialised_count=7`; `purpose_definitions` rows materialised under that org_id.
  - Apply to a standard test org → `error.code='P0004'`; message names both `storage_mode=zero_storage` (required) and `standard` (actual); zero `purpose_definitions` rows written.

**Status:** `[x] complete`

### Architecture Changes (Sprint 4.1)

- `admin.sectoral_templates` gains two columns:
  - `default_storage_mode text` — nullable; `check (default_storage_mode in ('standard','insulated','zero_storage'))`. When non-null, `apply_sectoral_template` enforces a strict equality match against the org's current `organisations.storage_mode` and refuses with errcode P0004 otherwise.
  - `connector_defaults jsonb` — nullable; informational vendor-category metadata for the admin templates panel. Not referenced by `purpose_connector_mappings`.
- `public.apply_sectoral_template(p_template_code text)` signature unchanged. Body adds the storage_mode pre-flight check; return payload gains `storage_mode` (nullable string).
- Customer-side template apply cannot flip storage_mode. The single write surface for `organisations.storage_mode` remains `admin.set_organisation_storage_mode` (ADR-1003 Sprint 1.1). Healthcare onboarding is therefore a two-step admin/customer dance: admin flips mode → customer applies template.

### Phase 5: Sandbox org provisioning (G-046)

#### Sprint 5.1: Sandbox self-serve flow

**Estimated effort:** 3 days

**Deliverables:**
- [ ] Migration adding `accounts.sandbox boolean default false`
- [ ] `/dashboard/sandbox` page with "Provision sandbox org" button
- [ ] Server action creates `organisations` row with `id='org_test_<nanoid>'`, applies selected sector template, skips plan-gating checks, does not create billing rows
- [ ] Rate-tier override: all `/api/v1/*` calls from a sandbox org use a 1000/hr sandbox tier regardless of account plan
- [ ] Test data principal generator: `POST /api/v1/_sandbox/test-principals` returns `{ identifier: "cs_test_principal_<seq>" }` for integration-test scaffolding (sandbox orgs only)
- [ ] Dashboard banner "Sandbox mode — not for production data" visible on every sandbox surface
- [ ] `docs/customer-docs/sandbox.md`

**Testing plan:**
- [ ] Provision sandbox → org created in < 5 s → API key mintable → `/v1/_ping` succeeds
- [ ] Sandbox org exports marked `{ sandbox: true }` in manifest
- [ ] Compliance score endpoint excludes sandbox orgs from any cross-customer metric

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`:
  - Add a "Processing modes — data-plane enforcement" section documenting Worker / Edge Function / delivery_buffer branches *(outstanding — scheduled alongside Sprint 3.2 or the Phase 1 operator close-out)*
  - Document the `consent_artefact_index` TTL behaviour under Zero-Storage *(outstanding — deferred alongside the above)*
  - Add sandbox orgs as a first-class concept *(Sprint 5.1)*
- `docs/architecture/consentshield-complete-schema-design.md`:
  - Document `accounts.sandbox` *(Sprint 5.1)*
  - Document Healthcare template rows — **scope-amended 2026-04-25.** Admin-schema DDL belongs in `docs/admin/architecture/consentshield-admin-schema.md`; the customer-side schema-design doc carries only public-schema tables. The `admin.sectoral_templates` DDL (including the new `default_storage_mode` + `connector_defaults` columns) is documented in `docs/admin/architecture/consentshield-admin-schema.md §3.4`.
  - Document any TTL column additions on `consent_artefact_index` *(Sprint 3.1 — already shipped; schema-design doc update outstanding)*

### Completed updates — Sprint 4.1 (2026-04-25)

- `docs/admin/architecture/consentshield-admin-schema.md §3.4` — DDL snapshot for `admin.sectoral_templates` now carries the two new columns (`default_storage_mode text check(...)`, `connector_defaults jsonb`) with inline comments explaining the Sprint 4.1 gate behaviour and the "informational metadata" scope of `connector_defaults`.
- `docs/V2-BACKLOG.md` — two deferred follow-ups logged under "Open — blocked on downstream ADR": template-editor form inputs for the new columns (Sprint 4.2 candidate) + P0004-specific customer-side UX card (Sprint 4.2 candidate).
- `docs/ADRs/ADR-index.md` — ADR-1003 status flipped from `Proposed` to `In Progress`; inline sprint-shipped summary matches the convention from ADR-1004/1005.

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Self-serve Standard → Insulated migration (stays manual in v1).
- Self-serve Insulated → Zero-Storage migration (stays manual).
- Sandbox → Production promotion flow (customer re-provisions today).
- Multi-region storage replication (customer picks one region; multi-region deferred).

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 4.1 (healthcare template), Sprint 5.1 (`accounts.sandbox`), Sprint 3.1 (TTL columns)
- `CHANGELOG-worker.md` — Sprint 1.2 (Worker branch paths)
- `CHANGELOG-edge-functions.md` — Sprint 1.3 (Edge Function branch paths)
- `CHANGELOG-dashboard.md` — Sprint 2.1 (BYOS UX), Sprint 5.1 (sandbox UI)
- `CHANGELOG-docs.md` — Sprints 2.2, 3.2, 4.1, 5.1 (customer docs + runbooks)
