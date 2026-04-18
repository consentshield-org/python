# ADR-0045 — Admin user lifecycle (invite + role change)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-18
**Depends on:** ADR-0027 (admin schema + `admin.admin_users` + `admin.admin_audit_log` + `admin.require_admin`), ADR-0044 (customer RBAC invitation primitives — informs the email-invite pattern)
**Related:** V2-A1 in `docs/V2-BACKLOG.md`

> The original stub proposed a parallel `admin.pending_admin_invites` table. The concrete plan below instead extends `admin.admin_users.status` with an `invited` value — one table, one status machine, fewer moving parts. Email delivery uses Supabase Auth's native invite flow (`auth.admin.generateLink({type:'invite'})` + Resend template rendering the generated link) rather than the customer-side `public.invitations` dispatcher — admin invites are platform-ops messages, not customer-facing ones.

## Context

Admin operators currently get created exactly one way — the bootstrap
script `scripts/bootstrap-admin.ts`. The script runs with service-role
credentials, writes `is_admin=true` + `admin_role` to
`auth.users.raw_app_meta_data`, and inserts the matching
`admin.admin_users` row. Everything downstream (the `proxy.ts` Rule 21
gate, every `admin.*` RLS policy, every admin RPC's role check) keys off
the JWT `app_metadata.is_admin` claim.

That works for admin #1. It does **not** work for:

1. **Adding a second operator.** No runtime RPC exists to create an
   admin user. The bootstrap script is gated on zero existing
   `bootstrap_admin` rows (idempotency), so re-running it for a second
   person is a hard error.
2. **Upgrading or downgrading an existing operator.** No RPC exists to
   change `admin_role` (`platform_operator` / `support` / `read_only`)
   or to flip `is_admin` off for a leaver. The bootstrap script is
   one-shot and does not touch either field on existing rows.

Both lifecycle actions have to keep two sources of truth in sync:

- `admin.admin_users` row (postgres-side, what RLS + audit-log use)
- `auth.users.raw_app_meta_data` (JWT source, what the
  `(auth.jwt() -> 'app_metadata' ->> 'is_admin')` checks read)

Supabase Auth is a separate schema owned by its own role; a SECURITY
DEFINER RPC cannot issue `UPDATE auth.users` from a plpgsql body
without additional grants. The realistic primitive is the
service-role admin API (`auth.admin.updateUserById`,
`auth.admin.inviteUserByEmail`), which cannot be called from
postgres — it has to be called from an Edge Function or a Next.js
Route Handler using the service-role key.

## Decision (shape, not detail)

Two flows, both implemented as Next.js Route Handlers in the admin app
using the service-role key, both writing an audit entry before
returning:

### 1. Invite a new admin operator

- Route: `admin/src/app/api/admin/invite/route.ts`
- Gate: caller must have `app_metadata.is_admin === true` and
  `admin_role === 'platform_operator'` (Rule 21 + elevation check).
- Input: `{ email, display_name, admin_role }` where `admin_role` is
  one of the three tiers.
- Steps:
  1. Call `auth.admin.inviteUserByEmail(email, { data: {...}, redirectTo })`
     which sends a Supabase Auth invite email (OR uses ConsentShield's
     Resend template — TBD during design).
  2. Insert `admin.admin_users` row with `status='invited'` (add the
     status value — current check-constraint doesn't include it) or
     keep a parallel `admin.pending_admin_invites` table.
  3. Write `admin.admin_audit_log` entry.
- On acceptance (user clicks the email link and sets a password), a
  post-signup hook (Auth webhook OR explicit `/api/admin/invite/accept`
  endpoint) sets `app_metadata.is_admin=true` + `admin_role=<role>`
  via service role, then flips `admin.admin_users.status` to `active`.

### 2. Change an existing admin's role

- Route: `admin/src/app/api/admin/[adminId]/role/route.ts`
- Gate: caller must be `platform_operator`; cannot change their own
  role; cannot demote the last `platform_operator`.
- Steps (all in one transaction — route handler orchestrates):
  1. Call `auth.admin.updateUserById(adminId, { app_metadata: { ...existing, admin_role: next } })`
  2. `UPDATE admin.admin_users SET admin_role = $1 WHERE id = $2`
  3. `INSERT INTO admin.admin_audit_log ...`
- User must sign out + in to refresh their JWT. Surface this in the UI
  success message.

### 3. Disable an admin

- Existing `admin.disable_admin()` RPC (ADR-0027 Sprint 3.1) handles
  the `admin.admin_users` side. Add a route that also flips
  `app_metadata.is_admin = false` via service role so the JWT check
  fails immediately on next refresh. Without this second step, a
  disabled admin with a still-valid JWT keeps operating until their
  session expires.

## What this ADR does NOT cover

- Hardware-key enrolment / AAL2 ceremony (already in ADR-0027).
- Admin audit-log query UI (already in ADR-0027 or a later admin
  sprint).
- Removing admins (hard delete) — explicitly out of scope. Disable
  only; the FK cascade from `auth.users` is the only hard delete.

## Implementation plan

### Sprint 1.1 — Schema + admin lifecycle RPCs + tests

**Deliverables:**

- [x] Migration `20260503000001_admin_user_lifecycle.sql`:
  - Extend `admin.admin_users.status` check constraint to include `'invited'` (values now: `active / invited / disabled / suspended`).
  - `admin.admin_invite_create(p_user_id uuid, p_display_name text, p_admin_role text, p_reason text)` — SECURITY DEFINER, platform_operator only. Inserts an `admin.admin_users` row with `status='invited'`, `created_by=auth.uid()`. Writes audit-log row. The auth user is created first by the Route Handler (Sprint 1.2) via service-role key; this RPC only records the postgres-side row.
  - `admin.admin_change_role(p_admin_id uuid, p_new_role text, p_reason text)` — platform_operator only. Refuses self-change (`p_admin_id = auth.uid()`). Refuses demoting the last active `platform_operator`. Updates `admin.admin_users.admin_role`. Writes audit-log row. Route Handler syncs `auth.users.raw_app_meta_data.admin_role` after.
  - `admin.admin_disable(p_admin_id uuid, p_reason text)` — platform_operator only. Refuses self-disable. Refuses disabling the last active platform_operator. Sets `status='disabled' / disabled_at=now() / disabled_reason=p_reason`. Writes audit-log row. Route Handler flips `auth.users.raw_app_meta_data.is_admin=false` after.
  - `admin.admin_list()` — platform_operator or support. Returns `(id, display_name, admin_role, status, bootstrap_admin, created_at, disabled_at, disabled_reason)` ordered by status then created_at.
- [x] `tests/admin/admin-lifecycle-rpcs.test.ts` — 11 assertions. All green.

**Status:** `[x] complete` — 2026-04-18

### Sprint 1.2 — Route handlers + Auth-side sync

**Deliverables:**

- [ ] `admin/src/app/api/admin/users/invite/route.ts` — POST. Gate caller at `platform_operator` via proxy + defensive re-check in handler. Creates auth user via `supabase.auth.admin.createUser({ email, email_confirm: true, app_metadata: { is_admin: true, admin_role } })`. Calls `admin.admin_invite_create`. Generates + emails the password-setup link (Supabase `generateLink({ type: 'recovery' })` + Resend). Returns `{ adminId }`.
- [ ] `admin/src/app/api/admin/users/[adminId]/role/route.ts` — PATCH. Calls `admin.admin_change_role`. On success, syncs `app_metadata.admin_role` via `auth.admin.updateUserById`. Response includes a note that the invitee must sign out + back in for the new JWT to carry the role.
- [ ] `admin/src/app/api/admin/users/[adminId]/disable/route.ts` — POST. Calls `admin.admin_disable`. On success, syncs `app_metadata.is_admin=false`. Existing sessions fail at the next `proxy.ts` is_admin check after refresh.
- [ ] Sync-drift tolerance: if the RPC succeeds but the subsequent Auth API call fails, the Route Handler surfaces a 500 with both sides' status so the operator can retry. The RPC side (postgres) is authoritative for RLS + audit; the JWT side follows on next refresh.

**Status:** `[ ] planned`

### Sprint 2.1 — Admin Users panel UI

**Deliverables:**

- [ ] `admin/src/app/(operator)/admins/page.tsx` — server component, fetches `admin.admin_list()` + caller role. Renders list with status pill + Disable / Role-change buttons per row.
- [ ] `admin/src/app/(operator)/admins/admin-list.tsx` — client component; Invite modal, Role-change modal, Disable modal — same modal primitives used by `/billing`, `/security`.
- [ ] `admin/src/app/(operator)/admins/actions.ts` — three server actions wrapping the three Route Handlers (client-to-server indirection so Zod validation lives server-side).
- [ ] Nav flip: add `Admin Users` entry in `admin/src/app/(operator)/layout.tsx` between `Feature Flags` and `Audit Log`. ADR pointer = `ADR-0045`.

**Status:** `[ ] planned`

## Test plan

- **Sprint 1.1 RPC tests:**
  - Platform-operator can call `admin_invite_create`; support cannot (raises).
  - `admin_change_role` happy path flips `admin_role` + writes audit row.
  - `admin_change_role` refuses self-change (`p_admin_id = auth.uid()`).
  - `admin_change_role` refuses demoting last `platform_operator` — simulate by trying to demote the only platform_operator with no other active platform_operators.
  - `admin_disable` happy path sets `status='disabled' + disabled_at + disabled_reason`; audit row.
  - `admin_disable` refuses self-disable.
  - `admin_disable` refuses disabling last active platform_operator.
  - `admin_list` returns rows for platform_operator + support; denies others.
  - Status-constraint smoke: inserting a row with `status='invited'` no longer fails (the ADR-0045 migration extended the check).
- **Sprint 1.2 Route Handler tests:** browser-smoke — invite flow creates auth user + admin_users row + sends email; role change updates both sources; disable flips both sources. Deferred to live smoke after migration + handlers are in place (no Next.js route-handler test harness in this repo today).
- **Sprint 2.1 UI:** browser smoke — list renders; three modals operate end-to-end; self-disable attempt surfaces the server error.

## Acceptance criteria

- Every lifecycle action writes exactly one `admin.admin_audit_log` row with the operator's `admin_user_id`, the reason (≥10 chars), and a meaningful `old_value → new_value` diff.
- No RPC can leave the admin platform with zero active platform_operators.
- No RPC can mutate `auth.users` directly (the Route Handler does that with the service-role key, after the RPC succeeds; the RPC side is authoritative for postgres state).
- Bootstrap flow (`scripts/bootstrap-admin.ts`) continues to work unchanged.
