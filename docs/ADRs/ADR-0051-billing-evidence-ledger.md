# ADR-0051 — Billing evidence ledger (chargeback-defense capture points)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed — 2026-04-20
**Date:** 2026-04-20
**Phases:** 1
**Sprints:** 2

**Depends on:** ADR-0050 (dispute workspace + evidence bundle assembler)
**Feeds into:** ADR-0052 (automated dispute evidence submission)

## Context

ADR-0050 Sprint 3.2 shipped a dispute workspace whose evidence-bundle assembler pulls from five sources — `public.invoices`, `billing.razorpay_webhook_events`, `admin.admin_audit_log`, `public.accounts`, and any manually-attached files. That covers the most load-bearing evidence but misses two things a Razorpay chargeback-response packet typically wants:

1. **Uniform timeline of account lifecycle events.** Audit rows, webhook rows, and invoice timestamps are in three different shapes with three different time columns. A clean `event_type + occurred_at` timeline across all of them is what operators (and the automated submitter in ADR-0052) need.
2. **"The customer actually used it" proof points.** Things like "invoice email was delivered", "subscription was activated", "customer's plan was adjusted by our operator with reason X" — captured as first-class ledger events, not scattered across audit_log action strings and webhook payload JSON.

This ADR adds `billing.evidence_ledger` as the unified timeline. It is **append-only** and **trigger-driven** — no new application code paths to instrument; the triggers fire off existing writes to `admin.admin_audit_log`, `billing.razorpay_webhook_events`, and `public.invoices`.

### Out of scope

- **Customer-facing ledger view.** Operator-only surface (platform_operator+). Customers already have `/dashboard/support-sessions` for impersonation visibility.
- **Evidence content beyond metadata.** Rule 3 — the ledger stores category names, ids, and references. Never PDF bytes, never payload body content.
- **Dispute-time "live capture" of customer behaviour** (e.g. re-fetch current sessions / banner state). Future work if automated submission needs it.

## Decision

Introduce `billing.evidence_ledger` as a denormalised, append-only log of chargeback-relevant events. Writes via three triggers:

1. **`admin.admin_audit_log` AFTER INSERT** — maps `action` values like `billing_create_refund`, `billing_upsert_plan_adjustment`, `billing_suspend_account`, `billing_restore_account` to ledger event types. Resolves `account_id` from `target_id` (when target_table is `public.accounts`) or from the org's `account_id`. Rows not tied to a billing event are skipped.

2. **`billing.razorpay_webhook_events` AFTER INSERT** — maps webhook `event_type` values (`subscription.*`, `payment.captured`, `payment.failed`, `invoice.paid`, `dispute.*`) to ledger event types. Skips events with no resolved `account_id`.

3. **`public.invoices` AFTER INSERT/UPDATE** — emits `invoice_issued` when `issued_at` transitions null→ts (stamped by `billing_finalize_invoice_pdf`), `invoice_emailed` when `email_delivered_at` transitions, `invoice_voided` when status flips to `void`.

Read path: `admin.billing_evidence_ledger_for_account(account_id, from, to, limit)` — `platform_operator+` scoped. Used by the dispute-bundle assembler to materialise `evidence-ledger.ndjson` inside the ZIP.

### Sprint 1.1 — Schema + triggers + bundle integration (shipped)

**Deliverables:**

- [x] `supabase/migrations/20260630000001_billing_evidence_ledger.sql`:
  - `billing.evidence_ledger` table — append-only, RLS enabled, 17-value event_type CHECK.
  - `billing.record_evidence_event()` helper for future direct-call capture points.
  - Three triggers: `evidence_capture_from_audit_log`, `evidence_capture_from_webhook`, `evidence_capture_from_invoice`.
  - `admin.billing_evidence_ledger_for_account()` SECURITY DEFINER read RPC, `platform_operator+` gated.
- [x] `supabase/migrations/20260630000002_evidence_ledger_grant_fix.sql` — grant the read RPC to `authenticated` so admin sessions can call it via the admin proxy.
- [x] `supabase/migrations/20260630000003_fix_invoice_issued_trigger.sql` — trigger fires on `issued_at` null→ts UPDATE as well as INSERT (the `billing_issue_invoice` RPC creates the row with `issued_at = null`; `billing_finalize_invoice_pdf` stamps it later).
- [x] `admin/src/lib/billing/build-evidence-bundle.ts` — extended with optional `ledger: LedgerEvent[]`; emits `evidence-ledger.ndjson` in the ZIP; returns `ledgerEventCount`.
- [x] `admin/src/app/(operator)/billing/disputes/actions.ts` — `assembleEvidenceBundle` now calls `billing_evidence_ledger_for_account` and passes rows to the bundle builder.

**Testing:**

- [x] `tests/billing/evidence-ledger-triggers.test.ts` — 7/7 PASS: invoice_issued/emailed/voided triggers, audit-log billing_* → ledger, non-billing audit skip, platform_operator access, support tier denied.
- [x] `tests/billing/evidence-bundle.test.ts` — 10/10 PASS (includes 2 new assertions for `evidence-ledger.ndjson`).

**Status:** `[x] complete — 2026-04-20`

### Sprint 1.2 — Expand capture points + admin ledger viewer (shipped)

**Deliverables:**

- [x] `supabase/migrations/20260705000001_evidence_ledger_sprint_1_2.sql`:
  - Extended `event_type` CHECK with `customer_signup`, `rights_request_filed`, `banner_published`.
  - Extended `event_source` CHECK with `account_trigger`, `rights_request_trigger`, `banner_trigger`.
  - Trigger on `public.accounts` AFTER INSERT → `customer_signup`.
  - Trigger on `public.rights_requests` AFTER UPDATE (email_verified_at null→ts) → `rights_request_filed`.
  - Trigger on `public.consent_banners` AFTER UPDATE (is_active false→true) → `banner_published`.
- [x] Rule 3 check: `requestor_email` / `requestor_name` / `requestor_message` are NOT in ledger metadata — only `request_type` + `status` + `request_id` (category + id, never content).
- [x] `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — new "Evidence Ledger" section with compact table (when + event_type + source + ref + metadata preview). Shows first 50; full set always in the bundle ZIP.
- [x] `admin/src/app/(operator)/billing/disputes/actions.ts` — `getDisputeDetail` returns `ledger: LedgerEventRow[]` alongside existing webhook/plan-history rows. `assembleEvidenceBundle` now reuses the same ledger (no double fetch).
- [x] `tests/billing/evidence-ledger-sprint12.test.ts` — 4/4 PASS (customer_signup, rights_request_filed, banner_published fires on transition, banner trigger does NOT fire on unrelated updates).

**Status:** `[x] complete — 2026-04-20`

## Phases 3+: signup via direct-call RPC and admin ledger viewer as standalone panel

Deferred — triggers cover the material events for Sprint 1.1 + 1.2. Extending to more event types (OAuth connection, support ticket filing, admin password reset) is a low-priority backlog item; each new trigger is ~20 lines of SQL and can ship ad-hoc without a new ADR.

## Consequences

**Enables:**
- Dispute bundle ZIP now includes a uniform chargeback timeline (`evidence-ledger.ndjson`) that downstream automation (ADR-0052) can consume without re-aggregating from audit + webhook + invoice sources.
- Trigger-driven capture means zero new application code to maintain per event type; future RPC additions that write through audit_log or webhook_events get ledger rows for free (as long as their action/event_type is mapped).

**Introduces:**
- New append-only table in the `billing.*` schema. No DELETE / UPDATE grants from app-code roles. RLS on.
- Three triggers on hot tables — audit_log / webhook_events / invoices. Insert latency impact is a single additional INSERT per matching row; negligible at dev scale.
- Rule 3 discipline: metadata holds category names + ids + refs. No raw payload bytes; no PII.
