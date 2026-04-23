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

- ConsentShield operates a single Cloudflare account configured with an account-level API token (`CF_ACCOUNT_API_TOKEN`) carrying `R2 Storage:Edit` scope. The token lives in the customer-app's Vercel project secrets + the Edge Function secret store (`supabase secrets set CF_ACCOUNT_API_TOKEN=...`).
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
- **Account API token rotation:** `CF_ACCOUNT_API_TOKEN` rotation needs to happen without breaking existing per-bucket tokens. Per-bucket tokens are independent; rotating the account-level token only affects NEW provisioning + NEW per-bucket token issuance. Straightforward.
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
- [ ] Operator step: create `CF_ACCOUNT_API_TOKEN` via Cloudflare dashboard with `Account:R2 Storage:Edit` scope (account-level, no zone scope). Token stored in:
  - Vercel project env (app, admin): prod + preview.
  - Supabase function secret (`supabase secrets set CF_ACCOUNT_API_TOKEN=...`).
  - `.env.local` for dev.
- [ ] `STORAGE_NAME_SALT` generated + stored alongside.
- [ ] Documentation: `docs/runbooks/cf-account-token-rotation.md` — step-by-step rotation procedure that preserves existing per-bucket tokens.

**Testing plan:**
- [ ] `curl -H "Authorization: Bearer $CF_ACCOUNT_API_TOKEN" https://api.cloudflare.com/client/v4/accounts/<account_id>/r2/buckets` returns 200 + the existing bucket list.

#### Sprint 1.2 — Provisioning primitives library

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `app/src/lib/storage/cf-provision.ts` — TypeScript module exporting:
  - `deriveBucketName(orgId: string): string` — sha256 + base32 + truncate + `cs-cust-` prefix.
  - `createBucket(name: string, locationHint: string): Promise<{id, name}>` — Cloudflare REST call.
  - `enableDeleteProtection(bucketName: string): Promise<void>` — required for all CS-managed buckets.
  - `createBucketScopedToken(bucketId: string): Promise<{access_key_id, secret_access_key, token_id}>` — generates a token restricted to the bucket.
  - `revokeBucketToken(tokenId: string): Promise<void>` — for migration / cleanup.
- [ ] All calls wrap a single `fetch` through `@ai-sdk/…`-style retry shim (3 attempts, exponential backoff, 30s budget). Structured log every attempt; never log the token response body.
- [ ] Unit tests with mocked fetch covering: 201 creates, 409 bucket-exists (idempotency — return the existing bucket), 429 rate-limit (retry), 5xx (retry), 4xx non-409 (fail fast), network error.

**Testing plan:**
- [ ] Against the dev CF account, provision one throwaway bucket end-to-end. Verify via the dashboard. Revoke the token. Verify revocation takes effect (subsequent PUT returns 403).

#### Sprint 1.3 — Verification probe + failure capture

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] `app/src/lib/storage/verify.ts` — `runVerificationProbe(config)` implementing the 6-step probe from the Decision section.
- [ ] `supabase/migrations/<ts>_export_verification_failures.sql` — new narrow table + RLS (admin-only read).
- [ ] `runVerificationProbe` emits an `admin.ops_readiness_flags` row on failure (`blocker_type='infra'`, `severity='high'`, dedupe key `(org_id, 'storage_verify_failed')`).

**Testing plan:**
- [ ] Happy path: PUT → GET → content-hash match → DELETE → `is_verified=true`.
- [ ] Negative: tampered token → PUT fails 403 → failure row + readiness flag → `is_verified` stays false.

### Phase 2 — Managed auto-provision at onboarding

#### Sprint 2.1 — Background provisioning job + wizard Step-4 trigger

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `supabase/functions/provision-customer-storage/index.ts` Edge Function running as `cs_orchestrator`. Input: `{org_id}`. Runs: bucket-create → token-create → encrypt → INSERT export_configurations → verify → flip is_verified. Idempotent per org_id.
- [ ] Wizard Step 4 (`save_data_inventory`) RPC extended to fire-and-forget a `net.http_post` to the Edge Function. Non-blocking: wizard advances regardless.
- [ ] Admin RPC `admin.provision_customer_storage(org_id)` for operator-triggered re-provisioning (audit-logged).

**Testing plan:**
- [ ] End-to-end onboarding: sign up a fresh org → complete wizard through Step 7 → `export_configurations` row exists + `is_verified=true` + CF dashboard shows the bucket.
- [ ] Idempotency: run the Edge Function twice for the same org → one row, no errors.
- [ ] CF API outage simulation (mock 503): Edge Function retries, eventually emits ops-readiness flag.

#### Sprint 2.2 — Wizard Step-7 soft banner + dashboard storage panel

**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — if `export_configurations.is_verified=false` at poll time, render a soft banner ("Storage initialising…"). Banner auto-dismisses when verification flips.
- [ ] `app/src/app/(dashboard)/dashboard/_components/storage-panel.tsx` — widget on the main dashboard showing provider + last-successful-delivery + link to Settings → Storage.

**Testing plan:**
- [ ] Race simulation: force `is_verified=false` → wizard Step 7 shows the banner → manually flip `is_verified=true` → banner disappears on next poll.

### Phase 3 — BYOK escape hatch (Settings → Storage)

#### Sprint 3.1 — BYOK validation RPC + settings UI

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `admin.byok_validate_credentials(p_provider, p_bucket, p_region, p_access_key_id, p_secret_access_key)` — runs the verification probe against the supplied credentials; returns `{ok, failure_reason?}`. Credentials NOT persisted on this call.
- [ ] `/dashboard/settings/storage` page (account_owner role-gated): current provider display + BYOK form + Turnstile + per-account 5/hour rate limit.
- [ ] Customer-app route handler: validates the form, calls the RPC, on success returns the migration-mode prompt.

**Testing plan:**
- [ ] Paste valid R2 credentials → 200 `{ok:true}`. Paste invalid → 400 with a readable message ("bucket not found" / "permission denied on PUT" / etc.). Credentials never hit logs.

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
