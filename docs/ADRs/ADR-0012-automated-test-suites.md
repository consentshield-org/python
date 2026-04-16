# ADR-0012: Automated Test Suites for High-Risk Paths

**Status:** Completed
**Date proposed:** 2026-04-16
**Date completed:** 2026-04-16
**Superseded by:** —

---

## Context

The RLS isolation suite (`tests/rls/isolation.test.ts`, 39 tests) is
the only automated check that runs on every build. Three classes of
regression have no coverage today:

1. **SLA / breach deadlines.** `set_rights_request_sla` trigger computes
   `new.sla_deadline = new.created_at + interval '30 days'`; the SLA-reminder
   Edge Function buckets requests into 7-day / 1-day / overdue windows by
   date arithmetic. An off-by-one in either place silently mis-reports
   every rights request. No test catches this.
2. **URL-path tenant crossing.** The authenticated API routes under
   `/api/orgs/[orgId]/...` extract `orgId` from the URL and issue
   `.eq('org_id', orgId)`. RLS also filters by `current_org_id()` from
   the JWT. Both predicates must hold, so cross-org manipulation is
   impossible today — but no test asserts the invariant, so a future
   policy edit could loosen it without anyone noticing.
3. **Worker + buffer pipeline end-to-end.** The Worker's HMAC/origin
   validation and the delivery Edge Function's mark-delivered-then-delete
   flow have no integration tests. (Scope for a later sprint —
   Miniflare + a delivery-pipeline scenario suite.)

Finding **S-11** from the 2026-04-14 codebase review flagged the
missing tests. Finding **S-2** (URL-path cross-org test) was folded
into this ADR during the 2026-04-15 triage.

## Decision

Add a phased test-coverage ADR. Each sprint lands a self-contained
test file under `tests/` and runs on every build via `bun run test`.

- **Phase 1 Sprint 1:** SLA-timer + URL-path RLS. No new dependencies.
  Uses the existing test helpers (`tests/rls/helpers.ts`) and runs
  against the live dev Supabase.
- **Phase 1 Sprint 2 (deferred):** Worker Miniflare tests. Installs
  `miniflare` dev-only and stands up a test harness for HMAC, origin
  validation, and fail-fast Turnstile.
- **Phase 1 Sprint 3 (deferred):** Buffer-pipeline integration. Seeds
  consent_events, invokes `deliver-consent-events`, asserts
  mark-delivered + delete atomicity.

## Consequences

- Slightly longer CI: +15–20 s per added test file (live Supabase
  round trips).
- Tests hit the dev DB. Each suite uses `createTestOrg` / `cleanupTestOrg`
  so no shared state lingers.
- Property-style coverage for date arithmetic is hand-rolled — no
  `fast-check` dep (rule #14).

---

## Implementation Plan

### Phase 1 Sprint 1: SLA-timer + URL-path RLS

**Estimated effort:** ~3 h
**Deliverables:**
- [x] `tests/workflows/sla-timer.test.ts` — exercises the `set_rights_request_sla` Postgres trigger across boundary dates (normal, year-crossing, leap-year Feb, non-leap Feb, IST-anchored offset), plus a property sweep over random dates in `[2026, 2030]`.
- [x] `tests/rls/url-path.test.ts` — authenticated Org A client issues cross-org SELECT and UPDATE targeting Org B rights_requests; both must return zero rows. Covers the S-2 finding.
- [x] ADR-0012, ADR-index, `CHANGELOG-schema.md`, `STATUS.md` updated.

**Testing plan:**
- [x] `bun run test` — suite grows from 43 to ≥ 55, all green.
- [x] `bun run lint` — clean.
- [x] `bun run build` — clean.

**Status:** `[x] complete`

### Phase 1 Sprint 2: Worker Miniflare tests

**Estimated effort:** ~6 h
**Deliverables:**
- [x] `miniflare@4.20260415.0` + `esbuild@0.28.0` added to devDependencies, exact-pinned.
- [x] `tests/worker/harness.ts`: shared Miniflare factory that bundles the Worker with esbuild (once per suite run), stands up a KV namespace, and intercepts all outbound fetches via `outboundService` — returns in-memory mock responses for `/rest/v1/web_properties`, `/rest/v1/consent_banners`, `/rest/v1/tracker_signatures`, `/rest/v1/consent_events`, and `/rest/v1/tracker_observations`. Exposes `signHmac` so tests build signatures with the same contract as the Worker.
- [x] `tests/worker/events.test.ts` — 10 tests covering `POST /v1/events`: HMAC happy path, wrong-secret rejection, ±5-minute timestamp drift rejection, previous-secret grace window via KV, origin happy path with `origin_verified='origin-only'` persisted, cross-origin rejection, empty `allowed_origins` rejection, unsigned + missing-Origin rejection, unknown property 404, missing-fields 400.
- [x] `tests/worker/banner.test.ts` — 4 tests covering `GET /v1/banner.js`: Content-Type + Cache-Control headers, absence of the signing secret or any `"secret"` field in the compiled output (ADR-0008 invariant), correct org/property/banner/version embedding, 404 + 400 paths.
- [x] `tsconfig.json` excludes `tests/worker` from the Next.js type-check — miniflare's Cloudflare-flavoured `RequestInit` conflicts with DOM's. Vitest still type-strips and runs the tests through its own transform pipeline.

**Testing plan:**
- [x] `bun run test` — 55 → 69 (+14), all green.
- [x] `bun run build` + `bun run lint` — clean.

**Status:** `[x] complete`

### Phase 1 Sprint 3: Buffer-pipeline integration

**Estimated effort:** ~6 h
**Deliverables:**
- [x] `tests/buffer/delivery.test.ts` — 6 tests exercising the three lifecycle functions (`sweep_delivered_buffers`, `detect_stuck_buffers`, `mark_delivered_and_delete`) against `audit_log` as the representative buffer table. Tests seed rows via service role and assert: sweep removes delivered rows > 5 min old; sweep leaves < 5 min + undelivered; stuck detection reports old undelivered; stuck detection ignores fresh rows (delta-based to handle pre-existing data); mark+delete atomics.
- [x] `tests/buffer/lifecycle.test.ts` — 6 tests confirming the authenticated role's REVOKE from migration 011: UPDATE + DELETE on `audit_log` and `processing_log` both fail with "permission denied"; INSERT on `consent_events` and `tracker_observations` also fails.

**Testing plan:**
- [x] `bun run test` — 69 → 81 (+12), all green.
- [x] `bun run lint` + `bun run build` — clean.

**Status:** `[x] complete`

---

## Architecture Changes

No architecture doc changes. The trigger and the Edge Function are
unchanged; this ADR adds coverage only.

---

## Test Results

### Phase 1 Sprint 1 — 2026-04-16

```
Test: SLA-timer trigger — 6 boundary cases + 20-date property sweep
Method: Insert rights_request rows with controlled created_at; read back sla_deadline; compare epoch milliseconds
Expected: sla_deadline = created_at + 30 calendar days, every case
Actual: all 7 tests pass; zero mismatches in the 20-date sweep across 2026–2030
Result: PASS
```

```
Test: URL-path RLS (S-2) — 5 cases
Method: Signed-in Org A client issues SELECT, UPDATE, and UPDATE-without-org-predicate targeting Org B's rights_request; admin re-reads Org B row
Expected: zero rows returned / affected; Org B row unchanged
Actual: all 5 tests pass; Org B row still status='new', closure_notes=null
Result: PASS
```

```
Test: Full suite + build + lint
Method: bun run test && bun run lint && bun run build
Expected: 43 → 55 tests (+ 4 files → 4 files, +2 files), zero lint output, clean build
Actual: 55 / 55 PASS; lint clean; 25 routes build clean
Result: PASS
```

---

## Changelog References

- CHANGELOG-schema.md — 2026-04-16 — ADR-0012 Sprint 1 (schema-trigger coverage)
