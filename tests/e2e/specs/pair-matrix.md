# Pair matrix — ADR-1014 Sprint 3.7

**Status:** living document. Update every time a new positive ships (Phase 4+).
**Invariant:** every positive test in Phases 1–3 has at least one paired negative that targets the same functional boundary. Where the pair is in a different file or a different abstraction layer, this document is the map.

---

## 1. Why this exists

ADR-1014's evidence-graded test discipline requires paired positives + negatives. A positive proves the system accepts legitimate input; its paired negative proves the same input path rejects when the precondition it's supposed to check is violated. A positive without a paired negative leaves the rejection surface untested — the "accept-everything" bug would fail no test.

Pair completeness is easy to lose track of as test count grows. This matrix is the authoritative inventory: a future reader can scan one table and confirm no positive is orphaned.

## 2. Audit scope — Phases 1, 2, 3

Test-file inventory as of Sprint 3.7 (2026-04-23):

| Category | File | Phase / Sprint |
|---|---|---|
| Playwright / browser | `tests/e2e/smoke-healthz.spec.ts` | Phase 1 Sprint 1.1 |
| Playwright / worker | `tests/e2e/worker-consent-event.spec.ts` | Phase 1 Sprint 1.3 |
| Playwright / worker | `tests/e2e/worker-consent-event-tampered.spec.ts` | Phase 1 Sprint 1.3 |
| Playwright / worker | `tests/e2e/worker-consent-event-origin-mismatch.spec.ts` | Phase 3 Sprint 3.2 (pairs back to Sprint 1.3) |
| Playwright / browser | `tests/e2e/demo-ecommerce-banner.spec.ts` | Phase 2 Sprint 2.1 |
| Playwright / matrix | `tests/e2e/demo-matrix.spec.ts` | Phase 2 Sprint 2.4 |
| Vitest / integration | `tests/integration/signup-intake.test.ts` | Phase 3 Sprint 3.1 |
| Vitest / integration | `tests/integration/rights-request-public.test.ts` | Phase 3 Sprint 3.3 |
| Vitest / integration | `tests/integration/deletion-receipt-confirm.test.ts` | Phase 3 Sprint 3.4 |
| Vitest / unit | `app/tests/rights/deletion-callback-signing.test.ts` | Phase 3 Sprint 3.4 |
| Vitest / depa | `tests/depa/artefact-lifecycle.test.ts` | Phase 3 Sprint 3.5 |
| Vitest / admin | `tests/admin/impersonation-audit-trail.test.ts` | Phase 3 Sprint 3.6 |
| Vitest / admin | `tests/admin/invoice-issuance.test.ts` | Phase 3 Sprint 3.6 |

## 3. Pair matrix

| # | Positive | What it proves | Paired negative(s) | Same file? | Notes |
|---|---|---|---|---|---|
| 1 | `worker-consent-event.spec.ts` — signed HMAC → 202 + buffer row | Server-to-server legitimate traffic is accepted at the Worker + persisted | `worker-consent-event-tampered.spec.ts` — flipped hex char in signature → 403 + zero rows; `worker-consent-event-origin-mismatch.spec.ts` — foreign Origin → 403 + zero rows; `worker-consent-event-origin-mismatch.spec.ts` sub-test B — missing Origin on unsigned → 403 + zero rows | No (companion files) | Test-isolation invariant: positive uses `properties[0]`, HMAC-tampered uses `properties[1]`, origin-mismatch uses `properties[2]`. Documented in each spec's §3. |
| 2 | `demo-ecommerce-banner.spec.ts` — browser → banner → Worker → buffer (origin-only path, `origin_verified='origin-only'`) | A real browser visit renders the banner, Accept-all fires `consentshield:consent`, the Worker receives a matching `/v1/events` POST, buffer row appears with 5-column match | `worker-consent-event-origin-mismatch.spec.ts` covers the same Worker rejection path at the API layer (origin-only path rejected when Origin not in allow-list). Same code path rejection; abstraction-layer difference only. | No (cross-sprint) | Writing a browser-level wrong-origin spec would duplicate the Worker's rejection assertion already covered at the cleaner API layer. Cross-reference is sufficient. |
| 3 | `demo-matrix.spec.ts` — 9 cells (3 verticals × accept_all / reject_all / customise) | Each (vertical, outcome) produces the correct consent event + tracker load count + buffer row | **Intra-file pair:** `reject_all` is the structural negative of `accept_all` within each vertical. `customise` covers the mixed path. Tracker-count assertion (proof #6 + #7 in the spec) is the second-surface pair. | Yes | `specs/demo-matrix.md` §5 argues why the matrix IS the negative — cross-cell pollution would fail the property-isolation invariant loudly. |
| 4 | `signup-intake.test.ts` — `created` branch: new email + valid plan → invitation row + token + 14-day expiry | Happy path of the public signup-intake RPC surface | Intra-file: `existing_customer`, `admin_identity`, `invalid_email` (+ empty), `invalid_plan` (+ null), `already_invited`, branch-precedence (`invalid_plan` > `invalid_email`), case-insensitive dedupe. 6 branch-level negatives. | Yes | `create_signup_intake` branches are a closed enum; every branch has a test. |
| 5 | `rights-request-public.test.ts` — `rpc_rights_request_create` happy + `rpc_rights_request_verify_otp` correct hash → row flipped + audit_log + rights_request_events emitted | Happy-path public rights-portal flow from create to OTP-verify | Intra-file: `not_found`, `invalid_otp` (attempts increment), `too_many_attempts` (5-retry lockout), `expired`, `already_verified`, `no_otp_issued`, cross-org side-effect isolation. 7 branches. | Yes | Every rpc_rights_request_verify_otp branch covered. |
| 6 | `deletion-receipt-confirm.test.ts` — `awaiting_callback → confirmed` + response_payload + confirmed_at + audit_log row | `rpc_deletion_receipt_confirm` happy path | Intra-file: `not_found`, `invalid_state` (pending row), `already_confirmed` replay idempotency, reported_status variants (`partial`, `failed`, unknown-mapped-to-confirmed). Plus: 4 overdue-query negatives (stale picked up, future next_retry_at excluded, 30-day cutoff, confirmed never in retry set). | Yes | Complete RPC + retry-query surface. |
| 7 | `deletion-callback-signing.test.ts` — `signCallback(id)` + `verifyCallback(id, sig)` round-trip | Round-trip integrity of the HMAC-signed callback URL guard | Intra-file: 1-hex-flip tamper, short sig, long sig, empty sig, wrong receipt_id, missing-secret returns false (not throws), wrong-secret key-rotation rejection. 7 tamper / edge-case negatives. | Yes | Three-surface proof: helper + route reject + no DB mutation. |
| 8 | `artefact-lifecycle.test.ts` — record → verify(granted) → revoke → verify(revoked) → revoke-again idempotent-replay | Full DEPA artefact state machine end-to-end via cs_api helpers | Intra-file: 3rd revoke still idempotent (no row delta), expire-then-revoke → `artefact_terminal_state:expired`, never-consented (no index row) | Yes | Lightweight pairing — branch-by-branch revoke coverage lives in the complementary `tests/integration/consent-revoke.test.ts` (10 cases shipped under ADR-1002). |
| 9 | `impersonation-audit-trail.test.ts` — start → end emits 2 audit_log rows sharing `impersonation_session_id`; triage during session captured in `actions_summary` | Admin impersonation audit plumbing | Companion: `tests/admin/rpcs.test.ts` — `end_impersonation (self)` passes, `end_impersonation by non-owner` is rejected, `force_end_impersonation` as platform_operator override | No (cross-file) | Sprint 3.6 ADR explicitly documents the split: rpcs.test.ts owns state-transition branches; this file owns audit-row emission. Pair is complete across the two files. |
| 10 | `invoice-issuance.test.ts` — active issuer + complete account → invoice row at status=draft + correct GST split + audit row | Invoice issuance happy path via active issuer (Rule 19 positive) | Intra-file: no-active-issuer negative (retire all, call `billing_issue_invoice` → "No active issuer" + zero row delta). Cross-ref: `invoice-immutability.test.ts` (10 immutable-column trigger cases, ADR-0050 Sprint 2.1 chunk 3). | Yes + cross-file | Two-surface pair: Rule 19 (issuer present) + immutable-field trigger (column lock). |
| 11 | `signup-to-dashboard.spec.ts` Sub-test A — fresh token → `/onboarding?token=<X>` renders the wizard Step-1 indicator; expired-copy NOT visible | Wizard entry gate accepts a legitimate token minted via `create_signup_intake` | Intra-file Sub-test B — service-role force-expire on the same invitation → navigate → `InvalidShell(reason='expired')` body text renders + zero `[aria-current="step"]` elements + resend-link form present. Cross-ref: `signup-intake.test.ts` (Sprint 3.1) owns the 6 RPC branches. | Yes + cross-file | Browser-layer pair that completes what Sprint 3.1 left at the RPC layer. Full 7-step wizard traversal deferred to Sprint 5.2 per §8 of the spec. |

## 4. Gap analysis

After the audit above, the ten positives each map to at least one structurally-equivalent paired negative. **No missing pairs requiring a new test file.**

Three pairings cross file boundaries; that's documented above + explained in the relevant spec docs and ADR-1014 sprint sections:

- **#2** (browser demo ↔ API-layer origin-mismatch) — the browser-level flow would exercise the same Worker rejection path at a less-clean abstraction. Punting would be cheap; re-testing the same code path at a different layer is not evidence-positive.
- **#9** (impersonation audit ↔ rpcs.test.ts state transitions) — deliberate split per Sprint 3.6 scope decision.
- **#10** (invoice issuance Rule 19 ↔ invoice-immutability.test.ts) — deliberate split; the 10 immutable cases predate Sprint 3.6 and are the authoritative coverage for column-lock.

## 5. Structural-negative invariants (cross-cutting)

Three invariants hold across every pair, enforced by the evidence-graded discipline rather than by any single test:

1. **Test-isolation property scoping** — positive and negative use different fixture properties (`ecommerce.properties[0]` / `[1]` / `[2]` for the three Worker pairs, distinct test orgs for the admin + integration pairs). A positive leaking into a negative's assertion window would fail loudly; regressions this catches are documented in each spec's §3.
2. **Three-surface proof** — each positive asserts on observable state across at least three independent systems (HTTP response, DOM / event, DB row, R2 object, or audit log). A single silent-success bug cannot satisfy all three. Each spec doc has §6 "Why this spec is not a fake positive" reasoning.
3. **Property-isolation on concurrent runs** — all Playwright-side pairs documented here can run in parallel across projects (chromium / webkit / firefox-nightly) without cross-observation because they scope by `property_id` in the count-since-cutoff query.

## 6. How to extend this matrix

Every new positive test written under a Phase 4+ sprint MUST add a row to §3 before the sprint is marked `[x] complete`. If the pair is in-file, note "Yes". If the pair lives in a different file or is cross-sprint, name the file + the sprint it pairs back to.

If during authoring a positive has no natural pair, that itself is a finding — the design has an un-observable rejection surface. Raise it in the ADR before shipping the positive.

## 7. Sprint 3.7 close-out

Sprint 3.7's three ADR-1014 deliverables:

- [x] **Audit every positive test from Phases 1–3.** Complete — §3 above covers all ten.
- [x] **Add any missing pairs.** None needed — §4 shows the audit produces zero required additions. Three cross-file pairings are deliberate, not gaps.
- [x] **Document the pairing map.** This file.

Sprint 3.7 ships as documentation-only: no new tests, no migrations, no route handlers. The audit confirmed the evidence-graded discipline held across ten sprints; the matrix is the artefact that makes it inspectable at a glance.

## 8. Sacrificial controls — Sprint 5.4 (2026-04-25)

The pos/neg discipline in §3 assumes the assertion layer itself is still discriminating. Sacrificial controls are the canary on that assumption: eight intentionally-broken tests that MUST fail internally (wrapped with Playwright `test.fail()` inversion) and therefore report as `passed` overall. If any control's false assertion ever holds true, the harness itself has regressed — every other positive in the suite becomes suspect until the rogue control is investigated.

Each control targets a DISTINCT assertion matcher so a regression in any one matcher is caught by exactly one rogue:

| # | Control file | Matcher probed | Why load-bearing for positives |
|---|---|---|---|
| 1 | `controls/smoke-healthz-negative.spec.ts` | `toEqual` (string) | Most common equality matcher. Used across DB-row field assertions, HTTP-status-line assertions, and rendered-text assertions. |
| 2 | `controls/arithmetic-negative.spec.ts` | `toBe` (integer) | Every timing + row-count + duration assertion. |
| 3 | `controls/string-contains-negative.spec.ts` | `toContain` (substring) | Response-body substrings, audit-log `event_type` presence, rendered-HTML text assertions. |
| 4 | `controls/array-length-negative.spec.ts` | `toHaveLength` (array cardinality) | Buffer-row counts, audit-event counts, rights-request-event counts. |
| 5 | `controls/null-identity-negative.spec.ts` | `toBe` (null vs undefined) | Negative-row assertions that rely on nullable columns (`revoked_at`, `delivered_at`, `confirmed_at`) remaining null. |
| 6 | `controls/regex-match-negative.spec.ts` | `toMatch` (anchored regex) | Trace-ID (ULID shape) and API-key-prefix (`cs_live_` / `cs_test_`) discrimination. |
| 7 | `controls/boolean-truth-negative.spec.ts` | `toBe` (boolean) | `email_verified`, `is_active`, `revoked_at IS NULL` on consent_events / rights_requests / api_keys / deletion_receipts. |
| 8 | `controls/deep-equal-negative.spec.ts` | `toEqual` (deep object) | RFC 7807 problem+json shape, webhook-callback response_payload, fixture-banner purposes array, audit_log JSONB metadata. |

**CI gate:** `bun run test:e2e:controls` (= `bunx tsx scripts/e2e-verify-controls.ts`). Fails with a SEV-1 message on any rogue control or any control missing its `test.fail()` wrapper. Evidence archive records the raw view (`0 passed, 8 failed`); the gate's post-inversion message reads over the top.

**Rules:**

- Every control is a plain `*.spec.ts` file tagged `@control @smoke`.
- Every control asserts a patently-false proposition wrapped with `test.fail()`.
- Do NOT "fix" a control by softening its assertion. The false assertion IS the control.
- Do NOT add two controls for the same matcher — adds run-time without adding discriminatory value.
- If Phase 4+ introduces a new matcher class that becomes load-bearing for positives, add a control in the same sprint.
