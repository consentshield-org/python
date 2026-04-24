# ADR-1025: Customer storage auto-provisioning — hybrid managed R2 default + BYOK escape hatch

**Numbering note:** originally drafted as ADR-1022. Renumbered to 1025 on 2026-04-23 so ADR-1020's reserved slots for multilingual Phase 2 / 3 / 4 (ADR-1022 / 1023 / 1024) stay coherent.

**Status:** Proposed
**Date proposed:** 2026-04-23
**Date completed:** —
**Superseded by:** —
**Upstream dependency of:** ADR-1019 (deliver-consent-events) — delivery function cannot run until `export_configurations` rows are populated for every paying org. This ADR is how they get populated.

---

## Context

### The gap

`public.export_configurations` has existed since migration 20260413000003 with `{org_id, storage_provider, bucket_name, path_prefix, region, write_credential_enc, is_verified, last_export_at}`. The schema is ready; **nothing writes to it.** The customer app has no UI that accepts bucket credentials. The admin panel has no provisioning RPC. ADR-1019 can deliver rows to R2 but only if the configuration row is already populated and verified — today, for every org, it isn't.

Two options were on the table when Sprint 3.2 surfaced this:

1. **Customer BYOK (bring-your-own-key)** — add an onboarding wizard step asking the customer to create a Cloudflare R2 or S3 bucket, generate a scoped token, paste both in. Pros: true customer ownership, matches the CLAUDE.md Rule 4 literal reading. Cons: enormous friction — most self-serve customers don't have a CF / AWS account at sign-up, will misconfigure scopes, will block for days on procurement-side setup. Completion-rate-killing.
2. **ConsentShield-managed R2** — CS operates a single Cloudflare account; at onboarding, backend programmatically provisions a per-org bucket + a scoped token, encrypts both into `export_configurations`, runs a verification probe, flips `is_verified=true`. Pros: zero friction. Cons: CS technically holds the data; "customer-owned" becomes a DPA construct rather than a physical ownership fact. For BFSI / healthcare enterprise customers specifically, procurement will ask for data residency + direct bucket ownership.

### The decision that makes both stories work

Default to managed. Let customers upgrade when they need to. Ship the managed path first; ship BYOK as a Settings flow that migrates objects across on cutover.

The **onboarding completion rate** is the load-bearing growth metric; 100% of customers must reach "delivery is live" with zero user action on storage. Enterprise customers whose procurement demands BYOK can exercise the settings flow during the paid-tier evaluation without blocking first-month trial activity.

### What CLAUDE.md Rule 4 says, re-read carefully

> "The customer owns the compliance record. Dashboard views can read from buffer tables for real-time display. Compliance exports, audit packages, and anything DPB-facing must read from or direct users to customer-owned storage (R2/S3). Never build an export that reads from ConsentShield's database as the canonical source."

Rule 4 is about the **locus of the canonical record**, not about physical Cloudflare account ownership. The DPB-facing export must pull from R2, not from CS's buffer tables. Both managed-R2 and customer-R2 satisfy this: in both cases, delivery-then-delete (Rule 2) means the buffer is transient and R2 is canonical. The only delta is which Cloudflare account pays the monthly bill. A managed-R2 customer retains export rights + move-out rights + audit rights under the DPA — physical ownership is a commercial choice layered on top.

## Decision

Implement a two-tier storage model:

### Tier 1 — CS-managed R2 (the default, auto-provisioned at onboarding)

- ConsentShield operates a single Cloudflare account configured with an account-level API token (`CLOUDFLARE_ACCOUNT_API_TOKEN`) carrying `R2 Storage:Edit` scope. The token lives in the customer-app's Vercel project secrets + the Edge Function secret store (`supabase secrets set CLOUDFLARE_ACCOUNT_API_TOKEN=...`).
- At onboarding, after Step 4 (template) of the ADR-0058 wizard, a background job `provision_managed_storage(org_id)` fires. The job:
  1. Derives a globally-unique bucket name: `cs-cust-<first 20 chars of base32(sha256(org_id || STORAGE_NAME_SALT))>`. Using a hash-prefix avoids leaking org UUIDs via bucket listings; using a salt avoids rainbow-table reversal from bucket → org.
  2. Creates the bucket via Cloudflare's `POST /accounts/{account_id}/r2/buckets` API with `locationHint` set based on the customer's primary region (APAC for Indian tenants per DPDP §10 data-residency rule; configurable per plan for enterprise).
  3. Creates a bucket-scoped R2 API token via `POST /accounts/{account_id}/api_tokens` with permissions `["com.cloudflare.api.account.r2.bucket.read", "com.cloudflare.api.account.r2.bucket.write"]` AND a `resources` clause restricting to `com.cloudflare.api.account.r2.bucket.<bucket_id>`. The token is returned once; CS stores the encrypted form.
  4. Encrypts both the token (S3 access_key_id + secret_access_key pair for the S3-compat path) and the bucket metadata using the per-org key derivation pattern from CLAUDE.md Rule 11 (`org_key = HMAC-SHA256(MASTER_ENCRYPTION_KEY, org_id || encryption_salt)`).
  5. INSERTs the `export_configurations` row with `storage_provider='cs_managed_r2'`, `is_verified=false`.
  6. Runs the verification probe synchronously (below). On success → flips `is_verified=true`.
- The job is idempotent per `org_id` — re-running the provisioner on an already-provisioned org is a noop (on `SELECT ... FROM export_configurations WHERE org_id = ? LIMIT 1` returning a row, skip to the verification step).
- The wizard does NOT block on this job. By the time the user clicks through Steps 5–7, provisioning has completed in the background. If it hasn't, Step 7's "First consent captured" screen surfaces a soft banner ("Storage is still initialising — your events will be delivered as soon as it's ready"); the Worker's buffer retains events until `is_verified` flips.

### Tier 2 — BYOK via Settings → Storage

- `/dashboard/settings/storage` (wizard-exempt; account_owner-gated) shows current provider + "Switch to your own bucket" button.
- Form accepts: provider (r2 / s3), optional region (s3 only), bucket name, access_key_id, secret_access_key. Turnstile-gated; rate-limited (5/hour per account).
- Backend runs the verification probe against the provided credentials. Success → prompts the user for migration mode:
  - **Copy existing + cutover** (default): kicks off `migrate_storage(org_id, to_config)` background job that `COPY`s every object from the current CS-managed bucket to the new customer bucket (R2 has S3-compat `CopyObject` semantics; cross-provider via streaming PUT/GET). On completion: atomic UPDATE on `export_configurations` to the new credentials + REVOKE the CS-managed token via Cloudflare API + MARK the CS-managed bucket for 30-day retention hold (ops-readiness flag surfaces for final deletion after the hold).
  - **Cutover-forward-only**: UPDATE `export_configurations` immediately; leave historical objects in the CS-managed bucket, accessible via the dashboard's audit-export download path for the legal-retention window.
- Migration audit: every transition writes to `audit_log` with `event_type='storage_provider_changed'`, before/after provider + bucket masked (bucket name ok, credentials never logged).

### Verification probe — one implementation, called from both tiers

For any `export_configurations` row pending verification:

1. Generate a random sentinel key: `cs-verify-<ulid>.txt`.
2. Compute content: a canonical JSON blob `{probe_id, org_id, timestamp, cs_version}` — no PII, no customer data.
3. PUT via S3-compat API. Capture response ETag.
4. GET the object back. Compare content-hash (sha256 of body) to a client-side recompute. ETag match is not sufficient — R2 can return a multipart ETag that differs from the body sha256; we re-hash.
5. DELETE the sentinel.
6. On all-success: `UPDATE export_configurations SET is_verified=true, last_export_at=null WHERE id = ?`.
7. On any step failure: capture the failure in `export_verification_failures` (new narrow table: `id, org_id, config_id, step, error_text, attempted_at`) + emit an `admin.ops_readiness_flags` row so the operator sees the stall. DO NOT flip `is_verified`.

Run on every provisioning, every credential rotation, and nightly-verify cron (re-check every org's configured storage is still reachable — catches silently-revoked BYOK tokens before they break delivery).

## Consequences

### Enables

- ADR-1019 `deliver-consent-events` can ship against a populated + verified `export_configurations` for every paying org. No operator-in-the-loop for Tier-1 customers (100% of self-serve signups).
- Enterprise BYOK procurement conversations become "Settings → Storage → Paste credentials → we migrate your historical exports" instead of "we'll quote you a 2-week integration".
- DPA can state: "ConsentShield provides and maintains tenant-isolated storage infrastructure until customer elects to self-host via Settings → Storage."

### New operational constraints

- **Cost centre:** CS pays for R2 storage on behalf of all Tier-1 customers. Budget: CF R2 is $0.015/GB-month with zero egress. Buffer-delete-on-deliver (Rule 2) + customer retention window (default 30 days for consent_events, longer for audit_log / rights_request_events) puts the per-customer monthly cost in cents for SMB volumes, dollars for BFSI scale. Absorb into the plan base price for Starter/Growth; meter for Pro/Enterprise.
- **Blast radius on CF API outage:** onboarding stalls for new signups until CF recovers. Existing orgs unaffected (their provisioning already completed). Mitigation: retry loop with exponential backoff; ops-readiness flag fires after 10 min of consecutive failures so the operator sees the incident + can temporarily flip new-customer provisioning to a queued state rather than a blocking one.
- **Account API token rotation:** `CLOUDFLARE_ACCOUNT_API_TOKEN` rotation needs to happen without breaking existing per-bucket tokens. Per-bucket tokens are independent; rotating the account-level token only affects NEW provisioning + NEW per-bucket token issuance. Straightforward.
- **Bucket-name collision:** the sha256-prefix space is effectively collision-free for the org count we'll ever have. No lookup needed.
- **CF account limits:** CF R2 has a soft per-account limit of ~1000 buckets. Design accommodates this with a budget alert at 80% capacity; path to multi-CF-account sharding exists if ever needed (partition orgs by a hash of org_id).

### New compliance story

- **Rule 4 framing:** the canonical compliance record lives in R2. Whether that R2 bucket sits in CS's CF account or the customer's CF account is a commercial / procurement-level choice, not a Rule-4-dictated fact. DPA + per-tenant isolation + scoped tokens + export rights make Tier-1 compliant.
- **DPDP §10 data residency:** bucket `locationHint` defaults to APAC for Indian tenants; configurable per plan for enterprise customers with cross-border data flows.
- **GDPR alignment (future):** the same provider + locationHint knob extends to EU regions when ConsentShield expands. No schema change needed — `export_configurations.region` is already a free-text column.

### New failure modes

- **Silently-revoked BYOK token** (customer rotates/deletes the R2 token without telling CS): nightly verify cron catches this within 24h; delivery attempts fail gracefully per ADR-1019 Sprint 2.3's retry + readiness-flag escalation. Customer-visible banner on dashboard surfaces the need to re-provision.
- **CS-managed bucket accidentally deleted** (operator error): R2 has a 30-day Delete Protection setting that we MUST enable on every provisioned bucket. Recovery is a restore + credential re-probe.
- **Credential leak in logs / Sentry:** fenced by the same beforeSend strip ADR-1019 requires. Credentials only appear in the `write_credential_enc` column and in-memory during provisioning.

### Onboarding wizard impact (ADR-0058 amendment)

- **No new wizard step.** Tier-1 provisioning is a background job fired off after Step 4's `save_data_inventory` RPC returns. User sees no mention of storage.
- **Step 7 soft banner:** if `export_configurations.is_verified=false` at Step 7 poll time, surface "Storage initialising — all your future events will deliver as soon as it's ready. This usually takes under 30 seconds."
- **Dashboard widget:** `/dashboard` shows a "Storage" panel with provider badge (CS Managed / Your R2 / Your S3) + last successful delivery timestamp + "Settings →" link.

---

## Implementation Plan

### Phase 1 — Foundation: CF account token + per-org provisioning primitives

#### Sprint 1.1 — CF account API token + secret wiring

**Estimated effort:** 0.25 day

**Deliverables:**
- [x] Operator step: created `CLOUDFLARE_ACCOUNT_API_TOKEN` (prefix `cfat_`) via Cloudflare dashboard with `Account:R2 Storage:Edit` scope. Token stored in:
  - `.env.local` (root + `app/`) for dev.
  - `.secrets` reference file.
  - Vercel project env + Supabase function secret — to be propagated when Phase 2 Sprint 2.1 Edge Function lands.
- [x] `STORAGE_NAME_SALT` — 32-byte base64 random generated + stored in `.secrets`, `.env.local`, `app/.env.local`.
- [x] Code rename: `cf-provision.ts` + unit tests now read `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ACCOUNT_API_TOKEN` (was `CF_ACCOUNT_ID` / `CF_ACCOUNT_API_TOKEN`) — aligns with project convention and the existing `CLOUDFLARE_*` secrets layout. Note: the legacy `CLOUDFLARE_API_TOKEN` (user-level `cfut_` prefix) remains in place for KV cache invalidation + `wrangler deploy`; the new `CLOUDFLARE_ACCOUNT_API_TOKEN` (account-level `cfat_`) is R2-only. Two tokens, two scopes.
- [ ] Documentation: `docs/runbooks/cf-account-token-rotation.md` — step-by-step rotation procedure that preserves existing per-bucket tokens. **Deferred to close with Phase 2 Sprint 2.1.**

**Testing plan:**
- [x] `curl -H "Authorization: Bearer $CLOUDFLARE_ACCOUNT_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/<account_id>/r2/buckets` returns 200 + the existing bucket list (verified 2026-04-23).
- [x] 26 mocked unit tests remain green with new env var names (`tests/storage/cf-provision.test.ts` + `tests/storage/verify.test.ts`).

**Status:** `[x] complete 2026-04-23 — operator step done, salt provisioned, code aligned to CLOUDFLARE_* convention, 26/26 unit tests green. Runbook deferred to Phase 2 Sprint 2.1 close-out.`

#### Sprint 1.2 — Provisioning primitives library

**Estimated effort:** 1 day

**Deliverables:**
- [x] `app/src/lib/storage/cf-provision.ts` — TypeScript module exporting:
  - `deriveBucketName(orgId: string): string` — sha256(orgId + salt) → `cs-cust-<20 hex>`. Deterministic + idempotent. Salt prevents rainbow-table reversal.
  - `createBucket(name, locationHint='apac', opts?)` → `Promise<Bucket>`. Idempotent: 409 → falls back to GET on the existing bucket. Uses account-level auth against `POST /accounts/{id}/r2/buckets`.
  - `createBucketScopedToken(bucketName, opts?)` → `Promise<BucketScopedToken>`. Returns `{token_id, access_key_id, secret_access_key}`. Hits `POST /user/tokens` (user-level — see two-token note below) with a single-policy payload: `effect=allow`, `resources={com.cloudflare.edge.r2.bucket.<account>_default_<bucket>: "*"}`, `permission_groups=[{id: "2efd5506f9c8494dacb1fa10a3e7d5b6"}]` (Workers R2 Storage Bucket Item Write, covers object read/write/delete on the single bucket). Derives S3 credentials per CF spec: `access_key_id = response.result.id`, `secret_access_key = sha256hex(response.result.value)`. The raw `value` is discarded after hashing.
  - `revokeBucketToken(tokenId, opts?)` → `Promise<void>`. Idempotent: 404 swallowed as success. Hits `DELETE /user/tokens/{id}` with user-level auth.
  - `r2Endpoint()` — account-scoped S3-compat endpoint URL.
  - `CfProvisionError` class with discriminator `code: 'auth' | 'conflict' | 'rate_limit' | 'server' | 'network' | 'config' | 'not_found'`.
- [x] `cfFetch` internal retry shim: 3 attempts, 250ms × 2^(n-1) exponential backoff, 30s overall budget. Retries 429 + 5xx + network errors; 401/403/404/409 fail fast. Bearer token on Authorization header; request body stays in-memory only. Accepts `auth: 'account' | 'user'` in opts to select the appropriate credential per-call (account-level for R2 bucket CRUD; user-level for token create/revoke — CF enforces this separation at the protocol level).
- [x] `app/tests/storage/cf-provision.test.ts` — Vitest, 20 tests covering every documented branch against the corrected API contract: derive deterministic + collision-resistant + salt-sensitive + config-missing; createBucket 201 (+ asserts account-token in Authorization header) / 409-idempotent / 429-retry / 5xx-retry / 5xx-exhaust / 401-no-retry / network-retry; createBucketScopedToken 200 (asserts `secret_access_key = sha256hex(value)`, `/user/tokens` endpoint, user-token in header, policy body shape) / missing-value-in-200 / 401-auth; revokeBucketToken 200 (asserts `/user/tokens/{id}` + user-token in header) / 404-idempotent / 401-surface; r2Endpoint happy + config-missing; config errors for each env var (account token, user token). Under 200 ms wall time.

**Two-token architecture (note):** CF requires user-level auth (`cfut_` prefix) for `POST /user/tokens` and rejects account-level tokens with `9109 Valid user-level authentication not found` regardless of scopes. Bucket CRUD (`/accounts/{id}/r2/buckets`) only accepts account-level auth. The module therefore reads both `CLOUDFLARE_ACCOUNT_API_TOKEN` (cfat_, R2:Edit) and `CLOUDFLARE_API_TOKEN` (cfut_, User API Tokens:Edit + Workers R2) and picks per-call. The two-token model is a platform constraint, not a design choice — documented in `docs/runbooks/cf-account-token-rotation.md` once Phase 2 Sprint 2.1 ships.

**Testing plan:**
- [x] Against the dev CF account, provision one throwaway bucket end-to-end. Verified 2026-04-23 via `scripts/verify-adr-1025-sprint-11.ts`: bucket create (APAC) → token mint → probe PUT/GET/hash/DELETE (1358 ms) → revoke → 6-second propagation window before revocation reaches R2 edge → bucket empty (via list-objects + bulk delete through a cleanup token) → bucket delete. All 7 script steps passed. Total wall time 24.67 s.

**Status:** `[x] complete 2026-04-23 — 20-test mocked matrix + live E2E via scripts/verify-adr-1025-sprint-11.ts both green. Sprint 1.2 was originally shipped in commit 9c4f06c against a hypothetical /r2/tokens endpoint; amended 2026-04-23 after the live verification surfaced that R2 bucket-scoped tokens are minted via /user/tokens (user-level auth) with the general account-API-tokens policy shape — see "Two-token architecture" note above.`

#### Sprint 1.3 — Verification probe + failure capture

**Estimated effort:** 0.5 day

**Deliverables:**
- [x] `app/src/lib/storage/verify.ts` — `runVerificationProbe(config, deps?)` implementing the 4-step probe (PUT → GET → content-hash → DELETE). DELETE failure returns `ok=true` with `failedStep='delete'` + `error` populated (sentinel gets aged by the bucket's lifecycle policy; the probe doesn't need a clean DELETE to assert reachability). Every step dependency (`putObject`, `presignGet`, `deleteObject`, `fetch`, `Date.now`, `crypto.randomBytes`) is injectable for deterministic unit tests.
- [x] `app/src/lib/storage/sigv4.ts` — added `deleteObject(SigV4Options)` that mirrors `putObject`'s sigv4 pattern (DELETE method, empty-payload hash, no content-type / content-length). 404 treated as success (idempotent delete).
- [x] `supabase/migrations/20260804000035_export_verification_failures.sql` — new append-only narrow table `public.export_verification_failures (id, org_id, export_config_id, probe_id, failed_step, error_text, duration_ms, attempted_at)`. RLS enabled; zero policies. `grant insert on ... to cs_orchestrator`. Admins read via a future RPC (added when the panel wants the data).
- [x] `app/tests/storage/verify.test.ts` — Vitest, 8 tests covering: happy path (PUT + GET + hash + DELETE all succeed; probe id format; key format; body composition includes probe_id / storage_provider / timestamp / cs_version and nothing else), DELETE failure (ok=true + failedStep='delete'), PUT throws (ok=false + no downstream calls), GET 404 (ok=false + no DELETE), GET network error, content-hash mismatch (silent-rewrite detection). 119 ms wall time.
- [ ] `runVerificationProbe` emits an `admin.ops_readiness_flags` row on failure — **deferred to Phase 2 Sprint 2.1** where the Edge Function that calls the probe wires the flag emission. Keeping the probe pure (no DB side-effects) is the cleaner boundary.

**Testing plan:**
- [x] Happy path + every failure branch covered via mocked S3 deps. 20 + 8 = 28 unit tests across Sprints 1.2 + 1.3 all pass (amended count after Sprint 1.2 API-shape correction).
- [x] Runtime-green against a real CF bucket — verified 2026-04-23 by `scripts/verify-adr-1025-sprint-11.ts` Step 4 (1358 ms probe, four-step round-trip against a real R2 bucket).

**Status:** `[x] complete 2026-04-23 — 8 mocked unit tests + live E2E probe against a real bucket both green. Readiness-flag emission still deferred to Phase 2 Sprint 2.1 (cleaner boundary — probe stays side-effect-free; Edge Function wraps it).`

### Phase 2 — Managed auto-provision at onboarding

#### Sprint 2.1 — Background provisioning orchestrator + wizard Step-4 trigger

**Estimated effort:** 1 day

**Design amendment (2026-04-23):** moved the orchestrator from a Supabase Edge Function (Deno) to a Next.js API route (Node). Reason: cf-provision.ts / verify.ts / sigv4.ts are Node-native and sharing them with Deno requires either dual-maintenance or a shared package (ADR-0026 hasn't shipped `@consentshield/storage` yet). Precedent: ADR-1017's probe orchestrator moved to Next.js for the same reason. Provisioning runs once per org at signup — cold-start weight (~300 ms on Fluid Compute) is negligible vs the maintenance savings. The auth-to-Postgres path is unchanged (`cs_orchestrator` via `csOrchestrator()` direct-Postgres — Rule 5).

**Deliverables:**
- [x] `app/src/app/api/internal/provision-storage/route.ts` — Next.js POST route (Node runtime, `force-dynamic`). Shared-bearer HMAC via `STORAGE_PROVISION_SECRET` (pattern mirrors `/api/internal/invitation-dispatch`). Input: `{org_id}`. Delegates to `provisionStorageForOrg` and returns the result envelope `{status, config_id, bucket_name, probe?}`. Distinguishes CfProvisionError (auth/config → 500, transient → 502) from success codes.
- [x] `app/src/lib/storage/provision-org.ts` — pure orchestration helper. `provisionStorageForOrg(pg, orgId, deps?)` returns `{status: 'provisioned' | 'already_provisioned' | 'verification_failed', configId, bucketName, probe?}`. Inline HMAC-SHA256 key derivation (matches `@consentshield/encryption`'s `deriveOrgKey`) + direct-Postgres call to `encrypt_secret`, so it works with the cs_orchestrator `postgres.js` client. 7-step flow: short-circuit-if-verified → createBucket → createBucketScopedToken → 5s propagation → runVerificationProbe → encrypt + UPSERT export_configurations → flip is_verified. On probe failure: record to `public.export_verification_failures` + revoke the token (best-effort) + return without writing credentials.
- [x] **Wizard trigger** — `supabase/migrations/20260804000036_provision_storage_dispatch.sql`. AFTER INSERT trigger on `public.data_inventory` that fires `public.dispatch_provision_storage(new.org_id)` ONLY when (a) no `export_configurations` row exists for the org yet AND (b) this is the first `data_inventory` row per org. EXCEPTION WHEN OTHERS swallow is load-bearing — trigger failure must not roll back the wizard's INSERT.
- [x] **Admin re-provision RPC** `admin.provision_customer_storage(p_org_id uuid, p_reason text)` — in the same migration. Guards with `admin.require_admin('support')`, requires a ≥ 10-char reason, writes an `admin.admin_audit_log` row with action `adr1025_reprovision_storage`, then calls the same dispatch function. Returns `{enqueued: true, org_id, net_request_id}`.
- [x] **pg_cron safety-net** `provision-storage-retry` — scheduled every 5 min. Sweeps orgs with `data_inventory` rows but no `export_configurations` row, 5+ minutes old, < 24h old. Caps at 50 orgs per run.
- [x] `supabase/migrations/20260804000037_cs_orchestrator_grants_export_configurations.sql` — grants cs_orchestrator SELECT / INSERT / UPDATE on `public.export_configurations` + SELECT on `public.organisations`. Uncovered during the live E2E — Rule 5's scoped-role model required these explicit grants (bypassrls alone is insufficient for SQL-level privilege checks).
- [x] `STORAGE_PROVISION_SECRET` generated + persisted to `.secrets`, `.env.local`, `app/.env.local`.
- [ ] **Operator step (deferred; gates trigger + cron dispatch):** seed Vault secrets so `net.http_post` can dispatch. Run in Supabase Studio SQL Editor:
  ```sql
  select vault.create_secret('<STORAGE_PROVISION_SECRET>', 'cs_provision_storage_secret');
  select vault.create_secret(
    'https://<app-url>/api/internal/provision-storage',
    'cs_provision_storage_url'
  );
  ```
  Until seeded, `dispatch_provision_storage` soft-returns NULL on missing vault — the trigger no-ops silently. When the operator seeds and the app URL is reachable, the trigger + cron immediately start firing; the 5-min safety-net catches any orgs that entered the data_inventory window during the gap.

**Testing plan:**
- [x] `app/tests/storage/provision-org.test.ts` — Vitest, 9 tests, 222 ms. Happy path (fresh org → provisioned + correct DB round-trips + probe arg shape + no revoke on success); idempotency (is_verified=true → short-circuits with zero CF calls); is_verified=false → full re-provision; probe failure → records to export_verification_failures + revokes token + no upsert; revoke-throws is swallowed; config errors (MASTER_ENCRYPTION_KEY missing, org missing encryption_salt); CF errors propagate (auth, server, 409-handled-by-library).
- [x] Live E2E via `scripts/verify-adr-1025-sprint-21.ts` — seeds fixture account + org → calls `provisionStorageForOrg` twice → asserts status transitions from `provisioned` → `already_provisioned`, DB row has correct storage_provider / bucket_name / is_verified=true / non-empty write_credential_enc. All 4 steps pass in 13.38 s against real CF + real Supabase dev DB.
- [ ] **Wizard-trigger flow (blocked on operator vault seed):** INSERT data_inventory row → trigger fires `net.http_post` → export_configurations row materialises within ~30 s. Documented in the ADR-1025 runbook; runs once operator completes the Vault seeding step above.
- [ ] **Admin re-provision RPC via UI:** admin impersonates support → calls `admin.provision_customer_storage(org, reason)` → `admin_audit_log` row + export_configurations row. Blocked on same operator step.

**Status:** `[x] code-complete 2026-04-24 — orchestrator + route + migration + grants + E2E all shipped; 9 mocked unit tests + 4-step live E2E (13.38 s) against real CF + real Supabase dev DB both green. Original ADR design called for a Supabase Edge Function; revised to a Next.js API route to avoid Deno port of cf-provision.ts — same cs_orchestrator auth, same idempotency, one runtime to maintain. Trigger-path (data_inventory INSERT → net.http_post → route) is applied to dev DB but blocked on operator Vault seeding before it actually fires; the 5-min safety-net cron catches any backlog once seeded.`

#### Sprint 2.2 — Wizard Step-7 soft banner + dashboard storage panel

**Estimated effort:** 0.5 day

**Deliverables:**
- [x] `app/src/app/api/orgs/[orgId]/onboarding/status/route.ts` — extended the polled `StatusResponse` with `storage_verified: boolean | null` (null = no export_configurations row yet; false = row exists, probe pending; true = ready). Reuses the existing RLS policy `org_select` on `export_configurations` (migration 20260413000007) — no new grants needed.
- [x] `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — added `storageVerified` state fed by each 5 s poll tick, + a non-blocking `StorageInitialisingBanner` rendered above the main card heading while `storage_verified !== true`. Banner auto-dismisses on the next poll once it flips. The rest of the wizard flow (waiting for first consent, proceeding to dashboard) stays fully usable; we don't gate the "Open my dashboard" button on storage readiness — the dashboard's own panel takes over there.
- [x] `app/src/app/(dashboard)/dashboard/_components/storage-panel.tsx` — server component reading `export_configurations` via the authenticated-user client. Three visual states: row-missing ("Provisioning" + spinner + help text), row-but-unverified ("Initialising" amber badge), row-verified (green "Ready" badge + provider label + bucket + last-delivery relative time). Two links: "View exports →" (`/dashboard/exports`) and "Manage storage" (`/dashboard/exports/settings` — will become `/dashboard/settings/storage` when Phase 3 ships the BYOK settings page). Wired into `dashboard/page.tsx` between the compliance-scores grid and the ComplianceHealthCard.

**Testing plan:**
- [x] Lint + build: `bun run lint` (231 → 232 files, 0 violations) + `bun run build` (0 errors, 0 warnings). Next.js 16 build includes the new components in the prerender manifest.
- [x] Unit tests: `tests/storage/` still 45/45 green after Sprint 2.2 additions (no new test files — the status endpoint delta is a single additive field behind the existing membership-gate tests; the dashboard panel is a pure read-only presentation component with no logic worth isolating).
- [ ] **Visual / manual verification (deferred to next onboarding run):** sign up a fresh org → at Step 7, confirm the soft "Storage initialising" banner shows until the provisioning trigger finishes + flips `is_verified=true`. Also visit `/dashboard` → confirm the storage panel renders the Ready state with the correct bucket name + provider label.
- [ ] **Race simulation (deferred):** set `is_verified=false` via direct SQL on a real org → refresh /dashboard → panel shows "Initialising" amber badge → flip back to true → panel shows "Ready". Manual smoke test; not worth automating before the Phase 4 nightly-verify cron lands (which exercises this flip in production).

**Status:** `[x] complete 2026-04-24 — status endpoint extended, wizard banner added, dashboard panel shipped. Lint + build + tests all green. Visual verification deferred to the next real onboarding run; the component logic is deterministic enough that a race simulation isn't blocking.`

### Phase 3 — BYOK escape hatch (Settings → Storage)

#### Sprint 3.1 — BYOK validation + settings UI

**Estimated effort:** 1 day

**Design amendment (2026-04-24):** the original ADR called for a Postgres RPC `admin.byok_validate_credentials`. Revised to a Next.js-only design — the verification probe is Node code (`runVerificationProbe` in `app/src/lib/storage/verify.ts` — sigv4 signing + fetch); Postgres can't run it. Same rationale as the Sprint 2.1 amendment. The Next.js route owns auth, Turnstile, rate-limit, and the probe call; no DB row is written by this sprint. Sprint 3.2 adds the persistence step (migration Edge Function + cutover).

**Deliverables:**
- [x] `app/src/app/api/orgs/[orgId]/storage/byok-validate/route.ts` — POST, Node runtime, `force-dynamic`. Auth chain: `requireOrgAccess(['org_admin'])` (account_owner folds to org_admin via `effective_org_role`) → body parse → `verifyTurnstileToken` → per-user `checkRateLimit('byok-validate:<user_id>', 5, 60)` → `runVerificationProbe` in-process. Returns `{ok: true, probe_id, duration_ms}` (HTTP 200) on success or `{ok: false, failed_step, error}` (HTTP 200 — structured failure, not transport error). Credentials stay in request memory only; never logged, never persisted. The auth chain orders Turnstile BEFORE rate-limit so a successful Turnstile token doesn't count as a rate-limit attempt — the attempt only registers once the probe is actually dispatched.
- [x] **No new rate-limit helper needed.** Reused the existing `app/src/lib/rights/rate-limit.ts` (Upstash Redis via `@upstash/redis`), which already has the exact API shape we need. Key prefix `byok-validate:<user_id>` scopes per-user so a compromised account can't DoS CF by switching orgs.
- [x] `app/src/app/(dashboard)/dashboard/settings/storage/page.tsx` — server component. Shows current `export_configurations` row (provider label + bucket + region + status) and gates the BYOK form on `effective_org_role === 'org_admin'`. Non-owners see a notice; already-BYOK orgs see a "contact support for rotation" notice (rotation is a migration-level concern handled in Sprint 3.2 + Sprint 4.1).
- [x] `app/src/app/(dashboard)/dashboard/settings/storage/_components/byok-form.tsx` — client component. Provider selector (Cloudflare R2 / AWS S3) with sensible region+endpoint defaults per provider, bucket, region, endpoint, access_key_id, secret_access_key fields. Turnstile widget rendered via `window.turnstile.render` (same `Window` interface augmentation the rights-request form uses). On submit: POSTs to the validate route; on `ok=true` renders a "Credentials validated" green panel with probe id + round-trip ms; on `ok=false` renders a red panel naming the failed step + error; transport failures (401/403/429/400) render amber panels with plain-English copy. Secret is wiped from form state on a successful validation; Turnstile resets on every terminal state so the user has to re-solve for another attempt.

**Testing plan:**
- [x] `app/tests/storage/byok-validate-route.test.ts` — Vitest, 18 tests, 214 ms. Happy path + credentials-never-in-response assertion; 3 auth branches (unauthenticated 401, not-a-member 403, insufficient_role 403); Turnstile failure 400; rate-limit 429 with `Retry-After` header; rate-limit key scoping asserted as per-user (not per-org); invalid-JSON 400; 7 × missing-required-field 400 (one per field); invalid-provider 400; probe-failure 200 passthrough; credentials-not-in-failure-response assertion.
- [x] Full test sweep: `cd app && bunx vitest run tests/storage/` — 63/63 PASS (45 pre-existing + 18 new).
- [x] Lint + build: `bun run lint` + `bun run build` both clean; 235 files scanned, 0 service-role violations, 0 ESLint violations, 0 TS errors, 0 build warnings.
- [ ] **Manual smoke** (blocked until a customer has BYOK creds to test with — this is a gated surface; cannot smoke-test without real third-party creds). Deferred to Sprint 3.2 close-out or first-customer onboarding, whichever lands first.

**Status:** `[x] complete 2026-04-24 — route + page + form + 18 new unit tests shipped. ADR originally called for a Postgres RPC; revised to a Next.js-only design because the probe is Node-native (same pattern as Sprint 2.1). Existing rate-limit + Turnstile + org-role primitives reused — zero new shared helpers, which matches the "share narrowly" memory.`

#### Sprint 3.2 — Storage migration Edge Function (copy + cutover)

**Estimated effort:** 1.5 days

**Deliverables:**
- [ ] `supabase/functions/migrate-customer-storage/index.ts` — Input: `{org_id, target_config, mode: 'copy_existing' | 'cutover_forward_only'}`. For `copy_existing`: streams every object from CS-managed bucket → target bucket via S3 CopyObject (cross-account via access-key chaining: download as source-bucket token, upload as target-bucket token). On completion: atomic UPDATE on `export_configurations` + REVOKE CS-managed token + SCHEDULE 30-day retention hold on CS-managed bucket.
- [ ] `public.storage_migrations` (new tracking table) with per-migration progress: `{id, org_id, from_config_id, to_config_id, mode, state, objects_total, objects_copied, started_at, completed_at, error_text}`.
- [ ] Resumable: if the job crashes mid-copy, the next invocation picks up from the last-completed object key (S3 ListObjectsV2 with StartAfter=last_copied_key).

**Testing plan:**
- [ ] Happy: seed 100 objects in CS-managed → run copy → all 100 appear in target → `export_configurations` updated → CS-managed token revoked.
- [ ] Crash-resume: kill the job mid-copy → re-invoke → completes without re-copying already-copied objects.
- [ ] Forward-only: no copy, just pointer swap. Historical objects remain accessible via admin audit-export download path until the customer's retention window expires.

### Phase 4 — Observability + rotation

#### Sprint 4.1 — Nightly verify cron + rotation RPC

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] `pg_cron` job `storage-nightly-verify` (02:00 IST): iterates every `export_configurations` row where `is_verified=true`, runs the probe, flips `is_verified=false` on failure + emits readiness flag.
- [ ] `admin.storage_rotate_credentials(org_id)` — only valid for `cs_managed_r2`: creates a new bucket-scoped token → verifies → UPDATEs `write_credential_enc` → revokes the old token. No migration required (same bucket).

**Testing plan:**
- [ ] Simulate revoked token via CF dashboard → next nightly verify flips `is_verified=false` → readiness flag fires.
- [ ] Rotation happy path: token_v1 in use → rotate → token_v2 in use + delivery unaffected → token_v1 revoked on CF side (verified via API list).

#### Sprint 4.2 — Cost monitoring + billing integration

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Monthly admin panel widget: per-org storage-bytes (from CF usage API) + monthly spend estimate + chargeback reporting for Pro / Enterprise tiers.
- [ ] Alert: single-org storage > plan-tier ceiling → emits ops-readiness flag for sales outreach.

---

## Test Results

_To be filled as sprints complete._

## Changelog References

_To be filled as sprints complete._

## Acceptance criteria

- A visitor completes the ADR-0058 wizard from /signup to /dashboard in under 5 minutes, with zero storage-related interaction. By the time they reach Step 7, `export_configurations.is_verified=true` for their org.
- Their first real consent_events row (emitted during Step 7 or post-onboarding) delivers to the auto-provisioned R2 bucket within ADR-1019's 60-second SLA.
- A BFSI enterprise customer can reach `/dashboard/settings/storage`, provide their own R2 / S3 credentials, migrate historical exports, and see the pointer flip — all without operator intervention.
- ConsentShield's CF account never holds more than N buckets (N = current budget threshold, initially 800 = 80% of the 1000 soft-limit); alert fires before the limit bites.
- Every storage-provider change (Tier-1 initial provision, BYOK migration, rotation) writes to `audit_log` + `admin.admin_audit_log` with enough context to reconstruct the transition post-hoc.
- CLAUDE.md Rules 1 (buffer temporary), 2 (delete-after-deliver), 4 (customer owns compliance record — DPA+isolation framing), 11 (per-org credential encryption), 18 (Sentry strip) all hold in both tiers.
- No customer data moves to the CS-managed CF account without being encrypted in flight (S3 API over TLS) + at rest (R2 server-side encryption, default-on) + without per-tenant bucket + scoped-token isolation.
