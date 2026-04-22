# E2E-2.4-demo-matrix: Cross-vertical banner × outcome matrix

**ADR:** ADR-1014 (Sprint 2.4 — Banner-embed testing framework per vertical)
**Sprint:** Phase 2, Sprint 2.4
**Sibling negatives:** each cell pairs with a tracker-blocking negative (asserts un-accepted trackers did NOT load). The pair runs in the same test body because the assertions are cheap.
**Category:** @pipeline @browser @matrix

---

## 1. Intent

Proves that every (vertical × outcome) combination produces the correct observable state across three surfaces — the browser, the Worker's `/v1/events` endpoint, and the `public.consent_events` buffer — with the right tracker-loading behaviour.

This is the matrix-level successor to Sprint 2.1's single-vertical ecommerce smoke. It guards against any per-vertical regression in the banner's purpose-handling (e.g. required-basis purposes being wrongly rejected, optional purposes hitchhiking a reject_all).

**Matrix:** 3 verticals × 3 outcomes = 9 cells.

| Vertical | Required purpose (legal basis) | Optional purposes |
|---|---|---|
| ecommerce | `essential` (contract) | `analytics`, `marketing` |
| healthcare | `clinical_care` (contract) | `research_deidentified`, `marketing_health_optin` |
| bfsi | `kyc_mandatory` (legal_obligation) | `credit_bureau_share`, `marketing_sms` |

**Outcomes:**

1. `accept_all` — `consent_given` event; `accepted = [all three]`, `rejected = []`
2. `reject_all` — `consent_withdrawn` event; `accepted = [required only]`, `rejected = [two optional]`
3. `customise` — `purpose_updated` event; `accepted = [required + one optional]`, `rejected = [other optional]`

## 2. Setup

- `scripts/e2e-bootstrap.ts` has seeded all 3 vertical fixtures (env keys in `.env.e2e`). Each vertical's property[2] (Sandbox probe) has `allowed_origins = ['http://localhost:<port>']` — ecommerce:4001, healthcare:4002, bfsi:4003 — the tightest origin match so cross-vertical tests cannot pollute each other's count deltas.
- `tests/e2e/utils/static-server.ts` serves `test-sites/` on one of those three ports depending on the vertical.
- `WORKER_URL` (or auto-spawned wrangler dev) is passed to the page via `?cdn=`.
- `tests/e2e/utils/banner-harness.ts` owns the interaction primitives (`openBanner` / `acceptAll` / `rejectAll` / `customise` / `getLoadedTrackers`).

## 3. Invariants

- Positive and negative assertions for a given cell run in the SAME test body (no cross-test state mutation).
- Each (vertical, outcome) uses a dedicated fixture `property[2]` so buffer-row counts are deterministic.
- Required-basis purposes (`essential` / `clinical_care` / `kyc_mandatory`) always appear in `accepted[]`, irrespective of the user action. BFSI's `kyc_mandatory` is legal_obligation (non-withdrawable) — its presence in `accepted[]` even after `reject_all` is the core differentiator of the BFSI vertical.
- Cells run sequentially within a vertical but verticals run in parallel across browsers (`chromium` / `webkit`).

## 4. Expected proofs (per cell)

1. **DOM:** After `openBanner`, the banner renders with one checkbox per purpose. Required purpose's checkbox is `disabled + checked`.
2. **Page event:** After the outcome action, `window` receives `consentshield:consent` with the correct `event_type` + expected accepted/rejected split.
3. **Banner dismount:** Banner root (`[role=dialog][aria-label="Cookie consent"]`) is removed from the DOM post-action.
4. **Worker 202:** `/v1/events` POST to the Worker returns 202 (verified via `page.on('response')`).
5. **Buffer row:** Within 5 s, `public.consent_events` gains exactly ONE row for the test's `property_id` since `cutoffIso`, with `event_type`, `purposes_accepted`, `purposes_rejected` all matching the page event.
6. **Tracker loading (positive — after accept/customise):** Scripts with `[data-cs-tracker=1]` are present in the DOM for every accepted purpose that has a registered tracker src. Rejected purposes' trackers must NOT appear.
7. **Tracker loading (negative — after reject_all):** Zero scripts with `[data-cs-tracker=1]` for any optional purpose. Required purposes' trackers (if any — e.g. Razorpay under BFSI `kyc_mandatory`) remain.

## 5. Pair-with-negative

Each cell's proof #7 IS the paired negative — the same test asserts both that accepted trackers loaded AND that un-accepted trackers didn't. No separate spec file.

The cross-cell negative is structural: if ecommerce's test was polluted by a healthcare cell's event (e.g. a shared property_id), the buffer-row count assertion would fail loudly. That's covered by the per-vertical property[2] isolation invariant in §3.

## 6. Why this spec is not a fake positive

Four independent systems are asserted per cell:

1. **The banner** (served by the Worker) — we read its DOM to confirm the purpose count + required lock.
2. **The browser-side tracker loader** (`shared/demo.js`) — we read the injected `<script data-cs-tracker>` elements post-consent.
3. **The Worker** — we observe its 202 on the `/v1/events` POST via network intercept.
4. **The DB** — we read the buffer row back via service role with column-level assertions.

A banner that rendered but silently failed to POST would pass #1 but fail #3 and #4. A Worker that logged but didn't write would pass #3 but fail #4. A tracker-loader that ignored the accepted/rejected split would pass #1/#3/#4 but fail #2/#7.

The matrix structure (3 × 3) additionally catches per-vertical regressions that a single-vertical spec can't — e.g. a bug where `kyc_mandatory` is treated as optional would show up in the BFSI reject_all row but leave ecommerce/healthcare green.

## 7. Evidence outputs (per cell)

- `trace-id.txt` — per test
- `responses/<vertical>-<outcome>-consent-event-fired.json` — page event detail
- `responses/<vertical>-<outcome>-observed-row.json` — DB row
- `responses/<vertical>-<outcome>-loaded-trackers.json` — array of tracker srcs
- Playwright trace on failure
- Console log capture

## 8. Runtime-green blockers (2026-04-22)

Sprint 2.4's code is complete; runtime green is gated on two independent pre-reqs:

1. **ADR-1010 Worker role guard.** The Worker refuses to boot unless `SUPABASE_WORKER_KEY` is a JWT claiming `role=cs_worker`. Local `wrangler dev` with the historical service-role stand-in is rejected. Unblocks once ADR-1010 Phase 3 migrates the Worker source to a cs_worker JWT (or `worker/.dev.vars` receives one manually).
2. **Bootstrap/Worker purposes shape mismatch.** `scripts/e2e-bootstrap.ts` writes `consent_banners.purposes` as `{code, required, legal_basis}`; `worker/src/banner.ts` reads them as `{id, name, description, required, default}`. The banner would render with `undefined` purpose ids. Unblocks once the bootstrap writes the Worker-compatible shape (trivial transformation; one-file fix in a follow-up commit that's out of Sprint 2.4's scope).

Tests skip cleanly when `WORKER_URL` is missing — same pattern as Sprint 2.1's `demo-ecommerce-banner.spec.ts`.
