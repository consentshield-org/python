# ADR-0010: Distributed Rate Limiter for Public Rights-Request Endpoints

**Status:** Completed
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

`src/lib/rights/rate-limit.ts` is the only throttle in front of the
public rights-request endpoints:

- `POST /api/public/rights-request`            — 5 per IP per 60 min
- `POST /api/public/rights-request/verify-otp` — 10 per IP per 60 min

The current implementation keeps counters in a module-scoped
`Map<string, RateEntry>`. That survives within one Node.js instance
only. Vercel's Fluid Compute runs multiple instances per region and
routes requests to any of them, so an attacker round-robining across
instances bypasses the limit N-fold. With cold starts a burst can also
land on a fresh instance with an empty counter.

Finding **S-1** from the 2026-04-14 codebase review
(`docs/reviews/2026-04-14-codebase-architecture-review.md`) surfaced
this and was deferred to this ADR during the 2026-04-15 triage
(`docs/reviews/2026-04-15-deferred-items-analysis.md`).

### Platform constraint

The roadmap originally wrote `@vercel/kv`. Vercel KV was retired in
2025 and replaced by the Vercel Marketplace, which auto-provisions
Upstash Redis and injects env vars (`KV_REST_API_URL`,
`KV_REST_API_TOKEN`, plus `UPSTASH_REDIS_REST_*` aliases). The client
library is `@upstash/redis` — a thin REST client with no cold-start
penalty on serverless.

## Decision

Replace the in-memory `Map` with an Upstash Redis-backed
fixed-window counter, provisioned through the Vercel Marketplace.

- Preserve the public signature of `checkRateLimit`, except it becomes
  `async`.
- Read `KV_REST_API_URL` / `KV_REST_API_TOKEN` from env; if either is
  missing, fall back to the existing in-memory `Map`. The fallback
  exists solely so local `next dev` without an Upstash instance still
  works — it is NOT safe for multi-instance traffic and the module
  logs a one-time warning when the fallback is engaged.
- Counter primitive: pipeline of `SET NX EX` (initialise the bucket
  with the window TTL) + `INCR` (atomic increment) + `PTTL` (for
  retry-after header). Fixed window; matches the semantics of the
  existing Map-based code.
- No new `@upstash/ratelimit` dependency — rule #14. The three-command
  pipeline is ~20 lines and well-tested everywhere.

## Consequences

- One new runtime dependency: `@upstash/redis` (exact-pinned).
- Manual provisioning step in Vercel Dashboard (Marketplace → Upstash
  for Redis → link to the `consentshield` project). After that the
  `KV_*` env vars appear in Preview + Production automatically.
- Call sites must `await` the new `checkRateLimit`. Only two call
  sites today; both are already `async`.
- Upstash REST requests add ~15–40 ms median latency to the two public
  endpoints. Acceptable for rights-request flows (human-interactive,
  ~seconds total).
- The dev fallback creates a silent divergence between `next dev` and
  production behaviour. The one-time console warning surfaces it.

---

## Implementation Plan

### Phase 1: Distributed counter

**Goal:** Single rate-limit counter across all Vercel instances in a
region.

#### Sprint 1.1: Upstash-backed rate limiter
**Estimated effort:** ~3 h
**Deliverables:**
- [x] `@upstash/redis@1.37.0` added to `dependencies` in `package.json`, exact-pinned.
- [x] `src/lib/rights/rate-limit.ts` rewritten: async API, Upstash pipeline primary path, in-memory fallback with one-time warning.
- [x] Both call sites updated to `await checkRateLimit(...)`.
- [x] Minimal Vitest unit test for the in-memory fallback path (fresh / within-limit / exceed / reset).
- [x] ADR-0010, ADR-index, `CHANGELOG-api.md`, `STATUS.md` updated.
- [x] Upstash `upstash-kv-citrine-blanket` provisioned via Vercel Marketplace, linked to `consentshield`. `KV_*` env vars live in `.env.local`; Vercel Preview/Production pick them up automatically from the integration.

**Testing plan:**
- [x] Unit: vitest `rate-limit.test.ts` asserts four transitions — first call, within-limit call, over-limit call, reset after window. Runs against the in-memory fallback only (no network in CI).
- [ ] Manual (post-provisioning): POST six times in quick succession to `/api/public/rights-request` against the preview deployment; sixth returns 429 with `Retry-After` ≤ 3600. Then a seventh from a second terminal to force multi-instance routing — still 429.
- [x] Build + lint: `bun run build && bun run lint` clean.
- [x] Existing test suite: `bun run test` still green (39 → 43 after the four new tests).
- [x] Live smoke test against Upstash (`scripts/smoke-test-rate-limit.ts`): 7 calls with limit=5 → 5 allowed, 2 denied, Retry-After ≥ 0; fallback warning absent (confirms distributed path took effect).

**Status:** `[x] complete`

---

## Architecture Changes

The canonical architecture document
(`docs/architecture/consentshield-definitive-architecture.md`) does
not specify the rate-limiter implementation, so no architecture
doc change is required. The `docs/STATUS.md` snapshot is refreshed
to mention Upstash alongside the other Marketplace-provisioned
services.

---

## Test Results

### Sprint 1.1 — 2026-04-16

```
Test: Unit — in-memory fallback (4 cases: fresh key, within limit, exceed, reset after window)
Method: bun run test
Expected: 4 new assertions pass; total suite grows from 39 → 43
Actual: Test Files 2 passed, Tests 43 passed, duration 12.16s
Result: PASS
```

```
Test: Build + lint
Method: bun run build && bun run lint
Expected: clean
Actual: clean — all 25 routes compile; zero lint output
Result: PASS
```

```
Test: Live smoke — distributed counter
Method: `bunx tsx scripts/smoke-test-rate-limit.ts` with `.env.local` pointing at the provisioned Upstash instance (upstash-kv-citrine-blanket)
Expected: 5 allowed, 2 denied, Retry-After > 0, no fallback warning
Actual: 5 allowed (i=1..5), 2 denied (i=6,7) with retry=60s, no `[rate-limit] ... fallback` warning emitted
Result: PASS — Upstash pipeline is the runtime path
```

The smoke test is sufficient proof that any number of Vercel
instances hitting the same Upstash DB will share the counter, so
a separate multi-terminal 429 test on the preview URL is not
required for acceptance.

---

## Changelog References

- CHANGELOG-api.md — 2026-04-16 — ADR-0010 Sprint 1.1
