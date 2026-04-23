# Changelog — Worker

Cloudflare Worker changes.

## [ADR-1010 Phase 3 Sprint 3.2 + Phase 4 — write paths + cutover] — 2026-04-23

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration **(COMPLETED)**
**Sprint:** Phase 3 Sprint 3.2 (write paths) + Phase 4 (cutover)

### Changed
- `worker/src/events.ts` — `insertConsentEventSql` (postgres.js + `sql.json()` for jsonb purposes_*); REST fallback retained behind `hasHyperdrive(env)` for the Miniflare harness.
- `worker/src/observations.ts` — `insertObservationSql` for tracker_observations (jsonb consent_state / trackers_detected / violations via `sql.json()`).
- `worker/src/worker-errors.ts` — `logWorkerError` dual-path; best-effort outer try/catch preserved.

### Removed
- `worker/src/role-guard.ts` — Sprint 2.1's runtime safety net policing the now-deleted `SUPABASE_WORKER_KEY`. Gone.
- `worker/src/prototypes/` — entire directory (probe-rest, probe-hyperdrive, probe-raw-tcp, types, README). Was the Sprint 1.1 mechanism-comparison scratchpad.
- `/v1/_cs_api_probe` route + handler in `worker/src/index.ts`.
- `Env.SUPABASE_WORKER_KEY` is now optional (`?: string`) — production no longer sets it.
- `Env.ALLOW_SERVICE_ROLE_LOCAL` removed (only meaningful with the role guard).
- `app/tests/worker/role-guard.test.ts` (13 tests) and `app/tests/worker/probe-route.test.ts` (6 tests). Miniflare suite count 39 → 20.

### Operator action
- `wrangler secret delete SUPABASE_WORKER_KEY` — done. Production Worker no longer carries the legacy HS256 JWT.

### Bug fixed during Sprint 3.2
- `${JSON.stringify(value)}::jsonb` was storing the JSON-encoded *string* as a jsonb scalar string instead of the parsed object (`"{\"a\":true}"` rather than `{a: true}`). The correct postgres.js pattern is `${sql.json(value)}` which sets the jsonb OID directly. Fixed at every jsonb call site.

### Tested
- [x] `tests/integration/worker-hyperdrive-writes.test.ts` — 4/4 PASS: jsonb purposes; jsonb consent_state/trackers/violations; worker_errors INSERT; RETURNING denied 42501 (cs_worker INSERT-only column grants).
- [x] `app/tests/worker/` — 20/20 PASS unchanged (REST fallback exercised via Miniflare mock-server).
- [x] `bunx tsc --noEmit` worker/ — clean.
- [x] Live smoke against deployed worker (`https://consentshield-cdn.a-d-sudhindra.workers.dev/v1/banner.js?org=...&prop=...`) — 5/5 HTTP=200, cold 2.9s, warm 60-100ms. Worker version `3db2f123-725f-431f-b964-5280b9172bdc`.

### Known follow-ups (tracked on `admin.ops_readiness_flags`)
- Sprint 4.2 — share request-scoped postgres.js client + `ctx.waitUntil(sql.end())` cleanup (currently each call site opens its own client and closes in `finally`; works but churns the Hyperdrive pool, particularly visible in the 2.9s cold-start figure).
- Sprint 4.3 — strip the REST fallback once Miniflare tests are migrated to a Hyperdrive mock or to integration tests against dev Supabase.

## [ADR-1010 Phase 3 Sprint 3.1 — Worker read paths on Hyperdrive] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration
**Sprint:** Phase 3 Sprint 3.1 (read paths)

### Added
- `worker/package.json` — `postgres@3.4.9` exact-pinned. Single-dep carve-out under the amended CLAUDE.md Rule 16. Worker bundle grows ~90 KiB uncompressed / ~22 KiB gzipped (deployed: 126.55 KiB / 32.67 KiB gzip).
- `worker/src/db.ts` — `getDb(env)` + `hasHyperdrive(env)`. postgres.js client over `env.HYPERDRIVE.connectionString`; per-request lifecycle; `prepare: false` + short connect/idle timeouts so a degraded pool fails loudly.
- `worker/wrangler.toml` — `compatibility_flags = ["nodejs_compat"]` (postgres.js's workerd build imports `node:stream` / `node:events` / `node:buffer`).

### Changed
- `worker/src/origin.ts` — `getPropertyConfig` now dual-path: Hyperdrive SQL when `env.HYPERDRIVE` is bound, REST fallback otherwise. KV cache logic shared.
- `worker/src/signatures.ts` — `getTrackerSignatures` dual-path.
- `worker/src/banner.ts` — `getBannerConfig` dual-path. The fire-and-forget `snippet_last_seen_at` UPDATE moved into an `updateSnippetLastSeen` helper with the same dual-path shape.
- `worker/src/index.ts` — `Env` extended with optional `HYPERDRIVE: HyperdriveBinding` so call sites can branch.
- `worker/src/prototypes/probe-hyperdrive.ts` — refactored to use the canonical `Env.HYPERDRIVE` typing instead of its local cast.
- `app/tests/worker/harness.ts` — esbuild `conditions: ['workerd', 'worker', 'browser']` + `external: ['node:*']`; Miniflare `compatibilityFlags: ['nodejs_compat']`. Needed for postgres.js's imports to resolve even though the SQL path never runs in-harness.

### Tested
- [x] `tests/integration/worker-hyperdrive-reads.test.ts` — 5/5 PASS. Exercises the exact SQL the Worker issues, against real cs_worker credentials through postgres.js.
- [x] `app/tests/worker/` — 39/39 PASS. Existing Miniflare suites unchanged; they run the REST fallback branch because `env.HYPERDRIVE` isn't bound.
- [x] `bunx tsc --noEmit` (worker/) — clean.
- [x] `bunx wrangler deploy` — version `19896a12-57ca-4db6-8212-9e0bb1391ebe`. Bindings confirmed: BANNER_KV + HYPERDRIVE + SUPABASE_URL.
- Production live smoke test deferred — the existing role guard still rejects the `sb_secret_*` key in the dev Worker's secrets; Hyperdrive code path is proven via integration test instead. End-to-end live test lands when Sprint 3.2 retires the key entirely.

## [ADR-1010 Phase 1 Sprint 1.2 — Hyperdrive binding + mechanism decision] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration
**Sprint:** Phase 1 Sprint 1.2

### Added
- `worker/wrangler.toml` — new `[[hyperdrive]]` binding (binding `HYPERDRIVE`, id `00926f5243a849f08af2cf01d32adbee`) for the provisioned `cs-worker-hyperdrive` Cloudflare Hyperdrive config. `env.HYPERDRIVE.connectionString` is populated at runtime; Phase 3 Sprint 3.1 swaps REST call sites to it.

### Changed
- `worker/src/index.ts` — role-guard exemption extended from just `/v1/health` to also cover `/v1/_cs_api_probe`. The probe's purpose is to evaluate mechanisms that replace the HS256 key the guard polices; gating the probe on the old key makes the probe unreachable. Exemption disappears when the probe route is removed at Phase 1 close.

### Tested
- [x] `bunx wrangler deploy` — version `3ccd116c-5d4e-4ab5-9b7a-1df5be7b838a` confirms all three bindings (BANNER_KV, HYPERDRIVE, SUPABASE_URL).
- [x] `curl /v1/_cs_api_probe?via=all` from the deployed Worker — REST ok (p50 274ms, real round trip), Hyperdrive ok (binding_present p50 44ms, reachability only), raw_tcp scaffold-only. Results recorded in ADR-1010 Sprint 1.2.
- [x] Migration `20260804000027_resolve_adr1010_s12_flag.sql` flips the `admin.ops_readiness_flags` Hyperdrive provisioning row to `resolved`.

## [ADR-1010 Phase 1 Sprint 1.1 — cs_worker migration prototype scaffold] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration off HS256 JWT
**Sprint:** Phase 1 Sprint 1.1 — Prototype all three mechanisms

### Added
- `worker/src/prototypes/probe-rest.ts` — Mechanism B (REST baseline). Uses the current `SUPABASE_WORKER_KEY` bearer against `tracker_signatures?select=service_slug&limit=1`. Reports 2xx latency + maps 401 to `note: 'hs256_revoked_or_expired'` so the probe flips the instant Supabase kills the legacy signing secret.
- `worker/src/prototypes/probe-hyperdrive.ts` — Mechanism A scaffold. Reads `env.HYPERDRIVE?.connectionString`; structured-skip (`hyperdrive_binding_not_configured`) until the operator provisions a Hyperdrive instance in the Cloudflare dashboard + adds the `[[hyperdrive]]` binding to `wrangler.toml`. Becomes `ok: true, note: 'binding_present'` after provisioning — next step is Phase 3 Sprint 3.1 REST-call rewrite.
- `worker/src/prototypes/probe-raw-tcp.ts` — Mechanism C scaffold. File header enumerates the 6 wire-protocol steps (TLS upgrade, StartupMessage, SCRAM-SHA-256, SimpleQuery, response parse); body returns `scaffold_only` until/unless A is rejected.
- `worker/src/prototypes/types.ts` — shared `ProbeMechanism` + `ProbeResult` envelope.
- `worker/src/prototypes/README.md` — decision matrix (correctness / latency / bundle size / operational surface), Cloudflare-dashboard runbook for Hyperdrive provisioning, "where this lands" note confirming the scaffold is self-contained and removable on Phase 1 close.
- `worker/src/index.ts` — route `/v1/_cs_api_probe?via=rest|hyperdrive|raw_tcp|all` dispatching to the three probes; unknown `via` → 400 with allowed list; all other pathways go through the existing role guard.
- `app/tests/worker/probe-route.test.ts` — 6 tests covering via=all / via=rest / via=hyperdrive / via=raw_tcp / via=invalid / role-guard coverage.

### Tested
- [x] `bunx vitest run tests/worker/` — 39/39 PASS (33 prior + 6 new) — PASS
- [x] `bunx tsc --noEmit` (worker) — 0 errors — PASS
- [x] Zero new npm dependencies in the Worker (CLAUDE.md Rule 16) — verified by inspection: all three probes use only `fetch` + `env.*` bindings + optional `cloudflare:sockets` (referenced via `typeof` in scaffold, never imported).

### Deferred
- Latency comparison (p50 × 10 runs on the Cloudflare edge) — requires operator to provision Hyperdrive first; tracked on `admin.ops_readiness_flags` via migration `20260804000018_ops_readiness_hyperdrive.sql`.
- Mechanism decision amendment at the top of ADR-1010 — lands once the Hyperdrive binding returns `ok: true` in production.

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
