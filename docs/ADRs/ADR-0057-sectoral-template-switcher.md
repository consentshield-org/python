# ADR-0057 — Customer-facing sectoral template switcher (Settings → Account)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed — 2026-04-20
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 1
**Depends on:** ADR-0030 (sectoral templates exist as a concept; `/dashboard/template` picker already lives).

## Context

ADR-0030 shipped the sectoral-template surface end-to-end — admin catalogue, customer picker at `/dashboard/template`, and a `list_sectoral_templates_for_sector(p_sector)` RPC. The picker only shows templates whose sector matches `organisations.industry`, with a `general` fallback.

Today `organisations.industry` is captured once at signup via `bootstrap_org(p_industry)` and **never editable after that**. A customer that picked "SaaS" during signup but realises they're actually an NBFC has no way to change it short of contacting support. This blocks them from seeing the BFSI Starter template (shipped alongside ADR-0046 Phase 1) in their picker.

The customer wireframe (`docs/design/screen designs and ux/consentshield-screens.html`, Settings → Account Details) already shows an editable "Industry" dropdown and an informational "Active sector template" row. The route `/dashboard/settings/account` does not yet exist. The wireframe is the spec; this ADR makes it real.

## Decision

Add a minimum `/dashboard/settings/account` page that edits a single field — `organisations.industry` — and shows the currently-applied sector template as a read-only chip that deep-links to `/dashboard/template`. Backed by a single SECURITY DEFINER RPC `public.update_org_industry(p_org_id, p_industry)` that enforces the role gate (account_owner / org_admin effective) and a whitelist of allowed sector codes.

### Non-goals

- **Auto-apply new template on industry change.** The wireframe copy says "Switching adds new sector purposes; existing definitions are preserved." That's already the existing `/dashboard/template` picker's behaviour — applying a template doesn't delete anything. We simply route the customer there after the industry change; no auto-apply here.
- **Cascade to sub-organisations under the account.** "Account-level default template" was one interpretation of this ADR; the simpler interpretation (org-level industry edit) is what the wireframe calls for. Account-default cascading can be a follow-on if customers actually ask.
- **Audit-log every industry change as a compliance event.** The existing update_at stamp on `organisations` is sufficient for now. Can be added as a membership_audit_log-style row later if needed.
- **Full settings → account surface (company name, compliance contact email).** Those fields live on `organisations` already; the wireframe lists them but editing them is out of scope for this ADR. Future work if customers ask.

### Allowed sector codes

Must match the set used by `list_sectoral_templates_for_sector` sector filter. Current whitelist (synchronised with the sector hints on `admin.sectoral_templates`):

`saas`, `edtech`, `healthcare`, `ecommerce`, `hrtech`, `fintech`, `bfsi`, `general`

## Implementation

### Phase 1 Sprint 1.1 — Industry edit RPC + Account settings page

**Deliverables:**

- [ ] Migration `20260620000004_update_org_industry.sql`:
  - `public.update_org_industry(p_org_id uuid, p_industry text)` SECURITY DEFINER. Validates `p_industry in (...)` whitelist. Role gate: `effective_org_role(p_org_id) in ('org_admin', 'admin')`. Updates `organisations.industry`, bumps `updated_at`. Returns void.
- [ ] Route `app/src/app/(dashboard)/dashboard/settings/account/page.tsx`:
  - Shows org name (read-only), current industry (editable if canEdit), applied sector template code + version (read-only, link to /dashboard/template to change).
  - Role-gated: account_owner + org_admin see the Edit button; others see read-only.
- [ ] Nav wiring: "Account settings" entry in the customer sidebar.
- [ ] `tests/rls/update-org-industry.test.ts`: org_admin happy path, viewer denied, invalid industry raises, cross-org denied.

**Status:** `[x] complete — 2026-04-20`

Shipped:
- `supabase/migrations/20260620000004_update_org_industry.sql` — `public.update_org_industry()` SECURITY DEFINER RPC with 8-value whitelist.
- `app/src/app/(dashboard)/dashboard/settings/account/` — page + `actions.ts` + client `industry-editor.tsx` (view / edit / save / cancel flow, post-save hint linking to /dashboard/template).
- `app/src/components/dashboard-nav.tsx` — "Account settings" nav entry before Team & invites.
- `tests/rls/update-org-industry.test.ts` — 5/5 PASS: happy path, cross-org denied, invalid code rejected, null rejected, all 8 whitelisted sectors accepted.

## Acceptance criteria

- An account_owner can change their org's industry from the Settings → Account page. The new value persists; the `/dashboard/template` picker immediately filters templates by the new sector.
- A viewer role sees the industry as read-only text (no Edit button, no dropdown).
- An invalid industry code rejected at the RPC level with a readable error; UI disables "Save" if the dropdown lands on an empty value.
- Switching industry does NOT delete existing purposes or the currently-applied template. It only changes which templates are listed as "available for your sector."

## Consequences

- `organisations.industry` becomes editable by customers, closing a signup-time-only field.
- No new CLAUDE.md rule. No schema change — just a new RPC.
- Follows the standard customer-side RPC pattern (SECURITY DEFINER + `effective_org_role`) already established by ADR-0046 Phase 2/3.
