# ADR-0032: Support Tickets (Admin Panel + Customer-Side Submit)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date proposed:** 2026-04-17
**Date completed:** —

---

## Context

ConsentShield's customer support today is ad-hoc email. As the admin platform grows, operators need a first-class ticket queue with threaded messaging, status lifecycle, and priority flagging — all audit-logged per Rule 22 so responses are as accountable as any other admin action.

Infrastructure shipped with ADR-0027:

- `admin.support_tickets` — ticket record (id, org_id, subject, priority, status, created_by_user_id, assignee_admin_id, metadata).
- `admin.support_ticket_messages` — append-only messages (id, ticket_id, author_user_id OR author_admin_id, body, is_internal_note, attachments).
- RPCs `admin.create_support_ticket` (customer-callable — SECURITY DEFINER but deliberately skips `admin.require_admin`; see ADR-0027 Sprint 3.1 notes), `admin.update_support_ticket`, `admin.add_support_ticket_message`, `admin.assign_support_ticket`.

What is missing:
- The operator UI to browse / filter / drill into tickets and reply.
- The customer-side "Submit ticket" surface. (The "Support sessions" tab shipped in ADR-0029 Sprint 4.1 shows *impersonation* sessions, not support tickets — distinct.)

Wireframe reference:
- Admin: `docs/admin/design/consentshield-admin-screens.html` §3 ("Support Tickets") — metric tiles on top, split view (tickets list + detail/thread).
- Customer: the customer wireframe (`docs/design/screen designs and ux/consentshield-screens.html`) has a placeholder support surface; exact fit confirmed in Sprint 2.1 planning.

## Decision

Two sprints. Sprint 1.1 ships the admin `/support` panel (list + detail + reply + assign + status changes). Sprint 2.1 ships the customer-side "Contact support" surface that calls the existing `create_support_ticket` RPC.

Any admin role can read all tickets (support + read_only included — unlike Organisations where platform_operator gates writes, here support IS the daily-driver role). Only platform_operator or the assigned admin can send replies / change status / reassign.

Messages are append-only — there is no edit, delete, or redaction from the UI. Attachments are deferred to V2 (the schema allows them via a jsonb metadata column but no storage pipeline ships in this ADR).

## Consequences

- Support tickets become the accountable surface for customer communication. Every operator reply is audit-logged; the audit log already shows who replied and when.
- Customer app gains a Contact Support form that creates a ticket server-side. The form collects subject + initial message + (optional) priority self-flag. The customer sees the ticket ID and can follow up via subsequent messages (Sprint 2.1 scope).
- Email notifications (both directions) are out of scope for this ADR. Operators check `/support` manually; customers check their own ticket detail page. Email integration is a follow-up sprint once Resend templates are set up for the ticket flow.

---

## Implementation Plan

### Sprint 1.1: /support admin panel

**Estimated effort:** 3 hours.

**Deliverables:**
- [ ] `admin/src/app/(operator)/support/page.tsx` — Server Component. Four metric tiles at top (Open / Resolved this week / Median first response / Urgent open) + split view. Reads `admin.support_tickets` with joins to `admin.admin_users` (assignee) + `public.organisations` (org name). Default sort: `priority DESC, updated_at DESC` so urgent + recent bubble up.
- [ ] `admin/src/app/(operator)/support/[ticketId]/page.tsx` — detail view with reply surface. Shows ticket header (subject, org, reporter email, created, status dropdown, priority, assignee). Scrollable message thread — customer messages left-aligned, admin messages right-aligned + teal background. Internal notes rendered with a distinct amber stripe.
- [ ] `admin/src/components/support/ticket-table.tsx` — Client Component. Row click navigates to detail. Columns match wireframe (ID, Subject, Org, Priority, Status, Updated).
- [ ] `admin/src/components/support/reply-form.tsx` — textarea + "Send reply" + "Internal note" toggle + "Attach file" (disabled stub; V2). Server Action wraps `admin.add_support_ticket_message`.
- [ ] `admin/src/app/(operator)/support/[ticketId]/actions.ts` — Server Actions: `sendMessage`, `changeStatus`, `assignTicket`, `changePriority`. All four wrap existing RPCs. Status change requires no reason for support role (routine work); reassignment and priority change require reason ≥ 10 chars.
- [ ] `admin/src/components/dashboard-nav.tsx` — wire "Support Tickets" nav to `/support`.

**Testing plan:**
- [ ] Existing `tests/admin/rpcs.test.ts` covers all four ticket RPCs — no new RPC tests needed.
- [ ] `cd admin && bun run build` — /support + /support/[ticketId] compile.
- [ ] Manual: create a synthetic ticket via RPC (psql) → /support lists it → click through → reply → verify message appears in thread → change status to Resolved → verify audit_log row.
- [ ] Cross-role: read_only admin sees list + detail but can't reply (Send button disabled or absent).

**Status:** `[ ] planned`

### Sprint 2.1: Customer-side "Contact support" surface

**Estimated effort:** 2 hours.

**Deliverables:**
- [ ] `app/src/app/(dashboard)/dashboard/support/page.tsx` — customer's support inbox. Lists their org's tickets (filtered by `org_id`, their own + any where they're the reporter). Columns: ID, Subject, Status, Updated. Row click → detail.
- [ ] `app/src/app/(dashboard)/dashboard/support/[ticketId]/page.tsx` — customer-facing ticket detail. Same thread widget as admin, but the reply form submits via `add_support_ticket_message` as a customer (author_user_id set, is_internal_note forced false).
- [ ] `app/src/app/(dashboard)/dashboard/support/new/page.tsx` — Contact Support form. Subject + initial message + priority self-flag (normal / high — urgent is operator-only). Calls `admin.create_support_ticket`.
- [ ] `app/src/components/dashboard-nav.tsx` — add "Support" nav item; badge with open-ticket count.
- [ ] RLS verification: a customer can only see tickets where `ticket.org_id = current_org_id()` AND (they created it OR they are an org admin). Add the RLS policy if not already present; test in `tests/rls/isolation.test.ts`.

**Testing plan:**
- [ ] New RLS test: customer A cannot see customer B's tickets; customer A cannot see tickets in org X they're not a member of.
- [ ] Manual: sign in as a customer → /dashboard/support/new → submit → verify /dashboard/support shows the ticket and a matching row appears in admin's /support.
- [ ] Operator reply flow: operator replies via /support → customer refreshes /dashboard/support/[ticketId] → message visible.

**Status:** `[ ] planned`

---

## Architecture Changes

Possible RLS policy addition on `admin.support_tickets` and `admin.support_ticket_messages` to expose them read-only to the `authenticated` role for the customer-side view, scoped by `org_id` + reporter relationship. Exact shape confirmed in Sprint 2.1 planning — likely a security-invoker view in `public.` that re-exposes the admin table with customer-safe columns only (similar to the `public.org_support_sessions` view from ADR-0027 Sprint 2.1).

If a new view/policy lands, `CHANGELOG-schema.md` gets an entry and `docs/architecture/consentshield-complete-schema-design.md` gets a note.

---

## Test Results

_To be filled per sprint as the work executes._

---

## Risks and Mitigations

- **Customer sees an operator's internal note.** Mitigation: the Sprint 2.1 customer view explicitly filters `is_internal_note = false`. Test in RLS + a focused vitest round-trip.
- **High ticket volume degrades UX.** Mitigation: pagination (50/page) matches other admin panels. Search box filters by subject / ticket ID / org.
- **Email loop** (customer doesn't know operator replied). Out of scope — email notifications in a follow-up ADR once Resend templates exist.

---

## Out of Scope (Explicitly)

- **Attachments.** Schema supports them via jsonb metadata; upload pipeline deferred to V2.
- **Email notifications** (new-reply alerts either direction). Deferred.
- **SLA timers / breach alerts.** The metric tile shows "Median first response" but there is no SLA enforcement or alerting. Deferred.
- **Ticket templates / canned replies.** Deferred.
- **Export tickets to CSV.** Deferred (same pattern as audit-log export if/when added).

---

## Changelog References

- `CHANGELOG-dashboard.md` — per-sprint entries.
- Sprint 2.1 may add `CHANGELOG-schema.md` if a new RLS policy / view lands.

---

*ADR-0032 — Support Tickets. Depends on ADR-0027 (admin schema + RPCs) and ADR-0028 (admin app foundation).*
