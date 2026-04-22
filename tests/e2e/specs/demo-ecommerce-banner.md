# E2E-2.1-demo-ecommerce-banner: Browser → banner → Worker → buffer

**ADR:** ADR-1014 (Sprint 2.1 — Ecommerce demo site + first browser-driven pipeline test)
**Sprint:** Phase 2, Sprint 2.1
**Sibling negative:** `demo-ecommerce-banner-wrong-origin.spec.ts` — same flow but served from a port outside the fixture's `allowed_origins`. Worker must 403 the event and write no row.
**Category:** @pipeline @browser @ecommerce

---

## 1. Intent

Proves a real browser visit to the ecommerce demo site renders the ConsentShield banner (served by the local Worker), a user clicking "Accept all" fires the `consentshield:consent` page event, and the Worker receives a matching `/v1/events` POST that lands in the `public.consent_events` buffer.

This is the first end-to-end test that exercises the browser → banner → Worker → buffer sequence for origin-verified (non-HMAC) events — the pathway every real customer's visitors will traverse.

## 2. Setup

- `test-sites/` is a static tree (homepage, product, cart, checkout for ecommerce; future verticals add their own).
- `scripts/e2e-bootstrap.ts` has seeded the `ecommerce` vertical — `e2e-fixture-ecommerce` account, org, 3 web_properties, 3 banners. Property [2] ("Sandbox probe") has `allowed_origins = ['http://localhost:4001']` — the tightest origin match so cross-test pollution is impossible.
- Wrangler dev reachable at `WORKER_URL` OR auto-spawned via `startWorker()`.
- `WORKER_URL` is passed to the page via the `?cdn=...` query string so the in-page `banner-loader.js` points the `<script src>` at the local Worker, not at the production CDN.

## 3. Invariants

- No `consent_events` row is ever written with `property_id != fixture.properties[2].id` during this test.
- The page never loads a tracker script for an un-accepted purpose (the demo HTML's `loadFor()` only runs after `consentshield:consent` fires).
- The fixture's `event_signing_secret` is not used — this is the origin-only pathway, not HMAC-verified.

## 4. Expected proofs

1. Navigating to `${staticServerUrl}/ecommerce/?cdn=<worker>&org=<orgId>&prop=<propId>` renders a button with visible text "Accept all" (the banner's own button; served by the Worker's `banner.js`).
2. `window.__consentshield_demo` exposes the resolved `{ cdn, org, prop, banner_src }` — confirms the loader picked the right values.
3. Clicking the "Accept all" button triggers a page-level `consentshield:consent` event with `event_type='consent_given'` and non-empty `accepted[]`.
4. The same click drives a `POST ${worker}/v1/events` — the Worker responds 202.
5. Within 5 seconds, `public.consent_events` gains a row where:
   - `property_id = fixture.properties[2].id`
   - `banner_id   = fixture.properties[2].bannerId`
   - `event_type  = 'consent_given'`
   - `origin_verified = 'origin-only'` (origin-path, not HMAC)
6. Count delta for `property_id` since the test's `cutoffIso` = exactly **1**.

## 5. Pair-with-negative

**Pair:** `demo-ecommerce-banner-wrong-origin.spec.ts`. Serves the same demo on a port NOT in `allowed_origins` (e.g. `localhost:4999`) and expects the Worker to 403 the `/v1/events` POST with no row written. Uses a different fixture property so the positive and negative can run in parallel without contention.

## 6. Why this spec is not a fake positive

Three independent systems are asserted in the same test:

1. The browser — we read DOM + page events, not just status codes.
2. The Worker — the 202 comes back on the network intercept.
3. The DB — we read the row back via service role with column-level assertions.

A banner that silently fails to POST would pass #1 but fail #2 and #3. A Worker that accepted and logged but didn't write would pass #2 but fail #3. A DB row conjured by background state would fail #6 (count delta).

Additionally, the `banner-loader.js` is independent of the banner itself: a mismatch between our loader and the Worker's served banner would produce no rendered button and fail #1. This sanity-checks the page plumbing.

## 7. Evidence outputs

- `trace-id.txt` — per test
- `responses/<test>-consent-event-fired.json` — the page-event detail captured from the browser
- `responses/<test>-observed-row.json` — the `consent_events` row read back from the DB
- Playwright trace on failure
- Console log capture (via `page.on('console')`)
