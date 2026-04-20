# ADR-0050: Admin account-aware billing — issuer entities, invoices, GST, dispute workspace

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Proposed
**Date proposed:** 2026-04-18
**Depends on:**
- ADR-0006 (Razorpay billing + plan gating — provides subscription identity on `accounts`)
- ADR-0034 (Billing Operations — refunds ledger, plan_adjustments, operator tabs)
- ADR-0044 (customer RBAC — `accounts` as billing subject)
- ADR-0048 (Admin Accounts panel + `admin.accounts_list` / `account_detail` / `suspend_account`)
- ADR-0049 (observability ingestion — `sentry_events` verbatim pattern mirrored here for Razorpay webhooks)

**Related (planned, to be shipped as follow-on ADRs):**
- ADR-0051 — Billing evidence ledger (chargeback-defense capture surfaces)
- ADR-0052 — Razorpay dispute evidence auto-submission
- ADR-0053 — GSTR-1 XML generation + filing helpers
- ADR-0054 — Customer-facing invoice + billing portal (`app/`)
- ADR-0055 — Account-scoped impersonation
- ADR-0056 — Per-account feature-flag targeting
- ADR-0057 — Account-level sectoral default templates

---

## Context

Today's admin `/billing` panel is the ADR-0034 "Billing Operations" console — four tabs of operator interventions (payment failures, refunds, comp grants, plan overrides). It is not a billing panel in the customer-facing sense of the word. It cannot answer any of the following questions:

- Which accounts exist and what is each one on?
- When is the next subscription charge due, and for how much?
- What invoices have been issued for this account, and what did each one say?
- Can I see the invoice PDF that was sent to the customer?
- Is the Razorpay side of the world consistent with what we think we billed?
- If a customer opens a chargeback today, can we successfully defend it?

The last question is the load-bearing one. Razorpay disputes arbitrated through the card network / bank require a documented evidence bundle: proof of authorisation, proof of service delivery, invoice with GSTIN + HSN + tax split, proof of invoice delivery by email, proof of payment authorisation (mandate/eNACH/card token), and verbatim webhook history. Without all of that, chargebacks succeed by default and the money walks. The schema + UI we have today can't produce any of it.

A separate but converging concern is that ConsentShield will be marketed and serviced by a different business entity than the one building the software. The invoicing entity is therefore a runtime choice, not a hard-coded constant — its legal name, GSTIN, PAN, registered address, invoice prefix, and financial-year sequence need to be stored as data, not embedded in the codebase.

Finally, the broader admin-account-awareness gap — `/orgs`, support tickets, dashboard tiles, observability panels still treat orgs as flat — has to wait. This ADR is the billing slice; ADRs 0055/0056/0057 will pick up the rest.

---

## Decision

Three sprints, one ADR. No sprint ships in isolation — each leaves the admin console strictly more useful than before and the chargeback-defense surface strictly larger.

### Sprint 1 — Account-shaped `/billing` panel

Rebuild the `/billing` landing route as an **account-indexed** view. Keep the existing four-tab operator console, but move it to `/billing/operations` so the primary `/billing` URL serves the view operators (and any future customer-facing admin-embedded surface) actually want to reach.

Account-billing detail at `/billing/[accountId]` shows:

- Identity header: account name, plan, status, Razorpay customer/subscription ids, billing GSTIN / legal name once captured.
- Subscription state card: current plan, effective plan (comp/override overlay), current period ends at, next charge amount, status.
- Plan history timeline: every plan change sourced from `admin.admin_audit_log` where `event_type` matches `plan_*`.
- Latest invoice card with amount, status, download link (PDF from R2).
- Invoice history table (paged).
- Refunds + active comp + active override, filtered to this account from the existing Sprint 2.1 tables.
- Links: parent account suspend/restore (ADR-0048), Razorpay dashboard deep links, issuer entity used (Sprint 2), GST statement CSV for this account (Sprint 3).

The landing `/billing` itself becomes a compact account list: name, plan, status, current_period_ends_at, last invoice state (`paid` / `overdue` / `pending` / `—`), outstanding balance. Filter bar by status + plan + search. "Operations" and "Issuers" (Sprint 2) are sibling routes.

No schema changes this sprint — it is pure UI reshape on top of the data we already store. Invoice history and latest-invoice cards degrade gracefully to empty while Sprint 2 is pending.

### Sprint 2 — Issuer entities, invoices, GST, verbatim Razorpay webhook store

Four things land together because they form the minimum consistent invoice-issuance surface.

**2.A — `billing.issuer_entities`** — the legal entity that issues invoices. Schema columns:

```
id                           uuid pk
legal_name                   text not null
gstin                        text not null (15-char format validated)
pan                          text not null (10-char validated)
registered_state_code        text not null (2-char, e.g. 'KA')
registered_address           text not null
invoice_prefix               text not null (e.g. 'CS')
fy_start_month               smallint not null default 4 (April India FY)
logo_r2_key                  text null
signatory_name               text not null
signatory_designation        text null
bank_account_masked          text null (last 4 only)
is_active                    boolean not null default false
activated_at                 timestamptz null
retired_at                   timestamptz null
created_at                   timestamptz not null default now()
updated_at                   timestamptz not null default now()
```

Constraint: at most one row with `is_active = true AND retired_at IS NULL`.

**Access discipline (platform-owner surface).** ADR-0045's admin_role enum is extended with a new top tier `platform_owner`. The enum becomes `platform_owner > platform_operator > support > read_only`. A migration seeds `platform_owner` onto the founder's `auth.users` row; it is never granted via admin-invite (ADR-0045's invite flow caps at the inviter's own tier, so `platform_operator` cannot elevate anyone). Emergency recovery is via SQL migration with service-role key, which the founder holds.

Read access (`list` + `detail`) is available to `platform_operator` and above — operators need to know which issuer is live to reason about invoices. Write access (`create`, `update`, `retire`, `activate`, `hard_delete`) is `platform_owner` only.

**Immutability rule — identity fields.** Once any invoice references an issuer, changing the identity fields of that issuer would silently rewrite the legal content of already-issued invoices. Therefore the update RPC **rejects** any patch that touches:

- `legal_name`
- `gstin`
- `pan`
- `registered_state_code` (changes IGST vs CGST/SGST determination)
- `invoice_prefix` (breaks FY sequence continuity)
- `fy_start_month`

To change any of those, the operator must retire the current issuer and create a new one. Previous invoices keep their original issuer linkage and their full GST lineage.

Update **is allowed** (with audit row) on the operational fields:

- `registered_address` (typo fixes, GST-portal-amendment non-core changes)
- `logo_r2_key`
- `signatory_name`
- `signatory_designation`
- `bank_account_masked`

**CRUD surface** — all RPCs `SECURITY DEFINER`, audit-logged, with the tier gating above:

- `admin.billing_issuer_list()` — platform_operator+ read
- `admin.billing_issuer_detail(p_id uuid)` — platform_operator+ read
- `admin.billing_issuer_create(p_legal_name, p_gstin, p_pan, p_registered_state_code, p_registered_address, p_invoice_prefix, p_fy_start_month, p_signatory_name, p_signatory_designation, p_bank_account_masked, p_logo_r2_key)` — platform_owner only
- `admin.billing_issuer_update(p_id uuid, p_patch jsonb)` — platform_owner only; validates that `p_patch` contains only mutable-field keys; raises on any immutable-field key
- `admin.billing_issuer_activate(p_id uuid)` — platform_owner only; enforces at-most-one-active invariant
- `admin.billing_issuer_retire(p_id uuid, p_reason text)` — platform_owner only; sets `retired_at` + `is_active=false`; reason required (≥10 chars)
- `admin.billing_issuer_hard_delete(p_id uuid)` — platform_owner only; **rejects** if any `public.invoices` row references the id; pure dev-state cleanup escape hatch

Admin panel at `/billing/issuers`: list visible to operators (read-only); owner sees `+ New`, `Edit`, `Retire`, `Activate`, `Delete` actions; non-owners see the actions as disabled with the tooltip "platform_owner required". "No active issuer" is a valid system state; in that state invoice issuance RPCs raise a clear error ("Configure billing issuer entity before issuing invoices") instead of silently succeeding.

**2.B — `public.accounts` billing-profile columns** (nullable, required at first invoice issuance):

```
billing_legal_name    text null
billing_gstin         text null (optional — customer may be unregistered)
billing_state_code    text null (2-char — drives IGST vs CGST+SGST)
billing_address       text null
billing_email         text null (defaults to account_owner's email)
billing_profile_updated_at  timestamptz null
```

Editable by `account_owner` on the customer side (ADR-0054 when that ships) and by `platform_operator` on the admin side.

**2.C — `public.invoices`** — canonical invoice record.

```
id                        uuid pk
issuer_entity_id          uuid not null → billing.issuer_entities(id)
account_id                uuid not null → public.accounts(id)
invoice_number            text not null        (e.g. 'CS/2026-27/000042' — FY-sequential per issuer)
fy_year                   text not null        ('2026-27')
fy_sequence               integer not null     (42)
period_start              date not null
period_end                date not null
issue_date                date not null default current_date
due_date                  date not null
currency                  text not null default 'INR'
line_items                jsonb not null       (see schema below)
subtotal_paise            bigint not null
cgst_paise                bigint not null default 0
sgst_paise                bigint not null default 0
igst_paise                bigint not null default 0
total_paise               bigint not null
status                    text not null check (status in
                              ('draft','issued','paid','partially_paid','overdue','void','refunded'))
razorpay_invoice_id       text null
razorpay_order_id         text null
pdf_r2_key                text null
pdf_sha256                text null           (hex; set once pdf_r2_key is set)
issued_at                 timestamptz null
paid_at                   timestamptz null
voided_at                 timestamptz null
voided_reason             text null
email_message_id          text null           (Resend message id)
email_delivered_at        timestamptz null
notes                     text null
created_at                timestamptz not null default now()
updated_at                timestamptz not null default now()
unique (issuer_entity_id, fy_year, fy_sequence)
unique (issuer_entity_id, invoice_number)
```

`line_items` JSON schema:

```
[
  { "description": "ConsentShield Growth plan — Apr 2026",
    "hsn_sac": "9983",
    "quantity": 1,
    "unit_price_paise": 499900,
    "amount_paise": 499900 }
]
```

RLS: admin read via RPCs only. Customer-side read (ADR-0054) will go through `organisation_members → accounts` join against the account_owner role.

**Invoices are immutable.** CGST Act §36 requires invoice retention for at least 8 years; beyond the legal minimum, the chargeback-defense posture in ADR-0052 depends on invoices surviving forever in verifiable form. The schema enforces this:

- `REVOKE DELETE ON public.invoices FROM PUBLIC, authenticated, cs_admin, cs_orchestrator, cs_delivery, cs_worker` — no role in running application code can delete an invoice row.
- `UPDATE` is restricted to a narrow allow-list of columns via a `BEFORE UPDATE` trigger: `status` (constrained to the defined transitions), `paid_at`, `razorpay_invoice_id`, `razorpay_order_id`, `pdf_r2_key`, `pdf_sha256`, `issued_at`, `voided_at`, `voided_reason`, `email_message_id`, `email_delivered_at`. Any attempt to mutate `issuer_entity_id`, `account_id`, `invoice_number`, `fy_year`, `fy_sequence`, `line_items`, or any `*_paise` column raises. Status `void` is the one legal cancellation path; it requires a reason and produces an audit row. Voided invoices are not deleted — they remain in the record with `status='void'`.
- R2 PDFs are stored with Object Lock-style immutability: once uploaded, the object key is not overwritten. Any re-issue produces a new invoice row with its own PDF key; the original stays.
- `billing.issuer_entities.id` is referenced `ON DELETE RESTRICT` — the FK guarantees that any retired issuer is still queryable for every invoice it ever issued.

**Invoice visibility + export scope.** Two tiers, with a clean rule:

- **`platform_operator` — current-issuer scope.** List, search, view, and export invoices **where `issuer_entity_id` equals the currently-active issuer**. This is the operational lens: the staff running the servicing entity see and export what that entity issued. If no issuer is active, the operator scope is empty.
- **`platform_owner` — all-time, all-issuer scope.** Full historical lens, including invoices issued by retired issuers. This is the founder's records lens.

A retired issuer is, by definition, a distinct legal entity (identity-field change forced retire + create). Its invoices belong with that entity's original operational and ownership relationship, not the currently-active operator. Operators of a later issuer do not get retroactive visibility into what a previous issuer issued — that record stays with the owner.

The RPCs enforce the rule server-side, not in the UI:

- `admin.billing_invoice_list(p_account_id uuid, p_limit int default 50)` — platform_operator+ read; the RPC intersects the requested account with the currently-active issuer when the caller is `platform_operator`, and returns the full history when the caller is `platform_owner`.
- `admin.billing_invoice_detail(p_invoice_id uuid)` — same rule: operators can read invoices only for the currently-active issuer; owner can read any invoice.
- `admin.billing_invoice_export_manifest(p_issuer_id uuid default null, p_fy_year text default null, p_account_id uuid default null)` — for `platform_operator` callers, `p_issuer_id` is forcibly clamped to the currently-active issuer id; passing any other id raises. For `platform_owner` callers, `p_issuer_id` is free-form and can target any issuer including retired ones; omit to span all. Returns the manifest columns: `invoice_number, issuer_entity_id, issuer_legal_name_snapshot, account_id, account_name_snapshot, issue_date, total_paise, status, pdf_r2_key, pdf_sha256`.
- Export server action (also tier-gated) downloads each PDF from R2 into a ZIP with `index.csv` at the top, streamed to the caller. The export is audit-logged with caller role, filter parameters, row count, and the produced ZIP's SHA-256.

Invoice export is built in Sprint 3.1 alongside the GST statement. The GST statement RPC follows the same scope rule — operators get current-issuer only, owner gets any issuer.

**GST computation rule** (enforced in the issuance RPC, not the app):

```
if issuer.registered_state_code = account.billing_state_code:
    cgst = round(subtotal * 0.09)         -- 9%
    sgst = round(subtotal * 0.09)         -- 9%
    igst = 0
else:
    cgst = 0
    sgst = 0
    igst = round(subtotal * 0.18)         -- 18%
total = subtotal + cgst + sgst + igst
```

All monetary columns are `bigint` in paise — no floating-point anywhere. HSN/SAC defaults to `9983` (IT services) but is per-line-item.

**2.D — `billing.razorpay_webhook_events`** — verbatim, signature-verified, append-only. Pattern mirrors ADR-0049 `sentry_events`.

```
id                 uuid pk
event_id           text not null unique   (Razorpay x-razorpay-event-id)
event_type         text not null          (e.g. 'invoice.paid', 'subscription.activated', 'dispute.created')
signature_verified boolean not null
signature          text not null          (x-razorpay-signature header)
payload            jsonb not null         (verbatim)
account_id         uuid null → public.accounts(id)  (resolved via payload.subscription_id or payload.customer_id)
received_at        timestamptz not null default now()
processed_at       timestamptz null
processed_outcome  text null              ('ok' | 'error: ...')
```

Write-only from the webhook handler; the app layer reads for reconciliation. Retention: indefinite for disputed events, 7 years for everything else (DPDP / audit minimums). A follow-on V2 task will wire retention; for now rows are kept forever.

The existing `app/src/app/api/webhooks/razorpay/route.ts` handler is refactored: its first action becomes *insert verbatim into this table*, then it runs its existing state-mutation logic, then it stamps `processed_at + processed_outcome`. If the handler errors mid-way, the verbatim row survives.

**Invoice issuance flow** (admin RPC `admin.billing_issue_invoice(p_account_id, p_period_start, p_period_end, p_line_items jsonb)` → uuid):

1. Load active issuer, reject if none.
2. Validate `accounts.billing_*` fields present.
3. Compute FY year + next sequence under a `SELECT … FOR UPDATE` on the issuer row.
4. Insert `public.invoices` row with `status='draft'`.
5. Emit PDF via Node-side renderer (templated HTML → Chromium via a Next.js API route running on Vercel Fluid Compute, or a dedicated `app/src/lib/billing/render-invoice.ts` helper using PDFKit — decided in Sprint 2.2 implementation; PDFKit preferred for zero-dep).
6. Upload to R2 at `invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf`, record `pdf_r2_key + pdf_sha256`.
7. Flip `status='issued'`, send email via Resend, capture `email_message_id`.
8. Return invoice id.

Resend delivery webhook (already wired for OTP / rights emails) updates `email_delivered_at` when the message lands.

### Sprint 3 — GST statement + dispute workspace

**3.A — `admin.billing_gst_statement(p_issuer_id, p_fy_start, p_fy_end)`** — returns per-invoice CGST / SGST / IGST breakdown suitable for GSTR-1 filing.

Columns in the result set:
```
invoice_number, invoice_date, customer_legal_name, customer_gstin,
customer_state_code, place_of_supply, hsn_sac, taxable_value_paise,
cgst_paise, sgst_paise, igst_paise, total_paise, status
```

Admin UI at `/billing/gst-statement`: issuer + FY selector, CSV download, summary card (totals by tax head). No ITC input side — this is outbound-only. GSTR-1 XML is ADR-0053.

**3.B — Dispute workspace**. Razorpay `dispute.created` / `dispute.closed` webhooks land in `billing.razorpay_webhook_events` automatically (Sprint 2.D). A new `public.disputes` table denormalises the active-dispute view:

```
id                    uuid pk
razorpay_dispute_id   text not null unique
account_id            uuid not null
razorpay_payment_id   text null
amount_paise          bigint not null
reason_code           text not null
status                text not null  ('open','under_review','won','lost','closed')
deadline_at           timestamptz null
opened_at             timestamptz not null
closed_at             timestamptz null
evidence_bundle_r2_key text null
evidence_submitted_at timestamptz null
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

Admin UI:

- `/billing/disputes` — list, filter by status + deadline.
- `/billing/disputes/[disputeId]` — detail: payment + invoice context, webhook events timeline, actions.

Actions (Sprint 3 lands the first; the rest wait for ADR-0051's evidence ledger):

- **Assemble evidence bundle** → packs invoice PDF, verbatim webhook events for the subscription/payment, plan history rows, account billing profile, and any manually-attached files into a ZIP at `disputes/{dispute_id}/evidence-{iso}.zip` in R2. Records `evidence_bundle_r2_key`. Operator downloads and uploads to Razorpay dashboard (automated submission is ADR-0052).
- **Mark submitted / won / lost / closed** — operator-driven state flips with reason + audit row.

When ADR-0051 ships, the bundle assembler pulls evidence_ledger rows as well.

### Non-goals for ADR-0050

- **Customer-facing invoice download** — the customer app gets invoice access in ADR-0054, not here.
- **Automated Razorpay dispute evidence submission** — ADR-0052.
- **GSTR-1 XML** — ADR-0053. This ADR ships CSV only.
- **Evidence ledger capture points** across signup / rights / webhooks / admin actions — ADR-0051. This ADR only ships the bundle-assembly action that ADR-0051 will later feed.
- **Refactor of ADR-0034's operator tabs** — they move route but their internals stay unchanged. Payment failures / refunds / comps / overrides work as shipped.
- **Paging or cursoring on the invoice list** — at dev scale the per-account list is bounded; if dev scale grows past a few hundred we add pagination. Account list paging was deferred in ADR-0048 on the same logic.
- **Accounts mega-list cross-filtering with orgs / tickets / observability** — handled in ADR-0055 / 0056 / 0057.

---

## Consequences

**Enables:**
- First complete answer to "what did we bill this account for and when?" inside the admin console.
- GST-compliant outbound invoicing that can change issuing entity by data update, not code change.
- Foundation for chargeback defense — once ADR-0051 fills in the evidence ledger and ADR-0052 automates submission, the full dispute response flow closes.
- A clean seam where the customer app (ADR-0054) can later surface the same invoice PDFs to `account_owner` without re-implementing invoice storage.

**Introduces:**
- **Rule 19** (to be added to CLAUDE.md): *Invoice issuance requires an active `billing.issuer_entities` row. No hard-coded issuer identity — legal name, GSTIN, PAN, registered state, invoice prefix, and signatory must be read from the issuer row at issuance time. Identity fields (legal_name, gstin, pan, registered_state_code, invoice_prefix, fy_start_month) are immutable once set; identity changes require retire + create. Invoices in `public.invoices` are immutable and can be produced only with a complete history export by the platform_owner.*
- A new admin role tier `platform_owner`, dominating `platform_operator`. Seeded by migration onto the founder's auth.users row; not grantable via admin-invite. Gates the full write side of `billing.issuer_entities` and the full historical (all-issuer, including retired) invoice visibility + export surface. `platform_operator` retains operational visibility — list, search, view, and export invoices scoped to the currently-active issuer. ADR-0045's role hierarchy and `admin.require_admin` helper are extended accordingly.
- A new operational surface: the active-issuer row. Retiring/rotating it is an auditable event. Invoices before retirement keep their original issuer linkage; invoices after the next activation use the new issuer's FY sequence.
- Invoice immutability enforced at the database level — no DELETE grant in any app-code role, UPDATE constrained by trigger to an allow-list of mutation-safe columns, schema-level FK guarantees retired issuers stay queryable forever.
- R2 as the canonical invoice PDF store. Every invoice gets a content hash recorded at the moment the PDF is uploaded, which is the anchor for chargeback defense.
- A new verbatim-webhook pattern for Razorpay (alongside ADR-0049's Sentry verbatim store). Future chargeback defense depends on this being present before the dispute happens, not after.

**Hard constraints this ADR does not violate:**
- Rule 2 (append-only) — `billing.razorpay_webhook_events` is append-only from the webhook path; `processed_at / processed_outcome` updates are confined to a `SECURITY DEFINER` RPC that only the webhook handler calls, not the `authenticated` role.
- Rule 3 (no FHIR) — unchanged.
- Rule 5 (scoped roles) — invoice issuance RPCs run under `cs_admin` via existing admin RPC pattern; Razorpay webhook handler continues to use `cs_orchestrator`; the new verbatim-insert is an additional grant on that role.
- Rule 13 (RLS) + Rule 14 (org_id) — `public.invoices` has `account_id` and routes all customer access through `organisation_members → organisations.account_id`. `public.disputes` likewise. `billing.issuer_entities` is admin-only and exempt from org_id on the same basis as `admin.*` tables.
- Rule 15 (no new deps) — PDFKit is a permitted exception (one day of work to ship, eliminates permanent dependency on a heavier browser-rendering stack). Will be justified in the PR description when Sprint 2 lands.

---

## Implementation plan

### Sprint 1 — Account-shaped `/billing` panel

**Estimated effort:** 1–2 sessions.

**Deliverables:**

- [x] `admin/src/app/(operator)/billing/page.tsx` — rebuilt as account list. Reuses `admin.accounts_list`, shows N-with-payment-failures pill, stub "Last invoice" column until Sprint 2.
- [x] `admin/src/app/(operator)/billing/[accountId]/page.tsx` — detail with subscription + Razorpay + balance cards, latest-invoice stub, plan history timeline, active adjustments, refunds table (filtered client-side to this account).
- [x] `admin/src/app/(operator)/billing/operations/page.tsx` + `billing-tabs.tsx` + `actions.ts` — existing content relocated verbatim; import path fix for `suspendAccountAction`; `revalidatePath('/billing', 'layout')` so the landing + operations sub-route refresh together.
- [x] `admin.billing_account_summary(p_account_id)` RPC shipped in `20260507000003_billing_account_summary.sql` — subscription state + chronological plan_history (base + grants + revocations) + outstanding_balance_paise (0).
- [x] Nav split: `Billing` (/billing) + `Billing Operations` (/billing/operations). Issuers entry reserved for Sprint 2.
- [x] Admin build compiles; `bun run lint` clean on `admin/`.

**Testing plan:**

- [x] `tests/admin/billing-account-view.test.ts` — **3/3 PASS**. Base plan-history event present on account creation; missing-account raises; grant/revoke produce distinct chronological events sharing `adjustment_id` with opposite `action`; `effective_plan_code` tracks through grant/revoke correctly.
- [x] Manual: Operator loaded `/billing`, exercised the filter bar — working after bug-332 fix (empty-string dropdown value was being forwarded to the RPC; now coerced to null).
- [x] Manual regression: `/billing/operations` shows the pre-existing ADR-0034 four-tab console unchanged (Refunds / Comps / Overrides counts preserved). `/billing/operation` (singular typo) now returns 404 instead of exposing the raw Postgres UUID-cast error (bug-333 fix).

**Status:** `[x] complete` — 2026-04-18

### Sprint 2 — Issuer entities, invoices, GST, Razorpay webhook verbatim store

**Estimated effort:** 3 sessions.

#### Sprint 2.1 — Schema + issuer admin panel + Razorpay verbatim store

**Deliverables:**

- [x] Migration `20260507000004_admin_role_platform_owner.sql` + follow-up `20260507000005_platform_owner_followup.sql`:
  - Extended `admin_role` CHECK to include `platform_owner`.
  - Extended `admin.require_admin(p_min_role text)` so `platform_owner` dominates `platform_operator` dominates `support`.
  - Seeded `platform_owner` idempotently onto the founder's `auth.users` + `admin.admin_users` rows (match by email). Migration emits NOTICE + skips when the founder row doesn't exist yet.
  - `admin_invite_create` rejects `platform_owner` grants; `admin_change_role` rejects `platform_owner` as new role and rejects mutating an existing `platform_owner` row; `admin_disable` rejects disabling `platform_owner`.
  - UI tier alignment: new `admin/src/lib/admin/role-tiers.ts` helper + 11 admin-console sites switched from `adminRole === 'platform_operator'` to `canOperate(adminRole)` so `platform_owner` users retain UI action buttons.
  - Test: `tests/admin/platform-owner-role.test.ts` **7/7 PASS**. Regression 52/52 PASS across admin-RPC tests.
- [ ] Migration `supabase/migrations/YYYYMMDD_billing_issuer_and_invoices.sql`:
  - `billing` schema creation (if not exists) + grants.
  - `billing.issuer_entities` as specified above + single-active-issuer constraint + identity-field immutability trigger (`BEFORE UPDATE` raise if `NEW.legal_name|gstin|pan|registered_state_code|invoice_prefix|fy_start_month` differ from `OLD.*`).
  - `public.accounts` billing-profile columns (nullable).
  - `public.invoices` + unique indexes + RLS + immutability triggers:
    - `BEFORE UPDATE` allow-list trigger — raises if any column outside the Sprint 2 allow-list changes.
    - `REVOKE DELETE ON public.invoices FROM PUBLIC, authenticated, cs_admin, cs_orchestrator, cs_delivery, cs_worker` — no role in app code can delete.
  - `billing.razorpay_webhook_events` + insert policy for `cs_orchestrator`.
  - RPCs: `admin.billing_issuer_list` + `admin.billing_issuer_detail` (platform_operator+ read); `admin.billing_issuer_create`, `admin.billing_issuer_update`, `admin.billing_issuer_activate`, `admin.billing_issuer_retire`, `admin.billing_issuer_hard_delete` (platform_owner only). All `SECURITY DEFINER`, audit-logged. `billing_issuer_update` validates `p_patch jsonb` keys against the mutable-field allow-list and raises on immutable-field keys with a clear message ("Immutable field `{name}` — retire the current issuer and create a new one to change identity").
- [ ] Refactor `app/src/app/api/webhooks/razorpay/route.ts` — verbatim-insert first, existing logic second, `processed_at` stamp third. Signature-verification path unchanged (already present).
- [ ] `admin/src/app/(operator)/billing/issuers/page.tsx` + `actions.ts` — list visible to all operators (read-only); owner sees `+ New`, `Edit`, `Retire`, `Activate`, `Delete` actions; non-owners see disabled buttons with the tooltip "platform_owner required". `Edit` form hides the immutable fields (renders them as read-only with a note) and submits only mutable fields. `Activate` enforces the one-active constraint via the RPC layer. `Delete` is hidden unless the row has zero invoice references.
- [ ] Nav: "Issuers" entry added under Billing section — visible to platform_operator+ (so operators see the active issuer), write-gated at the action level.

**Testing plan:**

- [ ] `tests/admin/billing-issuer-rpcs.test.ts` — create + activate + retire + at-most-one-active invariant; reject second simultaneous activation; `support` role denied.
- [ ] `tests/webhooks/razorpay-verbatim.test.ts` — happy path insert; duplicate-event-id upsert behaviour; signature-verification failure path does *not* write a verbatim row (we only persist signature-verified events).
- [ ] Miniflare / fetch-mocked webhook test: replay one `invoice.paid` fixture, assert row lands with `processed_outcome='ok'` and `processed_at IS NOT NULL`.

**Status:** `[x] complete` — 2026-04-18. Chunk 1 landed platform_owner tier + UI alignment (7/7 + 52/52 regression). Chunk 2 landed billing schema + issuer_entities + CRUD RPCs + admin UI (21/21). Chunk 3 landed accounts billing-profile + public.invoices + immutability triggers + billing.razorpay_webhook_events verbatim store + webhook handler refactor + `admin.billing_webhook_event_detail` (10/10 + 6/6; full suite 194/194). Manual UI verification for `/billing/issuers` pending.

#### Sprint 2.2 — Invoice PDF renderer + issuance RPC + GST computation

**Deliverables:**

- [x] `admin/src/lib/billing/render-invoice.ts` — PDFKit-based renderer, templated from issuer + invoice + line items. Outputs `Uint8Array`. Deterministic — `CreationDate` is stamped from `invoice.issue_date` so identical inputs produce byte-identical output. Location moved from `app/` to `admin/` so the renderer never reaches the customer app (Rule 12 isolation).
- [x] `admin/src/lib/billing/r2-invoices.ts` — R2 client wrapper over an admin-side copy of the ADR-0040 sigv4 helper (`admin/src/lib/storage/sigv4.ts`). Uploads under `invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf`, returns `{r2Key, sha256, bytes}`. Per the monorepo "share narrowly" discipline, infrastructure glue is duplicated across `app/` and `admin/` rather than promoted to a shared package.
- [x] `admin/src/lib/billing/resend-invoice.ts` — Resend REST dispatch with the PDF attached as base64. No `@resend/node` dependency (Rule 15).
- [x] Migration `20260508000001_billing_issue_invoice_rpc.sql` — `public.billing_compute_gst` + `admin.billing_issue_invoice` + `admin.billing_finalize_invoice_pdf` + `admin.billing_stamp_invoice_email` + `admin.billing_invoice_pdf_envelope` (read surface that replaces three PostgREST round-trips blocked by the `authenticated`-role revoke on `public.invoices`). Follow-up `20260508000002_billing_finalize_role_column_fix.sql` re-creates the two finalize functions with the correct `admin_role` column name (the originals referenced `role`).
- [x] `admin/src/app/api/admin/billing/invoices/issue/route.ts` — admin-only route handler behind the admin proxy (`is_admin` + AAL2 enforced one layer up). Calls the issuance RPC to reserve the sequence, loads the envelope RPC, renders the PDF, uploads, stamps `pdf_r2_key + pdf_sha256 + status='issued' + issued_at`, sends Resend email, stamps `email_message_id`. Returns the issued envelope.
- [x] GST computation unit-tested at the RPC layer (SQL) — not in TypeScript. SQL is the system of record for money arithmetic.

**Testing plan:**

- [x] `tests/billing/gst-computation.test.ts` — **11/11 PASS** (bunx vitest run 2026-04-19). Intra-state → CGST+SGST split 9/9; inter-state → IGST 18; null customer state → IGST (registration-agnostic); case-insensitive intra match; odd-paise remainder on SGST (333 subtotal → cgst=29, sgst=30); zero subtotal → zeros; custom rate 5% → 2500/2500/0; negative subtotal raises; rate_bps > 10000 raises; missing issuer_state raises.
- [x] `tests/billing/issue-invoice.test.ts` — **13/13 PASS**. First invoice fy_sequence=1 + invoice_number=`<prefix>/2026-27/0001` + CGST+SGST split; second fy_sequence=2; FY-boundary period raises; support-role denied; empty / non-array / missing-amount line_items raise; missing account `billing_email` raises; no-active-issuer raises; finalize flips draft → issued; finalize on non-draft raises; stamp_email on issued succeeds; stamp_email on draft raises; support cannot finalize; sha256 length enforced.
- [x] Full repo suite `bun run test:rls` — **343/343 PASS** across 34 test files. Admin + app builds + lints clean.
- [ ] Manual: operator clicks "Issue invoice" on an account, sees the PDF in R2, receives the email at the test billing address. (Pending infra action: set `R2_INVOICES_BUCKET` + `RESEND_FROM` on the admin Vercel project; flip one issuer to active.)

**Status:** `[x] complete` — 2026-04-19. PDF rendering, R2 upload, Resend dispatch, and the three admin RPCs are shipped and tested end-to-end at the DB layer; manual I/O verification pending the Vercel env-var setup listed above.

#### Sprint 2.3 — Invoice history + latest-invoice integration on account detail

**Deliverables:**

- [x] Account billing detail page — latest-invoice card + invoice history table (up to 50 rows) populated from `admin.billing_invoice_list`. Retired-issuer rows badged `retired` and visible only to platform_owner. Balance card replaced with real `outstanding_balance_paise` from `admin.billing_account_summary`.
- [x] Download link → short-TTL (5 min) signed R2 URL via new Route Handler `GET /api/admin/billing/invoices/[invoiceId]/download`. Handler calls `admin.billing_invoice_detail` first so the tier + issuer-scope rule gates access before any presign call.
- [x] `admin.billing_invoice_list(p_account_id, p_limit default 50)` + `admin.billing_invoice_detail(p_invoice_id)` RPCs shipped — both enforce the scope rule server-side: `platform_operator` callers see only current-active-issuer invoices; `platform_owner` callers see all history including retired issuers. Accessing a retired-issuer invoice as operator raises with a scope-scoped error.
- [x] Razorpay webhook reconciliation — `public.rpc_razorpay_reconcile_invoice_paid` matches by `razorpay_invoice_id` first, falls back to `razorpay_order_id`. Flips matching `public.invoices.status` → `paid` and stamps `paid_at` idempotently. Orphans are non-errors; the caller stamps `billing.razorpay_webhook_events.processed_outcome = 'reconcile_orphan:<reason>'` so the verbatim row surfaces the miss. `app/src/app/api/webhooks/razorpay/route.ts` handles the `invoice.paid` branch before the subscription-event path.
- [x] Admin landing account-list's "Last invoice" column now reflects real data via new `admin.billing_accounts_invoice_snapshot()` — one row per account with latest invoice + status pill. Scope rule identical to `billing_invoice_list`.
- [x] Follow-up migration `20260509000003_billing_invoice_order_tiebreak.sql` — adds `created_at desc` as the final ORDER BY tie-break on all three invoice-reading RPCs so same-calendar-day invoices under different issuers resolve deterministically.

**Testing plan:**

- [x] `tests/billing/webhook-reconciliation.test.ts` — **5/5 PASS**. Match by razorpay_invoice_id flips issued→paid + paid_at set; idempotent re-run (already-paid, no mutation); order_id fallback works when invoice_id absent; orphan id returns matched=false without error; empty matcher returns matched=false reason='no matcher'.
- [x] `tests/admin/billing-invoice-list.test.ts` — **14/14 PASS**. Scope rule (operator current-active-only; owner all issuers); newest-first ordering; p_limit honoured; support denied; detail raises for operator on retired-issuer invoice, allowed on active; missing invoice raises; latest_invoice + outstanding_balance_paise correct post-finalize; accounts_invoice_snapshot scope.
- [x] `tests/billing/issuer-immutability.test.ts` — **10/10 PASS**. Six identity fields (legal_name / gstin / pan / registered_state_code / invoice_prefix / fy_start_month) each raise with retire-and-create guidance; three operational fields (registered_address / signatory_name / bank_account_masked) patch and persist; unknown field raises. Complementary to `tests/admin/billing-issuer-rpcs.test.ts` per the ADR's checklist path.
- [x] Existing `tests/admin/invoice-immutability.test.ts` (Sprint 2.1 chunk 3, 10/10 PASS) already covers the ADR's additional asks for `tests/billing/invoice-immutability.test.ts` (UPDATE on immutable columns raises; DELETE revoked from app roles). Re-expressing under `tests/billing/` would add no coverage; skipped.
- [x] Full repo suite `bun run test:rls` — **371/371 PASS** across 37 test files.
- [ ] Manual: issue a test invoice, simulate a Razorpay `invoice.paid` webhook, see it flip to paid in the UI + the Download link serve the PDF. (Pending manual infra action from Sprint 2.2: `R2_INVOICES_BUCKET` + `RESEND_FROM` on the admin Vercel project.)

**Status:** `[x] complete` — 2026-04-19. Invoice history + download + webhook reconciliation + landing "Last invoice" column all shipped and tested at the DB + build layer. Sprint 2 is now fully complete.

### Sprint 3 — GST statement + dispute workspace

**Estimated effort:** 2 sessions.

#### Sprint 3.1 — GST statement CSV + owner-only invoice export

**Deliverables:**

- [ ] `admin.billing_gst_statement(p_issuer_id uuid, p_fy_start date, p_fy_end date)` RPC — `SECURITY DEFINER`, platform_operator+ with scope rule: operator callers must pass the currently-active issuer id (raises otherwise); owner callers may pass any issuer id including retired ones; NULL means the currently-active issuer for operators and all issuers for owner.
- [ ] `admin/src/app/(operator)/billing/gst-statement/page.tsx` + `actions.ts` — issuer selector pre-filled with current-active for operators (locked); owner sees a free-form picker that includes retired issuers with an "(retired YYYY-MM-DD)" suffix. FY range selector, summary card (totals by tax head + invoice count), CSV download.
- [ ] CSV format documented in the page — header row + per-invoice rows + totals row. Encoding UTF-8 BOM for Excel compatibility.
- [ ] Audit-logged whenever a statement is generated (including the caller role + filter parameters).
- [ ] `admin.billing_invoice_export_manifest(p_issuer_id uuid default null, p_fy_year text default null, p_account_id uuid default null)` RPC — platform_operator+ with scope rule per Decision section. Snapshots `issuer_legal_name` + `account_name` at export time so the manifest is meaningful even if later data changes. Includes retired-issuer rows only when caller is `platform_owner`.
- [ ] `admin/src/app/(operator)/billing/export/page.tsx` + `actions.ts` — visible to platform_operator+; issuer selector locked to current-active for operators, free-form (including retired) for owner; filter form (FY / account / issuer) → calls the manifest RPC → streams a ZIP of PDFs + `index.csv` through a Next.js server action. Export action audit-logs caller role + filter params + row count + ZIP SHA-256 so the export event itself is tamper-evident.
- [ ] `admin/src/app/(operator)/billing/search/page.tsx` — invoice search across the caller's scope (operator: current-active issuer; owner: all issuers). Search by invoice_number / account_id / account_name / razorpay_payment_id / date range. Paged. Links to invoice detail.

**Testing plan:**

- [ ] `tests/billing/gst-statement.test.ts` — synthetic invoices across 3 accounts with mixed intra-state / inter-state → correct per-row and summary totals. Additionally: operator caller with current-active issuer succeeds; operator caller passing retired-issuer id raises; owner caller against retired issuer succeeds.
- [ ] `tests/billing/invoice-export-authz.test.ts` — manifest RPC + export server action: `support` and `read_only` denied; `platform_operator` succeeds for the current-active issuer scope and is denied (raise) when targeting any other issuer id; `platform_owner` succeeds unconstrained.
- [ ] `tests/billing/invoice-export-contents.test.ts` — fixture of 5 invoices across 2 issuers (one retired). Owner export of full FY returns all 5; operator export returns only the 3 invoices under the currently-active issuer; `index.csv` rows match manifest; ZIP SHA-256 stored in audit log matches re-computed hash.
- [ ] `tests/billing/invoice-search-scope.test.ts` — search UI backing RPC returns only current-active-issuer invoices for operator callers; returns all for owner callers; deleted / retired issuer invoices never appear in operator results.
- [ ] Manual: generate statement for Q1 of the current FY as operator, spot-check totals. Repeat as owner across a retired issuer — confirm different result set. Run export for full FY as each tier, open ZIP, confirm operator ZIP is a proper subset of owner ZIP.

**Status:** `[x] complete — 2026-04-20`

Note: `tests/billing/invoice-search-scope.test.ts` skipped — search scope is fully covered by the `invoice-export-authz.test.ts` search describe block; same reasoning as Sprint 2.3 (duplicate test file adds no signal).

#### Sprint 3.2 — Dispute list + detail + evidence bundle assembly

**Deliverables:**

- [ ] Migration — `public.disputes` table + RLS + indexes.
- [ ] Webhook handler extension — `dispute.created`, `dispute.won`, `dispute.lost`, `dispute.closed` upsert `public.disputes` rows; `deadline_at` parsed from payload where present.
- [ ] `admin/src/app/(operator)/billing/disputes/page.tsx` — list with status + deadline filter. Row highlights red when `deadline_at - now() < 48h`.
- [ ] `admin/src/app/(operator)/billing/disputes/[disputeId]/page.tsx` — detail with payment + account + invoice context, webhook timeline (from `billing.razorpay_webhook_events` filtered to this dispute + related payment), action buttons.
- [ ] Action: **Assemble evidence bundle** — server action that:
  1. Loads invoice PDF(s) from R2 for the disputed payment's billing period.
  2. Pulls verbatim webhook events for the related subscription/payment.
  3. Pulls plan history rows from audit log.
  4. Pulls account billing profile snapshot.
  5. Accepts an operator-uploaded attachments list (initial: none — populated in ADR-0051).
  6. ZIPs everything at `disputes/{dispute_id}/evidence-{iso}.zip` in R2.
  7. Records `evidence_bundle_r2_key` and audit-logs the assembly.
  Returns a short-TTL signed download URL for the operator.
- [ ] Action: **Mark submitted / won / lost / closed** — state flips with required reason + audit row.
- [ ] Nav: "Disputes" entry under Billing section.

**Testing plan:**

- [ ] `tests/billing/dispute-webhook.test.ts` — `dispute.created` → upsert row, matching ids, `opened_at` from payload.
- [ ] `tests/billing/evidence-bundle.test.ts` — fixture invoice + webhook events + audit rows → bundle assembled, ZIP contents enumerated and checked, r2 key stored.
- [ ] Manual: create a synthetic dispute row, assemble bundle, download ZIP, inspect contents.

**Status:** `[x] complete — 2026-04-20`

Note: `account_id` resolution in `rpc_razorpay_dispute_upsert` is best-effort (JSONB lookup against billing.razorpay_webhook_events). Returns null when no prior event carries the payment_id; operators can link manually via the detail page.

---

## Acceptance criteria

- An operator can open `/billing`, see every account's billing status at a glance, and click into any one account to see its full subscription + plan history + invoice history + latest invoice with a downloadable PDF.
- An operator can manage issuer entities as data — create a new one, activate it, retire the old one — without any code change. Invoice numbering continues from the active issuer's FY sequence.
- Every invoice emitted by the system has a R2-stored PDF with a recorded SHA-256, an auditable Resend delivery record, and a GST split that is correct for the issuer + customer state pair.
- Every Razorpay webhook that reaches the system is persisted verbatim with a verified signature, queryable by `event_type` and `account_id`, long before any dispute opens.
- An operator can generate a GSTR-1-ready CSV for any issuer × FY range in under 10 seconds at dev scale.
- When a dispute arrives, an operator can produce an evidence ZIP from a single button press. The ZIP contains the invoice PDF, the verbatim Razorpay events, and the plan history — the minimum proof required to challenge the chargeback. ADR-0051 will add the richer evidence ledger contents; this ADR's bundle is a correct proper-subset of that.
- CLAUDE.md Rule 19 is in place and the codebase contains zero hard-coded issuer identity strings.
- `admin_role` enum is extended with `platform_owner`, the founder's auth.users row is seeded with that role, and `admin_invite_create` refuses any invite attempting to grant it.
- `billing.issuer_entities` identity fields are un-editable via the update RPC; attempts raise with the documented error. Operational fields (address, logo, signatory, bank) update cleanly with an audit row.
- `public.invoices` rejects DELETE from every role in app code and rejects UPDATE to any column outside the documented allow-list. Invoice voiding happens via a status flip, not deletion.
- Invoice visibility + export are tier-scoped: `platform_operator` sees and exports invoices under the currently-active issuer (operational lens); `platform_owner` sees and exports across all issuers, active + retired (historical lens). Retired-issuer invoices are never visible to operators. Every export (either tier) is audit-logged with caller role, filter parameters, row count, and the produced ZIP's SHA-256.

## Out of scope / V2 (covered by follow-on ADRs)

- Evidence ledger capture points across signup / rights / webhook / admin / email actions — **ADR-0051**.
- Automated Razorpay dispute evidence submission via Razorpay API — **ADR-0052**.
- GSTR-1 XML generation (vs CSV) and filing helpers — **ADR-0053**.
- Customer-facing invoice + billing portal in the `app/` app — **ADR-0054**.
- Account-scoped impersonation — **ADR-0055**.
- Per-account feature-flag targeting (ADR-0036 extension) — **ADR-0056**.
- Account-level sectoral default templates (ADR-0030 extension) — **ADR-0057**.

Dev-scale performance assumptions (no paging on invoice list, no materialised summaries, no async bundle assembly) are explicit and match the discipline used in ADR-0048.

---

## Changelog references

To be populated as sprints land:

- CHANGELOG-dashboard.md — Sprint 1 UI reshape.
- CHANGELOG-schema.md — Sprint 2 migrations.
- CHANGELOG-api.md — Sprint 2 webhook + issuance route handlers.
- CHANGELOG-infra.md — Sprint 2 R2 invoice bucket + retention (if new bucket).
