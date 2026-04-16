# Session Handoff

**Last Updated:** 2026-04-16 12:08

## Current State

**Phase 2 COMPLETE.** All **18 ADRs (0001–0018) Completed** and pushed. Test suite **86/86**. No in-progress work.

| ADR | Status |
|-----|--------|
| 0001 Project Scaffolding | Completed |
| 0002 Worker HMAC + Origin + Secret Rotation | Completed |
| 0003 Banner Builder + Dashboard + Inventory + Privacy Notice | Completed |
| 0004 Rights Request Workflow (Turnstile + OTP + SLA) | Completed |
| 0005 Tracker Monitoring (banner v2 + 34 signatures) | Completed |
| 0006 Razorpay Billing + Plan Gating | Completed |
| 0007 Deletion Orchestration (webhook protocol) | Completed |
| 0008 Browser Auth Hardening | Completed |
| 0009 Scoped-Role Enforcement in REST Paths | Completed |
| 0010 Distributed Rate Limiter (Upstash via Vercel Marketplace) | Completed |
| 0011 Deletion Retry / Timeout | Completed |
| 0012 Automated Test Suites (Sprints 1 + 2 + 3) | Completed |
| 0013 Signup Bootstrap Hardening (OTP-only) | Completed |
| 0014 External Service Activation (Turnstile + Razorpay + Resend) | Completed |
| 0015 Security Posture Scanner | Completed |
| 0016 Consent Probes v1 (static HTML analysis) | Completed |
| 0017 Audit Export Package Phase 1 (direct-download ZIP) | Completed |
| 0018 Pre-built Deletion Connectors (Mailchimp + HubSpot) | Completed |

## Live Deployments

- **Admin app:** `https://consentshield-one.vercel.app`
- **Demo customer sites:** `https://consentshield-demo.vercel.app`
- **Worker CDN:** `https://cdn.consentshield.in/v1/*`
- **Supabase:** `xlqiakmkdjycfiioslgs`
- **Upstash Redis:** `upstash-kv-citrine-blanket` (Vercel Marketplace)
- **Edge Functions** (4, all `--no-verify-jwt`): `send-sla-reminders`, `check-stuck-deletions`, `run-security-scans`, `run-consent-probes`
- **pg_cron:** 6 jobs active, all green

## Git State

Latest commit: `c83831e` — `feat(ADR-0018): pre-built connectors — Mailchimp + HubSpot direct API` (pushed to main).
27 migrations applied, through `20260416000007_audit_export.sql`.

## Where to Pick Up

Phase 2 is done. The next step — per the user's 2026-04-16 plan — is a
**post-Phase-2 review**:

1. Walk the existing code end-to-end.
2. Pick **2–3 architecture decision points** from `docs/V2-BACKLOG.md` to graduate into the next phase's ADRs.
3. Close or down-grade the rest.

Do not pull items from `docs/V2-BACKLOG.md` mid-phase — the rule is codified in CLAUDE.md under the ADR workflow section.

## V2 Backlog (11 entries)

| ID | Origin | What |
|---|---|---|
| V2-T1 | ADR-0013 | Signup idempotency regression test (needs Next-route harness) |
| V2-X1 | ADR-0014 | Vercel Preview env vars (CLI per-branch quirk) |
| V2-X2 | ADR-0014 | Razorpay end-to-end checkout UX smoke |
| V2-X3 | ADR-0017 | Audit-export R2 upload pipeline |
| V2-P1 | ADR-0016 | Headless-browser probe runner |
| V2-P2 | ADR-0016 | Probe CRUD UI |
| V2-O1 | Sprint-4 cleanup | Unbuilt cron-slot Edge Functions (stuck-buffer + retention-check) |
| V2-O2 | Session handoff | Vercel Deployment Protection |
| V2-O3 | ADR-0011 discovery | pg_cron failure-detection watchdog |
| V2-K1 | Edge Fn gateway | Remove `--no-verify-jwt` once Supabase supports `sb_secret_*` keys at gateway |
| V2-C1 | ADR-0018 | OAuth flow for pre-built connectors |

## Out-of-Phase (Phase 3+)

- Continuous buffer-delivery-to-R2 pipeline (prerequisite for V2-X3).
- GDPR dual-framework (multi-sprint, schema-wide).
- ABDM module (healthcare; never persists FHIR per rule #3).

## Reference Docs

- `docs/STATUS.md` — high-level state snapshot
- `docs/V2-BACKLOG.md` — **review starting point**
- `docs/ROADMAP-phase2.md` — Sprints 1–11 with deliverables (all done)
- `docs/ops/supabase-auth-templates.md` — OTP templates to paste into Supabase Dashboard before enabling password-reset / email-change flows
- `docs/reviews/2026-04-14-codebase-architecture-review.md` — Phase-1 codebase review (all blockers closed)
- `session-context/context-2026-04-16-12-08-11.md` — this session's full timeline (loose-ends → Sprint 11)
- `session-context/context-2026-04-16-07-01-59.md` — earlier checkpoint inside the same day
