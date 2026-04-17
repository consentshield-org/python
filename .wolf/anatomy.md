# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-04-17T08:56:49.995Z
> Files: 405 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../../tmp/

- `create-bootstrap-test-user.ts` — Declares main (~214 tok)
- `depa_verify.sql` — §11.11 DEPA verification queries — ADR-0020 Sprint 1.1 (~643 tok)

## ../../../.claude/plans/

- `quiet-noodling-pond.md` — Plan — Merge DEPA package into `docs/architecture/` source of truth (~3175 tok)

## ../../../.claude/projects/-Users-sudhindra-projects-aiSpirit-consent-sheild/memory/

- `feedback_bun_workspace_quirks.md` — Don't list non-existent dirs in root `package.json` `workspaces` (~517 tok)
- `feedback_docs_vs_code_drift.md` (~534 tok)
- `feedback_explicit_git_staging.md` (~479 tok)
- `feedback_hybrid_trigger_over_polling.md` (~654 tok)
- `feedback_latest_versions.md` (~311 tok)
- `feedback_no_ai_authorship.md` (~263 tok)
- `feedback_no_auth_uid_in_scoped_rpcs.md` — Declares fails (~432 tok)
- `feedback_no_legacy_vs_no_objects.md` — Declares change (~534 tok)
- `feedback_openwolf_system.md` (~390 tok)
- `feedback_otp_over_magic_link.md` (~439 tok)
- `feedback_parallel_adrs.md` (~378 tok)
- `feedback_share_narrowly_not_broadly.md` (~1004 tok)
- `feedback_supabase_aal_not_in_app_metadata.md` — Declares currentAal (~516 tok)
- `feedback_v2_backlog_pattern.md` (~479 tok)
- `feedback_vitest_serial_for_supabase_auth.md` (~502 tok)
- `feedback_wireframes_before_adrs.md` (~784 tok)
- `MEMORY.md` (~1171 tok)
- `project_admin_platform_2026-04-16.md` — What IS implemented as of 2026-04-16 (~1994 tok)
- `project_admin_platform_2026-04-17.md` — What IS implemented as of 2026-04-17 (~2346 tok)
- `project_dev_only_no_prod.md` (~347 tok)
- `project_status_2026-04-14.md` — ADR status (~693 tok)
- `project_status_2026-04-15.md` — Live deployments (~680 tok)
- `project_status_2026-04-16.md` — ADR state (~2188 tok)
- `project_status_2026-04-17.md` — ADR state at EOD (~3211 tok)
- `reference_email_deliverability.md` — Resend account (~907 tok)
- `reference_infrastructure.md` (~628 tok)
- `reference_supabase_platform_gotchas.md` — PG 16 GRANT ROLE split (migration role needs `WITH SET TRUE`) (~1631 tok)
- `reference_vercel_setup.md` — Projects (~665 tok)
- `user_role.md` (~306 tok)

## ./

- `.gitignore` — Git ignore rules (~182 tok)
- `.prettierrc` (~29 tok)
- `CLAUDE.md` — OpenWolf (~4938 tok)
- `package.json` — Node.js package manifest (~110 tok)
- `sentry.client.config.ts` (~166 tok)
- `sentry.server.config.ts` (~166 tok)
- `tsconfig.base.json` (~110 tok)
- `tsconfig.json` — TypeScript configuration (~206 tok)
- `vitest.config.ts` — /*.test.ts', (~217 tok)

## .claude/

- `session-handoff.md` — Session Handoff (~1131 tok)

## .github/workflows/

- `monorepo-isolation.yml` — ADR-0026 Sprint 4.1 — monorepo isolation guard. (~337 tok)

## admin/

- `eslint.config.mjs` — Declares eslintConfig (~98 tok)
- `package.json` — Node.js package manifest (~259 tok)
- `sentry.client.config.ts` (~170 tok)
- `sentry.server.config.ts` (~170 tok)
- `tsconfig.json` — TypeScript configuration (~102 tok)
- `vitest.config.ts` — /*.test.ts'], (~106 tok)

## admin/src/

- `proxy.ts` — Admin proxy gate — runs on every admin-app request. (~845 tok)

## admin/src/app/

- `globals.css` — Styles: 1 rules, 4 vars (~87 tok)
- `layout.tsx` — metadata (~138 tok)

## admin/src/app/(auth)/login/

- `page.tsx` — AdminLoginPage — renders form (~1546 tok)

## admin/src/app/(operator)/

- `actions.ts` — Exports refreshPlatformMetrics (~167 tok)
- `layout.tsx` — Operator shell. Red admin-mode strip + red sidebar border per the (~1456 tok)
- `page.tsx` — ADR-0028 Sprint 2.1 — Operations Dashboard. (~1660 tok)

## admin/src/app/(operator)/audit-log/

- `page.tsx` — ADR-0028 Sprint 3.1 — Audit Log viewer. (~2104 tok)

## admin/src/app/(operator)/audit-log/export/

- `route.ts` — ADR-0028 Sprint 3.1 — CSV export of filtered audit log. (~1147 tok)

## admin/src/app/(operator)/flags/

- `actions.ts` — Exports setFeatureFlag, deleteFeatureFlag, toggleKillSwitch (~918 tok)
- `page.tsx` — ADR-0036 Sprint 1.1 — Feature Flags & Kill Switches panel. (~1110 tok)

## admin/src/app/(operator)/orgs/

- `page.tsx` — ADR-0029 Sprint 1.1 — Organisations list. (~2110 tok)

## admin/src/app/(operator)/orgs/[orgId]/

- `actions.ts` — Exports addOrgNote, extendTrial, suspendOrg, restoreOrg (~822 tok)
- `impersonation-actions.ts` — Exports startImpersonation, endImpersonation, forceEndImpersonation (~1296 tok)
- `page.tsx` — ADR-0029 Sprint 1.1 — Organisation detail page (read-only). (~2946 tok)

## admin/src/app/(operator)/support/

- `actions.ts` — Exports sendMessage, changeStatus, changePriority, assignTicket (~960 tok)
- `page.tsx` — ADR-0032 Sprint 1.1 — Support tickets list + metric tiles. (~2467 tok)

## admin/src/app/(operator)/support/[ticketId]/

- `page.tsx` — ADR-0032 Sprint 1.1 — Support ticket detail + thread + reply. (~1590 tok)

## admin/src/app/(operator)/templates/

- `actions.ts` — Exports PurposeRow, createDraft, updateDraft, publishTemplate + 2 more (~1652 tok)
- `page.tsx` — ADR-0030 Sprint 1.1 — Sectoral Templates list. (~1841 tok)

## admin/src/app/(operator)/templates/[templateId]/

- `page.tsx` — ADR-0030 Sprint 1.1 — Sectoral Template detail (read-only). (~2993 tok)

## admin/src/app/(operator)/templates/[templateId]/edit/

- `page.tsx` — ADR-0030 Sprint 2.1 — Draft editor (drafts only). (~973 tok)

## admin/src/app/(operator)/templates/new/

- `page.tsx` — ADR-0030 Sprint 2.1 — New-draft form. (~952 tok)

## admin/src/app/api/auth/signout/

- `route.ts` — ADR-0028 Sprint 1.1 — admin sign-out. (~141 tok)

## admin/src/components/

- `otp-boxes.tsx` — OtpBoxes (~421 tok)

## admin/src/components/audit-log/

- `audit-table.tsx` — AuditTable — renders table (~877 tok)
- `detail-drawer.tsx` — AuditDetailDrawer (~1394 tok)
- `filter-bar.tsx` — AuditLogFilterBar — renders form (~1110 tok)

## admin/src/components/common/

- `modal-form.tsx` — ModalShell (~850 tok)

## admin/src/components/flags/

- `feature-flags-tab.tsx` — FeatureFlagsTab — renders form, table, modal (~4012 tok)
- `flags-tabs.tsx` — FlagsTabs (~469 tok)
- `kill-switches-tab.tsx` — KillSwitchesTab — renders form, modal (~2212 tok)

## admin/src/components/impersonation/

- `active-session-banner-client.tsx` — BannerClient (~610 tok)
- `active-session-banner.tsx` — ADR-0029 Sprint 3.1 — always-visible banner while an impersonation (~274 tok)
- `end-session-button.tsx` — EndSessionButton (~184 tok)
- `start-drawer.tsx` — REASONS — renders form (~1686 tok)

## admin/src/components/ops-dashboard/

- `cron-status-card.tsx` — CronStatusCard — renders table (~898 tok)
- `kill-switches-card.tsx` — KillSwitchesCard (~626 tok)
- `metric-tile.tsx` — Pure presentational tile. Server Component. (~256 tok)
- `recent-activity-card.tsx` — RecentActivityCard (~650 tok)
- `refresh-button.tsx` — RefreshButton (~289 tok)

## admin/src/components/orgs/

- `action-bar.tsx` — OrgActionBar — renders form, modal (~2513 tok)
- `filter-bar.tsx` — PLANS — renders form (~898 tok)

## admin/src/components/support/

- `reply-form.tsx` — ReplyForm — renders form (~578 tok)
- `ticket-controls.tsx` — STATUSES — renders form, modal (~2278 tok)

## admin/src/components/templates/

- `detail-actions.tsx` — TemplateDetailActions — renders form, modal (~1780 tok)
- `filter-bar.tsx` — TemplatesFilterBar (~586 tok)
- `template-form.tsx` — FRAMEWORKS — renders form (~3740 tok)

## admin/src/lib/impersonation/

- `cookie.ts` — ADR-0029 Sprint 3.1 — impersonation cookie lifecycle. (~439 tok)

## admin/src/lib/supabase/

- `browser.ts` — Admin Supabase browser client. Functionally identical to the customer (~153 tok)
- `server.ts` — Admin Supabase server client. Uses the same auth.users pool as the (~328 tok)

## admin/tests/

- `smoke.test.ts` — Smoke test — proves `bun --filter @consentshield/admin run test` finds (~94 tok)

## app/

- `package.json` — Node.js package manifest (~310 tok)
- `tsconfig.json` — TypeScript configuration (~117 tok)

## app/src/app/(dashboard)/

- `layout.tsx` — DashboardLayout (~128 tok)

## app/src/app/(dashboard)/dashboard/

- `page.tsx` — DashboardPage — renders table (~2481 tok)

## app/src/app/(dashboard)/dashboard/billing/

- `page.tsx` — BillingPage (~1727 tok)

## app/src/app/(dashboard)/dashboard/enforcement/

- `page.tsx` — EnforcementPage — renders table (~4844 tok)

## app/src/app/(dashboard)/dashboard/rights/

- `page.tsx` — RightsInboxPage — renders table (~1435 tok)

## app/src/app/(dashboard)/dashboard/support-sessions/

- `page.tsx` — ADR-0029 Sprint 4.1 — customer-side Support sessions tab. (~1208 tok)

## app/src/app/(dashboard)/dashboard/support/

- `actions.ts` — Exports createTicket, replyToTicket, goToNewTicketForm (~858 tok)
- `page.tsx` — ADR-0032 Sprint 2.1 — customer-side Support inbox. (~1612 tok)

## app/src/app/(dashboard)/dashboard/support/new/

- `page.tsx` — ADR-0032 Sprint 2.1 — Contact Support form (customer side). (~330 tok)

## app/src/app/(public)/privacy/[orgId]/

- `page.tsx` — Public privacy notice page — no auth required. Backed by rpc_get_privacy_notice (~705 tok)

## app/src/app/api/orgs/[orgId]/integrations/

- `route.ts` — Next.js API route: GET, POST (~1445 tok)

## app/src/components/

- `dashboard-nav.tsx` — navItems (~596 tok)
- `otp-boxes.tsx` — OtpBoxes (~345 tok)
- `suspended-banner.tsx` — ADR-0029 Sprint 4.1 — customer-side suspension banner. (~537 tok)

## app/src/components/support/

- `new-ticket-form.tsx` — NewTicketForm — renders form (~1400 tok)

## app/src/lib/rights/

- `deletion-dispatch.ts` — Deletion orchestration — dispatches erasure to connectors and records (~3008 tok)

## app/tests/buffer/

- `lifecycle.test.ts` — Migration 011 (20260413000011) revokes UPDATE and DELETE on all buffer (~1002 tok)

## app/tests/worker/

- `harness.ts` — API routes: GET (2 endpoints) (~1828 tok)

## docs/

- `ROADMAP-phase2.md` — ConsentShield — Phase 2 Roadmap (~3150 tok)
- `STATUS.md` — ConsentShield Status (~2363 tok)
- `V2-BACKLOG.md` — V2 Backlog — Deferred Items for Post-Phase-2 Review (~2289 tok)

## docs/ADRs/

- `ADR-0001-project-scaffolding.md` — ADR-0001: Project Scaffolding — Next.js, Supabase Schema, Auth, Worker Skeleton (~4245 tok)
- `ADR-0002-worker-hmac-origin.md` — ADR-0002: Worker HMAC Verification + Origin Validation (~1746 tok)
- `ADR-0003-consent-banner-dashboard.md` — ADR-0003: Consent Banner Builder + Compliance Dashboard (~2837 tok)
- `ADR-0004-rights-request-workflow.md` — ADR-0004: Rights Request Workflow (Turnstile + OTP + Dashboard Inbox) (~1670 tok)
- `ADR-0005-tracker-monitoring.md` — ADR-0005: Tracker Monitoring (Banner Script v2 with MutationObserver) (~1405 tok)
- `ADR-0006-razorpay-billing.md` — ADR-0006: Razorpay Billing + Plan Gating (~1385 tok)
- `ADR-0007-deletion-orchestration.md` — ADR-0007: Deletion Orchestration (Generic Webhook Protocol) (~1575 tok)
- `ADR-0008-browser-auth-hardening.md` — ADR-0008: Browser Auth Hardening (Remove Client Signing Secret, Record Origin, Fail-Fast Turnstile) (~2078 tok)
- `ADR-0009-scoped-role-enforcement.md` — ADR-0009: Scoped-Role Enforcement in REST Paths (~1843 tok)
- `ADR-0010-distributed-rate-limiter.md` — ADR-0010: Distributed Rate Limiter for Public Rights-Request Endpoints (~1577 tok)
- `ADR-0011-deletion-retry.md` — ADR-0011: Deletion Retry and Timeout for Stuck Callbacks (~1860 tok)
- `ADR-0012-automated-test-suites.md` — ADR-0012: Automated Test Suites for High-Risk Paths (~1810 tok)
- `ADR-0013-signup-bootstrap-hardening.md` — ADR-0013: Signup Bootstrap Hardening (~2355 tok)
- `ADR-0014-external-service-activation.md` — ADR-0014: External Service Activation (Resend / Turnstile / Razorpay) (~1300 tok)
- `ADR-0015-security-posture-scanner.md` — ADR-0015: Security Posture Scanner (~1395 tok)
- `ADR-0016-consent-probes.md` — ADR-0016: Consent Probes (Synthetic Compliance Testing) (~1518 tok)
- `ADR-0017-audit-export-package.md` — ADR-0017: Audit Export Package (~1578 tok)
- `ADR-0018-prebuilt-deletion-connectors.md` — ADR-0018: Pre-built Deletion Connectors (Mailchimp, HubSpot) (~1457 tok)
- `ADR-0019-depa-roadmap.md` — ADR-0019: DEPA Roadmap — Charter & Sequencing of ADR-0020..0025 (~3286 tok)
- `ADR-0020-depa-schema-skeleton.md` — ADR-0020: DEPA Schema Skeleton (~5670 tok)
- `ADR-0021-process-consent-event.md` — ADR-0021: `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron (~3927 tok)
- `ADR-0022-artefact-revocation-pipeline.md` — ADR-0022: `process-artefact-revocation` Edge Function + Revocation Dispatch (~4386 tok)
- `ADR-0026-monorepo-restructure.md` — ADR-0026: Monorepo Restructure (Bun Workspace — `app/` + `admin/` + `packages/*`) (~8747 tok)
- `ADR-0027-admin-schema.md` — ADR-0027: Admin Platform Schema (cs_admin Role + `admin.*` Tables + Audit Log + Impersonation) (~14644 tok)
- `ADR-0028-admin-app-foundation.md` — ADR-0028: Admin App Foundation — Real Auth, Operations Dashboard, Audit Log (~4047 tok)
- `ADR-0029-admin-organisations.md` — ADR-0029: Admin Organisations Panel — List, Detail, Actions, Impersonation (~3387 tok)
- `ADR-0030-sectoral-templates.md` — ADR-0030: Sectoral Templates (Admin Panel + Customer-Side Read) (~2410 tok)
- `ADR-0032-support-tickets.md` — ADR-0032: Support Tickets (Admin Panel + Customer-Side Submit) (~2207 tok)
- `ADR-0036-feature-flags-kill-switches.md` — ADR-0036: Feature Flags & Kill Switches (Admin Panel) (~2282 tok)
- `ADR-index.md` — ADR Index (~1016 tok)
- `ADR-template.md` — ADR-NNNN: Title (~423 tok)
- `adr-workflow.md` — ADR Workflow Rules (~557 tok)

## docs/admin/architecture/

- `consentshield-admin-monorepo-migration.md` — ConsentShield — Monorepo Migration Plan (~5512 tok)
- `consentshield-admin-platform.md` — ConsentShield — Admin Platform Architecture Reference (~9801 tok)
- `consentshield-admin-schema.md` — Admin Postgres schema. cs_admin role with BYPASSRLS for SELECT only, writes via security-definer RPCs that audit-log in same transaction. 11 admin tables + 5 example RPCs + 14-step migration order. (~10213 tok)

## docs/admin/design/

- `ARCHITECTURE-ALIGNMENT-2026-04-16.md` — Admin Platform — Architecture Alignment (~3423 tok)
- `consentshield-admin-screens.html` — Admin wireframe spec: 11 panels (Operations Dashboard, Organisations, Support Tickets, Sectoral Templates, Connector Catalogue, Tracker Signatures, Pipeline Operations, Billing Operations, Abuse & Security, Feature Flags & Kill Switches, Audit Log) + Impersonation drawer. Red admin-mode strip + sidebar accent visually distinguish from customer app. (~26762 tok)

## docs/architecture/

- `consentshield-complete-schema-design.md` — ConsentShield — Complete Schema Design (~31827 tok)
- `consentshield-definitive-architecture.md` — ConsentShield — Definitive Architecture Reference (~15903 tok)
- `consentshield-testing-strategy.md` — ConsentShield — The Testing Question (~8766 tok)
- `nextjs-16-reference.md` — Next.js 16 — Project Reference (~1408 tok)

## docs/changelogs/

- `CHANGELOG-api.md` — Changelog — API (~1976 tok)
- `CHANGELOG-dashboard.md` — Changelog — Dashboard (~3892 tok)
- `CHANGELOG-docs.md` — Changelog — Documentation (~843 tok)
- `CHANGELOG-edge-functions.md` — Changelog — Edge Functions (~1816 tok)
- `CHANGELOG-infra.md` — Changelog — Infrastructure (~3183 tok)
- `CHANGELOG-schema.md` — Changelog — Schema (~9793 tok)
- `CHANGELOG-worker.md` — Changelog — Worker (~1514 tok)

## docs/design/

- `consentshield-complete-schema-design.md` — ConsentShield — Complete Schema Design (~17070 tok)
- `consentshield-definitive-architecture.md` — ConsentShield — Definitive Architecture Reference (~10435 tok)
- `consentshield-technical-architecture.md` — ConsentShield — Technical Architecture (~14936 tok)
- `consentshield-testing-strategy.md` — ConsentShield — The Testing Question (~6253 tok)
- `consentshield-v2-complete-blueprint.md` — ConsentShield v2 — Complete Product Blueprint (~18422 tok)

## docs/design/screen designs and ux/

- `ARCHITECTURE-ALIGNMENT-2026-04-16.md` — Screen Designs — Architecture Alignment (~5353 tok)
- `consentshield-mobile.html` — iOS wireframes spec, 3 flows (rights monitor, breach trigger, clinic ABDM Month 6+). M1/M2/M3 drift items deferred to ABDM/mobile/BFSI ADRs. (~17068 tok)
- `consentshield-next-steps.md` — Strategic decisions log April 2026 + 2026-04-16 addendum noting DEPA architecture has moved on. (~2784 tok)
- `consentshield-screens.html` — ConsentShield — Screen Designs & UX Flows (~28283 tok)

## docs/ops/

- `supabase-auth-templates.md` — Supabase Auth Email Templates (OTP form) (~943 tok)

## docs/reviews/

- `2026-04-13-architecture-consistency-review.md` — Architecture Consistency Review — 2026-04-13 (~1426 tok)
- `2026-04-14-codebase-architecture-review.md` — Critical Codebase Review — Architecture Compliance (~5835 tok)
- `2026-04-15-deferred-items-analysis.md` — Deferred Items — Analysis (~1954 tok)
- `2026-04-16-depa-package-architecture-review.md` — DEPA Package Architecture Review — 2026-04-16 (~5618 tok)
- `2026-04-16-phase2-completion-review.md` — Critical Codebase Review — Phase 2 Completion (~6107 tok)

## packages/compliance/

- `package.json` — Node.js package manifest (~54 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## packages/compliance/src/

- `index.ts` (~82 tok)

## packages/encryption/

- `package.json` — Node.js package manifest (~73 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## packages/encryption/src/

- `index.ts` (~16 tok)

## packages/shared-types/

- `package.json` — Node.js package manifest (~54 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## packages/shared-types/src/

- `depa.ts` — DEPA schema-derived types shared by the customer app (app/) and the (~1577 tok)
- `index.ts` — customer app (app/) and the operator app (admin/). (~199 tok)

## scripts/

- `.tmp-cleanup-rehearsal.ts` — Declares main (~297 tok)
- `bootstrap-admin.ts` — ADR-0027 Sprint 4.1 — admin bootstrap one-shot. (~1746 tok)
- `check-env-isolation.ts` — ADR-0026 Sprint 4.1 — env-var isolation guard. (~953 tok)
- `check-no-admin-imports-in-app.ts` — ADR-0026 Sprint 4.1 — cross-import guard: app/ must not reference admin/. (~989 tok)
- `check-no-customer-imports-in-admin.ts` — ADR-0026 Sprint 4.1 — cross-import guard: admin/ must not reference app/. (~910 tok)
- `smoke-test-rate-limit.ts` — Declares main (~242 tok)

## session-context/

- `context-2026-04-14-19-20-20.md` — Session Context — 2026-04-14 19:20:20 (~2725 tok)
- `context-2026-04-15-22-02-12.md` — Session Context — 2026-04-15 22:02:12 (~3565 tok)
- `context-2026-04-16-07-01-59.md` — Session Context — 2026-04-16 07:01:59 (~2951 tok)
- `context-2026-04-16-12-08-11.md` — Session Context — 2026-04-16 12:08:11 (~3965 tok)
- `context-2026-04-16-18-12-48.md` — Session Context — 2026-04-16 18:12:48 (~4550 tok)
- `context-2026-04-16-20-48-13.md` — Session Context — 2026-04-16 20:48:13 (~5237 tok)
- `context-2026-04-16-21-55-13.md` — Session Context — 2026-04-16 21:55:13 (~7153 tok)
- `context-2026-04-17-08-34-12.md` — Session Context — 2026-04-17 08:34:12 (Terminal B) (~3780 tok)
- `context-2026-04-17-09-55-08.md` — Session Context — 2026-04-17 09:55:08 (Terminal A) (~5515 tok)

## src/

- `proxy.ts` — Exports proxy, config (~432 tok)

## src/app/

- `layout.tsx` — geistSans (~202 tok)
- `page.tsx` — Home (~751 tok)

## src/app/(dashboard)/

- `layout.tsx` — DashboardLayout (~83 tok)

## src/app/(dashboard)/dashboard/

- `page.tsx` — DashboardPage — renders table (~2480 tok)
- `score-gauge.tsx` — ScoreGauge (~342 tok)

## src/app/(dashboard)/dashboard/banners/

- `create-form.tsx` — DEFAULT_PURPOSES — renders form (~1447 tok)
- `page.tsx` — BannersPage — renders table (~1102 tok)

## src/app/(dashboard)/dashboard/banners/[bannerId]/

- `editor.tsx` — BannerEditor (~2600 tok)
- `page.tsx` — BannerDetailPage (~414 tok)
- `preview.tsx` — BannerPreview (~887 tok)

## src/app/(dashboard)/dashboard/billing/

- `page.tsx` — BillingPage (~1726 tok)
- `upgrade-button.tsx` — UpgradeButton (~633 tok)

## src/app/(dashboard)/dashboard/enforcement/

- `page.tsx` — EnforcementPage — renders table (~4843 tok)

## src/app/(dashboard)/dashboard/exports/

- `export-button.tsx` — ExportButton (~410 tok)
- `page.tsx` — ExportsPage — renders table (~1182 tok)

## src/app/(dashboard)/dashboard/integrations/

- `integrations-table.tsx` — IntegrationsTable — renders form, table (~2995 tok)
- `page.tsx` — IntegrationsPage (~714 tok)

## src/app/(dashboard)/dashboard/inventory/

- `inventory-table.tsx` — LEGAL_BASES — renders form, table (~2581 tok)
- `page.tsx` — InventoryPage (~349 tok)

## src/app/(dashboard)/dashboard/properties/

- `create-form.tsx` — CreatePropertyForm — renders form (~1060 tok)
- `page.tsx` — PropertiesPage — renders table (~918 tok)

## src/app/(dashboard)/dashboard/properties/[propertyId]/

- `editor.tsx` — PropertyEditor — renders form (~902 tok)
- `page.tsx` — PropertyDetailPage (~691 tok)
- `snippet.tsx` — SnippetBlock (~253 tok)

## src/app/(dashboard)/dashboard/rights/[id]/

- `actions.tsx` — RightsRequestActions (~996 tok)
- `deletion-panel.tsx` — DeletionPanel — renders table (~1169 tok)
- `page.tsx` — RightsRequestDetailPage (~1327 tok)

## src/app/(public)/

- `layout.tsx` — PublicLayout (~46 tok)

## src/app/(public)/login/

- `page.tsx` — LoginPage — renders form (~1318 tok)

## src/app/(public)/privacy/[orgId]/

- `page.tsx` — Public privacy notice page — no auth required. Backed by rpc_get_privacy_notice (~707 tok)

## src/app/(public)/rights/[orgId]/

- `form.tsx` — RightsRequestForm — renders form (~2219 tok)
- `page.tsx` — RightsRequestPage (~434 tok)

## src/app/(public)/signup/

- `page.tsx` — SignupPage — renders form (~1707 tok)

## src/app/api/auth/signup/

- `route.ts` — Next.js API route: POST (~346 tok)

## src/app/api/orgs/[orgId]/audit-export/

- `route.ts` — ADR-0017 Phase 1: authenticated users in an org can download an (~1019 tok)

## src/app/api/orgs/[orgId]/banners/

- `route.ts` — Next.js API route: GET, POST (~1152 tok)

## src/app/api/orgs/[orgId]/banners/[bannerId]/

- `route.ts` — Next.js API route: GET, PATCH (~669 tok)

## src/app/api/orgs/[orgId]/banners/[bannerId]/publish/

- `route.ts` — Next.js API route: POST (~849 tok)

## src/app/api/orgs/[orgId]/billing/checkout/

- `route.ts` — Next.js API route: POST (~651 tok)

## src/app/api/orgs/[orgId]/integrations/

- `route.ts` — Next.js API route: GET, POST (~1445 tok)

## src/app/api/orgs/[orgId]/integrations/[id]/

- `route.ts` — Next.js API route: DELETE (~303 tok)

## src/app/api/orgs/[orgId]/inventory/

- `route.ts` — Next.js API route: GET, POST (~709 tok)

## src/app/api/orgs/[orgId]/inventory/[itemId]/

- `route.ts` — Next.js API route: PATCH, DELETE (~575 tok)

## src/app/api/orgs/[orgId]/properties/

- `route.ts` — Next.js API route: GET, POST (~780 tok)

## src/app/api/orgs/[orgId]/properties/[propertyId]/

- `route.ts` — Next.js API route: GET, PATCH (~602 tok)

## src/app/api/orgs/[orgId]/rights-requests/[id]/

- `route.ts` — Next.js API route: PATCH (~576 tok)

## src/app/api/orgs/[orgId]/rights-requests/[id]/events/

- `route.ts` — Next.js API route: POST (~414 tok)

## src/app/api/orgs/[orgId]/rights-requests/[id]/execute-deletion/

- `route.ts` — Next.js API route: POST (~574 tok)

## src/app/api/public/rights-request/

- `route.ts` — Next.js API route: POST (~958 tok)

## src/app/api/public/rights-request/verify-otp/

- `route.ts` — Next.js API route: POST (~794 tok)

## src/app/api/v1/deletion-receipts/[id]/

- `route.ts` — Public callback endpoint. Signature-verified, no auth required. State (~698 tok)

## src/app/api/webhooks/razorpay/

- `route.ts` — Next.js API route: POST (~858 tok)

## src/app/auth/callback/

- `route.ts` — Single post-signup / post-email-confirmation landing path. (~548 tok)

## src/components/

- `dashboard-nav.tsx` — navItems (~576 tok)
- `otp-boxes.tsx` — OtpBoxes (~345 tok)

## src/lib/billing/

- `gate.ts` — Check if the org is allowed to create one more of `resource`. (~338 tok)
- `plans.ts` — Billing plans config — single source of truth (~1096 tok)
- `razorpay.ts` — Razorpay API client (server-side) (~732 tok)

## src/lib/compliance/

- `privacy-notice.ts` — Privacy notice composition from org config + data inventory (~1794 tok)
- `score.ts` — Compliance score computation (~1025 tok)

## src/lib/encryption/

- `crypto.ts` — Per-org encryption utilities using pgcrypto via Supabase RPC. (~787 tok)

## src/lib/rights/

- `callback-signing.ts` — Signed callback URL utilities for deletion receipts. (~319 tok)
- `deletion-dispatch.ts` — Deletion orchestration — dispatches erasure to connectors and records (~3008 tok)
- `email.ts` — Resend client for rights request emails (~752 tok)
- `otp.ts` — OTP utilities for rights request email verification (~147 tok)
- `rate-limit.ts` — Exports checkRateLimit (~663 tok)
- `turnstile.ts` — Cloudflare Turnstile server-side verification. (~572 tok)

## src/lib/supabase/

- `browser.ts` — Exports createBrowserClient (~72 tok)
- `server.ts` — Exports createServerClient (~204 tok)

## supabase/

- `config.toml` — For detailed configuration reference documentation, visit: (~3910 tok)

## supabase/functions/check-stuck-deletions/

- `index.ts` — Supabase Edge Function: check-stuck-deletions (~2134 tok)

## supabase/functions/process-consent-event/

- `index.ts` — Supabase Edge Function: process-consent-event (~2459 tok)

## supabase/functions/run-consent-probes/

- `index.ts` — Supabase Edge Function: run-consent-probes (~2142 tok)

## supabase/functions/run-security-scans/

- `index.ts` — Supabase Edge Function: run-security-scans (~1741 tok)

## supabase/functions/send-sla-reminders/

- `index.ts` — Supabase Edge Function: send-sla-reminders (~1532 tok)

## supabase/functions/sync-admin-config-to-kv/

- `index.ts` — Supabase Edge Function: sync-admin-config-to-kv (~1104 tok)

## supabase/migrations/

- `20260413000001_extensions.sql` — Migration 001: Extensions (~104 tok)
- `20260413000002_helper_functions.sql` — Migration 002: Helper Functions (~510 tok)
- `20260413000003_operational_tables.sql` — Migration 003: Operational State Tables (Category A — permanent) (~3034 tok)
- `20260413000004_buffer_tables.sql` — Migration 004: Buffer Tables (Category B — transient, deliver then delete) (~2639 tok)
- `20260413000005_phase3_tables.sql` — Migration 005: Phase 3+ Tables (operational state) (~1238 tok)
- `20260413000006_rls_enable.sql` — Migration 006: Enable RLS on ALL tables (~591 tok)
- `20260413000007_rls_operational.sql` — Migration 007: RLS Policies — Operational Tables (org-scoped CRUD) (~1704 tok)
- `20260413000008_rls_buffer.sql` — Migration 008: RLS Policies — Buffer Tables (read-only for authenticated users) (~338 tok)
- `20260413000009_rls_special.sql` — Migration 009: RLS Policies — Special Cases (~218 tok)
- `20260413000010_scoped_roles.sql` — Migration 010: Scoped Database Roles (~1863 tok)
- `20260413000011_auth_role_restrictions.sql` — Migration 011: Authenticated Role Restrictions (~324 tok)
- `20260413000011_scoped_roles_set_option.sql` — Retro-fit to migration 010 (scoped_roles). PostgreSQL 16 separated the (~263 tok)
- `20260413000012_triggers.sql` — Migration 012: Triggers (~599 tok)
- `20260413000013_buffer_lifecycle.sql` — Migration 013: Buffer Lifecycle Functions (~1531 tok)
- `20260413000014_pg_cron.sql` — Migration 014: Scheduled Jobs (pg_cron) (~459 tok)
- `20260413000015_fix_stuck_buffers.sql` — Migration 015: Fix detect_stuck_buffers — consent_probe_runs uses run_at, not created_at (~508 tok)
- `20260414000001_rights_request_otp.sql` — Migration: Add OTP storage columns to rights_requests (~158 tok)
- `20260414000002_encryption_rpc.sql` — Migration: pgcrypto RPC helpers for per-org encryption (~287 tok)
- `20260414000003_origin_verified.sql` — ADR-0008 Sprint 1.2 (~233 tok)
- `20260414000004_rotate_signing_secrets.sql` — ADR-0008 Sprint 1.4 (~203 tok)
- `20260414000005_scoped_rpcs_public.sql` — ADR-0009 Sprint 1.1 — security-definer RPCs for public-surface buffer writes. (~2463 tok)
- `20260414000006_buffer_indexes_and_cleanup.sql` — Closes three blocking findings from the 2026-04-14 review: (~1036 tok)
- `20260414000007_scoped_rpcs_authenticated.sql` — ADR-0009 Sprint 2.1 + 3.1 — remaining scoped-role RPCs. (~3705 tok)
- `20260414000008_webhook_dedup_and_cron_secret.sql` — Closes S-3 and S-12 from the 2026-04-14 review. (~1161 tok)
- `20260414000009_cron_vault_secret.sql` — Replace the pg_cron jobs once more. Migration 008 switched from literal (~650 tok)
- `20260414000010_scoped_roles_rls_and_auth.sql` — Make the ADR-0009 security-definer RPCs actually work over the REST API. (~382 tok)
- `20260415000001_request_uid_helper.sql` — Supabase locks down the `auth` schema; even `postgres` can't grant USAGE (~1946 tok)
- `20260416000000_enable_pg_net.sql` — Enable pg_net so the cron HTTP jobs (stuck-buffer-detection-hourly, (~156 tok)
- `20260416000001_deletion_retry_state.sql` — ADR-0011 Sprint 1.1 — schema for the deletion retry / timeout pipeline. (~311 tok)
- `20260416000002_deletion_retry_cron.sql` — ADR-0011 Sprint 1.1 — schedule the hourly retry / timeout scan. (~246 tok)
- `20260416000004_unschedule_orphan_crons.sql` — Three cron jobs from migration 20260413000014 point at Edge Functions (~267 tok)
- `20260416000005_security_scan_cron.sql` — ADR-0015 Sprint 1.1 — re-schedule the nightly security posture scan. (~189 tok)
- `20260416000006_consent_probes_cron.sql` — ADR-0016 Sprint 1 — schedule the hourly consent-probe runner. (~194 tok)
- `20260416000007_audit_export.sql` — ADR-0017 Sprint 1.1 — Audit Export Package. (~1808 tok)
- `20260416000008_worker_errors_table.sql` — N-S1 fix from docs/reviews/2026-04-16-phase2-completion-review.md. (~536 tok)
- `20260416000009_cron_url_via_vault.sql` — N-S3 fix from docs/reviews/2026-04-16-phase2-completion-review.md. (~755 tok)
- `20260416000010_seed_supabase_url_vault.sql` — N-S3 follow-on: seed the `supabase_url` Vault secret that migration (~200 tok)
- `20260416000011_admin_schema.sql` — ADR-0027 Sprint 1.1 — Admin schema bootstrap. (~295 tok)
- `20260416000012_cs_admin_role.sql` — ADR-0027 Sprint 1.1 — cs_admin scoped role. (~559 tok)
- `20260416000013_admin_helpers.sql` — ADR-0027 Sprint 1.1 — Admin helper functions. (~790 tok)
- `20260416000014_admin_users.sql` — ADR-0027 Sprint 1.1 — admin.admin_users (ordered before admin_audit_log (~825 tok)
- `20260416000015_admin_audit_log.sql` — ADR-0027 Sprint 1.1 — admin.admin_audit_log (partitioned, append-only). (~1051 tok)
- `20260416000016_expose_admin_schema_postgrest.sql` — ADR-0027 Sprint 1.1 — expose the admin schema via PostgREST. (~244 tok)
- `20260416000017_reload_postgrest_schema.sql` — ADR-0027 Sprint 1.1 follow-up — nudge PostgREST to reload its schema cache. (~146 tok)
- `20260416000018_grant_admin_schema_usage_to_authenticated.sql` — ADR-0027 Sprint 1.1 follow-up — grant USAGE on schema admin to authenticated. (~211 tok)
- `20260417000001_admin_impersonation.sql` — ADR-0027 Sprint 2.1 — admin.impersonation_sessions + public.org_support_sessions. (~1065 tok)
- `20260417000002_admin_sectoral_templates.sql` — ADR-0027 Sprint 2.1 — admin.sectoral_templates + public.list_sectoral_templates_for_sector. (~792 tok)
- `20260417000003_admin_connector_catalogue.sql` — ADR-0027 Sprint 2.1 — admin.connector_catalogue + FK on public.integration_connectors. (~802 tok)
- `20260417000004_admin_tracker_signatures.sql` — ADR-0027 Sprint 2.1 — admin.tracker_signature_catalogue. (~905 tok)
- `20260417000005_admin_support_tickets.sql` — ADR-0027 Sprint 2.1 — admin.support_tickets + admin.support_ticket_messages. (~788 tok)
- `20260417000006_admin_org_notes.sql` — ADR-0027 Sprint 2.1 — admin.org_notes. (~337 tok)
- `20260417000007_admin_feature_flags.sql` — ADR-0027 Sprint 2.1 — admin.feature_flags + public.get_feature_flag. (~823 tok)
- `20260417000008_admin_kill_switches.sql` — ADR-0027 Sprint 2.1 — admin.kill_switches + 4 seed switches. (~732 tok)
- `20260417000009_admin_platform_metrics.sql` — ADR-0027 Sprint 2.1 — admin.platform_metrics_daily. (~395 tok)
- `20260417000010_admin_audit_log_impersonation_fk.sql` — ADR-0027 Sprint 2.1 — retrofit FK from admin.admin_audit_log.impersonation_session_id (~193 tok)
- `20260417000011_admin_rpcs.sql` — ADR-0027 Sprint 3.1 — admin RPCs (the audit-logging write surface). (~12753 tok)
- `20260417000011_public_orgs_status_settings.sql` — ADR-0027 Sprint 3.1 prerequisite — add public.organisations.status + settings. (~415 tok)
- `20260417000013_admin_pg_cron.sql` — ADR-0027 Sprint 3.1 — admin pg_cron jobs. (~906 tok)
- `20260417000015_admin_grants_service_role.sql` — ADR-0027 Sprint 3.1 follow-up — grant admin schema access to service_role. (~435 tok)
- `20260417000016_fix_add_org_note_return.sql` — ADR-0027 Sprint 3.1 follow-up — fix admin.add_org_note return path. (~343 tok)
- `20260417000017_admin_config_snapshot_rpc.sql` — ADR-0027 Sprint 3.2 — public.admin_config_snapshot() RPC. (~623 tok)
- `20260417000018_fix_admin_sync_cron.sql` — ADR-0027 Sprint 3.2 — fix admin-sync-config-to-kv bearer token. (~386 tok)
- `20260417000019_admin_cron_snapshot_rpc.sql` — ADR-0028 Sprint 2.1 — public.admin_cron_snapshot() RPC. (~476 tok)
- `20260417000020_admin_select_customer_tables.sql` — ADR-0029 Sprint 1.1 — admin SELECT-all RLS policies on public tables. (~792 tok)
- `20260417000021_admin_config_snapshot_v2.sql` — ADR-0029 Sprint 4.1 — extend public.admin_config_snapshot() with (~554 tok)
- `20260418000001_depa_helpers.sql` — ADR-0020 Sprint 1.1 — DEPA helper functions. (~1590 tok)
- `20260418000002_depa_purpose_definitions.sql` — ADR-0020 Sprint 1.1 — DEPA purpose_definitions table. (~986 tok)
- `20260418000003_depa_purpose_connector_mappings.sql` — ADR-0020 Sprint 1.1 — DEPA purpose_connector_mappings table. (~683 tok)
- `20260418000004_depa_consent_artefacts.sql` — ADR-0020 Sprint 1.1 — DEPA consent_artefacts table. (~1340 tok)
- `20260418000005_depa_artefact_revocations.sql` — ADR-0020 Sprint 1.1 — DEPA artefact_revocations table. (~1728 tok)
- `20260418000006_depa_consent_expiry_queue.sql` — ADR-0020 Sprint 1.1 — DEPA consent_expiry_queue table. (~1117 tok)
- `20260418000007_depa_compliance_metrics.sql` — ADR-0020 Sprint 1.1 — DEPA depa_compliance_metrics table. (~550 tok)
- `20260418000008_depa_alter_existing.sql` — ADR-0020 Sprint 1.1 — §11.3 ALTER TABLE amendments to existing tables. (~1206 tok)
- `20260418000009_depa_buffer_lifecycle.sql` — ADR-0020 Sprint 1.1 — DEPA buffer lifecycle additions. (~1124 tok)
- `20260419000001_depa_consent_event_dispatch.sql` — ADR-0021 Sprint 1.1 — consent-event dispatch trigger + safety-net cron. (~1768 tok)
- `20260421000001_customer_support_access.sql` — ADR-0032 Sprint 2.1 — customer-side access to admin.support_tickets. (~1190 tok)

## supabase/seed/

- `tracker_signatures.sql` — Tracker Signature Database — Initial Seed (~1811 tok)

## test-sites/

- `index.html` — ConsentShield Demo Sites (~631 tok)
- `vercel.json` (~15 tok)

## test-sites/blog/

- `index.html` — Notes from the Field — ConsentShield demo (~678 tok)

## test-sites/ecommerce/

- `index.html` — DemoShop — ConsentShield demo (~857 tok)

## test-sites/healthtech/

- `index.html` — MediCare — ConsentShield demo (~613 tok)

## test-sites/saas/

- `index.html` — DemoOps — ConsentShield demo (~783 tok)

## test-sites/shared/

- `demo.css` — Styles: 29 rules, 7 vars (~878 tok)

## test-sites/violator/

- `index.html` — Tracker Times — ConsentShield demo (~1016 tok)

## tests/admin/

- `audit_log.test.ts` — service: countAuditRows (~1832 tok)
- `foundation.test.ts` — Declares anon (~1516 tok)
- `helpers.ts` — Helpers for admin-side tests. Reuses the Supabase project + env vars (~969 tok)
- `rls.test.ts` — Declares adminOnlyTables (~1952 tok)
- `rpcs.test.ts` — service: rpc (~4104 tok)

## tests/buffer/

- `delivery.test.ts` — SUPABASE_URL: seedAuditRow (~1188 tok)
- `lifecycle.test.ts` — Migration 011 (20260413000011) revokes UPDATE and DELETE on all buffer (~999 tok)

## tests/depa/

- `consent-event-pipeline.test.ts` — ADR-0021 Sprint 1.1 — process-consent-event pipeline integration tests. (~3428 tok)

## tests/fixtures/

- `banner-test.html` — ConsentShield Banner Test (~895 tok)

## tests/rights/

- `connectors.test.ts` — ORG_ID: mockFetch, supabaseStub (~2065 tok)
- `rate-limit.test.ts` — Declares loadModule (~574 tok)

## tests/rls/

- `depa-isolation.test.ts` — ADR-0020 Sprint 1.1 — DEPA RLS isolation tests. (~3131 tok)
- `helpers.ts` — Exports getServiceClient, getAnonClient, TestOrg, createTestOrg + 3 more (~951 tok)
- `isolation.test.ts` — Declares admin (~2328 tok)
- `url-path.test.ts` — S-2 from the 2026-04-14 codebase review: authenticated API routes (~856 tok)

## tests/worker/

- `banner.test.ts` — API routes: GET (3 endpoints) (~788 tok)
- `events.test.ts` — ORG_ID: postEvent (~1661 tok)
- `harness.ts` — API routes: GET (2 endpoints) (~1827 tok)

## tests/workflows/

- `sla-timer.test.ts` — SUPABASE_URL: insertWithCreatedAt, addThirtyDaysMs, epoch (~1222 tok)

## worker/

- `package.json` — Node.js package manifest (~67 tok)
- `tsconfig.json` — TypeScript configuration (~105 tok)
- `wrangler.toml` (~95 tok)

## worker/src/

- `admin-config.ts` — Typed accessors over the admin config snapshot materialised to KV by (~1363 tok)
- `banner.ts` — API routes: GET (2 endpoints) (~4104 tok)
- `events.ts` — API routes: GET (2 endpoints) (~1421 tok)
- `hmac.ts` — HMAC-SHA256 utilities — Web Crypto API only, zero dependencies (~457 tok)
- `index.ts` — Exports Env (~414 tok)
- `observations.ts` — Exports handleObservation (~1123 tok)
- `origin.ts` — API routes: GET (3 endpoints) (~761 tok)
- `signatures.ts` — Exports TrackerSignature, getTrackerSignatures, compactSignatures (~751 tok)
- `worker-errors.ts` — N-S1 fix: persist Worker → Supabase write failures to the worker_errors (~422 tok)
