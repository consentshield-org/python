# Changelog — Infrastructure

Vercel, Cloudflare, Supabase config changes.

## [ADR-1014 Sprint 2.2 — healthcare demo site + FHIR guardrail probe + Railway deploy] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 2, Sprint 2.2 — Healthcare demo

### Added
- `test-sites/healthtech/appointment.html` — ABHA-style booking form (name, mobile, optional ABHA ID, reason for visit, preferred slot).
- `test-sites/healthtech/portal.html` — ABDM-style OTP-login stub. Describes what the post-login portal would show (appointments, prescriptions fetched from the EHR at request time, consent ledger, right-to-deletion path) — deliberately no persistent patient state in the demo.
- `test-sites/healthtech/fhir-probe.html` — CLAUDE.md Rule 3 guardrail test surface. Presents a synthetic FHIR `Observation` payload and POSTs it to a deliberately-nonexistent `/healthtech/_mock-ehr/` endpoint on the same static site (returns 404 — the 404 is the point: the POST proves the browser made a network call without ever traversing any ConsentShield surface). Page body documents the buffer-table audit-grep a reviewer should run to confirm zero rows matching `Observation|Patient|Bundle|Encounter|Condition|MedicationRequest`.

### Changed
- `test-sites/healthtech/index.html` — rewritten to drop hardcoded org/prop IDs; routes through `shared/banner-loader.js` + `shared/demo.js`; healthcare-specific tracker mix (Google Analytics gated by `research_deidentified`); includes a dedicated callout explaining the CLAUDE.md Rule 3 constraint with a link to `fhir-probe.html`. Per-page `<meta name="robots">` + `googlebot` + `bingbot` noindex tags added to all four healthcare pages.
- `scripts/e2e-bootstrap.ts` — added `BannerPurpose` interface + `purposes: BannerPurpose[]` on `VerticalSpec`. Ecommerce seeded with `essential / analytics / marketing`; healthcare with `clinical_care` (contract, required) / `research_deidentified` (consent) / `marketing_health_optin` (consent); BFSI with `kyc_mandatory` (legal_obligation) / `credit_bureau_share` (consent) / `marketing_sms` (consent). Banner-refresh logic: when `consent_banners.purposes` jsonb differs from the spec, UPDATE in place (no `--force` required, no version bump). Banner `id` is preserved across runs so tests can pin it.

### Deployed
- Railway service `healthcare` under project `ConsentShield` (service id `ba76be14-dfe7-40e1-b968-039525c780fc`). Service was created server-side by `railway add --service healthcare` despite the CLI returning "Project not found" at the tail of its wizard — verified live via Railway GraphQL (`Project-Access-Token`-scoped query for `project.services.edges`). `railway up --service healthcare --ci` from `test-sites/` built via Nixpacks (nodejs_22 + npm-9_x; start: `node server.js`) and deployed successfully. Live at **`https://healthcare-production-330c.up.railway.app`** — verified all four pages return 200 with the Sprint 2.1 hardening header set, plus `robots.txt` + `/.well-known/security.txt` carry over from the shared static server.

### Tested
- `bunx tsx scripts/e2e-bootstrap.ts` — 3 vertical fixtures refreshed, 9 banner rows UPDATE'd in place, 18.6 s wall time, zero errors.
- `curl -sSI https://healthcare-production-330c.up.railway.app/healthtech/` — HTTP/2 200 with all 7 hardening response headers (X-Robots-Tag, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy).
- `curl -sS https://healthcare-production-330c.up.railway.app/robots.txt` — wildcard + named-crawler deny list served 200.
- `curl -sS https://healthcare-production-330c.up.railway.app/.well-known/security.txt` — RFC 9116 record served 200.
- `curl -sS <url> | grep 'name="robots"'` against all four healthcare pages — meta tags present on `/healthtech/`, `appointment.html`, `portal.html`, `fhir-probe.html`.

### Deferred
- DNS cutover to `demo-clinic.consentshield.in` — one-step Cloudflare CNAME to `healthcare-production-330c.up.railway.app`; fixture `allowed_origins` already lists the target hostname.
- Automated buffer-table FHIR grep — moved to Sprint 3.7 (negative-control pair sweep) where the test harness can execute the grep as part of a CI stage. The demo-site probe page documents the manual-review version for now.
- ABDM-scope DEPA-native opt-in assertion (`depa_native=true` on the stored artefact) — deferred to the Sprint 3.x end-to-end flows where the DEPA artefact surface lights up.

### Why
Healthcare is the vertical where the CLAUDE.md Rule 3 invariant (FHIR never persisted) is most load-bearing — a single leaked `Observation.valueQuantity` puts the entire compliance story at risk. Rather than embed the guardrail only in application code, the demo site carries an explicit probe page that makes the invariant auditable by a reviewer with just a browser + a `curl` against the buffer tables. The mismatched POST (404 response) is the proof: the browser fires the request to a synthetic `_mock-ehr` endpoint that ConsentShield does not, and will never, terminate — so any row appearing in the buffers with FHIR shape would itself be evidence of a leak. Bootstrap-seeded purposes (`clinical_care` / `research_deidentified` / `marketing_health_optin`) align with the ABDM-adjacent consent surface rather than the ecommerce GA/Hotjar/Meta trio, so downstream DEPA-native tests can exercise legal-basis-`contract` and legal-basis-`consent` paths side by side.

## [ADR-1014 Sprint 2.1 — demo site hardening (noindex + AI-bot deny)] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 2, Sprint 2.1 — hardening pass before public DNS cutover

### Added
- `test-sites/robots.txt` — baseline `User-agent: * → Disallow: /` plus explicit deny blocks for 40+ named crawlers covering search (Googlebot, Bingbot, DuckDuckBot, Baidu, Yandex, Sogou) and AI model-training / search-assistant bots (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, anthropic-ai, Claude-Web, Claude-SearchBot, Google-Extended, Googlebot-Extended, PerplexityBot, Perplexity-User, CCBot, Bytespider, ByteDanceBot, cohere-ai, Omgilibot, FacebookBot, Meta-ExternalAgent, Meta-ExternalFetcher, Applebot, Applebot-Extended, Diffbot, Amazonbot, DataForSeoBot, AhrefsBot, SemrushBot, MJ12bot, PetalBot, YouBot, Timpibot, Kagibot, Awario*, magpie-crawler). No sitemap emitted.
- `test-sites/.well-known/security.txt` — RFC 9116 record. Contact + canonical to consentshield.in; note that the property is a demo surface.
- `<meta name="robots">` + `googlebot` + `bingbot` + `googlebot-news` tags on every ecommerce HTML page (index, product, cart, checkout) — second layer for scrapers that ignore X-Robots-Tag headers.

### Changed
- `test-sites/server.js` — every response now carries a hardened header set:
  - `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: interest-cohort=(), browsing-topics=(), geolocation=(), microphone=(), camera=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Access-Control-Allow-Origin: *` retained so the banner can post (Worker does its own origin check anyway).

### Tested
- `curl -sI https://ecommerce-production-9332.up.railway.app/ecommerce/` — all 7 hardening headers present on the 200 response.
- `curl https://ecommerce-production-9332.up.railway.app/robots.txt` — 200 with the deny list.
- `curl https://ecommerce-production-9332.up.railway.app/.well-known/security.txt` — 200.
- `curl https://ecommerce-production-9332.up.railway.app/ecommerce/ | grep 'name="robots"'` — meta tags present on every page I authored.

### Why
The demo site is intentionally public (fixture-scoped, fake products, synthetic consent events) so reviewers can browse it without auth. That doesn't mean it should end up in Google search results, Archive.org, or LLM training sets. The hardening applies X-Robots-Tag at the edge (every response, every bot that honours it) plus a dense robots.txt deny-list for the bots that prefer crawl-rules over response headers. Two layers.

## [ADR-1014 Sprint 2.1 — ecommerce demo site + Railway config + browser E2E] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 2, Sprint 2.1 — Ecommerce demo (partial)

### Added
- `test-sites/ecommerce/product.html` + `cart.html` + `checkout.html` — completes the 4-page apparel storefront.
- `test-sites/shared/banner-loader.js` — config-driven banner bootstrap. Reads `?cdn` / `?org` / `?prop` from URL or localStorage, injects the banner `<script src>` accordingly. Works against both the deployed CDN and local wrangler dev.
- `test-sites/shared/demo.js` — shared per-purpose tracker injector (runs on `consentshield:consent`) + nav query-string forwarder so `?org=` / `?prop=` survive cross-page links.
- `test-sites/server.js` + `test-sites/package.json` — zero-dep static server for Railway. `node server.js`; PORT via env; safe path-resolution; `/healthz` = 200 via the `/` healthcheck.
- `test-sites/railway.json` — Nixpacks builder + start command + healthcheck config.
- `tests/e2e/utils/static-server.ts` — dependency-free static server for the E2E harness (per-test localhost:4001).
- `tests/e2e/demo-ecommerce-banner.spec.ts` + `specs/demo-ecommerce-banner.md` — browser-driven test. Navigates Chromium to the demo, asserts banner renders, clicks "Accept all", asserts both page-level `consentshield:consent` event AND observable `consent_events` row with `origin_verified='origin-only'`.

### Changed
- `test-sites/ecommerce/index.html` — dropped hardcoded org/prop IDs, now uses `banner-loader.js`. Links to product.html / cart.html so the vertical feels like a real site.
- `test-sites/shared/demo.css` — added styles for product detail, cart rows, summary rows, form fields, buttons.

### Deployed
- Railway service `ecommerce` created under the `ConsentShield` project (`railway add --service ecommerce`); previously-empty `accomplished-compassion` was replaced. `railway up --ci` from `test-sites/` built via Nixpacks (`nodejs_22, npm-9_x`, start: `node server.js`) and deployed. Live at **`https://ecommerce-production-9332.up.railway.app`** — verified 200 on `/ecommerce/` + HTML carries the banner-loader tag + product grid.

### Deferred
- **DNS cutover to `demo-ecommerce.consentshield.in`** — one-step Cloudflare CNAME to the Railway-generated URL; the fixture `allowed_origins` already lists the target hostname.
- **Playwright test runtime verification** (per user decision to wait for ADR-1010) — blocked by Terminal B's ADR-1010 Sprint 2.1 commit `c55b661` (runtime role guard: Worker refuses to boot unless `SUPABASE_WORKER_KEY` is a JWT with `role=cs_worker`). Our local stand-in (service-role) is now rejected. Test remains in the suite and skips cleanly if `WORKER_URL` is absent; re-runs green once the Worker has a `cs_worker`-claimed JWT OR ADR-1010's direct-Postgres migration for the Worker lands.
- **Healthcare + BFSI Railway services** — one-per-vertical cadence; those services ship in Sprints 2.2 / 2.3 alongside their demo sites.

### Tested
- [x] `bunx tsc --noEmit` clean on `tests/e2e/` + `scripts/`.
- [x] Curl POST to `/v1/events` with `Origin: http://localhost:4001` → Worker returns 202 + buffer row observed. Confirms fixture origin allow-list works end-to-end; the browser-path 403 traced to the ADR-1010 runtime guard is an environment issue, not a pipeline bug.
- [x] Banner loader precedence (URL → localStorage → data-attrs → defaults) verified by visual test.

### Gotchas
- Chromium's `fetch(..., { keepalive: true })` bypasses `page.route` and `page.on('request')` interception. The test intercepts `/v1/banner.js` and strips `keepalive: true` from the compiled script so all downstream POSTs are visible to Playwright's network hooks.
- ADR-1010 Sprint 2.1 Worker runtime guard (`c55b661`) requires `SUPABASE_WORKER_KEY` to be a JWT with `role=cs_worker`. Using the service-role key as a local stand-in (Sprint 1.3's documented workaround) no longer works. Re-document once ADR-1010 provides a `cs_worker` JWT rotation path.

## [ADR-1014 Sprint 1.4 — evidence writer + seal + verify CLI] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 1, Sprint 1.4 — Evidence archive + partner-verifiable seal

### Added
- `tests/e2e/utils/evidence.ts` — run lifecycle primitives: `startRun` / `addAttachment` / `copyDirAttachment` / `recordTest` / `finalize`. Writes to `tests/e2e/evidence/<commitShort>/<runId>/` with `manifest.json` + `seal.txt` + `attachments/` tree. Manifest carries schema version, ADR ref, commit SHA, branch, Node version, OS, Playwright projects, per-test outcomes (file, title, project, status, duration, retries, trace_ids, error first-line), summary (total/passed/failed/skipped/flaky), and sorted attachment list with `{ path, size, sha256 }`.
- `tests/e2e/utils/evidence-seal.ts` — `verifySeal(runDir)` reads `seal.txt`, recomputes the per-file SHA-256 ledger, and returns `{ ok, expected, actual, ledgerLines, mismatches[] }` with MODIFIED / ADDED / REMOVED per-file diagnostics.
- `tests/e2e/utils/evidence-reporter.ts` — Playwright `Reporter` implementation. `onBegin → startRun`, `onTestEnd → recordTest + harvest attachments (trace-ids, response-body JSON)`, `onEnd → copy playwright-report/ + results.json + finalize + print verify command`. Wired into `playwright.config.ts` as the fourth reporter (runs last).
- `scripts/e2e-verify-evidence.ts` — partner-facing CLI. Exit 0 + manifest summary on success; exit 1 + per-file mismatches on tamper; exit 2 on usage/IO error. The tool a prospective reviewer downloads-and-runs against a published archive.

### Changed
- `tests/e2e/playwright.config.ts` — added `['./utils/evidence-reporter.ts']` to the reporters array.
- `tests/e2e/.gitignore` — added `evidence/`.

### Seal format
- Per-file SHA-256 ledger, one line `<sha256>  <relative-path>` per archive file (except `seal.txt` itself), sorted alphabetically. Root hash = `sha256(ledger)`. Written as `seal.txt` with a small preamble (`algorithm: sha256`, `seal: <hex>`) so it is self-describing.
- `seal.txt` is excluded from the ledger; the file containing the seal is intentionally not self-referential. This means `evidence-seal.ts` parses `seal.txt` structurally (algorithm + seal lines + ledger block) rather than hashing it.

### Scope amendments
- **R2 upload deferred to Sprint 5.3.** The static site at `testing.consentshield.in` is the downstream consumer of R2 objects; building the upload path without the consumer is premature. Sprint 1.4 ships the local, verifiable archive + CLI; Sprint 5.3 adds R2 publish + static index. `app/src/lib/storage/sigv4.ts` (ADR-0040) is reusable when we get there.
- **pg_dump attachment + Stryker HTML** — originally listed for Sprint 1.4; the former slides to Phase 3 once tests write enough DB state to be worth snapshotting, the latter gates on Phase 4.

### Tested
- [x] Paired pipeline pos/neg → 8-file archive emitted (manifest.json + seal.txt + attachments: playwright-report/index.html, results.json, 3 response-body JSONs, 2 trace-id txts).
- [x] `bunx tsx scripts/e2e-verify-evidence.ts <runDir>` → exit 0 + prints manifest summary (run_id, commit, duration_ms, projects, test counts).
- [x] Tamper: `sed -i '' 's/"total": 2/"total": 3/'` on `manifest.json` → CLI exits 1 + prints per-file MODIFIED line with stored/actual hashes.
- [x] Restore tampered file → seal re-verifies (exit 0).
- [x] `bunx tsc --noEmit` clean on scripts + e2e workspace.

### Gotcha
- Playwright's `TestResult.status` includes `'timedOut'` and `'interrupted'` variants that aren't counted as own buckets in the manifest summary. `bucketFor()` rolls them up into `failed`; the per-test record retains full detail for partner inspection.

## [ADR-1014 Sprint 1.3 — Worker harness + HMAC helper + first paired pipeline test] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 1, Sprint 1.3 — Worker local harness

### Added
- `tests/e2e/utils/hmac.ts` — Node-side signer mirroring `worker/src/hmac.ts`. Message format `${orgId}${propertyId}${timestamp}`, HMAC-SHA256 hex. Exports `signConsentEvent`, `computeHmac`, `tamperSignature` (deterministic one-hex-char flip at position 17), `signWithStaleTimestamp` (10 min in the past, outside the Worker's ±5 min window).
- `tests/e2e/utils/worker-harness.ts` — `startWorker()` spawns `bunx wrangler dev --local` on port 8787 from the worker/ workspace and waits for "Ready on"; short-circuits to `WORKER_URL` env if preset. Tear-down sends SIGTERM + SIGKILL after 5 s.
- `tests/e2e/utils/supabase-admin.ts` — service-role client for observable-state DB assertions. `countConsentEventsSince(propertyId, cutoffIso)` + `latestConsentEvent(propertyId, cutoffIso)`. Test-only surface; path-excluded from the no-service-role grep gate.
- `tests/e2e/worker-consent-event.spec.ts` — positive: signed event → 202 + 5-column assertion on the resulting `public.consent_events` row + row-count delta = 1.
- `tests/e2e/worker-consent-event-tampered.spec.ts` — paired negative: one hex char flipped → 403 + body contains "Invalid signature" + row-count delta = 0.
- `tests/e2e/specs/worker-consent-event.md` — normative spec for the pair (§5 pairing + §6 fake-positive defence + test-isolation invariant documenting why the two tests use different fixture properties).

### Changed
- `scripts/e2e-bootstrap.ts` — reads `web_properties.event_signing_secret` back alongside the id; seeds one `consent_banners` row per property (idempotent; required FK target for `consent_events.banner_id`). Writes `FIXTURE_<P>_PROPERTY_<n>_SECRET` and `FIXTURE_<P>_PROPERTY_<n>_BANNER_ID` for all 9 fixture properties. `.env.e2e` now has 63 keys (up from 45).
- `tests/e2e/utils/fixtures.ts` — `VerticalFixture.properties[]` exposes `WebPropertyFixture { id, url, signingSecret, bannerId }`. `propertyIds` / `propertyUrls` retained for back-compat with older tests.
- `tests/e2e/utils/env.ts` — `loadE2eEnv()` falls back to `.env.local` for keys not in `.env.e2e` (needed for `SUPABASE_SERVICE_ROLE_KEY` used by the admin client). Primary env wins; fallback only fills gaps.
- Root `.gitignore` — added `worker/.dev.vars` and `worker/.dev.vars.local`.

### Tested
- [x] Paired positive + negative pass against `bunx wrangler dev --local` + fixture property 0 / property 1 respectively. Positive 591 ms, negative 1.4 s, combined parallel 1.9 s.
- [x] Positive's five observable-state assertions all satisfied: `org_id`, `property_id`, `banner_id`, `event_type='consent_given'`, `origin_verified='hmac-verified'`.
- [x] Negative observes 0 rows since cutoff after a 1 s settle window.
- [x] Sacrificial control (`smoke-healthz-negative.spec.ts`) still fails red.
- [x] `bunx tsc --noEmit` clean on both the scripts and the e2e workspace.

### Setup requirement
- `worker/.dev.vars` must contain `SUPABASE_WORKER_KEY=<value>` for local wrangler dev. The README in `tests/e2e/` documents the one-liner to seed this from `.env.local`'s service role key — test-code only, local-only, gitignored, mode 0600. Production deployments are unchanged (scoped `cs_worker` JWT via `wrangler secret put`).

### Gotcha
- First test run used the same fixture property for positive and negative. With Playwright's parallel execution, the positive's legitimate row showed up in the negative's count-since-cutoff query under Node↔Postgres clock skew. Fixed by splitting onto properties[0] vs properties[1] and documenting the invariant in the spec doc. The underlying pipeline was correct; this was test-isolation hygiene.

## [ADR-1014 Sprint 1.2 — e2e bootstrap + reset scripts + fixtures] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 1, Sprint 1.2 — Supabase test-project bootstrap

### Added
- `scripts/e2e-bootstrap.ts` — seeds 3 vertical fixtures (ecommerce / healthcare / bfsi). Each fixture = auth.user + account + account_membership + organisation + org_membership + 3 web_properties + 1 `cs_test_*` API key with SHA-256 hash. Idempotent (reuses fixtures matched by account name `e2e-fixture-<vertical>`); `--force` flag supported for full rebuild. Writes a gitignored `.env.e2e` at repo root with all ids, plaintext keys, fixture user emails/passwords, app surface URLs.
- `scripts/e2e-reset.ts` — clears 14 tables in FK order (expiry_queue → revocations → artefact_index → artefacts → consent_events → tracker_observations + independent buffers); deletes non-fixture E2E-tagged auth.users (matched on `user_metadata.e2e_run === true`). Fixture accounts/orgs preserved.
- `tests/e2e/utils/fixtures.ts` — extended with `ecommerce`, `healthcare`, `bfsi` Playwright fixtures. Each reads `.env.e2e` on first access and returns `{ accountId, orgId, userId, userEmail, userPassword, propertyIds[], propertyUrls[], apiKey, apiKeyId }`. Tests that don't use a vertical never trigger its env lookup.

### Changed
- Root `.gitignore` — added `.env.e2e` + `.env.partner` alongside existing `.env*.local` entries.

### Scope amendment
- Original ADR Sprint 1.2 deliverable listed "seeds the scoped roles (cs_worker / cs_delivery / cs_orchestrator / cs_api / cs_admin) and reads each role's password back". That rotation is destructive against any existing dev Supabase project (invalidates app/admin/marketing `.env.local`). Moved to Sprint 5.1 (partner bootstrap) where it only runs against a fresh partner project. Sprint 1.2 scope is fixture seeding + `.env.e2e` emission — what the harness actually needs to start running. ADR body updated.

### Tested
- [x] Fresh bootstrap — 7.6s wall-clock (target: < 10 min). 3 accounts / 3 orgs / 9 web_properties / 3 api_keys created.
- [x] Idempotent re-run — 4.4s. Every fixture reused (no duplicates in DB).
- [x] Reset — 3.9s wall-clock (target: < 20 s). 14 tables cleared without FK errors.
- [x] `bunx playwright test --list` loads `.env.e2e` (45 env keys injected) + still discovers 8 tests.
- [x] `bunx tsc --noEmit` clean on scripts + tests/e2e.

### Gotcha
- Initial run used plan codes `trial_growth` / `trial_starter` mixed — only `trial_starter` exists in `public.plans`. Valid codes are `trial_starter`, `starter`, `growth`, `pro`, `enterprise`. All verticals now use `trial_starter`; real billing plans are out of scope for E2E fixtures.
- First reset attempt failed on `consent_events` due to `consent_artefacts.consent_event_id_fkey`. Fixed by deleting artefact-family tables first (documented in CLEAR_TABLES ordering comment).

## [ADR-1014 Sprint 1.1 — e2e harness scaffold] — 2026-04-22

**ADR:** ADR-1014 — E2E test harness + vertical demo sites (partner-evidence grade)
**Sprint:** Phase 1, Sprint 1.1 — Workspace scaffold

### Added
- `tests/e2e/` — new Bun workspace (`@consentshield/e2e`). Added to root `package.json` `workspaces` array.
- `tests/e2e/package.json` — exact-pinned `@playwright/test@1.52.0`, `dotenv@17.4.2`, `typescript@5.9.3`, `@types/node@20.19.39`. Scripts: `test`, `test:smoke`, `test:full`, `test:partner`, `test:controls`, `report`, `install:browsers`.
- `tests/e2e/tsconfig.json` — extends `tsconfig.base.json`.
- `tests/e2e/playwright.config.ts` — chromium + webkit projects default; firefox project gated behind `PLAYWRIGHT_NIGHTLY=1`. HTML + JSON + list reporters. Trace retain-on-failure. Nightly adds one retry + video. PR runs 0 retries (flakes must be diagnosed, not masked).
- `tests/e2e/utils/env.ts` — env loader (`.env.e2e` local / `.env.partner` when `PLAYWRIGHT_PARTNER=1`), required-keys guard, ESM-safe path resolution via `fileURLToPath(import.meta.url)`.
- `tests/e2e/utils/trace-id.ts` — ULID-shaped per-test trace id using `crypto.randomBytes`. Threads through Worker logs → buffer rows → R2 manifests → evidence archive (wire-up lands in Sprints 1.3 + 1.4).
- `tests/e2e/utils/fixtures.ts` — extended Playwright `test` with `env`, `traceId`, `tracedRequest` fixtures. Attaches `trace-id.txt` to each test so the id is in the archive even on pass.
- `tests/e2e/specs/README.md` — normative test-spec template. 8 sections: title / intent / setup / invariants / proofs / pair-with-negative / fake-positive defence / evidence outputs. Every `*.spec.ts` must have a sibling `specs/<slug>.md` (1:1 mapping enforced in review).
- `tests/e2e/specs/smoke-healthz.md` — spec doc for the first smoke test.
- `tests/e2e/smoke-healthz.spec.ts` — `@smoke`-tagged probe of `APP_URL` / `ADMIN_URL` / `MARKETING_URL` `/healthz` (falls back to `/`). Asserts status < 500 + non-empty body + trace id attachment.
- `tests/e2e/controls/README.md` + `tests/e2e/controls/smoke-healthz-negative.spec.ts` — preview of the Sprint 5.4 sacrificial-control pattern. Control asserts `'ok' === 'not-ok'` — MUST fail red on every run.
- `tests/e2e/README.md` — workspace orientation + discipline rules (spec 1:1, paired negatives, observable-state-only, trace-id threading, controls-must-fail).
- `tests/e2e/.gitignore` — `test-results/`, `playwright-report/`, `blob-report/`, `.tsbuild/`, `.env.e2e`, `.env.partner`.
- Root `package.json` — added scripts `test:e2e`, `test:e2e:smoke`, `test:e2e:full`, `test:e2e:partner`, `test:e2e:report` (all delegate to the workspace).

### Tested
- [x] `bun install` — workspace picked up, 12 packages resolved; `bun.lock` updated.
- [x] `bunx tsc --noEmit` in `tests/e2e/` — clean.
- [x] `bunx playwright test --list` — 8 tests discovered (3 surfaces × 2 browsers + 1 control × 2 browsers). Config loads; fixtures resolve.

### Outcome
Foundation is in place. Sprint 1.2 (Supabase test-project bootstrap + fixture factory) can start. `bun run test:e2e:smoke` against running local servers is deferred to Sprint 1.2 — the harness needs `.env.e2e` seeded and the 3 servers up.

## [ADR-1009 Sprint 2.4] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.4 — env purge

### Removed
- `app/.env.local` — `SUPABASE_SERVICE_ROLE_KEY=sb_secret_*` line (was line 4). The customer-app runtime stopped reading it in Sprint 2.3; removing it from env means any accidental re-introduction hits `UnconfiguredError` / undefined at call time instead of silently falling back to service-role powers.
- `app/.env.local.bak` — sed backup created during the purge, deleted (would have contained the removed plaintext secret; already in .gitignore but extra caution).

### Unchanged
- Root `.env.local` — `SUPABASE_SERVICE_ROLE_KEY` retained. Used by `tests/rls/helpers.ts` admin ops (seedApiKey, createTestOrg) which run outside the customer-app runtime.
- Vercel customer-app project — already had no service-role entry (ADR-0009 purged it previously). Verified with `vercel env ls`.

### Outcome
**Phase 2 CLOSED.** The v1 API surface runs entirely as `cs_api` via direct Postgres (Supavisor pooler, transaction mode). `SUPABASE_SERVICE_ROLE_KEY` has zero reachability from the customer-app runtime — revoked at the DB layer AND absent from every customer-app env (local + Vercel).

## [ADR-1009 Sprint 2.1] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.1 — cs_api role activation (env + secrets)

### Changed

- **Supabase Postgres role:** `cs_api` rotated from `NOLOGIN` → `LOGIN` with a strong password (migration 20260801000006 set a placeholder; rotated out-of-band via psql with an `openssl rand -base64 32`-derived value).
- **`.secrets`:** added `CS_API_PASSWORD` (raw) and `SUPABASE_CS_API_DATABASE_URL` (Supavisor transaction-mode pooler connection string).
- **`app/.env.local` + repo-root `.env.local`:** `SUPABASE_CS_API_DATABASE_URL` added so local dev + vitest pick up the cs_api pool connection.
- **Vercel (`consentshield` project):** `SUPABASE_CS_API_DATABASE_URL` set for both production and preview environments via `vercel env add`.

### Discovery (2026-04-21)

Supabase is rotating project JWT signing keys from HS256 (shared secret) to ECC P-256 (asymmetric). The legacy HS256 secret is flagged "Previously used" in the dashboard. This changes the scoped-role activation pattern permanently:

- HS256-signed role JWTs (like `SUPABASE_WORKER_KEY`) are living off the legacy key's verification tail; they will stop working when it's revoked.
- ECC P-256 is asymmetric — we cannot mint new role JWTs from our side.
- **Going forward:** scoped roles activate via direct Postgres (LOGIN + password + Supavisor pooler), NOT via HS256-signed JWTs on Supabase REST. ADR-1009 Phase 2 establishes this pattern for cs_api; the Cloudflare Worker will need the same migration eventually.
- `sb_secret_*` (new API-key format) is an opaque service-role token, **not** the JWT signing secret.

Captured in `.wolf/cerebrum.md` (Key Learnings + Decision Log) and the `reference_supabase_platform_gotchas` memory for cross-session durability.

### `.secrets` parsing gotcha

`SUPABASE_DATABASE_PASSWORD=jxFENChEAG4cZdjZ\` in the file — the trailing `\` is line-continuation when bash sources. Naive `source .secrets` produces a 77-char mangled password and psql auth fails. Parse individual values with `grep "^KEY=" .secrets | sed 's/^KEY=//; s/\\$//'`. Captured in cerebrum Do-Not-Repeat.

## [Sprint 4.1 — ADR-0026, afternoon] — 2026-04-17

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 4, Sprint 4.1 — soft-privacy + Ignored Build Step scripts

### Added (soft-privacy layer — pre-launch URL containment)
- `app/src/app/robots.ts` + `admin/src/app/robots.ts` — robots.txt routes that disallow `User-Agent: *` plus 30 named search and AI crawlers (Googlebot, Google-Extended, GPTBot, ChatGPT-User, anthropic-ai, ClaudeBot, PerplexityBot, CCBot, Bytespider, Amazonbot, Applebot-Extended, Meta-ExternalAgent, etc.).
- `<meta name="robots">` in both apps' root layout: `noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai`.
- `X-Robots-Tag` HTTP header on every response, via `async headers()` in both `app/next.config.ts` and `admin/next.config.ts`. Covers API routes and non-HTML bodies.
- Smoke-verified with `curl`: header present on `/` and `/robots.txt`; full disallow list served on `/robots.txt`.

### Added (Ignored Build Step)
- `app/scripts/vercel-should-build.sh` — exit 0 skips the build; checks `git diff` for changes in `app/**`, `packages/**`, `worker/**`, `supabase/**`, root `package.json`, `bun.lock`, `tsconfig.base.json`.
- `admin/scripts/vercel-should-build.sh` — same pattern; admin builds on `admin/**`, `packages/**`, `supabase/**`, root `package.json`, `bun.lock`, `tsconfig.base.json`. NOT on `app/**` or `worker/**`.
- Both scripts mode `0755`.

### Deferred (owner dashboard steps)
- Wire `bash app/scripts/vercel-should-build.sh` into `consentshield` Vercel project's Settings → Git → Ignored Build Step.
- Wire `bash admin/scripts/vercel-should-build.sh` into `consentshield-admin` Vercel project likewise.
- Add `admin.consentshield.in` domain to `consentshield-admin` Vercel project + Cloudflare CNAME.
- Cloudflare Access gate on `admin.consentshield.in`.
- Create Sentry project `consentshield-admin` + set `SENTRY_DSN_ADMIN` env (script once DSN is known).

## [Sprint 4.1 — ADR-0026] — 2026-04-17

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 4, Sprint 4.1 — Vercel split + CI isolation guards (code piece)

### Added
- `scripts/check-no-admin-imports-in-app.ts` — walks `app/src/`, resolves each import path, fails if any lands inside `admin/` or names an `@consentshield/admin-*` scoped package. Proper path resolution so `app/(operator)/` inside admin's Next.js route groups does not false-positive.
- `scripts/check-no-customer-imports-in-admin.ts` — same pattern, inverse direction.
- `scripts/check-env-isolation.ts` — detects the deploying Vercel project via `VERCEL_PROJECT_NAME` (fallback: CWD). Customer project must not carry any `ADMIN_*` var; admin project must not carry customer-only secrets (`MASTER_ENCRYPTION_KEY`, `DELETION_CALLBACK_SECRET`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `TURNSTILE_SECRET_KEY`). Secret values are never logged — only names.
- `.github/workflows/monorepo-isolation.yml` — GitHub Actions workflow running both import guards on every PR to `main` and every push to `main`. Ubuntu + Bun; no deps beyond Node built-ins.

### Changed
- `app/package.json` + `admin/package.json` — added `prebuild` script `bun ../scripts/check-env-isolation.ts` so the env isolation check runs inside each Vercel build step automatically. Bun executes the TS script natively; no `tsx` dependency required in the build image.

### Tested
- [x] Clean scan of `app/src/` — OK, 69 files, exit 0
- [x] Clean scan of `admin/src/` — OK, 31 files, exit 0
- [x] Injected violation (`app/src/__violation-test.ts` importing from `admin/src/proxy`) — FAIL detected, exit 1
- [x] `VERCEL_PROJECT_NAME=consentshield ADMIN_FAKE_KEY=x` — FAIL, ADMIN_FAKE_KEY flagged, exit 1
- [x] `VERCEL_PROJECT_NAME=consentshield` clean — OK, exit 0
- [x] `cd app && bun run prebuild` — OK, env isolation intact for customer project

### Deferred to owner (infra, Vercel dashboard + Cloudflare + Sentry)
- New Vercel project `consentshield-admin`, Root Directory = `admin/`, domain `admin.consentshield.in`
- Cloudflare Access on `admin.consentshield.in` (GitHub-OAuth restricted)
- Separate Sentry project + `SENTRY_DSN_ADMIN`
- Vercel "Ignored Build Step" on both projects (skip cross-app churn)
- First-PR smoke that the workflow runs green on CI

## [Sprint 4.1] — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 4, Sprint 4.1 — Bootstrap admin user

### Added
- `scripts/bootstrap-admin.ts` — one-shot Bun script (not a migration) that promotes an existing `auth.users` row to the initial platform_operator admin. Idempotent; refuses a second run. Distinct exit codes per failure class: 2 for flag/env, 3 for idempotency, 4 for missing auth user, 1 for unexpected DB errors.

### Executed
- Rehearsal with `bootstrap-test@consentshield.in` — all 3 invariants verified (auth claims, admin_users row, re-entry refusal). Cleanup via `auth.admin.deleteUser` cascaded the admin_users row via ON DELETE CASCADE.
- Real bootstrap of `a.d.sudhindra@gmail.com` (auth id `c073b464-34f7-4c55-9398-61dc965e94ff`) with display name `Sudhindra Anegondhi`. Post-run join query confirms `is_admin=true`, `admin_role='platform_operator'`, `bootstrap_admin=true`, `status='active'`.

### Changed
- `docs/admin/architecture/consentshield-admin-platform.md` §10 — extended with full bootstrap procedure (sign up → run script → sign in → verify → register second hardware key). Exit-code table included so any future operator running the script knows what each failure class means.

### Next operator actions (NOT part of this sprint)
- Register a second hardware key via Supabase Auth before flipping `ADMIN_HARDWARE_KEY_ENFORCED=true` (Rule 21 — AAL2 enforcement requires backup key).
- Set CF_* Supabase secrets so the `admin-sync-config-to-kv` cron (Sprint 3.2) writes to Cloudflare KV instead of returning dry_run.

## [Sprint 1.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure (Bun Workspace — `app/` + `admin/` + `packages/*`)
**Sprint:** Phase 1, Sprint 1.1 — Workspace bootstrap + customer app moved to `app/`

### Added
- `tsconfig.base.json` at repo root — shared compiler options for all workspace members.
- `worker/package.json` — zero runtime deps, `@cloudflare/workers-types` as devDep (Worker is now a workspace member).
- `app/package.json` — `@consentshield/app`, customer deps (Next 16.2.3, React 19.2.5, Sentry 10.48.0, Supabase SSR 0.10.2, Upstash Redis, JSZip, input-otp) + devDeps (eslint-config-next, tailwind, esbuild, miniflare, vitest).
- Root `vitest.config.ts` dedicated to the RLS test suite (`include: ['tests/rls/**/*.test.ts']`).
- Root `bun run test:rls` script — cross-app RLS isolation runner.
- `app/.env.local` — copy of root `.env.local` so the app workspace's vitest picks up dev env from its own CWD. Both paths gitignored.

### Changed
- Repo root `package.json` is now a Bun workspace root (`"workspaces": ["app", "worker"]`); customer app dependencies moved into `app/package.json`. Admin + `packages/*` will be added as workspace members in their respective sprints (Bun rejects workspace entries that point at non-existent directories).
- `src/` → `app/src/` (git mv, history preserved).
- `tests/{buffer,rights,worker,workflows,fixtures}/` → `app/tests/` (git mv).
- `tests/rls/` stays at repo root (cross-app RLS isolation suite).
- `next.config.ts`, `next-env.d.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `sentry.client.config.ts`, `sentry.server.config.ts`, `vitest.config.ts`, `tsconfig.json` → `app/`.
- `app/tsconfig.json` extends `../tsconfig.base.json`; keeps `tests/worker` in `exclude` so Next build's type check doesn't stumble on the Miniflare harness.
- `app/tests/worker/harness.ts` — `WORKER_ENTRY` relative path rewritten to `../../../worker/src/index.ts` (one extra level after the move).
- `app/tests/buffer/lifecycle.test.ts` — RLS helpers import path rewritten to `../../../tests/rls/helpers` (reaches the root-level RLS utilities).
- `CLAUDE.md` — tree diagram rewritten for monorepo layout; build/test commands rewritten for Bun workspace (`cd app && bun run build`, `bun run test:rls`).
- `docs/architecture/consentshield-definitive-architecture.md` — Document Purpose section's `src/app/` reference updated to `app/src/app/`.
- `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — normative reminder's `src/app/` references updated to `app/src/app/`.
- `docs/design/screen designs and ux/consentshield-screens.html` — header comment's `src/app/` reference updated to `app/src/app/`.
- `.gitignore` — added `app/.env.local`, `admin/.env.local`, `app/.next/`, `admin/.next/`.

### Tested
- [x] `bun install` from repo root — 1152 packages installed, workspace `bun.lock` updated — PASS
- [x] `cd app && bun run lint` — zero warnings — PASS
- [x] `cd app && bun run build` — Next.js 16.2.3 Turbopack, all 38 routes compiled — PASS
- [x] `cd app && bun run test` — 7 test files, 42/42 tests pass — PASS
- [x] `bun run test:rls` from root — 2 test files (isolation + url-path), 44/44 tests pass — PASS
- [x] Combined count: 86/86 matches Phase 2 close baseline — PASS

### Deferred to subsequent sprints
- `admin` workspace member + admin app scaffold — Sprint 3.1
- `packages/*` workspace entries — Sprint 2.1
- Vercel project root-directory change + `consentshield-admin` project creation + Cloudflare Access + CI isolation guards — Sprint 4.1 (point of no return)
- Cleaner shared test-utility extraction (today: `app/tests/buffer/lifecycle.test.ts` imports `../../../tests/rls/helpers`) — deferred; not a correctness issue, just a path hop

## [Sprint 2.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 2, Sprint 2.1 — Extract 3 shared packages (one commit per package)

### Added
- `packages/compliance/` — `@consentshield/compliance`, deterministic compliance logic (`computeComplianceScore`, `daysBetween`, `daysUntilEnforcement`, `isoSinceHours`, `nowIso`, `composePrivacyNotice` + their types). Commit `4b48545`.
- `packages/encryption/` — `@consentshield/encryption`, per-org key derivation helpers (`encryptForOrg`, `decryptForOrg`). `@supabase/supabase-js` declared as peerDependency (takes `SupabaseClient` as a parameter). Commit `4eb34d3`.
- `packages/shared-types/` — `@consentshield/shared-types`, stub package for schema-derived types shared by both apps. Populated by subsequent ADRs (0020 DEPA, 0027 admin). Commit `fec7a0a`.

### Changed
- Root `package.json` workspaces → `["app", "worker", "packages/*"]` (added on the compliance commit).
- `app/package.json` — added `@consentshield/compliance`, `@consentshield/encryption`, `@consentshield/shared-types` as `workspace:*` dependencies.
- `git mv` `app/src/lib/compliance/{score,privacy-notice}.ts` → `packages/compliance/src/`. Empty `app/src/lib/compliance/` directory removed.
- `git mv` `app/src/lib/encryption/crypto.ts` → `packages/encryption/src/`. Empty `app/src/lib/encryption/` directory removed.
- 7 call sites in `app/src/` rewired from relative `@/lib/{compliance,encryption}` paths to `@consentshield/{compliance,encryption}` package imports.

### Tested (after each of the 3 commits)
- [x] `cd app && bun run lint` — zero warnings — PASS
- [x] `cd app && bun run build` — all 38 routes compiled — PASS
- [x] `cd app && bun run test` — 7 files, 42/42 tests pass — PASS
- [x] `bun run test:rls` (root) — 2 files, 44/44 tests pass — PASS
- [x] Combined: 86/86 (matches Sprint 1.1 baseline)
- [x] `grep -rn "from '@/lib/encryption\|from '@/lib/compliance" app/src/` → 0 hits — PASS

## [Sprint 3.1] — 2026-04-16

**ADR:** ADR-0026 — Monorepo Restructure
**Sprint:** Phase 3, Sprint 3.1 — Admin app skeleton + stub auth gate

### Added
- `admin/` — new Next.js 16 workspace member (`@consentshield/admin`). Mirrors `app/`'s layout (`src/app/`, `src/lib/`, `tests/`, per-app Supabase clients, per-app Sentry config) per the "share narrowly, not broadly" principle.
- `admin/src/proxy.ts` — host check (`admin.consentshield.in` / Vercel preview / localhost) + Supabase session validation + `app_metadata.is_admin` check + AAL2 hardware-key check with stub-mode bypass (`ADMIN_HARDWARE_KEY_ENFORCED=false` for local dev). Implements Rules 21 + 24 of the admin platform.
- `admin/src/lib/supabase/{server,browser}.ts` — admin's own Supabase SSR clients. Separate from the customer app's.
- `admin/src/app/(auth)/login/page.tsx` — stub login page with instructions for bootstrapping an admin via Supabase SQL editor. Real flow (Supabase Auth + WebAuthn hardware-key enrolment) lands in ADR-0028.
- `admin/src/app/(operator)/layout.tsx` — red admin-mode strip (Rule 25 visual cue) + red-bordered sidebar with 11 nav stubs keyed to ADR-0028..0036. Matches `docs/admin/design/consentshield-admin-screens.html`.
- `admin/src/app/(operator)/page.tsx` — placeholder Operations Dashboard. Reads the current user from Supabase, renders their display name, and shows the admin Rules 21–25 summary. Real panel ships in ADR-0028.
- `admin/sentry.{client,server}.config.ts` — separate Sentry project DSN (`SENTRY_DSN_ADMIN`); identical `beforeSend` scrubbing to the customer app.
- `admin/eslint.config.mjs`, `admin/vitest.config.ts`, `admin/tsconfig.json` (extends `../tsconfig.base.json`), `admin/next.config.ts`, `admin/postcss.config.mjs` (from `create-next-app`).
- `admin/tests/smoke.test.ts` — trivial smoke test proving the admin workspace's test runner is wired up. Real tests ship with ADR-0028+.

### Changed
- Root `package.json` workspaces → `["app", "admin", "worker", "packages/*"]` (added `admin`).
- Dev port convention: `app` on 3000, `admin` on 3001 (configured via `"dev": "next dev --port 3001"` in `admin/package.json`). Lets both apps run side-by-side during local dev.

### Tested
- [x] `cd admin && bun run lint` — zero warnings — PASS
- [x] `cd admin && bun run build` — Next.js 16.2.3 Turbopack, 2 routes (`/`, `/login`) compiled — PASS
- [x] `cd admin && bun run test` — 1 file, 1/1 tests pass — PASS
- [x] `cd app && bun run build` — baseline unchanged (all 38 routes) — PASS
- [x] `cd app && bun run test` — baseline unchanged (42/42) — PASS
- [x] `bun run test:rls` — baseline unchanged (44/44) — PASS
- [x] Combined total: 87 (86 baseline + 1 admin smoke)

### Deferred
- `bunx shadcn@latest init` inside `admin/` — skeleton uses raw Tailwind; first ADR-0028 sprint that needs a shadcn primitive will run it.
- `admin/next.config.ts` Sentry wrapping — out of scope for the skeleton.
- Real login + hardware-key enrolment UI — ADR-0028.
- Env vars on Vercel (`ADMIN_SUPABASE_DB_URL`, `ADMIN_HARDWARE_KEY_ENFORCED=true`, `SENTRY_DSN_ADMIN`, etc.) — Sprint 4.1.
