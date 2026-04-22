# Changelog — Worker

Cloudflare Worker changes.

## [ADR-1010 Sprint 2.1 follow-up — Rule-5 runtime role guard] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration off HS256 JWT
**Sprint:** Phase 2 Sprint 2.1 follow-up (Rule-5 enforcement)

### Added
- `worker/src/role-guard.ts` — `assertWorkerKeyRole(env)`. Decodes the `SUPABASE_WORKER_KEY` JWT payload (no signature verification — that's Supabase's job) and throws `WorkerRoleGuardError` unless `role === 'cs_worker'`. Also rejects expired JWTs via the `exp` claim and refuses opaque `sb_secret_*` / `sb_publishable_*` keys. Zero npm deps (Rule 16) — base64url decode + `atob` + `JSON.parse` inline.
- `worker/src/index.ts` — calls the guard on every non-`/v1/health` request, cached per Worker instance. Health endpoint stays open so operators can probe a degraded Worker and see the reason. Guard failures return 503 `application/json` with `{"error":"worker_misconfigured","reason":"<diagnostic>"}` and `Cache-Control: no-store`.
- `worker/.dev.vars` — new `ALLOW_SERVICE_ROLE_LOCAL=1` line. Opt-in that lets the guard accept the service-role stand-in key the ADR-1014 Sprint 1.3 E2E test harness uses. The flag is strictly local: `wrangler dev` reads `.dev.vars`; `wrangler secret put` does not, so it can never reach production.
- `app/tests/worker/harness.ts` — Miniflare binding set extended with `ALLOW_SERVICE_ROLE_LOCAL: '1'` so the existing `banner.test.ts` / `blocked-ip.test.ts` / `events.test.ts` suites continue passing with their `mock-worker-key` stand-in.
- `app/tests/worker/role-guard.test.ts` — 13 unit tests: cs_worker JWT accept (no-exp / future-exp), past-exp reject, service_role / authenticated / no-role rejects, malformed-JWT reject, sb_secret_* reject-without-flag, sb_secret_* / sb_publishable_* / mock-junk accept-with-flag, missing-key reject (with and without flag).

### Behaviour
- Production wrangler deploy: any key that isn't a JWT claiming `role='cs_worker'` makes the Worker return 503 for every request. Operators see the diagnostic in the response body.
- Local wrangler dev: `.dev.vars` has the opt-in; any key is accepted.
- CI / Miniflare unit tests: harness binding has the opt-in; existing tests run unchanged.

### Tested
- [x] `bunx vitest run tests/worker/role-guard.test.ts` — 13/13 PASS.
- [x] `bunx vitest run tests/worker/` — 33/33 PASS across 4 files (no regression).
- [x] `bunx tsc --noEmit` from `worker/` — clean.

## [ADR-0048 Sprint 2.1] — 2026-04-18

**ADR:** ADR-0048 — Worker HMAC + Origin 403 logging

### Added
- `worker/src/worker-errors.ts` — `Worker403Reason` type union documenting the prefix discipline the Security tabs filter on (`hmac_*`, `origin_*`).

### Changed
- `worker/src/events.ts` + `worker/src/observations.ts` — every 403 site fires `ctx.waitUntil(logWorkerError(...))` with one of four categories: `hmac_timestamp_drift`, `hmac_signature_mismatch`, `origin_missing`, `origin_mismatch`. Eight total sites (4 × 2 endpoints). Errors swallowed inside `logWorkerError` — never DoSes customers.

### Deployed
- `bunx wrangler deploy` — version `db15f7ea`.

### Tested
- `app/tests/worker/events.test.ts` — wrong-secret case extended to assert `/worker_errors` REST write (category + status_code + endpoint). Full worker suite 20/20.

## [ADR-0033 Sprint 2.3] — 2026-04-17

**ADR:** ADR-0033 — Worker blocked-IP enforcement

### Added
- `worker/src/blocked-ip.ts` — `ipv4ToInt`, `isIpInCidr`, `isIpBlocked`, `getClientIp`, `ipBlockedResponse`. IPv4 CIDR; IPv6 tolerated-but-never-match. Fail-open on empty/malformed input. Zero npm deps.

### Changed
- `worker/src/admin-config.ts` — `AdminConfigSnapshot` gains `blocked_ips: string[]`. Defensive defaulting for older snapshots.
- `worker/src/index.ts` — `isIpBlocked` check before route dispatch on all paths except `/v1/health`.

### Deployed
- `bunx wrangler deploy` — version `0de173db`.

### Tested
- `app/tests/worker/blocked-ip.test.ts` — 6/6 PASS; full suite 20/20.

## ADR-0029 Sprint 4.1 — 2026-04-17

**ADR:** ADR-0029 — Admin Organisations
**Sprint:** Phase 4, Sprint 4.1 — per-org suspension

### Changed
- `worker/src/admin-config.ts` — `AdminConfigSnapshot` gains `suspended_org_ids: string[]`. New helper `isOrgSuspended(config, orgId)` does an O(n) scan (expected n < 20 in practice).
- `worker/src/banner.ts` — after the global `banner_delivery` kill switch check, also checks per-org suspension via `isOrgSuspended`. Both paths return the same no-op JS through a new `noopBannerResponse(reason)` helper. Suspension takes effect within one `admin-sync-config-to-kv` cron cycle (2 min).

### Deployed
- `bunx wrangler deploy` — `consentshield-cdn` Version ID `58b0e6e7-a159-4e58-bb75-4f1fa6adfa90`.

## ADR-0027 Sprint 3.2 — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 3, Sprint 3.2 — admin-config wiring

### Added
- `worker/src/admin-config.ts` — typed accessors over the `admin:config:v1` snapshot written every 2 minutes by `sync-admin-config-to-kv` Edge Function. Exports `getAdminConfig(env)`, `isKillSwitchEngaged(config, switchKey)`, `toLegacySignatures(adminSignatures)`. Graceful degradation — when the KV key is missing (pre-bootstrap, sync down, dev env without CF creds), returns `EMPTY_SNAPSHOT` so all kill switches read disengaged and tracker signatures fall through to the legacy path.

### Changed
- `worker/src/banner.ts` — adds `banner_delivery` kill-switch check as the first step in `handleBannerScript`. When engaged, returns a minimal valid-JS no-op (`// ConsentShield: banner delivery paused by operator`) with 30-second Cache-Control. Customer sites embed the `<script src="...">` tag exactly as before; the kill switch takes effect inside one minute (CDN cache ceiling) without touching customer HTML.
- `worker/src/signatures.ts` — `getTrackerSignatures(env)` now reads admin-synced catalogue first (via `getAdminConfig` + `toLegacySignatures`). Falls back to the existing `public.tracker_signatures` + KV cache path when the admin catalogue is empty. "Operator deprecates every signature" => worker still monitors via seed defaults rather than going blind.

### Rule compliance
- Zero new npm dependencies in the Worker (Rule 15).
- `admin-config.ts` depends only on the existing `KVNamespace` type from `@cloudflare/workers-types` (already a devDep).

## Review fix-batch — 2026-04-16

**Source:** `docs/reviews/2026-04-16-phase2-completion-review.md` (N-S1)

### Added
- `worker/src/worker-errors.ts` — `logWorkerError(env, record)`
  helper. Best-effort POST to `/rest/v1/worker_errors` via the
  existing `cs_worker` REST credential; caps `upstream_error` text
  at 1000 chars. Zero new dependencies (rule #15).

### Changed
- `worker/src/events.ts` — when the consent_events INSERT returns
  non-2xx, the upstream error is now also persisted to
  `worker_errors` via `ctx.waitUntil(logWorkerError(...))`. Customer
  page response remains 202; latency unchanged.
- `worker/src/observations.ts` — same change for the
  tracker_observations INSERT path.

### Tested
- `tests/worker/harness.ts` gains a mock for `POST
  /rest/v1/worker_errors` so any future failure-path test won't
  receive a 404 from the in-memory mock router.
- [x] `bun run test` — 86/86 still passing (the existing tests all
  exercise the success path, so the new fallback doesn't fire).

**Deploy:** requires `bunx wrangler deploy` from `worker/` (not
applied automatically by `db push`).

## ADR-0012 Sprint 2 — 2026-04-16

**ADR:** ADR-0012 — Automated Test Suites for High-Risk Paths
**Sprint:** Phase 1, Sprint 2

### Added
- `miniflare@4.20260415.0` + `esbuild@0.28.0` (devDependencies,
  exact-pinned). Worker test harness now bundles `worker/src/index.ts`
  via esbuild once per suite run and boots it inside Miniflare, with
  all outbound Supabase fetches intercepted by an in-memory mock.
- `tests/worker/harness.ts` — Miniflare factory + mock Supabase
  router + HMAC helper.
- `tests/worker/events.test.ts` — 10 tests for `POST /v1/events`
  (HMAC valid / wrong-secret / timestamp-drift / previous-secret
  grace; origin valid / rejected / empty-allowed / missing; unknown
  property 404; missing-fields 400).
- `tests/worker/banner.test.ts` — 4 tests for `GET /v1/banner.js`
  (headers, no-secret ADR-0008 invariant, config-embedding, 404 + 400
  paths).
- `tsconfig.json` excludes `tests/worker` — miniflare's
  Cloudflare-flavoured `RequestInit` doesn't round-trip with the
  DOM-flavoured `RequestInit` that Next's type-check uses. Vitest
  transform is unaffected.

### Tested
- [x] `bun run test` — 55 → 69 PASS (+14 worker tests)
- [x] `bun run lint` + `bun run build` — clean

## ADR-0008 Sprint 1.1 — 2026-04-14

**ADR:** ADR-0008 — Browser Auth Hardening
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `worker/src/banner.ts` — removed `signingSecret` from `CompileArgs` and
  compiled config. Removed the `hmac()` helper and all call sites from the
  emitted script. `postEvent` and `postObservation` no longer attach
  `signature` / `timestamp`.
- `worker/src/events.ts`, `worker/src/observations.ts` — HMAC verification is
  now optional. When `signature` + `timestamp` are present, HMAC is verified
  against `event_signing_secret` as before. When absent, a valid origin is
  required. Both handlers persist `origin_verified` (`'origin-only'` or
  `'hmac-verified'`).
- `worker/src/origin.ts` — empty `allowed_origins` now returns `rejected`
  instead of silently admitting all origins.

### Tested
- [x] `bunx tsc --noEmit` — PASS
- [x] Live deploy `wrangler deploy` via `CLOUDFLARE_API_TOKEN`. Version ID
  `9fb7bd37-20cf-4589-985c-9c8512ce9e9f`.
- [x] Smoke test on `cdn.consentshield.in`:
  - `GET /v1/banner.js` — 200, no `"secret"` substring in the compiled
    script.
  - `POST /v1/events` without `Origin` header → 403 `"Origin required for
    unsigned events"`.
  - `POST /v1/events` with allowed origin + valid banner_id → 202 and
    `consent_events.origin_verified = 'origin-only'` persisted.
