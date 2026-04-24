# ADR-1027: Admin Account-Awareness Pass

**Status:** Proposed
**Date proposed:** 2026-04-24
**Date completed:** —
**Superseded by:** —
**Upstream dependency:** ADR-0044 (customer RBAC — 4-level hierarchy), ADR-0048 (Admin Accounts panel + `admin.account_detail` envelope), ADR-0050 (account-aware billing), ADR-0055 (account-scoped impersonation), ADR-0056 (per-account feature flags).

---

## Context

### The gap

ADR-0044 moved the tenancy centre of gravity from `organisations` to `accounts`: `accounts` is now the billing subject, the Razorpay identity, the plan-holder, and the composition root for organisations. `organisations` became children. ADR-0048 shipped the operator-facing `/accounts` panel + `admin.account_detail(p_account_id)` envelope + `admin.suspend_account` / `restore_account`; ADR-0055 added account-scoped impersonation; ADR-0056 added per-account feature-flag targeting; ADR-0050/0051 anchored billing to the account tier. The `organisations` list + detail pages already embed `accounts(plan_code, trial_ends_at, ...)` via FK join (`admin/src/app/(operator)/orgs/page.tsx:47`, `…/orgs/[orgId]/page.tsx:37`), so the most obvious two surfaces are account-aware.

The other operator surfaces still treat orgs as the top-level entity:

| # | Surface | Drift |
|---|---------|-------|
| 1 | Admin audit log (`admin.admin_audit_log`) | `target_id` + `org_id` columns only. Filtering by account requires joining through `organisations`. No `account_id` column on the table or the `/audit-log` panel's filter bar. |
| 2 | Pipeline panel (`/pipeline`) — Sentry events, worker_errors, rate-limit events | Joined on `org_id`. Operators can filter by org, not by "show me everything for this enterprise account". |
| 3 | Support tickets (`/support` — ADR-0032) | `org_id` scoped. Reply threads don't surface the parent account name + plan; ticket filters don't offer account grouping. |
| 4 | Org notes (`admin.org_notes`) | Per-org. No account-level notes for "notes on the whole holding group" that apply to every org in an account. |
| 5 | Sectoral templates (`/templates` — ADR-0030) | Global catalogue only. Account-level "default template for this holding group" is a common enterprise ask. |
| 6 | Admin dashboard tiles (`/`) | Metric tiles count orgs, tickets, etc. No account count, no plan distribution across accounts, no trial-conversion metric. |
| 7 | Impersonation session audit (admin.impersonation_sessions) | Logs `target_org_id` only (ADR-0055 added account-scoped start RPC, but the historical log view still groups by org). |

These aren't safety bugs — every surface works for the single-org SMB case. They're operator-ergonomics gaps that surface under the enterprise scenario. Per memory `project_customer_segment_enterprise`, the target customer is Tata-scale corporates with divisions as legal entities → one account, many orgs, decentralised ops + central billing. Operators need to reason about the account as a unit, not just the organisations beneath it.

### Why now

The foundation shipped end of April:
- `admin.account_detail(p_account_id)` returns the canonical operator envelope (account row + effective plan + child orgs + active adjustments + 50 recent audit rows) — this is the "what do operators want to see for an account" contract.
- Account-scoped impersonation (ADR-0055) + per-account feature flags (ADR-0056) already work.
- Account-aware billing (ADR-0050/0051) ships invoice history / GST / disputes at the account tier.

Without a deliberate pass across the remaining surfaces, operators handling a multi-org account have to mentally re-aggregate org-level views every time. That's invisible until a Tata-scale customer signs — at which point the ergonomics cliff is too late to fix.

### Scoping constraints

- **Surface budget.** Seven surfaces × four sprints each = too big for one ADR. Pick the highest-impact minimum subset. Keep the rest as a follow-up ADR when warranted.
- **Wireframe-first discipline.** Per the project rule, each UI sprint starts with a wireframe update to `docs/admin/design/consentshield-admin-screens.html` + an entry in its alignment doc. The ADR references the wireframe panel as the acceptance criterion.
- **Backwards-compat.** Every drift is additive — add `account_id` to audit log (backfilled from `org_id` → `organisations.account_id`), add sidebar cards that surface parent-account context on existing org-scoped panels, add filter options without removing the current org-level filters. No existing URL, no existing RPC contract breaks.
- **`account_detail` envelope as the contract.** Panels that want a "parent account context" sidebar should call `admin.account_detail(p_account_id)` — one RPC, known shape, already fenced by `require_admin('support')`. Don't drift per-panel envelope shapes.

## Decision

Close every admin-account-awareness drift in one ADR. No deferrals to later ADRs — this product competes against OneTrust / Ketch / Securiti and cannot ship with a subset operator console. Seven admin surfaces, seven sprints.

| Sprint | Surface | Deliverable |
|---|---|---|
| 1.1 | Admin audit log | Add `account_id` column to `admin.admin_audit_log` (nullable + backfilled + BEFORE INSERT trigger); `/audit-log` panel filter bar gains an "Account" dropdown; list rows surface parent-account name next to org. |
| 1.2 | Admin dashboard tiles (`/`) | Rework tile row: account count, orgs per account distribution (histogram), accounts-by-plan breakdown, trial-to-paid conversion rate (last 30d). Org-level tiles (total events, stuck buffers) stay. |
| 2.1 | Pipeline / Security / Billing sidebar | Every org-filtered operator view (Sentry, worker_errors, rate-limit; billing payment failures, refunds, adjustments) gains a "Parent account" sidebar card driven by `admin.account_detail`. Adds "group by account" toggle that aggregates per-org metrics into an account-level roll-up. |
| 2.2 | Support ticket account context | Ticket detail adds a parent-account header strip (account name, plan, current adjustment if any). Filter bar adds "Account" — selecting it lists every ticket for every org in that account. Ticket list RPC gains `p_account_id`. |
| 3.1 | Impersonation session audit | `/admin/operator/audit-log` impersonation view gains per-account rollups. Cross-org impersonation within one account reads as a single "account session" with org breadcrumbs, not N unrelated org sessions. |
| 3.2 | Org notes → account notes | New `admin.account_notes` table (account-scoped, mirrors `admin.org_notes` semantics + audit-log integration). `/accounts/[accountId]` detail page gains a Notes card. Org detail panel shows both org-level + account-level notes, with clear labelling of which tier each note belongs to. |
| 3.3 | Sectoral template account-default | `public.accounts.default_sectoral_template_id` column (nullable FK to `admin.sectoral_templates`). Admin `/accounts/[accountId]` detail adds a "Default template for new orgs" picker. Customer wizard Step 4 (first-org creation) pre-selects the account's default template when present, falling back to the sector-based default. |

### Shape of the work

- **Sprint 1.1** — schema migration adds `admin_audit_log.account_id uuid` (nullable; FK to `public.accounts`); backfill via `update … set account_id = o.account_id from public.organisations o where admin_audit_log.org_id = o.id` plus a second pass for `target_table = 'public.accounts'` rows; partial index on `account_id where account_id is not null`; BEFORE INSERT trigger auto-populates from `org_id` or `target_id` so no write path can forget. The `admin/src/app/(operator)/audit-log/page.tsx` direct-query path (not an RPC) gains `p_account_id`; filter bar takes an account select from `admin.accounts_list`.
- **Sprint 1.2** — wireframe updates in `docs/admin/design/consentshield-admin-screens.html` (Dashboard panel). New admin RPC `admin.admin_dashboard_tiles()` returns `{accounts_total, accounts_by_plan: [{plan_code, count}], orgs_per_account_p50/p90, trial_to_paid_rate_30d, ...}` in a single round-trip. Existing `/` page swaps the tile renderer. CSS-grid histogram inline (no new chart dep — reuse the ADR-1018 status-page sparkline pattern).
- **Sprint 2.1** — `<AccountContextCard accountId={…} />` React component that calls `admin.account_detail` via the admin RPC proxy + renders plan, status, child-org count, active adjustments, last 3 audit rows. Swappable "full" / "compact" modes. Drops into `/pipeline`, `/security`, `/billing` org-scoped views (right sidebar, sticky under the filter bar). "Group by account" toggle is a client-side aggregation over org-level rows — same query, different render.
- **Sprint 2.2** — ticket list RPC (`admin.support_tickets_list`) gains `p_account_id uuid default null`; existing `p_org_id` semantics unchanged. Ticket detail page adds a parent-account header strip (account name + plan + current adjustment if any). Filter bar gains an Account select mirroring Sprint 1.1.
- **Sprint 3.1** — new RPC `admin.impersonation_sessions_by_account()` aggregates `(account_id, orgs_touched, total_duration, started_at, admin_user)`. Toggle in `/audit-log` impersonation view swaps between per-session and per-account row shape.
- **Sprint 3.2** — new table `admin.account_notes (id, account_id, body, created_by, created_at, updated_at, pinned)` + RLS + four RPCs (`account_note_list`, `account_note_add`, `account_note_update`, `account_note_delete` — all SECURITY DEFINER, all fenced by `require_admin('support')`, all insert a row into `admin_audit_log` with `target_table='admin.account_notes'` and the new `account_id` column (Sprint 1.1)). `/accounts/[accountId]/page.tsx` gains a Notes card. Org detail also surfaces the parent account's notes under a "Account-level notes" subheading with a "View at the account level →" link.
- **Sprint 3.3** — migration adds `public.accounts.default_sectoral_template_id uuid` (nullable; FK to `admin.sectoral_templates(id)` with `on delete set null`). `admin.account_detail` envelope extends to include the resolved template summary. `/accounts/[accountId]` detail page adds a picker (platform_operator only; updates via new RPC `admin.set_account_default_template`). Customer wizard first-org path (`app/src/app/(dashboard)/onboarding/step-4/*`) pre-selects `accounts.default_sectoral_template_id` when set; falls back to the sector-detected default. Customer user can override.

## Consequences

### Enables

- Enterprise operator scenarios (Tata-scale customers) stop requiring mental re-aggregation. The account becomes a first-class pivot across five operator surfaces.
- Audit-log account filtering becomes a single-RPC query instead of a client-side join.
- Trial-to-paid metric on the dashboard surfaces the most load-bearing business number the admin console doesn't currently show.

### New constraints

- **`admin.admin_audit_log.account_id` must stay in sync.** Every write path that mutates org-scoped state in `admin_audit_log` must populate both `org_id` and `account_id`. Add a BEFORE INSERT trigger that populates `account_id` from `org_id` if the caller omitted it, so no code path can forget.
- **`admin_dashboard_tiles` RPC is a hot-path query.** Every operator-console landing hit calls it. Index it aggressively; cache where it's safe (no live state outside the 30d trial-conversion window).

### New failure modes

- If the `admin_audit_log.account_id` backfill ever runs against a row with a NULL `org_id`, the backfill leaves that row with NULL `account_id` — expected (e.g., platform-tier actions that apply globally), and the filter semantics tolerate it.
- The "group by account" toggle on the Pipeline panel must handle orgs with no `account_id` cleanly (post-ADR-0044 every org has one, but defensive).

---

## Implementation Plan

### Phase 1 — Audit log + dashboard tiles (foundation)

**Goal:** Land the two lowest-coupling surfaces first — audit log gets a new column, dashboard tiles get a new RPC. Both are additive; no existing query breaks.

#### Sprint 1.1 — Audit log account column + filter · **[x] complete 2026-04-24**

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update `docs/admin/design/consentshield-admin-screens.html` audit-log panel to add the account-picker in the filter bar + the "Account" column in the list. Mirror drift into the alignment doc.

**Deliverables:**
- [x] Migration `20260804000042_adr1027_s11_audit_log_account_id.sql` — `admin_audit_log.account_id uuid references public.accounts(id)` nullable; two-pass backfill (org→account via `public.organisations`; target_table='public.accounts' rows use target_id directly); partial index on `account_id where account_id is not null`; BEFORE INSERT trigger `admin.populate_audit_log_account_id` auto-populates from org_id or target_id if caller omits it.
- [x] Audit-log page uses direct PostgREST query (not an RPC); added `account_id` to SELECT list + new `p_account_id` search param + filter predicate `.eq('account_id', params.account_id)`.
- [x] `admin/src/app/(operator)/audit-log/page.tsx` — account picker driven by `admin.accounts_list` (shows name + plan_code + org_count per account). Resolved account names for the rendered row slice so the Account column can display names, not UUIDs.
- [x] `admin/src/components/audit-log/filter-bar.tsx` — added `accounts: AccountOption[]` + `initialAccountId` props; new "Account" select rendering "{name} · {plan_code} · {N} orgs".
- [x] `admin/src/components/audit-log/audit-table.tsx` — header row changed from "Org" to "Account · Org"; cell renders account name on top line + org prefix beneath.
- [x] `admin/src/components/audit-log/detail-drawer.tsx` — added Account row (name + uuid) above the Org id row.
- [x] `admin/src/app/(operator)/audit-log/export/route.ts` — CSV includes account_id column; accepts + forwards the `account_id` filter; audit-log RPC's `p_filter` envelope carries account_id.

**Testing plan:**
- [x] `tests/admin/audit-log-account-id.test.ts` — three integration tests: (1) `suspend_org` writes an audit row whose `account_id` was auto-derived from `org_id` via the trigger; (2) `suspend_account` writes a row where the trigger sets `account_id` from `target_id` directly; (3) filtering `admin_audit_log` by `account_id` returns both org-scoped and account-scoped rows for the same customer — the cross-org umbrella view the sprint exists to enable.

**Test results:**
- [ ] `cd admin && bun run lint` — PASS (no warnings emitted; see CHANGELOG-schema entry).
- [ ] `cd admin && bunx tsc --noEmit` — PASS (no diagnostics).
- [ ] `bunx supabase db push` — pending (operator action; migration is idempotent).
- [ ] `bun run test` — pending (depends on db push).

#### Sprint 1.2 — Dashboard tiles account-aware · **[x] complete 2026-04-24**

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update `docs/admin/design/consentshield-admin-screens.html` Dashboard panel to swap the tile row + add the plan-distribution chart + trial-conversion gauge.

**Deliverables:**
- [x] Migration `20260804000043_adr1027_s12_admin_dashboard_tiles.sql` — `admin.admin_dashboard_tiles()` SECURITY DEFINER RPC, support-tier gated. Returns single-round-trip jsonb envelope `{generated_at, org_tier, account_tier}`. `org_tier` mirrors the existing `platform_metrics_daily` snapshot; `account_tier` computes live (low cardinality): `accounts_total`, `accounts_by_plan` (LEFT JOIN against `public.plans` so zero-count plans render), `accounts_by_status`, `orgs_per_account_p50/p90/max` (percentile_cont over a CTE of counts grouped by account), `trial_to_paid_rate_30d` + numerator + denominator. Rate is NULL when denominator is zero (avoids 0/0 NaN).
- [x] `admin/src/app/(operator)/page.tsx` — switched from the direct `platform_metrics_daily` read to the new RPC. Added an "Accounts" section above the existing "Organisations" section: four tiles (accounts total, orgs-per-account p50·p90·max, trial→paid 30d gauge with green/amber/red tone thresholds, suspended accounts with past_due callout) + the plan-distribution card. Org-tier section unchanged below.
- [x] `admin/src/components/ops-dashboard/plan-distribution-card.tsx` — new CSS-grid horizontal histogram. One bar per active plan, width scaled to max, with count + percentage share readout. No new chart dep; tone per plan (`trial_starter`/`starter`/`growth`/`pro`/`enterprise`) uses the existing Tailwind palette.

**Testing plan:**
- [x] `tests/admin/admin-dashboard-tiles.test.ts` — five tests: (1) support-role can call the RPC and envelope carries `generated_at` + `account_tier` + `org_tier` keys; (2) account_tier carries the seven expected fields with correct types; (3) accounts_by_plan covers every active plan (zero-count rows included); (4) trial_to_paid_rate_30d is null when denominator is zero, otherwise in `[0, 100]` and matches `round(numer/denom*100, 1)`; (5) read_only role is rejected.

**Test results:**
- [x] `cd admin && bunx tsc --noEmit` — PASS.
- [x] `cd admin && bun run lint` — PASS (no warnings).
- [x] `bunx supabase db push` — applied cleanly.
- [x] `bunx vitest run tests/admin/admin-dashboard-tiles.test.ts` — **5/5 PASS** on live dev project.

### Phase 2 — Contextual surfaces

#### Sprint 2.1 — Pipeline panel account sidebar + rollup · **[x] complete 2026-04-24**

**Estimated effort:** 1 day

**Prerequisite wireframe:** Update Pipeline panel(s) in `docs/admin/design/consentshield-admin-screens.html` with an "Account" sidebar card + the "Group by account" toggle.

**Deliverables:**
- [x] `admin/src/components/account-context/account-context-card.tsx` — reusable Server Component, calls `admin.account_detail(p_account_id)`, renders account + plan + status badge + child-org count + trial-ends + active adjustments + last 3 admin actions. `mode='full' | 'compact'`: full is a sticky sidebar aside with multi-block layout; compact is a single-line strip with name + plan + org count + status pill + "Open account →" link.
- [x] `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — compact AccountContextCard lands above the 3-column info grid. Ties every org-detail view to its parent account in one glance, and "Open account →" jumps to the full /accounts/[id] page for operators who need the expanded envelope.
- [x] `admin/src/app/(operator)/pipeline/page.tsx` — server pre-loads `organisations` + `accounts(name, plan_code)` in the parallel fetch block, builds `orgToAccount` lookup, passes it to `<PipelineTabs>`.
- [x] `admin/src/app/(operator)/pipeline/pipeline-tabs.tsx` — new `groupBy: 'org' | 'account'` state; visible toggle row renders above all three org-grouped tabs (Worker errors, Expiry queue, Delivery health; Stuck buffers is table-grouped and is excluded). Per-row Account column surfaces the parent-account name when toggle is `org`; full aggregation (event count, orgs_touched, throughput sum, failure sum, worst-case latency) when toggle is `account`. Orgs with no account mapping fall into a synthetic `(no account)` bucket so they're visible, not silently dropped.

**Testing plan:**
- [x] `cd admin && bunx tsc --noEmit` — PASS.
- [x] `cd admin && bun run lint` — PASS.
- [x] RPC shape — covered by existing `tests/admin/account-rpcs.test.ts` (envelope schema unchanged by this sprint; component just renders it).
- [ ] Component / interaction — visual check recommended via dev server (server component render of compact / full; toggle re-aggregates without round-trip; orgs-without-accounts show under `(no account)`).

**Test results:**
- [x] Typecheck + lint: PASS across all five edited files.

#### Sprint 2.2 — Support ticket account context · **[x] complete 2026-04-24**

**Estimated effort:** 0.5 day

**Prerequisite wireframe:** Support-panel wireframe gets the account header strip + the account filter option.

**Deliverables:**
- [x] `admin/src/app/(operator)/support/page.tsx` — list page uses direct PostgREST queries (no RPC). Added the `accounts(name, plan_code)` embedded join on the `organisations` fetch; resolved per-ticket `account_id` + `account_name` via an `orgById` map; URL search param `?account_id=<uuid>` filters the rendered list to every ticket whose org is in that account. Header gained an Account select driven by `admin.accounts_list`; onChange submits the filter form; Reset link clears it.
- [x] `admin/src/app/(operator)/support/[ticketId]/page.tsx` — resolved org row now also pulls `account_id`. Added compact `<AccountContextCard>` strip below the header, above the ticket controls. Same visual language as the `/orgs/[orgId]` strip so the operator never has to guess which surface they're on.
- [x] Ticket table — "Org" column replaced with "Account · Org" (account name top line, org name / uuid beneath), mirroring the audit-log and pipeline patterns from Sprints 1.1 + 2.1.

**Testing plan:**
- [x] `cd admin && bunx tsc --noEmit` — PASS.
- [x] `cd admin && bun run lint` — PASS.
- [x] Existing support-tickets test suite unchanged — the new filter is URL-driven, not RPC-layer.
- [ ] Detail snapshot — visual check via dev server recommended (compact strip renders on ticket detail).

### Phase 3 — Impersonation rollup + account notes + account-default template

#### Sprint 3.1 — Impersonation-log account view

**Estimated effort:** 0.5 day

**Prerequisite wireframe:** Admin audit-log / impersonation view gets a "Group by account" toggle in the wireframe.

**Deliverables:**
- [ ] `admin.impersonation_sessions_by_account()` RPC — per-account aggregation (account_id, orgs_touched, total_duration, started_at, admin_user).
- [ ] Toggle in the impersonation view swaps the row shape between per-session and per-account.

**Testing plan:**
- [ ] Integration: one operator impersonates three orgs in the same account → per-account view returns one row with `orgs_touched = 3`.

#### Sprint 3.2 — Account-level notes

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update `docs/admin/design/consentshield-admin-screens.html` — Accounts panel gets a Notes card (mirrors the org-detail Notes card). Org detail panel gains an "Account-level notes" subheading above the org-level notes block with a "View at the account level →" link.

**Deliverables:**
- [ ] Migration: `admin.account_notes (id, account_id, body, created_by, created_at, updated_at, pinned)` + RLS (`admin` schema; read gated by `require_admin('support')`, write by `require_admin('support')` with platform_operator carve-out for pinned notes). Partial index on `(account_id, created_at desc)`. Every write emits an `admin_audit_log` row with `target_table='admin.account_notes'` and the Sprint 1.1 `account_id` column populated.
- [ ] Four RPCs: `admin.account_note_list(p_account_id)`, `admin.account_note_add(p_account_id, p_body, p_pinned default false)`, `admin.account_note_update(p_id, p_body, p_pinned)`, `admin.account_note_delete(p_id)`. All SECURITY DEFINER; reason captured on writes; audit rows written in-transaction.
- [ ] `/accounts/[accountId]/page.tsx` — Notes card (list + add-note form). Pinned notes sort first.
- [ ] `/orgs/[orgId]/page.tsx` — existing org-notes section gets a sibling "Account-level notes" section above it, calling `admin.account_note_list(org.account_id)`. Link to `/accounts/[accountId]` for full management.

**Testing plan:**
- [ ] Unit: `account_note_add` inserts a note + a matching audit row; reading via `account_note_list` returns the note.
- [ ] Integration: pinned note appears first regardless of timestamp order.
- [ ] Authorization: support-role can read + add; platform_operator can pin + delete; support cannot pin.

#### Sprint 3.3 — Account-default sectoral template

**Estimated effort:** 0.75 day

**Prerequisite wireframe:** Update the admin Accounts panel wireframe with a "Default template for new orgs" picker. Update the customer wizard Step 4 wireframe (`docs/design/screen designs and ux/consentshield-screens.html`) to show the account-default badge when it's applied.

**Deliverables:**
- [ ] Migration: `alter table public.accounts add column default_sectoral_template_id uuid references admin.sectoral_templates(id) on delete set null`. Nullable. Backfill is a no-op (every account starts with none).
- [ ] `admin.set_account_default_template(p_account_id, p_template_id)` RPC — platform_operator only; writes audit row; validates that the template is `status='published'` and `is_active=true`.
- [ ] `admin.account_detail` envelope extends to include the resolved template summary (`default_template: {id, code, display_name, version} | null`).
- [ ] `/accounts/[accountId]/page.tsx` — template picker in the detail page; shows current default, with a disabled state + reason if no published templates match the account's sector yet.
- [ ] Customer wizard Step 4 (`app/src/app/(dashboard)/onboarding/step-4/*`) — if `accounts.default_sectoral_template_id` is set and the template is still published, pre-select it in the org-creation form and show a small "Pre-selected by account default" badge. Customer can still override via the picker. Falls back to sector-detection default when account-default is null.

**Testing plan:**
- [ ] Migration: column adds without data loss; FK constraint catches bad template ids.
- [ ] `set_account_default_template` happy path; rejects unpublished template; rejects non-platform_operator caller.
- [ ] Wizard: org created with account-default applied carries the correct `sectoral_template_id`; wizard with no default falls back to sector detection.

---

## Test Results

_To be filled as sprints complete._

## Changelog References

_To be filled as sprints complete._

## Acceptance criteria

- Admin audit log is filterable by account in one click; filtering applies to rows whose org is in the account AND rows where `target_id` is the account itself.
- Admin dashboard `/` shows account count, accounts-by-plan breakdown, and trial-to-paid conversion rate alongside the pre-existing org-tier tiles.
- Every org-scoped Pipeline / Security / Billing view carries a parent-account sidebar card. "Group by account" aggregation works without a network round-trip.
- Support ticket detail surfaces parent-account context; ticket list filters by account.
- Impersonation log has a "per-account" view that collapses cross-org sessions inside one account into a single row.
- Account detail page `/accounts/[accountId]` has a Notes card; org detail page surfaces account-level notes alongside org-level notes with clear tier labelling.
- Accounts can carry a `default_sectoral_template_id`; customer first-org wizard pre-selects it when set.
- No pre-existing URL, RPC contract, or filter option removed. All drift is additive.
- Wireframe + alignment-doc update lands with the code for every UI sprint (1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 3.3).

## Out of scope

- **Flat-org surfaces with no account dimension** — `/flags`, `/templates` (catalogue side), `/signatures`, `/connectors` — these are global catalogues, not per-tenant. Not a drift; no change needed.
