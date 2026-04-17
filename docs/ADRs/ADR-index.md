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
| ADR-0019 | DEPA Roadmap — Charter & Sequencing of ADR-0020..0025 (meta-ADR, no code) | Proposed | 2026-04-17 | — | — |
| ADR-0020 | DEPA Schema Skeleton (6 new tables + §11.3 ALTERs + helpers + non-dispatch triggers + shared types) | Completed | 2026-04-17 | 1 | 1 |
| ADR-0021 | `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron | Completed | 2026-04-17 | 1 | 1 |
| ADR-0022 | `process-artefact-revocation` Edge Function + Revocation Dispatch | Proposed | 2026-04-17 | 1 | 4 |
| ADR-0026 | Monorepo Restructure (Bun workspace — `app/` + `admin/` + `packages/*`) | In Progress | 2026-04-16 | 4 | 4 |
| ADR-0027 | Admin Platform Schema (`cs_admin` role + `admin.*` tables + audit log + impersonation) | Completed | 2026-04-17 | 4 | 5 |
| ADR-0028 | Admin App Foundation (real OTP auth + Operations Dashboard + Audit Log viewer) | Completed | 2026-04-17 | 3 | 3 |
| ADR-0029 | Admin Organisations (list + detail + actions + impersonation + customer-side cross-refs) | Completed | 2026-04-17 | 4 | 4 |
| ADR-0030 | Sectoral Templates (admin panel + customer-side read) | In Progress | 2026-04-17 | 3 | 3 |
| ADR-0032 | Support Tickets (admin panel + customer-side submit) | In Progress | 2026-04-17 | 2 | 2 |
| ADR-0036 | Feature Flags & Kill Switches (admin panel) | Completed | 2026-04-17 | 1 | 1 |

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
