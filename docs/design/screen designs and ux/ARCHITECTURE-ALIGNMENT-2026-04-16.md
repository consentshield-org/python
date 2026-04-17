# Screen Designs — Architecture Alignment

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Companion to:** `consentshield-screens.html`, `consentshield-mobile.html`, `consentshield-next-steps.md` in this folder.
**Aligned to:** `docs/architecture/consentshield-definitive-architecture.md` (951 lines, 20 non-negotiable rules) and `docs/architecture/consentshield-complete-schema-design.md` §11 DEPA Alignment, both at commit `9d1d05b`.
**Date:** 2026-04-16.

---

## 0. Normative reminder — read this before building any UI

> **The HTML wireframes in this folder are the visual and interaction specification for the ConsentShield product UI.** They are the source of truth for layout, copy, navigation, and the user mental model. The Next.js implementation in `app/src/app/` MUST conform to these screens unless a divergence is documented in an ADR (or the wireframes are updated to reflect a new decision and re-aligned via this doc).
>
> Two equally valid update paths:
>
> 1. **Wireframes change first** — a screen is updated here, then the relevant ADR ports it into code.
> 2. **Code changes first** — but only via an ADR that records the rationale, and the wireframes in this folder are updated in the same ADR's sprint to keep them in sync.
>
> What is **not** acceptable: silent UI drift in `app/src/app/` away from these screens. If a screen lacks an element the architecture requires, the screen is to be updated (this doc tracks the gap until that happens). If the architecture changes, the screen is updated in the same review pass that amends the architecture doc — same pattern as the 2026-04-16 DEPA merge.
>
> This rule is mirrored in `CLAUDE.md`. Both files must be read every session.

---

## 1. Why this document exists

The screens in this folder were drafted in April 2026 when ConsentShield's consent model was the pre-DEPA `purposes_accepted[]` JSON array on `consent_events`. The 2026-04-16 architecture amendment merged the DEPA artefact model — per-purpose `consent_artefacts` rows with explicit `expires_at`, `data_scope` declarations, lifecycle states, and replacement chains — into the source-of-truth docs. This added 6 new tables, 9 new authenticated API routes, 5 new Compliance API routes, and 2 new non-negotiable rules (19, 20). It also broadened Rule 3 from FHIR-only to all regulated sensitive content (FHIR + banking identifiers + future sectors).

The HTML screens have not yet absorbed any of that. This document catalogues every drift item, names the architecture rule it touches, and tracks the in-place fix.

The DEPA ADR roadmap (ADR-0019+) will port the DEPA architecture into running code. As each ADR ships, its sprint should: (a) confirm the corresponding screen here matches what the code actually does, (b) update the screen if it doesn't, and (c) tick the item off in §4 of this document. Items deferred to a later ADR (e.g., ABDM Month 6+) stay open with their target ADR cited.

---

## 2. Files in scope

| File | Status | Lines | Editable from session |
|---|---|---|---|
| `consentshield-screens.html` | Updated 2026-04-16 (this pass) | ~1330 after this pass | Yes |
| `consentshield-mobile.html` | Documented gaps; mobile patches deferred | 1080 | Yes (deferred) |
| `consentshield-next-steps.md` | Addendum appended 2026-04-16 | 123 + addendum | Yes |
| `ConsentShield-Master-Design-Document.docx` | Out of sync; binary | — | No (re-export from authoring tool) |

The `.docx` is a Word document and cannot be edited from this session. It should be re-exported from its source authoring tool once the .md/.html in this folder reach steady state.

---

## 3. Drift inventory

Each item: **anchor** (where in the screens), **violates** (which architecture rule or doc section), **current state**, **target state**, **status** (open/done/deferred).

### W1 — Sidebar nav lacks DEPA primitives

- **Anchor:** `consentshield-screens.html` sidebar section (lines 313–369).
- **Violates:** §10.2 API surface (9 new authenticated DEPA routes have no UI entry point).
- **Current:** Dashboard / Consent Manager / Data Inventory / Rights Centre / Audit & Reports / Onboarding / Settings.
- **Target:** Add **Consent Artefacts** and **Purpose Definitions** as top-level nav items between Consent Manager and Data Inventory. Connector mappings live as a sub-tab inside Purpose Definitions (one purpose → many connectors is the natural relationship).
- **Status:** **DONE** in this pass.

### W2 — No Consent Artefacts panel

- **Anchor:** New panel `#panel-artefacts` to be added.
- **Violates:** §6.7 Consent Artefact Pipeline; §7.3 Artefact Lifecycle; Rules 19 + 20.
- **Current:** No way to view, filter, or revoke an individual consent artefact.
- **Target:** Table view: artefact_id (short), purpose code, data_scope chips, status pill (active/replaced/revoked/expired), expires_at countdown, framework (DPDP/ABDM/RBI), created_at, replacement chain link. Row click → detail drawer with the four-link chain of custody (consent_event → artefact → revocation if any → deletion receipts). Top-level filters: status, framework, expiring within 30 days, by purpose.
- **Status:** **DONE** (stub panel added; live data wiring belongs to ADR-0021/22).

### W3 — No Purpose Definitions panel

- **Anchor:** New panel `#panel-purposes` to be added.
- **Violates:** §6.7 (`purpose_definitions` is the keyed catalogue every artefact references); §10.2 routes `/purpose-definitions/*` and `/purpose-definitions/[id]/connectors`.
- **Current:** No catalogue. Banner builder shows ad-hoc strings ("Essential / Analytics / Marketing / Personalisation").
- **Target:** Catalogue table: purpose_code, display_name, description, data_scope (chips), default_expiry_days, framework, auto_delete_on_expiry, sector_template (e.g., `dpdp_minimum`, `bfsi_kyc`, `abdm_records`), active. Edit drawer for each row. Sub-tab "Connectors" per purpose: which deletion connectors fire when an artefact for this purpose is revoked, with the data_scope subset each connector handles.
- **Status:** **DONE** (stub panel + sub-tab added; CRUD wiring belongs to ADR-0024).

### W4 — Banner builder doesn't bind purposes to definitions

- **Anchor:** `consentshield-screens.html` Consent Manager → Banner builder, the `.config-section` for "Consent purposes" (lines 633–663).
- **Violates:** §6.7 (banner save/publish endpoints MUST 422 if any purpose lacks `purpose_definition_id`); Phase B Point 1 from the DEPA review (no legacy data path); Rule 20 (every artefact needs `expires_at`, sourced from the purpose definition).
- **Current:** Each purpose row shows name + description + a toggle/Required pill. No link to a purpose_definition_id. No expires_at. No data_scope.
- **Target:** Each purpose row gains: a "Linked to" select bound to a purpose_definitions row (chip showing purpose_code + framework); `expires_at` derived display ("365 days from grant — from `dpdp_minimum.analytics`"); `data_scope` chips. A red banner appears at the top if any purpose lacks a purpose_definition_id, blocking publish with the same 422 message the API returns. The "Save & publish" button is disabled while any binding is missing.
- **Status:** **DONE** (UI representation added; the matching API 422 already exists by spec — see W11).

### W5 — Dashboard score card is single-dimension

- **Anchor:** `consentshield-screens.html` Dashboard `.score-card` block (lines 397–411).
- **Violates:** §6.7 + the new `depa_compliance_metrics` view; the partnership pitch (DEPA score is the headline differentiator).
- **Current:** One gauge: "DPDP Compliance Score 74%".
- **Target:** Two gauges side by side: "DPDP Score" (existing) and "DEPA Score" (new — derived from `depa_compliance_metrics` row populated by `refresh_depa_compliance_metrics()` nightly cron, itself calling `compute_depa_score(org_id)`). The DEPA gauge shows four sub-metrics: `coverage_score`, `expiry_score`, `freshness_score`, `revocation_score` (each 0–5, total 0–20, displayed as a 0–100% gauge). Caption: "Refreshed nightly · last refresh `<timestamp>`".
- **Status:** **DONE** (visual + 4-sub-metric layout landed; backend refresh + API + UI binding is ADR-0025 scope).
- **Re-aligned 2026-04-17** per ADR-0025: the schema carries four sub-scores (`coverage_score`, `expiry_score`, `freshness_score`, `revocation_score`) per `compute_depa_score` — not the three earlier drafted ("Coverage · Timeliness · Scope precision"). Wireframe sub-label strip updated to match.

### W6 — Dashboard doesn't surface artefact lifecycle health

- **Anchor:** `consentshield-screens.html` Dashboard `.status-grid` block (lines 413–434).
- **Violates:** §7.3 (lifecycle states); operational visibility for Rule 20 (expiring artefacts need re-consent).
- **Current:** Tiles for Consent Banner / Privacy Notice / Data Inventory / Rights Requests.
- **Target:** Add a fifth tile "Consent Artefacts" → counts of active / expiring 30d / revoked-this-week / replaced-this-week. Click-through to `#panel-artefacts` with the relevant filter pre-applied. The "Rights Requests" tile is unchanged in semantics but should now read its breach risk from the artefact-scoped deletion path (§8.4) rather than the legacy purposes-array path.
- **Status:** **DONE** (tile added; data wiring deferred to ADR-0025).

### W7 — Rights Centre erasure is category-scoped, not artefact-scoped

- **Anchor:** `consentshield-screens.html` Rights Centre → Request detail "Data to be erased" block (lines 862–869).
- **Violates:** §8.4 Deletion Orchestration (artefact-scoped deletion with four-link chain of custody).
- **Current:** Free-form rows ("Email address — Can erase / Usage analytics — Can erase / Payment records — Retention lock").
- **Target:** Rendered from the user's active artefacts. Each row: purpose chip → data_scope chips → connector(s) that will fire → expected receipts. "Retention lock" rendered when a connector reports `retention_lock=true` (e.g., 7-year statutory hold for payment data). Footer summarises: "Will revoke `N` artefacts and dispatch `M` deletion requests across `K` connectors."
- **Status:** **DONE** (visual reshape; live data binding is ADR-0022 scope).

### W8 — Audit & Reports doesn't include DEPA evidence

- **Anchor:** `consentshield-screens.html` Audit & Reports — Audit readiness score block (lines 916–933) and Report builder (lines 902–910).
- **Violates:** §6.7; testing-strategy Priority 10; Rules 19 + 20 (artefact lifecycle is auditable).
- **Current:** Three score sections (Consent & notice / Data management / Rights & breach). Report builder has 6 boxes; none mention artefacts.
- **Target:** Add a fourth audit score section "DEPA artefact governance" with rows: artefact coverage (every banner purpose has a definition), expiry compliance (no artefact past expires_at), revocation responsiveness (median time from revocation to all receipts), data_scope sanity (no values, only categories — Rule 3). Report builder gains a checkbox: "Consent artefact ledger — `<count>` artefacts · current month".
- **Status:** **DONE**.

### W9 — Onboarding doesn't seed purpose definitions

- **Anchor:** `consentshield-screens.html` Onboarding flow Step 4 (template selection, lines 1071–1090) and Step 6 (initial score, lines 1104–1119).
- **Violates:** §6.7; DEPA review Phase B Point 1.
- **Current:** Step 4 picks a banner template (Minimal / Standard / Full). Step 6 shows a generic 52% score.
- **Target:** Step 4 picks a **purpose definition seed pack** in addition to (or replacing) the banner-style template — choices: "DPDP minimum (5 purposes)", "DPDP + analytics extended (8 purposes)", "BFSI starter (DPDP + KYC retention exemptions, 11 purposes)", "Healthcare/clinic starter (DPDP + ABDM purposes, gated to ABDM enrolment, 9 purposes)". The chosen pack inserts purpose_definitions rows. Step 6 shows the **DEPA score** alongside the DPDP score, and the next-actions list includes "Map purpose `<x>` to a connector" for every purpose without a connector mapping.
- **Status:** **DONE**.

### W10 — Settings has no Industry → Purpose mapping

- **Anchor:** `consentshield-screens.html` Settings → Account details (lines 974–990); Industry select.
- **Violates:** §6.7; bridges to W9.
- **Current:** Industry dropdown affects "which DPDP templates are pre-applied" but the templates are unspecified.
- **Target:** Industry dropdown's helper text references the purpose definition seed packs from W9. A new row below: "Sector template" — read-only display of the active seed pack with a link to Purpose Definitions (W3). Switching industry prompts a non-destructive add-on of the new sector's purpose_definitions (existing definitions are preserved; user resolves overlaps in the Purpose Definitions catalogue).
- **Status:** **DONE**.

### W11 — Banner save 422 path has no error UX

- **Anchor:** `consentshield-screens.html` Consent Manager top bar — "Save & publish" button (line 540).
- **Violates:** §6.7 Phase B Point 1 (banner save MUST return 422 + P1 alert when any purpose lacks a purpose_definition_id).
- **Current:** Button is unconditionally clickable. No error surface.
- **Target:** Button is disabled while any unbound purpose exists; tooltip explains why. A red error banner appears above the builder when the API returns 422, listing the offending purposes.
- **Status:** **DONE** (paired with W4).

### W12 — No worker_errors operational view

- **Anchor:** `consentshield-screens.html` — no current panel.
- **Violates:** N-S1 fix from `docs/reviews/2026-04-16-phase2-completion-review.md` (the `worker_errors` table exists but has no UI).
- **Current:** Worker write failures land in `worker_errors` (7-day retention). No surface to read them.
- **Target:** A "Pipeline health" tile on the Dashboard counts `worker_errors` rows in last 24h with a badge colour (green 0, amber 1–9, red ≥10). Click-through opens a small drawer listing recent errors (timestamp, endpoint, error text). Not a full ops console — that's outside the customer-facing app.
- **Status:** **DONE** (tile added on dashboard).

### M1 — Mobile Flow 3 (clinic) treats ABDM and DPDP as separate

- **Anchor:** `consentshield-mobile.html` `patientConsent` screen (line 874–937).
- **Violates:** §6.7 (DEPA model unifies the two — one `consent_artefacts` row carries `framework='abdm'` AND satisfies DPDP requirements simultaneously).
- **Current:** Note reads "Both ABDM consent artefact and DPDP consent are captured in a single interaction" — implying two separate records.
- **Target:** Update copy to "A single DEPA artefact records the consent for both ABDM and DPDP — no double entry." Visual unchanged; this is a copy and mental-model fix.
- **Status:** **DEFERRED** to ABDM ADR (Month 6+; gated on clinic pilot signups). Tracked here so it's not forgotten.

### M2 — Mobile Flow 1 doesn't mention artefact-scoped revocation

- **Anchor:** `consentshield-mobile.html` `requestDetail` screen (line 583).
- **Violates:** §8.4 (deletion is now per-artefact, not per-category).
- **Current:** "Quick actions at bottom — full 7-step workflow hands off to web."
- **Target:** Quick action "Revoke `<N>` artefacts" matches the artefact-scoped path. Counts and connector preview on the mobile screen mirror the web Rights Centre detail (W7).
- **Status:** **DEFERRED** to the mobile rebuild ADR (post-DEPA roadmap). Tracked here.

### W13 — No "Support sessions" tab in customer Settings

- **Anchor:** Settings panel in `consentshield-screens.html` — currently has Account / Web properties / Team members / Integrations / Billing nav items.
- **Violates:** Admin platform architecture §6.4 (customer audit access) and §8.4. Rule 23 requires customers can audit every impersonation against their org.
- **Cross-reference:** `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §4 (W-Admin-CustomerVisibility).
- **Current:** No way for the customer to see whether (or when) an operator impersonated their account.
- **Target:** New Settings tab "Support sessions". Lists every impersonation session against this org (read from `public.org_support_sessions` view, defined in `docs/admin/architecture/consentshield-admin-schema.md` §3.3). Each row shows: admin user (display name only), reason, reason_detail, started_at, ended_at, status (active/completed/expired/force_ended), actions_summary. A "Request detailed audit" button initiates an export of every audit row tagged with that session_id, mailed to the org's compliance contact.
- **Status:** **OPEN** — wireframe addition deferred to the sprint that ships admin Impersonation (admin ADR-0029 with customer follow-up).

### W14 — No suspended-org banner state

- **Anchor:** Dashboard panel in `consentshield-screens.html`; banner Worker behaviour in `worker/src/banner.ts`.
- **Violates:** Admin platform architecture §7.1 (`/api/admin/orgs/[id]/suspend` exists but has no customer-side surface).
- **Cross-reference:** `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §4 (W-Admin-OrgSuspension).
- **Current:** A suspended org silently sees the same dashboard. The Worker doesn't differentiate banner delivery for suspended orgs.
- **Target:** (a) Worker reads `org.status` and serves a no-op banner if `status='suspended'` (no consent collection while suspended; customer site continues to function). (b) Customer dashboard renders a top-of-page red banner "Your account is suspended — contact support@consentshield.in" with a link to the Support Tickets feature when it ships (or `mailto:` until then). All other panels render read-only.
- **Status:** **OPEN** — wireframe addition deferred to the sprint that ships admin Org Management (admin ADR-0029 with customer follow-up).

### M3 — No Banking sector breach copy in Flow 2

- **Anchor:** `consentshield-mobile.html` Flow 2 breach screens.
- **Violates:** Q1 partnership pivot (BFSI as Phase 2 priority); Rule 3 broadened to cover banking identifiers.
- **Current:** Generic breach copy.
- **Target:** When the active sector template includes BFSI, breach wizard surfaces RBI cyber-incident reporting (6-hour clock to RBI in addition to 72-hour DPB clock) and the regulated identifier categories (PAN, account number, etc.).
- **Status:** **DEFERRED** to the BFSI sectoral template ADR.

---

## 4. Reconciliation tracker

A live checklist of each item against the ADR that ports it into code. Tick when the ADR ships.

| ID | Description | Owner ADR | Wireframe done | Code shipped |
|---|---|---|---|---|
| W1 | Sidebar nav additions | ADR-0019 (charter) | ✅ 2026-04-16 | ☐ |
| W2 | Consent Artefacts panel | ADR-0021 / ADR-0022 | ✅ 2026-04-16 | ☐ |
| W3 | Purpose Definitions panel + Connectors sub-tab | ADR-0024 | ✅ 2026-04-16 | ☐ |
| W4 | Banner builder binds purpose_definition_id | ADR-0020 | ✅ 2026-04-16 | ☐ |
| W5 | DEPA score gauge | ADR-0025 | ✅ 2026-04-16 | ☐ |
| W6 | Artefact lifecycle dashboard tile | ADR-0025 | ✅ 2026-04-16 | ☐ |
| W7 | Rights Centre artefact-scoped erasure | ADR-0022 | ✅ 2026-04-16 | ☐ |
| W8 | Audit & Reports DEPA section | ADR-0025 + ADR-0017 follow-up | ✅ 2026-04-16 | ☐ |
| W9 | Onboarding purpose seed pack | ADR-0024 | ✅ 2026-04-16 | ☐ |
| W10 | Settings sector template | ADR-0024 | ✅ 2026-04-16 | ☐ |
| W11 | Banner save 422 error UX | ADR-0020 | ✅ 2026-04-16 | ☐ |
| W12 | Worker pipeline health tile | (operational — no DEPA dependency) | ✅ 2026-04-16 | ☐ |
| W13 | Customer "Support sessions" tab (admin cross-ref) | ADR-0029 customer follow-up | ☐ awaiting wireframe | ☐ |
| W14 | Suspended-org banner state (admin cross-ref) | ADR-0029 customer follow-up | ☐ awaiting wireframe | ☐ |
| M1 | Mobile clinic copy unification | ABDM ADR (Month 6+) | ☐ deferred | ☐ |
| M2 | Mobile artefact-scoped revocation | Mobile rebuild ADR | ☐ deferred | ☐ |
| M3 | Mobile BFSI breach copy | BFSI sectoral ADR | ☐ deferred | ☐ |

---

## 5. Conventions used in updates

To keep new screens visually coherent with the existing wireframes:

- All new panels use the same `<div class="panel" id="panel-XXX">` pattern with `.topbar` + `.content-area`.
- New nav items use the same `.nav-item onclick="showPanel('XXX')"` pattern.
- New status pills follow the existing `.pill .pill-{green,amber,red,navy,gray}` palette.
- DEPA-specific copy is marked `(DEPA)` inline so a designer reading the wireframe sees what is post-amendment.
- Where a stub element references data not yet present in the code (e.g., `depa_compliance_metrics.coverage_score`), the wireframe uses a static example value but the architecture reference is named in a HTML comment for the implementing engineer.

---

## 6. Things this pass deliberately did not change

- The visual design system (DM Sans, navy/teal palette, sidebar layout, card shadows). Out of scope.
- The mobile screens (deferred to mobile rebuild ADR; documented in M1–M3).
- The .docx master design document (binary; out-of-band re-export from authoring tool).
- The landing page (`docs/design/consentshield-landing.html`) and architecture diagrams (`docs/design/consentshield-architecture-diagrams.html`) — separate review, separate scope.
- The next-steps.md historical record. Only an addendum was appended.
- BFSI screens. The partnership pivot sets BFSI as Phase 2 priority, but the sectoral UI is large enough to warrant its own ADR + wireframe pass.

---

## 7. How to use this document going forward

For every DEPA ADR sprint:

1. Open this document.
2. Find the ADR's owner items in §4.
3. While building, treat the screen here as the spec — diverge only by amending the wireframe in the same sprint.
4. Once the code matches the wireframe, tick the "Code shipped" column in §4 with the commit hash.

When the architecture changes (any future amendment to the source-of-truth docs), add a new section §8, §9, etc. with the date, the architecture diff summary, and the screen drift table. Do not delete §3; old drift items become historical record.
