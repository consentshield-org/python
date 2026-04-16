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
| ADR-0014 | External Service Activation (Resend / Turnstile / Razorpay) | In Progress | 2026-04-16 | 1 | 1 |

<!--
When adding a new ADR:
1. Assign the next sequential number
2. Add a row to this table
3. Keep status updated as work progresses
-->
