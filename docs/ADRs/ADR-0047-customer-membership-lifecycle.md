# ADR-0047 — Customer membership lifecycle (role change + remove) + single-account-per-identity invariant

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-18
**Depends on:** ADR-0044 (customer RBAC: 4-level hierarchy, 5-role taxonomy, invitations)
**Supersedes (partially):** S-2 pending item from `docs/reviews/2026-04-18-adr-0044-customer-rbac-review.md` (remove-member RPC + UI). This ADR subsumes S-2, adds role change, and closes a gap in ADR-0044's invitation flow by introducing the single-account-per-identity invariant.

## Context

ADR-0044 shipped the customer-side RBAC primitives — `account_memberships`,
`org_memberships`, the 5-role taxonomy, invitation flow, and
`/dashboard/settings/members` with invite + list-pending + revoke-pending
+ list-members. Role-change and remove on **existing** accepted members
are not wired; the wireframe draws a Remove button next to each member
row but nothing is hooked up, and there is no UI entry point for
changing a member's role from `account_viewer` ↔ `account_owner` or
between `org_admin` / `admin` / `viewer`.

Operational gap: once an account is onboarded, the only way to correct
a mis-assigned role or off-board a departed teammate is a direct SQL
write. For a platform that positions itself as the compliance control
plane for Indian enterprises, that's not acceptable.

This is the customer-app parallel to ADR-0045 (which handles the same
problem on the admin console side). The shapes rhyme but the
constraints differ:

- No `auth.users.raw_app_meta_data` sync is required — customer RLS
  keys off `account_memberships` / `org_memberships`, not JWT claims.
  Pure postgres state machine; no Route-Handler / service-role-key
  orchestration needed.
- Scope gating is two-tier: account-tier actions require account_owner;
  org-tier actions require account_owner OR org_admin of the same org.
- Self-action refusal and last-account_owner refusal are required
  invariants.

User decision during design: no "suspend" semantics. Remove is a hard
delete of the membership row; the user's `auth.users` row is untouched
and they can be re-invited later if needed. Audit rows preserve the
history.

## Decision

Two SECURITY DEFINER RPCs on `public`, a new `public.membership_audit_log`
table for the audit trail, UI wiring on the customer members page, and
an admin-side mirror on the org detail action bar.

Plus a tightening of the existing invitation flow from ADR-0044: the
single-account-per-identity invariant, enforced at invitation creation.

### Single-account-per-identity invariant

Supabase Auth's `auth.users` is a project-level singleton (one
`auth.users` table per Supabase project; emails are globally unique).
ADR-0044 implicitly assumed the model "one human, one identity, many
possible memberships." That model is wrong for ConsentShield's target
market: an auditor engaged by two customer fiduciaries must not be
able to flip between their accounts from a single login, and a
consultant running compliance at two firms should not see both firms'
data from one session. Each engagement owns its own credential.

The invariant:

> For any email `E` on ConsentShield, there exists at most one accepted
> `account_memberships` row. The same physical human may hold multiple
> credentials (`jane@acme.com`, `jane+accountB@acme.com`, etc.), but
> each credential is bound to exactly one account for its lifetime.

Enforcement points:

1. **Invitation creation** — both `public.create_invitation` (UI path)
   and `public.create_invitation_from_marketing` (HMAC path) must
   refuse if the invited email resolves to an `auth.users` row that
   already has an accepted `account_memberships` row on any account
   other than the invite's target account. Error code `42501`,
   message includes the existing account_id so the operator can
   reconcile.
2. **Invitation acceptance** — `public.accept_invitation` rechecks the
   same invariant at accept time (race: an email could be added to
   another account between invite-create and invite-accept). Same
   refusal.
3. **Org-tier invites** — same invariant applies: an email already
   accepted into account X cannot accept an org-tier invite into
   account Y's organisation, because org-tier acceptance implicitly
   creates an account-tier row (the inviter's account).

What this invariant does NOT restrict:

- A single identity can hold multiple `org_memberships` rows, as long
  as every org belongs to the same account (the account's
  account_owner retains control).
- A new invitation after a prior account_memberships row is removed
  (via the `remove_membership` RPC in this ADR) is allowed — the
  invariant only refuses **overlapping** memberships.

### Membership audit trail

A new `public.membership_audit_log` table captures every role-change
and removal. Matches `admin.admin_audit_log` structure for consistency
but lives in `public` because the actors are customer users, not
platform operators. The row carries:

- `id bigserial primary key`
- `occurred_at timestamptz default now()`
- `account_id uuid not null` — always populated (org-tier entries
  look up the org's account via FK)
- `org_id uuid` — populated for org-tier actions, null for account-tier
- `actor_user_id uuid not null` — `auth.uid()` at the time of the action
- `target_user_id uuid not null` — whose membership changed
- `action text` — `'membership_role_change'` | `'membership_remove'`
- `old_value jsonb` — `{role, scope, org_id?}`
- `new_value jsonb` — `{role?, scope?, org_id?}` or null for remove
- `reason text not null check (length(reason) >= 10)`

RLS: SELECT for account_owners of the account_id, admin-JWT bypass.
No INSERT/UPDATE/DELETE from `authenticated` — the RPCs write via
SECURITY DEFINER.

### `public.change_membership_role`

```
public.change_membership_role(
  p_user_id  uuid,
  p_scope    text,         -- 'account' | 'org'
  p_org_id   uuid,         -- required when scope='org', else null
  p_new_role text,
  p_reason   text
)
returns void
```

Gate:
- scope='account' → caller must be account_owner of the target's
  account. Valid `p_new_role` values: `'account_owner'`,
  `'account_viewer'`.
- scope='org' → caller must be account_owner of the org's account OR
  org_admin of the org. Valid `p_new_role` values: `'org_admin'`,
  `'admin'`, `'viewer'`.
- admin-JWT (`app_metadata.is_admin = true`) bypasses both gates.

Refusals:
- `p_user_id = auth.uid()` → cannot change your own role.
- `p_new_role` already equals current role → idempotent no-op (return
  silently).
- demoting the only active `account_owner` on an account → refuse.
- reason length < 10 → refuse.

Writes the audit row before returning.

### `public.remove_membership`

```
public.remove_membership(
  p_user_id uuid,
  p_scope   text,          -- 'account' | 'org'
  p_org_id  uuid,          -- required when scope='org', else null
  p_reason  text
)
returns void
```

Gate: same as `change_membership_role`.

Refusals:
- `p_user_id = auth.uid()` → cannot remove yourself (operator uses
  account-deletion flow instead; out of scope for this ADR).
- scope='account' removing the only remaining account_owner → refuse.
- reason length < 10 → refuse.

Hard `delete` on the membership row. The user's `auth.users` row
survives untouched — they can be re-invited later. If the removed user
had org memberships under the same account and scope='account' was
used, org memberships are NOT cascade-deleted (account removal is
scope-scoped; if operator wants a clean off-board they call
scope='account' first, then explicit scope='org' for any lingering org
memberships — or we add an optional `p_cascade_orgs` boolean in a
follow-up if the UX demands it).

Writes the audit row before the delete.

### UI wiring

**Customer app** — `/dashboard/settings/members`:

- Each row gets a role dropdown (enabled when caller has the required
  gate role, disabled for self-row) with an inline Apply button that
  opens a reason-required confirm modal.
- Each row gets a Remove button (disabled for self-row, disabled when
  the target is the only account_owner) that opens a reason-required
  confirm modal.
- After either action, revalidate the page so the list refreshes.

**Admin mirror** — `admin/src/app/(operator)/orgs/[orgId]/`:

- Action bar gains a "Manage members" panel showing the org's
  memberships with the same change-role / remove controls. Admin-JWT
  bypass makes this straight-line: the RPC accepts all targets.
- Operator actions are recorded in **both** `public.membership_audit_log`
  (actor = admin's auth.uid()) AND `admin.admin_audit_log` (the existing
  impersonation-audit pattern).

## What this ADR does NOT cover

- Suspend / soft-disable. Remove is a hard delete. If we later add
  suspend, it will land as a separate ADR with the `status` column
  already on `account_memberships` repurposed (the column exists but
  only ever carries `'active'` today).
- Cascade removal across scopes (account-remove sweeping org rows). V2
  if the UX demands it.
- Self-removal / account-leave flow. That's a separate user story
  (user-initiated; needs password/OTP re-confirmation; deletion vs.
  demote-to-viewer ambiguity). Out of scope.
- User-initiated email-change or display-name edits. Handled elsewhere
  under the profile settings.

## Implementation plan

### Sprint 1.1 — Migration + RPCs + tests

**Deliverables:**

- [ ] Migration `20260504000001_membership_lifecycle.sql`:
  - `create table public.membership_audit_log (...)` with the columns
    listed above, RLS enabled, SELECT policy for account_owners +
    admin-JWT, REVOKE insert/update/delete from authenticated/anon,
    GRANT all to `cs_orchestrator`.
  - `public.change_membership_role(...)` SECURITY DEFINER.
  - `public.remove_membership(...)` SECURITY DEFINER.
  - Amend `public.create_invitation` + `public.create_invitation_from_marketing`
    to refuse if the invited email resolves to an `auth.users` with an
    existing accepted `account_memberships` row on a different account
    (single-account-per-identity invariant). Same check added to
    `public.accept_invitation` for the accept-time race.
  - Explicit grants: `GRANT EXECUTE ... TO authenticated`; REVOKE from
    anon (per `feedback_supabase_default_function_grants.md`).
- [ ] `tests/rbac/membership-lifecycle.test.ts` covering:
  - account_owner can change an account_viewer's role; audit row
    written.
  - org_admin can change an admin's role within their org; cannot
    touch a different org.
  - account_owner cannot change own role.
  - Demoting last account_owner refused.
  - account_viewer cannot call change_membership_role.
  - Remove happy path deletes row + writes audit.
  - Remove refuses self.
  - Remove refuses last account_owner.
  - admin-JWT bypasses every gate.
  - Idempotent role-change (same role) returns silently.
- [ ] `tests/rbac/single-account-invariant.test.ts` covering:
  - Email with existing accepted account_memberships on Account A:
    `create_invitation` into Account B is refused (42501, error
    message references the existing account_id).
  - Same for `create_invitation_from_marketing`.
  - Accept-time refusal: invitation created legitimately, then
    meanwhile the same email is added to another account (simulated
    via direct cs_orchestrator insert); `accept_invitation` refuses.
  - Org-tier invite into account B for an email already in account A
    is refused.
  - After `remove_membership` on account A, a new invitation into
    account B is accepted (invariant is about **overlapping**
    memberships, not history).

**Status:** `[x] complete` — 2026-04-18

### Test Results (Sprint 1.1)

Run: `bun run test:rls tests/rbac/membership-lifecycle.test.ts tests/rbac/single-account-invariant.test.ts`

- `membership-lifecycle.test.ts` — 10/10 pass
- `single-account-invariant.test.ts` — 5/5 pass
- Full RLS suite after migration: **242/242** (was 212). Zero regressions.

Migration `20260504000001_membership_lifecycle.sql` applied to remote dev DB (`bunx supabase db push`).

### Architecture Changes (Sprint 1.1)

- `public.remove_membership(scope='account')` cascades all `org_memberships` the target holds under the same account, preventing "ghost" access after an account-tier removal. Documented in the RPC comment.
- `public._conflicting_account_for_email` helper checks BOTH `account_memberships` AND `org_memberships` (via `organisations.account_id`) because org-tier-only members don't have an `account_memberships` row today. Without the org-side check the invariant would have a hole for users whose only membership is a `viewer` row on some org.

### Sprint 1.2 — UI wiring (customer + admin mirror)

**Deliverables:**

- [ ] `app/src/app/(dashboard)/dashboard/settings/members/` — extend
  the members table with per-row role dropdown + Remove button; two
  new client components for the confirm modals (role-change and
  remove); server actions wired to the two new RPCs.
- [ ] `admin/src/app/(operator)/orgs/[orgId]/` — "Manage members"
  section; reuses the same server-action layer via the shared
  `@/lib/` boundary, with admin-JWT bypassing the RPC gates. Writes
  a companion `admin.admin_audit_log` row for operator accountability.
- [ ] Wireframe tick: `docs/design/screen designs and ux/consentshield-screens.html`
  Settings → Members subsection already draws Remove; add the role
  dropdown alongside. `docs/admin/design/consentshield-admin-screens.html`
  Org detail panel gets the Manage-members subsection.
- [ ] Browser smoke: self-row controls disabled; last account_owner's
  Remove disabled; role change + remove round-trip on a seeded test
  account.

**Status:** `[ ] planned`

## Test plan

- **Sprint 1.1:** RPC suite above (10 cases). Must pass against live
  dev DB (`bun run test:rls`).
- **Sprint 1.2:** `cd app && bun run test` for any unit pieces on the
  confirm modals; browser smoke on both apps.

## Acceptance criteria

- Every role-change + remove writes exactly one `public.membership_audit_log`
  row with the actor's user_id, a reason ≥10 chars, and a meaningful
  `old_value → new_value` diff (or null new_value for remove).
- No RPC path can leave an account with zero `account_owner` members.
- No RPC path can mutate anyone's `auth.users` row.
- S-2 pending item is closed by this ADR.
- Admin-JWT operator actions also write `admin.admin_audit_log` for
  operator-side forensics.
- Single-account-per-identity invariant holds at all three
  enforcement points (create_invitation, create_invitation_from_marketing,
  accept_invitation). No SQL path leaves a single email with accepted
  `account_memberships` rows on two different accounts.

## Open / deferred

- Cascade-remove across scopes (deferred; add if UX feedback asks).
- Suspend semantics (deferred; reuses existing `status` column).
- User-initiated self-leave (separate ADR).
