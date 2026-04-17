# ADR-0032: Support Tickets (Admin Panel + Customer-Side Submit)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17

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
- [x] `admin/src/app/(operator)/support/page.tsx` — Server Component. Four metric tiles at top (Open / Resolved last 7 days / Urgent open / Median first response — placeholder with V2 note). Client-side sort by priority desc → open-statuses-first → created_at desc. Tickets list with 200-row cap, rendered inline rather than a separate `ticket-table` file (table is simple).
- [x] `admin/src/app/(operator)/support/[ticketId]/page.tsx` — detail view. Header (subject, id, reporter, org, opened-at), `TicketControls` (status / priority / assignee), thread (admin right + teal / customer left + zinc / system centred + grey), `ReplyForm`.
- [x] `admin/src/app/(operator)/support/actions.ts` — Server Actions `sendMessage`, `changeStatus`, `changePriority`, `assignTicket`. `sendMessage` needs only a non-empty body (RPC enforces). The other three require reason ≥ 10 chars (schema note: RPC `update_support_ticket` requires reason; the ADR's original "routine work, no reason" plan was wrong — schema always demands it).
- [x] `admin/src/components/support/reply-form.tsx` — textarea + send button. No internal-note toggle this sprint (schema does not model `is_internal_note`; deferred to a schema-amendment follow-up).
- [x] `admin/src/components/support/ticket-controls.tsx` — the three control cards + three modal forms reusing the common `ModalShell / ReasonField / FormFooter` (hoisted in ADR-0036 Sprint 1.1).
- [x] `admin/src/app/(operator)/layout.tsx` — "Support Tickets" nav item live (href=/support).

**Testing plan:**
- [x] `cd admin && bun run lint` — zero warnings.
- [x] `cd admin && bun run build` — 13 routes compile (+ /support and /support/[ticketId]).
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 135/135 (no regression).
- [ ] Manual (deferred until a synthetic ticket exists): create a ticket via psql → /support lists it → click through → reply → verify status auto-transitions to awaiting_customer and audit_log row lands. Will be exercised naturally when Sprint 2.1 ships the customer-side create flow.

**Status:** `[x] complete` — 2026-04-17

### Sprint 2.1: Customer-side "Contact support" surface

**Estimated effort:** 2 hours.

**Deliverables:**
- [x] Migration `20260421000001_customer_support_access.sql` — three SECURITY DEFINER helpers in `public`: `list_org_support_tickets()`, `list_support_ticket_messages(id)`, `add_customer_support_message(id, body)`. All scope via `public.current_org_id()` so a customer cannot see or write to another org's tickets. Customer-message insert auto-transitions status from `awaiting_customer`/`resolved`/`closed` → `awaiting_operator`.
- [x] `app/src/app/(dashboard)/dashboard/support/page.tsx` — inbox via `list_org_support_tickets`. Columns: Subject, Priority, Status, Messages, Opened. Empty-state CTA.
- [x] `app/src/app/(dashboard)/dashboard/support/[ticketId]/page.tsx` — detail + thread via `list_support_ticket_messages`; admin replies rendered teal-left, customer replies zinc-right, system messages centred.
- [x] `app/src/app/(dashboard)/dashboard/support/new/page.tsx` — Contact Support form. Priorities limited to low / normal / high (urgent operator-only at the server action layer).
- [x] `app/src/app/(dashboard)/dashboard/support/actions.ts` — two Server Actions: `createTicket` (wraps `admin.create_support_ticket`) + `replyToTicket` (wraps `public.add_customer_support_message`).
- [x] `app/src/components/support/{new-ticket-form,customer-reply-form}.tsx` — client forms.
- [x] `app/src/components/dashboard-nav.tsx` — "Support" nav item added between Billing and Support sessions.
- [x] `tests/rls/support-tickets.test.ts` — 3 assertions covering cross-tenant read blocking on list_org_support_tickets, list_support_ticket_messages, and add_customer_support_message (+ positive own-tenant cases).

**Note on ADR deviations:**
- ~~The ADR said the customer view "filters is_internal_note = false" — the schema has no is_internal_note column.~~ **Resolved 2026-04-17 post-review:** migration `20260421000002_support_internal_notes.sql` adds `admin.support_ticket_messages.is_internal`, extends `admin.add_support_ticket_message(p_is_internal boolean)`, and filters internal notes out of `public.list_support_ticket_messages`. Admin reply form gains an Internal-Note toggle (amber accent, skips status auto-transition, distinct 🔒 label in the thread).
- Instead of an RLS policy extension on `admin.support_tickets`, we chose the SECURITY DEFINER RPC route — matches the `public.org_support_sessions` precedent from ADR-0027 Sprint 2.1 and keeps the admin-table RLS boundary intact (only admins can SELECT `admin.*` directly; customers go through scoped public helpers).
- Open-ticket count badge in the nav **deferred → formally moved out-of-scope** (see §Out of Scope).

**Testing plan:**
- [x] `tests/rls/support-tickets.test.ts` — 3 assertions covering cross-tenant read/write blocks + positive own-tenant path.
- [x] `cd app && bun run lint` — zero warnings.
- [x] `cd app && bun run build` — all customer routes compile (+ /dashboard/support + /dashboard/support/[ticketId] + /dashboard/support/new).
- [x] `cd app && bun run test` — 42/42 (no regression).
- [x] `cd admin && bun run test` — 1/1 smoke.
- [x] `bun run test:rls` — 138/138 (+3 new support-isolation tests).
- [ ] Manual end-to-end (deferred): sign in as a customer → /dashboard/support/new → submit → verify /dashboard/support shows it and admin /support reflects the same ticket; operator reply → customer sees it after refresh.

**Status:** `[x] complete` — 2026-04-17

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
- **Open-ticket count badge in customer nav.** Open count is already surfaced on the `/dashboard/support` list itself; a nav badge would require a separate per-request count query from the client-side DashboardNav. Cosmetic, not worth the coupling. Formally moved out of scope 2026-04-17 after Sprint 2.1 review.

---

## Changelog References

- `CHANGELOG-dashboard.md` — per-sprint entries.
- Sprint 2.1 may add `CHANGELOG-schema.md` if a new RLS policy / view lands.

---

*ADR-0032 — Support Tickets. Depends on ADR-0027 (admin schema + RPCs) and ADR-0028 (admin app foundation).*
