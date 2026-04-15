# Changelog — Worker

Cloudflare Worker changes.

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
