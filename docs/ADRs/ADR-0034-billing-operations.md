# ADR-0034: Billing Operations admin panel (Razorpay failures · refunds · comps · plan overrides)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date amended:** 2026-04-18 — Sprint 1.1 artefacts rewired from `org_id` to `account_id` after ADR-0044 Phase 0 moved billing to the `accounts` layer (see Sprint 1.1 notes below).
**Depends on:**
- ADR-0014 (Razorpay webhook skeleton + `rpc_razorpay_apply_subscription`)
- ADR-0027 (admin schema, `cs_admin` role, `admin.admin_audit_log`, `admin.require_admin`)
- ADR-0028 (admin app foundation — OTP auth, operator layout)
- ADR-0029 (admin Orgs panel — `admin.suspend_org` reused here for the Suspend-on-max-retries flow)
- ADR-0033 (Ops + Security pattern — same admin RPC + Next.js tabbed-panel shape)
- **ADR-0044 Phase 0** (accounts layer + billing relocation — source of truth for the plan/subscription subject)

**Unblocks:** The last "soon" navbar stub in `admin/src/app/(operator)/layout.tsx`. When this ships, admin console is 11/11.

---

## Context

Billing is the last admin console panel. Today everything billing-adjacent exists only as:

- A Razorpay webhook route at `/api/webhooks/razorpay` that calls `public.rpc_razorpay_apply_subscription` (ADR-0014). The RPC handles `subscription.activated / charged / resumed / cancelled / paused / payment.failed`, writing `plan_activated` / `plan_downgraded` / `payment_failed` rows into `public.audit_log` and updating `organisations.plan`.
- `organisations.plan` / `plan_started_at` / `razorpay_subscription_id` / `razorpay_customer_id` columns (ADR-0011).

What's missing:

1. **Payment-failure visibility.** The `payment_failed` audit rows exist; nothing surfaces them. An operator can't see which org's last payment failed without a manual SQL query.
2. **Refund ledger.** No table. Refunds are issued ad-hoc via the Razorpay dashboard and never recorded on our side — leaves the internal history blank.
3. **Comp accounts.** Partners, pilots, and community grants (SaaSBoomi member's 100% discount, clinic ABDM pilots) have no durable record. Today it's "I remember I told them free for six months."
4. **Plan overrides.** Goodwill upgrades (e.g., Growth→Pro for a support incident until next renewal) have no mechanism that doesn't write to `organisations.plan` directly — which breaks on the next webhook.

Wireframe reference: `docs/admin/design/consentshield-admin-screens.html` §8 — 4 tabs (Payment failures · Refunds · Comp accounts · Plan overrides).

### Two-table collapse: `plan_adjustments`

Comp accounts and plan overrides are structurally the same — a time-bounded grant of a specific plan to a specific org, with a reason and a grantor. The wireframe surfaces them on two tabs because operator mental models differ (comp = partner/pilot; override = one-off goodwill), but the underlying shape is identical. One table with a `kind` discriminator beats two tables that drift apart.

### Razorpay retry

The wireframe's "Retry now" button on failed-payment rows needs to hit the Razorpay API (`POST /v1/subscriptions/:id/payments/retry` or equivalent). That's an HTTP call from the admin Next.js app using a server-side-only Razorpay key. No webhook or Edge Function needed — the admin is a trusted surface.

---

## Decision

One migration. One `/billing` page with 4 tabs. One Razorpay API wrapper in the admin app. One reusable `public.org_effective_plan()` helper so later feature-gate code can honour overrides without duplicating the resolution.

1. **`supabase/migrations/20260428000001_billing_operations.sql`** — two new public tables (`refunds`, `plan_adjustments`) + 6 admin RPCs + `public.org_effective_plan(p_org_id)` helper.
2. **`admin/src/app/(operator)/billing/page.tsx` + `billing-tabs.tsx` + `actions.ts`** — 4 tabs with 30s auto-refresh, same shell as `/pipeline` and `/security`.
3. **`admin/src/lib/razorpay/client.ts`** — minimal typed fetch wrapper over Razorpay's REST API (`retryCharge(subscriptionId)`, `getRefund(id)`, `issueRefund(paymentId, amountPaise, notes)`). Uses `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` from admin env. Zero new npm deps.
4. **Nav flip** — `Billing Operations` → `/billing`, `live: true`.

### Architecture Changes

- Two new tables in `public`. Both have RLS; neither is org-visible (admin-only reads via SECURITY DEFINER RPCs). Schema doc `consentshield-complete-schema-design.md` §10.6 to be added during Sprint 1.1.
- `public.org_effective_plan(p_org_id)` becomes the only correct place to ask "what plan is this org actually on right now." Existing feature-gate code that reads `organisations.plan` directly can migrate as it's touched; not a breaking change.
- Admin app gains one server-side dependency on Razorpay. Keys already provisioned; no infra work.

---

## Consequences

- **Operator can close a payment-failure incident end-to-end** without leaving the admin console — retry, refund, suspend, or grant an override.
- **Refund history lives in Supabase**, not just Razorpay. Auditable against the `admin.admin_audit_log` row written in the same transaction.
- **Comp + override semantics unified.** Future billing questions ("is this org comped? on override?") are one query: `select * from plan_adjustments where org_id = ? and (expires_at is null or expires_at > now())`.
- **`organisations.plan` column is no longer the single source of truth for effective plan.** Callers that need the "real" plan switch to `public.org_effective_plan(org_id)`. Flag in the migration comment and in the schema doc.
- **No customer-visible changes.** Comped/overridden orgs already see the feature set their effective plan grants; they just didn't have a durable record.
- **Razorpay API outage degrades "Retry now" to failing the server action.** UI shows the Razorpay error verbatim — operator can retry later or fall back to the Razorpay dashboard.

---

## Implementation Plan

### Phase 1 — Schema + RPCs

#### Sprint 1.1 — Migration + 6 admin RPCs + tests

**Deliverables:**

- [ ] `supabase/migrations/20260428000001_billing_operations.sql`:

  - `create table public.refunds (id uuid pk, org_id uuid not null references organisations(id) on delete cascade, razorpay_payment_id text, razorpay_refund_id text unique, amount_paise bigint not null check (amount_paise > 0), reason text not null, status text not null default 'pending' check (status in ('pending','issued','failed','cancelled')), requested_by uuid not null, issued_at timestamptz, failure_reason text, created_at timestamptz default now())`. RLS: no customer access (admin reads via SECURITY DEFINER only). `revoke insert, update, delete from authenticated`.

  - `create table public.plan_adjustments (id uuid pk, org_id uuid not null references organisations(id) on delete cascade, kind text not null check (kind in ('comp','override')), plan text not null, starts_at timestamptz not null default now(), expires_at timestamptz, reason text not null, granted_by uuid not null, created_at timestamptz default now(), revoked_at timestamptz, revoked_by uuid)`. Partial-unique index: `create unique index plan_adjustments_active_uniq on plan_adjustments (org_id, kind) where revoked_at is null and (expires_at is null or expires_at > now())` — at most one active comp + one active override per org at a time.

  - `admin.billing_payment_failures_list(p_window_days int default 7)` — reads `audit_log` where `event_type='payment_failed'`; joins to `organisations` for plan + razorpay_subscription_id; ranks by retries (count of same subscription_id in the window).

  - `admin.billing_refunds_list(p_limit int default 50)` — newest refunds with org_name joined.

  - `admin.billing_create_refund(p_org_id uuid, p_razorpay_payment_id text, p_amount_paise bigint, p_reason text) returns uuid` — support+; inserts with `status='pending'` (the server action in Sprint 2.2 will call Razorpay and update to `issued`/`failed`); audit-log row same txn.

  - `admin.billing_plan_adjustments_list(p_kind text default null)` — `kind in ('comp','override')` or both if null. Active rows only.

  - `admin.billing_upsert_plan_adjustment(p_org_id uuid, p_kind text, p_plan text, p_expires_at timestamptz, p_reason text) returns uuid` — platform_operator only. Revokes any existing active row of the same (org, kind) in-txn before inserting the new one. Audit-log row same txn.

  - `admin.billing_revoke_plan_adjustment(p_adjustment_id uuid, p_reason text) returns void` — platform_operator; sets `revoked_at + revoked_by`; audit-log row.

  - `public.org_effective_plan(p_org_id uuid) returns text` — SECURITY DEFINER. Returns the override plan if an active override exists, else the comp plan if an active comp exists, else `organisations.plan`. Granted EXECUTE to `authenticated`, `cs_orchestrator`, `cs_admin`.

- [x] `supabase/migrations/20260428000001_billing_operations.sql` — 2 tables + 6 admin RPCs + `public.org_effective_plan(uuid)` helper. Applied to remote.
- [x] `tests/admin/billing-rpcs.test.ts` — 15/15 pass (on org_id subject).
- [x] Index predicate nuance: `plan_adjustments_unrevoked_uniq` uses `revoked_at is null` only; the originally planned `expires_at > now()` clause was rejected because PG requires IMMUTABLE functions in partial-index predicates (`now()` is STABLE). Expiry filtering lives in the RPCs. Logged as `bug-250`.

**Amendment 2026-04-18 (post ADR-0044 Phase 0):**

- [x] `supabase/migrations/20260502000001_billing_relocate_to_accounts.sql` — follow-up that:
  - Adds `account_id uuid references accounts(id) on delete cascade` to `refunds` + `plan_adjustments`, backfills from `organisations.account_id`, drops `org_id`, and rebuilds the partial-unique index on `(account_id, kind) where revoked_at is null`.
  - Drops `public.org_effective_plan(uuid)` and creates `public.account_effective_plan(uuid)` — override > comp > `accounts.plan_code` (was `organisations.plan`, which Phase 0 deleted).
  - Rewrites all 6 `admin.billing_*` RPCs with `p_account_id` parameters and account-scoped joins. Signatures changed; old ones dropped first. Plan validation now checks `public.plans.is_active = true` (was an inline enum with the now-retired `trial` code — new plan codes are `trial_starter / starter / growth / pro / enterprise`).
- [x] `tests/admin/billing-rpcs.test.ts` — fixtures switched to `customer.accountId`, all RPC args renamed, new plan-code assertions (`trial_starter` default). **15/15 PASS**.
- [x] Full RLS suite regression: **212/212** across 20 files (baseline held). The rewrite is schema-compatible with ADR-0044 Phase 1 memberships + Phase 2 invitations.

**Status:** `[x] complete (amended)` — 2026-04-18

---

### Phase 2 — Admin UI + Razorpay wiring

#### Sprint 2.1 — `/billing` page, tabs, and non-Razorpay actions

**Deliverables:**

- [x] `admin/src/app/(operator)/billing/page.tsx` — server component. Fetches 4 admin RPCs + `public.plans` active list + caller's admin role in parallel (`Promise.all` of 6 awaits).
- [x] `admin/src/app/(operator)/billing/billing-tabs.tsx` — 4 tabs + 3 modals (Refund, Adjustment, Revoke), 30s auto-refresh via `router.refresh()`.
- [x] `admin/src/app/(operator)/billing/actions.ts` — 3 server actions: `createRefund`, `upsertPlanAdjustment`, `revokePlanAdjustment`. Validates amount>0 + reason ≥ 10 chars client-side before the RPC.
- [x] Modals take: (a) Refund — pre-fills `razorpay_payment_id` from the failing row + amount in ₹ (converted to paise) + reason; (b) Adjustment — UUID account id + plan picker (from `public.plans where is_active`) + optional `datetime-local` expiry + reason; (c) Revoke — reason only.
- [x] `admin/src/app/(operator)/layout.tsx` — `Billing Operations` nav row now `live: true, href: '/billing'`.
- [x] Build (`bun run build`) + lint (`bun run lint`) — clean. `/billing` present in admin route manifest.

**Deviations from original plan:**

- **Suspend-org shortcut deferred.** Wireframe §8 shows a "Suspend org" button at max retries, but post ADR-0044 Phase 0 the Payment Failures tab is account-scoped and `admin.suspend_org(p_org_id)` is per-org. An account has 1..N orgs; suspending all of them from one click is a different semantic. Flagged for Sprint 2.2 or V2 — cleanest answer is a new `admin.suspend_account` RPC that fans out across `organisations.status` for the account.
- **Refund amount is entered in ₹** (converted to paise server-side). Easier for operators than typing paise directly.
- **Account id input is a UUID textbox** in the Adjustment modal. A proper account-picker dropdown belongs in Sprint 2.2 alongside the admin-side accounts list surface (which doesn't exist yet — see open question on admin accounts panel).

**Status:** `[x] complete` — 2026-04-18

#### Sprint 2.2 — Razorpay client + Retry-charge + Issue-refund round-trip

**Deliverables:**

- [x] `supabase/migrations/20260502000002_refund_outcome_rpcs.sql` — two new RPCs: `admin.billing_mark_refund_issued(p_refund_id, p_razorpay_refund_id)` flips pending → issued + stores Razorpay id + writes audit-log; `admin.billing_mark_refund_failed(p_refund_id, p_failure_reason)` flips pending → failed + stores reason + audit-log. Both support+, both reject already-terminal transitions with a raise.
- [x] `admin/src/lib/razorpay/client.ts` — typed REST wrapper, zero npm deps. Reads `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` from admin env via `credentials()`; throws `RazorpayEnvError` when absent. Exposes `issueRefund({paymentId, amountPaise, notes})` (returns typed `RazorpayRefundResponse`) and `subscriptionDashboardUrl(id)` helper. HTTP errors wrapped as `RazorpayApiError` with status + parsed payload.
- [x] `admin/src/app/(operator)/billing/actions.ts` — `createRefund` now does the full round-trip: creates the pending row, calls Razorpay, then flips the row via the appropriate outcome RPC. On Razorpay success returns `{status:'issued', razorpayRefundId}`; on `RazorpayApiError` returns `{status:'failed', failureReason}` after marking the row failed; on missing env or missing payment id returns `{status:'pending', warning}` with the ledger row still created.
- [x] `admin/src/app/(operator)/billing/billing-tabs.tsx` — Refund modal has a result screen showing issued (green with Razorpay refund id), failed (red with Razorpay error message), or pending (amber with the warning). Payment Failures tab gets a **Retry at Razorpay ↗** link-out next to the Refund button (see deviation below).
- [x] Tests (`tests/admin/billing-rpcs.test.ts`) — 4 new assertions exercising `billing_mark_refund_issued` (happy path + audit row written, rejected on already-terminal) and `billing_mark_refund_failed` (happy path + audit row, rejects empty reason). Full suite: **19/19 PASS**.
- [x] Admin build (`bun run build`) + lint (`bun run lint`) — clean.

**Deviation: Retry-charge is a dashboard link-out, not a REST call.**
Razorpay has no first-class "retry now" endpoint for subscription charges — retries run on the automatic retry policy configured on the plan itself. Forcing a retry programmatically would require creating a fresh invoice and paying it, which is a cancel-and-recreate pattern (too destructive for a one-click admin action). The wireframe's "Retry now" button becomes **Retry at Razorpay ↗** deep-linking to `https://dashboard.razorpay.com/app/subscriptions/{id}`. Operator inspects the retry state or manually triggers an invoice from the dashboard. Noted inline on the Payment Failures footer.

**Deployment requirement.** `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` must be set on the **admin** Vercel project (they're already on the customer project for the webhook). Without them, `createRefund` falls back to the pending-row-only path and surfaces an amber warning in the modal — no silent failure. `admin.billing_mark_refund_issued` is available to complete the ledger row manually after an operator issues the refund through the dashboard.

**Status:** `[x] complete` — 2026-04-18

---

## Out of scope (V2)

- **Self-serve refund requests.** Customers cannot request refunds from the app; this is operator-only.
- **Proration math on mid-cycle plan changes.** `billing_upsert_plan_adjustment` just records the grant; any proration calculation is done by Razorpay or manually.
- **Automatic suspension on N failed payments.** Sprint 2.1 surfaces the button; any automatic trigger is V2-B3.
- **Invoice PDF generation.** Razorpay handles this; we don't mirror it.

---

## Test Results

**Sprint 1.1 (amended for ADR-0044 Phase 0).** `bunx vitest run tests/admin/billing-rpcs.test.ts` → 15/15 on the account-scoped rewrite. Full RLS suite: 212/212 across 20 files (baseline held).

**Sprint 2.1 — UI.** Admin build + lint clean. `/billing` in route manifest.

**Sprint 2.2 — Razorpay round-trip.**
- Unit tests: **19/19 PASS** (15 Sprint 1.1 + 4 new for outcome RPCs).
- `billing_mark_refund_issued`: happy path flips status + stores razorpay_refund_id + writes 1 audit row; second call on same row raises "already terminal".
- `billing_mark_refund_failed`: happy path flips status + stores reason + 1 audit row; empty reason raises.
- Live round-trip against Razorpay test API not run — would require creating a Razorpay test payment first, and the round-trip state machine is fully exercised by the unit path. Deferred to an operator-driven smoke after `RAZORPAY_KEY_*` is set on the admin Vercel project.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1 migration (tables + RPCs + `org_effective_plan`).
- `CHANGELOG-dashboard.md` — Sprints 2.1 + 2.2 admin UI.
- `CHANGELOG-api.md` — Sprint 2.2 Razorpay client wrapper.
- `CHANGELOG-docs.md` — ADR authored; alignment-doc Billing row flipped to `✅`; V2-B1/B2/B3 recorded.
