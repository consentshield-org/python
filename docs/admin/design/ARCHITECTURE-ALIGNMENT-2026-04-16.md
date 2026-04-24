# Admin Platform — Architecture Alignment

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Companion to:** `consentshield-admin-screens.html` in this folder.
**Aligned to:** `docs/admin/architecture/consentshield-admin-platform.md`, `consentshield-admin-schema.md`, and `consentshield-admin-monorepo-migration.md`.
**Date:** 2026-04-16 (initial pass — admin platform created from scratch in this same session, so wireframes and architecture begin in sync).

---

## 0. Normative reminder — read this before building any admin UI

> **The admin wireframes (`consentshield-admin-screens.html`) are the visual and interaction specification for the ConsentShield operator console.** The Next.js implementation in `admin/src/` (post-monorepo migration) MUST conform to these screens. Drift requires either an ADR (recording the divergence and its rationale) or a wireframe update in the same sprint that ships the change.
>
> The same discipline that governs the customer-side wireframes (`docs/design/screen designs and ux/`) governs these. There are now two normative UI specs — one per app — and both are read every session via `CLAUDE.md` "UI specification reference".

---

## 1. Why this document exists

Unlike the customer-side wireframes (drafted in April 2026 before any architecture and progressively patched as the architecture moved), the admin platform's wireframes and architecture were authored in the **same session** (2026-04-16). Both reflect the same design decisions. The alignment doc therefore starts at zero drift and exists to:

1. **Document the wireframes' coverage** — every architecture concept maps to a panel and vice versa, so the implementing engineer can reason about completeness.
2. **Track future drift** — when the admin architecture is amended (new admin RPC, new admin table, new operator workflow), this doc records the corresponding screen change required, the same way the customer-side alignment doc does.
3. **Track ADR readiness** — the admin platform implementation is expected to roll out across multiple ADRs. Each ADR ticks off the panels it ships in §3 of this document.

---

## 2. Files in scope

| File | Status | Lines | Notes |
|---|---|---|---|
| `consentshield-admin-screens.html` | New 2026-04-16 | ~890 | 11 panels + impersonation drawer. Visual system matches the customer wireframes (DM Sans, navy/teal); admin-mode red accent strip and red sidebar border distinguish the operator console at a glance. |
| `ARCHITECTURE-ALIGNMENT-2026-04-16.md` (this file) | New 2026-04-16 | — | Drift catalogue + reconciliation tracker. |

The admin platform has no `.docx` master design document equivalent yet. If one is later authored, list it here.

---

## 3. Coverage matrix (architecture → wireframes)

For every concept in the admin platform architecture, the wireframe panel that surfaces it. **All rows start at "in sync" because both were authored together.**

| Architecture concept | Architecture doc reference | Wireframe panel | Coverage |
|---|---|---|---|
| Operator session model (AAL2 + admin claim + role) | `consentshield-admin-platform.md` §3 | Sidebar session chip + red mode strip + footer session timer | ✅ in sync |
| `admin.admin_users` table | `consentshield-admin-schema.md` §3.1 | (admin user management is a bootstrap activity; no UI panel in v1 — manual via SQL) | ⚠️ deliberate gap (see §5) |
| `admin.admin_audit_log` (Rule 22) | §3.2 | **Audit Log** panel | ✅ in sync |
| `admin.impersonation_sessions` (Rule 23) | §3.3 | **Organisations** → impersonation drawer + footer audit trail | ✅ in sync |
| `admin.sectoral_templates` | §3.4 | **Sectoral Templates** panel | ✅ in sync |
| `admin.connector_catalogue` | §3.5 | **Connector Catalogue** panel | ✅ in sync |
| `admin.tracker_signature_catalogue` | §3.6 | **Tracker Signatures** panel | ✅ in sync |
| `admin.support_tickets` + messages | §3.7 | **Support Tickets** panel | ✅ in sync |
| `admin.org_notes` | §3.8 | **Organisations** → Operator notes card on org detail | ✅ in sync |
| `admin.feature_flags` | §3.9 | **Feature Flags & Kill Switches** → Feature flags tab | ✅ in sync |
| `admin.kill_switches` (platform_operator only) | §3.10 | **Feature Flags & Kill Switches** → Kill switches tab + Operations Dashboard summary card | ✅ in sync |
| `admin.platform_metrics_daily` | §3.11 | **Operations Dashboard** metric tiles + cron status | ✅ in sync |
| Admin API: `/api/admin/orgs/*` | `consentshield-admin-platform.md` §7.1 | **Organisations** | ✅ |
| Admin API: `/api/admin/sectoral-templates/*` | §7.2 | **Sectoral Templates** | ✅ |
| Admin API: `/api/admin/connectors/*` | §7.3 | **Connector Catalogue** | ✅ |
| Admin API: `/api/admin/tracker-signatures/*` | §7.4 | **Tracker Signatures** | ✅ |
| Admin API: `/api/admin/support-tickets/*` | §7.5 | **Support Tickets** | ✅ |
| Admin API: `/api/admin/pipeline/*` | §7.6 | **Pipeline Operations** (4 tabs) | ✅ |
| Admin API: `/api/admin/billing/*` | §7.7 | **Billing Operations** (4 tabs) | ✅ |
| Admin API: `/api/admin/security/*` | §7.8 | **Abuse & Security** (5 tabs) | ✅ |
| Admin API: `/api/admin/feature-flags/*`, `/kill-switches/*` | §7.9 | **Feature Flags & Kill Switches** | ✅ |
| Admin API: `/api/admin/audit-log/*` | §7.10 | **Audit Log** | ✅ |
| Sectoral template publish workflow (§8.1) | §8.1 | Sectoral Templates → Editor → Publish action | ✅ |
| Connector deprecation (§8.2) | §8.2 | Connector Catalogue → Edit drawer → Deprecate flow + note | ✅ |
| Kill switch — banner delivery (§8.3) | §8.3 | Operations Dashboard kill switch summary + Feature Flags & Kill Switches tab | ✅ |
| Customer-visible "Support sessions" tab (§8.4) | §8.4 | **Cross-reference: customer-side** — see W-Admin-CustomerVisibility in `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` (item to add) | ⚠️ pending customer-side wireframe update (§4) |
| Rule 21 — hardware key 2FA | §9 R21 | Sidebar session chip "AAL2 verified · hardware key" | ✅ |
| Rule 22 — audit-logging in same transaction | §9 R22 | Audit Log panel (read surface) + every write modal carries Reason field | ✅ |
| Rule 23 — impersonation time-boxed + reason + customer-notified | §9 R23 | Impersonation drawer copy explicitly states this contract | ✅ |
| Rule 24 — admin endpoint host-isolation | §9 R24 | (Enforced in `admin/proxy.ts`; no UI affordance — by design) | ✅ (no UI needed) |
| Rule 25 — admin app deploys independently | §9 R25 | (Enforced in monorepo + Vercel project split; no UI affordance) | ✅ (no UI needed) |

---

## 4. Cross-reference items requiring customer-side wireframe updates

Two architecture concepts span both apps. The admin wireframes cover the admin half; the customer-side wireframes need a corresponding entry. These are tracked here because the next session that updates the customer wireframes should pick them up.

| Item | Where it appears (admin) | Customer-side change required |
|---|---|---|
| **W-Admin-CustomerVisibility — "Support sessions" tab** | Admin impersonation creates sessions + sends customer email. | Customer Settings panel needs a new tab "Support sessions" listing every impersonation session against the customer's org with start/end times, reason, and actions taken. Reads from `public.org_support_sessions` view (defined in `consentshield-admin-schema.md` §3.3). Add as item W13 in `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md`. |
| **W-Admin-OrgSuspension — Suspended-org banner state** | Admin can suspend an org (`/api/admin/orgs/[id]/suspend`). | Customer app's banner Worker reads `org.status` and serves a no-op banner if `status='suspended'`. Customer app's dashboard shows a banner: "Your account is suspended — contact support." Add as item W14 in customer alignment. |

These two items are noted here so the customer-side alignment doc can be updated in the next session that touches it (or as part of the admin platform implementation ADR that ships impersonation / suspension).

---

## 5. Deliberate gaps (v1)

These are intentionally **not** wireframed in the v1 admin pass and require a future ADR to add:

| Gap | Why deferred | Likely future ADR |
|---|---|---|
| **Admin user management UI** | Bootstrap admin (Sudhindra) is the only admin in v1. Adding/removing admins is rare and can be done via direct SQL with proper audit. A UI is overhead for one operator. | When a second operator is hired (post-revenue, likely month 9+) |
| **Admin role change UI** | Same reason as above. Role changes are equally rare for one-operator state. | Same as above |
| **Customer "Support sessions" tab implementation** | Requires customer-side wireframe update first (§4 W-Admin-CustomerVisibility). | Coordinated with admin Impersonation ADR |
| **Mobile admin app** | The admin console is desk-bound. No phone use case identified. | None planned. |
| **Multi-region operator console** | Single region (India) for v1. Multi-region is post-Series A scale concern. | None planned. |
| **Audit log full-text search** | Filter-based queries cover v1 needs. Full-text becomes useful at >100K audit rows. | When audit log exceeds ~50K rows (post month 6) |
| **Custom sectoral template versioning UX (full diff viewer)** | v1 uses textual diff; a side-by-side visual diff is post-v1. | Sectoral Templates v2 ADR |
| **Real-time platform metrics (vs nightly refresh)** | Operations Dashboard uses `admin.platform_metrics_daily` refreshed nightly. Real-time queries are heavier and not yet justified by ops cadence. | Realtime metrics ADR (post-revenue) |

These gaps are architectural decisions, not oversights. Re-evaluate at the v2 review pass.

---

## 6. Reconciliation tracker

A live checklist of each panel against the ADR that ports it into code. Tick when the ADR ships.

| Panel | Owner ADR (proposed) | Wireframe done | Code shipped |
|---|---|---|---|
| Operations Dashboard | ADR-0028 (admin app skeleton) | ✅ 2026-04-16 | ✅ 2026-04-17 |
| Organisations + Org detail + Impersonation drawer | ADR-0029 (admin org management) | ✅ 2026-04-16 | ✅ 2026-04-17 |
| Sectoral Templates | ADR-0030 (admin sectoral templates) | ✅ 2026-04-16 | ☐ |
| Connector Catalogue | ADR-0031 (admin connector catalogue) | ✅ 2026-04-16 | ☐ |
| Tracker Signatures | ADR-0031 (folded into connector catalogue ADR) | ✅ 2026-04-16 | ☐ |
| Support Tickets | ADR-0032 (admin support tickets) | ✅ 2026-04-16 | ☐ |
| Pipeline Operations | ADR-0033 (admin ops + security — Pipeline half) | ✅ 2026-04-16 | ☐ |
| Billing Operations | ADR-0034 (admin billing ops) | ✅ 2026-04-16 | ☐ |
| Abuse & Security | ADR-0033 (folded from ADR-0035 on 2026-04-17 — Security half of the Ops+Security ADR) | ✅ 2026-04-16 | ☐ |
| Feature Flags & Kill Switches | ADR-0036 (admin feature flags + kill switches) | ✅ 2026-04-16 | ☐ |
| Audit Log | ADR-0028 (folded into admin app skeleton ADR) | ✅ 2026-04-16 | ✅ 2026-04-17 |
| Audit Log · account filter + Account column (post-ADR-0044 drift close) | ADR-1027 Sprint 1.1 | ✅ 2026-04-24 (wireframe: account picker in filter bar; Account · Org combined column with visual grouping for cross-org actions within one account) | ☐ |
| Dashboard · account-tier tiles (account count, accounts-by-plan, trial→paid gauge) | ADR-1027 Sprint 1.2 | ✅ 2026-04-24 | ✅ 2026-04-24 |
| Pipeline / Security / Billing · `<AccountContextCard>` sidebar + group-by-account toggle | ADR-1027 Sprint 2.1 | ✅ 2026-04-24 (orgs-detail compact strip + Pipeline group-by toggle; security + billing remain account-scoped today so the card is redundant there) | ✅ 2026-04-24 |
| Support Tickets · parent-account header strip + account filter | ADR-1027 Sprint 2.2 | ✅ 2026-04-24 (list Account · Org column + account select filter; detail compact AccountContextCard strip) | ✅ 2026-04-24 |
| Impersonation log · per-account rollup view | ADR-1027 Sprint 3.1 | ☐ | ☐ |
| Accounts · account-level Notes card + org-detail surfacing of account notes | ADR-1027 Sprint 3.2 | ☐ | ☐ |
| Accounts · default sectoral template picker + wizard pre-selection | ADR-1027 Sprint 3.3 | ☐ | ☐ |
| Customer-side "Support sessions" tab (W-Admin-CustomerVisibility) | ADR-0029 Sprint 4.1 | ⚠️ HTML wireframe update deferred; implementation preceded formal wireframe | ✅ 2026-04-17 |
| Customer-side org suspension banner state (W-Admin-OrgSuspension) | ADR-0029 Sprint 4.1 | ⚠️ HTML wireframe update deferred; implementation preceded formal wireframe | ✅ 2026-04-17 |

Prerequisite ADRs (must ship before any of the above):

| ADR | Description |
|---|---|
| ADR-0026 | Monorepo restructure (per `consentshield-admin-monorepo-migration.md`) |
| ADR-0027 | Admin schema + cs_admin role + audit log + impersonation tables (per `consentshield-admin-schema.md`) |

---

## 7. Conventions used in the wireframes

To keep the admin wireframes visually distinguishable from the customer wireframes (so an engineer or operator never confuses the two when looking at a screenshot):

- **Red admin-mode strip** at the top of the viewport (`--admin-accent: #B91C1C`).
- **Red sidebar border-right** on the navy sidebar.
- **Red logo accent square** instead of the customer app's teal square.
- **Red admin badge pill** (`pill-admin` class) on any DEPA/admin-only marker.
- **Session chip in the sidebar** showing operator name, role, and AAL2 status.
- **Session timer** in the sidebar footer reminding the operator they're in an active admin session.
- **Impersonation drawer** uses the red admin-accent in the header copy and the "Start session →" button is `btn-danger`.
- All destructive admin actions (Suspend org, Block IP, Engage kill switch) use `btn-danger` with red.
- Reason fields are mandatory on every write modal (audit-log contract Rule 22). The drawer footer disables the primary action until reason ≥ 10 chars.

These conventions should be honoured by the implementing code; they're not just decorative. The visual distinction is a UX safety mechanism — an operator who accidentally has the customer app open and the admin app open in two tabs should never confuse them.

---

## 8. How to use this document going forward

For every admin platform ADR sprint:

1. Open this document.
2. Find the ADR's owner items in §6.
3. While building, treat the screen here as the spec — diverge only by amending the wireframe in the same sprint.
4. Once the code matches the wireframe, tick the "Code shipped" column in §6 with the commit hash.

When the admin architecture changes (any future amendment to `consentshield-admin-platform.md` or the admin schema), add a new section §9, §10, etc. with the date, the architecture diff summary, and the screen drift table. Do not delete §3; old drift items become historical record.

Cross-reference items (§4) update both this document and the customer-side `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` simultaneously. The two alignment docs are coupled at the cross-reference rows.

---

*End of Admin Platform Architecture Alignment.*
