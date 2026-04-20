# Changelog — API

API route changes.

## [ADR-1001 Sprint 2.2] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-Marketing + Public API Foundation
**Sprint:** Sprint 2.2 — Bearer middleware + request context

### Added
- `app/src/lib/api/auth.ts` — `verifyBearerToken(authHeader)`: parses `Bearer cs_live_*`, calls `rpc_api_key_verify` (service_role only per migration 20260520000001), distinguishes revoked (410) from invalid (401) via secondary `api_keys` hash lookup. `problemJson()` RFC 7807 body builder.
- `app/src/lib/api/context.ts` — `getApiContext()` reads injected headers into `ApiKeyContext`; `assertScope()` returns 403 response for missing scopes; `buildApiContextHeaders()` used by proxy.ts to stamp context onto the request.
- `app/src/app/api/v1/_ping/route.ts` — canary GET returns `{ ok, org_id, account_id, scopes, rate_tier }` from proxy-injected headers.
- `tests/integration/api-middleware.test.ts` — 6 unit-style integration tests for `verifyBearerToken` (valid, missing, malformed ×2, invalid, revoked).

### Changed
- `app/src/proxy.ts` — added `/api/v1/:path*` to `config.matcher`; added Bearer gate branch that skips `/api/v1/deletion-receipts/*`, validates the token, injects context headers on success, or returns RFC 7807 problem+json (401 / 410).
- `vitest.config.ts` — added `tests/integration/**/*.test.ts` to include list.

### Tested
- [x] 6/6 integration tests — PASS (`bunx vitest run tests/integration/api-middleware.test.ts`)
- [x] `cd app && bun run build` — clean (0 errors, 0 warnings)
- [x] `cd app && bunx tsc --noEmit` — clean

## [ADR-0050 Sprint 2.3] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — invoice history + download + webhook reconciliation

### Added
- `admin/src/app/api/admin/billing/invoices/[invoiceId]/download/route.ts` — GET. Admin proxy enforces `is_admin` + AAL2 before the handler runs. Calls `admin.billing_invoice_detail` first (which enforces the tier + issuer-scope rule and raises for a retired-issuer invoice viewed by a platform_operator). On success, 307-redirects to a 5-minute presigned R2 URL via `presignInvoicePdfUrl`. Returns 409 if the row has no PDF yet (still draft).

### Changed
- `app/src/app/api/webhooks/razorpay/route.ts` — handles `invoice.paid` events. Verbatim-insert already happens (unchanged); the new branch calls `public.rpc_razorpay_reconcile_invoice_paid` with payload `invoice.id` + `invoice.order_id` + `invoice.paid_at` (unix seconds → ISO), then stamps `processed_outcome` as `reconciled:<previous_status>→<new_status>` on match or `reconcile_orphan:<reason>` otherwise. Subscription-event path (ADR-0034) unchanged.

### Tested
- [x] Admin + customer app `bun run build` + `bun run lint` — clean.
- [x] Reconciliation behaviour covered by `tests/billing/webhook-reconciliation.test.ts` (5/5 PASS).

## [ADR-0050 Sprint 2.2] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing

### Added
- `admin/src/lib/storage/sigv4.ts` — admin-side copy of the ADR-0040 hand-rolled AWS sigv4 helper (PUT object + presigned GET). Per the monorepo "share narrowly" discipline, infrastructure glue is duplicated across app/ and admin/ rather than promoted to a shared package.
- `admin/src/lib/billing/render-invoice.ts` — deterministic PDFKit invoice renderer. CreationDate is stamped from `invoice.issue_date` (not wall clock) so identical inputs produce byte-identical output, which is what lets the SHA-256 travel with the invoice row as its content anchor.
- `admin/src/lib/billing/r2-invoices.ts` — R2 upload wrapper over the sigv4 helper. Uploads under `invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf`; computes the SHA-256 server-side before upload; returns `{r2Key, sha256, bytes}`. `presignInvoicePdfUrl(r2Key, expiresIn)` returns short-TTL signed GET URLs.
- `admin/src/lib/billing/resend-invoice.ts` — Resend REST dispatch with the PDF attached as base64. No `@resend/node` dependency (Rule 15).
- `admin/src/app/api/admin/billing/invoices/issue/route.ts` — POST. Validates body → calls `admin.billing_issue_invoice` → loads `admin.billing_invoice_pdf_envelope` → renders PDF → uploads to R2 → `admin.billing_finalize_invoice_pdf` → `sendInvoiceEmail` → `admin.billing_stamp_invoice_email`. Response envelope carries `{invoice_id, invoice_number, pdf_r2_key, pdf_sha256, bytes, email_message_id}`. On post-insert failure the draft invoice survives; operators can recover via a new issuance call (FY sequence gaps are legal).
- `app/` workspace: **no change**. PDF + R2 + Resend-with-attachment live admin-side so customer-app identities never touch the invoice issuance path (Rule 12). The ADR originally placed the handler under `app/src/app/api/admin/billing/...`; that path is retracted in favour of the admin-side location shipped here.

### Tested
- [x] `bun run build` on `admin/` — compiles; `/api/admin/billing/invoices/issue` in the route manifest.
- [x] `bun run lint` on `admin/` — clean.
- [x] `bun run build` + `bun run lint` on `app/` — clean (no regression from workspace install of pdfkit into admin).
- [x] Manual verification of PDF render + R2 upload + Resend dispatch pending on a real issuer + account (infra action: set `R2_INVOICES_BUCKET` + `RESEND_FROM` on the admin Vercel project; flip one issuer to active; run curl).

## [ADR-0049 Phase 2.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Added
- `app/src/app/api/webhooks/sentry/route.ts` — HMAC-SHA256 verify on raw body via `SENTRY_WEBHOOK_SECRET` (timing-safe compare). Filters info/debug, returns 200 on unhandled payload shapes so Sentry doesn't retry, upserts into `public.sentry_events` on `sentry_id` conflict for idempotent retries. Uses the anon key — no service-role.

## [ADR-0049 Phase 1.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Added
- `app/src/lib/rights/rate-limit-log.ts` — fire-and-forget `logRateLimitHit()` posting to `public.rate_limit_events` via the anon REST API. SHA-256s the bucket key. Callers never await; errors swallowed.
- Wired into `app/src/app/api/public/rights-request/route.ts` + `verify-otp/route.ts` — on 429, logger fires before the response.

## [ADR-0045 Sprint 1.2] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle

### Added
- `admin/src/lib/supabase/service.ts` — service-role client factory. Accepts `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. Scoped to admin Route Handlers per CLAUDE.md Rule 5 carve-out.
- `admin/src/lib/admin/invite-email.ts` — Resend dispatch for OTP-based admin invites.
- `admin/src/lib/admin/lifecycle.ts` — shared orchestration (`inviteAdmin`, `changeAdminRole`, `disableAdmin`) — Route Handlers AND Server Actions delegate here.
- `admin/src/app/api/admin/users/invite/route.ts` — POST. Creates auth user + calls admin_invite_create + sends invite email. Rolls back auth user if the RPC refuses.
- `admin/src/app/api/admin/users/[adminId]/role/route.ts` — PATCH. `admin_change_role` + `auth.admin.updateUserById` sync. Returns 207 on db/auth drift.
- `admin/src/app/api/admin/users/[adminId]/disable/route.ts` — POST. `admin_disable` + `app_metadata.is_admin=false` flip. Same 207 pattern.

## [ADR-0034 Sprint 2.2] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations

### Added
- `admin/src/lib/razorpay/client.ts` — typed fetch wrapper. Reads `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`; throws `RazorpayEnvError` on missing env. `issueRefund({paymentId, amountPaise, notes})` returns typed response. `subscriptionDashboardUrl(id)` helper. `RazorpayApiError` wraps HTTP failures with status + parsed payload.
- `admin/src/app/(operator)/billing/actions.ts` extended — `createRefund` now does the full round-trip: pending row → Razorpay → flip via mark_issued / mark_failed. Missing env or payment id degrades to `status:'pending'` with surfaced warning.

## [ADR-0044 Phase 2.5] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.5 — invitation email dispatch

### Added
- `app/src/app/api/internal/invitation-dispatch/route.ts` — POST handler. Called by the Postgres AFTER-INSERT trigger on `public.invitations` (via pg_net) and by the `invitation-dispatch-retry` pg_cron safety-net. Bearer-authenticated with `INVITATION_DISPATCH_SECRET` (the same value as the `cs_invitation_dispatch_secret` Vault secret). Idempotent: the first successful Resend call stamps `email_dispatched_at`; later calls skip. Failures record `email_last_error` + increment `email_dispatch_attempts` so stuck dispatches surface in the admin console.
- `app/src/lib/invitations/dispatch-email.ts` — pure template builder. Role-switch yields subject + heading + body; single HTML shell with a CTA button + plain-text alternative.

### Notes
- Required env vars: `INVITATION_DISPATCH_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`. Without `RESEND_API_KEY` the dispatcher returns 503 and records `email_last_error='RESEND_API_KEY not configured'` so the retry cron can pick it up once the key is set.
- Required Vault secrets: `cs_invitation_dispatch_url` (the public URL of the route above), `cs_invitation_dispatch_secret` (same value as the env var). Both must be set before any invite-email will leave the DB; missing Vault secrets yield a soft-null return from `public.dispatch_invitation_email` so the pg_cron retry covers the bootstrap window.

## [ADR-0039] — 2026-04-17

**ADR:** ADR-0039 — Connector OAuth (Mailchimp + HubSpot)
**Sprint:** 1.2 — provider modules + connect/callback routes

### Added
- `app/src/lib/connectors/oauth/types.ts` — shared `OAuthProviderConfig` + `TokenBundle` contracts.
- `app/src/lib/connectors/oauth/mailchimp.ts` — Mailchimp provider. Exchange-code handler fetches metadata endpoint to capture `server_prefix` alongside the long-lived access token. No refresh (Mailchimp tokens don't expire).
- `app/src/lib/connectors/oauth/hubspot.ts` — HubSpot provider. Exchange + refresh share a common `exchangeOrRefresh()` helper. Captures `portal_id` from the account-info endpoint.
- `app/src/lib/connectors/oauth/registry.ts` — dispatch by provider id; `listConfiguredOAuthProviders()` returns only providers with populated client_id/secret env vars.
- `app/src/app/api/integrations/oauth/[provider]/connect/route.ts` — GET starts the handshake. Generates 48-char random state, writes `oauth_states`, redirects to the provider's authorize URL. Admin/owner gated.
- `app/src/app/api/integrations/oauth/[provider]/callback/route.ts` — GET validates state (exists, not consumed, not expired, provider matches, initiator matches), consumes it, exchanges code for tokens, encrypts the bundle via `encryptForOrg`, upserts `integration_connectors` (distinguishes OAuth rows from API-key rows via `(OAuth)` display-name suffix). Redirects back to `/dashboard/integrations` with `?oauth_connected=<provider>` or `?oauth_error=<code>`.

## [ADR-0041] — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox
**Sprints:** 1.1 dep · 1.2 sandbox script · 1.3 orchestrator · 1.5 signature-match

### Added
- `app/package.json` — `@vercel/sandbox@1.10.0` (exact pin per Rule 16). Adds the SDK for creating / managing Firecracker microVMs programmatically.
- `app/sandbox-scripts/probe-runner.mjs` + `package.json` + `README.md` — Playwright scenario executed inside the sandbox. Reads `/tmp/probe-input.json`, sets the consent cookie on the target domain, navigates with `waitUntil:networkidle`, snapshots script/iframe/img srcs + intercepted network URLs + final cookies + title, prints one JSON blob to stdout. No signature matching inside the sandbox — keeps the payload minimal.
- `app/src/app/api/internal/run-probes/route.ts` — POST handler. Bearer-authenticated via `PROBE_CRON_SECRET`. Iterates active `consent_probes` due a run. For each: creates a Vercel Sandbox (`node24`, allow-all network, 2-min timeout), copies `sandbox-scripts/**` in, installs deps + Playwright Chromium, drops the probe config at `/tmp/probe-input.json`, runs the scenario, parses stdout, applies `matchSignatures` + `computeViolations` (shared helper), INSERTs `consent_probe_runs`, bumps `consent_probes.last_run_at` + `next_run_at` per schedule, stops the sandbox.
- `app/src/lib/probes/signature-match.ts` — pure module. Exports `matchSignatures(urls, sigs)` + `computeViolations(detections, consentState)` + `overallStatus(violations)`. Unit-tested in `app/tests/probes/signature-match.test.ts` (10/10 PASS).

### Tested
- [x] `cd app && bunx vitest run tests/probes/signature-match.test.ts` — 10/10 PASS.
- [x] `cd app && bunx tsc --noEmit` — clean.
- [x] `cd app && bun run build` — zero errors / zero warnings; `/api/internal/run-probes` + `/dashboard/probes` in the route manifest.
- [ ] End-to-end sandbox smoke — deploy-time step requiring operator to set `PROBE_CRON_SECRET` on Vercel + `vercel_app_url` + `probe_cron_secret` in Supabase Vault. Documented in ADR-0041 closeout.

## [ADR-0042] — 2026-04-17

**ADR:** ADR-0042 — Signup Idempotency Regression Test

### Added
- `app/src/lib/auth/bootstrap-org.ts` — `ensureOrgBootstrap(supabase, user)` helper. Returns a typed discriminator: `skipped` (existing member | no metadata), `bootstrapped`, or `failed`.
- `app/tests/auth/bootstrap-org.test.ts` — 4 unit tests with a minimal SupabaseClient mock: existing-member skip, no-metadata skip, successful RPC call with correct params, RPC failure discriminator.

### Changed
- `app/src/app/auth/callback/route.ts` — delegates to `ensureOrgBootstrap`. Redirect logic unchanged; runtime behaviour identical.

### Tested
- [x] `cd app && bunx vitest run tests/auth/bootstrap-org.test.ts` — 4/4 PASS.
- [x] `cd app && bunx vitest run` — 9 files, 53/53 PASS.

## [ADR-0040] — 2026-04-17

**ADR:** ADR-0040 — Audit R2 Upload Pipeline
**Sprints:** 1.1 sigv4 · 1.4 delivery-target branch

### Added
- `app/src/lib/storage/sigv4.ts` — hand-rolled AWS sigv4 signer. Exports `putObject({ endpoint, region, bucket, key, body, accessKeyId, secretAccessKey, contentType? })` and `presignGet({...expiresIn?})`. Built on Node `crypto` built-ins only (no new npm dep per Rule #14). Unit-tested in `app/tests/storage/sigv4.test.ts` against AWS-documented constants + deterministic signing-key chain + presigned URL shape (7/7 PASS).

### Changed
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` — after building the ZIP, checks `export_configurations.is_verified`. When true: decrypts credentials via `decryptForOrg`, sigv4-PUTs the archive to `s3://<bucket>/<path_prefix>audit-exports/<org_id>/audit-export-<ts>.zip`, records `delivery_target='r2'` + `r2_bucket` + `r2_object_key` on `audit_export_manifests`, bumps `export_configurations.last_export_at`, and returns JSON `{ delivery, bucket, object_key, size_bytes, download_url, expires_in }` with a 1-hour presigned GET URL. Falls back to the ADR-0017 direct-download path on R2 upload failure (logged) or when no verified config exists.

## [ADR-0037] — 2026-04-17

**ADR:** ADR-0037 — DEPA Completion
**Sprints:** 1.2 rights fingerprint · 1.3 CSV export · 1.4 Audit DEPA section

### Added
- `app/src/lib/rights/fingerprint.ts` — `deriveRequestFingerprint(request, orgId)` helper. sha256(userAgent + ipTruncated + orgId) matching the Cloudflare Worker formula at `worker/src/events.ts:118`. Also exports `extractClientIp` and `truncateIp`.
- `app/src/app/api/orgs/[orgId]/artefacts.csv/route.ts` — GET handler streams `text/csv` for Consent Artefacts honouring the same filters as `/dashboard/artefacts`. Auth via `organisation_members`; no pagination (full filtered result set).

### Changed
- `app/src/app/api/public/rights-request/route.ts` — derives the session fingerprint from incoming request headers and passes it to `rpc_rights_request_create` as `p_session_fingerprint`. No UI or payload change required on the portal form.
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` — ZIP now includes `depa/purpose_definitions.json`, `depa/purpose_connector_mappings.json` (connector display names resolved server-side), `depa/artefacts_summary.csv` (counts by status × framework × purpose_code — no PII), and `depa/compliance_metrics.json`. `manifest.json` + `audit_export_manifests.section_counts` both reflect the DEPA additions.

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

## [ADR-0050 Sprint 3.1] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.1

### Changed
- `admin/src/lib/billing/build-export-zip.ts` — extracted pure ZIP+CSV assembly into a standalone function so it is testable without Next.js runtime or real R2.
- `admin/src/app/(operator)/billing/export/actions.ts` — refactored to call `buildExportZip(envelope, fetchInvoicePdf)` via the extracted module.
- `admin/src/lib/billing/r2-invoices.ts` — updated to support manifest-driven multi-PDF fetch for export flow.
- `admin/src/lib/storage/sigv4.ts` — minor fixes to SigV4 signing for R2 presigned URL generation.

### Tested
- [x] `tests/billing/invoice-export-contents.test.ts` — 7/7 PASS (unit-testable without runtime; validates CSV structure, SHA-256, audit round-trip)
