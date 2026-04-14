# ADR-0006: Razorpay Billing + Plan Gating

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date proposed:** 2026-04-14
**Date completed:** —

---

## Context

Every customer signs up on the `trial` plan (14-day trial, set on `organisations.plan`). To generate revenue, we need:

1. A checkout flow using Razorpay (INR subscriptions)
2. A webhook handler that upgrades the org's plan on payment
3. Plan gating: Starter = 1 property, Growth = 3, Pro = 10, Enterprise = unlimited

The `organisations` table already has `plan`, `razorpay_subscription_id`, `razorpay_customer_id` columns. `cs_orchestrator` has UPDATE grants on these columns.

## Decision

Build the billing flow per definitive architecture Section 5 (pricing) and Section 10.1:

1. **Plans config** in code (Starter ₹2,999, Growth ₹5,999, Pro ₹9,999, Enterprise ₹24,999+)
2. **Razorpay Subscription** (pre-created in Razorpay dashboard, plan ID referenced)
3. **Checkout** via Razorpay's JavaScript SDK (client-side, payment handled by Razorpay)
4. **Webhook** at `/api/webhooks/razorpay` — HMAC-verified, updates org plan
5. **Plan gating** as a server-side utility + middleware check

## Consequences

After this ADR:
- Customers can upgrade from trial to any paid plan
- Payment captured in INR via Razorpay
- Plans auto-enforce limits (property count etc.)
- Annual upfront = 20% discount (2 months free)

---

## Implementation Plan

### Phase 1: Checkout + Webhook

#### Sprint 1.1: Plans Config + Billing UI
**Estimated effort:** 3–4 hours
**Deliverables:**
- [ ] src/lib/billing/plans.ts — plan definitions with limits and Razorpay plan IDs
- [ ] /dashboard/billing — current plan card, usage vs limits, upgrade options
- [ ] Plan comparison grid (Starter/Growth/Pro/Enterprise)
- [ ] Trial countdown banner if plan='trial' (days left based on trial_ends_at)

**Testing plan:**
- [ ] Billing page loads with current plan
- [ ] Shows correct usage numbers (property count, etc.)
- [ ] Trial expiry warning appears < 7 days left

**Status:** `[ ] planned`

#### Sprint 1.2: Razorpay Checkout Flow
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] POST /api/orgs/[orgId]/billing/checkout — creates Razorpay subscription
- [ ] Returns Razorpay subscription_id and checkout config
- [ ] Client opens Razorpay checkout modal
- [ ] On success: redirect to /dashboard/billing?status=pending
- [ ] Plan change stays 'trial' until webhook confirms

**Testing plan:**
- [ ] Checkout creates subscription in Razorpay test mode
- [ ] Payment success → webhook fires (verified in Sprint 1.3)
- [ ] Checkout failure → org stays on trial

**Status:** `[ ] planned`

#### Sprint 1.3: Webhook Handler + Plan Gating
**Estimated effort:** 4–5 hours
**Deliverables:**
- [ ] POST /api/webhooks/razorpay — HMAC-verified via RAZORPAY_WEBHOOK_SECRET
- [ ] Handles events: subscription.activated, subscription.charged, subscription.cancelled, subscription.paused, payment.failed
- [ ] Updates organisations.plan, plan_started_at, razorpay_subscription_id via cs_orchestrator
- [ ] Writes audit_log entry for every plan change
- [ ] src/lib/billing/gate.ts — `checkPlanLimit(orgId, resource)` utility
- [ ] Property creation API enforces limit per plan
- [ ] Banner creation API enforces limit per plan (via property count)
- [ ] Dashboard shows gating errors clearly ("Upgrade to add another property")

**Testing plan:**
- [ ] Webhook with invalid signature → 403
- [ ] Webhook with valid signature → plan updated, audit log written
- [ ] Starter org creating 2nd property → 403 "plan limit"
- [ ] Cancellation event → plan downgraded to 'trial', dunning email sent

**Status:** `[ ] planned`

---

## Architecture Changes

_None — uses existing organisations columns and cs_orchestrator grants._

---

## Test Results

_Pending_

---

## Changelog References

- CHANGELOG-api.md (billing + webhooks), CHANGELOG-dashboard.md
