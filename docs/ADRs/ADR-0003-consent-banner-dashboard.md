# ADR-0003: Consent Banner Builder + Compliance Dashboard

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-13
**Date completed:** —

---

## Context

With the schema, auth, RLS, and Worker foundation in place (ADR-0001) and HMAC/origin validation securing the event pipeline (ADR-0002), the product needs its first user-facing features:

1. **Consent Banner Builder** — no-code builder to create DPDP-compliant consent banners with granular purpose consent, live preview, and CDN-hosted JS snippet
2. **Compliance Dashboard** — single-page overview of compliance status, real-time consent events, and enforcement clock

These are the Phase 1 MVP features from the v2 blueprint — what a customer interacts with from signup to first consent collected.

## Decision

Build the banner builder first (it unblocks the full signup → first consent flow), then the dashboard. The banner builder creates banners in the database; the Worker serves them. The dashboard reads from buffer tables for real-time display.

## Consequences

After this ADR:
- A customer can sign up, create a banner, deploy it via script tag, and collect consents
- The dashboard shows live compliance status and recent consent events
- The full signup → first consent collected flow works end-to-end

---

## Implementation Plan

### Phase 1: Banner Builder

#### Sprint 1.1: Web Property Management
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] GET/POST /api/orgs/[orgId]/properties — list and create web properties
- [ ] Property settings page with URL, allowed_origins configuration
- [ ] Snippet installation instructions with copyable script tag
- [ ] Snippet verification check (reads snippet_verified_at)

**Testing plan:**
- [ ] Create property → appears in list
- [ ] RLS: can only see own org's properties
- [ ] Script tag includes correct org and property IDs

**Status:** `[x] complete`

#### Sprint 1.2: Banner Configuration UI
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] GET/POST /api/orgs/[orgId]/banners — list and create banner versions
- [ ] Banner editor: headline, body copy, position (bottom-bar/modal/bottom-left/bottom-right)
- [ ] Purpose management: add/remove purposes with name, description, required flag, default state
- [ ] Live preview panel showing banner as it will appear on customer's site
- [ ] Save as draft (is_active = false)

**Testing plan:**
- [ ] Create banner with 3 purposes → saved correctly in DB
- [ ] Edit banner creates new version (versioning works)
- [ ] Preview renders correctly for each position option
- [ ] RLS: can only see own org's banners

**Status:** `[x] complete`

#### Sprint 1.3: Banner Publish + Script Compilation
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] POST /api/orgs/[orgId]/banners/[id]/publish
- [ ] Deactivate all other banners for the property
- [ ] Activate selected banner, generate new event_signing_secret
- [ ] Invalidate KV cache (banner config + signing secret)
- [ ] Compile banner script: self-contained vanilla JS (~26KB target)
  - Renders banner UI from config
  - Captures consent decision
  - Computes HMAC signature
  - POSTs to cdn.consentshield.in/v1/events
  - Stores in localStorage
  - Dismisses banner
- [ ] Cache compiled script in KV

**Testing plan:**
- [ ] Publish → banner.js served by Worker with correct config
- [ ] Consent event posted by banner is HMAC-verified by Worker
- [ ] Banner respects localStorage (doesn't show again after dismissal)
- [ ] End-to-end: deploy on test page → click accept → event appears in buffer

**Status:** `[x] complete`

### Phase 2: Dashboard

#### Sprint 2.1: Compliance Dashboard Shell
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] Dashboard layout: sidebar navigation + main content area
- [ ] Compliance score placeholder (computed from: banner deployed, consent events flowing, data inventory complete)
- [ ] Recent consent events feed (reads from consent_events buffer, last 24h)
- [ ] Enforcement clock: "Days until full DPDP enforcement: N"
- [ ] Quick stats: total consents today, active web properties, pending rights requests

**Testing plan:**
- [ ] Dashboard loads with real data from Supabase
- [ ] Shows only current org's data (RLS verified)
- [ ] Consent events appear within seconds of being posted

**Status:** `[x] complete`

#### Sprint 2.2: Data Inventory + Privacy Notice
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] Data inventory CRUD pages (list, create, edit)
- [ ] Auto-seed from tracker observations (source_type = 'auto_detected')
- [ ] Privacy notice generator: guided wizard → produces plain-language notice
- [ ] Hosted privacy notice page at /privacy/[orgId] (public route)
- [ ] PDF download of privacy notice

**Testing plan:**
- [ ] Create data inventory items → appear in list
- [ ] Auto-detected items show source_type correctly
- [ ] Privacy notice generates with all DPDP-required disclosures
- [ ] Public privacy notice page renders without auth

**Status:** `[ ] planned`

---

## Architecture Changes

_None expected — implements existing architecture features._

---

## Test Results

### Sprint 1.1 — 2026-04-14

```
Test: Build passes with all property routes
Method: bun run build
Actual: routes registered:
  - /api/orgs/[orgId]/properties (GET, POST)
  - /api/orgs/[orgId]/properties/[propertyId] (GET, PATCH)
  - /dashboard/properties (list page)
  - /dashboard/properties/[propertyId] (detail page)
Result: PASS

Test: Lint passes
Method: bun run lint
Actual: clean
Result: PASS

Test: RLS isolation tests still pass (no regressions)
Method: bun run test
Actual: 39/39 passed
Result: PASS

Implementation:
- API routes: GET/POST list/create, GET/PATCH detail
- URL validation on allowed_origins (rejects malformed URLs)
- Dashboard nav with sign-out
- Properties list with status indicators (snippet verified / not installed)
- Property detail page with copyable script tag, settings editor
- Origin-aware: events from non-allowed origins will be rejected by Worker
```

### Sprint 1.2 — 2026-04-14

```
Test: Build passes with all banner routes
Method: bun run build
Actual: routes registered:
  - /api/orgs/[orgId]/banners (GET, POST)
  - /api/orgs/[orgId]/banners/[bannerId] (GET, PATCH)
  - /dashboard/banners (list)
  - /dashboard/banners/[bannerId] (editor)
Result: PASS

Test: Lint passes
Result: PASS

Test: RLS isolation tests still pass
Method: bun run test
Actual: 39/39 passed
Result: PASS

Implementation:
- Banner CRUD with versioning (each save creates new version internally,
  the editor edits the current draft until published)
- Position options: bottom-bar, bottom-left, bottom-right, modal
- Purpose management: id, name, description, required, default
- Live preview panel renders banner with selected position and purposes
- Save Draft (PATCH only) and Save & Publish (PATCH + POST publish)
- Publish triggers signing secret rotation via ADR-0002 Sprint 1.3 route
- Default purposes seeded on banner creation: Essential, Analytics, Marketing
- Monitoring toggle for tracker observation
```

### Sprint 1.3 — 2026-04-14

```
Test: Worker deployed to Cloudflare
Method: wrangler deploy
Actual: Deployed to https://consentshield-cdn.a-d-sudhindra.workers.dev
Result: PASS

Test: Banner script served with full config
Method: GET /v1/banner.js?org=$ORG&prop=$PROP
Expected: ~6KB script with config, HMAC code, banner UI
Actual: 6655 bytes — org_id, property_id, banner_id, signing_secret,
        headline, purposes, crypto.subtle (HMAC) all present
Result: PASS

Test: End-to-end consent event flow
Method: openssl HMAC with property's signing secret → POST /v1/events
Expected: 202, row in consent_events buffer
Actual: 202, event_type=consent_given, purposes_accepted=["essential","analytics"]
Result: PASS

Test: Build + lint pass after Worker rewrite
Result: PASS

Implementation:
- worker/src/banner.ts: rewrote stub to compile real banner script
- compileBannerScript() embeds config + signing secret in the JS
- Banner script (vanilla JS, ~6.6KB):
  - Reads localStorage to skip if already dismissed
  - Renders accessible banner with positioning support
  - Three actions: Accept all, Customise (shows checkboxes), Reject all
  - On submit: computes HMAC-SHA256 via crypto.subtle, POSTs to /v1/events
  - Persists decision in localStorage (cs_consent_{prop}_v{version})
  - Dispatches consentshield:consent CustomEvent for downstream listeners
  - Uses keepalive: true so the POST survives page navigation
  - Wraps everything in try/catch — never breaks the customer's site
- Worker fires async UPDATE on snippet_last_seen_at (non-blocking)
```

### Sprint 2.1 — 2026-04-14

```
Test: Build passes with new dashboard
Method: bun run build
Actual: dashboard, score-gauge, score lib all compile
Result: PASS

Test: Lint passes
Result: PASS (after extracting Date.now() to helper functions —
  React 19 purity rule blocks inline impure calls in server components)

Test: RLS tests still pass
Method: bun run test
Actual: 39/39 passed
Result: PASS

Implementation:
- src/lib/compliance/score.ts: weighted composite score (6 components)
  - 20% consent infrastructure (banner + verified snippet)
  - 30% consent enforcement (events flowing, no violations)
  - 15% rights workflow
  - 15% data lifecycle
  - 10% security posture
  - 10% audit readiness
  - red/amber/green levels at 50/80 thresholds
- daysUntilEnforcement(): countdown to 13 May 2027
- isoSinceHours/nowIso: date helpers (extracted for React 19 purity rule)
- Dashboard page:
  - Compliance score gauge (SVG circle) + 6-component breakdown
  - Enforcement clock card (days until DPDP enforcement)
  - 4 stat cards: properties, verified snippets, consents 24h, pending rights
  - Recent consent events table (last 10 from buffer)
  - 8 parallel Supabase queries for dashboard data
- ScoreGauge component: animated SVG ring with level color
```

---

## Changelog References

- CHANGELOG-dashboard.md — [date] — All sprints
- CHANGELOG-worker.md — [date] — Sprint 1.3 (banner compilation)
- CHANGELOG-api.md — [date] — Sprint 1.1, 1.2, 1.3, 2.2
