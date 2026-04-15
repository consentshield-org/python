# ConsentShield — Phase 2 Roadmap

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Date:** 2026-04-15
**Covers:** everything on the "What needs to be done" list as of the
2026-04-15 pause point. Sprints are ordered by dependency + ROI; each
lives inside an ADR that will be drafted before its sprint starts.

---

## Sequencing principles

1. Unblock end-to-end signup first — everything downstream depends on it.
2. Fast-ROI test coverage early so later sprints catch their own regressions.
3. Reliability + hardening (rate limit, deletion retry) before new features.
4. External-service wiring (Resend / Turnstile / Razorpay) grouped as a
   single config sprint; the code is already in place.
5. Net-new features (posture scanner, probes, audit export, connectors)
   after the foundation is test-covered and stable.

---

## Sprint 1 — Signup bootstrap hardening  (ADR-0013)

**Problem.** `/api/auth/signup` returns 401 when Supabase "Confirm email"
is ON because `supabase.auth.signUp` returns `session=null` and the
server-side route needs an authenticated JWT.

**Deliverables.**
- Client: stash `orgName` / `industry` in `options.data` on
  `supabase.auth.signUp`, not in the fetch body.
- Client: on the confirmation-redirect landing page, an auth-state
  listener fires `rpc_signup_bootstrap_org` using metadata from the
  newly-confirmed user.
- Server: `/api/auth/signup` remains as the code path for the
  email-confirmation-off fast path; both paths converge on the same RPC.
- Tests: sign-up-with-confirmation-on and sign-up-with-confirmation-off
  both end with one `organisations` row + one `organisation_members`
  row + one `audit_log` entry.

**Acceptance.** A fresh account created on `consentshield-one.vercel.app`
with "Confirm email" set to whatever Supabase defaults to, lands on
`/dashboard` after email-verify, with the org visible.

**Estimate.** ~3 hours.

---

## Sprint 2 — Distributed rate limiter  (ADR-0010)

**Problem.** `src/lib/rights/rate-limit.ts` keeps counters in a
module-scoped `Map`. On Vercel's serverless runtime each instance has its
own bucket; an attacker round-robining across instances bypasses the
limit N-fold.

**Deliverables.**
- Add `@vercel/kv` (exact-pinned).
- Replace the `Map` with KV calls — same public API.
- Key schema: `rl:rights:<ip>`, `rl:rights-otp:<ip>`, TTL = window.
- Fallback to in-memory if KV unavailable (dev-only).

**Acceptance.** Five rapid submissions from one IP to
`/api/public/rights-request` across two concurrent function invocations
return 429 on the sixth.

**Estimate.** ~3 hours.

---

## Sprint 3 — SLA-timer property tests  (ADR-0012 Sprint 1)

**Problem.** No automated tests for the SLA arithmetic — an off-by-one
in the 30-day deadline would silently mis-report every rights request.

**Deliverables.**
- `tests/workflows/sla-timer.test.ts` — property-based tests via
  `fast-check` (or hand-rolled property runs against a matrix of
  created_at / now pairs).
- Cover: exact 30-day breach, 7-day warning boundary, 1-day warning
  boundary, timezone invariance (IST vs UTC), leap-day crossing.
- Fold in the S-2 URL-path RLS test as
  `tests/rls/url-path.test.ts` — assert that a signed-in user hitting
  `/api/orgs/<other-org>/rights-requests/<id>` gets 404, not cross-org
  data.
- CI: run alongside existing `bun run test`.

**Acceptance.** `bun run test` now runs ≥ 50 tests (was 39) and all pass.

**Estimate.** ~3 hours.

---

## Sprint 4 — Deletion retry / timeout  (ADR-0011)

**Problem.** `deletion_receipts.status = 'awaiting_callback'` never
transitions if the customer webhook never calls back. No retry, no
dashboard signal.

**Deliverables.**
- Migration: add `next_retry_at timestamptz` +
  `idx_deletion_receipts_retry on (next_retry_at) where status = 'awaiting_callback'`.
- Supabase Edge Function `check-stuck-deletions` (Deno, ~120 LoC):
  hourly pg_cron → find `status = 'awaiting_callback' AND (next_retry_at IS NULL OR next_retry_at < now())` AND `requested_at > now() - 30 days` → retry dispatch up to 3× with exponential backoff (1h / 6h / 24h) → on final fail, mark `status = 'failed'` and emit `deletion_retry_exhausted` to `audit_log`.
- Cron entry in migration series (Vault-based key, per 009).

**Acceptance.** Seed a receipt stuck for > 1 h with `next_retry_at` in
the past; run the Edge Function; observe one retry attempt + updated
`next_retry_at` + `retry_count = 1`.

**Estimate.** ~1 sprint (~6 hours).

---

## Sprint 5 — Worker test harness  (ADR-0012 Sprint 2)

**Problem.** Worker has no automated tests. Every ADR-0008 change was
verified by smoke curls against the deployed Worker — regressions will
ship silently.

**Deliverables.**
- `miniflare` in root devDeps (exact-pinned).
- `tests/worker/*.test.ts` covering:
  - `/v1/events` — HMAC path (valid, timestamp drift, previous-secret
    grace, invalid signature), origin path (valid, missing, rejected,
    empty allowed_origins), `origin_verified` persisted correctly.
  - `/v1/observations` — same shape.
  - `/v1/banner.js` — compiled output has no `"secret"` substring; carries
    correct property/org IDs; caches for 60s.
- CI: `bun run test` runs both Node (`src/`) and Worker (`worker/`)
  suites.

**Acceptance.** ≥ 20 Worker tests green; toggling the secret-rotation
grace-period KV entry breaks the relevant test as expected.

**Estimate.** ~1 sprint (~6 hours).

---

## Sprint 6 — Buffer-pipeline end-to-end tests  (ADR-0012 Sprint 3)

**Problem.** Delivery flow (buffer → delivered_at → 5-min sweep) has no
automated coverage. `sweep_delivered_buffers()` and the pg_cron schedule
can silently drift.

**Deliverables.**
- `tests/buffer/delivery.test.ts` — real Supabase test harness (shares
  the RLS suite's setup/teardown):
  - Insert a `consent_event` row directly, mark `delivered_at = now()`,
    invoke `sweep_delivered_buffers()` after advancing now, assert row
    is gone.
  - Stuck-detection: insert without `delivered_at`, age > 1 h, assert
    `detect_stuck_buffers()` reports it.
- `tests/buffer/lifecycle.test.ts` — assert RLS still forbids UPDATE /
  DELETE on buffer tables from the `authenticated` role after all recent
  migrations.

**Acceptance.** ≥ 10 buffer-pipeline tests green. `bun run test` now
exceeds 80 total tests.

**Estimate.** ~1 sprint (~6 hours).

---

## Sprint 7 — External service activation  (ADR-0014)

**Problem.** Resend sender, Turnstile, Razorpay are all running on
test / placeholder credentials. OTP email currently only delivers to the
Resend account email; rights portal is effectively bot-open because
Turnstile always-passes; billing UI 500s on checkout.

**Deliverables.**
- **Resend:** verify DNS for `consentshield.in`; switch `RESEND_FROM` to
  `noreply@consentshield.in`; delete the `onboarding@resend.dev`
  fallback in dev.
- **Turnstile:** create production Turnstile site in Cloudflare;
  replace Vercel env `NEXT_PUBLIC_TURNSTILE_SITE_KEY` +
  `TURNSTILE_SECRET_KEY` on both `production` and `preview`. Confirm
  `verifyTurnstileToken` rejects invalid tokens on the live rights
  portal.
- **Razorpay:** create Razorpay account (test mode is fine for now);
  create four plans matching `src/lib/billing/plans.ts`; set all five
  env vars on Vercel; end-to-end test one checkout → webhook →
  `organisations.plan` updated.

**Acceptance.** OTP email arrives at an arbitrary inbox. Submitting the
rights form without solving Turnstile returns 403. A checkout on the
dashboard's billing page completes and the org's plan changes to `starter`
(or whichever was picked).

**Estimate.** Ops-heavy, ~half a day.

---

## Sprint 8 — Security posture scanner  (ADR-0015)

**Problem.** `pg_cron` already schedules
`run-security-scans` nightly, but the Edge Function does not exist. Every
24h the cron call 404s.

**Deliverables.**
- Supabase Edge Function `run-security-scans` (Deno). For each
  `web_properties` row, fetch the URL and record:
  - SSL cert validity + days-to-expiry
  - HSTS header presence
  - CSP header presence + report-uri
  - X-Frame-Options / Referrer-Policy
- Insert findings into `security_scans` (already exists). Emit
  `posture_finding` audit entries for each violation.
- Dashboard surface: a new `/dashboard/enforcement` tab (or reuse) lists
  the last scan per property with colour-coded severity.

**Acceptance.** Trigger the function manually; all demo sites get a row
in `security_scans` within seconds. Dashboard renders them.

**Estimate.** ~1 sprint (~6–8 hours).

---

## Sprint 9 — Consent probes  (ADR-0016)

**Problem.** `consent_probes` and `consent_probe_runs` tables exist; no
code reads or writes them. Synthetic compliance testing ("does the
banner actually prevent tracker firing when the user rejects") is
unimplemented.

**Deliverables.**
- Supabase Edge Function `run-consent-probes`: for each
  `consent_probes` row, headless-fetch the target URL with scripted
  consent interactions (using a playwright-compatible remote browser
  service or direct HTTP simulation), record tracker URLs observed.
- Insert findings into `consent_probe_runs`. Violations trigger the
  same audit path as `/violator` on the demo sites.
- Dashboard UI to create probes per property (schedule, consent
  scenario, expected outcome).
- pg_cron hourly schedule.

**Acceptance.** Seed one probe against `consentshield-demo.vercel.app/violator?violate=1`; probe run reports GA4 + Meta Pixel violations; probe against `/blog` with analytics rejected reports zero violations.

**Estimate.** ~1 sprint (~8 hours) — may spill into two if a headless
browser service needs evaluating.

---

## Sprint 10 — Audit export package  (ADR-0017)

**Problem.** Non-negotiable rule #4: "compliance exports must read from
customer-owned storage, not ConsentShield's DB." Nothing exports today.

**Deliverables.**
- Authenticated API route `/api/orgs/[orgId]/audit-export` + RPC
  `rpc_audit_export_manifest`.
- Assemble a ZIP of: org profile, data inventory, banner configs
  (versioned), consent-event totals by month, rights-request summary
  (count + status), deletion receipts (hashed identifier + status),
  security-scan rollup, probe runs.
- Uploaded to R2 (new bucket) under the customer's write-only R2
  credentials; ConsentShield holds only the manifest pointer, not the
  ZIP.
- Downloadable URL returned to the dashboard.

**Acceptance.** Export button on the dashboard produces a ZIP that a
human auditor can open and read; ConsentShield DB does not retain the
ZIP bytes after upload.

**Estimate.** ~1 sprint (~8 hours). Requires R2 bucket + per-org
credentials wiring; may extend if the credentials model is non-trivial.

---

## Sprint 11 — Pre-built deletion connectors  (ADR-0018)

**Problem.** Generic webhook connector (ADR-0007) works, but onboarding
a customer with Mailchimp or HubSpot requires them to wire a custom
endpoint. Pre-built OAuth connectors shrink that friction.

**Deliverables.**
- Two new connector types in `integration_connectors.connector_type`:
  `mailchimp`, `hubspot`.
- OAuth flow UI in the dashboard integrations tab.
- Mapping: rights-request erasure → Mailchimp `/lists/{id}/members/{hash}` DELETE;
  HubSpot `/contacts/v1/contact/email/{email}` DELETE.
- Callback / receipt flow reuses the existing
  `rpc_deletion_receipt_confirm`.
- Tests: mock each provider's API + assert receipt row transitions.

**Acceptance.** Admin can connect a Mailchimp account via OAuth, submit
an erasure request, and see the receipt flip to `confirmed` after the
Mailchimp API returns 204.

**Estimate.** ~1 sprint (~8 hours). OAuth detail per provider may push
to two sprints.

---

## Out of scope for this roadmap

Tracked for Phase 3+:

- **GDPR dual-framework.** Dual-compliance module (DPDP + GDPR in the
  same orchestration stack). Multi-sprint. Schema-wide.
- **ABDM (Ayushman Bharat Digital Mission) module.** Phase 4.
  Healthcare-specific; never persists FHIR data (non-negotiable #3).

Plus the usual tail:

- `sentry.edge.config.ts` if we ever move routes to Edge runtime.
- Accessibility + i18n pass on the banner and privacy notice.
- Admin-tier billing / usage metering.
- Public API docs (OpenAPI) for server-to-server `/v1/events`.

---

## How to kick off a sprint

1. Copy `docs/ADRs/ADR-template.md` to `ADR-<NNNN>-<slug>.md`.
2. Fill the Context + Decision from the sprint block above.
3. Break into 1–3 sub-sprints if needed.
4. Work. Each checkpoint commits with `feat(ADR-NNNN): ...`.
5. Update the per-area changelog. Update `ADR-index.md`.

Recommended first pick: **Sprint 1.** Signup is the only thing blocking
an un-toggled end-to-end on the live Vercel deploy.
