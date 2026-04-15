# Deferred Items — Analysis

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Date:** 2026-04-15
**Scope:** four should-fix items deferred from the 2026-04-14 review
(S-1, S-2, S-5, S-11). This document decides which to address now, which
to schedule into a named ADR, and which to drop or merge.

---

## S-1 — Distributed rate limiter

### Current state

`src/lib/rights/rate-limit.ts` uses a module-scoped `Map<string, {count,
resetAt}>`. Vercel's Node runtime runs each serverless instance in its own
isolated process. When Vercel scales to N instances, each keeps its own
bucket.

### Threat

An attacker sending 5 requests per second from one IP gets rate-limited
per instance; across 10 instances that becomes 50 req/s to the rights
portal. Turnstile still runs on the outer request, so the practical
impact is "Turnstile gets more challenges" rather than "buffer table
floods with rows". The RPC writes also have a narrow attack surface —
`rpc_rights_request_create` requires a valid `org_id` and does the OTP
mint + DB insert in one transaction.

### Options

1. **Vercel KV (Upstash Redis under the hood).** Accepts exact pinning,
   one dependency (`@vercel/kv`). ~40 LoC change. Costs $0 at low volume.
2. **Cloudflare Worker edge rate limiter.** Move the public rights-portal
   POST through the Worker. Adds a Worker route and some complexity; no
   new npm dep (rule #15 preserved).
3. **Postgres-backed limiter.** A single table + `upsert` per request.
   Adds two DB round-trips per POST; unattractive.
4. **Do nothing and rely on Turnstile + OTP + per-org daily volume caps.**

### Recommendation

**Option 1 (Vercel KV)** in a dedicated mini-ADR (ADR-0010) once we pick
up the rights portal work again. The dependency cost is trivial and the
code already lives in one module. Option 2 is structurally cleaner but
requires moving auth, email dispatch, and Turnstile verification into the
Worker — out of proportion to the risk.

**Status:** deferred to ADR-0010 (one sprint, ~2 h). No immediate action.

---

## S-2 — JWT `org_id` defense in depth on read routes

### Current state

Every **mutating** authenticated path now runs through a security-definer
RPC that checks `auth.uid()` against `organisation_members` (ADR-0009).
Read routes under `src/app/api/orgs/[orgId]/**` still rely on RLS alone:
they call `supabase.from('<table>').select().eq('org_id', orgId)` with the
user's JWT, and RLS policies filter by `current_org_id()`.

### Threat

If RLS is ever misconfigured or the `current_org_id()` helper is broken,
a signed-in user could pass another org's `orgId` in the URL and read
cross-org rows. Current RLS is test-covered (39/39) but the tests run
against seeded RLS policies — they do not exercise the URL-param path.

### Options

1. **Middleware helper that rejects URL `orgId ≠ JWT.org_id`.** Centralise
   in `src/lib/auth/require-org-member.ts`; wrap each authenticated route.
2. **Do nothing.** RLS is canonical; a helper duplicates the check.
3. **Add 3–5 new RLS tests** that go through the URL path (call the HTTP
   handler directly with a cross-org `orgId` and assert 404/empty).

### Recommendation

**Option 3 is the right move.** A helper (option 1) would protect against
a hypothetical RLS failure but adds call-site boilerplate; an RLS failure
is a P0 incident we would notice immediately via user reports. Tests are
cheaper, catch regressions in the tighter path, and keep the "RLS is
canonical" story clean.

**Status:** fold into S-11 (new test suites). Track as a specific
`tests/rls/url-path.test.ts` file.

---

## S-5 — Deletion retry / timeout scheduler

### Current state

`src/lib/rights/deletion-dispatch.ts` sets
`deletion_receipts.status = 'awaiting_callback'` after a successful POST
to the customer's webhook. Nothing sweeps those rows. If the callback
never lands, the receipt stays `'awaiting_callback'` forever.

### Threat

A customer with a broken webhook endpoint has deletions that appear
dispatched but are actually lost. The SLA timer
(`rights_requests.sla_deadline`) keeps ticking; at the 30-day mark the
request would be overdue with no diagnostic visibility.

### Options

1. **New Edge Function `check-stuck-deletions`** scheduled hourly via
   pg_cron: find `deletion_receipts.status = 'awaiting_callback' AND
   requested_at < now() - interval '24 hours'`. Retry the webhook up to
   3 times with exponential backoff; on final failure mark
   `status = 'failed'` and emit `deletion_retry_exhausted` to `audit_log`
   for dashboard surfacing.
2. **Synchronous retry inside the Node dispatch path.** Blocks the admin
   UI on a slow customer webhook — unacceptable.
3. **Dashboard-only surfacing** without retry: add a widget listing
   stuck receipts. Human must click "retry". Simple; does not close the
   long-tail silent-failure case.

### Recommendation

**Option 1, scoped as ADR-0011.** One Deno Edge Function (~120 LoC),
one new cron entry. Depends on the generic deletion webhook protocol
already live in ADR-0007. Estimated one sprint.

Additional follow-up: `deletion_receipts.next_retry_at` column + index
so the Edge Function query is bounded.

**Status:** scheduled as ADR-0011. Not in scope for the current review
closure.

---

## S-11 — New automated test suites

### Current state

Only `tests/rls/isolation.test.ts` is automated (39 tests). Testing
strategy (`docs/architecture/consentshield-testing-strategy.md`) defines
four additional tiers that exist only as manual checklists:

| Tier | Target | Current |
|------|--------|---------|
| Priority 2 | Buffer pipeline (delivery → delivered_at → sweep) | manual |
| Priority 4 | Worker endpoint (HMAC / origin / payload shape) | manual |
| Priority 5 | Workflow (SLA timer, breach deadline arithmetic) | manual |
| Priority 6 | Deletion orchestration (connector + callback) | manual |

The Worker has zero automated tests — typecheck + deploy-and-curl only.

### Threat

Regressions in any of these tiers only surface on a live flow that a
human exercises. Given the scope of ADR-0008 and ADR-0009 edits landing
in the last 24 hours, the probability of a regression is non-trivial.

### Options

1. **Port the testing-strategy manual checklists to Vitest, one tier at
   a time**, sharing the same Supabase test harness as the RLS suite.
2. **Add a Worker test harness** using Miniflare (zero npm runtime deps,
   but requires `miniflare` as a devDep) and run Worker tests in CI.
3. **Write E2E tests via Playwright** against the deployed dev
   environment. High value, high maintenance.

### Recommendation

Scope as its own ADR (ADR-0012) with three phases matching tiers 2/4/5.
Prioritise **tier 5 (SLA timer arithmetic)** first — it is one SQL
expression and a property-based test catches off-by-one errors instantly.
Then tier 4 (Worker) via Miniflare. Tier 2 (buffer pipeline) needs real
Supabase; lowest priority.

Fold the S-2 URL-path RLS test in as `tests/rls/url-path.test.ts` inside
Sprint 1 of ADR-0012.

**Status:** scheduled as ADR-0012 (three sprints). Start with SLA-timer
property tests when convenient.

---

## Proposed roadmap

| ADR | Title | Effort | Depends on |
|-----|-------|--------|------------|
| ADR-0010 | Distributed rate limiter on Vercel KV | 1 sprint | — |
| ADR-0011 | Deletion retry / timeout Edge Function | 1 sprint | ADR-0007 |
| ADR-0012 | Test suites for worker, buffer pipeline, workflows | 3 sprints | — |

All three can be picked up independently. ADR-0012 Sprint 1 (SLA-timer
property tests + S-2 URL-path RLS test) is the smallest surface and the
highest value-per-hour; good candidate for the next session.

The four remediation commits from 2026-04-14 plus the deploy commit from
2026-04-15 close the ninth blocking item cleanly. This review is retired
with outstanding items fully scoped into future ADRs.
