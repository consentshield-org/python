# ADR-1014: End-to-end test harness + vertical demo sites (partner-evidence grade)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date proposed:** 2026-04-22
**Date completed:** —
**Supersedes:** —
**Depends on:**
- ADR-0058 (split-flow onboarding — signup → wizard → first consent is the longest E2E path and must stay green).
- ADR-1013 (Next.js runtime fully on direct-Postgres; the harness does not need to mint HS256 scoped-role JWTs).
- ADR-1009 / 1011 / 1012 (v1 API surface exists and is stable — the API integration dimension is covered by the sibling ADR-1015 but runs against the same harness).
**Sibling:** ADR-1015 (v1 API integration tests + customer developer docs).

---

## Context

Today's regression coverage is piecewise. `app/tests/` holds worker-harness, buffer, rights, and workflow unit tests. `tests/rls/` covers cross-app RLS isolation. There is no end-to-end harness that exercises the full pipeline as a real data principal would: browser → banner (served by Cloudflare Worker) → consent event → HMAC-verified Worker POST → buffer row → delivery Edge Function → R2 object → receipt. The closest we have is ADR-0058 Sprint 1.5 which already carries an open `[ ]` for a Playwright integration test.

The product is simultaneously approaching prospective-partner conversations — audit firms, BFSI prospects, enterprise evaluators. These reviewers will want more than "we have tests": they will want to inspect them, re-run them against their own environment, and verify the results were not fabricated. Three concrete requirements follow:

1. **Coverage depth must be full.** Every positive assertion must be observable state — a DB row, an R2 object hash, a trace ID traversing the pipeline — not a naked HTTP 200.
2. **Partner reproducibility.** A reviewer clones the repo, points at their own Supabase project, and runs the same suite end-to-end. They observe the same evidence artefacts.
3. **Fake-positive defence.** Every positive test is paired with a negative control. A suite of sacrificial "broken-on-purpose" tests MUST fail red; if any pass, the whole suite is flagged. Mutation testing via Stryker enforces that assertions actually discriminate.

The four verticals ConsentShield targets — e-commerce, healthcare, BFSI, SaaS — differ enough in their sectoral templates, tracker landscapes, and consent purposes that a single generic demo site does not stress the platform. Hosting one demo site per priority vertical gives us:

- A real origin per vertical for the Worker's Origin/Referer validation.
- Authentic tracker mixes (GA + Meta Pixel + Razorpay in e-commerce; no-FHIR-persistence enforcement in healthcare; KYC + credit-bureau third-party sharing in BFSI).
- An acceptance signal for the sectoral-template switcher (ADR-0057) and the onboarding Step 4 apply-template call (ADR-0058).

The SaaS vertical is covered implicitly by app/admin/marketing themselves (they are SaaS products); this ADR explicitly excludes a fourth demo and scopes to **ecommerce + healthcare + BFSI**.

## Decision

Build a full-pipeline, partner-evidence-grade E2E test harness, delivered in five phases. The harness is Playwright-driven, runs against an isolated Supabase test project, exercises real Cloudflare Worker + Edge Function deployments, and publishes hash-sealed evidence artefacts to an R2-backed static index.

**Key choices (all locked with the user before drafting):**

| Decision | Choice | Alternatives considered |
|----------|--------|------------------------|
| Framework | Playwright | Cypress (lesser parallelism, weaker trace), Puppeteer (no built-in test runner). |
| Demo-site host | Railway | Vercel (user already has Railway sub; isolates demo-site outages from core product deploys). |
| Verticals (v1) | Ecommerce + Healthcare + BFSI | Adding SaaS (redundant with app/admin/marketing), adding EdTech (not in current customer ICP). |
| Coverage depth | Full pipeline — Worker HMAC, delivery, R2, connectors | Minimum browser-only path (rejected — insufficient for audit review). |
| Evidence host | R2 bucket + static index at `testing.consentshield.in` | GitHub Actions artifacts alone (90-day retention, non-public). |
| Partner reproduction bar | Clone + bootstrap against their own Supabase project | Shared read-only test env (rejected — reviewers cannot trust state they did not write). |
| Fake-positive defence | Paired pos/neg + broken-on-purpose controls + Stryker mutation testing | Pos/neg alone (insufficient — does not catch always-pass assertions). |
| Test documentation | Every test has a written spec file in `tests/e2e/specs/` (intent, setup, invariants, expected proofs). The doc IS the contract. | Code-only tests (rejected — reviewers must be able to read intent). |

## Consequences

- **Infrastructure costs.** Railway adds three long-running demo services (~$15–30/month total). R2 evidence bucket is effectively free at our volume. Supabase test project uses the free tier until we outgrow it.
- **Workflow change.** Every new `/v1/*` endpoint and every new pipeline surface ships with at least one positive + one negative E2E test in the same PR. A Sprint-1 deliverable of every future ADR should be its own paired E2E tests.
- **CI time.** Full nightly run estimated at 20–35 min. PR runs use a subset gated by commit-path. Target: under 8 min on PR, under 45 min nightly.
- **Test-doc discipline.** `tests/e2e/specs/<name>.md` is authored before the test code. This slows initial authoring by ~30% but makes every test reviewer-legible.
- **Mutation testing overhead.** Stryker adds ~3–5x the unit-test runtime on its own modules; gated behind a nightly `test:mutation` script, not on PR.
- **Partner onboarding cost.** The bootstrap script does the heavy lifting; 30-minute setup target is tight but achievable if the partner has a Supabase account and a Cloudflare account ready.

---

## Implementation Plan

### Phase 1 — Harness foundations

#### Sprint 1.1: Workspace scaffold

**Estimated effort:** 1 day

**Deliverables:**
- [x] New root workspace package `tests/e2e/` (Bun workspace member per ADR-0026).
- [x] `playwright.config.ts` with projects: `chromium`, `webkit`, `firefox` (firefox gated behind nightly).
- [x] `tests/e2e/specs/README.md` — normative test-spec template (intent / setup / invariants / expected proofs / pair-with-negative).
- [x] `tests/e2e/utils/` — env loader, trace-id helper, shared fixtures.
- [x] Root `package.json` scripts: `test:e2e` (PR subset), `test:e2e:full` (nightly), `test:e2e:partner` (with their env).
- [x] First smoke spec (`smoke-healthz.spec.ts`) + sibling spec doc + sacrificial control (`controls/smoke-healthz-negative.spec.ts`).

**Testing plan:**
- [x] `bunx playwright test --list` discovers 8 tests (3 surfaces × 2 browsers + 1 control × 2 browsers).
- [x] `bunx tsc --noEmit` clean in `tests/e2e/`.
- [ ] `bun run test:e2e:smoke` against running local servers — deferred to Sprint 1.2 once bootstrap script seeds `.env.e2e` and servers are up.

**Status:** `[x] complete`

#### Sprint 1.2: Supabase test-project bootstrap

**Estimated effort:** 2 days

**Deliverables:**
- [x] `scripts/e2e-bootstrap.ts` — reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from the repo-root `.env.local`; verifies the `api_keys` table is reachable (schema applied); seeds 3 vertical fixtures (ecommerce / healthcare / bfsi) each with: auth.user + account + account_membership + organisation + org_membership + 3 web_properties + 1 real `cs_test_*` API key (SHA-256 hashed). Writes all ids + plaintext keys to a gitignored `.env.e2e`. Idempotent — re-running reuses existing fixtures, matches API keys by hash to reuse plaintext.
- [x] Idempotent cleanup: `scripts/e2e-reset.ts` truncates buffer tables + DEPA artefact state generated during tests (FK-ordered: expiry_queue → revocations → artefact_index → artefacts → consent_events → independent buffers) + deletes non-fixture E2E-tagged auth.users. Fixture accounts explicitly preserved.
- [x] Fixture set: 3 organisations (one per vertical), 3 accounts, 9 web properties (3 per org: production URL, checkout/portal, localhost sandbox probe), 3 seeded API keys with full scope + sandbox rate tier.
- [x] `.env.e2e` + `.env.partner` added to root `.gitignore`.
- [x] `tests/e2e/utils/fixtures.ts` extended with `ecommerce`, `healthcare`, `bfsi` fixtures that resolve from `.env.e2e` on first access.

**Scope amendment:** The ADR's original deliverable said "seeds the scoped roles … reads each role's password back". Scoped-role password rotation is a _fresh-partner-project_ concern — against an existing dev Supabase it would invalidate app/admin/marketing `.env.local`. Moved to Sprint 5.1 (partner bootstrap). Sprint 1.2 scope is fixture seeding + `.env.e2e` emission, which is what the harness actually needs to start running.

**Testing plan:**
- [x] Bootstrap on dev Supabase completes in under 10 min — measured **7.6s** first run (fresh fixtures), **4.4s** re-run (full reuse).
- [x] Reset between runs completes in under 20 s — measured **3.9s**.
- [x] Idempotency: second bootstrap run reuses every fixture (3 × "reusing auth.user / account / organisation / api_key"), emits identical `.env.e2e`.
- [x] `bunx playwright test --list` loads `.env.e2e` (45 env keys) + still discovers 8 tests.
- [x] `bunx tsc --noEmit` clean on scripts + tests/e2e.

**Status:** `[x] complete`

#### Sprint 1.3: Worker local harness

**Estimated effort:** 1 day

**Deliverables:**
- [x] `tests/e2e/utils/worker-harness.ts` — `startWorker()` spawns `bunx wrangler dev --local` from `worker/` on port 8787 and waits for the "Ready on" log; falls back to `WORKER_URL` env if set. Tear-down via `stop()` sends SIGTERM + SIGKILL after 5s.
- [x] `tests/e2e/utils/hmac.ts` — `signConsentEvent()` / `computeHmac()` / `tamperSignature()` / `signWithStaleTimestamp()`. Mirrors the Worker's `${orgId}${propertyId}${timestamp}` HMAC-SHA256 hex scheme from `worker/src/hmac.ts`. Drift between the two would cause the paired-positive test to fail red — intentional tripwire.
- [x] Bootstrap extension (carried into Sprint 1.2 deliverables): `scripts/e2e-bootstrap.ts` now reads `web_properties.event_signing_secret` back and emits one `consent_banners` row per property (required FK target for `consent_events.banner_id`). `.env.e2e` gains `FIXTURE_<P>_PROPERTY_<n>_SECRET` and `FIXTURE_<P>_PROPERTY_<n>_BANNER_ID` for all 9 fixture properties.
- [x] `tests/e2e/utils/fixtures.ts` extended with `WebPropertyFixture { id, url, signingSecret, bannerId }`; `VerticalFixture.properties[]` exposes the new shape.
- [x] `tests/e2e/utils/supabase-admin.ts` — service-role client for observable-state assertions (`countConsentEventsSince`, `latestConsentEvent`). Test-code-only; excluded from the `scripts/check-no-service-role-in-customer-app.ts` grep gate by path.
- [x] First paired pipeline test: `tests/e2e/worker-consent-event.spec.ts` + `worker-consent-event-tampered.spec.ts` + sibling spec doc at `specs/worker-consent-event.md`.

**Testing plan:**
- [x] Send a valid signed event → receive 202 + see row in `public.consent_events` (observable-state: 5 column assertions — `org_id`, `property_id`, `banner_id`, `event_type='consent_given'`, `origin_verified='hmac-verified'`) + row count delta = 1.
- [x] Send a tampered event (one hex char of signature flipped) → receive 403 + body contains "Invalid signature" + row count delta = 0 after a 1s settle window.
- [x] Paired positive + negative use **different fixture properties** (ecommerce.properties[0] vs [1]) so they can run in parallel without polluting each other's count-since-cutoff queries. Documented as an invariant in the spec doc.
- [x] Sacrificial control (`controls/smoke-healthz-negative.spec.ts`) still fails red on every run.
- [x] `bunx tsc --noEmit` clean on `tests/e2e/` + on scripts.

**Measured:**
- Pipeline positive: 591 ms (wrangler-dev local, chromium).
- Pipeline negative: 1.4 s (includes 1 s no-write settle window).
- Combined parallel run: 1.9 s for the pair.

**Setup requirement (documented):**
- `worker/.dev.vars` must contain `SUPABASE_WORKER_KEY=<value>` for local wrangler dev to reach Supabase. For the test harness, a service-role value is an acceptable local stand-in (same `tests/rls/` pattern — test-code only, file is mode 0600 and gitignored). Production deployments continue to use the scoped `cs_worker` JWT set via `wrangler secret put`. `worker/.dev.vars` and `worker/.dev.vars.local` added to root `.gitignore`.

**Status:** `[x] complete`

#### Sprint 1.4: Evidence writer + seal + verification CLI

**Estimated effort:** 2 days

**Deliverables:**
- [x] `tests/e2e/utils/evidence.ts` — `startRun()` / `addAttachment()` / `copyDirAttachment()` / `recordTest()` / `finalize()`. Writes to `tests/e2e/evidence/<commitShort>/<runId>/`. Each run gets `manifest.json` + `seal.txt` + `attachments/` (playwright-report/, results.json, responses/, trace-ids/). `manifest.json` carries schema version, ADR ref, commit SHA, branch, Node version, OS, Playwright projects, full per-test outcomes (file, title, project, status, duration, retries, trace_ids, first line of error_message), summary (total/passed/failed/skipped/flaky), and a sorted list of every attachment with `{ path, size, sha256 }`.
- [x] `tests/e2e/utils/evidence-seal.ts` — `verifySeal(runDir)` parses `seal.txt`, recomputes the per-file SHA-256 ledger, and returns `{ ok, expected, actual, mismatches[] }` with per-file MODIFIED/ADDED/REMOVED diagnostics.
- [x] `tests/e2e/utils/evidence-reporter.ts` — Playwright `Reporter` implementation wired into `playwright.config.ts` reporters. `onBegin → startRun`, `onTestEnd → recordTest + harvest attachments`, `onEnd → copy playwright-report/ + results.json + finalize`.
- [x] `scripts/e2e-verify-evidence.ts` — partner-facing CLI. `bunx tsx scripts/e2e-verify-evidence.ts <run-dir>` → exit 0 + summary on success, exit 1 + per-file mismatches on tamper, exit 2 on usage/IO error.
- [x] SHA-256 `seal.txt` over the entire archive (sorted `<sha256>  <relpath>` ledger, one line per file, root hash = `sha256(ledger)`). Seal is written to `seal.txt`; itself excluded from the ledger so the file containing the seal is not self-referential.
- [x] `tests/e2e/evidence/` + `attachments/.bak`-shaped tamper-residue added to `tests/e2e/.gitignore`.

**Scope amendments vs original ADR text:**

1. **R2 upload deferred to Sprint 5.3.** The original Sprint 1.4 deliverable included uploading each archive to R2 at `runs/<sha>/<runId>/`. Sprint 5.3 already owns the `testing.consentshield.in` public index (the downstream consumer of those R2 objects). Building the upload path without the consumer is premature; Sprint 1.4 ships the local, verifiable archive + partner-readable CLI, and Sprint 5.3 will add the R2 publication step + static site. The sigv4 helper in `app/src/lib/storage/sigv4.ts` (ADR-0040) is ready to reuse when we get there.
2. **Static site at testing.consentshield.in** — fully owned by Sprint 5.3 per the original ADR text. Duplicate mention here removed.
3. **DB snapshot attachment** — pg_dump of touched tables is a useful attachment, but Sprint 1.4 ships only in-test JSON attachments (response bodies, observed row). Adding pg_dump collection is a small follow-up inside Phase 3 once more tests are writing meaningful DB state.
4. **Stryker HTML attachment** — gated on Phase 4 landing, not Sprint 1.4.

**Testing plan:**
- [x] After a smoke run, `manifest.json` + `seal.txt` are written. `bunx tsx scripts/e2e-verify-evidence.ts <runDir>` → exit 0, prints manifest summary (run_id, commit, duration, tests total/passed/failed/skipped/flaky).
- [x] Tampering with any file in the archive (mutating a byte of `attachments/results.json` OR of `manifest.json`) → seal fails, CLI exits 1, per-file mismatches are printed.
- [x] Restoring the tampered file → seal re-verifies (exit 0). Idempotent.
- [x] `bunx tsc --noEmit` clean on both the scripts and the e2e workspace.

**Measured:**
- Fresh paired-pipeline run produced an 8-file archive (3 response attachments + 2 trace-id files + playwright-report/index.html + results.json + manifest.json).
- Seal root hash: `9e9f261e511e56f8…` (first run).
- End-to-end: run + seal + CLI verify in under 5 s.

**Status:** `[x] complete`

#### Sprint 1.5: First end-to-end smoke

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `tests/e2e/specs/signup-to-dashboard.md` — spec doc.
- [ ] `tests/e2e/signup-to-dashboard.spec.ts` — marketing signup → email OTP (intercepted via Resend test inbox) → onboarding wizard Steps 1–7 → dashboard welcome toast.
- [ ] Pair: `tests/e2e/signup-to-dashboard-negative.spec.ts` — expired intake token → 410 Gone at wizard boot.
- [ ] Both runs produce evidence artefacts.

**Testing plan:**
- [ ] Both the positive and the negative complete and publish artefacts.
- [ ] Mutation: change the positive assertion to `expect(true).toBe(true)` and verify the sacrificial "control" suite (Sprint 5.4) red-flags the suite.

**Status:** `[ ] planned`

---

### Phase 2 — Vertical demo sites on Railway

Each vertical site is a small standalone Next.js app deployed to Railway under a unique origin. It embeds the ConsentShield banner via the production snippet pattern and hosts realistic page types for that vertical. The origin is registered as a web property on the corresponding fixture organisation.

#### Sprint 2.1: Ecommerce demo — `demo-ecommerce.consentshield.in`

**Estimated effort:** 3 days

**Deliverables:**
- [x] Static apparel storefront: homepage (`test-sites/ecommerce/index.html`), product (`product.html`), cart (`cart.html`), checkout (`checkout.html`).
- [x] Realistic tracker embeds declared via `window.__DEMO_TRACKERS__` — Google Analytics + Hotjar (analytics), Meta Pixel (marketing), Razorpay (essential, always loads).
- [x] Config-driven banner loader (`test-sites/shared/banner-loader.js`) — reads `?cdn`, `?org`, `?prop` from the URL or localStorage, injects the production or wrangler-dev banner script accordingly. Persists across page clicks via localStorage + demo.js link-rewrite.
- [x] `test-sites/shared/demo.js` — shared per-purpose tracker injector on `consentshield:consent` + nav query-string forwarder.
- [x] `test-sites/server.js` + `test-sites/package.json` — zero-dep static server for Railway/local runs (Rule 15).
- [x] `test-sites/railway.json` — Nixpacks builder + `node server.js` start command, `/` healthcheck.
- [x] `tests/e2e/utils/static-server.ts` — dependency-free static server for the E2E harness (runs per-test on localhost:4001, matches the ecommerce fixture's `allowed_origins`).
- [x] `tests/e2e/demo-ecommerce-banner.spec.ts` + `specs/demo-ecommerce-banner.md` — browser-driven test: navigate to the demo, assert banner renders, click "Accept all", assert `consentshield:consent` page event + observable `consent_events` row with `origin_verified='origin-only'`.
- [ ] Railway deploy push + DNS → `demo-ecommerce.consentshield.in`. Railway project is provisioned (`RAILWAY_TOKEN` in `.secrets`); one empty service exists (name: `accomplished-compassion`). `railway up` from `test-sites/` is the remaining one-command step — deferred so the user can confirm the target service (rename the random Railway-provisioned name or create a dedicated one) before pushing.

**Blocker — Playwright test runtime:**
- The browser-driven test is **code-complete** but cannot green until `worker/.dev.vars` carries a proper `SUPABASE_WORKER_KEY` (HS256 JWT with `role=cs_worker` claim). Terminal B's ADR-1010 Sprint 2.1 committed `c55b661` landed a runtime role guard: the Worker now refuses to boot unless the key's JWT claims `role=cs_worker`. Our prior local stand-in (service-role key in .dev.vars) is rejected. Once ADR-1010's direct-Postgres migration lands for the Worker OR a valid cs_worker JWT is available locally, the test runs green. Until then, `WORKER_URL` should point at the deployed Worker (or the test skips cleanly).

**Tested so far:**
- [x] `bunx tsc --noEmit` clean on `tests/e2e` + scripts.
- [x] Static server utility loads the demo + serves the new 4-page tree.
- [x] Banner loader reads `?cdn` / `?org` / `?prop` and injects the correct script URL — verified manually via `curl http://127.0.0.1:4001/ecommerce/` + the page renders.
- [x] Curl POST to `/v1/events` with `Origin: http://localhost:4001` header → Worker returns 202 + buffer row (confirms fixture origin allow-list is correct). Browser path fails pending the ADR-1010 blocker above.

**Status:** `[~] in progress — demo code shipped, Railway push + Playwright runtime verification deferred`

#### Sprint 2.2: Healthcare demo — `demo-clinic.consentshield.in`

**Estimated effort:** 3 days

**Deliverables:**
- [ ] Clinic site: landing, appointment booking, patient portal login stub.
- [ ] FHIR-never-persisted enforcement probe: a synthetic page that posts a minimal FHIR Observation to a mock EHR while the banner is watching — ConsentShield must record the consent artefact without ever serialising FHIR content.
- [ ] ABDM-adjacent purpose set: `clinical_care`, `research_deidentified`, `marketing_health_optin`.
- [ ] Realistic trackers: Google Analytics only (health sites rarely use Meta Pixel).

**Testing plan:**
- [ ] The FHIR-persistence guardrail: grep the buffer tables after the clinic-demo suite — zero rows contain FHIR fields (Observation, Patient, Bundle resource names).
- [ ] ABDM-scope opt-in: explicit `clinical_care` consent → artefact stored with `depa_native=true`.

**Status:** `[ ] planned`

#### Sprint 2.3: BFSI demo — `demo-fintech.consentshield.in`

**Estimated effort:** 4 days

**Deliverables:**
- [ ] Fintech onboarding flow: KYC form, terms, consent matrix (PAN / Aadhaar / credit-bureau-share), app signup.
- [ ] Realistic trackers: Google Analytics, Razorpay, a mock credit-bureau third-party-share webhook.
- [ ] Multi-purpose consent capture: `kyc_mandatory` (legal-basis: legal_obligation, outcome: always granted), `marketing_sms` (consent), `credit_bureau_share` (consent).
- [ ] Separate legal-basis handling: kyc_mandatory row emitted as `outcome=granted` + `legal_basis=legal_obligation`, never withdrawable.

**Testing plan:**
- [ ] Withdraw `credit_bureau_share` → downstream deletion-trigger fires; kyc_mandatory artefact remains active.
- [ ] Revoke any `consent`-basis artefact → 200 OK; revoke a `legal_obligation`-basis artefact → 409 Conflict.

**Status:** `[ ] planned`

#### Sprint 2.4: Banner-embed testing framework per vertical

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `tests/e2e/utils/banner-harness.ts` — given a vertical URL, spin a browser, wait for banner paint, exercise accept/reject/customise, capture the resulting consent events.
- [ ] Cross-vertical matrix test: for each vertical × each consent outcome, assert expected artefact row + expected tracker-blocking behaviour.

**Testing plan:**
- [ ] Full matrix passes on all 3 verticals × 3 outcomes × 2 browsers (chromium, webkit).

**Status:** `[ ] planned`

---

### Phase 3 — Full-pipeline E2E suites

Each sprint delivers 1–2 positive tests and their paired negatives. All tests assert on observable state, not just HTTP status. All tests emit a trace ID that is followed through the pipeline.

#### Sprint 3.1: Signup → onboard → first consent (ADR-0058 closure)

**Deliverables:**
- [ ] Closes ADR-0058 Sprint 1.5's open `[ ]` integration test.
- [ ] Test spec + positive + negative + evidence.

**Status:** `[ ] planned`

#### Sprint 3.2: Banner → Worker HMAC → buffer → delivery → R2

**Deliverables:**
- [ ] Positive: valid event → buffer row → delivered → R2 object hash matches input payload.
- [ ] Negative pair: HMAC tampered (flip one byte of signature) → 403 + zero buffer row + zero R2 object.
- [ ] Negative pair: origin mismatch → 403 + `origin_unverified` flagged.
- [ ] Trace-ID assertion at every stage (Worker log, buffer `trace_id` column, R2 manifest).

**Status:** `[ ] planned`

#### Sprint 3.3: Rights request end-to-end

**Deliverables:**
- [ ] Positive: Turnstile + email OTP + rights_request row + compliance-contact notification + audit export containing the artefact.
- [ ] Negative pair: skip Turnstile → 403 + zero rights_request row.
- [ ] Negative pair: stale OTP → 400 + existing request stays `pending`.

**Status:** `[ ] planned`

#### Sprint 3.4: Deletion connector end-to-end

**Deliverables:**
- [ ] Positive: trigger → connector-webhook called with HMAC-signed URL → signed callback accepted → receipt emitted → buffer row cleared.
- [ ] Negative pair: tampered callback signature → 401 + receipt NOT emitted + original state preserved.
- [ ] Negative pair: timed-out callback → after SLA, admin surface shows overdue status.

**Status:** `[ ] planned`

#### Sprint 3.5: DEPA artefact lifecycle

**Deliverables:**
- [ ] Positive: record → `active` → revoke → `revoked` → expiry-window elapsed → `expired` (via cron simulation).
- [ ] Negative pair: double-revoke → 409 + no duplicate revocation row.
- [ ] Negative pair: record on withdrawn artefact → 409 + no change.

**Status:** `[ ] planned`

#### Sprint 3.6: Admin impersonation + invoice issuance

**Deliverables:**
- [ ] Positive: admin impersonates an org → performs a rights-request triage → end-impersonation → admin_audit_log contains both entries.
- [ ] Positive: invoice issuance via active issuer → PDF emitted to R2 → `public.invoices` row created.
- [ ] Negative pair: invoice issuance with no active issuer → clear error + no row written (Rule 19 enforcement).
- [ ] Negative pair: attempt to update immutable invoice field → trigger rejection.

**Status:** `[ ] planned`

#### Sprint 3.7: Negative-control pair sweep

**Deliverables:**
- [ ] Audit every positive test from Phases 1–3; ensure each has a paired negative.
- [ ] Add any missing pairs.
- [ ] Document the pairing map in `tests/e2e/specs/pair-matrix.md`.

**Status:** `[ ] planned`

---

### Phase 4 — Stryker mutation testing

Mutation testing intentionally mutates production code (change `===` to `!==`, flip booleans, drop statements) then re-runs the suite. A mutation that survives means no test detected the change — the assertion is weaker than it looks. Target: mutation score ≥ 80% on the security-critical modules.

#### Sprint 4.1: Worker module baseline

**Deliverables:**
- [ ] `.stryker.conf.mjs` for `worker/src/`.
- [ ] Baseline run — accept initial score, log escaped mutants.
- [ ] Add tests to kill the most dangerous escaped mutants (HMAC verify, origin check, timestamp window).

**Status:** `[ ] planned`

#### Sprint 4.2: Edge Functions delivery baseline

**Deliverables:**
- [ ] Stryker config for `supabase/functions/deliver-consent-events/`.
- [ ] Baseline + kill escaped mutants on: buffer marking, delivery signing, R2 write.

**Status:** `[ ] planned`

#### Sprint 4.3: v1 RPC baseline

**Deliverables:**
- [ ] Stryker config for `app/src/app/api/v1/**/*.ts` + the SECURITY DEFINER RPC wrappers.
- [ ] Baseline + kill escaped mutants on: `assert_api_key_binding`, idempotency-key handling, per-row fencing.

**Status:** `[ ] planned`

#### Sprint 4.4: CI gate

**Deliverables:**
- [ ] Nightly Stryker run publishes HTML to `testing.consentshield.in/runs/<sha>/mutation/`.
- [ ] Threshold gate: score < 80% fails the nightly build.
- [ ] Partner-readable explanation page: `/docs/test-verification/mutation-testing`.

**Status:** `[ ] planned`

---

### Phase 5 — Partner reproduction kit + evidence publication

#### Sprint 5.1: Partner bootstrap script

**Deliverables:**
- [ ] `scripts/partner-bootstrap.ts` — interactive CLI, prompts for partner's Supabase URL + service-role key + Cloudflare account, runs migrations, seeds fixtures, produces `.env.partner`.
- [ ] Idempotent; re-running wipes and rebuilds state.
- [ ] Time target: 30 min wall clock on a partner's first run.

**Status:** `[ ] planned`

#### Sprint 5.2: Documentation — how to reproduce

**Deliverables:**
- [ ] Marketing page: `marketing/src/app/docs/test-verification/page.mdx` (rendered under /docs/test-verification).
- [ ] Step-by-step: sign-ups required, secrets to prepare, commands to run, expected outcomes, how to compare your run against the reference run at testing.consentshield.in.
- [ ] Links back to the ADR for auditor-grade completeness.

**Status:** `[ ] planned`

#### Sprint 5.3: `testing.consentshield.in` public index

**Deliverables:**
- [ ] Next.js static site deployed to a dedicated Vercel project (separate from marketing/app/admin to isolate outages).
- [ ] Lists every published run: date, commit SHA, pass/fail counts, mutation score, artefact links.
- [ ] Filtered views: per vertical, per sprint, per phase.
- [ ] RSS feed for run completion.

**Status:** `[ ] planned`

#### Sprint 5.4: Sacrificial "must-fail" controls

**Deliverables:**
- [ ] `tests/e2e/controls/` — 8 intentionally-broken tests that MUST fail (HMAC check removed, RLS bypassed, etc.). These are NEVER merged to the production code paths — they exist purely as test-code stubs.
- [ ] CI gate: if any control passes, fail the whole suite and page the maintainer.
- [ ] Documented on `/docs/test-verification/controls`.

**Status:** `[ ] planned`

---

## Acceptance criteria

The ADR is **Completed** when all of the following hold:

- [ ] All five phases above are `[x]`.
- [ ] Full pipeline (browser → banner → Worker → buffer → delivery → R2 → receipts) exercised in at least one suite per major product surface.
- [ ] Every positive E2E test is paired with a negative control (Sprint 3.7 matrix doc is current).
- [ ] Stryker mutation score ≥ 80% on: worker/src/, supabase/functions/deliver-consent-events/, app/src/app/api/v1/.
- [ ] Nightly run produces evidence artefacts, each sealed by SHA-256 and indexed at `testing.consentshield.in/runs/<sha>`.
- [ ] A partner can clone the repo, run `bun run scripts/partner-bootstrap.ts` + `bun run test:e2e:partner`, and observe the same evidence artefacts within 30 min (verified on a clean-room machine).
- [ ] All 3 vertical demo sites (ecommerce, healthcare, BFSI) live on Railway with production-parity banner embeds.
- [ ] Sacrificial control suite MUST fail red on every run. Any control passing is an incident.
- [ ] `tests/e2e/specs/*.md` exists for every `*.spec.ts` (1:1 mapping).

## V2 backlog (explicitly deferred)

These are consciously out of scope for ADR-1014. Logged in `docs/V2-BACKLOG.md`.

- **4th vertical (SaaS-B2B, EdTech, or media)** — add once an enterprise prospect's vertical is not covered by the first three.
- **iOS demo app + CI** — blocked by the ADR that ships the iOS wireframes (consentshield-mobile.html is currently deferred until Month 6+ ABDM trigger).
- **Load / stress testing** — k6 or Artillery harness against the full pipeline. Separate concern; deferred pending early customer load data.
- **Multi-region evidence replication** — currently R2 single-region; partner evidence inspection tolerates this for v1.

---

## Architecture Changes

No changes to the definitive architecture document are triggered by this ADR on its own. The harness consumes published contracts; it does not redefine them.

## Test Results

*(Populated per sprint close-out.)*
