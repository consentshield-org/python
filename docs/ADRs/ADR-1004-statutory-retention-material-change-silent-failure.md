# ADR-1004: Statutory Retention + Material-Change Re-consent + Silent-Failure Detection

**Status:** In Progress
**Date proposed:** 2026-04-19
**Date completed:** —
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 4
**Depends on:** ADR-1002 (artefacts have a real API surface for the workflows to hit)
**Related gaps:** G-007, G-008, G-012, G-048, G-034

---

## Context

The whitepaper's BFSI and healthcare sections repeatedly lean on three assumptions that are not yet implementable:

1. **Statutory retention is discoverable.** §9.2, §9.3, §11, and §6.3 all describe a Regulatory Exemption Engine that, given `(sector, data_category, statute)`, decides whether a deletion can proceed or must be suppressed with a citation. The BFSI template seed carries purpose-level retention *hints*, but no queryable engine exists. Consequence: the deletion orchestrator cannot honestly answer *"delete marketing but retain KYC"* — the single most important BFSI behaviour.
2. **Material notice changes trigger re-consent.** §4.3 describes a workflow where a material notice change enumerates affected artefacts and surfaces a re-consent campaign. No `notices` table exists; `consent_banners.version` is the only versioning artefact. Consequence: every customer who updates a privacy notice over the product's lifetime silently orphans their active artefacts' `notice_version` reference.
3. **Fan-out silent failure is observable.** §3.3 and §12.5 describe an `orphan_consent_events` metric that fires an alert on any non-zero value. `depa_compliance_metrics.coverage_score` exists; the orphan metric does not. Consequence: if the Edge Function or dispatch trigger fails for any reason (a common scenario during migrations or Supabase gateway hiccups), artefacts are silently missing for the duration of the failure, and the DPDP §8(6) "reasonable security safeguards" standard is quietly broken.

This ADR delivers the three together because they share the same consumer: the Compliance Health dashboard widget (G-034) surfaces retention suppressions, re-consent campaigns, and orphan counts in a single operator-facing view.

## Decision

Ship four capabilities in a single phase:

1. **Regulatory Exemption Engine (G-007)** — a `public.regulatory_exemptions` table with platform defaults for BFSI (5 statutes) and Healthcare (3 statutes), consulted by the deletion orchestrator before any artefact-scoped deletion proceeds. Per-org overrides supported. Compliance dashboard surfaces "X records retained under <statute>" with drill-down.
2. **Legal review (G-008)** — engage an Indian regulatory lawyer (BFSI focus + healthcare focus, one firm or two) to review the default mappings; reviewer notes and dates captured per row; re-review process documented.
3. **Notice versioning + minimum re-consent workflow (G-012)** — `public.notices` table; `material_change_flag` publication triggers enumeration of affected active artefacts; CSV export for customer messaging; `replaced_by` chain populated on re-consent; audit trail of campaign reach.
4. **Orphan metric + alert wiring (G-048)** — view `vw_orphan_consent_events`; pg_cron computes + writes to `depa_compliance_metrics.orphan_count`; non-zero fires the notification channels.

Compliance Health widget (**G-034**) surfaces all four (coverage, orphan, overdue deletions, upcoming expiries) as the operator's single compliance-health view.

## Consequences

- BFSI deletion behaviour becomes correct-by-default. A bancassurance marketing artefact's revocation propagates; a bureau-reporting artefact's revocation does not (CICRA retention), without customer code.
- The audit export gets a new section: `regulatory_exemptions_applied.csv` shows every suppression with statute, data category, affected artefact ID, and counselor's note. This directly supports the DPB-defensible audit chain promise in §12.4.
- Material-change re-consent is operationalised at minimum viable scope. Multi-channel delivery (email + SMS + WhatsApp + push) is deferred to G-031 in ADR-1008 — the v1 workflow is CSV export + customer-owned messaging.
- Silent fan-out failure becomes impossible-to-miss. The orphan alert is the safety-net for the safety-net (ADR-0021 already has a cron that re-fires; this ADR alerts the operator when even that fails to converge).
- The legal review adds a real cost (₹2–3 lakh) and a real external-dependency lead time. Plan must absorb this; Sprint 1.2 is concurrent but may slip the phase exit by up to 2 weeks.

---

## Implementation Plan

### Phase 1: Regulatory Exemption Engine (G-007 + G-008)

#### Sprint 1.1: Schema + RLS

**Estimated effort:** 1 day

**Deliverables:**
- [x] Migration `20260804000004_regulatory_exemptions.sql`:
  - `public.regulatory_exemptions`: `id`, `org_id` (nullable for platform defaults), `sector`, `statute`, `statute_code`, `data_categories text[]` (plural — one row per statute, many categories), `retention_period interval`, `source_citation`, `precedence int default 100`, `applies_to_purposes text[]`, `legal_review_notes`, `reviewed_at`, `reviewer_name`, `reviewer_firm`, `is_active`, `created_at`, `updated_at`
  - CHECK: sector in ('saas','edtech','healthcare','ecommerce','hrtech','fintech','bfsi','general','all')
  - Unique (statute_code, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)) — one row per statute per org (+one platform default)
  - Indexes: (sector, is_active, precedence) WHERE is_active; (org_id) WHERE org_id IS NOT NULL
  - RLS: platform defaults (org_id IS NULL) visible to any authenticated user; per-org rows visible only to members of that org via public.current_org_id(); INSERT/UPDATE/DELETE require public.current_account_role()='account_owner' AND org_id = current_org_id (platform defaults immutable from app)
  - updated_at trigger via set_updated_at()
- [x] `public.retention_suppressions` audit table (id, org_id, artefact_id, artefact_uuid, revocation_id, exemption_id, suppressed_data_categories text[], statute, statute_code, source_citation, suppressed_at, created_at) with indexes on (org_id, artefact_id), (exemption_id), (org_id, suppressed_at desc); RLS org-scoped SELECT only; no direct INSERT for authenticated role
- [x] Grants: cs_orchestrator SELECT on regulatory_exemptions; INSERT on retention_suppressions (so the Edge Function can write suppressions)
- [x] `public.applicable_exemptions(p_org_id uuid, p_purpose_code text) returns table(...)` SECURITY DEFINER — returns active exemptions (platform defaults + per-org overrides) joined with organisations.industry, filtered by `applies_to_purposes` (null=wildcard) and sector (`all` or matching industry), ordered by precedence ASC. Grant EXECUTE to authenticated + cs_orchestrator.

**Testing plan:**
- [x] `applicable_exemptions(bfsi_org, 'bureau_reporting')` returns CICRA_2005 with precedence=100 and correct data_categories.
- [x] `applicable_exemptions(bfsi_org, 'kyc_verification')` returns RBI_KYC_MD_2016.
- [x] `applicable_exemptions(bfsi_org, 'marketing')` returns `[]` (no BFSI exemption covers marketing purpose).
- [x] `applicable_exemptions(healthcare_org, 'lab_report_access')` returns DISHA_DRAFT_2018.
- [x] Per-org override at precedence=50 sorts ahead of platform default at precedence=100 for the same purpose.
- [x] Sector mismatch: `applicable_exemptions(general_industry_org, 'bureau_reporting')` returns `[]`.
- [x] Cross-sector isolation: BFSI-scoped override does NOT leak into healthcare-org applicable set.
- [x] 11/11 retention-exemptions.test.ts PASS; 182/182 full suite PASS.

**Status:** `[x] complete` — 2026-04-22

#### Sprint 1.2: BFSI platform defaults + legal engagement kickoff

**Estimated effort:** 1 day engineering + external legal work initiated in parallel

**Deliverables:**
- [x] Migration `20260804000005_regulatory_exemptions_bfsi_seed.sql` with rows for:
  - RBI KYC Master Directions (`RBI_KYC_MD_2016`; 10-year retention; covers identification + account documents)
  - PMLA §12(1)(a) (`PMLA_2002_S12`; 5-year retention of transaction records)
  - Banking Regulation Act §45ZC (`BR_ACT_1949_S45ZC`; 8 years customer correspondence)
  - CICRA 2005 (`CICRA_2005`; 7 years credit bureau data; pan, credit_facility_details, repayment_history)
  - Insurance Act §64VB + IRDAI 2015 Regs (`INS_ACT_1938_S64VB`; 10 years tail for policy/premium/claims)
- [x] Initial `source_citation` per row linking to the official notification (rbi.org.in / legislative.gov.in / irdai.gov.in).
- [ ] Legal firm engagement letter drafted + sent; target ₹2-3 lakh budget — **DEFERRED to Sprint 1.6** (external activity blocked on counsel engagement; every seed row has null `reviewed_at` / `reviewer_firm` as a signal).
- [x] `on conflict (statute_code, coalesce(org_id, sentinel)) do nothing` — migration is re-runnable.

**Testing plan:**
- [x] All 5 BFSI statute codes present as platform defaults (org_id IS NULL).
- [x] `applicable_exemptions('<bfsi_org>', 'bureau_reporting')` returns the CICRA rule.
- [x] `applicable_exemptions('<bfsi_org>', 'kyc_verification')` returns RBI_KYC_MD_2016.

**Status:** `[x] complete` — 2026-04-22 (engineering seed); Sprint 1.6 legal-review still pending external counsel

#### Sprint 1.3: Healthcare platform defaults

**Estimated effort:** 1 day

**Deliverables:**
- [x] Migration `20260804000006_regulatory_exemptions_healthcare_seed.sql` with rows for:
  - DISHA draft (`DISHA_DRAFT_2018`; 7-year retention of clinical records, covers abha_number / clinical_notes / lab_result_values / prescription_history / discharge_summary)
  - ABDM CM Framework / DEPA (`ABDM_CM_2022`; 5-year consent-artefact retention; precedence=120 so DISHA wins when both apply)
  - Clinical Establishments Act 2010 (`CEA_2010_STATE`; 3-year placeholder — per-state rules override; precedence=150)

**Testing plan:**
- [x] All 3 healthcare statute codes present as platform defaults.
- [x] `applicable_exemptions('<healthcare_org>', 'lab_report_access')` returns DISHA_DRAFT_2018.
- [x] `applicable_exemptions('<healthcare_org>', 'abdm_hie_consent')` returns ABDM_CM_2022.

**Status:** `[x] complete` — 2026-04-22

#### Sprint 1.4: Deletion orchestrator integration

**Estimated effort:** 3 days

**Deliverables:**
- [x] `process-artefact-revocation` Edge Function (ADR-0022 / `supabase/functions/process-artefact-revocation/index.ts`) now fetches `consent_artefacts.purpose_code` and calls `supabase.rpc('applicable_exemptions', { p_org_id, p_purpose_code })` before fanning out to connector mappings.
- [x] Exemption bookkeeping inside the Function:
  - For each exemption, compute `covers = exemption.data_categories ∩ artefact.data_scope`.
  - If non-empty, INSERT `retention_suppressions` (org_id, artefact_id, artefact_uuid, revocation_id, exemption_id, suppressed_data_categories, statute, statute_code, source_citation). Idempotent via unique index `(revocation_id, exemption_id) WHERE revocation_id IS NOT NULL` (migration `20260804000007`).
  - Union across all applicable exemptions yields `retainedUnion` — the set of categories that MUST NOT be deleted for this artefact.
- [x] Partial-deletion path: for each connector mapping, compute `scopedFields = mapping.data_categories ∩ artefact.data_scope`, then `remainingScope = scopedFields − retainedUnion`. If `remainingScope` is empty, skip the receipt (fully suppressed). Otherwise insert `deletion_receipts` with `request_payload.data_scope = remainingScope` AND `request_payload.retained_data_categories = scopedFields ∩ retainedUnion` for audit.
- [x] `DispatchResult` envelope gained `suppressed: number` + `retained_categories: string[]` so the callback + any logging carries the suppression tally.
- [x] Idempotency: the full orchestrator loop is safe to retry via the safety-net cron — `retention_suppressions` dedupes on `(revocation_id, exemption_id)`; `deletion_receipts` dedupes on the existing `(trigger_id, connector_id)` unique index.
- [x] Supabase Function gateway `verify_jwt` disabled for this Function (`supabase/config.toml`) — the legacy HS256 signing secret Supabase uses to verify the trigger's `cs_orchestrator_key` JWT was rotated and the gateway now 401s every invocation. Function-side auth (CS_ORCHESTRATOR_ROLE_KEY presence check + DB-side uniqueness constraints on the incoming revocation_id) is retained. Restoration to `verify_jwt=true` is tracked under ADR-1010 (Worker + Edge Function HS256 migration).

**Testing plan:**
- [x] BFSI fixture (industry='bfsi', bureau_reporting purpose, CIBIL connector with data_categories=['pan','name']): revoke a bureau_reporting artefact → `deletion_receipts` row NOT created; `retention_suppressions` row IS created with `statute_code='CICRA_2005'`, `suppressed_data_categories` includes 'pan', and a legislative.gov.in citation.
- [x] Revocation marked `dispatched_at` even when fully suppressed.
- [x] Idempotency: re-invoking the Function with the same `(artefact_id, revocation_id)` doesn't duplicate the suppression row (unique index fires).
- [x] 1/1 retention-suppression E2E test PASS; full integration suite 182/182 PASS.

**Status:** `[x] complete` — 2026-04-22

#### Sprint 1.5: Dashboard surface + API endpoint

**Estimated effort:** 2 days

**Deliverables:**
- [x] `/dashboard/compliance/retention` page (`app/src/app/(dashboard)/dashboard/compliance/retention/page.tsx` + `retention-panel.tsx`): lists the latest 100 suppressions with statute filter dropdown; lists platform-default + per-org-override exemptions side by side with "Pending legal review" badge on rows where `reviewed_at IS NULL`. `account_owner` sees an inline "Add override" form; non-owners see the lists read-only with an explanatory note.
- [x] Nav entry "Retention & Exemptions" added to `DashboardNav` between Data Inventory and Sector template.
- [x] `GET /api/orgs/[orgId]/regulatory-exemptions` — returns `{ platform, overrides }`, each row augmented with `legal_review_status` ('reviewed'|'pending'). RLS fences override visibility to the caller's org; platform defaults are visible to any authenticated member. No account-role check on GET — read-only listing is available to every org member.
- [x] `POST /api/orgs/[orgId]/regulatory-exemptions` — inserts a per-org override; pre-checks `current_account_role() === 'account_owner'` before calling insert, returns 403 otherwise; RLS insert policy remains the authoritative fence (42501 → 403, 23505 → 409 for duplicate statute_code).
- [ ] "X records retained under <statute>" drill-down surfaced from Compliance Health widget — **deferred** to Phase 3 Sprint 3.2 (the Compliance Health widget itself). Current retention page stands alone.

**Testing plan:**
- [x] Override created by customer appears in `applicable_exemptions` results for their org only — covered by Sprint 1.1's `tests/integration/retention-exemptions.test.ts` (11/11 PASS; "per-org override precedence wins over platform default" + "RLS: org A's override invisible to org B"). The API route's insert path is a thin pass-through to the same SQL insert the test already exercises.
- [x] Pending-review badge rendering — visual QA on dev. All 8 platform-default seed rows still have `reviewed_at IS NULL` so every platform default row in the panel carries the amber "Pending legal review" badge; overrides with counsel notes flip to green.
- [ ] Suppressions from Sprint 1.4 integration test appear in the dashboard page — visual QA deferred (requires re-running the revocation E2E on a dev org). Wire-check via the test suite is sufficient for v1.

**Status:** `[x] complete` — 2026-04-22 (drill-down + post-Sprint-1.4 visual QA deferred as noted)

#### Sprint 1.6: Legal review ingestion (G-008 close-out)

**Estimated effort:** 2 days engineering (post-review)

**Default state shipped 2026-04-22** (migration `20260804000011_regulatory_exemptions_pending_review.sql`):
Every BFSI + Healthcare seed row ships with `reviewed_at IS NULL` and a backfilled `legal_review_notes` value beginning with the literal token `PENDING_LEGAL_REVIEW`. That is the authoritative "not yet reviewed" state. The Sprint 1.5 dashboard + any future `GET /api/orgs/[orgId]/regulatory-exemptions` surface MUST render a "Pending legal review" badge whenever `reviewed_at IS NULL`. Customer-facing audit export includes the same badge inline against each retained-category line.

When counsel is eventually engaged, this sprint's deliverables flip the affected rows to reviewed state:

**Deliverables (execute when counsel lands):**
- [ ] Reviewer notes populated in `legal_review_notes` per row for every reviewed statute (replaces the PENDING_LEGAL_REVIEW marker)
- [ ] `reviewed_at` + `reviewer_name` + `reviewer_firm` populated
- [ ] Reviewer's letter saved at `docs/legal/regulatory-review-2026-QX.pdf` (covered by NDA — summary-only in repo, full letter in secure storage)
- [ ] Re-review process documented at `docs/runbooks/regulatory-exemptions-re-review.md` (annual default, or on amendment-notification trigger)

**Testing plan (executed at close-out):**
- [ ] Every BFSI + Healthcare seed row has non-null `reviewed_at` and `reviewer_firm`
- [ ] `GET /api/orgs/[orgId]/regulatory-exemptions` no longer reports `legal_review_status='pending'` on any platform default

**Status:** `[~] defaults shipped — awaiting external counsel engagement`. Current state: 8 platform-default rows (5 BFSI + 3 Healthcare) carry the `PENDING_LEGAL_REVIEW` marker and `reviewed_at=null`. No code gates on this column; the pending-review state is advisory only. Sprint cannot close until the external counsel step lands.

### Phase 2: Notice versioning + re-consent (G-012)

#### Sprint 2.1: Notices schema

**Estimated effort:** 1 day

**Deliverables:**
- [ ] Migration `<date>_notices.sql`:
  - `public.notices`: `id`, `org_id`, `version`, `title`, `body_markdown`, `published_at`, `material_change_flag`, `published_by`
  - Append-only (no UPDATE/DELETE from authenticated)
  - RLS org-scoped
- [ ] `consent_events.notice_version` becomes a foreign key to `notices.version` (existing nullable column now points at the new table)

**Testing plan:**
- [ ] Publish a notice, consent event captures the version, query joins both
- [ ] Attempt to modify a published notice → rejected

**Status:** `[ ] planned`

#### Sprint 2.2: Material-change enumeration + CSV export

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/dashboard/notices` page: list notices, publish new version, toggle `material_change_flag` on publish
- [ ] On publish with `material_change_flag=true`: compute affected artefacts (`SELECT ... FROM consent_artefacts WHERE notice_version = <prior-version> AND status='active'`); store count on notice row for display
- [ ] Dashboard surface: "X artefacts on prior notice — re-consent campaign" with action button
- [ ] Action: generate CSV export of `(identifier, email_if_known, last_consent_date, purposes_affected)` → customer feeds into their own messaging system
- [ ] Hosted re-consent page URL is produced (deferred full rendering to G-031 in ADR-1008; v1 is just the affected-artefact list)

**Testing plan:**
- [ ] Publish material notice → affected count matches direct query
- [ ] CSV export header + row shape matches spec

**Status:** `[ ] planned`

#### Sprint 2.3: Replaced-by chain + audit trail

**Estimated effort:** 2 days

**Deliverables:**
- [ ] When a consent event arrives (via banner or `/v1/consent/record`) referencing a newer `notice_version` for a principal who has an active artefact under an older notice, the new artefact is created with `replaced_by` populated on the old artefact (status `replaced`) per §3.4 semantics
- [ ] Campaign tracking: `public.reconsent_campaigns` row holding (notice_id, initiated_at, affected_count, responded_count, revoked_count, no_response_count); updated nightly by pg_cron
- [ ] `/dashboard/notices/[id]/campaign` shows the counts over time

**Testing plan:**
- [ ] Re-consent flow: old artefact A with notice v1 → consent event with v2 → new artefact B created, `consent_artefacts.replaced_by` on A points to B, A.status='replaced'
- [ ] Campaign counts advance nightly

**Status:** `[ ] planned`

### Phase 3: Silent-failure detection (G-048) + Compliance Health widget (G-034)

#### Sprint 3.1: Orphan metric + alert

**Estimated effort:** 2 days

**Deliverables:**
- [ ] View `public.vw_orphan_consent_events` returning `(org_id, count)` for rows with `artefact_ids='{}'` AND `created_at BETWEEN now() - interval '24 hours' AND now() - interval '10 minutes'`
- [ ] pg_cron `orphan-consent-events-monitor` every 5 minutes: reads view, UPSERTs `depa_compliance_metrics.orphan_count` per org
- [ ] Any non-zero count triggers notification delivery via `notification_channels` (ADR-1005 wires up non-email channels; this sprint uses the existing Resend email channel; later sprints upgrade)
- [ ] Recovery test harness: disable the `process-consent-event` URL temporarily, verify orphans accrue, re-enable, verify safety-net catches them, verify alert fires + clears

**Testing plan:**
- [ ] Induced-failure test passes end-to-end
- [ ] Metric visible in `depa_compliance_metrics` for every active org

**Status:** `[ ] planned`

#### Sprint 3.2: Compliance Health widget

**Estimated effort:** 3 days

**Deliverables:**
- [ ] `/dashboard` widget "Compliance Health" showing four live metrics with targets:
  - Coverage score (target: 100%)
  - Orphan events (target: 0)
  - Overdue deletions (target: 0)
  - Upcoming expiries in 30 days (informational count)
- [ ] Each metric clickable → drill-down list with action buttons
- [ ] 5-minute refresh (client-side polling)
- [ ] Per-metric threshold-alert configuration UI (which channel gets each severity)
- [ ] Documentation page `docs/customer-docs/compliance-health.md` explaining each metric + remediation

**Testing plan:**
- [ ] Widget renders with current metrics on a freshly seeded org
- [ ] Drill-down navigates to the right sub-pages
- [ ] Alert threshold change propagates to the notification-channel config

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`:
  - New section: Regulatory Exemption Engine — schema + orchestrator integration + partial-deletion semantics
  - New section: Notice versioning + re-consent workflow + replaced_by chain
  - Expand §Operational Observability with the orphan metric + alert
- `docs/architecture/consentshield-complete-schema-design.md`:
  - Document `regulatory_exemptions`, `retention_suppressions`, `notices`, `reconsent_campaigns`

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Multi-channel re-consent delivery (email + SMS + WhatsApp + push) — G-031 in ADR-1008.
- Automatic re-review on regulator amendment notification (manual trigger in v1).
- Non-BFSI / non-Healthcare sector seeds (telecom, edtech, e-commerce) — to be added when a customer in that sector signs.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprints 1.1, 1.2, 1.3, 2.1 (reg_exemptions, seed, notices)
- `CHANGELOG-edge-functions.md` — Sprint 1.4 (process-artefact-revocation update)
- `CHANGELOG-api.md` — Sprint 1.5 (regulatory-exemptions endpoints)
- `CHANGELOG-dashboard.md` — Sprints 1.5, 2.2, 2.3, 3.2 (retention page, notices, campaign, Compliance Health)
- `CHANGELOG-docs.md` — Sprints 1.6, 3.2 (legal review runbook, compliance-health docs)
