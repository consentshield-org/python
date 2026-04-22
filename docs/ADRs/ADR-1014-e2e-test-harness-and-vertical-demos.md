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
- [ ] New root workspace package `tests/e2e/` (Bun workspace member per ADR-0026).
- [ ] `playwright.config.ts` with projects: `chromium`, `webkit`, `firefox` (firefox gated behind nightly).
- [ ] `tests/e2e/specs/README.md` — normative test-spec template (intent / setup / invariants / expected proofs / pair-with-negative).
- [ ] `tests/e2e/utils/` — env loader, trace-id helper, shared fixtures.
- [ ] Root `package.json` scripts: `test:e2e` (PR subset), `test:e2e:full` (nightly), `test:e2e:partner` (with their env).

**Testing plan:**
- [ ] `bun run test:e2e --smoke` executes the seeded `/healthz` probe against all three app surfaces.

**Status:** `[ ] planned`

#### Sprint 1.2: Supabase test-project bootstrap

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `scripts/e2e-bootstrap.ts` — takes `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (one-shot), runs `supabase db push` against it, seeds the scoped roles (cs_worker / cs_delivery / cs_orchestrator / cs_api / cs_admin), reads each role's password back into a local `.env.e2e`.
- [ ] Idempotent cleanup: `scripts/e2e-reset.ts` truncates buffer tables + clears auth.users between test runs.
- [ ] Fixture set: 3 organisations (one per vertical), 3 accounts, 9 web properties, seeded API keys.

**Testing plan:**
- [ ] Bootstrap on a fresh Supabase project completes in under 10 min.
- [ ] Reset between runs completes in under 20 s.

**Status:** `[ ] planned`

#### Sprint 1.3: Worker local harness

**Estimated effort:** 1 day

**Deliverables:**
- [ ] `tests/e2e/utils/worker-harness.ts` — spawns `wrangler dev` on an ephemeral port, seeds per-vertical web_property signing secrets, returns `{ port, signedRequest(payload) }`.
- [ ] HMAC helper: `signConsentEvent(payload, secret)` — mirrors Worker-side verification.
- [ ] Tear-down on test-suite exit.

**Testing plan:**
- [ ] Send a valid signed event → receive 202 + see row in `public.consent_events`.
- [ ] Send an unsigned event → receive 403 + confirm no row written (negative control; this is the first pair in the suite).

**Status:** `[ ] planned`

#### Sprint 1.4: R2 evidence writer + static index

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `tests/e2e/utils/evidence.ts` — writes run artifacts to R2 at `runs/<commit-sha>/<run-id>/`.
- [ ] Each run archive contains: `manifest.json` (commit SHA, seed, migration list, timestamp, run duration, pass/fail counts), Playwright HTML report, DB snapshot (redacted pg_dump of non-fixture tables), Worker log export, R2 manifest (keys + hashes of delivered objects), Stryker HTML (Phase 4+).
- [ ] SHA-256 `seal.txt` over the archive — seal is pushed to a public ledger (GitHub Actions run summary + optional tweet from @consentshield status).
- [ ] Static site at `testing.consentshield.in` — Next.js static export indexing runs by date and commit SHA, served from a separate Vercel project reading from R2.

**Testing plan:**
- [ ] After a smoke run, manifest is retrievable at the public URL and its seal verifies.
- [ ] Tampering with any file in the archive invalidates the seal (negative control).

**Status:** `[ ] planned`

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
- [ ] Static apparel storefront: homepage, product page, cart, checkout.
- [ ] Realistic tracker embeds: Google Analytics, Meta Pixel, Razorpay checkout.
- [ ] Banner embedded + wired to staging Worker.
- [ ] Deploy pipeline on Railway (one service, auto-deploy on push).
- [ ] Published to `demo-ecommerce.consentshield.in` (DNS on Cloudflare).

**Testing plan:**
- [ ] Banner renders on first paint; consent events reach staging buffer with `origin=demo-ecommerce.consentshield.in`.
- [ ] Tracker blocking: reject-analytics → GA/Meta Pixel do not load (MutationObserver check).

**Status:** `[ ] planned`

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
