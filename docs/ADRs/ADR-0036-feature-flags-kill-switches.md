# ADR-0036: Feature Flags & Kill Switches (Admin Panel)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17

---

## Context

All the backing infrastructure for feature flags and kill switches shipped with ADR-0027:

- `admin.feature_flags` — global + per-org key/value flags with `value_type` discriminator and `created_by` audit trail.
- `admin.kill_switches` — four named circuit breakers (`banner_delivery`, `depa_processing`, `deletion_dispatch`, `rights_request_intake`), pre-seeded.
- RPCs `admin.set_feature_flag(key, scope, org_id?, value, description)`, `admin.delete_feature_flag(key, scope, org_id?)`, `admin.toggle_kill_switch(switch_key, engaged, reason)` — all SECURITY DEFINER, all audit-logged in the same txn (Rule 22).
- `public.get_feature_flag(key, org_id?)` — customer-side read helper.
- `sync-admin-config-to-kv` Edge Function pushes a snapshot of both to Cloudflare KV every 2 min so the Worker and customer Edge Functions can read without hitting Supabase.

What is missing is the **operator UI**. Today a `platform_operator` can only toggle switches and flags by running raw SQL or calling RPCs with `curl`. That is not acceptable for an incident response path — kill switches by definition need to be reachable in seconds, not minutes. This ADR adds the `/flags` admin panel that wraps the existing RPCs.

Wireframe reference: `docs/admin/design/consentshield-admin-screens.html` §10 ("Feature Flags & Kill Switches"). Two tabs: feature flags (table + create/edit/delete) and kill switches (grid of four cards with Engage / Disengage buttons and reason capture).

## Decision

Add a single route `/flags` to the admin app with two tab panels, backed by Server Actions that call the three existing RPCs. No new tables, no new RPCs, no schema changes. All writes are reserved for `platform_operator` (support + read_only roles get a read-only view). Every write requires reason ≥ 10 chars; the kill-switch Engage button additionally requires the operator to type the switch key as a confirmation gate.

Feature flag UI supports:
- Global flags (scope = `global`, org_id = null).
- Per-org flags (scope = `org`, org_id = selected from a typeahead over `public.organisations`).
- Three value types: `boolean`, `string`, `number`. `json` is deferred to a follow-up sprint.
- Delete action (hard delete, audit-logged).

Kill-switch UI supports:
- Engage — requires reason + confirmation typing of the switch key. Button turns red when engaged.
- Disengage — requires reason only. Button returns to normal state.
- Read-only status pill above the card grid: green "All normal" / red "N engaged".

No customer-side changes — the customer app and Worker already consume flag/switch state via KV. This ADR is pure operator-UI.

## Consequences

- `platform_operator` can engage a kill switch from the admin UI within seconds of logging in; propagation to Worker + Edge Functions is ≤2 min (the existing `admin-sync-config-to-kv` cron cadence). Combined with the proven audit pattern, this closes the "break-glass" gap that was called out in ADR-0027 Sprint 3.2 notes.
- The Operations Dashboard's existing `KillSwitchesCard` read component (shipped in ADR-0028) stays as a read-only surface — clicking it navigates to `/flags#kill-switches`.
- JSON-valued flags are out of scope; the few flags that need structured config today (none in the seed) can wait for a follow-up.

---

## Implementation Plan

### Sprint 1.1: /flags page with both tabs + Server Actions

**Estimated effort:** 2–3 hours.

**Deliverables:**
- [ ] `admin/src/app/(operator)/flags/page.tsx` — Server Component. Reads `admin.feature_flags` + `admin.kill_switches` via RLS-gated select (admins_select_all policy from ADR-0029 Sprint 1.1 covers `admin.*` automatically via the cs_admin BYPASSRLS SELECT grant). Renders tab shell.
- [ ] `admin/src/app/(operator)/flags/actions.ts` — three Server Actions: `setFeatureFlag`, `deleteFeatureFlag`, `toggleKillSwitch`. Each wraps the corresponding RPC, validates reason ≥ 10 chars client + server, revalidates `/flags` on success.
- [ ] `admin/src/components/flags/feature-flags-tab.tsx` — Client Component. Table of flags with columns: Flag key, Scope, Org, Value, Description, Set by, action column. Modal: "+ New flag" and "Edit" open the same `FlagForm`. Value-type toggle (boolean/string/number) switches the value input.
- [ ] `admin/src/components/flags/kill-switches-tab.tsx` — Client Component. Four kill-switch cards matching the wireframe (name + description + status pill + Engage / Disengage button). Engage modal requires typing the exact switch key to arm the button. Disengage modal requires reason only.
- [ ] `admin/src/components/flags/reason-field.tsx` — reuse the existing `ReasonField` pattern from ADR-0029 action bar. If no shared component exists inside `admin/`, hoist the one from `admin/src/components/orgs/action-bar.tsx` into `admin/src/components/common/reason-field.tsx` and re-use.
- [ ] `admin/src/components/dashboard-nav.tsx` — wire the "Feature Flags" nav item (currently `#`) to `/flags`.
- [ ] Update the Ops Dashboard's `KillSwitchesCard` footer to include a "Manage →" link to `/flags?tab=kill-switches`.

**Testing plan:**
- [ ] Existing `tests/admin/rpcs.test.ts` already covers the three RPCs (set_feature_flag, delete_feature_flag, toggle_kill_switch) — no new RPC tests needed.
- [ ] `cd admin && bun run build` — /flags compiles.
- [ ] `cd admin && bun run lint` — zero warnings.
- [ ] Manual: sign in as platform_operator → /flags → create a boolean flag → edit it → delete it. All three actions produce audit_log rows (verify via /audit-log viewer).
- [ ] Manual: engage `banner_delivery` kill switch → confirm audit_log row + `admin.kill_switches.engaged=true`. Disengage → confirm return to false.
- [ ] Cross-role: sign in as support role → /flags loads read-only (all action buttons disabled or absent).

**Status:** `[x] complete` — 2026-04-17

---

## Architecture Changes

None. This ADR is pure UI over existing RPCs.

---

## Test Results

### Sprint 1.1 — 2026-04-17 (Completed)

```
cd admin && bun run lint   → $ eslint src/ ; exit 0 (zero warnings)
cd admin && bun run build  → Next.js 16.2.3 Turbopack, 9 routes compiled:
                              /, /_not-found, /api/auth/signout, /audit-log,
                              /audit-log/export, /flags (new), /login, /orgs,
                              /orgs/[orgId].  Compiled in ~2.0s.
cd admin && bun run test   → 1/1 smoke passes
bun run test:rls (root)    → 135/135 across 8 files (no regression)
```

**Execution notes (2026-04-17):**
- Hoisted `ModalShell`, `Field`, `ReasonField`, `FormFooter` from `admin/src/components/orgs/action-bar.tsx` into a new `admin/src/components/common/modal-form.tsx`. Second real consumer justified the share (the flag modals reuse all four). `action-bar.tsx` now imports from `../common/modal-form`.
- Feature-flag value types: `boolean`, `string`, `number`. JSON deferred per ADR Out-of-Scope.
- Kill-switch Engage modal requires typing the exact `switch_key` to arm the submit button; Disengage only needs reason ≥ 10 chars.
- Ops Dashboard's `KillSwitchesCard` "Manage in Feature Flags & Kill Switches" link is now live (was pointer-events-none stub); deep-links to `/flags?tab=kill-switches`.
- Admin sidebar nav: Feature Flags & Kill Switches is now a live link.
- No new RPC tests — the three RPCs (`set_feature_flag`, `delete_feature_flag`, `toggle_kill_switch`) are covered by `tests/admin/rpcs.test.ts` from ADR-0027 Sprint 3.1.
- No schema changes in this sprint. Propagation to Worker + Edge Functions continues to ride the existing `admin-sync-config-to-kv` cron (ADR-0027 Sprint 3.2).

---

## Risks and Mitigations

- **Accidental kill-switch engagement.** Mitigation: typing-confirmation gate on the Engage button (matches wireframe). Additional mitigation: the kill switch takes ≤2 min to propagate via KV sync, not instantaneous — operator has a small recovery window.
- **Feature-flag typo creates a silently broken flag.** Mitigation: show a "known flag keys" hint pulled from `public.get_feature_flag` usage in `app/src/` at ADR time (brief grep). Creating a typo'd flag doesn't break anything — `get_feature_flag` returns null. Deferred to V2: key-namespace linting.

---

## Out of Scope (Explicitly)

- **JSON-valued flags.** Value types are boolean / string / number for this ADR. If a later feature needs structured config, add JSON support in a focused sprint.
- **Flag scheduling (enabled_after, expires_at).** Not in the wireframe; deferred.
- **Per-cohort flags (% rollout).** Not in the data model; deferred.
- **Kill-switch audit-log drill-in.** Kill-switch history is visible via `/audit-log` filter on `action=toggle_kill_switch` — no dedicated history view needed.

---

## Changelog References

- `CHANGELOG-dashboard.md` — add sprint entries for the admin /flags page.

---

*ADR-0036 — Feature Flags & Kill Switches. Depends on ADR-0027 (admin schema + RPCs) and ADR-0028 (admin app foundation + Ops Dashboard).*
