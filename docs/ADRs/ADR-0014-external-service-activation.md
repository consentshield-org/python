# ADR-0014: External Service Activation (Resend / Turnstile / Razorpay)

**Status:** In Progress
**Date proposed:** 2026-04-16
**Date completed:** —
**Superseded by:** —

---

## Context

ConsentShield's three external integrations are all running on
test/placeholder credentials:

- **Resend:** Domain verified and delivering, but the code still has
  an `onboarding@resend.dev` fallback that would mask a missing
  `RESEND_FROM`. Remove the fallback so a misconfigured deploy fails
  loudly.
- **Cloudflare Turnstile:** The rights portal embeds Cloudflare's
  always-pass test site key (`1x00000000000000000000AA`). The server
  uses the matching always-pass secret. A bot can submit unlimited
  rights requests. Create a production Turnstile widget and deploy
  real keys.
- **Razorpay:** No account exists. `RAZORPAY_KEY_ID` /
  `RAZORPAY_KEY_SECRET` are unset. The billing page 500s on checkout.
  Create a test-mode Razorpay account, create the four subscription
  plans matching `src/lib/billing/plans.ts`, and wire up the webhook.

## Decision

A single ops-sprint that activates all three services. Code changes
are minimal (Resend fallback removal). The rest is external-dashboard
configuration + Vercel env-var updates.

## Consequences

- OTP emails will deliver to any inbox, not just the Resend account
  owner's email.
- The rights portal will require real Turnstile verification — bots
  are blocked.
- The billing page will complete a checkout flow end-to-end (in
  Razorpay test mode).
- Dev-only fallbacks for Turnstile (always-pass test key) remain in
  the code for local development; they throw in `NODE_ENV=production`.

---

## Implementation Plan

### Sprint 1: Activate all three services

**Estimated effort:** ~half a day (ops-heavy)

**Deliverables:**

#### Resend (code change)
- [x] Remove `|| 'onboarding@resend.dev'` fallback in
      `src/lib/rights/email.ts`. Add a throw when `RESEND_FROM` is
      unset, matching the Turnstile pattern.

#### Turnstile (user-driven)
- [ ] Cloudflare Dashboard → Turnstile → Add Site.
      Domain: `consentshield-one.vercel.app` (add any custom domain
      later). Widget mode: Managed. Copy site key + secret key.
- [ ] Vercel Dashboard → consentshield → Settings → Environment
      Variables. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (production +
      preview) and `TURNSTILE_SECRET_KEY` (production + preview).
- [ ] Redeploy the admin app (`vercel deploy --prod` or push to
      main). The NEXT_PUBLIC_ key is baked at build time.
- [ ] Verify: visit `/rights/<demo-org>`, submit without solving →
      should fail with 403.

#### Razorpay (user-driven)
- [ ] Create a Razorpay account at `dashboard.razorpay.com`.
      Enable Test Mode.
- [ ] Dashboard → Settings → API Keys → Generate Key. Copy
      `key_id` + `key_secret`.
- [ ] Dashboard → Subscriptions → Plans → Create four plans:
      | Plan | Amount (INR/month) | Period | Interval |
      |------|--------------------|--------|----------|
      | CS Starter   | 2999  | monthly | 1 |
      | CS Growth    | 5999  | monthly | 1 |
      | CS Pro       | 9999  | monthly | 1 |
      | CS Enterprise| 24999 | monthly | 1 |
      Copy each plan's `plan_id`.
- [ ] Dashboard → Webhooks → Add New Webhook.
      URL: `https://consentshield-one.vercel.app/api/webhooks/razorpay`
      Events: `subscription.activated`, `subscription.charged`,
      `subscription.cancelled`, `subscription.completed`.
      Copy the webhook secret.
- [ ] Vercel env vars (production + preview):
      `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
      `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_STARTER`,
      `RAZORPAY_PLAN_GROWTH`, `RAZORPAY_PLAN_PRO`,
      `RAZORPAY_PLAN_ENTERPRISE`.
- [ ] Redeploy. Test: dashboard → Billing → upgrade to Starter →
      Razorpay checkout page loads → complete with test card
      `4111 1111 1111 1111` → webhook fires → org plan updates.

**Testing plan:**
- [x] `bun run build` + `bun run lint` + `bun run test` — clean.
- [ ] OTP email to a non-owner inbox — arrives.
- [ ] Rights form submission without Turnstile → 403.
- [ ] Billing checkout end-to-end (Razorpay test card) → org.plan
      updates.

**Status:** `[~] in progress`

---

## Architecture Changes

None. All integrations are already wired in code; this ADR activates
them with real credentials.

---

## Test Results

### Sprint 1 — [pending]

---

## Changelog References

- CHANGELOG-api.md — 2026-04-16 — ADR-0014 Resend fallback removal
