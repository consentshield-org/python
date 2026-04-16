# Changelog — Schema

Database migrations, RLS policies, roles.

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
