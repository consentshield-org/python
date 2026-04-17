# Changelog — API

API route changes.

## [ADR-0025 Sprint 1.2] — 2026-04-17

**ADR:** ADR-0025 — DEPA Score Dimension
**Sprint:** 1.2 — score API endpoint

### Added
- `app/src/app/api/orgs/[orgId]/depa-score/route.ts` — `GET` endpoint returning `{ total, coverage_score, expiry_score, freshness_score, revocation_score, computed_at, stale }`. Auth via `supabase.auth.getUser()` + `organisation_members` membership check. Reads cached row from `depa_compliance_metrics`; falls back to a live `compute_depa_score` RPC call when the cache is empty (flags `stale: true`). Flags `stale: true` when cached `computed_at` is older than 25 hours.

## Review fix-batch — 2026-04-16

**Source:** `docs/reviews/2026-04-16-phase2-completion-review.md` (N-S2)

### Fixed
- `src/app/api/orgs/[orgId]/audit-export/route.ts` — the
  `audit_export_manifests` INSERT was previously awaited but its
  error was never inspected, so a silent insert failure could ship
  a ZIP with no audit-trail row (breaking rule #4's customer-owned-
  record guarantee). Capture `{ error }`, return HTTP 500 with the
  Supabase error message before serving the ZIP.

### Tested
- [x] `bun run test` — 86/86 still passing.
- [x] `bun run build` — clean.

## ADR-0018 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0018 — Pre-built Deletion Connectors (Phase 1)

### Added
- `VALID_CONNECTOR_TYPES` in
  `src/app/api/orgs/[orgId]/integrations/route.ts` now accepts
  `mailchimp` and `hubspot` alongside `webhook`. Per-type required-
  field validation and per-type `configPayload` shape (api_key +
  audience_id for Mailchimp; api_key for HubSpot).

### Changed
- `src/lib/rights/deletion-dispatch.ts`: refactored the single
  inline webhook dispatch into a per-type switch. `dispatchWebhook`
  (existing logic moved verbatim), `dispatchMailchimp`
  (DELETE /3.0/lists/{audience}/members/{md5(email)} with HTTP
  Basic auth), `dispatchHubspot`
  (DELETE /crm/v3/objects/contacts/{email}?idProperty=email with
  Bearer auth). Synchronous-API dispatchers mark the receipt
  `confirmed` on 2xx/404; `dispatch_failed` otherwise with the
  provider's response body in `failure_reason`.

### Tested
- [x] `tests/rights/connectors.test.ts` — 5 new tests for the
  Mailchimp + HubSpot dispatchers via mocked `global.fetch`
  (URL shape, auth header, 204/404/5xx branches, missing-config
  rejection).
- [x] `bun run test` — 81 → 86 PASS.
- [x] `bun run lint` + `bun run build` — clean.

## ADR-0017 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0017 — Audit Export Package (Phase 1)

### Added
- `src/app/api/orgs/[orgId]/audit-export/route.ts`: authenticated
  `POST`. Runs the aggregator RPC, pipes every section into a JSZip
  archive, records a manifest row, returns the archive as an
  `application/zip` attachment. `delivery_target = 'direct_download'`
  for Phase 1; the R2 upload flow is V2-X3.
- `jszip@3.10.1` in `dependencies`, exact-pinned.

### Tested
- [x] Build + lint + test — clean (81/81 pass).

## ADR-0010 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0010 — Distributed Rate Limiter
**Sprint:** Phase 1, Sprint 1.1

### Added
- `@upstash/redis@1.37.0` — REST client for the Vercel Marketplace
  Upstash integration. Exact-pinned.
- `tests/rights/rate-limit.test.ts` — four-case Vitest covering the
  in-memory fallback (fresh / within-limit / exceed / reset-after-window).

### Changed
- `src/lib/rights/rate-limit.ts` — replaces the module-scoped `Map`
  with an Upstash-backed fixed-window counter. `checkRateLimit` is
  now `async`. Primary path: pipeline of `SET NX EX` + `INCR` + `PTTL`,
  one REST round trip. Falls back to the original in-memory Map when
  `KV_REST_API_URL` / `KV_REST_API_TOKEN` (aliased as
  `UPSTASH_REDIS_REST_*`) are unset, with a one-time console warning.
- `src/app/api/public/rights-request/route.ts` and
  `.../verify-otp/route.ts` — both now `await checkRateLimit(...)`
  and use `rl:` key-prefix (`rl:rights:<ip>`, `rl:rights-otp:<ip>`).

### Tested
- [x] `bun run test` — 43 / 43 PASS (was 39, +4 new for rate-limit)
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] Live smoke against Upstash (`scripts/smoke-test-rate-limit.ts`) — PASS; 5 allowed / 2 denied / retry=60s / no fallback warning. Upstash DB: `upstash-kv-citrine-blanket`.

## ADR-0008 Sprint 1.3 — 2026-04-14

**ADR:** ADR-0008 — Browser Auth Hardening
**Sprint:** Phase 1, Sprint 1.3

### Changed
- `src/lib/rights/turnstile.ts` — `TURNSTILE_SECRET_KEY` is now required when
  `NODE_ENV === 'production'`; `verifyTurnstileToken` throws if unset.
  Development mode still falls back to Cloudflare's always-pass test key, but
  now logs a one-time warning. The outgoing `fetch` to the Turnstile endpoint
  now carries an 8-second `AbortSignal.timeout` (also closes S-4 from the
  2026-04-14 review).

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] `bun run test` — 39 / 39 PASS

## B-5 remediation — 2026-04-14

### Changed
- `src/app/api/webhooks/razorpay/route.ts` — unresolved `org_id` now returns
  **422** (with a machine-readable error body) instead of a silent 200. The
  lookup fallback to `razorpay_subscription_id` is preserved. Razorpay will
  retry on non-2xx, buying time for investigation instead of losing the event.

## ADR-0013 Sprint 1.1 — 2026-04-15

### Added
- `src/app/auth/callback/route.ts` — single post-signup / post-confirmation
  handler. Exchanges `?code=…` for a session if present, then runs
  `rpc_signup_bootstrap_org` when the user has no org membership and has
  `org_name` in `user_metadata`. Redirects to `/dashboard` on success,
  `/login?error=…` on failure.

### Removed
- `src/app/api/auth/signup/route.ts` — superseded by `/auth/callback`.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS (38 routes; `/auth/callback` present,
  `/api/auth/signup` gone)
- [x] `bun run test` — 39 / 39 PASS

## S-3 / S-6 remediation — 2026-04-14

### Changed
- `src/app/api/webhooks/razorpay/route.ts` — reads
  `x-razorpay-event-id`, calls `rpc_webhook_mark_processed` before the state
  transition, returns `{received:true, duplicate:true}` on replays.
- `src/lib/encryption/crypto.ts` — adds a 60-second in-process cache for
  per-org derived keys. Eliminates the per-call round trip to
  `organisations.encryption_salt` during hot paths (e.g. batch deletion
  dispatch).

## ADR-0009 Sprint 2.1 + 3.1 — 2026-04-14

### Changed
- `src/app/(public)/rights/[orgId]/page.tsx` — uses anon client + `rpc_get_rights_portal`.
- `src/app/(public)/privacy/[orgId]/page.tsx` — uses anon client + `rpc_get_privacy_notice`.
- `src/app/api/auth/signup/route.ts` — calls `rpc_signup_bootstrap_org` under
  the user's JWT. `userId` body field is no longer trusted (auth.uid() wins).
- `src/app/api/webhooks/razorpay/route.ts` — signature verify stays in Node,
  state transitions delegated to `rpc_razorpay_apply_subscription`.
- `src/app/api/orgs/[orgId]/rights-requests/[id]/events/route.ts` —
  `rpc_rights_event_append`.
- `src/app/api/orgs/[orgId]/banners/[bannerId]/publish/route.ts` —
  `rpc_banner_publish`; Cloudflare KV invalidation + grace-period secret
  storage remain in Node because they need the CF API token.
- `src/app/api/orgs/[orgId]/integrations/route.ts` —
  `rpc_integration_connector_create`.
- `src/lib/billing/gate.ts`, `src/lib/encryption/crypto.ts`,
  `src/lib/rights/deletion-dispatch.ts` — all now take a `SupabaseClient`
  parameter instead of creating an internal service-role client.

Net effect: `grep -r SUPABASE_SERVICE_ROLE_KEY src/` returns zero matches.
Service-role key is now only used by migrations.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS (38 routes)
- [x] `bun run test` — 39/39 PASS

## ADR-0009 Sprint 1.1 — 2026-04-14

**ADR:** ADR-0009 — Scoped-Role Enforcement in REST Paths
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `src/app/api/public/rights-request/route.ts` — now calls
  `rpc_rights_request_create` via the anon key. Service-role client removed.
- `src/app/api/public/rights-request/verify-otp/route.ts` — now calls
  `rpc_rights_request_verify_otp` via the anon key. OTP state transitions,
  rights_request_events insert, and audit_log insert all happen atomically
  server-side.
- `src/app/api/v1/deletion-receipts/[id]/route.ts` — now calls
  `rpc_deletion_receipt_confirm` via the anon key. Signature verification
  still happens in Node. Replays and racing updates now return 409.

### Tested
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS
- [x] `bun run test` — 39 / 39 PASS
