# ADR-0044: Customer RBAC — 4-Level Hierarchy + 5-Role Model + Invitation-Only Signup (v2)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-18
**Date completed:** 2026-04-18
**Review:** `docs/reviews/2026-04-18-adr-0044-customer-rbac-review.md`

**Depends on:**
- ADR-0006 (Razorpay billing — will be rewired from org to account).
- ADR-0013 (signup bootstrap — OTP + ensureOrgBootstrap).
- ADR-0042 (signup idempotency test — helper reused inside invite acceptance).
- ADR-0043 (customer app is auth-only).

**Supersedes:** ADR-0044 v1 (three-role, flat-org model drafted 2026-04-17; never implemented).

**Blocks:** future marketing site (`www.consentshield.in`) invite-generation endpoint.

---

## Context

Today the customer app assumes **one org = one subscription, one owner, no members, no invitations, no role separation**. Anyone with an email address can sign up via `/signup` and spin up a tenant. Three concrete problems:

1. **No team collaboration.** A compliance officer and an engineer in the same org cannot both sign in.
2. **No role separation.** Someone reviewing rights-request decisions can also change banners, rotate signing secrets, and cancel billing.
3. **No tenant-creation control.** Random visitors can spin up orgs; there's no funnel from plan selection to signup.

The business shape we want is richer than the obvious "add members + roles" fix because the target enterprise segment is structurally different.

### The enterprise segment

Large Indian corporate groups (Tata, Birla, Reliance, BFSI holdings) acquire ConsentShield through central procurement but operate through many divisions — some of which are separate legal entities under different names, different DPOs, different bank accounts, different DPDP compliance postures.

- Central procurement / group CFO: one contract, one invoice, one GST, one Razorpay subscription.
- Divisional DPOs: autonomous operational control of their own compliance posture, banner identity, rights-request inbox, audit trail, R2 bucket.
- Group compliance / internal audit: read-across visibility without billing rights.
- Cross-division isolation: Tata Motors' org_admin cannot see Taj Hotels' data under any access path.

Without a multi-layer tenancy model, enterprise customers are forced to buy N separate ConsentShield contracts — killing the procurement motion. A flat multi-org-under-one-owner model is too coarse because divisional DPOs shouldn't see peer divisions' data.

### The SMB segment

Most customers will be single-tenant SMBs. Adding hierarchy for them must not add clicks: auto-spawn a default org on invite acceptance, hide the org-switcher when membership count is 1, account_owner inherits every lower-role permission so solo founders are never locked out.

## Decision

Introduce a four-level hierarchy **account → organisations → web_properties** with five roles (**account_owner · account_viewer · org_admin · admin · viewer**) and invitation-only signup. Billing moves from `organisations` to `accounts`. Plans become a first-class table with `max_organisations` and `max_web_properties_per_org` limits. `/signup` requires a valid invite token; walk-up signup is removed.

### Locked design decisions (all 15)

1. **Hierarchy:** account → organisations (plan-gated count per account) → web_properties (plan-gated count per org).
2. **Five roles:** account_owner, account_viewer, org_admin, admin, viewer.
3. **Org = legal entity.** Departments within a legal entity separate via web-properties, not sub-orgs. No `parent_org_id` column.
4. **Invitations only; no walk-up signup.** `/signup` requires `?invite=<token>`. Five invite shapes, polymorphic `accept_invitation` RPC.
5. **Billing pooled at account level in v1.** Per-org usage rollup is a v2 dashboard enhancement (every metered row already carries `org_id`).
6. **Downgrade = soft-suspend excess, most-recent-first.** `organisations.status ∈ (active, suspended_by_plan)`; Worker serves no-op banner; dashboard offers reactivate-on-upgrade.
7. **Account-owner transfer = operator-mediated via admin console in v1.** Self-serve flow is v2.
8. **Default first org on account-creation invite acceptance.** Invite carries optional `default_org_name`; acceptance creates account + first org + account_owner membership + implicit org_admin of that first org in one transaction. Email-prefix fallback when name is absent.
9. **M&A / merge / org-transfer / multi-account-per-user:** deferred to v2. Schema supports re-parenting; no UI or protocol in v1.
10. **Plans are a first-class table.** `public.plans (plan_code pk, display_name, max_organisations, max_web_properties_per_org, base_price_inr, razorpay_plan_id, trial_days, is_active)`. Lets limits be tuned without code deploy.
11. **Trial = a plan.** `plan_code='trial_starter'`, `trial_days=30`, `max_organisations=1`, `max_web_properties_per_org=1`. `accounts.trial_ends_at` derived from `accepted_at + trial_days`.
12. **Credentials column-level RLS.** `api_key`, `signing_secret`, R2 `secret_access_key`, connector ciphertext — SELECT denied unless caller role ∈ {account_owner of this account, org_admin of this row's org}. Admins, viewers, and account_viewer cannot read.
13. **Legacy migration is a one-shot SQL script.** Each existing org becomes a solo-account; owner becomes account_owner; one implicit org_membership row as org_admin. Pre-beta ⇒ no customer coordination.
14. **Last-account_owner protection.** RPCs refuse to remove/demote the sole account_owner.
15. **`current_account_id()` + `current_org_id()`** via proxy cookie. Switcher writes cookie; proxy validates membership on every request.

### Data model

```
public.plans                  (plan_code PK, display_name,
                               max_organisations, max_web_properties_per_org,
                               base_price_inr, razorpay_plan_id,
                               trial_days, is_active)

public.accounts               (id, name, plan_code FK plans,
                               razorpay_customer_id, razorpay_subscription_id,
                               status, trial_ends_at,
                               current_period_ends_at, created_at)

public.account_memberships    (account_id, user_id,
                               role ∈ {account_owner, account_viewer},
                               invited_by, invited_at, accepted_at, status)
                               PK (account_id, user_id)

public.organisations          (+ account_id NOT NULL FK accounts,
                               + status ∈ {active, suspended_by_plan},
                               - billing_plan_id, - razorpay_subscription_id)

public.org_memberships        (org_id, user_id,
                               role ∈ {org_admin, admin, viewer},
                               invited_by, invited_at, accepted_at, status)
                               PK (org_id, user_id)

public.invitations            (id, token UNIQUE, invited_email citext,
                               account_id NULL, org_id NULL,
                               role ∈ {account_owner, account_viewer,
                                       org_admin, admin, viewer},
                               plan_code NULL, trial_days NULL,
                               default_org_name NULL,
                               invited_by, created_at, expires_at,
                               accepted_at, accepted_by)
                               partial unique (lower(invited_email), account_id, org_id)
                               where accepted_at is null
```

### Role matrix

| Capability                                         | account_owner | account_viewer | org_admin (X) | admin (X) | viewer (X) |
|----------------------------------------------------|:-------------:|:--------------:|:-------------:|:---------:|:----------:|
| Read across all orgs in the account                |      ✅       |       ✅       |   only X      |  only X   |   only X   |
| Edit banners / purposes / rights / integrations    |      ✅       |       ❌       |      ✅       |    ✅     |     ❌     |
| Create/remove web properties (plan-gated)          |      ✅       |       ❌       |      ✅       |    ❌     |     ❌     |
| Invite admin / viewer into org X                   |      ✅       |       ❌       |      ✅       |    ❌     |     ❌     |
| Invite org_admin / account_viewer                  |      ✅       |       ❌       |      ❌       |    ❌     |     ❌     |
| Create new organisation (plan-gated)               |      ✅       |       ❌       |      ❌       |    ❌     |     ❌     |
| Delete organisation                                |      ✅       |       ❌       |      ❌       |    ❌     |     ❌     |
| View billing + invoices                            |      ✅       |       ❌       |      ❌       |    ❌     |     ❌     |
| Change plan / payment method                       |      ✅       |       ❌       |      ❌       |    ❌     |     ❌     |
| Read credentials (R2 keys, signing secrets)        |      ✅       |       ❌       |      ✅       |    ❌     |     ❌     |
| Rotate credentials                                 |      ✅       |       ❌       |      ✅       |    ❌     |     ❌     |

### Invariants (enforced at RLS + RPC gate layers)

1. `org_admin` of Org X cannot read/write any data of Org Y, under any access path (direct table, RPC, REST, server action).
2. `account_owner` and `account_viewer` implicit access is computed by a `requireOrgAccess(org_id, roles)` helper at RPC entry, not persisted as N membership rows per account.
3. Credential columns carry column-level RLS denying SELECT to callers whose role is not account_owner-of-this-account or org_admin-of-this-row's-org.
4. Plan-gated creation RPCs count existing rows in the same transaction before inserting.
5. Last-account_owner protection: `admin.transfer_account_owner` + `remove_account_member` + `demote_account_member` refuse if the operation would leave the account without an account_owner.
6. Soft-suspended orgs stop serving via the Worker. The existing `sync-admin-config-to-kv` cron already publishes a `suspended_org_ids` set to Cloudflare KV; this lands `organisations.status` semantics inside that publisher.

## Consequences

- **Enterprise procurement becomes viable.** One contract per group, one invoice, one GST, while divisional DPOs run autonomously.
- **Legal-entity isolation is natural.** DPDP compliance is legal-entity-scoped by law; org = legal entity matches that directly.
- **Blast radius is bounded.** A compromised admin account cannot rotate signing secrets, cancel the subscription, or read credentials.
- **SMB friction stays at zero.** Auto-spawn first org + account_owner inheritance + single-org-hides-switcher → single-tenant customers never know the layer exists.
- **Billing surface is rewritten.** Every Razorpay touchpoint moves from org to account. Roughly 60% of total RBAC effort. Phased off first.
- **`/signup` requires an invite.** Random sign-ups stop working; a support-contact error page explains the change. Acceptable because system is pre-beta with zero live customers.
- **Two-tier access resolution.** Every mutation RPC needs a small gate helper; the helper folds in account-owner inheritance so RPC authors don't juggle it manually.

## Out of scope (explicitly deferred)

- **Marketing site `www.consentshield.in`.** Separate project, separate ADR. This ADR ships an HMAC-gated internal endpoint (`/api/internal/invites`) that the future marketing site will call.
- **Multi-account per user.** The schema supports one user belonging to multiple accounts via multiple `account_memberships` rows, but v1 assumes each user has exactly one primary account. Account-switcher UI is v2.
- **M&A / account-merge / org-transfer / divestiture.** Schema supports re-parenting via migration; no UI, no customer self-serve.
- **Account-owner self-serve transfer.** v1 is operator-mediated via admin console. Self-serve with email-OTP confirmation is v2.
- **Per-org billing accounting view.** v1 pools usage at the account level on the billing dashboard. Per-org rollup (for internal chargebacks at Tata-scale customers) is a v2 dashboard enhancement; data already has `org_id` on every row.
- **SSO / OIDC.** All auth remains email OTP.
- **Org hierarchy / sub-orgs.** Flat tenants only within an account.
- **Custom roles / role templates.** The five roles are hard-coded.

---

## Implementation Plan

### Phase 0 — Accounts layer + billing relocation (~1 sprint)

**Rationale:** billing being org-scoped is the single biggest architectural mismatch. Every downstream phase needs `accounts.plan_code` as the authority. Ship this first.

**Deliverables:**
- [ ] Migration `2026MMDDxxxx_accounts_and_plans.sql`:
  - `public.plans` with seed rows (starter, growth, pro, enterprise, trial_starter). `is_active` flag lets us retire plans without deleting historical FKs.
  - `public.accounts` with Razorpay + plan columns.
  - `organisations.account_id` (nullable, then backfill, then NOT NULL) + `organisations.status`.
  - Remove `organisations.billing_plan_id` + `organisations.razorpay_subscription_id` (data migrated to the parent account first).
  - One-shot backfill: every existing org becomes a solo-account; status='active'; owner becomes later-phase account_owner.
- [ ] `public.current_account_id()` SQL function reading from the admin-config-style cookie propagation in the proxy.
- [ ] `app/src/lib/billing/plans.ts` — account-scoped plan resolver. Old org-scoped helpers deprecated/deleted in the same PR.
- [ ] `app/src/app/api/webhooks/razorpay/**` — resolve `accounts` from `razorpay_customer_id`; mutate `accounts`, not `organisations`.
- [ ] `app/src/app/(dashboard)/dashboard/billing/**` — account-scoped; moved out of any org-prefixed route.
- [ ] `app/src/proxy.ts` — add account cookie alongside the org cookie; proxy validates caller's account membership.

**Testing plan:**
- [ ] `cd app && bun run build` — all routes compile; no org-scoped billing surfaces remain.
- [ ] `cd app && bun run lint` — zero new warnings.
- [ ] `bun run test:rls` — new tests: billing webhook → correct account; admin of org A cannot read account B's billing state.

**Status:** `[ ] planned`

### Phase 1 — Memberships + role resolution (~1 sprint)

**Deliverables:**
- [ ] Migration `2026MMDDxxxx_memberships.sql`:
  - `public.account_memberships` + RLS.
  - `public.org_memberships` + RLS.
  - `public.current_account_role()`, `public.current_org_role()`, `public.effective_org_role(org_id)` (folds account_owner + account_viewer inheritance).
  - Backfill: every pre-existing org owner → one `account_memberships` row as account_owner + one `org_memberships` row as org_admin of their one org.
  - Column-level RLS tightening on credential columns (`api_key`, `signing_secret`, `export_configurations.secret_access_key`, `integration_connectors.credentials_ciphertext`).
- [ ] `app/src/lib/auth/require-org-role.ts` — server helper with inheritance; typed error.
- [ ] Audit every `app/src/app/**/actions.ts` + every API route that mutates; add the gate at entry. Credential-touching actions get `['account_owner','org_admin']`.

**Testing plan:**
- [ ] RLS isolation tests: insert Org X + Org Y under the same account + Org Z in a different account; assert org_admin(X) cannot read Y or Z.
- [ ] Credential-column test: viewer / admin cannot SELECT credential columns; org_admin + account_owner can.
- [ ] Role helper: account_owner passes every gate; account_viewer fails write gates; org_admin fails account-scoped gates; admin fails credential-read.

**Status:** `[ ] planned`

### Phase 2 — Invitation flow (~1 sprint)

**Deliverables:**
- [ ] Migration `2026MMDDxxxx_invitations.sql`:
  - `public.invitations` + RLS + partial unique index on (lower(email), account_id, org_id) where `accepted_at is null`.
  - `public.create_invitation(...)` SECURITY DEFINER RPC. Role-gates the inviter: account_owner can create any role; org_admin can create only admin/viewer invites scoped to their own org.
  - `public.accept_invitation(token)` SECURITY DEFINER RPC — polymorphic by `invitations.role`:
    - `account_owner` → creates account + first org (using invite's `default_org_name` or email-prefix fallback) + account_owner membership + implicit org_admin membership in one transaction.
    - `account_viewer` → adds account_memberships row only.
    - `org_admin` / `admin` / `viewer` → adds org_memberships row only.
  - Idempotency + existing-auth-user detection (don't recreate Supabase auth user if the invitee already has one).
- [ ] `app/src/app/(public)/signup/page.tsx` — require `?invite=<token>`. Show email pre-filled (read-only). Invalid/expired/consumed → support-contact error page. Accept path branches by role.
- [x] Resend email templates (Phase 2.5). Collapsed into a single HTML shell with a role-switch on subject / heading / body (`app/src/lib/invitations/dispatch-email.ts`). Dispatched via AFTER-INSERT trigger → `/api/internal/invitation-dispatch` route (pg_net) with a pg_cron safety-net.
- [x] `admin/src/app/(operator)/orgs/new-invite/**` + `admin/src/app/(operator)/orgs/[orgId]/new-invite/**` — operator-side forms. Split into two routes (phase 2.3): top-level for account-creating invites (email + plan + trial_days + optional default_org_name), org-scoped for org_admin promotion. Wireframe added to `docs/admin/design/consentshield-admin-screens.html` panels 2a + 2b.
- [x] `app/src/app/(dashboard)/dashboard/settings/members/` — account_owner / org_admin invite forms (internal). Adds `revoked_at` + `revoked_by` to `public.invitations`, three new RPCs (`list_pending_invitations`, `revoke_invitation`, `list_members`), existing-member + pending-invite tables + invite form with role-scoped picker. Wireframe added to `docs/design/screen designs and ux/consentshield-screens.html` Settings panel Team members subsection.
- [x] `app/src/app/api/internal/invites/route.ts` — HMAC-gated endpoint (`x-cs-signature` + `x-cs-timestamp` headers, ±5 min replay window) for the future marketing site. Delegates to the new `public.create_invitation_from_marketing(...)` RPC via cs_orchestrator. No live consumer yet; the dispatch trigger from Phase 2.5 fires Resend automatically on insert. Signature contract + route committed so the marketing site can integrate without a round-trip redesign.

**Testing plan:**
- [ ] Each invite shape accepts correctly; consumed / expired / mismatched-email fails with typed error.
- [ ] Existing-auth-user acceptance skips OTP; only the membership row is added.
- [ ] account_owner acceptance creates account + first org + two memberships atomically.
- [ ] `/signup` without `?invite=` shows the support-contact page.

**Status:** `[ ] planned`

### Phase 3 — Role-gated UI (~1–2 sprints)

**Deliverables:**
- [ ] Header org-switcher component — hidden when membership count = 1.
- [ ] `/dashboard/settings/members` — split view: "Account members" (account_owner only; lists account_owners + account_viewers; invite form for those roles) + "Org members" (account_owner or org_admin of current org; lists org_admin + admin + viewer; invite form appropriate to inviter role).
- [ ] Billing nav item + `/dashboard/billing` restricted to account_owner.
- [ ] Plan-gate affordances on create-org / create-web-property flows — disable CTA at limit with upgrade link.
- [ ] Viewer mode affordances — disabled action buttons, read-only form renderings.
- [ ] Suspended-org banner (for `suspended_by_plan`) with reactivate-on-upgrade CTA.

**Testing plan:**
- [ ] Browser smoke with 5 test users (one per role): each signs in, sees only their allowed surfaces.
- [ ] Plan-gate: at limit, CTAs disable; RPC raises if bypassed.
- [ ] Single-org user: org-switcher hidden.

**Status:** `[ ] planned`

### Phase 4 — Downgrade + lifecycle (~0.5 sprint)

**Deliverables:**
- [ ] Razorpay plan-change webhook: compare new plan's `max_organisations` to `count(public.organisations where account_id=... and status='active')`; soft-suspend the excess (most-recently-created first). Same pattern for `max_web_properties_per_org`.
- [ ] `sync-admin-config-to-kv` cron picks up suspension into the existing `suspended_org_ids` KV key (no new Worker code).
- [ ] `admin.transfer_account_owner(...)` RPC — operator-mediated ownership transfer with audit log; last-owner-protection.
- [ ] Reactivation path on upgrade — `organisations.status` back to `active`; Worker picks up via next KV sync.

**Testing plan:**
- [ ] 3-org account downgrades to starter (1-org limit) → 2 most-recently-created orgs become `suspended_by_plan`; Worker no-op within one cron cycle; upgrade restores.
- [ ] `admin.transfer_account_owner` happy path + last-owner-protection raises.

**Status:** `[ ] planned`

---

## Acceptance Criteria

- All 5 roles function per the matrix; no role can perform an action outside its row.
- `/signup` refuses walk-up signup; all three invite shapes accept end-to-end.
- Billing surfaces are account-scoped; no `/dashboard/billing` path reads from `organisations`.
- Plan downgrade soft-suspends excess; upgrade restores them.
- Legacy orgs successfully migrated into solo-accounts; no data loss, zero-warning build, 180+/180+ RLS tests green.
- Admin console has an operator-side invite form (`/orgs/[orgId]/new-invite`) that can onboard a new account until the marketing site ships.

## Open-in-ADR details (not blocking plan approval)

- Exact column names on `accounts` (pinned during Phase 0 migration).
- Plan tiers + limits — seeded with reasonable defaults; tweakable later via SQL without code.
- Email template copy — authored during Phase 2.
- Org-switcher visual language — reuse the admin-console session-chip pattern or something lighter; confirmed during Phase 3 design.

## References

- Approved plan: `/Users/sudhindra/.claude/plans/reactive-napping-cosmos.md`.
- Memory: `project_rbac_design_2026-04-18.md` (15 locked decisions), `project_customer_segment_enterprise.md` (why multi-layer).
- Wireframes: customer `/dashboard/settings/members` + role-gated nav — to be authored in `docs/design/screen designs and ux/` per the `feedback_wireframes_before_adrs` convention before Phase 3 starts.
