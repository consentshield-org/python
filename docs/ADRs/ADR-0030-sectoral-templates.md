# ADR-0030: Sectoral Templates (Admin Panel + Customer-Side Read)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-17
**Date completed:** —

---

## Context

Sectoral templates are pre-composed bundles of purpose definitions + legal bases + default retentions for a given industry sector (DPDP Minimum, BFSI Starter, Healthcare Clinic, Edtech Starter, etc.). A customer picking a template during onboarding gets a coherent starting point instead of authoring every purpose from scratch.

Infrastructure shipped with ADR-0027:

- `admin.sectoral_templates` — template record (code, display_name, sector, version, status ∈ {draft, published, deprecated}, purposes jsonb, created_by, metadata).
- RPCs `admin.create_sectoral_template_draft`, `admin.update_sectoral_template_draft`, `admin.publish_sectoral_template`, `admin.deprecate_sectoral_template` — all SECURITY DEFINER, all audit-logged (Rule 22).
- `public.list_sectoral_templates_for_sector(sector)` — customer-side read helper; returns published templates only.

What is missing is the operator UI to create, edit, publish, and deprecate templates, and the customer-side surface to consume them during onboarding. Today templates can only be authored via raw SQL against the `purposes` jsonb column — which is a practical blocker to adding new sectors.

Wireframe references:
- Admin: `docs/admin/design/consentshield-admin-screens.html` §4 ("Sectoral Templates") — list + editor split with purpose definitions table.
- Customer: the onboarding panel in `docs/design/screen designs and ux/consentshield-screens.html` already references template selection; the exact surface will be confirmed in Sprint 3.1.

## Decision

Two implementation sprints for the admin side (read-only list → full editor), one sprint for the customer-side consumer. Platform-operator writes only; support + read_only roles see the list + detail but no action buttons.

Core invariant (from schema design): a template is immutable once published. Editing a published template means creating a new `version` as a `draft`, editing it, then publishing (which auto-deprecates the prior version via the existing `publish_sectoral_template` RPC). The UI surfaces this clearly — the editor has "Edit" on drafts and "Clone as new version" on published templates.

## Consequences

- A platform operator can add a new sector template (e.g., "insurance_broker") through the admin UI in ~10 minutes once purposes are drafted, without touching SQL.
- Customer onboarding flow gains a sector-picker step that pulls from `list_sectoral_templates_for_sector`. This may (per the existing customer wireframe) require adjustments to the signup → dashboard first-time-user flow; scoping check happens in Sprint 3.1 planning.
- Templates are versioned, not edited-in-place once published — protects orgs that picked an older version from silent drift.

---

## Implementation Plan

### Sprint 1.1: /templates list + detail (read-only)

**Estimated effort:** 2 hours.

**Deliverables:**
- [x] `admin/src/app/(operator)/templates/page.tsx` — Server Component. Fetches `admin.sectoral_templates` ordered by sector, template_code, version desc. Filters: status (published / draft / deprecated / all), sector. Pill counts in the header (N published · N drafts · N deprecated). Row-click deep-links to the detail page.
- [x] `admin/src/app/(operator)/templates/[templateId]/page.tsx` — detail page. Metadata cards (Created / Published / Deprecated with admin display names and successor link if deprecated), description, notes, purpose-definitions table. Used-by count deferred (no orgs pick a template through UI yet — lands with Sprint 3.1).
- [x] `admin/src/components/templates/filter-bar.tsx` — Client Component. Sector select populated from the list's distinct sectors + status select. Clear-filters link appears when either is set.
- [x] `admin/src/app/(operator)/layout.tsx` — "Sectoral Templates" nav item live, `href=/templates`.

**Testing plan:**
- [x] `cd admin && bun run build` — /templates + /templates/[templateId] compile (11 routes total).
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 135/135 (no regression).

**Status:** `[x] complete` — 2026-04-17

### Sprint 2.1: Draft editor + publish/deprecate actions

**Estimated effort:** 3 hours.

**Deliverables:**
- [ ] `admin/src/app/(operator)/templates/new/page.tsx` — "+ New draft" form. Fields: template_code, display_name, sector, initial description. Creates a `version=1` draft via `create_sectoral_template_draft`.
- [ ] `admin/src/app/(operator)/templates/[templateId]/edit/page.tsx` — draft editor (only enabled when status=draft). Editable fields: display_name, description, purposes (purpose_code, display_name, framework pills, data_scope category list, default_expiry, auto_delete). "Add purpose" button appends a row; each row has delete. Save calls `update_sectoral_template_draft` with the full purposes jsonb.
- [ ] `admin/src/app/(operator)/templates/[templateId]/actions.ts` — Server Actions: `createDraft`, `updateDraft`, `publishTemplate` (with reason ≥ 10 chars), `deprecateTemplate` (with reason + replacement template_code). All platform_operator only.
- [ ] Detail page: when status=published, show "Clone as new version" button that creates a new draft based on the current purposes jsonb. When status=draft, show "Edit" and "Publish". When status=deprecated, show "View only" notice.
- [ ] Confirmation modal for Publish (shows diff vs prior version in jsonb form) and Deprecate (requires reason + optional replacement).

**Testing plan:**
- [ ] Existing RPC tests in `tests/admin/rpcs.test.ts` cover the four RPCs — no new RPC tests needed.
- [ ] Manual: create draft → edit purposes → publish → confirm prior published version auto-deprecates (`publish_sectoral_template` RPC handles this). Deprecate without replacement; deprecate with replacement — verify audit entries distinct.
- [ ] Cross-role: support user sees read-only list + detail but no Edit / Publish / Deprecate buttons.

**Status:** `[ ] planned`

### Sprint 3.1: Customer-side template picker (planning check in Sprint 2.1)

**Estimated effort:** TBD — scope locks when we check which customer wireframe owns the template-selection surface. Likely onboarding flow.

**Deliverables (tentative):**
- [ ] Customer onboarding sector selector reads `public.list_sectoral_templates_for_sector(sector)`.
- [ ] Applying a template writes the selected `template_code` + `version` into `public.organisations.settings.sectoral_template`.
- [ ] A future DEPA sprint (not this one) may auto-materialise the template's purposes into `public.purpose_definitions` for the org. Scope gated on DEPA panel work.

**Status:** `[ ] planned — will confirm scope during Sprint 2.1 closeout`

---

## Architecture Changes

None to the schema. Purposes jsonb shape is already defined by the existing `admin.sectoral_templates.purposes` column and consumed by `public.list_sectoral_templates_for_sector`.

Possible schema-doc amendment in Sprint 3.1 if the customer-side consumer needs a new column (e.g., `public.organisations.settings.sectoral_template` — may not exist yet).

---

## Test Results

_To be filled per sprint as the work executes._

---

## Risks and Mitigations

- **Publishing a broken template silently breaks new signups using that sector.** Mitigation: the "Preview against org" action in the wireframe is out of scope for Sprint 2.1 (deferred to V2); until it ships, the operator is responsible for careful review before clicking Publish. A reason ≥ 10 chars is captured so the intent is auditable.
- **Purposes jsonb drift — an operator edits a draft with stale data_scope categories.** Mitigation: the editor presents existing categories as pills with remove/add. Free-text "Add category" is deliberate — categories are operator-managed ontology, not controlled.

---

## Out of Scope (Explicitly)

- **"Preview against org" action** in the topbar — deferred to V2 (requires a simulation surface that renders what the customer would see).
- **"Diff vs vN" action** in the editor — show-diff-on-publish is in Sprint 2.1 scope; on-demand diff is deferred.
- **Bulk import of templates from external regulatory sources.** Out of scope; manual authoring only.
- **Customer-side admin rendering of the currently-applied template.** Customer dashboards already expose purposes via the DEPA panel (ADR-0020+); no new surface needed.

---

## Changelog References

- `CHANGELOG-dashboard.md` — per-sprint entries.
- Sprint 3.1 may add `CHANGELOG-schema.md` if a new column lands.

---

*ADR-0030 — Sectoral Templates. Depends on ADR-0027 (admin schema + RPCs).*
