# Changelog — Schema

Database migrations, RLS policies, roles.

## [ADR-0050 Sprint 2.1 — chunk 3] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — accounts billing-profile + public.invoices + verbatim Razorpay store

### Added
- `20260507000008_billing_accounts_invoices_webhooks.sql`:
  - `public.accounts` nullable billing-profile columns: `billing_legal_name`, `billing_gstin`, `billing_state_code`, `billing_address`, `billing_email`, `billing_profile_updated_at`. Required at first invoice issuance (Sprint 2.2 RPC will enforce).
  - `public.invoices` canonical invoice schema (issuer_entity_id / account_id / invoice_number / fy_year+sequence / period / dates / line_items jsonb / paise split: subtotal + CGST + SGST + IGST + total / status CHECK / Razorpay ids / pdf_r2_key+sha256 / issued_at / paid_at / voided_at+reason / email message id+delivered_at / notes). `on delete restrict` on both FKs. Indexes: (issuer, fy_year, fy_sequence) unique; (issuer, invoice_number) unique; (account_id, issue_date desc); (status) partial for unpaid/unvoid; (razorpay_invoice_id) partial.
  - Invoice immutability: `public.invoices_enforce_immutability` BEFORE UPDATE trigger raises on any change to `id`, `issuer_entity_id`, `account_id`, `invoice_number`, `fy_year`, `fy_sequence`, `period_start`, `period_end`, `issue_date`, `due_date`, `currency`, `line_items`, `subtotal_paise`, `cgst_paise`, `sgst_paise`, `igst_paise`, `total_paise`, `created_at`. Auto-stamps `updated_at`.
  - DELETE revoked from `public, authenticated, anon, cs_admin, cs_orchestrator, cs_delivery, cs_worker` — no role in app code can delete an invoice row. `cs_orchestrator` retains INSERT + UPDATE (status reconciliation path); `cs_admin` retains SELECT only.
  - `billing.razorpay_webhook_events` verbatim store (event_id unique, event_type, signature_verified, signature, payload jsonb, account_id FK with `on delete set null`, received_at, processed_at, processed_outcome). Indexes: (event_type, received_at desc); (account_id, received_at desc) partial; (received_at desc) partial-on-unprocessed.
  - `public.rpc_razorpay_webhook_insert_verbatim(event_id, event_type, signature, payload)` — anon-callable; SECURITY DEFINER; resolves `account_id` from payload subscription/customer ids against `public.accounts`; ON CONFLICT (event_id) DO NOTHING so Razorpay retries don't double-insert; returns `{id, account_id, duplicate}`.
  - `public.rpc_razorpay_webhook_stamp_processed(event_id, outcome)` — anon-callable; SECURITY DEFINER; sets `processed_at = now()` + `processed_outcome` idempotently (only when `processed_at is null`).
- `20260507000009_billing_webhook_event_detail_rpc.sql`: `admin.billing_webhook_event_detail(p_event_id)` — platform_operator+ read of the verbatim row as jsonb envelope. Used by tests today and by the dispute workspace (Sprint 3.2) tomorrow.

### Tested
- [x] `tests/admin/invoice-immutability.test.ts` **10/10 PASS** — UPDATEs to `total_paise`, `line_items`, `invoice_number`, `fy_sequence`, `issuer_entity_id` all raise via trigger; allow-list UPDATEs (`status`, `issued_at`, `paid_at`, `razorpay_invoice_id`, `notes`) succeed; DELETE as `authenticated` role raises permission error.
- [x] `tests/admin/razorpay-verbatim.test.ts` **6/6 PASS** — verbatim insert with signature_verified=true; duplicate event_id returns `duplicate=true` without overwriting; account_id resolves from subscription.id; stamp_processed is idempotent; empty event_id raises; missing-event detail RPC raises.
- [x] Full admin test suite **194/194 PASS** across 16 files (including regression on all prior sprints).

## [ADR-0050 Sprint 2.1 — chunk 2] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — billing.issuer_entities + CRUD RPCs

### Added
- `20260507000006_billing_issuer_entities.sql`: creates the `billing` schema + grants (cs_admin, cs_orchestrator); adds `billing.issuer_entities` (legal_name / gstin / pan / registered_state_code / registered_address / invoice_prefix / fy_start_month / logo_r2_key / signatory_name / signatory_designation / bank_account_masked / is_active / activated_at / retired_at / retired_reason). Single-active partial unique index; GSTIN unique. Identity-field immutability trigger refuses in-place changes to legal_name / gstin / pan / registered_state_code / invoice_prefix / fy_start_month. Seven RPCs: `billing_issuer_list` + `billing_issuer_detail` (platform_operator+ read), `billing_issuer_create` + `billing_issuer_update` + `billing_issuer_activate` + `billing_issuer_retire` + `billing_issuer_hard_delete` (platform_owner only). Update RPC validates a mutable-field allow-list and raises with a guiding error for immutable or unknown fields.
- `20260507000007_billing_issuer_update_op_fix.sql`: rewrites the mutable-field check in `billing_issuer_update` from `v_key <> all(v_mutable)` (which PG parsed as `text <> text[]`) to `not (v_key = any(v_mutable))`.

### Tested
- [x] `tests/admin/billing-issuer-rpcs.test.ts` — **21/21 PASS**. Role gating (operator/support denied on writes, operator allowed on reads, support below operator tier), required-field validation on create, mutable vs immutable patch behaviour (address/signatory succeed; legal_name/gstin raise with retire-and-create guidance; unknown fields raise), single-active invariant with flip-previous-off, retire sets retired_at + blocks reactivation, hard_delete owner-gated + removes row.

## [ADR-0050 Sprint 2.1 — chunk 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.1 — platform_owner admin tier

### Added
- `20260507000004_admin_role_platform_owner.sql`: extends `admin.admin_users.admin_role` CHECK to include `'platform_owner'`. Extends `admin.require_admin` so `platform_owner` dominates `platform_operator` which dominates `support` (owner satisfies every lower tier). Guards added: `admin.admin_invite_create` rejects `p_admin_role='platform_owner'`; `admin.admin_change_role` rejects `p_new_role='platform_owner'` AND rejects mutating an existing `platform_owner` row (founder identity protection); `admin.admin_disable` rejects disabling a `platform_owner`. Idempotently seeds `admin_role='platform_owner'` onto the founder's `auth.users` + `admin.admin_users` rows (match by email `a.d.sudhindra@gmail.com`); emits NOTICE and skips when the founder row doesn't exist yet.
- `20260507000005_platform_owner_followup.sql`: CREATE OR REPLACE `admin_invite_create` to restore the Rule-12 identity-isolation check that `20260504000003_admin_invite_isolation.sql` added (dropped during the 0004 rewrite); CREATE OR REPLACE `admin_disable` to restore the original `cannot disable yourself` wording (the one admin-lifecycle-rpcs.test.ts asserts).

### Tested
- [x] `tests/admin/platform-owner-role.test.ts` 7/7 PASS: require_admin tier dominance; support cannot reach platform_operator tier; invite rejects platform_owner; change_role rejects promotion to owner; change_role refuses to mutate owner row; admin_disable refuses to disable owner.
- [x] Regression `tests/admin/{account-rpcs,admin-lifecycle-rpcs,billing-rpcs,billing-account-view,platform-owner-role}.test.ts` — 52/52 PASS.

## [ADR-0050 Sprint 1] — 2026-04-18

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 1 — `billing_account_summary` RPC

### Added
- `20260507000003_billing_account_summary.sql`: `admin.billing_account_summary(p_account_id uuid) returns jsonb` — SECURITY DEFINER, gated on `admin.require_admin('support')`. Returns a three-key envelope: `subscription_state` (plan + effective + display_name + base_price_inr + status + period/trial ends + Razorpay identity + next_charge_amount_paise stub), `plan_history` (base event at `account.created_at` + every `plan_adjustments` grant and revocation as separate chronological events with `source` ∈ `base|comp|override` and `action` ∈ `granted|revoked`), `outstanding_balance_paise` (0 until Sprint 2). Missing account raises `Account % not found` (SQLSTATE P0002).

### Tested
- [x] `tests/admin/billing-account-view.test.ts` 3/3 PASS — envelope shape validated; grant/revoke flow produces two distinct history events with the same `adjustment_id` and opposite `action` values.

## [ADR-0049 Phase 2.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion
**Sprint:** Phase 2.1 — sentry_events

### Added
- `20260507000002_sentry_events.sql`: `public.sentry_events` (sentry_id UNIQUE, level CHECK enum, payload jsonb, received_at desc index, composite (project_slug, level, received_at) index). INSERT to anon/authenticated (webhook uses anon + HMAC verify); SELECT to cs_admin only. 7-day cleanup cron at 03:45 UTC. `admin.security_sentry_events_list(p_window_hours)` RPC (cap 500 rows).

## [ADR-0049 Phase 1.1] — 2026-04-18

**ADR:** ADR-0049 — Security observability ingestion
**Sprint:** Phase 1.1 — rate_limit_events

### Added
- `20260507000001_rate_limit_events.sql`: `public.rate_limit_events` + RLS (INSERT to anon/authenticated, no SELECT for customers), indexes on (ip_address, occurred_at desc) + (occurred_at desc), 7-day cleanup cron at 03:35 UTC.
- Rewrote `admin.security_rate_limit_triggers` — stub replaced with grouped read by (endpoint, ip_address) summing hit_count. Signature preserved.

## [ADR-0048 Sprint 1.1] — 2026-04-18

**ADR:** ADR-0048 — Admin Accounts panel + ADR-0033/34 deviation closeout
**Sprint:** Phase 1.1 — account RPCs

### Added
- `20260506000001_admin_accounts.sql`: four SECURITY DEFINER RPCs — `admin.accounts_list` (support+, filters by status/plan/name), `admin.account_detail` (JSON envelope with account + orgs + active adjustments + recent audit), `admin.suspend_account` (platform_operator; fans out to child orgs and records the flipped set in audit-log new_value), `admin.restore_account` (reverses only the set captured in the last suspend).

## [ADR-0046 Phase 1.1] — 2026-04-18

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 1.1 — SDF status marker

### Added
- `20260505000001_sdf_foundation.sql`: `organisations.sdf_status` CHECK enum (`not_designated` / `self_declared` / `notified` / `exempt`), `sdf_notified_at`, `sdf_notification_ref`. Partial index on designated orgs. Rule 3 respected — references only, no PDF bytes.
- `admin.set_sdf_status(org_id, status, ref, notified_at, reason)` — platform_operator, audit-logged, auto-clears notification metadata on revert-to-not_designated.

## [Rule 12 hardening] — 2026-04-18

**Policy:** CLAUDE.md Rule 12 (identity isolation)

### Added
- `20260504000002_accept_invitation_reject_admin.sql` — re-declares `public.accept_invitation` after ADR-0047's version, layering a guard that raises 42501 when caller's JWT carries `is_admin=true`.
- `20260504000003_admin_invite_isolation.sql` — re-declares `admin.admin_invite_create` with a customer-membership check; raises 42501 if target has any `account_memberships` or `org_memberships` rows.

## [ADR-0045 Sprint 1.1] — 2026-04-18

**ADR:** ADR-0045 — Admin user lifecycle
**Sprint:** Phase 1.1 — lifecycle RPCs

### Added
- `20260503000001_admin_user_lifecycle.sql`: extends `admin.admin_users.status` CHECK to include `invited`. Four new RPCs — `admin.admin_invite_create`, `admin.admin_change_role` (refuses self-change + last-active-PO demotion), `admin.admin_disable` (refuses self-disable + last-active-PO disable), `admin.admin_list` (support+).

## [ADR-0034 amendment + outcome RPCs] — 2026-04-18

**ADR:** ADR-0034 — Billing Operations (amended for ADR-0044 Phase 0)

### Added
- `20260502000001_billing_relocate_to_accounts.sql`: rewires `public.refunds` + `public.plan_adjustments` from `org_id` to `account_id` (ADD, backfill from `organisations.account_id`, DROP `org_id`, rebuild partial-unique index). Drops `public.org_effective_plan(uuid)` → creates `public.account_effective_plan(uuid)`. Rewrites all six `admin.billing_*` RPCs with `p_account_id`.
- `20260502000002_refund_outcome_rpcs.sql`: `admin.billing_mark_refund_issued` + `admin.billing_mark_refund_failed` (support+, reject already-terminal transitions, audit-logged) — back the Razorpay round-trip.

## [ADR-0034 Sprint 1.1 — original] — 2026-04-17

**ADR:** ADR-0034 — Billing Operations

### Added
- `20260428000001_billing_operations.sql`: `public.refunds` + `public.plan_adjustments` (org_id-scoped at ship, rewired in the amendment above). Six admin RPCs + `public.org_effective_plan(uuid)` (later dropped). Logged `bug-250` for the `now()`-in-partial-index gotcha.

## [ADR-0047 Sprint 1.1] — 2026-04-18

**ADR:** ADR-0047 — Customer membership lifecycle + single-account-per-identity invariant
**Sprint:** Phase 1, Sprint 1.1 — migration + RPCs + tests

### Added
- `20260504000001_membership_lifecycle.sql`:
  - `public.membership_audit_log` (append-only) — captures role changes + removes on `account_memberships` / `org_memberships`. RLS: SELECT for `account_owner` on the account; admin-JWT bypass. No INSERT/UPDATE/DELETE from `authenticated`/`anon`.
  - `public.change_membership_role(p_user_id, p_scope, p_org_id, p_new_role, p_reason)` — account_owner (scope=account) or account_owner/org_admin of the org (scope=org); admin-JWT bypass; refuses self-change, last-account_owner demotion, reason <10 chars.
  - `public.remove_membership(p_user_id, p_scope, p_org_id, p_reason)` — same gates. `scope='account'` cascade-deletes the target's `org_memberships` under the same account to prevent ghost access. `scope='org'` deletes a single org row.
  - `public._conflicting_account_for_email(p_email, p_except_account_id)` helper — checks both `account_memberships` AND `org_memberships` (via `organisations.account_id`).

### Changed
- `public.create_invitation` — single-account-per-identity refusal (42501, message carries the conflicting account_id).
- `public.create_invitation_from_marketing` — same refusal for the marketing path.
- `public.accept_invitation` — accept-time race check for the same invariant.

### Tested
- `tests/rbac/membership-lifecycle.test.ts` — 10/10 pass.
- `tests/rbac/single-account-invariant.test.ts` — 5/5 pass.
- Full suite: `bun run test:rls` — **242/242** across 23 files.

## [ADR-0044 Phase 2.6] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.6 — marketing-site invite RPC

### Added
- `20260501000004_invitations_marketing_rpc.sql` — `public.create_invitation_from_marketing(p_email, p_plan_code, p_trial_days, p_default_org_name, p_expires_in_days)`. Narrow wrapper of the account-creating branch of `public.create_invitation` with the `is_admin` JWT check dropped. EXECUTE granted only to `cs_orchestrator`. Access control lives in the Node.js route's HMAC verification.
- `20260501000005_marketing_rpc_grant_fix.sql` — explicit `revoke execute from public, anon, authenticated` on the RPC. Discovered during a manual probe that the initial `revoke from public` wasn't enough: hosted Supabase grants EXECUTE on `public.*` functions to anon + authenticated via default privileges at creation time. Follow-up memo in `feedback_supabase_default_function_grants.md`.

### Tested
- `tests/rbac/invitations-marketing-rpc.test.ts` — 5 tests: authenticated + anon hit `42501` permission denied; service-role (superuser path) successfully creates an account_owner invite with the expected shape; inactive plan raises; duplicate pending invite raises `23505`.
- `bun run test:rls` — 212/212 across 20 files.

## [ADR-0044 Phase 2.5] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.5 — invitation email dispatch (DB side)

### Added
- `20260501000003_invitations_email_dispatch.sql`:
  - New columns on `public.invitations`: `email_dispatched_at`, `email_dispatch_attempts int default 0`, `email_last_error`.
  - Partial index `invitations_dispatch_pending_idx (created_at) WHERE accepted_at IS NULL AND revoked_at IS NULL AND email_dispatched_at IS NULL AND email_dispatch_attempts < 5` — supports the cron scan.
  - `public.dispatch_invitation_email(p_id uuid) RETURNS bigint` — SECURITY DEFINER. Reads the dispatcher URL + bearer from Vault (`cs_invitation_dispatch_url`, `cs_invitation_dispatch_secret`), fires `net.http_post` with `{invitation_id: <uuid>}`. Returns the pg_net request id. Soft-null return when Vault isn't configured (bootstrap window).
  - AFTER-INSERT trigger `invitations_dispatch_after_insert` — calls `dispatch_invitation_email(NEW.id)` only for live invites (not revoked, not accepted).
  - pg_cron `invitation-dispatch-retry` every 5 min — scans for un-dispatched invites > 1 minute old, < 1 hour old, attempts < 5, caps at 50 per run.

### Tested
- `tests/rbac/invitations-dispatch-trigger.test.ts` — 3 tests: defaults on fresh invites, simulated success-path column update, `dispatch_invitation_email` soft-null when Vault absent.
- `bun run test:rls` — 207/207 across 19 files.

## [ADR-0044 Phase 2.4] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.4 — list + revoke + member primitives

### Added
- `20260501000001_invitations_list_revoke.sql`:
  - `public.invitations.revoked_at` + `revoked_by` columns. The pending-unique index + three helper indexes now condition on `accepted_at is null and revoked_at is null` so a revoked invite no longer blocks re-issuance to the same email.
  - `public.invitation_preview(p_token)` re-declared to ignore `revoked_at is not null` rows.
  - `public.list_pending_invitations()` — SECURITY DEFINER. Returns pending invites scoped by caller:
    - `account_owner` → every pending invite for their account.
    - effective `org_admin` of current org → pending invites for that org.
    - admin JWT → platform-wide.
    - else → empty set.
  - `public.revoke_invitation(p_id)` — SECURITY DEFINER. Same role gate as `create_invitation`; raises on already-accepted; idempotent on already-revoked.
- `20260501000002_invitations_list_members.sql`:
  - `public.list_members()` — SECURITY DEFINER. Joins `account_memberships` + `org_memberships` with `auth.users.email` (which authenticated otherwise can't read). Visibility mirrors `list_pending_invitations`.

### Tested
- `tests/rbac/invitations-list-revoke.test.ts` — 10 tests covering: list scoping per role, revoked rows drop from list, revoke role gate (account_owner yes, admin-tier no, stranger no), already-accepted raises, double-revoke idempotent, list_members self-inclusion + stranger-empty.
- `bun run test:rls` — 204/204 across 18 files.

## [ADR-0044 Phase 2.1] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 2.1 — invitation schema + create/accept RPCs

### Added
- `20260430000001_invitations.sql`:
  - `public.invitations` — single table for all 5 invite shapes, discriminated by role + (account_id, org_id, plan_code) presence. `invitations_shape` check constraint enforces the valid shape permutations.
  - Partial unique index on `(lower(invited_email), account_id, org_id)` where `accepted_at is null` — one pending invite per (email, scope).
  - `public.invitation_preview(p_token)` — read-only public RPC for the /signup page; returns email + role + plan + default_org_name.
  - `public.create_invitation(...)` — SECURITY DEFINER. Role-gated by inviter:
    - account-creating invites → admin JWT only (marketing site / operator console).
    - add-to-account invites → account_owner of target account.
    - org-level invites → account_owner OR (for admin/viewer) org_admin of target org.
  - `public.accept_invitation(p_token)` — polymorphic. Checks email match, branches by role:
    - `account_owner` + no account_id → creates account + first org + both memberships atomically.
    - `account_owner` / `account_viewer` (existing account) → adds account_memberships row.
    - `org_admin` / `admin` / `viewer` → adds org_memberships row.
  - Stamps invite as accepted in the same txn.
- `20260430000002_invitations_role_gate_fix.sql` — coalesce NULL role reads to '' before comparing in `create_invitation` (an admin-tier user with no account_memberships row was slipping past the gate).

### Tested
- `tests/rbac/invitations.test.ts` — 9 tests covering: role gates (create_invitation denies non-authorised callers), happy path accept, email mismatch raises, double-accept raises.
- `bun run test:rls` — 194/194 across 17 files.

## [ADR-0044 Phase 1] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC
**Sprint:** Phase 1 — memberships + role resolution + credential-column RLS

### Added
- `20260429000001_rbac_memberships.sql`:
  - `public.account_memberships(account_id, user_id, role ∈ {account_owner, account_viewer})` with its own RLS (read-self + read-by-account-owner + admin-read-all).
  - `public.current_account_role()`, `public.current_org_role()`, `public.effective_org_role(uuid)` SQL helpers. `effective_org_role` folds inheritance: account_owner → org_admin, account_viewer → viewer.
  - Backfill: every existing org_admin row in `org_memberships` got a paired `account_owner` row in `account_memberships` for that org's account.
  - Column-level REVOKE on credential columns — `web_properties.event_signing_secret`, `integration_connectors.config`, `export_configurations.write_credential_enc`. Reading via SECURITY DEFINER RPCs (account_owner / org_admin paths) unaffected.

### Changed
- `public.organisation_members` renamed to `public.org_memberships`. Role taxonomy remapped in place:
  - `admin`    → `org_admin` (owner-tier of the org)
  - `member`   → `admin` (operational)
  - `readonly` → `viewer`
  - `auditor`  → `viewer`
  Check constraint tightened to the 3 new values only.
- `public.custom_access_token_hook` — same body, new table name; emits new role values.
- `public.is_org_admin()` — now true only when `org_role = 'org_admin'`. Stale JWTs (pre-rename) will need re-login.
- RPCs rewritten against `org_memberships` + accounts: `rpc_signup_bootstrap_org`, `rpc_plan_limit_check`, `rpc_rights_event_append`, `rpc_audit_export_manifest`.
- `rpc_signup_bootstrap_org` now also seeds an `account_memberships` row (`account_owner`) in the same txn.
- `rpc_audit_export_manifest` — reads `plan_code` from `accounts` (post-Phase-0 column drop fix).
- Admin-side `admins_select_all` policies re-installed including `org_memberships`, `accounts`, `account_memberships`, `plans`.

### Tested
- [x] `bun run test:rls` — 185/185 (16 files).
- [x] `cd app && bunx vitest run` — 69 tests (11 files).
- [x] `cd admin && bun run build` — 27 routes.
- [x] `cd app && bun run build` — all routes compile.

### Operator note
Every active user session needs to sign out + back in to pick up the new `org_role` claim (`org_admin` instead of `admin`). Old JWTs will have `org_role='admin'` from before the hook update — those sessions now lose owner-tier rights until re-auth.

## [ADR-0044 Phase 0] — 2026-04-18

**ADR:** ADR-0044 v2 — Customer RBAC + 4-level hierarchy
**Sprint:** Phase 0 — accounts layer + billing relocation

### Added
- `20260428000002_accounts_and_plans.sql`:
  - `public.plans` table + seed rows (`trial_starter`, `starter`, `growth`, `pro`, `enterprise`) with `max_organisations` + `max_web_properties_per_org` + `base_price_inr` + `trial_days`.
  - `public.accounts` table (subscription identity + plan + status + `trial_ends_at`).
  - `public.organisations.account_id` (NOT NULL FK after backfill).
  - `public.current_account_id()` + `public.current_plan()` helpers.
  - Extended `organisations_status_check` to include `suspended_by_plan`.
  - Backfill: every existing org became a solo-account with the matching plan + razorpay ids copied across.

### Changed
- `public.admin_config_snapshot()` — `suspended_org_ids` now includes orgs with `status IN ('suspended','suspended_by_plan')`, so plan-downgrade suspensions reach the Worker via the existing KV-sync cron.
- `public.rpc_razorpay_apply_subscription` — resolves by `accounts.razorpay_subscription_id` and mutates `accounts.plan_code` / `accounts.status`; audit-log entity_type is now `'account'`.
- `public.rpc_plan_limit_check` — reads `plans.max_web_properties_per_org` via `organisations → accounts → plans`.
- `public.rpc_signup_bootstrap_org` — creates a brand-new account + org atomically (plan_code=`trial_starter`, `trial_ends_at=now()+30d`).
- `admin.extend_trial` — extends `accounts.trial_ends_at` via the org's account (was `organisations.trial_ends_at`).
- `public.org_effective_plan` + `admin.billing_payment_failures_list` (ADR-0034) — rewritten to read plan from `accounts`.

### Dropped
- `public.organisations.plan` · `plan_started_at` · `trial_ends_at` · `razorpay_subscription_id` · `razorpay_customer_id`. All data moved to `accounts` during backfill.

### Tested
- [x] `bun run test:rls` — 185/185 across 16 files. New `accounts` FK honored by every test-helper-created org.
- [x] `cd admin && bun run build` — 27 routes compile.
- [x] `cd app && bun run build` — all customer routes compile.
- [x] `cd app && bunx vitest run` — 69 tests (11 files).

## [ADR-0033 Sprint 2.1] — 2026-04-17

**ADR:** ADR-0033 — Admin Ops + Security (Phase 2: Abuse & Security)
**Sprint:** 2.1 — security schema + RPCs (KV-sync + Worker enforcement deferred to Sprint 2.3)

### Added
- `20260427000001_ops_and_security_phase2.sql`:
  - `public.blocked_ips` table (`ip_cidr cidr not null`, `reason text not null check (length>=10)`, `blocked_by`/`unblocked_by` FKs into `admin.admin_users`, `blocked_at`/`expires_at`/`unblocked_at` timestamps). Partial unique index on `ip_cidr where unblocked_at is null` keeps per-CIDR history clean.
  - 5 SECURITY DEFINER RPCs on `admin.*`: `security_worker_reasons_list` (ILIKE filter over `worker_errors.upstream_error`), `security_rate_limit_triggers` (stub — returns 0 rows until V2-S2 adds persistence), `security_blocked_ips_list`, `security_block_ip`, `security_unblock_ip`. Writes gate on `admin.require_admin('platform_operator')` and insert an `admin.admin_audit_log` row in the same transaction (Rule 22).

### Deferred to Sprint 2.3
- Edge Function `sync-blocked-ips-to-kv` + pg_cron `blocked-ips-kv-sync` — no consumer yet without Worker middleware.
- `worker/src/middleware/check-blocked-ip.ts` + Worker unit tests + end-to-end smoke-test transcript.

## [ADR-0025 Sprint 1.1] — 2026-04-17

**ADR:** ADR-0025 — DEPA Score Dimension
**Sprint:** 1.1 — nightly refresh + pg_cron

### Added
- `20260423000001_depa_score_refresh.sql`:
  - `refresh_depa_compliance_metrics()` — iterates `organisations`, calls `compute_depa_score(org_id)` (ADR-0020), UPSERTs into `depa_compliance_metrics` with `ON CONFLICT (org_id) DO UPDATE`. Returns the processed count. Granted EXECUTE to `authenticated` + `cs_orchestrator`.
  - pg_cron job `depa-score-refresh-nightly` at `30 19 * * *` (01:00 IST) — runs after ADR-0023's `expiry-enforcement-daily` (19:00 UTC) so the night's expired artefacts are reflected in the score.

### Tested
- [x] `tests/depa/score.test.ts` — 7/7 — PASS (10.8 arithmetic 5 cases + 10.8b refresh round-trip 2 cases).
- [x] `bun run test:rls` — 13 files, **154/154** — PASS.

## [ADR-0039 Sprint 1.1 + 1.3] — 2026-04-17

**ADR:** ADR-0039 — Connector OAuth (Mailchimp + HubSpot)

### Added
- `20260425000004_oauth_states.sql` — `oauth_states` table for OAuth handshake CSRF tokens. Deny-all RLS; orchestrator-only writes. `oauth_states_cleanup()` helper + hourly pg_cron `oauth-states-cleanup-hourly` at `:23 past`.
- `20260425000005_oauth_refresh_cron.sql` — daily pg_cron `oauth-token-refresh-daily` at `45 3 * * *` UTC targeting the new `oauth-token-refresh` Edge Function.

## [ADR-0041 Sprint 1.3] — 2026-04-17

**ADR:** ADR-0041 — Probes v2 via Vercel Sandbox
**Sprint:** 1.3 — swap `consent-probes-hourly` cron target to Vercel

### Changed
- `20260425000003_probe_cron_vercel.sql` — unschedules and re-creates `consent-probes-hourly` pointing at `<vercel_app_url>/api/internal/run-probes` using a new Vault secret `probe_cron_secret` for the bearer token. Base URL reads from a new Vault secret `vercel_app_url`. Documented operator setup in the migration SQL comments.
- Deprecates the Supabase Edge Function `run-consent-probes` (static-HTML path). Function stays deployed for rollback; not invoked by any cron after this migration.

### Operator setup required
- `vault.create_secret('https://app.consentshield.in', 'vercel_app_url')`
- `vault.create_secret('<random token>', 'probe_cron_secret')`
- Vercel project env var `PROBE_CRON_SECRET` set to the same token.

## [ADR-0040 Sprint 1.2] — 2026-04-17

**ADR:** ADR-0040 — Audit R2 Upload Pipeline
**Sprint:** 1.2 — export_configurations DELETE policy

### Added
- `20260425000002_export_configurations_delete.sql` — adds `org_delete` RLS policy on `export_configurations` (`using (org_id = current_org_id())`). Required by the new `deleteR2Config` server action; admin/owner gating is enforced in the action itself for consistency with other dashboard admin-only mutations.

## [ADR-0038 Sprint 1.2] — 2026-04-17

**ADR:** ADR-0038 — Operational Observability
**Sprint:** 1.2 — cron_health_snapshot RPC + stuck-buffer + cron-health crons

### Added
- `20260425000001_operational_crons.sql`:
  - `public.cron_health_snapshot(p_lookback_hours int default 24)` — SECURITY DEFINER wrapper over `cron.job_run_details` returning per-job `(total_runs, failed_runs, last_failure_at)`. Lookback clamped to `[1,168]`. Granted EXECUTE to `authenticated` + `cs_orchestrator`.
  - pg_cron `stuck-buffer-detection-hourly` at `7 * * * *` — re-schedules the orphan cron unscheduled in `20260416000004`. Target Edge Function `check-stuck-buffers` (this ADR).
  - pg_cron `cron-health-daily` at `15 2 * * *` (07:45 IST). Target Edge Function `check-cron-health` (this ADR).

### Tested
- [x] Migration applied on dev.
- [x] RPC smoke: `select * from public.cron_health_snapshot(24)` returns 13 jobs with healthy (zero-failure) counts.

## [ADR-0037] — 2026-04-17

**ADR:** ADR-0037 — DEPA Completion
**Sprints:** 1.1 expiry fan-out · 1.2 rights fingerprint · 1.5 template materialisation

### Added
- `20260424000001_depa_expiry_connector_fanout.sql` — UNIQUE partial index `deletion_receipts_expiry_artefact_connector_uq` on `(artefact_id, connector_id) WHERE trigger_type = 'consent_expired'`. Rewrites `enforce_artefact_expiry()` so that when a purpose has `auto_delete_on_expiry=true`, it walks `purpose_connector_mappings × integration_connectors (status='active')`, computes `data_categories ∩ data_scope`, and INSERTS one `deletion_receipts` row per mapped connector (`trigger_type='consent_revoked'`… no, `'consent_expired'`) with scoped fields. Keeps the existing `delivery_buffer` R2-export write so both paths fire. `ON CONFLICT DO NOTHING` on the new UNIQUE predicate.
- `20260424000002_rights_session_fingerprint.sql` — adds `rights_requests.session_fingerprint text` + partial index for non-null lookups.
- `20260424000003_rights_rpc_fingerprint.sql` — DROP + CREATE `public.rpc_rights_request_create` with a new trailing `p_session_fingerprint text default null` parameter. Inserts into the new column.
- `20260424000004_apply_template_materialise.sql` — re-creates `public.apply_sectoral_template(p_template_code)` so that after writing the `organisations.settings.sectoral_template` pointer it iterates `v_template.purpose_definitions` and UPSERTs into `public.purpose_definitions` via `ON CONFLICT (org_id, purpose_code, framework) DO UPDATE`. Return payload gains `materialised_count`. Defensive reads default missing JSONB fields to column defaults.

### Tested
- [x] `tests/depa/expiry-pipeline.test.ts` — 3/3 (10.6 + 10.6b + 10.6c) — PASS.
- [x] `tests/rls/sectoral-template-apply.test.ts` — 3/3 — PASS (extended with materialisation assertions).
- [x] `bun run test:rls` — 14 files, **160/160** — PASS.

## [ADR-0030 Sprint 3.1] — 2026-04-17

**ADR:** ADR-0030 — Sectoral Templates
**Sprint:** 3.1 — customer-side template application

### Added
- `20260421000003_apply_sectoral_template.sql` — SECURITY DEFINER RPC `public.apply_sectoral_template(p_template_code text)` that writes `public.organisations.settings.sectoral_template = { code, version, applied_at, applied_by }` after picking the latest published version of the given template_code. Raises if no published version exists for the code. Granted EXECUTE to `authenticated`.

### Tested
- [x] `tests/rls/sectoral-template-apply.test.ts` — 3 assertions: apply writes to caller's org (orgB untouched); unknown code raises; picks latest published version when v1 is deprecated and v2 is current.
- [x] `bun run test:rls` — 147/147.

## [ADR-0023 Sprint 1.1 + closeout] — 2026-04-17

**ADR:** ADR-0023 — DEPA Expiry Pipeline
**Sprint:** 1.1 (helpers + cron) + 1.2 (tests)

### Added
- `20260422000001_depa_expiry_pipeline.sql` — two SQL helpers + two pg_cron jobs per schema-design §11.2 / §11.10:
  - `enforce_artefact_expiry()` — transitions active artefacts past their `expires_at` to `status='expired'`, removes them from `consent_artefact_index`, writes `audit_log` with `event_type='consent_artefact_expired'`, stages a `delivery_buffer` row with `event_type='artefact_expiry_deletion'` if the purpose has `auto_delete_on_expiry=true`, marks `consent_expiry_queue.processed_at`.
  - `send_expiry_alerts()` — picks `consent_expiry_queue` rows whose `notify_at` has lapsed (and which are not notified/processed/superseded), marks `notified_at`, stages a `delivery_buffer` row with `event_type='consent_expiry_alert'`.
  - Both granted EXECUTE to `authenticated` + `cs_orchestrator`.
  - `expiry-enforcement-daily` pg_cron at `0 19 * * *` (00:30 IST).
  - `expiry-alerts-daily` pg_cron at `30 2 * * *` (08:00 IST).

### Tested
- [x] `tests/depa/expiry-pipeline.test.ts` — 2/2 — PASS (10.6 enforcement; 10.6b alert staging + idempotent second call).
- [x] `bun run test:rls` — 11 files, **144/144** — PASS.

### Deferred
- Expiry-triggered connector fan-out logged to `docs/V2-BACKLOG.md` as **V2-D1** (auto-delete currently stages only the R2 export; third-party connectors are not automatically notified at TTL lapse).

## [ADR-0032 post-review follow-up] — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Context:** Sprint 2.1 review flagged the wireframe's Internal-Note button had no schema backing. Closes the gap.

### Added
- `20260421000002_support_internal_notes.sql`:
  - `admin.support_ticket_messages.is_internal boolean not null default false`.
  - `admin.add_support_ticket_message` extended: new `p_is_internal boolean default false` param; internal notes skip the `awaiting_customer` auto-transition (a private comment shouldn't nudge the ticket). Distinct `add_support_ticket_internal_note` audit-log action code for internal notes vs `add_support_ticket_message` for customer-visible replies. DROP+CREATE was required (extending the signature); EXECUTE grant re-issued.
  - `public.list_support_ticket_messages` filters `is_internal = true` so customer-side callers can't see operator-only notes.

### Tested
- [x] `tests/rls/support-tickets.test.ts` — new 4th assertion: seed an internal note with is_internal=true; confirm customer-side `list_support_ticket_messages` does NOT return it; confirm admin-side service-role SELECT does.
- [x] `bun run test:rls` — 142/142 passes (Terminal B's ADR-0022 tests contribute the extra files).

## [ADR-0032 Sprint 2.1] — 2026-04-17

**ADR:** ADR-0032 — Support Tickets
**Sprint:** 2.1 — customer-side support access

### Added
- `20260421000001_customer_support_access.sql` — three SECURITY DEFINER helpers in `public` so customer JWTs can interact with `admin.support_tickets` / `admin.support_ticket_messages` without widening the admin-side RLS boundary.
  - `public.list_org_support_tickets()` — returns tickets where `org_id = public.current_org_id()`. Bonus computed column `message_count`.
  - `public.list_support_ticket_messages(p_ticket_id)` — raises if caller's org doesn't own the ticket.
  - `public.add_customer_support_message(p_ticket_id, p_body)` — customer-authored message; auto-transitions ticket status from `awaiting_customer`/`resolved`/`closed` → `awaiting_operator` so the operator queue surfaces it.
- All three granted EXECUTE to `authenticated`.

### Tested
- [x] `tests/rls/support-tickets.test.ts` — 3 assertions covering cross-tenant blocks on list / read / write (+ positive own-tenant path).
- [x] `bun run test:rls` (root, serial) — 138/138.

## [ADR-0022 Sprint 1.2] — 2026-04-17

**ADR:** ADR-0022 — `process-artefact-revocation` Edge Function + Revocation Dispatch
**Sprint:** 1.2 (dispatch trigger + safety-net cron)

### Added
- `20260420000001_depa_revocation_dispatch.sql` — wires the Q2 Option D hybrid pipeline for the out-of-database revocation cascade:
  - `artefact_revocations.dispatched_at` column + partial index `idx_revocations_pending_dispatch`.
  - UNIQUE partial index `deletion_receipts_revocation_connector_uq` on `(trigger_id, connector_id) WHERE trigger_type = 'consent_revoked'` (idempotency guard per ADR-0022 §Decision).
  - `trigger_process_artefact_revocation()` — AFTER INSERT dispatch function; Vault-backed URL; EXCEPTION WHEN OTHERS swallowed.
  - `trg_artefact_revocation_dispatch` — fires after `trg_artefact_revocation` (cascade) by name-alphabetic ordering; dispatch does not run if the cascade raises (S-5 frozen-chain invariant preserved).
  - `safety_net_process_artefact_revocations()` — 5-min / 24-h window sweep, 100-row batch cap.
  - pg_cron job `artefact-revocations-dispatch-safety-net` scheduled `*/5 * * * *`.

### Tested
- [x] `bunx supabase db push --linked --include-all` — migration applied cleanly on dev.
- Full verification (trigger existence, cron entry, UNIQUE index shape) covered by ADR-0022 Sprint 1.4 integration suite (`tests/depa/revocation-pipeline.test.ts`).

## [ADR-0029 Sprint 1.1 + 4.1] — 2026-04-17

**ADR:** ADR-0029 — Admin Organisations
**Sprints:** 1.1 (admin SELECT policies) + 4.1 (suspended_org_ids in snapshot)

### Added
- `20260417000020_admin_select_customer_tables.sql` — adds `admins_select_all` RLS policy (gated on `admin.is_admin()`) to 15 public operational tables: organisations, organisation_members, web_properties, consent_banners, data_inventory, breach_notifications, rights_requests, export_configurations, tracker_signatures, tracker_overrides, integration_connectors, retention_rules, notification_channels, purpose_definitions, purpose_connector_mappings. Buffer tables deliberately excluded — admin reads those via SECURITY DEFINER RPCs (Rule 1). Customer RLS preserved via policy OR (customer JWTs don't carry is_admin=true).
- `20260417000021_admin_config_snapshot_v2.sql` — extends `public.admin_config_snapshot()` with `suspended_org_ids` (jsonb array of uuids where `public.organisations.status='suspended'`). Consumed by the Cloudflare Worker's per-org suspension check.

### Tested
- [x] `bun run test:rls` — 8 files, 135/135 — PASS (customer isolation unchanged; admin gains SELECT-all on 15 tables)
- [x] Snapshot RPC keys — 5 now (kill_switches, active_tracker_signatures, published_sectoral_templates, suspended_org_ids, refreshed_at)

## [Sprint 3.2] — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 3, Sprint 3.2 — sync-admin-config-to-kv Edge Function + Worker wiring

### Added
- `20260417000017_admin_config_snapshot_rpc.sql` — `public.admin_config_snapshot()` SECURITY DEFINER RPC returning the consolidated admin config snapshot (kill_switches object + active tracker_signature_catalogue array + published sectoral_templates array + refreshed_at). Grants EXECUTE to `authenticated` + `cs_orchestrator`. Needed because the Edge Function's `cs_orchestrator` JWT has no `is_admin` claim and no table-level grants on admin.*; the RPC is the only read path into admin data from that role.
- `20260417000018_fix_admin_sync_cron.sql` — unschedules and reschedules `admin-sync-config-to-kv` using vault secret name `cs_orchestrator_key` instead of `cron_secret`. The latter never existed in the dev vault — every invocation since Sprint 3.1 was silently failing with a NULL Authorization header.

### Changed
- No table changes in this sprint. The Worker wiring is source-side only; see `CHANGELOG-edge-functions.md` and `CHANGELOG-worker.md` for Edge Function + Worker changes.

### Tested
- [x] `bun run test:rls` — 8 files, 135/135 (serial mode) — PASS (unchanged tests except Terminal B's +2 from ADR-0021)
- [x] `cd app && bun run test` — 7 files, 42/42 (Worker harness tolerates the new admin-config.ts wiring) — PASS
- [x] `cd admin && bun run test` — 1/1 smoke — PASS
- [x] RPC smoke-test — `select jsonb_object_keys(public.admin_config_snapshot())` → 4 keys (kill_switches, active_tracker_signatures, published_sectoral_templates, refreshed_at)
- [x] Cron verification — `admin-sync-config-to-kv` command references `cs_orchestrator_key` (not `cron_secret`)
- [x] Edge Function smoke-test — direct HTTPS POST returns `{"mode":"dry_run","snapshot":{...}}` when CF credentials absent (correct degradation)

Combined: 42 (app) + 135 (rls/admin/depa) + 1 (admin smoke) = **178/178**.

## [ADR-0021 Sprint 1.1] — 2026-04-17

**ADR:** ADR-0021 — `process-consent-event` Edge Function + Dispatch Trigger + Safety-Net Cron
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260419000001_depa_consent_event_dispatch.sql` — idempotency guard + dispatch + safety net:
  - `alter table consent_artefacts add constraint consent_artefacts_event_purpose_uq unique (consent_event_id, purpose_code)` — guard S-7, enforces "exactly one artefact per (event, purpose)".
  - `trigger_process_consent_event()` + AFTER INSERT trigger `trg_consent_event_artefact_dispatch` on `consent_events`. Fires `net.http_post` to `process-consent-event`; EXCEPTION WHEN OTHERS swallows trigger failures so the Worker's INSERT never rolls back.
  - `safety_net_process_consent_events()` — 100-row batch cap, 24-hour lookback window, re-fires the Edge Function for `consent_events` rows with empty `artefact_ids` older than 5 minutes. Granted EXECUTE to authenticated + cs_orchestrator (tests invoke it).
  - pg_cron job `consent-events-artefact-safety-net` at `*/5 * * * *`.

### Changed
- `public.consent_artefacts` — now carries the S-7 idempotency constraint. Duplicate inserts from a trigger+cron race collide at the DB level (ON CONFLICT DO NOTHING in the Edge Function handles).

### Tested
- [x] `tests/depa/consent-event-pipeline.test.ts` — 2/2 — PASS (Tests 10.1 + 10.2 from testing-strategy §10)
- [x] `bun run test:rls` full suite — 135/135 across 8 files — PASS

## [Sprint 3.1] — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 3, Sprint 3.1 — Admin RPCs + pg_cron + EXECUTE grants

### Added
- `20260417000011_public_orgs_status_settings.sql` — prerequisite. Adds `public.organisations.status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived'))` + `settings jsonb NOT NULL DEFAULT '{}'::jsonb` + partial index on `status <> 'active'`. Closes the schema-doc-vs-code mismatch where §7 claimed `status` already existed.
- `20260417000012_admin_rpcs.sql` — 30 SECURITY DEFINER functions across 11 categories (org management, impersonation, sectoral templates, connector catalogue, tracker signatures, support tickets, org notes, feature flags, kill switches, platform metrics, audit bulk export). Each RPC follows the Rule-22 template: role gate via `admin.require_admin`, reason ≥ 10 chars, `to_jsonb(row.*)` capture for old/new value, audit insert + mutation in same transaction, `pg_notify` on impersonation start/end and kill-switch toggle. The single exception is `admin.create_support_ticket` — customer-facing, skips role gate, uses oldest admin row as nominal audit author.
- `20260417000013_admin_pg_cron.sql` — 4 scheduled jobs: `admin-create-next-audit-partition` (0 6 25 * *), `admin-expire-impersonation-sessions` (*/5 * * * *) with CTE-emitted pg_notify on expired sessions, `admin-refresh-platform-metrics` (0 2 * * *), `admin-sync-config-to-kv` (*/2 * * * *) calling the Sprint 3.2 Edge Function.
- `20260417000014_admin_rpc_grants.sql` — dynamic `do $$` block granting EXECUTE on every admin.* function (except the four Sprint 1.1 helpers) to `authenticated`. Uses `pg_get_function_identity_arguments` so overloaded functions are granted correctly.
- `20260417000015_admin_grants_service_role.sql` — grants USAGE on schema admin + full table/sequence/function access to `service_role`, plus default privileges for future admin objects. Needed for test harnesses, the Sprint 4.1 bootstrap script, and the Supabase Dashboard Table Editor.
- `20260417000016_fix_add_org_note_return.sql` — follow-up. `admin.add_org_note` declared `returns uuid` but the function body exited without a RETURN, tripping SQLSTATE 2F005. Added the missing `return v_id;`. Source migration 12 updated for consistency.

### Changed
- `public.organisations` — new `status` and `settings` columns. Worker banner serving (Sprint 3.2 wiring) will serve a no-op banner when `status='suspended'`.

### Deviations from ADR-0027 plan
- **"40+ RPCs" is actually 30.** The ADR deliverables text at Phase 3.1 says "40+"; the enumerated list across categories is 29 admin-claim RPCs + 1 customer-facing `admin.create_support_ticket` = 30. The enumerated list IS the contract; the "40+" is aspirational shorthand.
- **`public.organisations.status` and `settings` columns did not exist** despite schema doc §7 claiming they did. Added in a prerequisite migration before the RPCs that mutate them.
- **`admin.create_support_ticket` customer-facing RPC added.** Schema doc §3.7 described the flow but did not define the function. Defined here with explicit documentation of the "no admin claim" exception + the pre-bootstrap audit-row behaviour (no audit row written if no admin_users rows exist yet; ticket itself still creates).
- **`admin-expire-impersonation-sessions` cron now fires `pg_notify('impersonation_ended', ...)`** on expired sessions. Schema doc §9 only flipped status; the downstream Edge Function (Sprint 3.2) shouldn't need to care whether the session ended manually or by timeout — it listens on one channel.
- **`admin.refresh_platform_metrics` DEPA metrics guarded with `to_regclass`.** Pre-ADR-0020 environments (no DEPA tables) will report 0 for artefact metrics instead of failing; post-ADR-0020 environments light up automatically.

### Tested
- [x] `bun run test:rls` — 7 files, 133/133 (serial mode) — PASS
  - tests/rls/isolation.test.ts — 25/25 (unchanged baseline)
  - tests/rls/url-path.test.ts — 19/19 (unchanged baseline)
  - tests/rls/depa-isolation.test.ts — 12/12 (Terminal B's ADR-0020)
  - tests/admin/foundation.test.ts — 11/11 (unchanged Sprint 1.1 baseline)
  - tests/admin/rls.test.ts — 33/33 (Sprint 2.1 baseline + 1 sector-label fix)
  - tests/admin/rpcs.test.ts — 26/26 (new)
  - tests/admin/audit_log.test.ts — 7/7 (new)
- [x] `cd app && bun run test` — 7 files, 42/42 (unchanged baseline) — PASS
- [x] `cd admin && bun run test` — 1/1 smoke (unchanged) — PASS
- [x] `cd app && bun run lint` — 0 warnings — PASS
- [x] Post-migration verification queries — PASS
  - 30 admin.* RPCs (excluding the four Sprint 1.1 helpers)
  - 30 EXECUTE grants on admin.* RPCs to `authenticated`
  - 4 cron jobs (`admin-*`) with schedules matching spec
  - `public.organisations.status` + `settings` columns present
  - `service_role` has USAGE + insert/update/delete on admin schema

Combined: 42 (app) + 133 (rls/admin/depa) + 1 (admin smoke) = **176/176** (was 131 after Sprint 2.1; +33 from Sprint 3.1 and +12 from Terminal B's ADR-0020 which landed on the same day).

### Harness change
- `vitest.config.ts` — `fileParallelism: false`. Parallel test-file execution across 7 files was enough concurrent load on Supabase auth.admin.createUser to trip the "Request rate limit reached" / "Database error creating new user" throttles. Serial execution costs a few extra seconds and eliminates the flaky failure mode. The rate limit is Supabase-side; no test-side correctness issue.

## [Sprint 1.1] — 2026-04-17

**ADR:** ADR-0020 — DEPA Schema Skeleton
**Sprint:** Phase 1, Sprint 1.1 — DEPA schema skeleton in dev database

### Added

- `20260418000001_depa_helpers.sql` — `generate_artefact_id()` (33-char `cs_art_*` prefix, 10-char time-derived + 16-char random); `compute_depa_score(p_org_id uuid)` returns jsonb with `total`, `coverage_score`, `expiry_score`, `freshness_score`, `revocation_score`, `computed_at`. Both per §11.2. `GRANT EXECUTE ... TO authenticated, cs_orchestrator` on `compute_depa_score`.
- `20260418000002_depa_purpose_definitions.sql` — `purpose_definitions` table + 3 indexes. RLS policies: `purpose_defs_select_own`, `purpose_defs_insert_admin`, `purpose_defs_update_admin` (no DELETE — deactivate via `is_active`). Grants: select/insert/update to `authenticated`; select to `cs_orchestrator` + `cs_delivery`. `updated_at` trigger.
- `20260418000003_depa_purpose_connector_mappings.sql` — `purpose_connector_mappings` + 2 indexes + admin-gated RLS (select/insert/delete).
- `20260418000004_depa_consent_artefacts.sql` — `consent_artefacts` (Rule 19 append-only; ULID-default `artefact_id`; 17 columns) + 7 indexes. RLS: `artefacts_select_own` only — no authenticated INSERT/UPDATE/DELETE. Grants: insert + select + update(status, replaced_by) to `cs_orchestrator`; select to `cs_delivery`.
- `20260418000005_depa_artefact_revocations.sql` — `artefact_revocations` (Category B buffer) + 3 indexes including `idx_revocations_undelivered WHERE delivered_at IS NULL`. RLS: select + insert own org; no UPDATE/DELETE policy. BEFORE INSERT trigger `trg_revocation_org_validation` (rejects cross-tenant). AFTER INSERT trigger `trg_artefact_revocation` (in-DB cascade: status→revoked, remove from consent_artefact_index, mark expiry queue superseded, write audit log).
- `20260418000006_depa_consent_expiry_queue.sql` — `consent_expiry_queue` + 3 indexes + SELECT-only RLS. AFTER INSERT trigger `trg_consent_artefact_expiry_queue` on `consent_artefacts` creates one queue row per finite-expiry artefact (notify_at = expires_at − 30 days).
- `20260418000007_depa_compliance_metrics.sql` — `depa_compliance_metrics` (UNIQUE on org_id — one row per org) + SELECT-only RLS + updated_at trigger. Grants: select to authenticated; select/insert/update to cs_orchestrator.
- `20260418000008_depa_alter_existing.sql` — §11.3 ALTERs (4 of 5): `consent_events.artefact_ids text[]` + GIN + partial indexes; `deletion_receipts.artefact_id text` + partial index; `consent_artefact_index.{framework text NOT NULL DEFAULT 'abdm', purpose_code text}` + framework partial index. `cs_orchestrator` UPDATE grant on `consent_events.artefact_ids`.
- `20260418000009_depa_buffer_lifecycle.sql` — `confirm_revocation_delivery(p_revocation_id uuid)` helper (grants execute to cs_delivery). `CREATE OR REPLACE FUNCTION detect_stuck_buffers()` extended to include `artefact_revocations` in the UNION.

### Changed

- `public.consent_events` — new `artefact_ids text[] NOT NULL DEFAULT '{}'` column populated by `process-consent-event` Edge Function (ADR-0021). Empty-array rows > 5 min old are orphans picked up by safety-net cron (ADR-0021).
- `public.deletion_receipts` — new `artefact_id text` column (nullable). Denormalised back-reference for chain-of-custody queries.
- `public.consent_artefact_index` — extended from ABDM-specific to multi-framework; `framework text NOT NULL DEFAULT 'abdm'` preserves pre-DEPA semantics.
- `public.detect_stuck_buffers()` function body replaced (signature preserved at `(buffer_table, stuck_count, oldest_created)` because CREATE OR REPLACE cannot rename OUT columns; §11.9 spec uses different names — drift is cosmetic).

### Deviations from ADR-0020 plan

- **`deletion_requests` ALTER skipped** — the table does not exist in the schema. ADR-0007 (deletion orchestration) uses `deletion_receipts` as a request+receipt hybrid. §11.3 and §8.4 of the architecture reference `deletion_requests` as if it exists; the gap is documented as an architecture finding in ADR-0020, to be resolved in ADR-0022.
- **`detect_stuck_buffers` OUT-column names** preserved as pre-existing `(buffer_table, stuck_count, oldest_created)` instead of §11.9 spec names `(table_name, stuck_count, oldest_stuck_at)` — CREATE OR REPLACE cannot rename OUT columns. Cosmetic drift; behaviour matches spec.

### Deferred (not part of this sprint)

- Dispatch-firing triggers and the `consent-events-artefact-safety-net` cron → ADR-0021.
- Revocation dispatch trigger → ADR-0022.
- `send_expiry_alerts()`, `enforce_artefact_expiry()`, `expiry-alerts-daily`, `expiry-enforcement-daily` cron → ADR-0023.
- `depa-score-refresh-nightly` cron → ADR-0025 (helper `compute_depa_score()` already landed here).

### Tested

- [x] DEPA RLS isolation suite (new `tests/rls/depa-isolation.test.ts`) — 12/12 PASS
- [x] Customer app regression — 42/42 PASS
- [x] Customer app build — all routes compile, no warnings
- [x] Customer app lint — zero warnings
- [x] packages/shared-types type-check — clean (bunx tsc --noEmit)

---

## [Sprint 2.1] — 2026-04-17

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 2, Sprint 2.1 — Operational admin tables + customer-side cross-references

### Added
- `20260417000001_admin_impersonation.sql` — `admin.impersonation_sessions` table + 3 indexes. Two RLS policies: `admin_all` (admin sees everything) + `org_view` (customer SELECTs scoped to `target_org_id = public.current_org_id()`). `public.org_support_sessions` security-invoker view exposes the customer-readable columns via a clean customer-facing path.
- `20260417000002_admin_sectoral_templates.sql` — `admin.sectoral_templates` table + published-template index. Admin-only RLS. `public.list_sectoral_templates_for_sector(p_sector text)` SECURITY DEFINER wrapper returns published templates for the requested sector + 'general' fallback, callable by customer JWT.
- `20260417000003_admin_connector_catalogue.sql` — `admin.connector_catalogue` table (status/connector_code partial index). Admin-only RLS. Adds `connector_catalogue_id uuid references admin.connector_catalogue(id)` nullable column to `public.integration_connectors` (customer-side).
- `20260417000004_admin_tracker_signatures.sql` — `admin.tracker_signature_catalogue` table + active-signature index. Admin-only RLS. Starts empty; operator populates via `admin.import_tracker_signature_pack()` RPC (Sprint 3.1) post-bootstrap. `signature_type` CHECK constraint widened to include `resource_url` (schema-doc amendment — see deviations below).
- `20260417000005_admin_support_tickets.sql` — `admin.support_tickets` + `admin.support_ticket_messages` tables; 3 indexes (open-ticket priority, org-scoped ticket list, ticket message thread). Admin-only RLS on both.
- `20260417000006_admin_org_notes.sql` — `admin.org_notes` table (pinned + org-scoped index). Admin-only RLS.
- `20260417000007_admin_feature_flags.sql` — `admin.feature_flags` table with surrogate `id` PK + `unique index feature_flags_key_scope_org_uq` over `(flag_key, scope, coalesce(org_id, '00…'::uuid))`. Admin-only RLS. `public.get_feature_flag(p_flag_key text)` SECURITY DEFINER resolves org-scope first, then global scope, honouring `expires_at`.
- `20260417000008_admin_kill_switches.sql` — `admin.kill_switches` table + two policies (read: any admin; write: platform_operator only). Seeds 4 switches with `enabled=false`: `banner_delivery`, `depa_processing`, `deletion_dispatch`, `rights_request_intake`.
- `20260417000009_admin_platform_metrics.sql` — `admin.platform_metrics_daily` table (date PK). Admin-only RLS. Written by `admin.refresh_platform_metrics()` RPC (Sprint 3.1).
- `20260417000010_admin_audit_log_impersonation_fk.sql` — retrofit FK `admin.admin_audit_log.impersonation_session_id → admin.impersonation_sessions(id)` deferred from Sprint 1.1.

### Changed
- `public.integration_connectors` — new nullable FK column `connector_catalogue_id`. No behaviour change for existing rows; customer UI (ADR-0018 follow-up) will let operators pick pre-built connectors from the catalogue.
- `admin.admin_audit_log` — FK on `impersonation_session_id` now enforced. No data in the column yet; Sprint 3.1 RPCs populate it.

### Deviations from ADR-0027 plan
- **`public.integrations` → `public.integration_connectors`.** ADR Sprint 2.1 deliverables + schema doc §3.5 reference `public.integrations`; real customer table is `public.integration_connectors`. FK column is on the real name.
- **`admin.feature_flags` primary key expression.** Schema doc §3.9 uses `primary key (flag_key, scope, coalesce(org_id, '00…'::uuid))`; PostgreSQL rejects expressions in PRIMARY KEY. Replaced with surrogate `id uuid primary key` + `unique index` over the same COALESCE expression. Identical uniqueness semantics.
- **`admin.tracker_signature_catalogue.signature_type` CHECK.** Schema doc §3.6 lists four values; the existing seed file uses `resource_url` for URL-match rules (e.g., `google-analytics.com/g/collect`). CHECK widened to include `resource_url` so Sprint 3.1 import RPC can ingest the seed.
- **Seed data NOT loaded into `admin.tracker_signature_catalogue`.** Two blockers: shape mismatch (seed `detection_rules` is a jsonb array, catalogue is flat one-row-per-rule) and `created_by NOT NULL references admin.admin_users` (no admin exists until Sprint 4.1 bootstrap). Catalogue starts empty; `admin.import_tracker_signature_pack()` RPC (Sprint 3.1) does the transform post-bootstrap.
- **`admin.kill_switches` write-policy direct-UPDATE test moved to Sprint 3.1.** Writes to admin operational tables are never granted to `authenticated` at the table level — they flow through SECURITY DEFINER RPCs (`admin.toggle_kill_switch` in Sprint 3.1). Role gating (platform_operator vs support) is therefore tested at the RPC boundary, not the RLS write policy. The write policy remains declared as defence-in-depth.

### Tested
- [x] `bun run test:rls` — 4 files, 88/88 — PASS
  - tests/rls/isolation.test.ts — 25/25 (unchanged baseline)
  - tests/rls/url-path.test.ts — 19/19 (unchanged baseline)
  - tests/admin/foundation.test.ts — 11/11 (unchanged Sprint 1.1 baseline)
  - tests/admin/rls.test.ts — 33/33 (new): 8 admin-only tables × 3 assertions (admin/customer/anon) = 24; impersonation_sessions two-policy split (3); kill_switches read/write split (3); 2 customer-facing helpers; 1 customer regression on `integration_connectors`
- [x] `cd app && bun run test` — 7 files, 42/42 (unchanged baseline) — PASS
- [x] `cd admin && bun run test` — 1/1 smoke (unchanged) — PASS
- [x] `cd app && bun run lint` — 0 warnings — PASS
- [x] Post-migration verification queries — PASS
  - 12 admin tables (excluding audit_log partitions)
  - 14 admin RLS policies (1 each for 8 tables + 2 for impersonation + 2 for kill_switches + SELECT-only audit_log + admin_users)
  - 1 public view (`org_support_sessions`)
  - 4 seeded kill_switches (all `enabled=false`)
  - 2 customer-facing admin-data helpers (`list_sectoral_templates_for_sector`, `get_feature_flag`)
  - FK retrofit present on both parent and 2026-04 partition

Combined: 42 (app) + 88 (rls + admin foundation + admin rls) + 1 (admin smoke) = **131/131** (was 98 after Sprint 1.1; +33 new).

## [Sprint 1.1] — 2026-04-16

**ADR:** ADR-0027 — Admin Platform Schema
**Sprint:** Phase 1, Sprint 1.1 — Foundation (schema + cs_admin role + helpers + admin_users + admin_audit_log)

### Added
- `20260416000011_admin_schema.sql` — `create schema admin`; revoke-all from public; grant USAGE + CREATE to postgres. Tables + RPCs in subsequent migrations populate it.
- `20260416000012_cs_admin_role.sql` — third scoped role `cs_admin` (NOLOGIN NOINHERIT BYPASSRLS). Used by security-definer admin RPCs for cross-org SELECTs. `grant cs_admin to authenticator with set true` (Postgres 16 GRANT ROLE separation). Default-privilege grant on future public tables so new customer schemas inherit SELECT automatically.
- `20260416000013_admin_helpers.sql` — 4 helper functions: `admin.is_admin()`, `admin.current_admin_role()`, `admin.require_admin(p_min_role)`, `admin.create_next_audit_partition()` (SECURITY DEFINER — invoked by pg_cron in Sprint 3.1).
- `20260416000014_admin_users.sql` — `admin.admin_users` table with FK to `auth.users(id)` (ON DELETE CASCADE), partial unique index on `bootstrap_admin=true`, is_admin RLS policy. Granted SELECT/INSERT/UPDATE/DELETE to authenticated (RLS is the row-level gate).
- `20260416000015_admin_audit_log.sql` — `admin.admin_audit_log` partitioned by month, with the 2026-04 first partition; 4 indexes (admin/org/action/session); SELECT-only RLS policy; INSERT/UPDATE/DELETE REVOKED from authenticated AND cs_admin (append-only invariant enforced). FK to `admin.impersonation_sessions` deferred to Sprint 2.1 (table doesn't exist yet); column is plain uuid for now.
- `20260416000016_expose_admin_schema_postgrest.sql` — `alter role authenticator set pgrst.db_schemas to 'public, graphql_public, admin'` + NOTIFY reload config. PostgREST now serves admin.* routes.
- `20260416000017_reload_postgrest_schema.sql` — NOTIFY `reload schema` nudge so PostgREST re-introspects the admin schema and caches the new tables/RPCs.
- `20260416000018_grant_admin_schema_usage_to_authenticated.sql` — `grant usage on schema admin to authenticated`. Schema-level prerequisite so the is_admin RLS policies get to evaluate. anon role deliberately left out.

### Changed
- `supabase/config.toml` — `[api] schemas` expanded from `["public", "graphql_public"]` to `["public", "graphql_public", "admin"]`. Mirrors the hosted project's PostgREST setting so local dev (`supabase start`) and `supabase config push` stay aligned.

### Deviations from ADR-0027 plan
- ADR-0027 listed Sprint 1.1 as 5 migrations in the order: admin_schema → cs_admin_role → admin_helpers → admin_audit_log → admin_users. Audit log FK-references admin_users, so the actual deploy order is schema → role → helpers → **admin_users → admin_audit_log**. Documented in ADR-0027 execution notes; the deliverables themselves are unchanged.
- ADR-0027 did not list the PostgREST exposure migrations (20260416000016/17/18). Those surfaced during Sprint 1.1 test execution — the default Supabase PostgREST config exposes only public + graphql_public. Without exposing admin, no admin-app code path works. Treated as Sprint 1.1 follow-ups and logged in the execution notes.

### Tested
- [x] `bun run test:rls` (root; now runs both tests/rls and tests/admin) — 3 files, 55/55 tests pass — PASS
  - tests/rls/isolation.test.ts — 25/25 (unchanged baseline)
  - tests/rls/url-path.test.ts — 19/19 (unchanged baseline)
  - tests/admin/foundation.test.ts — 11/11 (new): is_admin() function; admin_users RLS (admin can SELECT, customer denied, anon denied); admin_audit_log RLS + append-only (customer denied; admin can SELECT; admin cannot INSERT/UPDATE/DELETE via direct query); customer regression (public.organisations unaffected)
- [x] `cd app && bun run test` — 7 files, 42/42 (unchanged baseline) — PASS
- [x] `cd admin && bun run test` — 1/1 smoke (unchanged from ADR-0026 Sprint 3.1) — PASS

Combined: 42 (app) + 55 (rls + admin foundation) + 1 (admin smoke) = 98/98.

## Review fix-batch — 2026-04-16

**Source:** `docs/reviews/2026-04-16-phase2-completion-review.md` (N-S1, N-S3)

### Added
- `20260416000008_worker_errors_table.sql` (N-S1) — operational
  table for Cloudflare Worker → Supabase write failures. Org-scoped
  read for `authenticated`; INSERT to `cs_worker`; SELECT to
  `cs_orchestrator`; REVOKE update/delete from `authenticated`. New
  daily cleanup cron `worker-errors-cleanup-daily` at `15 3 * * *`
  enforces 7-day retention.
- `20260416000009_cron_url_via_vault.sql` (N-S3) — re-schedules the
  4 HTTP cron jobs (`sla-reminders-daily`,
  `check-stuck-deletions-hourly`, `security-scan-nightly`,
  `consent-probes-hourly`) to read the project URL from
  `vault.decrypted_secrets where name = 'supabase_url'` instead of
  hardcoding `https://xlqiakmkdjycfiioslgs.supabase.co`. Same Vault
  pattern as `cs_orchestrator_key`.
- `20260416000010_seed_supabase_url_vault.sql` (N-S3 follow-on) —
  idempotent `vault.create_secret` for the `supabase_url` Vault
  entry so `db push` is self-sufficient on a clean environment.

### Tested
- [x] `supabase db push --linked` — all 3 migrations applied clean.
- [x] `bun run test` — 86/86 still passing (no regression in
  scoped-role tests).

## ADR-0017 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0017 — Audit Export Package (Phase 1)

### Added
- `20260416000007_audit_export.sql`:
  - Table `audit_export_manifests` — pointer-only history of
    exports (never stores ZIP bytes). RLS restricts SELECT to the
    org; INSERT flows through the RPC as `cs_orchestrator`.
  - Function `public.rpc_audit_export_manifest(p_org_id uuid)` —
    security-definer aggregator owned by `cs_orchestrator`, granted
    to `authenticated`. Returns a single JSONB blob containing org
    profile, data inventory, banners, properties, consent-events
    monthly rollup (last 90 days), rights-request bucketed summary,
    deletion receipts (hash only — never raw identifier), latest
    security-scan signals per property, and last-30-day probe runs.
  - Membership guard: caller must be a member of the org.

### Tested
- [x] `supabase db push` — migration applied clean.
- [x] Direct psql call to the RPC as superuser (no JWT) fails with
  `unauthenticated` — security-definer guard confirmed.

## ADR-0016 Sprint 1 — 2026-04-16

**ADR:** ADR-0016 — Consent Probes (static HTML analysis v1)

### Added
- `20260416000006_consent_probes_cron.sql`: hourly `consent-probes-hourly`
  cron at `10 * * * *` pointing at the new `run-consent-probes` Edge Function.
  Reuses the vault orchestrator key pattern.

### Changed
- `web_properties.url` for `Demo Violator` → now points at
  `consentshield-demo.vercel.app/violator?violate=1` so the probe target is
  the pre-consent-injection variant. Dev-only demo data; not a schema change.

### Seeded (direct SQL, not in a migration)
- Two acceptance-test probes in the demo org: one against Demo Violator
  (probe_type = `all-rejected`) and one against Demo Blog
  (probe_type = `analytics-rejected`). Both with `schedule='hourly'`.

### Tested
- [x] `supabase db push` — migration applied clean.
- [x] Live fire of the function returned 200 with probe runs inserted.

## ADR-0015 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0015 — Security Posture Scanner
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260416000005_security_scan_cron.sql`: re-schedules the nightly
  `security-scan-nightly` cron at `30 20 * * *` (02:00 IST) pointing
  at the newly-built `run-security-scans` Edge Function. (Had been
  dropped in migration `20260416000004` because the function didn't
  exist yet.)

### Tested
- [x] `supabase db push` — migration applied clean.
- [x] `net.http_post` live call to the function returned 200 with
  `{"scanned":6,"findings":18,"violations":12}`.

## ADR-0012 Sprint 3 — 2026-04-16

**ADR:** ADR-0012 — Automated Test Suites for High-Risk Paths
**Sprint:** Phase 1, Sprint 3

### Added
- `tests/buffer/delivery.test.ts` — 6 tests for the three buffer
  lifecycle functions: `sweep_delivered_buffers` (delivered > 5 min →
  deleted; < 5 min → kept; undelivered → kept),
  `detect_stuck_buffers` (old undelivered → reported; fresh row →
  delta = 0), `mark_delivered_and_delete` (atomic mark + delete).
- `tests/buffer/lifecycle.test.ts` — 6 tests confirming the
  `authenticated` role's REVOKE from migration 011: UPDATE + DELETE
  on `audit_log` and `processing_log` fail with "permission denied";
  INSERT on `consent_events` and `tracker_observations` also fails.

### Tested
- [x] `bun run test` — 69 → 81 PASS (+12 buffer tests)
- [x] `bun run lint` + `bun run build` — clean

## ADR-0011 Sprint 1.1 — 2026-04-16

**ADR:** ADR-0011 — Deletion Retry and Timeout
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260416000001_deletion_retry_state.sql`:
  - Column `next_retry_at timestamptz` on `deletion_receipts`.
  - Partial index `idx_deletion_receipts_retry` on
    `(next_retry_at) where status = 'awaiting_callback'` — keeps the
    hourly retry scan bounded.
  - Re-grants `UPDATE` to `cs_orchestrator` to include `next_retry_at`.
- `20260416000002_deletion_retry_cron.sql`: registers
  `check-stuck-deletions-hourly` pg_cron job at `45 * * * *`, using
  the vault-stored `cs_orchestrator_key`.
- `20260416000003_enable_pg_net.sql`: enables the `pg_net` extension
  on hosted Supabase so that pg_cron's `net.http_post` calls actually
  run. Was missing from the project — all HTTP cron jobs had been
  silently failing with `schema "net" does not exist`.

### Tested
- [x] `supabase db push` — three migrations applied clean.
- [x] `net.http_post` live call to the deployed function returned 200 OK.

## Cron cleanup — 2026-04-16

**ADR:** n/a (ops cleanup surfaced by ADR-0011 verification)

### Changed
- `20260416000004_unschedule_orphan_crons.sql`: drops three cron
  entries whose Edge Functions were never built —
  `stuck-buffer-detection-hourly` (→ `check-stuck-buffers`),
  `security-scan-nightly` (→ `run-security-scans`),
  `retention-check-daily` (→ `check-retention-rules`). They had been
  failing silently with `schema "net" does not exist` (before
  pg_net was enabled) and would fail with `404` after, so removal
  leaves the cron log clean. The jobs will be re-scheduled alongside
  the corresponding features (ADR-0015 security scanner + Phase-3
  retention enforcement).

### Tested
- [x] `select jobname from cron.job` — returns four green jobs, no
  orphans.
- [x] Live `send-sla-reminders` smoke — 200 OK `{"sent":0}` after
  redeploy with `--no-verify-jwt`.

## ADR-0012 Sprint 1 — 2026-04-16

**ADR:** ADR-0012 — Automated Test Suites for High-Risk Paths
**Sprint:** Phase 1, Sprint 1

### Added
- `tests/workflows/sla-timer.test.ts` — covers the
  `set_rights_request_sla` trigger across six boundary dates +
  20-date property sweep (2026–2030). Exact millisecond comparisons
  via `Date.getTime()` so Postgres millisecond-trimming doesn't
  cause false positives.
- `tests/rls/url-path.test.ts` — S-2 from the 2026-04-14 review:
  authenticated Org A client cannot SELECT or UPDATE Org B's
  rights_request regardless of whether `.eq('org_id', orgB)` is
  included in the predicate. Confirms both the URL contract and
  the RLS contract.

### Tested
- [x] `bun run test` — 43 → 55 PASS (+12 new)
- [x] `bun run lint` — PASS
- [x] `bun run build` — PASS

## Loose-end cleanup — 2026-04-16

**ADR:** n/a (cleanup)

### Changed
- `20260414000010_scoped_roles_rls_and_auth.sql`: removed the
  `grant usage on schema auth to cs_orchestrator, cs_delivery;` line.
  It emitted `WARNING: no privileges were granted for "auth"` and
  changed nothing — the `auth` schema is owned by `supabase_auth_admin`
  and `postgres` cannot grant USAGE on it. The BYPASSRLS grants below
  it were the actual fix. Any RPC needing `auth.uid()` must use
  `public.current_uid()` (added in `20260415000001`).
- No live DB change required — the live DB was already past this
  migration and the removed line was a no-op. Fresh-DB setups will
  no longer emit the misleading warning.

### Fixed
- Removed stale `auth.users` row for `anegondhi@gmail.com`
  (id `cde31bea-734b-4796-ab3a-be490ac04b8b`, unconfirmed, 0
  memberships) via one-off `DELETE` — created during the 2026-04-15
  DNS/DMARC bounce-loop debugging and never completed signup.

## ADR-0008 Sprint 1.2, 1.4 — 2026-04-14

**ADR:** ADR-0008 — Browser Auth Hardening
**Sprint:** Phase 1, Sprints 1.2 and 1.4

### Added
- `20260414000003_origin_verified.sql` — adds `origin_verified text not null
  default 'legacy-hmac'` to `consent_events` and `tracker_observations`.
  Intake code sets `'origin-only'` for browser callers and `'hmac-verified'`
  for server-to-server callers.
- `20260414000004_rotate_signing_secrets.sql` — regenerates every
  `web_properties.event_signing_secret` (all prior values were shipped into
  browsers via the old banner script) and records a
  `event_signing_secret_rotated_at` timestamp.

### Tested
- [ ] Live `supabase db push` — pending user approval (destructive on
  production secrets).

## B-5 / B-7 / B-8 / B-9 remediation — 2026-04-14

Closes four blocking findings from the 2026-04-14 review.

### Added
- `20260414000006_buffer_indexes_and_cleanup.sql`:
  - **B-7:** partial indexes `idx_delivery_buffer_delivered_stale`,
    `idx_rr_events_delivered_stale`,
    `idx_deletion_receipts_delivered_stale`, and a full undelivered +
    delivered-stale pair for `withdrawal_verifications`,
    `security_scans`, and `consent_probe_runs` — the sweep and stuck
    detection functions previously full-scanned these six tables.
  - **B-9:** `cleanup_unverified_rights_requests()` security definer
    function owned by `cs_orchestrator`, scheduled daily at 02:15 UTC
    via pg_cron. Deletes rights_requests where `email_verified=false`
    and `created_at < now() - 24h`.
  - **B-8:** revoked `execute on encrypt_secret/decrypt_secret` from
    `service_role`, granted execute on both to `cs_orchestrator` and
    granted execute on `decrypt_secret` to `cs_delivery` (for dispatch).

### Tested
- [ ] Live `supabase db push` — pending user approval.

## 2026-04-15 — deployment fixups

### Added
- `20260414000000_scoped_roles_set_option.sql` — corrective migration for
  PostgreSQL 16's split of GRANT ROLE into admin/inherit/set options.
  Migration 010 used the pre-16 syntax and produced `set_option = f`, which
  made `ALTER FUNCTION ... OWNER TO cs_orchestrator` fail with "must be
  able to SET ROLE". This migration re-grants with `with set true` and
  grants `CREATE on schema public` to `cs_orchestrator` and `cs_delivery`
  (PG 15+ revoked `CREATE` on public by default, without which function
  ownership transfer fails with "permission denied for schema public").
- `20260414000009_cron_vault_secret.sql` — re-scheduled the four
  pg_net-based cron jobs to read the orchestrator key from Supabase Vault
  (`select decrypted_secret from vault.decrypted_secrets where name =
  'cs_orchestrator_key'`). Hosted Supabase forbids `ALTER DATABASE ... SET
  app.<key>` (permission denied), so the GUC-based approach in migration
  008 was non-viable.

### Operator one-time actions (not in migrations)
- `select vault.create_secret('<key>', 'cs_orchestrator_key');` — run in
  the Supabase SQL editor or via psql.

### Applied
- All migrations through `20260414000009` applied via psql (the Supabase
  CLI pooler path FATAL'd on the large rpc migration; fallback ran clean).
- Confirmed `consent_events.origin_verified` now shows rows with
  `'origin-only'` from a live smoke test.

## S-3 / S-12 remediation — 2026-04-14

### Added
- `20260414000008_webhook_dedup_and_cron_secret.sql`:
  - **S-3:** `webhook_events_processed(source, event_id, org_id, processed_at)`
    table with composite primary key; `rpc_webhook_mark_processed` (anon
    grant, security definer, uses ON CONFLICT DO NOTHING + FOUND check) so
    callers can detect and drop replays.
  - **S-12:** re-scheduled pg_cron jobs (stuck-buffer, sla-reminders,
    security-scan, retention-check) now read the orchestrator key via
    `current_setting('app.cs_orchestrator_key', true)` instead of a literal
    `<cs_orchestrator_key>` placeholder. The operator injects the real key
    via `alter database postgres set app.cs_orchestrator_key to '...';`.

## ADR-0009 Sprint 2.1 + 3.1 — 2026-04-14

**ADR:** ADR-0009 — Scoped-Role Enforcement in REST Paths
**Sprint:** Phase 2, Sprint 2.1 and Phase 3, Sprint 3.1

### Added
- `20260414000007_scoped_rpcs_authenticated.sql`:
  - Public reads: `rpc_get_rights_portal`, `rpc_get_privacy_notice`
    (anon-granted).
  - Authenticated writes: `rpc_rights_event_append`, `rpc_banner_publish`,
    `rpc_integration_connector_create`, `rpc_signup_bootstrap_org`,
    `rpc_plan_limit_check` (authenticated-granted; auth.uid() membership
    check inside).
  - Webhook: `rpc_razorpay_apply_subscription` (anon-granted, state machine
    in SQL).
  - Widened `encrypt_secret` and `decrypt_secret` execute to `authenticated`
    so the Next.js encryption library can call them without service-role.

## ADR-0009 Sprint 1.1 — 2026-04-14

**ADR:** ADR-0009 — Scoped-Role Enforcement in REST Paths
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260414000005_scoped_rpcs_public.sql` — three security-definer functions
  owned by `cs_orchestrator` and granted to `anon`:
  `rpc_rights_request_create`, `rpc_rights_request_verify_otp`,
  `rpc_deletion_receipt_confirm`. The deletion-receipt RPC also enforces the
  `awaiting_callback → confirmed` state machine (closes B-6).
- Grant extensions on `cs_orchestrator`: `insert on rights_requests` plus
  `update (email_verified, email_verified_at, otp_hash, otp_expires_at, otp_attempts)`.

### Tested
- [ ] Live `supabase db push` — pending.
