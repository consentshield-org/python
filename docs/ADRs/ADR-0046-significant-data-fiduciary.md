# ADR-0046: Significant Data Fiduciary (SDF) Foundation

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress (Phase 1 Sprint 1.1 shipped — schema + admin RPC + tests)
**Date proposed:** 2026-04-18

> Phase 1 Sprint 1.1 implementation notes are appended at the bottom of this file. Phases 2–4 remain charter-only.
**Depends on:** ADR-0044 (accounts/organisations hierarchy — SDF status lives on organisations), ADR-0017 (audit-export package — DPIA reports reuse the ZIP shape), ADR-0030 (sectoral templates — BFSI template lands alongside SDF workflow).
**Related:** `docs/architecture/consentshield-definitive-architecture.md` §7 Rule 3 (regulated sensitive content).

## Context

The DPDP Act, 2023 §10 empowers the Central Government to notify
classes of Data Fiduciaries as **Significant Data Fiduciaries
(SDFs)** based on volume + sensitivity of personal data processed,
risk to rights of Data Principals, risk to electoral democracy,
security of the State, and public order. The April 2025 Draft Rules
under the Act give concrete volume-based triggers (e.g., processing
personal data of >N lakh Data Principals over the preceding rolling
twelve-month window) and sector-based triggers that will catch most
BFSI customers above a modest size, all sizeable edtech and health
platforms, and any ad-tech intermediary with pan-India reach.

Once designated an SDF, the organisation takes on obligations that
a non-SDF does not:

1. **Appoint a Data Protection Officer (DPO)** based in India,
   reporting to the Board. Contact details must be published.
2. **Appoint an independent Data Auditor** and **conduct periodic
   data audits**. Audit reports must be retained.
3. **Carry out Data Protection Impact Assessments (DPIAs)** for
   processing operations likely to result in "significant impact"
   on Data Principals. DPIAs have a prescribed structure under the
   Draft Rules.
4. **Undertake periodic DPIAs and algorithmic audits** (if the SDF
   uses AI/ML on personal data that can affect rights).
5. **Additional transparency** — publish summarised DPIA findings.
6. **Restrictions on cross-border transfer** for SDF-held data
   depending on Central Government notifications.

ConsentShield today has no notion of SDF status. `organisations`
has `industry` and (Phase 0 of ADR-0044 moved plan/billing to
`accounts`). No column flags an organisation as SDF. No table
stores DPIA records. No workflow connects an organisation to an
independent auditor's attestation. The dashboard does not show SDF
obligations or track compliance with them.

For BFSI customers this is the load-bearing gap. An NBFC or bank
onboarding ConsentShield and discovering at deal-close that we have
no path to record their DPIA cycles or auditor engagements will
bounce to a competitor that does.

## Decision (shape, not detail)

Introduce an SDF foundation as three stacked surfaces, smallest
first.

### Surface 1 — SDF status marker on organisations

- Add `organisations.sdf_status text not null default 'not_designated' check (...)`.
- Values: `'not_designated'` (default), `'self_declared'` (customer claims SDF voluntarily), `'notified'` (Central Government notification received — rare, auditable), `'exempt'` (notification carved out the class; stored for record-keeping).
- Add `organisations.sdf_notified_at timestamptz` and `organisations.sdf_notification_ref text` (Gazette notification reference or Ministry letter ID, captured as a category — no image, no PDF bytes; customer keeps the artefact in their own storage).
- Dashboard renders an "SDF status" card on the Settings → Account panel when any non-default value is set.

### Surface 2 — DPIA record table

- New `public.dpia_records` (org-scoped, RLS, role-gated to account_owner + org_admin).
- Columns: `id`, `org_id`, `title`, `processing_description`, `data_categories` (jsonb array of category strings — **never values**, per Rule 3), `risk_level`, `mitigations` (jsonb), `auditor_attestation_ref` (text — URL/reference to the customer-stored audit artefact), `auditor_name`, `conducted_at`, `next_review_at`, `created_by`, `status` ('draft'|'published'|'superseded').
- `public.create_dpia_record`, `public.publish_dpia_record`, `public.supersede_dpia_record` RPCs with the same role gate shape used by the invitation flow.
- Dashboard panel at `/dashboard/dpia` listing records with a "Schedule next review" nudge when `next_review_at` is within 30 days.
- No PDF upload, no binary storage. The customer stores the DPIA document in their own system and records the reference here. Rule 3 consistent.

### Surface 3 — Independent auditor engagement record

- `public.data_auditor_engagements` — auditor name, registration/PAN (category, not value — see note), scope, start/end dates, attestation_ref.
- A single row per audit cycle. DPIA records can FK back via `auditor_attestation_ref` when the same cycle produced both.
- Similar CRUD RPCs.
- Dashboard panel under Settings → Compliance.

### What this ADR does NOT do

- **Does not produce the DPIA itself.** Customers draft DPIAs in their own tools; we store references + structured metadata.
- **Does not integrate with any specific audit firm's API.** Static record-keeping only.
- **Does not replace the audit-export package** (ADR-0017). SDF-specific exports can be added as a follow-up phase if customers demand.
- **Does not gate billing or plan features by SDF status.** The SDF feature is available to every plan tier; billing remains plan-based (ADR-0034).
- **Does not cover algorithmic audits** for SDFs using AI on personal data. That's a larger scope — a follow-up ADR if/when customers raise it.

## Phase breakdown (tentative)

| Phase | Surface | Notes |
|-------|---------|-------|
| 1 | `organisations.sdf_status` column + migration + dashboard card | ~1 sprint. Minimum viable surface. |
| 2 | `dpia_records` table + RPCs + `/dashboard/dpia` list + create form | ~2 sprints. Most customer-facing value. |
| 3 | `data_auditor_engagements` table + RPCs + settings panel | ~1 sprint. Ties back to DPIA records. |
| 4 | DPIA-summary export (SDF transparency requirement) | ~1 sprint. Extends ADR-0017 audit export. |

Each phase testable in isolation; stops can land between phases
without leaving half-finished state.

## Acceptance criteria (for the full ADR, once all phases land)

- An operator can mark an organisation SDF-notified via the admin
  console; the status flows back to the customer dashboard within
  one RLS/RPC cycle.
- An account_owner can create a DPIA record, attach an auditor
  reference, mark it as published, and see a scheduled-review
  reminder.
- Dashboard Home + Settings both surface SDF obligations for
  orgs with `sdf_status != 'not_designated'`.
- Audit-export ZIP (ADR-0017) includes any DPIA records + auditor
  engagement rows for the period covered, with category-only data
  (Rule 3 discipline preserved).
- At least one BFSI customer test account can walk through
  end-to-end: mark SDF, record DPIA, record auditor, export audit
  package, download ZIP. No sensitive content (PAN/Aadhaar/balance)
  leaves the customer's own storage.

## Open questions (before Phase 1 starts)

1. Does `admin.sectoral_templates` already carry a "requires SDF
   workflow" signal, or should the template metadata add one?
   Likely a follow-up field on `sectoral_templates` (`sdf_hint
   boolean`) rather than a new join table.
2. Does the audit-export ZIP (ADR-0017) need re-partitioning to
   include DPIA records as a separate manifest section, or does
   the existing "compliance_records" section absorb them?
3. Cross-border-transfer gating — defer to a future ADR or include
   a minimal `org_transfers_allowed_regions text[]` column in
   Phase 1? Probably defer; the Central Government notification
   mechanism for allowed regions isn't active yet.
4. Scoped role for the DPIA / auditor-engagement write path —
   same `cs_orchestrator` used elsewhere, or a new `cs_dpia` role
   for tighter boundary? Likely reuse cs_orchestrator; the tables
   already have RLS.

## V2 / deferred scope

- Algorithmic-audit workflow for SDFs running AI/ML on personal data.
- Board-level DPO contact directory (Draft Rules may prescribe structure).
- Automated DPIA review reminders via the existing Resend infra.
- Export the SDF-specific transparency summary to a public URL the
  customer can publish (satisfies the "publish summarised DPIA
  findings" obligation).

## Relation to other ADRs

- **ADR-0044** supplies the `accounts`/`organisations` split this
  ADR extends. SDF status lives at the organisation level because
  a single account can have one SDF-designated org and several
  non-designated orgs.
- **ADR-0030 (Sectoral Templates)** — BFSI Starter template
  (authored in the same 2026-04-18 session as this charter) can
  carry an `sdf_hint` field once Phase 1 of this ADR lands, so
  customers picking the BFSI template are prompted to declare SDF
  status on onboarding.
- **ADR-0017 (Audit Export)** — the ZIP contract is extended by
  Phase 4 of this ADR to include a DPIA section. No breaking change
  to the existing export manifest shape.
- **Rule 3 (regulated sensitive content)** — respected throughout.
  DPIA records store category declarations + references to
  customer-held artefacts; they never hold PAN values, bank
  balances, or clinical records.

---

## Phase 1 Sprint 1.1 — shipped 2026-04-18

**Deliverables:**

- [x] `supabase/migrations/20260505000001_sdf_foundation.sql` — adds `organisations.sdf_status` (not_designated / self_declared / notified / exempt, default not_designated) + `sdf_notified_at timestamptz` + `sdf_notification_ref text`. Check constraint enforces the enum. Partial index `organisations_sdf_designated_idx` keeps the "list all SDF-flagged orgs" query cheap. Rule 3 respected — only categories/references, never notification PDF bytes.
- [x] `admin.set_sdf_status(p_org_id, p_sdf_status, p_sdf_notification_ref, p_sdf_notified_at, p_reason)` — platform_operator only. Audit-logged. Clears notification metadata when reverting to `not_designated` so stale values don't linger.
- [x] `tests/admin/sdf-rpcs.test.ts` — 7 assertions: self_declared happy path, notified with metadata, revert clears metadata, unknown status rejected, short-reason rejected, missing-org rejected, support role denied. **7/7 PASS**.

**Status:** `[x] complete` — 2026-04-18

Phase 1 Sprint 1.2 (admin UI edit + customer dashboard card) is next.

## Phase 1 Sprint 1.2 — shipped 2026-04-18

**Deliverables:**

- [x] Admin `/orgs/[orgId]`:
  - `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — `setSdfStatus` Server Action wrapping `admin.set_sdf_status`.
  - `admin/src/app/(operator)/orgs/[orgId]/sdf-card.tsx` — client card + edit modal. Status pill (gray/amber/red/green), current ref + notified-at, Edit button gated on platform_operator. Modal disables metadata fields when status = not_designated; surfaces an amber note that reverting clears the ref.
  - `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — injects the SDF card before the Contacts card in the three-column header grid, with the org's current sdf_status/sdf_notified_at/sdf_notification_ref passed in.
- [x] Customer `app/src/app/(dashboard)/dashboard/page.tsx`:
  - Org select extended with `sdf_status, sdf_notified_at, sdf_notification_ref`.
  - New `SdfObligationsCard` server component — renders only when `sdf_status != 'not_designated'`. Shows the DPDP §10 obligations (DPO, independent auditor, DPIAs, published transparency summaries), tone-coded by status, notification metadata when present. Closes with a pointer to Phase 2+ DPIA/auditor surfaces (stub note).
- [x] Build + lint clean on both apps.

**Status:** `[x] complete` — 2026-04-18

Phase 1 complete. Phase 2 Sprint 2.1 shipped 2026-04-20 (see below). Phase 2 Sprint 2.2 (customer UI) is next. Phases 3 (`data_auditor_engagements`) and 4 (DPIA export extension) remain — charter-only.

## Phase 2 Sprint 2.1 — shipped 2026-04-20

**Deliverables:**

- [x] `supabase/migrations/20260620000001_dpia_records.sql`:
  - `public.dpia_records` table — org-scoped, RLS with read via `effective_org_role()` so account_owner inheritance works. Columns: title, processing_description, data_categories (jsonb array of category strings — Rule 3: never values), risk_level (low/medium/high), mitigations (jsonb object), auditor_attestation_ref + auditor_name (references, not bytes), conducted_at, next_review_at, status (draft/published/superseded), superseded_by FK, audit timestamps.
  - `public.create_dpia_record()` — org_admin / admin (effective) only; creates in draft state.
  - `public.publish_dpia_record()` — lifecycle transition draft → published; raises on re-publish.
  - `public.supersede_dpia_record(old_id, replacement_id)` — same-org check, old flips to superseded, replacement auto-published if still draft.
  - Updated-at trigger; indexes on (org_id, status, conducted_at) + next_review_at for "review due" queries.
- [x] `tests/rls/dpia-records.test.ts` — 10/10 PASS covering: org_admin create happy path, cross-org create refused, cross-org read isolation, publish lifecycle, re-publish guard, supersede with replacement, cross-org replacement refused.

**Status:** `[x] complete` — 2026-04-20

Phase 2 Sprint 2.2 (customer UI at `/dashboard/dpia`) is next.
