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

#### Sprint 1.3: Edge Function branch paths + invariant test

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `process-consent-event`: zero-storage orgs write `consent_artefact_index` (TTL-bounded) but NOT `consent_artefacts` persistent rows
- [ ] `delivery_buffer`: zero-storage path transient in-memory only; immediate R2 upload; no durable row
- [ ] Comprehensive invariant test: create zero-storage org, post 1000 events, assert zero rows across `consent_events`, `consent_artefacts`, `delivery_buffer`, `artefact_revocations`, `audit_log` for that org_id
- [ ] Same invariant test for a Standard org — must find rows (counter-assertion confirms the test is meaningful)

**Testing plan:**
- [ ] `tests/integration/zero-storage-invariant.test.ts` passes
- [ ] Counter-test on Standard org passes
- [ ] CI includes the invariant; fails the build on any future PR that accidentally writes to a zero-storage org's persistent tables

**Status:** `[ ] planned`

### Phase 2: BYOS credential validation (G-006)

#### Sprint 2.1: Credential-validation UX

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `/dashboard/settings/storage` page: paste creds (access key id, secret, region, bucket, endpoint URL for S3-compatible)
- [ ] `app/src/lib/storage/validate.ts`:
  - PutObject a `cs-probe-<nanoid>.txt` test object
  - HeadObject the same object
  - Attempt `GetObject` on the test object → must fail with 403 (proves scope-down)
  - Attempt `ListObjectsV2` → must fail with 403
  - Attempt `DeleteObject` on the test object → must fail (PutObject was enough to prove write; we explicitly do NOT want delete permission)
- [ ] Surface each probe result in the UI with remediation copy ("your credential has DeleteObject permission; please scope it down")
- [ ] Encrypted storage with per-org key derivation (existing pattern)

**Testing plan:**
- [ ] Over-scoped credential (AdministratorAccess) → rejected with clear UI
- [ ] Correctly-scoped PutObject-only credential → accepted
- [ ] Manual test on AWS S3, Cloudflare R2, DigitalOcean Spaces

**Status:** `[ ] planned`

#### Sprint 2.2: Documentation + migration procedure

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `docs/customer-docs/byos-aws-s3.md` — IAM policy JSON, step-by-step bucket creation, credential rotation guidance
- [ ] `docs/customer-docs/byos-cloudflare-r2.md` — R2 token recipe, API compatibility notes
- [ ] `docs/runbooks/standard-to-insulated-migration.md` — sequence for moving an existing Standard-mode customer to Insulated

**Testing plan:**
- [ ] Self-test: follow the AWS doc from scratch, end-to-end, on a fresh AWS account
- [ ] Self-test: follow the R2 doc from scratch on a fresh Cloudflare account

**Status:** `[ ] planned`

### Phase 3: Zero-Storage end-to-end validation (G-005)

#### Sprint 3.1: TTL-bounded index behaviour

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `consent_artefact_index` for zero-storage orgs gets a TTL (default 24h) via an index column or a dedicated shadow table
- [ ] Refresh path: on read, if entry stale, fetch from customer storage (the canonical artefact record) and repopulate
- [ ] Background `refresh-zero-storage-index` pg_cron job (hourly): walks recent activity and pre-warms the index
- [ ] Incident runbook `docs/runbooks/zero-storage-restart.md`: what happens when ConsentShield restarts during delivery

**Testing plan:**
- [ ] Expire an index entry manually; next verify call repopulates it from customer storage
- [ ] Zero-storage org sustains 100K events without any persistent-table writes

**Status:** `[ ] planned`

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
- [ ] Migration `<date>_healthcare_template_seed.sql` adding a `healthcare` row to `admin.sectoral_templates` with:
  - Purposes: `teleconsultation`, `prescription_dispensing`, `lab_report_access`, `insurance_claim_share_abdm`, `appointment_reminders`, `marketing`, `research_broad_consent`
  - Data scopes per purpose (labels only — no content values per Security Rule 3)
  - Retention rules: DISHA 7 years for clinical records; Clinical Establishments Act per-state placeholder
  - `storage_mode='zero_storage'` default for orgs applying this template
  - Connector-mapping defaults (appointment reminder vendor placeholder; EMR vendor placeholder)
- [ ] Admin templates panel (ADR-0030) now shows BFSI + Healthcare as Published
- [ ] `docs/customer-docs/healthcare-onboarding.md` — single-doctor clinic flow, multi-doctor practice flow

**Testing plan:**
- [ ] Apply Healthcare template to a fresh sandbox org → 7 purposes seeded, retention rules populated, storage_mode set
- [ ] Attempting to apply Healthcare template to an Standard-mode org raises a warning requiring explicit operator override (Security Rule 3 is non-negotiable for FHIR)

**Status:** `[ ] planned`

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
  - Add a "Processing modes — data-plane enforcement" section documenting Worker / Edge Function / delivery_buffer branches
  - Document the `consent_artefact_index` TTL behaviour under Zero-Storage
  - Add sandbox orgs as a first-class concept
- `docs/architecture/consentshield-complete-schema-design.md`:
  - Document `accounts.sandbox`
  - Document Healthcare template rows
  - Document any TTL column additions on `consent_artefact_index`

_None yet._

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
