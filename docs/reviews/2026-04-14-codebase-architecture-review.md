# Critical Codebase Review — Architecture Compliance

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Date:** 2026-04-14
**Scope:** Compliance of the entire codebase (as of commit `4bacdfa`) against the
four source-of-truth architecture documents and the 17 non-negotiable rules in
`CLAUDE.md`.
**Reviewer:** Sudhindra Anegondhi (via parallel agent-driven audit of database,
Worker, API/Edge Functions, client/dependency boundary, and ADR-vs-implementation
gap).

---

## 1. Executive Summary

Seven ADRs are marked Completed and the code for each exists and largely works.
However the review surfaces **9 blocking issues**, **13 should-fix issues**, and
several cosmetic items. The most serious blockers are a Worker secret shipped in
plaintext to every customer's browser, a Turnstile fallback that always passes in
production if a key is missing, and heavy reliance on the Supabase service role
key for buffer-table writes in application routes (violating the scoped-roles
non-negotiable).

Areas found fully clean: dependency pinning, Sentry scrubbing, Next.js
client/server boundary, copyright/authorship discipline.

No ADR may be declared truly Completed until the blocking items tied to it are
closed.

---

## 2. Verification Scope

| Surface | Docs cross-checked | Result |
|---------|--------------------|--------|
| Database (schema, RLS, roles, triggers, pg_cron, encryption RPC) | `consentshield-complete-schema-design.md`, rules 1, 2, 5, 11, 12, 13 | 3 blocking, 4 should-fix |
| Cloudflare Worker | `consentshield-definitive-architecture.md`, ADR-0002, rules 5, 7, 8, 15 | 2 blocking, 1 should-fix |
| Next.js API routes + Supabase Edge Functions | `consentshield-definitive-architecture.md`, ADR-0004/0006/0007, rules 5, 6, 7, 9, 10, 11, 17 | 4 blocking, 6 should-fix |
| Client/server boundary, deps, Sentry, authorship | `nextjs-16-reference.md`, rules 6, 14, 16, 17, authorship | **Clean** |
| ADR acceptance criteria vs shipped code | All 7 ADRs, testing strategy | 1 blocking, 4 should-fix |

---

## 3. Blocking Findings

These violate a non-negotiable rule or break a security/compliance invariant. No
ADR should remain in Completed state while any of these are open.

### B-1. Worker banner script ships the event-signing secret to every browser

- **File:** `worker/src/banner.ts:149`
- **Evidence:** The compiled banner JS embeds `secret: args.signingSecret` inside
  the `CFG` object literal. `signingSecret` is the org's `event_signing_secret`
  used by the Worker HMAC verification on `/v1/events` and `/v1/observations`.
- **Impact:** Any visitor to any customer's website can extract the secret from
  the banner source, forge arbitrary consent events or tracker observations, and
  replay events as any user. The HMAC validation in the Worker then becomes
  decorative — the entire integrity guarantee of ADR-0002 is nullified.
- **Rule violated:** #6 (no secrets in client code), and the spirit of #7 (HMAC
  verification is meaningless if the signing secret is public).
- **Fix:** Do not send the event-signing secret to the browser. Options:
  - Mint a short-lived per-session signing token from a Worker endpoint that
    rate-limits per IP / per property.
  - Use a challenge-response handshake where the Worker signs a short-lived
    nonce the banner then includes in event payloads.
  - At minimum, use a separate browser-only credential whose scope is bounded to
    the current property and rotates on every banner publish.
- **Priority:** Highest. Rotate all existing `event_signing_secret` values once
  fixed, as any value ever shipped is compromised.

### B-2. Worker does not record `origin_verified` on persisted events

- **File:** `worker/src/events.ts:111-122`, `worker/src/observations.ts:89-97`
- **Evidence:** The event/observation rows written to Supabase do not include an
  `origin_verified` field. ADR-0002 explicitly requires the status
  (`valid` / `origin_unverified`) to be persisted.
- **Impact:** Compliance auditors cannot distinguish browser-originated events
  (origin header present and whitelisted) from server-originated or injected
  events (origin missing or rejected). Destroys the forensic value of the
  buffer.
- **Rule violated:** #8 (flag missing origins as `origin_unverified` in the
  payload).
- **Fix:** Add `origin_verified: originResult.status` to both write payloads.
  Add a column to `consent_events` and `tracker_observations` if not already
  present, and backfill default `'unknown'`.

### B-3. Turnstile verification falls back to Cloudflare's always-pass test key

- **File:** `src/lib/rights/turnstile.ts:15`
- **Evidence:** `const secret = process.env.TURNSTILE_SECRET_KEY || ALWAYS_PASS_SECRET`
  with `ALWAYS_PASS_SECRET = '1x0000000000000000000000000000000AA'`.
- **Impact:** If the production env var is unset (currently is — see
  `STATUS.md` pending list), every rights request submission passes the bot
  gate trivially. Opens the rights portal to unlimited automated abuse and
  bypasses rule #10.
- **Rule violated:** #10 (Turnstile + email OTP on rights requests).
- **Fix:** Remove the fallback. If `TURNSTILE_SECRET_KEY` is unset in
  `NODE_ENV=production`, throw at boot. Keep the test key only in a branch
  explicitly guarded by `NODE_ENV === 'development'`.

### B-4. OTP verification writes buffer tables with `SUPABASE_SERVICE_ROLE_KEY`

- **File:** `src/app/api/public/rights-request/verify-otp/route.ts:30-33, 80-98, 120-126`
- **Evidence:** `createClient(..., SUPABASE_SERVICE_ROLE_KEY)` is used to UPDATE
  `rights_requests`, INSERT into `rights_request_events` (buffer), and INSERT
  into `audit_log`. Similar pattern in the initial rights-request POST, signup,
  and deletion-receipts routes.
- **Impact:** Violates the architecture's security boundary: only
  `cs_orchestrator` should mutate buffer and operational tables from running
  application code. The service role key has unrestricted permissions across
  every table. A single bug in one route expands the blast radius to the entire
  database.
- **Rule violated:** #5 (no `SUPABASE_SERVICE_ROLE_KEY` in running application
  code — for migrations only).
- **Fix:** Two paths, pick one:
  - Move the OTP verify flow into a Supabase Edge Function authenticated as
    `cs_orchestrator`. The Next.js route just forwards the payload with a
    rate-limit + Turnstile gate.
  - Accept the documented Supabase REST constraint (only `anon` and
    `service_role` JWTs) and enforce `cs_orchestrator` via a thin PL/pgSQL
    wrapper: the route calls a `security definer` function that internally
    runs `SET LOCAL role cs_orchestrator` and performs the writes.
- **Related:** The ADR-0002 note acknowledges the Supabase REST constraint for
  the Worker. That same constraint is being quietly exploited everywhere else
  in the stack without a plan.

### B-5. Razorpay webhook silently acks requests when `org_id` is missing

- **File:** `src/app/api/webhooks/razorpay/route.ts:50-68`
- **Evidence:** After failing to resolve `org_id` from notes or subscription
  lookup, the handler returns `{ received: true, error: 'Org not found' }` with
  a 200 status.
- **Impact:** A malformed or malicious webhook is ack'd and lost — Razorpay
  will not retry. Real billing events can disappear. No paper trail of
  misrouted money.
- **Rule violated:** Spirit of rule #5 (webhook must verify identity before any
  DB op) and ADR-0006 acceptance criteria (plan updated on event).
- **Fix:** Return 400 with a clear error body when `org_id` is unresolvable.
  Log the full event ID and payload signature (not payload body) to a
  `webhook_failures` buffer table for manual inspection. If reliability is a
  concern, persist every successful signature verification first, then
  dispatch.

### B-6. Deletion callback accepts a signed `receipt_id` without checking the row's state

- **File:** `src/app/api/v1/deletion-receipts/[id]/route.ts:14, 35-39`
- **Evidence:** After HMAC verification, the handler writes the incoming
  payload to `deletion_receipts` without verifying (a) the row exists, (b) the
  row belongs to a rights request whose state is `awaiting_callback`, or (c) it
  has not already been completed.
- **Impact:** A customer who saves the signed callback URL can replay it, or a
  race with a legitimate callback can overwrite status. Compliance record
  integrity is weaker than the crypto implies.
- **Rule violated:** #9 (signed callback URLs) — the signature alone is not a
  sufficient authorization check.
- **Fix:** After signature verification, SELECT the row, assert `status =
  'awaiting_callback'`, and use an UPDATE with a `WHERE status =
  'awaiting_callback'` guard (optimistic concurrency). Reject replays with 409.

### B-7. Several buffer tables lack a `delivered_at` index for the sweep

- **File:** `supabase/migrations/20260413000004_buffer_tables.sql:172, 191, 211`
  (missing indexes on `withdrawal_verifications`, `security_scans`,
  `consent_probe_runs`), and partial coverage on `delivery_buffer`,
  `rights_request_events`, `deletion_receipts`.
- **Evidence:** `sweep_delivered_buffers()` queries
  `delivered_at IS NOT NULL AND delivered_at < now() - interval '5 min'`. Only
  the partial indexes for `delivered_at IS NULL` exist on some tables; none
  have the `delivered_stale` counterpart.
- **Impact:** The 15-minute safety sweep (pg_cron) performs a sequential scan
  over every buffer table on every run. Under load this grows unbounded and
  the safety net itself becomes a performance hazard. Rule #1 requires
  prompt deletion — missed sweeps extend retention beyond the "seconds to
  minutes" claim.
- **Rule violated:** #1 (buffer tables are temporary) in spirit and ADR-0001
  Sprint 1.4 "verification queries pass" in practice.
- **Fix:** Add
  `create index idx_<table>_delivered_stale on <table> (delivered_at) where delivered_at is not null;`
  on all 10 buffer tables. One migration file, idempotent.

### B-8. Encryption RPC grants `execute` only to `service_role`

- **File:** `supabase/migrations/20260414000002_encryption_rpc.sql:28-31`
- **Evidence:** `grant execute on function decrypt_secret(...) to service_role;`
  — no grant to `cs_delivery` or `cs_orchestrator`.
- **Impact:** Any code that needs to decrypt an integration connector config
  must do so as `service_role`, reinforcing B-4. The scoped roles are dead
  letters for this critical path.
- **Rule violated:** #5 and #11 (per-org key derivation is correct, but the
  access control around it is not).
- **Fix:** Decide the intended caller:
  - If `cs_delivery` decrypts for dispatch: `grant execute on function
    decrypt_secret(uuid, bytea) to cs_delivery;`
  - If `cs_orchestrator` decrypts: grant to that role instead.
  - Remove `service_role` from the grant once the real caller is wired.
- **Pair fix with B-4.**

### B-9. ADR-0004 "cleanup of unverified rights requests" is unimplemented

- **ADR:** ADR-0004, Sprint 1.2
- **Evidence:** The ADR lists a cleanup job that deletes unverified rows older
  than 24 hours. No migration, no pg_cron entry, no Edge Function matching
  that description exists. The rights portal is live.
- **Impact:** Rows from bot submissions, abandoned flows, or expired OTPs
  accumulate indefinitely in a buffer table. Rule #1 (ephemeral buffers)
  silently violated over time.
- **Rule violated:** #1, and the ADR's own acceptance criteria.
- **Fix:** Add one migration creating a pg_cron job that runs daily and
  deletes `rights_requests` where `email_verified = false` and
  `created_at < now() - interval '24 hours'`.

---

## 4. Should-Fix Findings

Architectural drift, missing defense-in-depth, or test-documentation gaps that
do not break a non-negotiable rule but weaken the system.

### S-1. In-memory rate limiter does not survive multi-instance deployment

- **File:** `src/lib/rights/rate-limit.ts`
- **Impact:** Each Vercel serverless instance has its own counter. An attacker
  making requests that round-robin across N instances bypasses the limit N-fold.
- **Fix:** Move to Vercel KV or Upstash Redis keyed by `rights-*:ip`.

### S-2. Authenticated org-scoped routes rely on RLS without explicit JWT `org_id` check

- **Files:** every handler under `src/app/api/orgs/[orgId]/**`
- **Impact:** RLS is correct today, but a single policy mistake could leak
  cross-org data. Defense in depth missing.
- **Fix:** In each handler, after `auth.getUser()`, read the `org_id` custom
  claim and verify it equals the URL `[orgId]`. Reject 403 otherwise.

### S-3. Razorpay webhook has no event-ID deduplication

- **File:** `src/app/api/webhooks/razorpay/route.ts`
- **Impact:** Razorpay retries on timeout. `subscription.activated` processed
  twice could double-count plan upgrades or race on downgrade.
- **Fix:** Capture the `x-razorpay-event-id` header. Track in
  `webhook_events_processed` (small operational table). Return 200 on seen IDs.

### S-4. Turnstile fetch has no timeout

- **File:** `src/lib/rights/turnstile.ts:20-30`
- **Impact:** Cloudflare outage hangs the rights-portal request until the
  Node.js default timeout.
- **Fix:** `AbortController` with 5-10 s timeout; surface a clear error.

### S-5. Deletion dispatch sets `awaiting_callback` with no timeout or retry

- **File:** `src/lib/rights/deletion-dispatch.ts:169-173`
- **Impact:** If a customer webhook never responds, the row stays pending
  forever; no escalation to the dashboard or SLA breach flag.
- **Fix:** Edge Function (cron hourly) that scans `awaiting_callback` rows
  older than N hours, retries up to 3x with exponential backoff, then marks
  `failed` and emits a dashboard alert.

### S-6. Per-org encryption key re-derived on every call

- **File:** `src/lib/encryption/crypto.ts:44-58`
- **Impact:** Needless DB read + HMAC per decrypt. Becomes a hotspot when
  orchestrating a batch deletion.
- **Fix:** Request-scoped cache. Do NOT use a process-global cache — memory
  leaks across tenants defeat isolation.

### S-7. SLA reminder Edge Function falls back to `service_role`

- **File:** `supabase/functions/send-sla-reminders/index.ts:10-11`
- **Evidence:** `Deno.env.get('SUPABASE_ORCHESTRATOR_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!`
- **Impact:** The scoped role is a facade if the real key is never set.
- **Fix:** Require the orchestrator key in production; fail fast on startup.

### S-8. Rights-request events route writes without explicit org-membership check

- **File:** `src/app/api/orgs/[orgId]/rights-requests/[id]/events/route.ts:36-50`
- **Impact:** Pairs with S-2.
- **Fix:** Same as S-2.

### S-9. Worker: empty `allowed_origins` silently admits every origin

- **File:** `worker/src/origin.ts:71-72`
- **Impact:** A newly-created property with no configured origins accepts
  anything. Reasonable during setup; dangerous if the user never completes
  setup.
- **Fix:** Flag property as "origins unconfigured" in the payload
  (`origin_verified: 'unconfigured'`). Surface on the properties page as a
  setup todo.

### S-10. ADR-0004 / ADR-0005 / ADR-0006 all have `Test Results: _Pending_`

- **ADRs:** 0004 line 121-123, 0005 line 106-107, 0006 line 104-105
- **Impact:** ADRs are status=Completed but the test plan was never executed
  or its results were never recorded. Violates the project rule "No sprint
  without tests."
- **Fix:** Run the explicit test plans end-to-end with real fixtures, record
  actual output, downgrade status to `In Progress` in the interim.

### S-11. Buffer-pipeline, Worker-endpoint, and SLA-timer tests missing

- **Docs:** `consentshield-testing-strategy.md` sections Priority 2, 4, 5, 6.
- **Evidence:** Only `tests/rls/` has automated tests. Other priority tiers
  rely on manual curl scripts recorded in ADRs.
- **Impact:** Regressions in delivery, Worker validation, and SLA arithmetic
  will not be caught in CI.
- **Fix:** Add `tests/buffer/`, `tests/worker/`, `tests/workflows/` suites
  incrementally. Start with SLA-timer accuracy — the calculation is one SQL
  expression and is easy to property-test.

### S-12. pg_cron job definitions contain literal placeholder tokens

- **File:** `supabase/migrations/20260413000014_pg_cron.sql:18-19, 30-31, 42-43, 54-55`
- **Evidence:** Bearer tokens appear as the string `<cs_orchestrator_key>` in
  the migration source.
- **Impact:** If run as-is on a fresh database, all scheduled HTTP calls fail
  401. Currently working only because the running database received a manual
  edit or a separate secrets-injection step not tracked in the repo.
- **Fix:** Move secret injection into a documented post-migration step using
  Supabase Vault or `alter database set` variables. Reference them from the
  cron payload via `current_setting('app.cs_orchestrator_key')`.

### S-13. ADR-0002 acknowledges Supabase scoped-role limitation but provides no mitigation

- **File:** `docs/ADRs/ADR-0002-worker-hmac-origin.md` "Architecture Changes"
- **Impact:** The constraint drives the real-world service-role-key sprawl in
  B-4. It needs a documented remediation plan even if implementation is
  deferred.
- **Fix:** Either open a new ADR (e.g., ADR-0008 "Scoped-role enforcement in
  REST paths") describing the `security definer` wrapper pattern, or accept
  the limitation explicitly and document the review cadence for
  service-role-key usage.

---

## 5. Cosmetic Findings

- `idx_rr_events_*` uses abbreviated naming; other buffer indexes spell out
  `rights_request_events`.
- HMAC message format in `worker/src/hmac.ts:25` lacks an inline comment
  warning that there are no delimiters (matches the banner client and is
  intentional).
- Changelog references at the bottom of ADR-0004/0005/0006 point at
  changelog files that are present but contain only stubs.
- Missing partial index on `consent_artefact_index(expires_at)` for the sweep.
- Worker logs Supabase write failures via `console.error` only; no Sentry hook.

---

## 6. Areas That Passed Clean

Four compliance surfaces had no findings:

- **Dependency pinning** — all 11 root deps and worker tooling are exact-pinned
  on current stable majors (Next 16.2.3, React 19.2.5, Tailwind 4.2.2, TS 5.9.3,
  Vitest 4.1.4, Supabase JS 2.103.0, Sentry 10.48.0). Zero `^` or `~`.
- **Worker zero-dependency rule** — no `worker/package.json` with runtime
  dependencies; only `wrangler.toml` and `tsconfig.json` for tooling.
- **Client/server boundary** — no `NEXT_PUBLIC_` variables carry secrets; no
  client component imports a server module; `src/lib/supabase/browser.ts` uses
  only the anon key; `src/proxy.ts` uses the Node.js runtime per Next 16.
- **Sentry scrubbing** — both `sentry.client.config.ts` and
  `sentry.server.config.ts` implement `beforeSend` + `beforeBreadcrumb` hooks
  that strip headers, cookies, body, and query strings.
- **Authorship compliance** — zero `Co-Authored-By` lines in the git log, no
  "AI-assisted" / "AI-generated" / model-name authorship claims anywhere in the
  source tree.

---

## 7. Recommended Sequencing

Ordered by impact, not effort.

1. **B-1** — rotate `event_signing_secret` + remove from banner. (Same day.)
2. **B-3** — remove Turnstile always-pass fallback. (Same day.)
3. **B-4 + B-8** — design the scoped-role access pattern (ADR-0008) and
   migrate buffer-table writes off `service_role`.
4. **B-2** — add `origin_verified` to event/observation payloads and schema.
5. **B-6 + B-5** — harden deletion callback and Razorpay webhook state machines.
6. **B-9** — ship the ADR-0004 cleanup job.
7. **B-7** — buffer-table index migration.
8. **S-1 through S-13** — prioritise S-2 and S-10 (test-plan execution) next.

Every blocking item closed requires a corresponding update to the relevant ADR
(status back to Completed only with documented test results), the schema doc
(for B-2 and B-7), and the per-area changelog.

---

## 8. Outcome

Status: **Not ready for paid-customer cutover.** The system works for a
controlled pilot on the author's own properties, but B-1 and B-3 alone are
sufficient to reject a security review. B-4 is the largest structural item and
will shape a new ADR.

This review will be re-opened and re-dated after the blocking items are closed.
