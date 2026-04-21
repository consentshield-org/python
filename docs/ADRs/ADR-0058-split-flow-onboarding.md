# ADR-0058 — Split-flow customer onboarding

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress (Sprint 1.1 in flight)
**Date:** 2026-04-21
**Phases:** 1
**Sprints:** 5

**Depends on:** ADR-0044 (invite-gated signup + RBAC), ADR-0047 (membership lifecycle + single-account-per-identity), ADR-0030 + ADR-0037 (sectoral templates + W9 purpose-definition materialisation), ADR-0025 (DEPA score), ADR-0045 (admin user lifecycle), ADR-0501 Sprint 4.2 (marketing Turnstile + Resend pattern).

## Context

ConsentShield has a 7-step onboarding wireframe (`docs/design/screen designs and ux/consentshield-screens.html`, `#panel-onboarding` + `obSteps` array ~line 2247) that was never built as a wizard. ADR-0030 closed out noting *"The full 7-step onboarding wireframe wasn't built — only the template-picker step. Full onboarding is deferred (V2 backlog if ever)."* That deferral has hit the ceiling now that the marketing site ships.

Meanwhile ADR-0044 Phase 2.2 disabled walk-up signup on the customer app (invite-only). The wireframe's Step 1 ("email or Google OAuth + 14-day trial") contradicts that policy, so the wizard as drawn cannot run on the customer app as-is.

## Decision

**Split the flow.** The marketing site (`consentshield.in`) does plan intake — visitor enters email + company + plan; Turnstile-gated; cross-origin POST to a public customer-app endpoint that creates a row in the existing `public.invitations` table (no new intake table needed). The same trigger-driven dispatch pipeline that powers operator invites fires a Resend email with a token link to `app.consentshield.in/onboarding?token=<X>`. The customer-app `/onboarding` route runs the 7-step wizard, validates + consumes the token (= email verification = account creation = trial clock starts), and walks the user to a fully-configured org.

Operators get a parallel path on the admin console (Accounts → "Invite new account") that creates the same shape of invitation row with `origin='operator_intake'`, lands the user in the same wizard. Marketing-self-serve and operator-intake are functionally identical at the DB layer; `origin` is a hint that drives email copy + analytics labelling.

### Architecture

```
┌─────────────────────────────────┐
│  consentshield.in/pricing       │
│  ↓ (CTA per tier)               │
│  consentshield.in/signup        │
│  ↓ (form submit, Turnstile)     │
└──────────────┬──────────────────┘
               │ CORS POST
               ▼
┌──────────────────────────────────┐    ┌──────────────────────────────────┐
│ app.consentshield.in/api/        │    │ admin.consentshield.in/          │
│   public/signup-intake           │    │   accounts → "Invite new account"│
└──────────┬───────────────────────┘    └──────────┬───────────────────────┘
           │                                        │
           ▼                                        ▼
  create_signup_intake RPC             admin.create_operator_intake RPC
  (origin='marketing_intake')          (origin='operator_intake')
           │                                        │
           └──────────────────┬─────────────────────┘
                              ▼
                public.invitations INSERT
                (account_id=null, org_id=null,
                 plan_code=set, default_org_name=set)
                              │
                              ▼  AFTER INSERT trigger (existing, ADR-0044 P2.5)
                dispatch_invitation_email → pg_net → Resend
                              │
                              ▼  email link
                app.consentshield.in/onboarding?token=<48hex>
                              │
                              ▼  7-step wizard
                accept_invitation → account + org + memberships
                → update_org_industry → seed_quick_data_inventory
                → apply_sectoral_template → snippet → compute_depa_score
                → first_consent_at watch → /dashboard?welcome=1
```

### Why reuse `public.invitations` instead of a new `signup_intakes` table

The invitation shape with `account_id is null and org_id is null and role='account_owner' and plan_code is not null` already encodes "intake": no account exists yet; the invite *creates* one when accepted. The dispatch pipeline already exists. The accept RPC already exists. Adding a parallel table would duplicate four pieces of infrastructure (table + indexes + dispatch + accept) for zero new behaviour.

A single new column — `invitations.origin` — distinguishes the three cases that all share the same table:
- `operator_invite` — admin invites a user *into an existing org* (account_id + org_id set). Lands at `/signup?invite=<token>`.
- `operator_intake` — admin creates a *new account* for a contracted customer (account_id=null, org_id=null, plan_code=set). Lands at `/onboarding?token=<X>`.
- `marketing_intake` — visitor self-serves on consentshield.in (same shape as operator_intake). Lands at `/onboarding?token=<X>`.

Email template + CTA URL branch on `origin`. Everything else stays as-is.

## Implementation

### Sprint 1.1 — DB migrations + public intake endpoint

**Deliverables:**

- [~] `supabase/migrations/20260802000001_invitations_origin.sql` — `alter table public.invitations add column origin text not null default 'operator_invite' check (origin in ('operator_invite','operator_intake','marketing_intake'))`. Backfills any existing rows to `'operator_invite'`. Partial index on `(invited_email, origin) where accepted_at is null and revoked_at is null`.
- [~] `supabase/migrations/20260802000002_create_signup_intake_rpc.sql` — `public.create_signup_intake(p_email, p_plan_code, p_org_name, p_ip)` SECURITY DEFINER, runs as `cs_orchestrator`. Validates plan_code; checks `auth.users` for existing email; **always returns generic `{status:'ok'}`** (no existence leak per Rule 18); refuses `is_admin=true` identities (Rule 12). Inserts an invitation row with `origin='marketing_intake'` for new emails; logs (no insert) for existing emails.
- [~] `supabase/migrations/20260802000003_create_operator_intake_rpc.sql` — `admin.create_operator_intake(p_email, p_plan_code, p_org_name)` — same shape as above but gated by `admin.require_admin('platform_operator')`; inserts with `origin='operator_intake'`.
- [~] `supabase/migrations/20260802000004_seed_quick_data_inventory.sql` — `public.seed_quick_data_inventory(p_org_id, p_has_email, p_has_payments, p_has_analytics)` SECURITY DEFINER, idempotent via `on conflict (org_id, canonical_key) do nothing`, gated to `effective_org_role(p_org_id) in ('account_owner','org_admin')`.
- [~] `supabase/migrations/20260802000005_first_consent_at.sql` — adds `organisations.first_consent_at`, `onboarded_at`, `onboarding_step` columns; AFTER INSERT trigger on `public.consent_events` stamps `first_consent_at` if null.
- [~] `supabase/migrations/20260802000006_intake_invitation_ttl.sql` — adds 14-day TTL pg_cron for `(origin in ('marketing_intake','operator_intake')) and accepted_at is null`.
- [~] `app/src/app/api/public/signup-intake/route.ts` — POST + OPTIONS handler. Turnstile verify; `checkRateLimit(ip, 5, 60)`; CORS allow-list (`https://consentshield.in`, `https://www.consentshield.in`, `http://localhost:3002`). Calls `create_signup_intake` via service-role client.
- [~] `app/src/app/api/internal/invitation-dispatch/route.ts` — read `origin` and route CTA URL: intakes → `/onboarding?token=`, operator-invites → `/signup?invite=` (existing).
- [~] `app/src/lib/invitations/dispatch-email.ts::buildDispatchEmail()` — accept `origin` and tweak subject + body for the two intake variants.
- [~] `tests/rls/invitations-origin.test.ts` — confirm `authenticated` cannot insert intake rows; only RPCs can.
- [~] `tests/integration/signup-intake.test.ts` — happy path + Turnstile failure + rate-limit + existence-leak parity + admin-identity refusal.

**Status:** `[~] in progress`

### Sprint 1.2 — Marketing `/signup` + pricing CTA split

**Deliverables:**

- [ ] `marketing/src/app/signup/page.tsx` — server component reading `?plan=<code>`; renders `<SignupForm>`.
- [ ] `marketing/src/components/sections/signup-form.tsx` — modelled on `contact-form.tsx`. Fields: email, org_name, 4-tier plan select (preselect from `?plan=`). Turnstile widget. Submits to `${NEXT_PUBLIC_APP_URL}/api/public/signup-intake`. Success state: "Check your inbox at <email> for a setup link. Link expires in 14 days." + "Try a different email" reset.
- [ ] `marketing/src/components/sections/pricing-preview.tsx` — CTA routing per tier: Starter / Growth / Pro → `/signup?plan=<code>`; Enterprise → `/contact`.
- [ ] `marketing/next.config.ts` — CSP `connect-src` adds `https://app.consentshield.in http://localhost:3000`.
- [ ] `marketing/src/lib/env.ts` + `.env.example` — typed `NEXT_PUBLIC_APP_URL`.

**Status:** `[ ] planned`

### Sprint 1.3 — Wizard shell + Steps 1–4

**Deliverables:**

- [ ] `app/src/app/(public)/onboarding/page.tsx` — server component; reads `?token=`; calls `invitation_preview`. Branches:
  - Valid intake token (not accepted, not revoked, not expired) → render `<OnboardingWizard>` with preview context.
  - Already accepted → "You're already set up — continue to dashboard" + redirect.
  - Invalid / expired / revoked → recovery UI with "Request a new link" form.
  - No token → "Paste your email — we'll resend the link" stub.
- [ ] `app/src/app/(public)/onboarding/layout.tsx` — step indicator + progress bar.
- [ ] Wizard client components under `app/src/app/(public)/onboarding/_components/`:
  - `onboarding-wizard.tsx` — orchestrator, persists `organisations.onboarding_step`.
  - `step-1-welcome.tsx` — `signInWithOtp` + `accept_invitation` (collapses the Sprint 4.2-era 3-stage flow into a single step since email is token-verified).
  - `step-2-company.tsx` — org name + industry → `update_org_industry`.
  - `step-3-data-inventory.tsx` — 3 yes/no toggles → `seed_quick_data_inventory`.
  - `step-4-purposes.tsx` — sectoral template picker → `apply_sectoral_template`.

**Status:** `[ ] planned`

### Sprint 1.4 — Steps 5–7

**Deliverables:**

- [ ] `app/src/app/(public)/onboarding/_components/step-5-deploy.tsx` — snippet display + "Verify installation" button.
- [ ] `app/src/app/api/orgs/[orgId]/onboarding/verify-snippet/route.ts` — server-side fetch of user URL with SSRF defence (RFC1918 + metadata + scheme allow-list); regex scan for `<script[^>]+banner\.js`.
- [ ] `step-6-scores.tsx` — calls `compute_depa_score(p_org_id)`; renders 3-dimension gauge + Top-3-actions list.
- [ ] `step-7-first-consent.tsx` — polls `/api/orgs/[orgId]/onboarding/status` every 5s for ≤5 min; on `first_consent_at` non-null → celebrate + advance; on timeout → mark `onboarded_at=now()` and hand off; background dispatcher emails when event eventually fires.
- [ ] `app/src/app/api/orgs/[orgId]/onboarding/status/route.ts` — RLS-scoped status read.

**Status:** `[ ] planned`

### Sprint 1.5 — Admin operator-intake + polish

**Deliverables:**

- [ ] `admin/src/app/(operator)/accounts/new-intake/page.tsx` — operator form: email, plan picker, org_name; calls `admin.create_operator_intake`.
- [ ] "Invite new account" button on `admin/.../accounts/page.tsx` (Accounts landing).
- [ ] "Resend link" + "Try a different email" UX on the no-token onboarding landing.
- [ ] Dashboard hand-off: `onboarded_at=now()` + `/dashboard?welcome=1`; one-time toast.
- [ ] In-wizard plan swap (Starter ↔ Growth ↔ Pro): new RPC `public.swap_intake_plan(p_org_id, p_new_plan_code)` gated to `account_owner` + `onboarded_at is null` + self-serve tier whitelist.
- [ ] Telemetry: `admin.audit_log` entries per step completion with elapsed ms.
- [ ] Accessibility: keyboard nav, focus trap, `aria-current="step"`.

**Status:** `[ ] planned`

## Acceptance criteria

- A visitor on `consentshield.in/pricing` clicks Growth → lands at `/signup?plan=growth` → submits → receives email within 60s → clicks link → wizard renders Step 1 with email + company + plan prefilled → completes 7 steps → lands on `/dashboard?welcome=1` with a fully-configured org and a running 14-day trial.
- An operator on `admin.consentshield.in/accounts` clicks "Invite new account" → enters customer email + Pro plan + org_name → submitting fires email → invitee lands at the same `/onboarding` wizard → identical experience.
- The pre-existing `/signup?invite=<token>` flow (operator-invite to add a member to an existing org) continues to work unchanged.
- An attacker calling `/api/public/signup-intake` with an existing customer's email gets the same response shape and latency as a brand-new email (Rule 18 spirit). The invitation table contains no row for the existing email; a "did you mean to sign in?" email is dispatched.
- An attacker calling the endpoint with an admin-identity email gets the same generic response, no invitation row created, no email dispatched (Rule 12).
- Rate limiter caps at 5 req / 60s per IP and 3 req / hour per email bucket.
- Wizard step persistence: refreshing mid-wizard restores at the last completed step.

## Consequences

**Enables:**
- Self-serve customer acquisition without operator involvement for Starter / Growth / Pro tiers.
- One-click contracted-customer onboarding for operators (no more raw-SQL invitations or manual setup).
- A single canonical wizard path means one set of integration tests covers both flows.

**Introduces:**
- New nullable `origin` column on `public.invitations` plus 6 migrations totalling ~250 lines of SQL.
- New public endpoint surface (`/api/public/signup-intake`) requiring CORS allow-list maintenance.
- A second self-serve attack surface (alongside `/api/public/rights-request`) for bot-driven enumeration; mitigated by Turnstile + dual-bucket rate limiting + existence-leak parity.
- New `onboarded_at` + `onboarding_step` columns on `organisations` create a wizard-progress signal the dashboard reads.

**Scope held**:
- Step 7's "first-consent celebration" times out after 5 minutes and marks onboarding complete anyway; a background email closes the loop later. Wizard never blocks dashboard access.
- In-wizard plan swap covers self-serve tiers only; Enterprise stays a sales conversation.
- DPA signature persistence is **not** part of this ADR; covered separately under the billing domain.
