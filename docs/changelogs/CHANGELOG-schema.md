# Changelog — Schema

Database migrations, RLS policies, roles.

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
