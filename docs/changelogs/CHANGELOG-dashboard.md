# Changelog — Dashboard

Next.js UI changes.

## [ADR-1001 Sprint 2.3] — 2026-04-20

**ADR:** ADR-1001 — Truth in marketing and public API foundation
**Sprint:** Sprint 2.3 — Dashboard UI for API key management

### Added
- `app/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx` — server page; fetches account role, org, account's API keys, and plan_code; renders locked card for non-owners.
- `app/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-panel.tsx` — client component with full key management UI: active/revoked table, empty state, create modal (name + scope multiselect + rate_tier read-only), plaintext-reveal modal (shown once, dismiss requires checkbox), rotate modal (dual-window notice in row while `previous_key_expires_at` is in future), revoke confirmation modal.
- `app/src/app/(dashboard)/dashboard/settings/api-keys/actions.ts` — `createApiKey`, `rotateApiKey`, `revokeApiKey` server actions; each revalidates the page on success.
- Nav entry: `API keys` added to `app/src/components/dashboard-nav.tsx`.

### Tested
- [x] `cd app && bun run build` — PASS; `/dashboard/settings/api-keys` in route manifest.
- [x] `bun run lint` — PASS (0 errors, 0 warnings).
- [ ] Manual flow: mint → copy → `/v1/_ping` → 200 (pending dev server run).

## [ADR-0050 Sprint 2.3] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — account detail invoice UI + landing last-invoice column

### Changed
- `admin/src/app/(operator)/billing/[accountId]/page.tsx`:
  - "Balance" card: Sprint 1 stub ("always zero until Sprint 2") replaced with real `outstanding_balance_paise` sourced from `admin.billing_account_summary` (sum of `total_paise` across invoices in status `issued` / `partially_paid` / `overdue`).
  - "Latest invoice" card: stub replaced with the newest-issue-date invoice — number, FY, issue/due dates, subtotal + CGST+SGST (intra-state) or IGST (inter-state), total, and a Download link to `/api/admin/billing/invoices/[invoiceId]/download` when the PDF is present.
  - New "Invoice history" card: full scope-gated list (up to 50 rows) via `admin.billing_invoice_list`. Retired-issuer rows visible only to platform_owner and badged `retired`. Each row links to the download endpoint.
  - New `InvoiceStatusPill` component alongside `StatusPill` / `SourcePill` / `RefundStatusPill`.
- `admin/src/app/(operator)/billing/page.tsx`:
  - Landing "Last invoice" column: Sprint 1 stub ("pipeline ships in ADR-0050 Sprint 2") replaced with real data via `admin.billing_accounts_invoice_snapshot`. Shows an `InvoiceSnapshotPill` (status-coloured) plus the invoice number; the whole cell links to the account's billing detail.

### Tested
- [x] Admin `bun run build` — compiles; `/api/admin/billing/invoices/[invoiceId]/download` in the route manifest; `/billing` and `/billing/[accountId]` render with new sections.
- [x] Admin `bun run lint` — clean.

## [ADR-0050 Sprint 2.1 — chunk 3] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — Razorpay webhook handler refactor (verbatim preservation)

### Changed
- `app/src/app/api/webhooks/razorpay/route.ts` — calls `public.rpc_razorpay_webhook_insert_verbatim` immediately after signature verification (before any state mutation), persisting every verified Razorpay webhook to `billing.razorpay_webhook_events`. Calls `public.rpc_razorpay_webhook_stamp_processed` on every terminal path (`not_handled`, `no_subscription_entity`, `duplicate_dropped`, `rpc_error:…`, `unresolved_org:…`, `ok`) so each row has a `processed_outcome` matching the handler's final response. Existing ADR-0034 subscription-state handling preserved verbatim; unhandled event types still persist (outcome `not_handled`) so `dispute.*` and `invoice.*` are captured ahead of the chunks that act on them.

### Tested
- [x] Customer app `bun run build` + `bun run lint` clean.
- [x] End-to-end handler behaviour under the existing integration test (unchanged); verbatim-insert + stamp paths covered by `tests/admin/razorpay-verbatim.test.ts` (6/6 PASS).

## [ADR-0050 Sprint 2.1 — chunk 2] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — Issuer entities admin UI

### Added
- `admin/src/app/(operator)/billing/issuers/page.tsx` — list (platform_operator+ read); status pill per row; "+ New issuer" enabled only for platform_owner; warning card when no issuer is active.
- `admin/src/app/(operator)/billing/issuers/new/page.tsx` + `new/form.tsx` — create form; identity fields flagged as "immutable once saved"; operational fields flagged "editable later"; 403 fallback for non-owner.
- `admin/src/app/(operator)/billing/issuers/[issuerId]/page.tsx` + `[issuerId]/client.tsx` — detail + inline edit form for operational fields; lifecycle card; `Activate` / `Retire` / `Hard delete` buttons with owner-gated tooltips. Retire / Delete modals require reason and surface RPC errors verbatim.
- `admin/src/app/(operator)/billing/issuers/actions.ts` — server actions: `createIssuerAction`, `updateIssuerAction`, `activateIssuerAction`, `retireIssuerAction`, `hardDeleteIssuerAction`.

### Changed
- `admin/src/app/(operator)/layout.tsx` — new `Issuer Entities` nav entry (`/billing/issuers`, ADR-0050) added after `Billing Operations`.

### Tested
- [x] `bun run build` on `admin/` — compiles; `/billing/issuers`, `/billing/issuers/new`, `/billing/issuers/[issuerId]` in route manifest.
- [x] `bun run lint` on `admin/` — clean.
- [x] RPC behaviour coverage lives in `tests/admin/billing-issuer-rpcs.test.ts` (21/21 PASS); manual UI verification pending.

## [ADR-0050 Sprint 2.1 — chunk 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — platform_owner tier UI alignment

### Added
- `admin/src/lib/admin/role-tiers.ts` — `AdminRole` type + `canOperate()` + `canSupport()` helpers. Mirrors the Postgres `admin.require_admin` tier hierarchy so UI gating reads the same way the DB gate does.

### Changed
- Eleven admin-console sites switched from inline `adminRole === 'platform_operator'` (and variants) to `canOperate(adminRole)` / `canSupport(adminRole)`: `admin/src/app/(operator)/billing/operations/page.tsx`, `security/page.tsx`, `templates/[templateId]/page.tsx`, `accounts/[accountId]/page.tsx`, `admins/page.tsx`, `connectors/[connectorId]/page.tsx`, `support/[ticketId]/page.tsx`, `orgs/[orgId]/page.tsx`, `orgs/[orgId]/members-section.tsx`, `components/flags/feature-flags-tab.tsx`, `components/flags/kill-switches-tab.tsx`, `components/orgs/action-bar.tsx`. Without this change a `platform_owner` user would silently lose UI action buttons even though their RPCs succeed.

### Tested
- [x] `bun run build` on `admin/` — compiles with all routes intact.
- [x] `bun run lint` on `admin/` — clean.

## [ADR-0050 Sprint 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 1 — Account-shaped `/billing` panel

### Added
- `admin/src/app/(operator)/billing/page.tsx` — new account-indexed landing. Reuses `admin.accounts_list`; shows N-with-payment-failures pill linking to operations; stub "Last invoice" column pending Sprint 2.
- `admin/src/app/(operator)/billing/[accountId]/page.tsx` — per-account detail. Composes `admin.account_detail` (ADR-0048), the new `admin.billing_account_summary`, and `admin.billing_refunds_list` (filtered client-side to the account). Renders Subscription / Razorpay / Balance cards, Latest-invoice stub, Plan history timeline, Active adjustments, Refunds table.

### Changed
- `admin/src/app/(operator)/billing/operations/page.tsx` + `billing-tabs.tsx` + `actions.ts` — existing ADR-0034 four-tab Billing Operations panel relocated verbatim from `/billing` to `/billing/operations`. `suspendAccountAction` import updated to `../../accounts/actions`. `revalidatePath('/billing')` calls now use `'layout'` scope so the landing + operations sub-route refresh together.
- `admin/src/app/(operator)/layout.tsx` — nav item split: `Billing` (`/billing`, ADR-0050) + `Billing Operations` (`/billing/operations`, ADR-0034).

### Tested
- [x] Admin build compiles; `/billing`, `/billing/[accountId]`, `/billing/operations` present in the route manifest — PASS.
- [x] `bun run lint` clean on `admin/` — PASS.
- [x] `tests/admin/billing-account-view.test.ts` 3/3 PASS: base plan-history event present for a fresh account; missing-account raises; grant + revoke produce two distinct events sharing `adjustment_id` with opposite `action` values; `effective_plan_code` tracks grant/revoke correctly.

## [ADR-0049 Phase 2.2] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion

### Changed
- `admin/src/app/(operator)/security/security-tabs.tsx` — `SentryTab` rewritten from link-out-only to inline table (Received · Project · Level (tone-coded) · Title + culprit · Users · per-row "Open ↗"). Project-wide triage links retained in the Card action. `SecurityData.sentryEvents` interface added; `LevelPill` helper added. RateLimitTab "ingestion pending" banner dropped.
- `admin/src/app/(operator)/security/page.tsx` — fetches `admin.security_sentry_events_list` in Promise.all.

## [ADR-0048 Sprint 1.2] — 2026-04-18

**ADR:** ADR-0048 — Admin Accounts panel

### Added
- `admin/src/app/(operator)/accounts/page.tsx` — list with filter bar (status / plan / name-search).
- `admin/src/app/(operator)/accounts/[accountId]/page.tsx` + `action-bar.tsx` — detail envelope (plan, billing identity, lifecycle, orgs, active adjustments, recent audit) + Suspend/Restore modals gated on platform_operator.
- `admin/src/app/(operator)/accounts/actions.ts` — `suspendAccountAction` / `restoreAccountAction`.
- Nav: `Accounts` between `Organisations` and `Support Tickets`.

### Changed
- `admin/src/app/(operator)/billing/billing-tabs.tsx` — Adjustment modal UUID textbox replaced with select populated via `admin.accounts_list`. Payment Failures tab gains a `Suspend` button (platform_operator + retries ≥ 3).
- `admin/src/app/(operator)/billing/page.tsx` — fetches `accounts_list` at page render.

## [ADR-0046 Phase 1.2] — 2026-04-18

**ADR:** ADR-0046 — Significant Data Fiduciary foundation

### Added
- `admin/src/app/(operator)/orgs/[orgId]/sdf-card.tsx` — client card + edit modal. Tone-coded status pill; notification fields disabled when status is `not_designated`; amber note warns revert clears metadata.
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — `setSdfStatus` Server Action wrapping `admin.set_sdf_status`.
- SDF card slotted into the org detail page before the Contacts card.
- `app/src/app/(dashboard)/dashboard/page.tsx` — `SdfObligationsCard` renders only when `sdf_status != 'not_designated'`. Lists DPDP §10 obligations with tone-coded styling + notification metadata + Phase 2+ pointer.

## [ADR-0045 Sprint 2.1] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle

### Added
- `admin/src/app/(operator)/admins/page.tsx` + `admin-list.tsx` + `actions.ts` — list with Invite / Change-role / Disable modals. Service-readiness banner when `SUPABASE_SERVICE_ROLE_KEY` absent. Self-row + disabled-row actions disabled in UI.
- Nav: `Admin Users` between `Feature Flags` and `Audit Log`.

## [ADR-0034 Sprints 2.1 + 2.2] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations

### Added
- `admin/src/app/(operator)/billing/page.tsx` + `billing-tabs.tsx` — four tabs (Payment failures · Refunds · Comp accounts · Plan overrides), 30s auto-refresh, three modals (Refund · Adjustment · Revoke). ₹-denominated amount input (converted to paise server-side).
- Refund modal result screen (green issued / red failed / amber pending) after Razorpay round-trip.
- Payment Failures `Retry at Razorpay ↗` link-out (Razorpay handles subscription retries automatically).
- Nav: `Billing Operations` live.

## ADR-0047 Sprint 1.2 — 2026-04-18

**ADR:** ADR-0047 — Customer membership lifecycle
**Sprint:** Phase 1, Sprint 1.2 — UI wiring

### Added
- `app/src/app/(dashboard)/dashboard/settings/members/member-row-actions.tsx` — per-row role dropdown + Apply + Remove controls. Self-row + last-account_owner disable client-side. Reason collected via `window.prompt` (min 10 chars; matches RPC gate).
- `app/src/app/(dashboard)/dashboard/settings/members/actions.ts` — `changeMembershipRole`, `removeMembership` Server Actions wrapping the public RPCs.
- `admin/src/app/(operator)/orgs/[orgId]/members-section.tsx` — admin mirror: org members list + per-row controls. Read-only for support/read_only admins; full controls for platform_operator.
- `admin/src/app/(operator)/orgs/[orgId]/actions.ts` — `changeMembershipRole`, `removeMembership` on the admin side (admin-JWT bypass fires in the RPC).

### Changed
- `app/src/app/(dashboard)/dashboard/settings/members/page.tsx` — new "Actions" column; `canManageRow` helper.
- `admin/src/app/(operator)/orgs/[orgId]/page.tsx` — fetches `list_members()` (admin-JWT returns platform-wide) and renders the new `AdminMembersSection` between the summary cards and the notes row.

### Tested
- `cd app && bun run build && bun run lint` — green, zero warnings.
- `cd admin && bun run build && bun run lint` — green, zero warnings.
- `bun run test:rls` — 243/243 (Sprint 1.1 RPC suite still validates the now-wired UI).

## ADR-0044 Phase 2.5 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.5 — dispatch pills + template

### Changed
- `admin/src/components/orgs/invite-created-card.tsx` — amber "email dispatch pending — Phase 2.5" pill replaced with a green "email queued via Resend" pill now that dispatch is wired.
- `app/src/app/(dashboard)/dashboard/settings/members/invite-form.tsx` — success card reworded to "Email has been queued via Resend — if it doesn't arrive, share the URL above manually."

## ADR-0044 Phase 2.4 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.4 — customer-side member management

### Added
- `app/src/app/(dashboard)/dashboard/settings/members/page.tsx` + `invite-form.tsx` + `revoke-button.tsx` + `actions.ts` — Server Component lists current members (account-tier + current-org-tier) and pending invitations; client form creates invites with a role picker scoped to caller's effective role. Revoke button calls `public.revoke_invitation`.
- Nav entry `Team & invites` in `app/src/components/dashboard-nav.tsx`.

### Changed
- `docs/design/screen designs and ux/consentshield-screens.html` — Team members subsection added to the Settings panel (current-members table, pending-invitations table with Revoke buttons, invite form with role picker + org selector + expiry).

### Notes
- Role-scoped role picker: `account_owner` sees all 5 roles (`account_owner`, `account_viewer`, `org_admin`, `admin`, `viewer`); `org_admin` (effective) sees only `admin` + `viewer` for their current org. Users with neither role see a "no permission" card.
- Copy-to-clipboard accept URL on success. Email dispatch is still Phase 2.5 — the success card carries an inline reminder.

## ADR-0044 Phase 2.3 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.3 — operator invite forms (admin console)

### Added
- `admin/src/app/(operator)/orgs/new-invite/page.tsx` + `new-account-invite-form.tsx` + `actions.ts` — top-level operator form that creates an **account-creating** invite (`role='account_owner'`, `account_id=null`, `org_id=null`). Inputs: invitee email, plan (from `public.plans`), trial-days override, optional default org name, expiry (1–90 days, default 14). On submit, shows accept URL + invitation id + expiry; "Create another" resets the form. Gate is the `create_invitation` RPC's `is_admin` check, fronted by `admin/src/proxy.ts` Rule 21.
- `admin/src/app/(operator)/orgs/[orgId]/new-invite/page.tsx` + `org-admin-invite-form.tsx` + `actions.ts` — org-scoped operator form that creates an **org_admin promotion** invite (`role='org_admin'`, `account_id` + `org_id` from URL). Role is fixed to `org_admin` in the UI; admin / viewer invites live in the customer dashboard.
- `admin/src/components/orgs/invite-created-card.tsx` — shared success card with clipboard-copy of the accept URL + invitation id + expiry. Surfaces an amber "email dispatch pending — Phase 2.5" pill so operators know they still have to send the link by hand until the Resend wiring ships.
- `admin/src/app/(operator)/orgs/page.tsx` — header now has a `+ New account invite` link.
- `admin/src/components/orgs/action-bar.tsx` — org detail action bar now has a `+ Invite org admin` link.

### Changed
- `docs/admin/design/consentshield-admin-screens.html` — added panels `2a` (New account invite) and `2b` (Invite org admin) wireframes, plus the two trigger buttons. Spec-first discipline per ADR-0044 alignment.

### Tested
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run build` — 29 routes (up from 27 after Phase 2.1+2.2). Zero errors.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 194/194 across 17 files (no change — RPC behavior tested under `tests/rbac/invitations.test.ts` from Phase 2.1 covers the RPC; the admin-side wrappers only add URL building + input validation).

### Notes
- `NEXT_PUBLIC_APP_URL` is the new env var the accept-URL builder reads. Falls back to `NEXT_PUBLIC_CUSTOMER_APP_URL`, then hard-coded `https://app.consentshield.in`. Wire for dev before clicking "Copy".
- Pre-existing customer-app lint errors in `signup/page.tsx` and `dashboard/page.tsx` (react-compiler warnings surfaced by the upgrade landed in 2.2) are untouched by this sprint.

## ADR-0044 Phase 2.2 — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.2 — invite-gated /signup

### Changed
- `app/src/app/(public)/signup/page.tsx` — walk-up signup removed. The page now requires `?invite=<token>`; hitting it without a token shows a "contact hello@consentshield.in" message. With a token, it previews the invite via `public.invitation_preview`, forces the email field to match the invited address, sends OTP on submit, and on verify calls `public.accept_invitation` which branches by invite shape (account-creating, account-member, or org-member). Successful accept redirects to /dashboard.
- Invite preview UX — summarises the invitee's incoming role ("creating a new ConsentShield account", "joining as an organisation admin", etc.) with plan + default-org-name when applicable.
- `rpc_signup_bootstrap_org` (legacy walk-up path in `/auth/callback`) unchanged — kept as a fallback for any signup that still arrives with `user_metadata.org_name` but no invite.

## ADR-0033 Sprints 1.2 + 2.2 — 2026-04-17

**ADR:** ADR-0033 — Admin Ops + Security (Pipeline Operations + Abuse & Security panels)
**Sprints:** 1.2 (Pipeline UI) + 2.2 (Security UI). Sprint 2.3 (Worker enforcement + smoke-tests) deferred to next session.

### Added
- `admin/src/app/(operator)/pipeline/page.tsx` + `pipeline-tabs.tsx` — 4-tab panel (Worker errors · Stuck buffers · DEPA expiry queue · Delivery health) consuming the 4 admin.pipeline_* RPCs. Server component fetches all 4 in parallel; client component re-fetches every 30s via `router.refresh()`. Empty states explain zero-row cases (e.g. HMAC/origin failures don't yet log to worker_errors).
- `admin/src/app/(operator)/security/page.tsx` + `security-tabs.tsx` + `actions.ts` — 5-tab panel (Rate-limit triggers · HMAC failures · Origin failures · Sentry escalations · Blocked IPs). Block-IP and Unblock-IP Server Actions wrap `admin.security_block_ip` / `admin.security_unblock_ip`. Sentry tab is link-out only to consentshield-app / consentshield-admin Sentry projects. Rate-limit tab carries an inline amber banner explaining that ingestion is pending (V2-S2). The Blocked-IP footer is explicit that Worker enforcement ships in Sprint 2.3.

### Changed
- `admin/src/app/(operator)/layout.tsx` — `Pipeline Operations` + `Abuse & Security` nav items live (soon pills gone; adr pointer updated to `ADR-0033` for both, reflecting the fold-in of ADR-0035).

### Tested
- [x] `cd admin && bun run build` — 27 routes (up from 25 after ADR-0031). Zero errors / zero warnings.
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `bun run test:rls` — 170/170 across 15 files (up from 160/160 after Phase 1's RPC test file).

## ADR-0031 — 2026-04-17

**ADR:** ADR-0031 — Connector Catalogue + Tracker Signature Catalogue (admin panels)
**Sprints:** 1.1 + 1.2 (connectors list / detail / editor / deprecate) · 2.1 + 2.2 (signatures list / detail / editor / import pack)

### Added
- `admin/src/app/(operator)/connectors/page.tsx` + `[connectorId]/page.tsx` + `new/page.tsx` + `[connectorId]/edit/page.tsx` — list (filterable by status + vendor) + detail (metadata, webhook endpoint template, required-credentials schema) + create/edit form + Deprecate modal with replacement picker + cutover deadline.
- `admin/src/components/connectors/{filter-bar,connector-form,detail-actions}.tsx` — shared UI primitives. JSON schema textarea is parse-validated server-side before calling `admin.add_connector` / `admin.update_connector` / `admin.deprecate_connector`.
- `admin/src/app/(operator)/signatures/page.tsx` + `[signatureId]/page.tsx` + `new/page.tsx` + `[signatureId]/edit/page.tsx` + `import/page.tsx` — list with category pill filter + critical-severity pill + status select + detail with pattern preview + create/edit form (regex pattern compile-checked) + bulk import pack form.
- `admin/src/components/signatures/{filter-bar,signature-form,detail-actions,import-form}.tsx`.
- `admin/src/app/(operator)/connectors/actions.ts` + `signatures/actions.ts` — Server Actions wrapping the seven ADR-0027 RPCs (`add_connector`, `update_connector`, `deprecate_connector`, `add_tracker_signature`, `update_tracker_signature`, `deprecate_tracker_signature`, `import_tracker_signature_pack`). All enforce reason ≥ 10 chars client-side in addition to the RPC's check.

### Changed
- `admin/src/app/(operator)/layout.tsx` — `Connector Catalogue` and `Tracker Signatures` nav items now live; the "soon" pills are gone for ADR-0031.

### Tested
- [x] `cd admin && bun run build` — 25 routes compile (up from 15).
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 160/160, no regression.

## ADR-0039 — 2026-04-17

**ADR:** ADR-0039 — Connector OAuth (Mailchimp + HubSpot)

### Changed
- `app/src/app/(dashboard)/dashboard/integrations/page.tsx` — new "Connect via OAuth" card with "Connect Mailchimp" and "Connect HubSpot" buttons pointing at `/api/integrations/oauth/<provider>/connect`. New `OAuthBanner` surfaces success / error after the callback redirect (`?oauth_connected=<provider>` or `?oauth_error=<code>`).
- API-key connector form is preserved as the fallback for providers without OAuth configured or operators who prefer keys.

## ADR-0041 Sprint 1.4 — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox
**Sprint:** 1.4 — probe CRUD UI

### Added
- `app/src/app/(dashboard)/dashboard/probes/page.tsx` + `probes-list.tsx` + `actions.ts` — probe list, create/edit drawer, pause/resume/delete per-row actions, last-run status pill. Create form takes property, schedule, and a comma-separated consent_state. Help card documents the consent_state format and how v2 probes differ from v1 static-HTML.
- `app/src/components/dashboard-nav.tsx` — new nav item "Consent Probes" slotted after "Enforcement".

## ADR-0040 — 2026-04-17

**ADR:** ADR-0040 — Audit R2 Upload Pipeline
**Sprints:** 1.2 server actions · 1.3 storage settings UI

### Added
- `app/src/app/(dashboard)/dashboard/exports/actions.ts` — `saveR2Config`, `verifyR2Config`, `deleteR2Config`. `saveR2Config` encrypts credentials via `encryptForOrg` and upserts `export_configurations`. `verifyR2Config` decrypts, sigv4-PUTs a tiny verification marker to the bucket, flips `is_verified` on success. Admin/owner gated on the server side.
- `app/src/app/(dashboard)/dashboard/exports/settings/page.tsx` + `r2-settings-form.tsx` — server page + client form. Shows current config (bucket / path prefix / region / verified status / last export), exposes Save + Verify + Delete actions. Endpoint-reference block documents the Cloudflare R2 URL shape.

### Changed
- `app/src/app/(dashboard)/dashboard/exports/page.tsx` — headline restructured as a two-column flex with a "Storage settings" link. New "Delivery target" section surfaces whether exports upload to R2 (verified / unverified) or fall back to direct download. History table renders `r2_bucket/r2_object_key` for R2-delivered manifests.
- `app/src/app/(dashboard)/dashboard/exports/export-button.tsx` — response handling branches on Content-Type. For `application/json` (R2 delivery), opens the presigned URL in a new tab. For binary ZIP, preserves the existing blob download flow.

### Tested
- [x] `cd app && bunx vitest run tests/storage/sigv4.test.ts` — 7/7 PASS.
- [x] `cd app && bun run build` — zero errors / zero warnings; `/dashboard/exports/settings` in the route manifest.

## ADR-0037 — 2026-04-17

**ADR:** ADR-0037 — DEPA Completion
**Sprints:** 1.2 rights per-requestor binding · 1.3 CSV button

### Changed
- `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — erasure requests now render a "Matched N artefacts" green block above the informational impact preview when `rights_requests.session_fingerprint` matches active artefacts. Each matched row shows purpose, data_scope chips, expires_at, and the connector fan-out per artefact. Impact-preview fallback caveat text now reflects fingerprint availability (`no fingerprint` / `no match` / `fallback + primary`).
- `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — topbar gains "Export CSV" anchor that constructs a CSV URL preserving the current filter params (`?status`, `?framework`, `?purpose`, `?expiring=30`). Headline layout restructured to `flex items-start justify-between`.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings. `/api/orgs/[orgId]/artefacts.csv` in the route manifest.

## ADR-0024 — 2026-04-17

**ADR:** ADR-0024 — DEPA Customer UI Rollup
**Sprints:** 1.1 Purpose Definitions catalogue · 1.2 Connector mappings · 1.3 Consent Artefacts + dashboard tile · 1.4 Rights Centre + settings + RLS test

### Added
- `app/src/app/(dashboard)/dashboard/purposes/page.tsx` — server route fetching `purpose_definitions`, `purpose_connector_mappings`, `integration_connectors`, and the org's `settings.sectoral_template`. Header shows the active sector template badge.
- `app/src/app/(dashboard)/dashboard/purposes/purposes-view.tsx` — client tab switcher: Catalogue + Connector mappings. Catalogue tab renders the 7-column table with inline Create form and per-row inline edit/archive. Connector mappings tab renders the purpose × connector × data_categories table with inline Create form (purpose picker, connector picker, comma-separated data_categories) and per-row Remove. Admin-only mutations per `organisation_members.role`.
- `app/src/app/(dashboard)/dashboard/purposes/actions.ts` — server actions: `createPurpose`, `updatePurpose`, `togglePurposeActive`, `createMapping`, `deleteMapping`. All use the authenticated supabase client; RLS enforces the org boundary. `createMapping` additionally enforces `data_categories ⊆ purpose.data_scope` server-side.
- `app/src/app/(dashboard)/dashboard/artefacts/page.tsx` — Consent Artefacts list. 4 KPI cards (active / expiring<30d / revoked 7d / replaced 7d). Filter component. Paginated table (50 rows). Link to detail.
- `app/src/app/(dashboard)/dashboard/artefacts/filters.tsx` — client filter-chip component (status × framework × purpose × expiring<30d). Updates `?status=…&framework=…&purpose=…&expiring=30&page=N` via router.push.
- `app/src/app/(dashboard)/dashboard/artefacts/[artefactId]/page.tsx` — detail with two info columns (Artefact / Context) and the 4-link chain-of-custody timeline (Event → Artefact → Revocations → Deletion receipts).
- `app/src/components/dashboard-nav.tsx` — +2 items: "Purpose Definitions" and "Consent Artefacts" slotted between Banners and Enforcement.

### Changed
- `app/src/app/(dashboard)/dashboard/page.tsx` — Stat row expands to 5 columns. New "Consent Artefacts" tile links to `/dashboard/artefacts` with active count + "X expiring 30d · Y revoked 7d" sub-label.
- `app/src/app/(dashboard)/dashboard/rights/[id]/page.tsx` — erasure requests gain an "Artefact-scoped impact preview" section showing org's active purposes + mapped connectors + aggregate fan-out count. Purposes without connector mappings render highlighted. Informational — per-requestor binding deferred to V2-D2.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings. 3 new server-rendered routes in the manifest.
- [x] `bunx tsc --noEmit` — clean.
- [x] `bun run test:rls` — 14 files, **159/159** — PASS (154 baseline + 5 new in `depa-purpose-crud.test.ts`).

## ADR-0025 Sprint 1.2 — 2026-04-17

**ADR:** ADR-0025 — DEPA Score Dimension
**Sprint:** 1.2 — dashboard DEPA gauge

### Changed
- `app/src/app/(dashboard)/dashboard/page.tsx` — "Compliance Score" card restructured to "Compliance Scores" as a 2-column grid:
  - **Left column (DPDP):** existing `ScoreGauge` with the 6 component `ScoreRow`s (unchanged scoring, unchanged values).
  - **Right column (DEPA):** new `ScoreGauge` fed from `depa_compliance_metrics` (cache) or `compute_depa_score` RPC (fallback), converted to 0–100% via `total / 20 * 100`. Level thresholds: `>=15 green · >=10 amber · <10 red`. Below the gauge, four `ScoreRow`s render the sub-scores ("Coverage · Expiry · Freshness · Revocation", each out of 5). Caption shows `Refreshed <date>` or `Computed on demand · nightly refresh pending` for orgs whose nightly refresh hasn't landed yet.
- Gauge labels ("DPDP" / "DEPA") rendered beneath each gauge.

### Tested
- [x] `cd app && bun run build` — success, zero errors / zero warnings.
- [x] `bunx tsc --noEmit` — clean.

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

## [ADR-0050 Sprint 3.1] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.1

### Added
- `admin/src/app/(operator)/billing/gst-statement/` — GST statement page + server action; issuer selector (locked to current-active for operators, free-form incl. retired for owner); FY range selector; summary card (totals by tax head + invoice count); CSV download with UTF-8 BOM.
- `admin/src/app/(operator)/billing/export/` — Invoice export page + server action; filter form (FY / account / issuer); streams ZIP of PDFs + `index.csv`; audit-logs caller role + filter params + row count + ZIP SHA-256.
- `admin/src/app/(operator)/billing/search/` — Invoice search page; scope-aware (operator: current-active issuer; owner: all issuers); search by invoice_number / account / razorpay_payment_id / date range; paged; links to invoice detail.

### Changed
- `admin/src/app/(operator)/layout.tsx` — added sidebar nav entries for GST Statement, Export, and Search under the Billing section.

### Tested
- [x] `cd admin && bun run build` — PASS (all 3 new routes compile cleanly)
- [x] `cd admin && bun run lint` — PASS (zero warnings)

## [ADR-0050 Sprint 3.2] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.2

### Added
- `admin/src/app/(operator)/billing/disputes/page.tsx` — Dispute list with status/deadline filter. Red row highlight when deadline < 48h. Shows dispute ID, account, amount, reason, phase, status, deadline.
- `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — Dispute detail: dispute info, red deadline banner, webhook timeline, plan history, action section.
- `admin/src/app/(operator)/billing/disputes/[disputeId]/dispute-actions.tsx` — Client component: Assemble Evidence Bundle button (streams presigned download URL) + state transition form (under_review/won/lost/closed with required reason).

### Changed
- `admin/src/app/(operator)/layout.tsx` — Added "Disputes" nav entry under Billing section.
- `admin/src/lib/billing/r2-disputes.ts` — R2 upload helper for evidence ZIPs (`disputes/{id}/evidence-{iso}.zip`).
- `admin/src/lib/billing/build-evidence-bundle.ts` — Pure ZIP assembly (dispute.json, account.json, invoices/*, webhook-events.ndjson, plan-history.json); testable without runtime.

### Tested
- [x] `cd admin && bun run build` — PASS (disputes + [disputeId] routes compile clean)
