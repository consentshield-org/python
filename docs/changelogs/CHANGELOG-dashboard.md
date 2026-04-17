# Changelog — Dashboard

Next.js UI changes.

## ADR-0030 Sprint 3.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 3.1 — Customer-side template picker

### Added
- `app/src/app/(dashboard)/dashboard/template/page.tsx` — customer template picker. Reads caller org industry, calls `public.list_sectoral_templates_for_sector`, renders active template (if any) + available templates with Apply buttons.
- `app/src/app/(dashboard)/dashboard/template/actions.ts` — `applyTemplate(code)` Server Action wrapping `public.apply_sectoral_template`.
- `app/src/components/templates/template-picker.tsx` — client grid of template cards with Apply action.

### Changed
- `app/src/components/dashboard-nav.tsx` — "Sector template" nav item added between Data Inventory and Rights Requests.

### Tested
- [x] `cd app && bun run lint` — zero warnings.
- [x] `cd app && bun run build` — customer routes compile (+ /dashboard/template).
- [x] `bun run test:rls` (root, serial) — 147/147 (+3 new apply-template assertions; Terminal B's ADR-0023 contributed +5).

## ADR-0032 post-review follow-up — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Context:** close Sprint 2.1 review deviations.

### Added
- `admin/src/components/support/reply-form.tsx` — Internal-Note toggle. When checked: amber background + "Save internal note" button; submits with `isInternal: true`; does not auto-transition ticket status.
- `admin/src/app/(operator)/support/actions.ts` — `sendMessage(ticketId, body, { isInternal })`. Passes `p_is_internal` through to the RPC.
- `admin/src/app/(operator)/support/[ticketId]/page.tsx` — thread renders internal notes with an amber stripe + 🔒 label; customer-side view filters them out (via `list_support_ticket_messages`).

### Changed
- `admin/src/components/flags/kill-switches-tab.tsx` — copy in the footer + Engage modal softened to note that Worker/Edge propagation requires `CF_*` Supabase secrets to be set (until then kill-switch state lives only in the DB row).

### Out of Scope (formalised)
- Open-ticket count badge in customer nav — the list page already shows counts; nav badge would add a coupling without meaningful UX payoff.

## ADR-0030 Sprint 2.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 2.1 — Draft editor + publish/deprecate actions

### Added
- `admin/src/app/(operator)/templates/actions.ts` — Server Actions: `createDraft`, `updateDraft`, `publishTemplate`, `deprecateTemplate`, `goToCloneForm`.
- `admin/src/app/(operator)/templates/new/page.tsx` — "+ New draft" form; accepts `?from=<templateId>` for Clone-as-new-version.
- `admin/src/app/(operator)/templates/[templateId]/edit/page.tsx` — draft editor (refuses non-draft).
- `admin/src/components/templates/template-form.tsx` — shared form for new + edit; purpose-definitions editor with add/remove/edit rows; data-scope category chip editor.
- `admin/src/components/templates/detail-actions.tsx` — status-aware action bar on the detail page (Edit + Publish on drafts; Clone + Deprecate on published; read-only notice on deprecated).

### Changed
- `admin/src/app/(operator)/templates/page.tsx` — "+ New draft" button in the header.
- `admin/src/app/(operator)/templates/[templateId]/page.tsx` — Actions card at the bottom. Resolves caller admin_role to gate publish/deprecate.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 15 routes compile (+ /templates/new + /templates/[templateId]/edit)
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135 (no regression at this point)

## ADR-0032 Sprint 2.1 — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Sprint:** 2.1 — Customer-side Contact Support + ticket inbox + reply

### Added (schema)
- Migration `20260421000001_customer_support_access.sql` — three SECURITY DEFINER helpers in `public`: `list_org_support_tickets()`, `list_support_ticket_messages(id)`, `add_customer_support_message(id, body)`. Each scoped via `public.current_org_id()`. Customer reply auto-transitions status to `awaiting_operator`.

### Added (customer app)
- `app/src/app/(dashboard)/dashboard/support/page.tsx` — customer inbox.
- `app/src/app/(dashboard)/dashboard/support/[ticketId]/page.tsx` — detail + thread + reply.
- `app/src/app/(dashboard)/dashboard/support/new/page.tsx` — Contact Support form.
- `app/src/app/(dashboard)/dashboard/support/actions.ts` — `createTicket`, `replyToTicket` Server Actions.
- `app/src/components/support/new-ticket-form.tsx` + `app/src/components/support/customer-reply-form.tsx`.
- `app/src/components/dashboard-nav.tsx` — Support nav item.

### Added (tests)
- `tests/rls/support-tickets.test.ts` — 3 assertions for cross-tenant isolation on all three new RPCs.

### Tested
- [x] `cd app && bun run lint` — zero warnings
- [x] `cd app && bun run build` — customer routes compile (+ /dashboard/support, /dashboard/support/[ticketId], /dashboard/support/new)
- [x] `cd app && bun run test` — 42/42
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 138/138 (+3 new support-isolation tests)

## ADR-0032 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Sprint:** 1.1 — /support admin panel (list + detail + reply + controls)

### Added
- `admin/src/app/(operator)/support/page.tsx` — list with 4 metric tiles (Open / Resolved last 7 days / Urgent open / Median first response — V2 placeholder). Client-side sort by priority (urgent first) → open-statuses-first → recent. 200-row cap.
- `admin/src/app/(operator)/support/[ticketId]/page.tsx` — detail + thread with three author kinds (admin right-aligned + teal, customer left-aligned + zinc, system centred + grey).
- `admin/src/app/(operator)/support/actions.ts` — four Server Actions: `sendMessage`, `changeStatus`, `changePriority`, `assignTicket`. All wrap existing RPCs. Status / priority / assign require reason ≥ 10 chars (schema enforces).
- `admin/src/components/support/reply-form.tsx` — client reply form; transitions status to awaiting_customer automatically via the RPC.
- `admin/src/components/support/ticket-controls.tsx` — three control cards + three modal forms reusing the shared `ModalShell / ReasonField / FormFooter`.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Support Tickets" nav item is live (href=/support).

### Deferred (to Sprint 2.1)
- Customer-side Contact Support form.
- Customer-side ticket list + detail (new RLS policy or public view).

### ADR deviations noted
- No `is_internal_note` column in the schema — wireframe "Internal note" toggle deferred until a schema amendment introduces it.
- ADR Sprint 1.1 had planned "status change requires no reason for support role (routine work)"; the schema's `update_support_ticket` RPC always requires reason ≥ 10 chars, so the action respects that.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 13 routes compile (+ /support + /support/[ticketId])
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135

## ADR-0030 Sprint 1.1 — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 1.1 — /templates list + read-only detail

### Added
- `admin/src/app/(operator)/templates/page.tsx` — list with status + sector filters and pill counts. Fetches `admin.sectoral_templates` ordered by sector / template_code / version desc. Row click → detail.
- `admin/src/app/(operator)/templates/[templateId]/page.tsx` — read-only detail. Description + notes + three info tiles (Created / Published / Deprecated — with admin display names resolved from `admin.admin_users`, successor link if deprecated) + purpose-definitions table.
- `admin/src/components/templates/filter-bar.tsx` — Client Component with status + sector selects; Clear-filters link.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Sectoral Templates" nav item is live (href=/templates).

### Deferred (to Sprint 2.1)
- Create draft / Edit / Publish / Deprecate action bar + modals.
- Used-by count on detail page (no orgs configure a template through the UI yet).

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 11 routes compile (+ /templates + /templates/[templateId])
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135

## ADR-0036 — 2026-04-17

**ADR:** ADR-0036 — Feature Flags & Kill Switches (admin panel)
**Sprint:** 1.1 — Single-sprint ADR, Completed 2026-04-17

### Added
- `admin/src/app/(operator)/flags/page.tsx` — Server Component. Parallel fetch of `admin.feature_flags` + `admin.kill_switches` + `admin.admin_users` (for set_by display) + `public.organisations` (for org-scope flag display / selector). `?tab=kill-switches` deep link honoured.
- `admin/src/app/(operator)/flags/actions.ts` — three Server Actions: `setFeatureFlag` (upsert; boolean/string/number value types), `deleteFeatureFlag`, `toggleKillSwitch`. All wrap the existing ADR-0027 Sprint 3.1 RPCs.
- `admin/src/components/flags/flags-tabs.tsx` — Client tab shell.
- `admin/src/components/flags/feature-flags-tab.tsx` — flags table + Create/Edit/Delete modals. Value-type toggle (boolean/string/number) switches the value input. Edit disables key/scope/org (audit hygiene — changes happen as delete + create).
- `admin/src/components/flags/kill-switches-tab.tsx` — four cards matching the wireframe. Engage button requires typing the exact switch_key to arm submit; Disengage only needs reason ≥ 10 chars.
- `admin/src/components/common/modal-form.tsx` — hoisted `ModalShell`, `Field`, `ReasonField`, `FormFooter` out of `orgs/action-bar.tsx` for reuse.

### Changed
- `admin/src/app/(operator)/layout.tsx` — "Feature Flags & Kill Switches" nav item is now live (`href=/flags`).
- `admin/src/components/ops-dashboard/kill-switches-card.tsx` — "Manage in Feature Flags & Kill Switches" footer link is live, deep-links to `/flags?tab=kill-switches`.
- `admin/src/components/orgs/action-bar.tsx` — now imports `ModalShell`, `Field`, `ReasonField`, `FormFooter` from `../common/modal-form` instead of declaring them inline.

### Tested
- [x] `cd admin && bun run lint` — zero warnings
- [x] `cd admin && bun run build` — 9 routes compile (+ /flags vs prior 8)
- [x] `cd admin && bun run test` — 1/1 smoke
- [x] `bun run test:rls` (root, serial) — 135/135 (no regression)

## ADR-0029 — 2026-04-17

**ADR:** ADR-0029 — Admin Organisations (list + detail + actions + impersonation + customer-side cross-refs)
**Sprints:** 1.1 + 2.1 + 3.1 + 4.1 (all shipped 2026-04-17)

### Added (Admin app)

**Sprint 1.1 — list + detail (read-only):**
- `admin/src/app/(operator)/orgs/page.tsx` — Server Component with plan + status + name/email search filters, 50-per-page pagination.
- `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — parallel fetch of org + members + web_properties + integrations + notes + impersonation sessions; 5 cards (Billing / Configuration / Contacts / Operator notes / Support sessions).
- `admin/src/components/orgs/filter-bar.tsx` — client filter bar.
- Layout nav: Organisations goes live (href=/orgs).

**Sprint 2.1 — actions:**
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — four Server Actions wrapping `admin.{add_org_note, extend_trial, suspend_org, restore_org}`. Reason ≥ 10 chars validated client + server.
- `admin/src/components/orgs/action-bar.tsx` — four modal forms with shared ModalShell + ReasonField + FormFooter. Suspend/Restore disabled for non-platform_operator roles.

**Sprint 3.1 — impersonation:**
- `admin/src/components/impersonation/start-drawer.tsx` — Client drawer (reason code + detail textarea with ≥10 char counter + duration select).
- `admin/src/app/(operator)/orgs/[orgId]/impersonation-actions.ts` — Server Actions: startImpersonation / endImpersonation / forceEndImpersonation.
- `admin/src/components/impersonation/active-session-banner.tsx` (Server) + `active-session-banner-client.tsx` (Client, split to satisfy react-hooks/purity) — always-visible red banner while a session is active; amber band on expiry.
- `admin/src/lib/impersonation/cookie.ts` — httpOnly cookie helper.

### Added (Customer app, Sprint 4.1)

- `app/src/app/(dashboard)/dashboard/support-sessions/page.tsx` — customer-side Support sessions tab. Reads `public.org_support_sessions` view; table of sessions ordered newest-first.
- `app/src/components/suspended-banner.tsx` — Server Component in dashboard layout. Shows red banner with Contact support mailto when the org's status='suspended'.
- `app/src/components/dashboard-nav.tsx` — new "Support sessions" nav item.

### Tested
- [x] `cd admin && bun run build` — all routes compile (/, /login, /audit-log[/export], /orgs[/[orgId]], /api/auth/signout)
- [x] `cd admin && bun run lint` — 0 warnings
- [x] `cd app && bun run build + test + lint` — 42/42, 0 warnings, builds clean
- [x] `bun run test:rls` — 135/135 (admin SELECT-all policies don't break customer isolation; customer JWTs don't have is_admin=true)

### Deferred (execution note, not a blocker)
- Binding subsequent mutation audit rows to the active impersonation_session_id via a BEFORE INSERT trigger + per-request `set_config('app.impersonation_session_id', ...)`. PostgREST's transaction-pooled connections make session-local settings hard to propagate; the fix needs either an extra RPC arg on all 30 Sprint 3.1 RPCs or a wrapper dispatch layer. Start/end sessions are audited; intermediate actions are audited individually; forensic linkage is nice-to-have, not Rule 22/23 required.
- Updating the customer-side HTML wireframes with W13 + W14 panels. Implementation shipped; the wireframe HTML is a sizable file and the visual spec is accurately captured by the implemented components. Flagged in the customer alignment doc with a ⚠️ marker.

## ADR-0028 — 2026-04-17

**ADR:** ADR-0028 — Admin App Foundation (real OTP auth + Operations Dashboard + Audit Log viewer)
**Sprints:** 1.1 + 2.1 + 3.1 (all shipped 2026-04-17)

### Added (Admin app)

**Sprint 1.1 — auth:**
- `admin/src/components/otp-boxes.tsx` — per-app OTP boxes (share-narrowly memory). Red admin accent on active slot + caret.
- `admin/src/app/(auth)/login/page.tsx` — rewritten as a two-stage OTP email flow (email → code). No signup link (admin bootstrap is not self-serve). Red accent; preserves the `?reason=mfa_required` banner for AAL2-failure paths.
- `admin/src/app/api/auth/signout/route.ts` — POST-only signout; redirects to `/login`.
- `admin/src/app/(operator)/layout.tsx` — session chip (display_name + admin_role + AAL2 verified), sign-out button in sidebar footer, Operations Dashboard + Audit Log nav links go live (8 remaining panels still point at `#`).
- `admin/package.json` — `input-otp@1.4.2` added exact-pinned.

**Sprint 2.1 — Operations Dashboard:**
- `admin/src/app/(operator)/page.tsx` — Server Component; reads `admin.platform_metrics_daily` (latest row), `admin.kill_switches`, `public.admin_cron_snapshot()`, latest 10 `admin.admin_audit_log` rows. 6 metric tiles + cron status card + kill switch summary + recent activity card.
- `admin/src/components/ops-dashboard/*` — `MetricTile`, `KillSwitchesCard`, `CronStatusCard`, `RecentActivityCard`, `RefreshButton` (client; calls the Server Action).
- `admin/src/app/(operator)/actions.ts` — `refreshPlatformMetrics()` Server Action calls `admin.refresh_platform_metrics(current_date)` + `revalidatePath('/')`.

**Sprint 3.1 — Audit Log:**
- `admin/src/app/(operator)/audit-log/page.tsx` — Server Component; URL-param filters (admin, action, org, from, to, page); 50-per-page pagination via `.range()`.
- `admin/src/components/audit-log/filter-bar.tsx` — Client Component filter bar (admin select populated from `admin.admin_users`, action select from fixed KNOWN_ACTIONS list, org text input, from/to date inputs).
- `admin/src/components/audit-log/audit-table.tsx` — row list; click opens detail drawer.
- `admin/src/components/audit-log/detail-drawer.tsx` — right-side drawer; pretty-printed old_value / new_value JSON + request_ip / request_ua / api_route; Esc + click-outside close.
- `admin/src/app/(operator)/audit-log/export/route.ts` — CSV export endpoint; re-applies the filter predicate, caps at 10k rows, calls `admin.audit_bulk_export()` BEFORE streaming so the export is audit-logged even if the client aborts.

### Deviations from ADR-0028 plan
- **`cron.job_run_details` schema.** ADR Sprint 2.1 RPC initially joined on `jobname` but the Supabase-managed `cron.job_run_details` table has `jobid` instead. Migration was fixed to `jobid` join. Documented as an execution note in the ADR.

### Tested
- [x] `cd admin && bun run build` — 6 routes compile (/, /login, /audit-log, /audit-log/export, /api/auth/signout, /_not-found)
- [x] `cd admin && bun run lint` — 0 warnings
- [x] `cd admin && bun run test` — 1/1 smoke (unchanged)
- [x] `cd app && bun run test` — 42/42 (no regression)
- [x] `bun run test:rls` — 8 files, 135/135 (no regression)

Combined: 42 (app) + 135 (rls/admin/depa) + 1 (admin smoke) = **178/178**.

### Manual smokes (post-merge)
- Real signin end-to-end with Sudhindra's bootstrap account
- Operations Dashboard renders live metrics / kill switches / cron status / recent audit
- Audit Log filter + detail drawer + CSV export

## ADR-0018 Sprint 1.1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/integrations/integrations-table.tsx`:
  the "New Connector" form now surfaces a Type selector
  (Generic webhook / Mailchimp / HubSpot) with per-type conditional
  fields. Button label moved from "Add Webhook Connector" to
  "Add Connector".

## ADR-0017 Sprint 1.1 — 2026-04-16

### Added
- New page `src/app/(dashboard)/dashboard/exports/page.tsx` — lists
  past export manifests (pointer-only; no ZIP bytes stored) with an
  **Export ZIP** button that triggers `POST /api/orgs/[orgId]/audit-export`,
  downloads the archive in-browser, and reloads the manifest list.
- Companion client component `export-button.tsx` handles the
  fetch-to-blob-to-anchor download flow.

## ADR-0016 Sprint 1 — 2026-04-16

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Consent Probes** section listing every active probe with its
  schedule, last-run timestamp, and status (clean / N violations /
  failed). Reads `consent_probes` + `consent_probe_runs`; joins the
  latest run per probe. No CRUD UI in v1 — probes are seeded via
  SQL until a dedicated micro-ADR adds the form.

## ADR-0015 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0015 — Security Posture Scanner
**Sprint:** Phase 1, Sprint 1.1

### Changed
- `src/app/(dashboard)/dashboard/enforcement/page.tsx`: new
  **Security Posture** section. Queries `security_scans` alongside
  the existing tracker-observations queries; for every property
  shows the highest-severity finding from its most-recent scan with
  a colour-coded badge (critical / high / medium / low / info /
  unscanned). Lists total findings and the worst `signal_key` per
  property.

### Tested
- [x] `bun run build` + `bun run lint` + `bun run test` — clean.

## ADR-0013 Sprint 1.2 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx` — passwordless OTP flow. Two stages:
  (1) email + orgName + industry → `supabase.auth.signInWithOtp` with
  `shouldCreateUser: true` and `options.data`; (2) 6-digit code →
  `supabase.auth.verifyOtp({type: 'email'})` → `/auth/callback`.
- `src/app/(public)/login/page.tsx` — same two-stage OTP pattern
  (`shouldCreateUser: false`). Passwords removed from UI.

### Rationale
- Phishing / forwarding resistance, device continuity, no URL leakage, no
  email-scanner premature consumption. Full reasoning in ADR-0013.
- Consistent with ADR-0004 (rights-request OTP).

### Operator action
- In Supabase Dashboard → Authentication → Email Templates → Magic Link,
  replace the `{{ .ConfirmationURL }}` block with a prominent
  `{{ .Token }}` display so the email delivers the code only (no link
  fallback that scanners can prefetch).

## ADR-0013 Sprint 1.1 — 2026-04-15

### Changed
- `src/app/(public)/signup/page.tsx`:
  - Attaches `{ org_name, industry }` to `options.data` on
    `supabase.auth.signUp` so it survives the email-confirmation gap.
  - Sets `options.emailRedirectTo` to
    `<origin>/auth/callback` so Supabase sends the verification link
    back to our single handler.
  - New "Check your email" pending state shown when `signUp` returns no
    session (Supabase's "Confirm email" flag is ON). Otherwise navigates
    straight to `/auth/callback`.

### Tested
- [x] `bun run lint` / `build` / `test` — all green.
- Manual smoke test on live Vercel deploy after next push.
