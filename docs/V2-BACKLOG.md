# V2 Backlog — Deferred Items for Post-Phase-2 Review

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Purpose.** Single catalogue of items flagged for a later version
while Phase-2 sprints 1–11 ship. Each entry has a pointer back to
the originating ADR and the specific limitation / alternative that
was consciously accepted.

**Review cadence.** Revisit this list **after Phase 2 closes**, at
which point we will:

1. Review the existing code end-to-end.
2. Pick **2–3 architecture decision points** to raise as ADRs in the
   next phase.
3. Move picked items into their own ADRs; the rest stay here or get
   closed as "no longer relevant".

Do not implement anything from this list during Phase 2 — it is a
backlog, not a sprint queue.

---

## Test coverage

### V2-T1. Signup idempotency regression test  *(origin: ADR-0013)*

The guard against double-bootstrap (creating two orgs for one user)
lives in `src/app/auth/callback/route.ts`, not in the RPC. Testing
it requires Next.js route-handler invocation with a mocked Supabase
client. No such harness exists today.

**Why deferred.** Would add a new test-infra dep tree (vitest + a
Next request/response mock) for one test. Sprint-3 of ADR-0012
(buffer pipeline) didn't need it, and the live signup path has been
exercised manually. No known bug — only the automated safety net is
missing.

**Shape of the v2 fix.** Either:
- Adopt `next-test-api-route-handler` (or the Next.js experimental
  route-tests API if stable by then); or
- Lift the idempotency guard into a pure `checkExistingMembership`
  helper and unit-test it.

---

## External services activation

### V2-X1. Vercel Preview env vars  *(origin: ADR-0014)*

Turnstile and Razorpay keys are set for Vercel **Production** only.
The current Vercel CLI requires per-branch targeting for Preview
env writes that our scripted approach doesn't hit cleanly, and the
admin app only deploys from `main` (Production) today.

**Why deferred.** Preview deploys happen only for non-`main`
branches, and the dev team (one person) hasn't used Preview yet. No
runtime impact on the live admin app.

**Shape of the v2 fix.** Either upgrade the Vercel CLI push script
to iterate through each feature branch, or flip the Marketplace
integrations to "all environments" via the Vercel Dashboard once
per integration.

### V2-X3. Audit-export R2 upload pipeline  *(origin: ADR-0017)*

Phase 1 of ADR-0017 returns the export ZIP as an HTTP download.
The roadmap's goal of uploading to the customer's own R2 bucket and
returning a signed URL requires:

1. A delivery pipeline that continuously writes buffer data to the
   customer's R2 (Phase 3 work).
2. Decryption of `export_configurations.write_credential_enc` inside
   the export route.
3. An S3-compatible PutObject call (aws4fetch or hand-rolled sigv4,
   ~200 LoC — no AWS SDK, per rule #14).

**Why deferred.** Direct download is sufficient for dev and early
customers. The customer R2 path only pays off once the delivery
pipeline exists and is actually preserving full history in customer
storage.

**Shape of the v2 fix.** Add a `delivery_target: 'r2'` branch in the
export route that, when `export_configurations` exists and is
verified, uploads instead of streaming; record `r2_bucket` +
`r2_object_key` in `audit_export_manifests`.

### V2-X2. End-to-end billing checkout UX smoke  *(origin: ADR-0014)*

Infrastructure is complete (Razorpay keys, plans, webhook secret).
No test account has opened the checkout modal, completed the test
card `4111 1111 1111 1111`, and seen `organisations.plan` update.

**Why deferred.** Requires a signed-in non-dev test account. Not a
blocker for closing ADR-0014; all signing-and-server paths are
verified (webhook returns 403 for bad signatures, key_id returns
correctly from `/api/orgs/[orgId]/billing/checkout`).

---

## Synthetic compliance (consent probes)

### V2-P1. Headless-browser probe runner  *(origin: ADR-0016)*

v1 is static HTML analysis — two-pass (structured `<script src>`,
then full-body substring for URLs referenced in inline JS). This
can't distinguish conditional (`if (consented) { load() }`) from
unconditional script loads when the URL appears in inline JS. On
the demo site, `/violator?violate=1` correctly surfaces violations;
`/blog` emits a **documented false positive** for the same reason.

**Why deferred.** Headless-browser execution requires either a
third-party service (Browserless, ScrapingBee) with recurring cost
and a new dep, or **Vercel Sandbox** microVMs which would be a
first-class but non-trivial integration. Both are out of scope for
Phase 2.

**Shape of the v2 fix.**
- Preferred: Vercel Sandbox running Playwright. Matches the
  platform-native preference in CLAUDE.md. Probe runner becomes a
  Vercel Function invoked by pg_cron (the Sandbox starts up for
  each probe, executes the consent script, reports trackers via
  a callback).
- Alternative: adopt `@browserless/http` or similar.

### V2-P2. Probe CRUD UI  *(origin: ADR-0016)*

Probes are seeded via direct SQL today. `/dashboard/enforcement`
lists them but no form creates or edits them.

**Why deferred.** Only two demo probes exist. A CRUD form is about
a half-day of dashboard work and depends on decisions about probe
granularity (per-page vs per-property vs per-cohort).

**Shape of the v2 fix.** Dedicated `/dashboard/probes` page with
a property selector, a consent-state editor, and schedule picker.

---

## Ops / platform

### V2-O1. Unbuilt Edge Functions (cron slots reserved)  *(origin: ADR-0011 cleanup)*

Three cron jobs were dropped in migration
`20260416000004_unschedule_orphan_crons.sql` because their target
Edge Functions were never written:

- `check-stuck-buffers` — buffer-pipeline stuck-row alerting
- `run-security-scans` (implemented in ADR-0015)
- `check-retention-rules` — Phase-3 retention enforcement

One is now done (ADR-0015). The remaining two are Phase-3 features.

**Why deferred.** No feature calls for them yet.

**Shape of the v2 fix.** Each gets its own ADR alongside the
feature sprint that needs it. Re-register the cron at that time.

### V2-O2. Vercel Deployment Protection  *(origin: session handoff)*

Off on both Vercel projects (admin + demo sites). Fine for dev —
no real traffic — but flip on before any real-customer onboarding.

**Why deferred.** Single-dev project with no live customers.

### V2-O3. pg_cron failure detection  *(origin: ADR-0011 discovery)*

The 2026-04-16 discovery: `pg_net` had been missing for weeks and
all HTTP cron jobs were silently failing. Today's protection is
inspecting `cron.job_run_details` manually. A scheduled watchdog
that emails / Slacks the operator when cron runs fail would close
this loop.

**Why deferred.** Dev-only right now; noise not worth automating.

**Shape of the v2 fix.** A tiny Edge Function `check-cron-health`
on a daily schedule that scans the last 24 h of
`cron.job_run_details` and emits an incident audit + email if any
job failed more than N times.

---

## Connectors

### V2-C1. OAuth flow for pre-built connectors  *(origin: ADR-0018)*

ADR-0018 Phase 1 authenticates with pasted API keys (Mailchimp API
keys, HubSpot private-app tokens). The full product promise — "click
Connect Mailchimp, complete OAuth in a popup, done" — requires:

1. Provider-specific OAuth app registration (Mailchimp, HubSpot).
2. `/api/integrations/oauth/{provider}/callback` route that handles
   the redirect + token exchange.
3. Refresh-token rotation job.
4. Replace the dashboard form's pasted-key inputs with a single
   "Connect" button per provider.

**Why deferred.** API-key auth closes 95% of the usability gap; the
remaining OAuth polish is a per-provider config effort with external
app-registration dependencies (each provider wants proof of a live
privacy policy, sometimes app review). Out of scope for the Phase-2
close.

**Shape of the v2 fix.** Per-provider `lib/connectors/{provider}/oauth.ts`
following the pattern established by the Razorpay webhook flow.

---

## API key format

### V2-K1. Edge Functions require `--no-verify-jwt`  *(origin: Edge Function gateway)*

Every HTTP-invoked Edge Function ships with `--no-verify-jwt` today
because the vault-stored `cs_orchestrator_key` is in the new
`sb_secret_*` format and the Edge Function gateway still expects
legacy JWT format. Function-internal PostgREST calls use the same
key successfully; only the gateway layer is downstream of the
bypass.

**Why deferred.** Supabase will eventually close the format gap at
the gateway. Watching for an announcement is cheaper than either
issuing a legacy JWT manually or fronting every function with
in-function auth verification.

**Shape of the v2 fix.** Remove `--no-verify-jwt` from deploy
commands once Supabase supports sb_secret_* keys at the gateway.
No code change, just redeploy.

---

## How to maintain this file

- Whenever an ADR consciously accepts a limitation or alternative,
  add an entry here.
- Entries are **write-once**: once an item is moved into its own
  follow-up ADR, replace the body with a one-line "→ see ADR-NNNN"
  pointer.
- Keep it short. Backlog documents that grow prose go unread.
