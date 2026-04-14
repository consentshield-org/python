# ADR-0004: Rights Request Workflow (Turnstile + OTP + Dashboard Inbox)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-14
**Date completed:** 2026-04-14

---

## Context

DPDP 2023 Sections 11–14 give Data Principals the right to erasure, access, correction, and nomination. Customers need a public-facing form for their users to submit these requests, a verified + spam-protected intake, and a dashboard workflow to action them within 30 days.

Current state: the `rights_requests` table exists with `turnstile_verified`, `email_verified`, `sla_deadline` columns. RLS allows public INSERT. But no form, no OTP flow, no workflow, no SLA reminders.

## Decision

Build the full rights request lifecycle per the definitive architecture Section 10.1:

1. **Public rights request form** at `/rights/[orgId]` (no auth, with Turnstile)
2. **Email OTP verification** before notifying the compliance contact
3. **Dashboard inbox** with workflow (identity verification, response drafting, closure)
4. **SLA reminders** via Edge Function on pg_cron schedule

## Consequences

After this ADR:
- Customers can publish a branded rights request link to their Data Principals
- Spam-resistant intake (Turnstile + OTP)
- 30-day SLA is tracked automatically
- Compliance contact only gets notified after email verification
- Edge Function fires 7-day and 1-day reminders before overdue

---

## Implementation Plan

### Phase 1: Public Intake

#### Sprint 1.1: Public Rights Request API with Turnstile
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] POST /api/public/rights-request (no auth, rate-limited 5/IP/hour)
- [ ] Cloudflare Turnstile token verification server-side
- [ ] Creates rights_requests row with turnstile_verified=true, email_verified=false
- [ ] Generates 6-digit OTP, sends via Resend
- [ ] OTP stored in a short-lived KV/table (15-minute TTL)
- [ ] Public form page at /rights/[orgId]

**Testing plan:**
- [ ] Submit without Turnstile token → 403
- [ ] Submit with valid Turnstile → row created, OTP sent
- [ ] Rate limit: 6 submissions from same IP/hour → 6th gets 429
- [ ] Compliance contact does NOT receive notification yet

**Status:** `[x] complete`

#### Sprint 1.2: OTP Verification + Compliance Notification
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] POST /api/public/rights-request/verify-otp — verifies code
- [ ] Sets email_verified=true, email_verified_at
- [ ] Sends notification email to org's compliance_contact_email
- [ ] Appends rights_request_events entry (event_type='created')
- [ ] OTP resend endpoint with rate limit
- [ ] Cleanup job: delete unverified rows > 24 hours old

**Testing plan:**
- [ ] Correct OTP → email_verified=true, compliance contact notified
- [ ] Wrong OTP 5 times → locked out
- [ ] Expired OTP (>15 min) → rejected
- [ ] Unverified row after 24h → auto-deleted

**Status:** `[x] complete`

### Phase 2: Workflow

#### Sprint 2.1: Dashboard Rights Inbox
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] /dashboard/rights — list with filter (new, in_progress, completed), SLA countdown per row
- [ ] /dashboard/rights/[id] — detail view with workflow steps
- [ ] PATCH /api/orgs/[orgId]/rights-requests/[id] — status, assignee, identity
- [ ] POST /api/orgs/[orgId]/rights-requests/[id]/events — append audit trail
- [ ] Actions: assign, verify identity, draft response, send, close

**Testing plan:**
- [ ] New request appears in inbox within seconds of OTP verification
- [ ] Status transitions logged in rights_request_events
- [ ] RLS: only own org's requests visible

**Status:** `[x] complete`

#### Sprint 2.2: SLA Reminders Edge Function
**Estimated effort:** 2–3 hours
**Deliverables:**
- [ ] Supabase Edge Function `send-sla-reminders` (already scheduled via pg_cron)
- [ ] Finds requests with sla_deadline - 7 days and - 1 day
- [ ] Sends email via Resend
- [ ] Appends rights_request_events (event_type='sla_warning_sent')
- [ ] Deduplicates: one reminder per request per threshold

**Testing plan:**
- [ ] Request 24 days old (6 left) → no reminder
- [ ] Request 23 days old (7 left) → 7-day warning sent
- [ ] Request 29 days old (1 left) → 1-day warning sent
- [ ] Request 31 days old → overdue alert

**Status:** `[x] complete`

---

## Architecture Changes

_None — implements existing Section 10.1._

---

## Test Results

_Pending_

---

## Changelog References

- CHANGELOG-api.md, CHANGELOG-dashboard.md, CHANGELOG-edge-functions.md
