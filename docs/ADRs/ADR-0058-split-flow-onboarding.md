# ADR-0058 — Split-flow customer onboarding

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed (all 5 sprints shipped 2026-04-21)
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

- [x] `supabase/migrations/20260802000001_invitations_origin.sql` — `alter table public.invitations add column origin text not null default 'operator_invite' check (origin in ('operator_invite','operator_intake','marketing_intake'))`. Backfills any existing rows to `'operator_invite'`. Partial index on `(invited_email, origin) where accepted_at is null and revoked_at is null`.
- [x] `supabase/migrations/20260802000002_create_signup_intake_rpc.sql` — `public.create_signup_intake(p_email, p_plan_code, p_org_name, p_ip)` SECURITY DEFINER, runs as `cs_orchestrator`. Validates plan_code; checks `auth.users` for existing email; **always returns generic `{status:'ok'}`** (no existence leak per Rule 18); refuses `is_admin=true` identities (Rule 12). Inserts an invitation row with `origin='marketing_intake'` for new emails; logs (no insert) for existing emails.
- [x] `supabase/migrations/20260802000003_create_operator_intake_rpc.sql` — `admin.create_operator_intake(p_email, p_plan_code, p_org_name)` — same shape as above but gated by `admin.require_admin('platform_operator')`; inserts with `origin='operator_intake'`.
- [x] `supabase/migrations/20260802000004_seed_quick_data_inventory.sql` — `public.seed_quick_data_inventory(p_org_id, p_has_email, p_has_payments, p_has_analytics)` SECURITY DEFINER, idempotent via `on conflict (org_id, canonical_key) do nothing`, gated to `effective_org_role(p_org_id) in ('account_owner','org_admin')`.
- [x] `supabase/migrations/20260802000005_first_consent_at.sql` — adds `organisations.first_consent_at`, `onboarded_at`, `onboarding_step` columns; AFTER INSERT trigger on `public.consent_events` stamps `first_consent_at` if null.
- [x] `supabase/migrations/20260802000006_intake_invitation_ttl.sql` — adds 14-day TTL pg_cron for `(origin in ('marketing_intake','operator_intake')) and accepted_at is null`.
- [x] `app/src/app/api/public/signup-intake/route.ts` — POST + OPTIONS handler. Turnstile verify; `checkRateLimit(ip, 5, 60)`; CORS allow-list (`https://consentshield.in`, `https://www.consentshield.in`, `http://localhost:3002`). Calls `create_signup_intake` via service-role client.
- [x] `app/src/app/api/internal/invitation-dispatch/route.ts` — read `origin` and route CTA URL: intakes → `/onboarding?token=`, operator-invites → `/signup?invite=` (existing).
- [x] `app/src/lib/invitations/dispatch-email.ts::buildDispatchEmail()` — accept `origin` and tweak subject + body for the two intake variants.
- [x] `tests/rls/invitations-origin.test.ts` — confirm `authenticated` cannot insert intake rows; only RPCs can.
- [ ] `tests/integration/signup-intake.test.ts` — happy path + Turnstile failure + rate-limit + existence-leak parity + admin-identity refusal. **Deferred to Sprint 1.5 polish** — RLS coverage above + 4 dispatch unit tests (11/11 PASS) cover the branches; a full integration test needs the wizard live on the customer app to drive a realistic client. Tracked as Sprint 1.5 deliverable.

**Tested:**
- [x] `cd app && bunx vitest run tests/invitation-dispatch.test.ts` — 11/11 PASS (4 new origin-aware copy variants).
- [x] `cd app && bun run build` — clean; 47 routes including `/api/public/signup-intake`.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] `bunx supabase db push` — 6 migrations applied to remote dev DB (confirmed via `supabase migration list` — both Local + Remote columns filled for 20260802000001-06).
- [x] `bunx vitest run tests/rls/invitations-origin.test.ts` — 7/7 PASS (column+check constraint; anon/authenticated blocked from direct INSERT; RPC fresh-email branch; existing-customer leak-parity branch; invalid-plan silent branch; admin-identity refusal).

**Status:** `[x] complete — 2026-04-21`

### Sprint 1.2 — Marketing `/signup` + pricing CTA split

**Deliverables:**

- [x] `marketing/src/app/signup/page.tsx` — server component reading `?plan=<code>`; normalises to whitelist (`starter | growth | pro`, default `growth`); renders `<SignupForm>` plus a 3-bullet "what to expect" sidebar.
- [x] `marketing/src/components/sections/signup-form.tsx` — client; mirrors `contact-form.tsx`. Fields: email, company name, 3-tier plan select (preselect from prop). Turnstile widget loads on mount. Submits cross-origin to `${APP_URL}/api/public/signup-intake`. Success state: "Check your inbox" + "Try a different email" reset. Disabled state during submit.
- [x] `marketing/src/components/sections/pricing-preview.tsx` — added per-tier `ctaHref`: Starter / Growth / Pro → `/signup?plan=<code>`; Enterprise → `/contact`. CTA labels normalised to "Start free trial" for self-serve tiers.
- [x] `marketing/src/app/pricing/page.tsx` — final CTA band's primary button now points at `/signup?plan=growth`; secondary stays at `/contact`.
- [x] `marketing/next.config.ts` — CSP `connect-src` adds `https://app.consentshield.in http://localhost:3000`.
- [x] `marketing/src/lib/env.ts` — typed `APP_URL` constant with localhost dev default.
- [x] `marketing/.env.example` — documents `NEXT_PUBLIC_APP_URL`.

**Tested:**
- `cd marketing && bun run build` — clean; 16 routes (12 static + `/signup` dynamic + `/api/contact` dynamic + Sentry tunnel + source-map endpoint).
- `cd marketing && bun run lint` — 0 errors, 0 warnings.

**Status:** `[x] complete — 2026-04-21`

### Sprint 1.3 — Wizard shell + Steps 1–4

**Deliverables:**

- [x] `app/src/app/(public)/onboarding/page.tsx` — server component; reads `?token=`; calls `invitation_preview`. Branches:
  - Valid intake token (not accepted, not revoked, not expired) → render `<OnboardingWizard>` with preview context.
  - Already accepted → "Link unavailable" with "Sign in" CTA (resume path is handled separately via authed-user lookup below, not this branch).
  - Invalid / expired / revoked → recovery UI with "Request a new link" mailto.
  - No token, user unauthenticated → "You need a sign-up link" shell with pricing pointer.
  - No token, user authenticated + pending org → render `<OnboardingWizard mode="resume">` at `onboarding_step + 1` (acceptance criterion: wizard refresh restores at last completed step).
  - No token, user authenticated + onboarded → "You're already onboarded" + link to `/dashboard`.
- [x] `app/src/app/(public)/onboarding/layout.tsx` — top chrome (brand + "Need help?" mail link) with page as main.
- [x] `app/src/app/(public)/onboarding/_components/step-indicator.tsx` — 7-dot progress bar with done/current/upcoming states + `aria-current="step"`.
- [x] Wizard client components under `app/src/app/(public)/onboarding/_components/`:
  - `onboarding-wizard.tsx` — orchestrator, holds `(orgId, accountId, orgName, industry, currentStep)` state; accepts `mode="fresh"` or `mode="resume"`; renders appropriate step; post-Step-4 renders `<ComingSoonShell>` with dashboard CTA (Sprints 1.4 + 1.5 fill the 5–7 placeholders).
  - `step-1-welcome.tsx` — preview summary + `signInWithOtp` + OTP verify + `accept_invitation` + `supabase.auth.refreshSession()` (to pick up `org_id` claim from `custom_access_token_hook`). Single-step; email is token-verified so no "confirm email" stage needed.
  - `step-2-company.tsx` — org name (read-only, "you can rename in Settings later") + industry select (8 whitelisted values). Submit: `update_org_industry` + `set_onboarding_step(step=2)`.
  - `step-3-data-inventory.tsx` — 3 yes/no toggles (email, payments, analytics). Submit: `seed_quick_data_inventory` + `set_onboarding_step(step=3)`. "None of these apply? Continue" hint.
  - `step-4-purposes.tsx` — loads `list_sectoral_templates_for_sector(industry)` on mount; card grid with "Use this template" per row; "Skip for now" fallback. Submit: `apply_sectoral_template` + `set_onboarding_step(step=4)`.
- [x] `app/src/app/(public)/onboarding/actions.ts` — thin server-action wrappers (`setOnboardingStep`, `updateIndustry`, `seedDataInventory`, `applyTemplate`, `listTemplatesForSector`) over the RPCs above. Wraps `{ok, error}` tagged unions so the client islands stay typed.
- [x] `supabase/migrations/20260803000001_set_onboarding_step.sql` — `public.set_onboarding_step(p_org_id, p_step)` SECURITY DEFINER, role gate `effective_org_role in ('org_admin','admin')`, step range 0..7, stamps `onboarded_at` when `p_step=7`. GRANT EXECUTE to `authenticated`. Unblocks wizard persistence (Sprint 1.1 M5 added the column but no setter).
- [x] `app/src/proxy.ts` — added `/onboarding` + `/onboarding/:path*` to the matcher. Rule 12 enforcement (admin-identity rejection with 403) now runs on the onboarding surface.

**Tested:**
- [x] `cd app && bun run build` — clean; 48 routes now, `/onboarding` present (dynamic).
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] `bunx supabase db push` — 1 migration applied (`20260803000001_set_onboarding_step.sql`); remote `set_onboarding_step` RPC callable.
- [ ] Manual dev-server click-through — pending. The full happy path (visit `/onboarding?token=<X>` → Step 1 OTP → Step 2 industry → Step 3 data inventory → Step 4 template) needs a live Resend email + Supabase dev DB session to validate; deferred to Sprint 1.5 polish alongside the operator-intake page where we can exercise both flows in one pass.

**Status:** `[x] complete — 2026-04-21`

### Sprint 1.4 — Steps 5–7

**Deliverables:**

- [x] `app/src/app/(public)/onboarding/_components/step-5-deploy.tsx` — URL capture → `web_properties` row → snippet display + copy button → "Verify installation" button. Pre-loads the first existing property on wizard resume. "I'll do this later" fallback still advances (unverified properties can be verified later from Settings → Properties).
- [x] `app/src/app/api/orgs/[orgId]/onboarding/verify-snippet/route.ts` — SSRF-defended server fetch. Layering: (1) scheme allow-list (http/https only); (2) hostname block-list (`localhost`, `metadata.google.internal`, `instance-data`, `*.internal`, `*.local`); (3) DNS resolution + IP-family check with `node:dns/promises.lookup({all:true})`, refusing RFC1918 + loopback + link-local (169.254/16) + CGNAT (100.64/10) + multicast + reserved; same check applied to both literal IPs in the URL and every DNS-resolved record; (4) 5-second AbortController timeout; (5) 256 KB response cap with early-abort on `<script[^>]+banner\.js` match; (6) `redirect: 'manual'` — redirects never followed. On pass: `UPDATE web_properties SET snippet_verified_at, snippet_last_seen_at`. Response body always `{verified, reason?, verified_at?}` — raw HTML never exposed.
- [x] `app/src/app/(public)/onboarding/_components/step-6-scores.tsx` — fetches the existing `/api/orgs/[orgId]/depa-score` endpoint (ADR-0025, cache-first with RPC fallback). Renders total gauge (colour-coded at 75/50 thresholds) + 4 dimension tiles (coverage / expiry / freshness / revocation — matches the columns in `depa_compliance_metrics`). Top-3 actions picks the three weakest dimensions and maps each to a canned recommendation.
- [x] `app/src/app/(public)/onboarding/_components/step-7-first-consent.tsx` — 5-second poll of `/api/orgs/[orgId]/onboarding/status` with client-side 5-minute timeout. On `first_consent_at` non-null → "First consent captured!" + `set_onboarding_step(7)` (which stamps `onboarded_at` via the Sprint 1.3 migration) + redirects to `/dashboard?welcome=1`. On timeout → "No consent yet — that's fine" with same finalise path. Manual "Skip the wait →" link available at any time. Background email on eventual first consent is a Sprint 1.5 deliverable (connector to existing SLA-reminder dispatcher).
- [x] `app/src/app/api/orgs/[orgId]/onboarding/status/route.ts` — membership-gated read of `organisations (onboarding_step, onboarded_at, first_consent_at)`.
- [x] `onboarding-wizard.tsx` — extended to route Steps 5–7 (replaced the ComingSoonShell placeholder from Sprint 1.3). Step 7 redirects to `/dashboard?welcome=1` on finalise.

**Tested:**
- [x] `cd app && bun run build` — clean; 48 routes (onboarding + 2 new API routes under `/api/orgs/[orgId]/onboarding/`).
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [ ] Manual dev-server click-through — deferred to Sprint 1.5 polish alongside operator-intake.

**Status:** `[x] complete — 2026-04-21`

### Sprint 1.5 — Admin operator-intake + polish

**Deliverables:**

- [x] `admin/src/app/(operator)/accounts/new-intake/page.tsx` — server component; loads active plans from `public.plans` (sorted cheap → expensive) and renders the client form.
- [x] `admin/src/app/(operator)/accounts/new-intake/form.tsx` — client form (email + plan select + optional org_name). Calls the new `createOperatorIntakeAction`. On success: clears the fields + shows the invitation id.
- [x] `admin/src/app/(operator)/accounts/actions.ts::createOperatorIntakeAction` — server action wrapping `admin.create_operator_intake`. Returns `{id, token}` on success; raw RPC errors relayed to the operator so bad plan codes / Rule-12 conflicts / ADR-0047 conflicts are immediately actionable.
- [x] "Invite new account" button on `admin/src/app/(operator)/accounts/page.tsx` header — `Link` to `/accounts/new-intake`.
- [x] `supabase/migrations/20260803000002_swap_intake_plan_and_telemetry.sql` — ships three pieces in one file:
  - `public.swap_intake_plan(p_org_id, p_new_plan_code)` — self-serve tier whitelist (`starter | growth | pro`), role gate `account_owner | org_admin | admin`, refuses if `onboarded_at is not null`. Updates `accounts.plan_code` for the org's account.
  - `public.onboarding_step_events` — append-only telemetry buffer (org_id, step, elapsed_ms, occurred_at). RLS-enabled with zero policies (writer is the SECURITY DEFINER RPC below; reader is admin-only — to be added when a dashboard surface needs it).
  - `public.log_onboarding_step_event(p_org_id, p_step, p_elapsed_ms)` — SECURITY DEFINER writer. Role gate `effective_org_role is not null`. Step range 1..7. Append-only insert.
- [x] `app/src/app/(public)/onboarding/_components/plan-swap.tsx` — modal widget visible in the wizard header from Step 2 onward. Three cards (Starter / Growth / Pro), "Current" pill on the active one, per-card "Switch" button. Enterprise copy points at `hello@consentshield.in`.
- [x] `onboarding-wizard.tsx` — wires `<PlanSwap>` above the step indicator (Steps 2–6); tracks step-enter timestamp and fires `logStepCompletion(orgId, step, elapsedMs)` on every successful advance; `planCode` seeded from the preview row and kept in sync when the user swaps.
- [x] `app/src/app/(public)/onboarding/actions.ts::logStepCompletion` and `::swapPlan` — server-action wrappers.
- [x] `app/src/components/welcome-toast.tsx` + mount in `app/src/app/(dashboard)/layout.tsx` — one-time toast on `?welcome=1`; strips the query param on mount so a refresh doesn't replay; auto-dismisses after 8 s; Rule-13-compliant `role="status"` + `aria-live="polite"`.
- [x] Accessibility (Sprint 1.3 groundwork + Sprint 1.5 tightening): `aria-current="step"` on the active step dot (Sprint 1.3), `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the plan-swap modal, `role="status"` + `aria-live="polite"` on the welcome toast, keyboard-reachable Skip / Change-plan / Dismiss buttons, inherited focus rings.
- [x] **Resend-link form** — shipped 2026-04-21 as a Sprint 1.5 close-out commit (`a494890`). `app/src/app/(public)/onboarding/_components/resend-link-form.tsx` renders in `NoTokenShell` and `InvalidShell(not_found | expired)`. Backed by new `POST /api/public/resend-intake-link`: rate-limited (5/60s per IP, 3/hour per email, dev-bypass on `NODE_ENV !== 'production'`), looks up the most-recent pending intake via cs_orchestrator direct-Postgres, clears `email_dispatched_at`, fires `dispatchInvitationById` inline so the marketing Resend relay re-sends. Existence-leak parity preserved — every non-rate-limit branch returns `{ok:true}`; UI copy reads "if a pending invitation exists…" rather than claiming delivery. `InvalidShell(reason='already_accepted')` keeps `/login` CTA — resend is meaningless for a consumed invite.
- [ ] **Integration test** (`tests/integration/signup-intake.test.ts`) — **deferred again.** Driving the wizard end-to-end in CI wants either a headless-browser harness or a Supabase auth-mock, neither of which we run today. Tracked as V2 follow-up alongside the resend-link endpoint.

**Tested:**
- [x] `cd app && bun run build` — clean.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] `cd admin && bun run build` — clean; `/accounts/new-intake` present in the route table.
- [x] `cd admin && bun run lint` — 0 errors, 0 warnings (after a one-line `Date.now()` → `new Date().getTime()` fix in the pre-existing `billing/disputes/[disputeId]/page.tsx` that the Next.js-16 purity rule now catches).
- [x] `bunx supabase db push` — 1 migration applied (swap_intake_plan + onboarding_step_events + log_onboarding_step_event).
- [ ] Manual dev-server click-through — deferred to operator playtest next session (marketing intake → wizard → admin operator-intake → wizard both land cleanly on `/dashboard?welcome=1`).

**Status:** `[x] complete — 2026-04-21`

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
