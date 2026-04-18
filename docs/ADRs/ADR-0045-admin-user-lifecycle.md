# ADR-0045 — Admin user lifecycle (invite + role change)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed (stub — no sprint started)
**Depends on:** ADR-0027 (admin schema), ADR-0044 (customer RBAC invitation primitives)
**Related:** V2-A1 in `docs/V2-BACKLOG.md`

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

_Sprint breakdown TBD. Planned when the ADR is promoted from stub to
active._

## Test plan (outline)

- Platform-operator can invite; support cannot invite (403).
- Invite accept sets `is_admin=true` + inserts `admin.admin_users`
  row; duplicate accept fails.
- Role change updates both sources; reflected in fresh JWT.
- Cannot self-demote; cannot demote last platform_operator.
- Disable flips JWT claim; next request from disabled admin's JWT
  fails at the `proxy.ts` Rule 21 gate.
