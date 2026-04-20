# ADR Index

All Architecture Decision Records for ConsentShield, in chronological order.

| ADR | Title | Status | Date | Phases | Sprints |
|-----|-------|--------|------|--------|---------|
| ADR-0001 | Project Scaffolding — Next.js, Supabase Schema, Auth, Worker Skeleton | Completed | 2026-04-13 | 3 | 7 |
| ADR-0002 | Worker HMAC Verification + Origin Validation | Completed | 2026-04-13 | 1 | 3 |
| ADR-0003 | Consent Banner Builder + Compliance Dashboard | Completed | 2026-04-14 | 2 | 5 |
| ADR-0004 | Rights Request Workflow (Turnstile + OTP + Dashboard Inbox) | Completed | 2026-04-14 | 2 | 4 |
| ADR-0005 | Tracker Monitoring (Banner Script v2 with MutationObserver) | Completed | 2026-04-14 | 1 | 3 |
| ADR-0006 | Razorpay Billing + Plan Gating | Completed | 2026-04-14 | 1 | 3 |
| ADR-0007 | Deletion Orchestration (Generic Webhook Protocol) | Completed | 2026-04-14 | 1 | 3 |
| ADR-0008 | Browser Auth Hardening (Remove Client Signing Secret, origin_verified, Fail-Fast Turnstile) | Completed | 2026-04-14 | 1 | 4 |
| ADR-0009 | Scoped-Role Enforcement in REST Paths | Completed | 2026-04-14 | 3 | 3 |
| ADR-0010 | Distributed Rate Limiter for Public Rights-Request Endpoints | Completed | 2026-04-16 | 1 | 1 |
| ADR-0011 | Deletion Retry and Timeout for Stuck Callbacks (hourly Edge Function + 1h/6h/24h backoff) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0012 | Automated Test Suites for High-Risk Paths (SLA trigger, URL-path RLS, Worker, buffer pipeline) | Completed | 2026-04-16 | 1 | 3 |
| ADR-0013 | Signup Bootstrap Hardening (OTP signup + login, single `/auth/callback` path) | Completed | 2026-04-15 | 1 | 2 |
| ADR-0014 | External Service Activation (Resend / Turnstile / Razorpay) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0015 | Security Posture Scanner (run-security-scans Edge Function + dashboard) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0016 | Consent Probes v1 (static HTML analysis; run-consent-probes Edge Function + dashboard) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0017 | Audit Export Package (Phase 1: direct-download ZIP; R2 upload → V2-X3) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0018 | Pre-built Deletion Connectors (Mailchimp + HubSpot via API key; OAuth → V2-C1) | Completed | 2026-04-16 | 1 | 1 |
| ADR-0019 | DEPA Roadmap — Charter & Sequencing of ADR-0020..0025 (meta-ADR, no code) | Completed | 2026-04-18 | — | — | _(all child ADRs 0020/0021/0022/0023/0024/0025/0037 shipped)_ |
| ADR-0020 | DEPA Schema Skeleton (6 new tables + §11.3 ALTERs + helpers + non-dispatch triggers + shared types) | Completed | 2026-04-17 | 1 | 1 |
| ADR-0021 | `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron | Completed | 2026-04-17 | 1 | 1 |
| ADR-0022 | `process-artefact-revocation` Edge Function + Revocation Dispatch | Completed | 2026-04-17 | 1 | 4 |
| ADR-0023 | DEPA Expiry Pipeline (`send_expiry_alerts` + `enforce_artefact_expiry` + pg_cron) | Completed | 2026-04-17 | 1 | 2 |
| ADR-0024 | DEPA Customer UI Rollup (Purposes + Artefacts + Dashboard tile + Rights reshape + Settings row) | Completed | 2026-04-17 | 1 | 4 |
| ADR-0025 | DEPA Score Dimension — nightly refresh + API + dashboard gauge | Completed | 2026-04-17 | 1 | 2 |
| ADR-0026 | Monorepo Restructure (Bun workspace — `app/` + `admin/` + `packages/*`) | In Progress | 2026-04-16 | 4 | 4 |
| ADR-0027 | Admin Platform Schema (`cs_admin` role + `admin.*` tables + audit log + impersonation) | Completed | 2026-04-17 | 4 | 5 |
| ADR-0028 | Admin App Foundation (real OTP auth + Operations Dashboard + Audit Log viewer) | Completed | 2026-04-17 | 3 | 3 |
| ADR-0029 | Admin Organisations (list + detail + actions + impersonation + customer-side cross-refs) | Completed | 2026-04-17 | 4 | 4 |
| ADR-0030 | Sectoral Templates (admin panel + customer-side read) | Completed | 2026-04-17 | 3 | 3 |
| ADR-0032 | Support Tickets (admin panel + customer-side submit) | Completed | 2026-04-17 | 2 | 2 |
| ADR-0036 | Feature Flags & Kill Switches (admin panel) | Completed | 2026-04-17 | 1 | 1 |
| ADR-0037 | DEPA Completion (expiry fan-out + per-requestor binding + CSV + Audit DEPA + Onboarding seed pack) | Completed | 2026-04-17 | 1 | 5 |
| ADR-0038 | Operational Observability (cron failure watchdog + stuck-buffer Edge Function) | Completed | 2026-04-17 | 1 | 3 |
| ADR-0040 | Audit R2 Upload Pipeline (sigv4 + export_configurations UI + delivery-target branch) | Completed | 2026-04-17 | 1 | 4 |
| ADR-0042 | Signup Idempotency Regression Test (ensureOrgBootstrap helper + unit test) | Completed | 2026-04-17 | 1 | 1 |
| ADR-0041 | Probes v2 (Vercel Sandbox runner + probe CRUD UI) | Completed | 2026-04-17 | 1 | 5 |
| ADR-0039 | Connector OAuth (Mailchimp + HubSpot) | Completed | 2026-04-17 | 1 | 3 |
| ADR-0031 | Connector Catalogue + Tracker Signature Catalogue (admin panels) | Completed | 2026-04-17 | 2 | 4 |
| ADR-0033 | Admin Ops + Security — Pipeline Operations + Abuse & Security panels (folds ADR-0035) | Completed | 2026-04-17 | 2 | 5 |
| ADR-0034 | Admin Billing Operations — Razorpay failures + refunds + comps + plan overrides | Completed | 2026-04-18 | 2 | 3 |
| ADR-0035 | Abuse & Security admin panel | Abandoned | 2026-04-17 | — | — | _(folded into ADR-0033; see its context)_ |
| ADR-0043 | Customer App is Auth-Only (drop public landing; marketing site becomes www.consentshield.in) | Completed | 2026-04-17 | 1 | 1 |
| ADR-0044 | Customer RBAC — 4-level hierarchy (account → orgs → web properties) + 5-role model + invitation-only signup | Completed | 2026-04-18 | 3 | 7 |
| ADR-0045 | Admin user lifecycle (invite + role change + disable) | Completed | 2026-04-18 | 2 | 3 |
| ADR-0046 | Significant Data Fiduciary foundation — sdf_status on organisations + DPIA records + auditor engagements | In Progress | 2026-04-18 | 4 | 5 |
| ADR-0047 | Customer membership lifecycle (role change + remove) + membership_audit_log + single-account-per-identity invariant | Completed | 2026-04-18 | 1 | 2 |
| ADR-0048 | Admin Accounts panel + ADR-0033/34 deviation closeout (suspend_account / account picker / Worker HMAC+Origin logging) | Completed | 2026-04-18 | 2 | 3 |
| ADR-0049 | Security observability ingestion — rate_limit_events + sentry_events (closes V2-S1/S2) | Completed | 2026-04-18 | 2 | 4 |
| ADR-0050 | Admin account-aware billing — issuer entities + invoices + GST + dispute workspace | Completed | 2026-04-20 | 3 | 6 |
| ADR-1001 | v2 Whitepaper Phase 1 — Truth-in-marketing + Public API foundation (`cs_live_*` keys + Bearer middleware) | In Progress | 2026-04-19 | 3 | 7 |
| ADR-1002 | v2 Whitepaper Phase 2 — DPDP §6 runtime enforcement (`/v1/consent/verify` + `record` + artefact ops + deletion API) | Proposed | 2026-04-19 | 5 | 7 |
| ADR-1003 | v2 Whitepaper Phase 3 — Processor posture (`storage_mode` enforcement + BYOS + Zero-Storage + Healthcare seed + sandbox) | Proposed | 2026-04-19 | 5 | 8 |
| ADR-1004 | v2 Whitepaper Phase 4 — Statutory retention (Regulatory Exemption Engine) + material-change re-consent + silent-failure detection | Proposed | 2026-04-19 | 3 | 9 |
| ADR-1005 | v2 Whitepaper Phase 5 — Operations maturity (webhook reference, test_delete, support model, status page, rights API, non-email channels) | Proposed | 2026-04-19 | 6 | 10 |
| ADR-1006 | v2 Whitepaper Phase 6 — Developer experience (Node/Python/Java/Go client libraries + OpenAPI + CI drift check) | Proposed | 2026-04-19 | 4 | 7 |
| ADR-1007 | v2 Whitepaper Phase 7 — Connector ecosystem expansion (CleverTap, Razorpay, WebEngage/MoEngage, Intercom/Freshdesk, Shopify/WooCommerce, Segment) + WordPress + Shopify plugins | Proposed | 2026-04-19 | 3 | 9 |
| ADR-1008 | v2 Whitepaper Phase 8 — Scale + audit polish + P3 hardening (load tests, verify SLO, audit CSV, tracker corpus, multi-channel re-consent, HMAC rotation, SOC 2, React Native, WYSIWYG decision) | Proposed | 2026-04-19 | 3 | 10 |

<!--
When adding a new ADR:
1. Assign the next sequential number
2. Add a row to this table
3. Keep status updated as work progresses

ADR-0019 is the DEPA roadmap charter (authored 2026-04-17, Proposed).
ADR-0020..0025 execute the charter: schema skeleton, process-consent-event,
process-artefact-revocation, expiry pipeline, purpose-definition admin UI,
DEPA score. Pending.
ADR-0026..0036 are reserved for the admin platform roadmap (monorepo,
admin schema, then per-panel admin ADRs).
-->
