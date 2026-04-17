# ADR-0027: Admin Platform Schema (cs_admin Role + `admin.*` Tables + Audit Log + Impersonation)

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-16
**Date completed:** —
**Depends on:** ADR-0026 (Monorepo Restructure). Sprints 1.1–3.1 of ADR-0026 are Completed; Sprint 4.1 (Vercel split + CI isolation guards) is deferred — not a blocker for ADR-0027 because this ADR operates against the dev database (routine per `project_dev_only_no_prod`) and introduces no Vercel-project dependencies.

---

## Context

The 2026-04-16 admin platform design pass produced three architecture documents (`consentshield-admin-platform.md`, `consentshield-admin-schema.md`, `consentshield-admin-monorepo-migration.md`) and a wireframe (`consentshield-admin-screens.html`). The platform doc defines the operator surface, the wireframes define the UI, but **none of the admin database objects exist yet**. Without them, the admin app skeleton from ADR-0026 cannot do anything beyond render a placeholder page.

This ADR ports the schema design (`consentshield-admin-schema.md`) into the live database. It introduces the `cs_admin` Postgres role, the `admin` schema, 11 admin-only tables, the audit-logging RPC pattern that gives Rule 22 its teeth, the impersonation lifecycle that gives Rule 23 its mechanism, and the kill-switches infrastructure that gives Rule 25 its operational lever. It also bootstraps Sudhindra as the first `platform_operator`-tier admin user.

Critically, this ADR does NOT build any admin UI. The admin app skeleton from ADR-0026 continues to render a placeholder. Real admin panels (Operations Dashboard, Organisations, Audit Log viewer, etc.) are scope for ADR-0028+. After this ADR ships, the admin schema is fully present in the database and ready to be queried/written by the panels that follow.

The customer app continues to function unchanged. The customer-side public.* schema is untouched by this ADR with three small exceptions noted in §10 of `consentshield-admin-schema.md` (added FK on `public.integrations.connector_catalogue_id`, new `public.org_support_sessions` view, no change to `public.organisations.status` which already exists).

## Decision

Land the admin schema in 14 migrations grouped into 4 phases, plus a one-shot bootstrap script to insert Sudhindra as the first admin and seed `auth.users.raw_app_meta_data.is_admin = true`. Every admin write to a customer table will go through a security-definer RPC in the `admin` schema that audit-logs in the same transaction (Rule 22). Every admin table will have RLS enabled with at least one policy gated on the `is_admin` JWT claim. The `cs_admin` role gets `BYPASSRLS = true` for SELECT only — writes always go through RPCs.

The full SQL for every object is already specified in `docs/admin/architecture/consentshield-admin-schema.md`. This ADR's job is to ship those migrations in a sequence that keeps the database verifiable at every step, and to wire the test harness that catches regressions.

## Consequences

- **The database gains the `admin` schema and the `cs_admin` role** — both are net-new and isolated from `public.*` and customer roles. Migrations to the customer schema continue to use the standard `postgres` role; admin migrations also use `postgres` for DDL (cs_admin owns objects but doesn't perform DDL itself).
- **A new audit-logging RPC pattern becomes the canonical write path for any admin mutation** to a customer table. Future admin features must use this pattern; raw `UPDATE public.<table>` from the admin app is rejected in review.
- **The `admin.admin_audit_log` table is permanent and append-only.** Once this ADR ships, nothing can delete or modify rows from it — including platform_operator. Storage growth is bounded by monthly partitioning + cold-storage detach (out of scope for v1; planned for when audit log exceeds ~50K rows).
- **Sudhindra becomes the bootstrap admin** with `bootstrap_admin = true`. The flag prevents another admin from disabling Sudhindra. The bootstrap admin's account requires hardware key 2FA (enforced by ADR-0026 Phase 4 once `ADMIN_HARDWARE_KEY_ENFORCED=true` is set in production).
- **4 new pg_cron jobs are scheduled** (monthly audit-log partition creation, 5-min impersonation expiry sweep, nightly platform metrics refresh, 2-min kill-switch sync to KV). All use the `admin-` prefix to distinguish from customer-side cron jobs.
- **The `cs_orchestrator` role gets read access to the new `public.org_support_sessions` view** so the customer-side "Support sessions" tab (W13 in customer ALIGNMENT) can read it without additional grants.
- **The customer-side `public.integrations` table gets a nullable FK to `admin.connector_catalogue.id`.** Existing rows are unaffected (FK is nullable). New customer integrations created after ADR-0028 onwards will populate the FK.
- **No admin UI changes** in this ADR. The admin app skeleton from ADR-0026 remains a placeholder. Real panels start in ADR-0028.
- **Customer app is unchanged.** No DEPA roadmap dependency; this ADR can ship in parallel with any DEPA ADR.

---

## Implementation Plan

### Phase 1: Foundation — schema, role, audit log, admin users

**Goal:** The `admin` schema, `cs_admin` role, helpers, audit log table (with monthly partitioning ready), and admin user table all exist. No real data yet (no admins, no audit rows). Customer app continues to function untouched.

#### Sprint 1.1: Schema bootstrap + cs_admin role + audit log + admin_users + helpers

**Estimated effort:** 3 hours (4 migrations + helper functions + verification queries + RLS isolation tests)

**Deliverables:**

- [ ] **Migration `<ts>_admin_schema.sql`** — `create schema admin`; `revoke all on schema admin from public`; `grant usage on schema admin to cs_admin`; `grant create on schema admin to postgres`; comment block per `consentshield-admin-schema.md` §1.
- [ ] **Migration `<ts>_cs_admin_role.sql`** — `create role cs_admin nologin noinherit bypassrls`; `grant cs_admin to authenticator with set true` (Postgres 16 GRANT ROLE separation per `reference_supabase_platform_gotchas.md`); `grant select on all tables in schema public to cs_admin`; `grant usage on schema public to cs_admin`. Verification per §2 of the schema doc.
- [ ] **Migration `<ts>_admin_helpers.sql`** — `admin.is_admin()`, `admin.current_admin_role()`, `admin.require_admin(p_min_role text)`, `admin.create_next_audit_partition()`. All `grant execute ... to authenticated, cs_admin`. Per schema doc §4.
- [ ] **Migration `<ts>_admin_audit_log.sql`** — `admin.admin_audit_log` partitioned table; first partition `admin_audit_log_<YYYY>_<MM>` for the current month; 4 indexes (admin_idx, org_idx, action_idx, session_idx); RLS enabled with read-only policy for admins; `revoke insert, update, delete on admin.admin_audit_log from authenticated, cs_admin` (writes happen only inside security-definer RPCs that bypass via the function owner). Per schema doc §3.2.
- [ ] **Migration `<ts>_admin_users.sql`** — `admin.admin_users` table; partial unique index on `bootstrap_admin = true`; RLS policy `admin_users_admin_only`. Per schema doc §3.1.

**Testing plan:**

- [ ] **Verification queries (run after each migration)**:
  - `select rolname, rolbypassrls from pg_roles where rolname = 'cs_admin'` → exactly one row, `rolbypassrls = true`
  - `select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'admin' and not rowsecurity` → zero rows
  - `select count(*) from pg_policies where schemaname = 'admin'` → at least one policy per table created so far
  - `select * from pg_policies where schemaname = 'admin' and tablename = 'admin_audit_log' and cmd in ('INSERT','UPDATE','DELETE')` → zero rows
- [ ] **New RLS isolation test** `tests/admin/foundation.test.ts`:
  - `authenticated` JWT (no `is_admin` claim) cannot SELECT from any `admin.*` table → expect `permission denied` or empty result depending on policy
  - `authenticated` JWT with `is_admin=true` claim CAN SELECT from `admin.admin_users` and `admin.admin_audit_log`
  - `anon` JWT cannot SELECT from any `admin.*` table
  - `cs_admin` role (assumed via `set role cs_admin`) can SELECT from any `public.*` table without RLS filtering — confirms BYPASSRLS works
- [ ] **Customer regression**: existing `tests/rls/isolation.test.ts` (39/39) continues to pass — confirms admin schema does not bleed into customer RLS.
- [ ] **Build/lint/test on the customer app** — `bun --filter app run build` + `bun --filter app run test` (86/86) still pass; no app code references the admin schema yet.

**Status:** `[x] complete` — 2026-04-16

**Execution notes (2026-04-16):**

- **Migration order reordered from the ADR draft.** The ADR listed `admin_audit_log` before `admin_users`, but the audit-log table FK-references `admin_users`, so the actual deploy order is: `admin_schema` → `cs_admin_role` → `admin_helpers` → **`admin_users` → `admin_audit_log`**. Deliverables unchanged.
- **3 additional migrations landed beyond the 5 listed in the ADR**, all driven by test-execution discoveries:
  1. `20260416000016_expose_admin_schema_postgrest.sql` — `alter role authenticator set pgrst.db_schemas to 'public, graphql_public, admin'` + `notify pgrst, 'reload config'`. Default Supabase PostgREST exposes only `public` + `graphql_public`; without this, every admin-app request returns "invalid schema: admin".
  2. `20260416000017_reload_postgrest_schema.sql` — `notify pgrst, 'reload schema'`. Reloading config doesn't reload the schema cache; without this, PostgREST still returns "could not find the table in the schema cache".
  3. `20260416000018_grant_admin_schema_usage_to_authenticated.sql` — `grant usage on schema admin to authenticated`. Schema-level prerequisite (RLS gates rows; grants gate schema access). Without this, every admin-app request from authenticated JWT returns "permission denied for schema admin" before RLS evaluates.
- **`supabase/config.toml` `[api] schemas` expanded** from `["public", "graphql_public"]` to `["public", "graphql_public", "admin"]` so local dev and future `config push` stay aligned with the hosted project's exposed schemas.
- **`admin.admin_audit_log`'s FK to `admin.impersonation_sessions`** is deferred to Sprint 2.1 (the table doesn't exist yet). The column is a plain uuid; the retrofit in Sprint 2.1 adds `alter table admin.admin_audit_log add constraint ... foreign key (impersonation_session_id) references admin.impersonation_sessions(id)`.
- **`admin.create_next_audit_partition()`** is not granted EXECUTE to anyone in Sprint 1.1 — it's only called by pg_cron (scheduled in Sprint 3.1), which runs as postgres.

**Test harness additions (new):**
- `tests/admin/helpers.ts` — `createAdminTestUser(role)` provisions an auth user with `app_metadata.is_admin=true` + `admin_role=...` and signs them in to get a JWT. Complements `tests/rls/helpers.ts` (customer-side).
- `tests/admin/foundation.test.ts` — 11 assertions: `admin.is_admin()` returns correct value per JWT; admin JWT can SELECT `admin.admin_users` + `admin.admin_audit_log`; customer JWT denied; anon JWT denied; admin JWT cannot INSERT/UPDATE/DELETE on audit log (append-only); customer regression (`public.organisations` unaffected).
- Root `vitest.config.ts` `include` expanded to `['tests/rls/**/*.test.ts', 'tests/admin/**/*.test.ts']`. The `bun run test:rls` script now runs both suites.

---

### Phase 2: Operational tables

**Goal:** All 8 operational admin tables (impersonation_sessions, sectoral_templates, connector_catalogue, tracker_signature_catalogue, support_tickets + messages, org_notes, feature_flags, kill_switches, platform_metrics_daily) exist with RLS and the customer-side cross-references (the `public.org_support_sessions` view, the FK on `public.integrations`).

#### Sprint 2.1: Operational table migrations

**Estimated effort:** 3 hours (8 migrations + 1 view + 1 customer FK + per-table RLS tests)

**Deliverables (one migration per table; one commit per migration for revert-safety):**

- [x] **Migration `20260417000001_admin_impersonation.sql`** — `admin.impersonation_sessions` table; 3 indexes; both RLS policies (`admin_all` for full admin access + `org_view` for customer-side read scoped by `target_org_id = public.current_org_id()`); `public.org_support_sessions` security-invoker view; `grant select on public.org_support_sessions to authenticated`. Per schema doc §3.3.
- [x] **Migration `20260417000002_admin_sectoral_templates.sql`** — `admin.sectoral_templates`; published-template index; admin RLS; `public.list_sectoral_templates_for_sector(p_sector text)` security-definer function; `grant execute ... to authenticated`. Per schema doc §3.4.
- [x] **Migration `20260417000003_admin_connector_catalogue.sql`** — `admin.connector_catalogue` table; active index; admin RLS; `alter table public.integrations add column connector_catalogue_id uuid references admin.connector_catalogue(id)` (nullable; existing rows unaffected). Per schema doc §3.5.
- [x] **Migration `20260417000004_admin_tracker_signatures.sql`** — `admin.tracker_signature_catalogue` table; active index; admin RLS; one-shot data load from `supabase/seed/tracker_signatures.sql` into the new table (`insert into admin.tracker_signature_catalogue (signature_code, display_name, vendor, ...) select ... from <seed source>`). Per schema doc §3.6.
- [x] **Migration `20260417000005_admin_support_tickets.sql`** — `admin.support_tickets` + `admin.support_ticket_messages` tables; 3 indexes; admin RLS on both. Per schema doc §3.7.
- [x] **Migration `20260417000006_admin_org_notes.sql`** — `admin.org_notes` table; org index; admin RLS. Per schema doc §3.8.
- [x] **Migration `20260417000007_admin_feature_flags.sql`** — `admin.feature_flags` table; org index; admin RLS; `public.get_feature_flag(p_flag_key text)` security-definer function; `grant execute ... to authenticated`. Per schema doc §3.9.
- [x] **Migration `20260417000008_admin_kill_switches.sql`** — `admin.kill_switches` table; two RLS policies (read for any admin, write for platform_operator only); seed 4 default switches with `enabled = false` (banner_delivery, depa_processing, deletion_dispatch, rights_request_intake). Per schema doc §3.10.
- [x] **Migration `20260417000009_admin_platform_metrics.sql` + `20260417000010_admin_audit_log_impersonation_fk.sql`** — `admin.platform_metrics_daily` table; admin RLS. The `admin.refresh_platform_metrics(p_date date)` function lands in Sprint 3.1 (it's an RPC, not a table). Per schema doc §3.11.

**Testing plan:**

- [ ] **Verification queries** after each migration: every new table has RLS enabled (zero rows from the §8.1 query) and at least one policy (zero rows from §8.2). The `kill_switches` table has the 4 seeded rows (`select count(*) from admin.kill_switches` → 4).
- [ ] **Per-table RLS tests** added to `tests/admin/foundation.test.ts` (or a new `tests/admin/rls.test.ts`):
  - For each new table: customer JWT cannot SELECT, INSERT, UPDATE, DELETE
  - For each new table: admin JWT (with `is_admin=true`) CAN SELECT (write tests deferred to Sprint 3.1 where RPCs exist)
  - For `admin.kill_switches` write policy: admin JWT with `admin_role='support'` CANNOT update; admin JWT with `admin_role='platform_operator'` CAN update (using direct UPDATE; in production all writes go through `admin.toggle_kill_switch` RPC, but the underlying RLS must be correct)
- [ ] **Customer-side cross-reference tests**:
  - As a customer JWT scoped to org X: `select * from public.org_support_sessions` returns only rows where `org_id = X` (no rows initially, since no impersonation sessions exist yet)
  - As a customer JWT scoped to org X: `select public.list_sectoral_templates_for_sector('saas')` returns the published templates for sector 'saas' or 'general' (zero rows initially since no templates published yet)
  - As a customer JWT: `select public.get_feature_flag('depa_dashboard_enabled')` returns NULL (no flags set yet)
- [ ] **Existing tests still pass**: `bun --filter app run test` (86/86) + `bun test tests/rls/` (39/39).

**Status:** `[x] complete` — 2026-04-17

**Execution notes (2026-04-17):**

- **All 10 migrations applied** (9 Sprint 2.1 tables/view/helpers + 1 FK retrofit). Timestamps `20260417000001` through `20260417000010`. One commit bundled for reviewability (Sprint 1.1's per-table split proved low-value given the small diff and matched test suite).
- **Schema doc deviation 1 — `public.integrations` is actually `public.integration_connectors`.** ADR §Sprint 2.1 deliverables and schema doc §3.5 refer to `public.integrations`; the real customer table created in `20260413000003_operational_tables.sql` is `integration_connectors`. The FK column `connector_catalogue_id` is added to `integration_connectors`. Documented in Architecture Changes.
- **Schema doc deviation 2 — `admin.feature_flags` primary key.** Schema doc §3.9 uses `primary key (flag_key, scope, coalesce(org_id, '00...'::uuid))`. PostgreSQL rejects expressions in PRIMARY KEY. Replaced with a surrogate `id uuid primary key` + a unique index over the same COALESCE expression. Same uniqueness semantics; documented in Architecture Changes.
- **Schema doc deviation 3 — `tracker_signature_catalogue.signature_type`.** Schema doc §3.6 CHECK constraint omits `'resource_url'` but the existing seed file uses it (e.g., `google-analytics.com/g/collect`). Added to the CHECK constraint so the Sprint 3.1 `admin.import_tracker_signature_pack` RPC can ingest the seed without data loss. Documented in Architecture Changes.
- **One-shot seed load skipped intentionally.** ADR Sprint 2.1 listed a bulk INSERT from `supabase/seed/tracker_signatures.sql` into `admin.tracker_signature_catalogue`. Blockers: (a) shape mismatch — seed stores `detection_rules` as a jsonb array of rule objects; catalogue is flat (one row per rule); (b) `created_by NOT NULL` references `admin.admin_users` but no admin user exists until Sprint 4.1. Catalogue starts empty; operator populates via `admin.import_tracker_signature_pack()` RPC (Sprint 3.1) post-bootstrap. Migration comment documents the rationale.
- **`kill_switches` write-policy direct-UPDATE test deferred to Sprint 3.1.** ADR Sprint 2.1 test plan asked for platform_operator-can-UPDATE / support-cannot-UPDATE assertions directly against the table. In practice no table-level `INSERT/UPDATE/DELETE` grant is given to `authenticated` on admin tables — all writes flow through SECURITY DEFINER RPCs (`admin.toggle_kill_switch` in Sprint 3.1), which run as function owner and bypass both RLS and table-level permission checks. Direct UPDATE from authenticated JWT returns `permission denied for table kill_switches` regardless of admin_role. Role-gating test moves to `tests/admin/rpcs.test.ts` (Sprint 3.1) against the RPC boundary. The write RLS policy itself is still defined as defence-in-depth if a future writer gains the missing grant.

**Test harness additions (new):**
- `tests/admin/rls.test.ts` — 33 assertions: 8 admin-only tables × 3 policies (admin allowed / customer denied / anon denied) = 24; 3 impersonation_sessions (admin + customer-direct + customer-via-view); 3 kill_switches (admin sees 4 seeded / customer denied / direct-UPDATE denied); 2 customer-facing helpers (`list_sectoral_templates_for_sector`, `get_feature_flag`); 1 regression on `integration_connectors`.
- No changes to `tests/admin/helpers.ts` (existing `createAdminTestUser(role)` handled platform_operator + `support` admin provisioning without modification).

---

### Phase 3: RPCs and pg_cron

**Goal:** The 40+ admin RPCs exist. They enforce role + reason constraints, write audit log + perform mutation in same transaction. The 4 admin pg_cron jobs are scheduled.

#### Sprint 3.1: Admin RPCs + pg_cron

**Estimated effort:** 4 hours (one large migration for the RPC set + one for cron + matched RPC contract tests)

**Deliverables:**

- [ ] **Migration `<ts>_admin_rpcs.sql`** — all admin RPCs per schema doc §§5, 6. Group by category for readability:
  - **Org management**: `admin.suspend_org`, `admin.restore_org`, `admin.extend_trial`, `admin.update_customer_setting`
  - **Impersonation**: `admin.start_impersonation`, `admin.end_impersonation`, `admin.force_end_impersonation`
  - **Sectoral templates**: `admin.create_sectoral_template_draft`, `admin.update_sectoral_template_draft`, `admin.publish_sectoral_template`, `admin.deprecate_sectoral_template`
  - **Connector catalogue**: `admin.add_connector`, `admin.update_connector`, `admin.deprecate_connector`
  - **Tracker signatures**: `admin.add_tracker_signature`, `admin.update_tracker_signature`, `admin.deprecate_tracker_signature`, `admin.import_tracker_signature_pack`
  - **Support tickets**: `admin.update_support_ticket`, `admin.add_support_ticket_message`, `admin.assign_support_ticket`
  - **Org notes**: `admin.add_org_note`, `admin.update_org_note`, `admin.delete_org_note` (audit-logged hard delete; the only delete an admin can do)
  - **Feature flags**: `admin.set_feature_flag`, `admin.delete_feature_flag` (audit-logged)
  - **Kill switches**: `admin.toggle_kill_switch`
  - **Platform metrics**: `admin.refresh_platform_metrics(p_date date)` — re-aggregates `admin.platform_metrics_daily` for the given date
  - **Bulk-export auditing wrapper**: `admin.audit_bulk_export(p_target_table text, p_filter jsonb, p_row_count int)` — called by API routes after a bulk export so the audit log records what was exported
  - Each RPC follows the template in schema doc §5: requires admin role check, reason ≥ 10 chars, captures old + new state, inserts audit row + performs write in the same transaction. `pg_notify` calls for impersonation start/end + kill-switch toggles for downstream Edge Function consumption.
- [ ] **Migration `<ts>_admin_pg_cron.sql`** — schedule the 4 cron jobs per schema doc §9:
  - `admin-create-next-audit-partition` — `0 6 25 * *` (25th of month at 06:00)
  - `admin-expire-impersonation-sessions` — `*/5 * * * *`
  - `admin-refresh-platform-metrics` — `0 2 * * *`
  - `admin-sync-config-to-kv` — `*/2 * * * *` (calls a new `sync-admin-config-to-kv` Edge Function that lands in Sprint 3.2)
- [ ] **Migration `<ts>_grant_admin_rpc_execute.sql`** — `grant execute on function admin.<each RPC>(...) to authenticated` (every admin RPC must be callable by the admin app's JWT). Wrap in a `do $$ ... $$` block that loops over `pg_proc` for `nspname = 'admin'` to keep the migration concise + future-proof for new RPCs.

#### Sprint 3.2: sync-admin-config-to-kv Edge Function

**Estimated effort:** 1.5 hours

**Deliverables:**

- [ ] **`supabase/functions/sync-admin-config-to-kv/index.ts`** — Deno Edge Function called by the `admin-sync-config-to-kv` cron job every 2 minutes. Reads `admin.kill_switches`, `admin.tracker_signature_catalogue WHERE status='active'`, `admin.sectoral_templates WHERE status='published'`. Pushes serialised state to Cloudflare KV via the Cloudflare API. Auth: cron secret in `Authorization: Bearer` header (validated against `vault.decrypted_secrets.cron_secret`).
- [ ] **`worker/src/admin-config.ts`** — new helper module that reads kill-switch + tracker-signature state from KV and exposes typed accessors. Used by `worker/src/banner.ts` (kill switch check before serving the real banner) and `worker/src/observations.ts` (active tracker signatures for client-side scoring).
- [ ] **Worker wiring**: `worker/src/banner.ts` checks `admin-config.killSwitchEnabled('banner_delivery')` before serving the real banner; if engaged, returns the no-op banner. `worker/src/observations.ts` uses `admin-config.activeTrackerSignatures()` instead of the static seed file (the seed migration in Sprint 2.1 has now made the catalogue the source of truth).

**Testing plan (combined for Phase 3):**

- [ ] **RPC contract tests** in new `tests/admin/rpcs.test.ts`:
  - Each RPC rejects calls without admin claim (expect `42501` SQLSTATE)
  - Each RPC rejects calls with reason < 10 chars (expect explicit error)
  - `admin.suspend_org` and `admin.toggle_kill_switch` reject calls with `admin_role != 'platform_operator'`
  - `admin.start_impersonation` creates a row in `admin.impersonation_sessions`, inserts an `impersonate_start` audit row, sets `expires_at` to `now() + 30 minutes`, and emits a `pg_notify` on `impersonation_started` channel
  - `admin.end_impersonation` updates the session and inserts an `impersonate_end` audit row in the same transaction
  - `admin.publish_sectoral_template` marks the previous published version as `deprecated` + sets `superseded_by_id`
  - `admin.toggle_kill_switch` updates `enabled` + emits `pg_notify` on `kill_switch_changed` channel
- [ ] **Audit-log invariant tests** in `tests/admin/audit_log.test.ts`:
  - Calling any RPC with valid args produces exactly one audit row per call (no duplicates, no zero)
  - Audit row's `admin_user_id` matches `auth.uid()` of the caller
  - Audit row's `reason` matches the input
  - Audit row's `old_value` and `new_value` are JSONB representations of the affected row before/after
  - **Append-only invariant**: as `cs_admin` role, attempting to `delete from admin.admin_audit_log where ...` returns `permission denied`
  - **Append-only invariant**: as `cs_admin` role, attempting to `update admin.admin_audit_log set ...` returns `permission denied`
- [ ] **pg_cron schedule tests**:
  - `select * from cron.job where jobname like 'admin-%'` → 4 rows
  - Each job's schedule matches the spec (compare against expected cron expressions)
- [ ] **Sync to KV smoke test**: manually invoke `sync-admin-config-to-kv` Edge Function via `bunx supabase functions invoke`; verify Cloudflare KV gets updated keys (`admin:kill_switches:<switch_key>`, `admin:tracker_signatures:active`, `admin:sectoral_templates:published`).
- [ ] **Worker regression**: existing `tests/worker/{events,observations,banner}.test.ts` still pass with the new admin-config.ts wiring.

**Status:** `[ ] planned`

---

### Phase 4: Bootstrap admin user

**Goal:** Sudhindra exists as the first admin with `bootstrap_admin = true`, `admin_role = 'platform_operator'`, hardware key registered, status = active. The admin app skeleton from ADR-0026 can now actually log Sudhindra in (assuming AAL2 hardware key is set up via Supabase Auth UI separately).

#### Sprint 4.1: Bootstrap script + smoke test

**Estimated effort:** 1 hour

**Deliverables:**

- [ ] **One-shot script `scripts/bootstrap-admin.ts`** (NOT a migration — a Bun script run manually with the service role key as a one-off). Behaviour:
  - Reads `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` from env
  - Confirms an `auth.users` row exists for that email (Sudhindra would have signed up via the admin app's `/login` page first; the script does not create the auth user)
  - Updates `auth.users.raw_app_meta_data` to set `is_admin = true` and `admin_role = 'platform_operator'` for that user
  - Inserts the matching row into `admin.admin_users` with `bootstrap_admin = true`, `display_name = ...`, `status = 'active'`, `created_by = self`
  - Refuses to run if any `admin.admin_users` row already exists with `bootstrap_admin = true` (idempotency / safety)
  - Refuses to run unless invoked with `--i-understand-this-is-a-one-time-action`
- [ ] **Documentation**: bootstrap procedure documented in `docs/admin/architecture/consentshield-admin-platform.md` §10 ("Admin secrets") with a link to this script. Step-by-step: (1) sign up in admin/login UI with the operator email + password + WebAuthn; (2) run `bunx tsx scripts/bootstrap-admin.ts --i-understand-this-is-a-one-time-action`; (3) sign out + sign in again to pick up the new JWT claims; (4) verify the placeholder Operations Dashboard renders.
- [ ] **Update `consentshield-admin-platform.md` §10** with the actual bootstrap procedure (currently §10 has a TBD note); wire from this ADR's Architecture Changes section.

**Testing plan:**

- [ ] **Bootstrap rehearsal**: in dev, sign up a throw-away test user (`bootstrap-test@consentshield.in`), run the bootstrap script with that email, verify:
  - `select raw_app_meta_data from auth.users where email = 'bootstrap-test@consentshield.in'` includes `"is_admin": true, "admin_role": "platform_operator"`
  - `select * from admin.admin_users` returns exactly one row with `bootstrap_admin = true`
  - Re-running the script fails with the idempotency error
- [ ] **Real bootstrap**: after rehearsal succeeds, repeat with `a.d.sudhindra@gmail.com`. Verify both queries.
- [ ] **Smoke test the admin app** (existing skeleton from ADR-0026):
  - Sign in via admin app's `/login` with hardware key
  - Verify the placeholder Operations Dashboard renders Sudhindra's display name
  - Verify the admin proxy now lets requests through (was blocked pre-bootstrap because no JWT had `is_admin=true`)
- [ ] **Cleanup**: delete the throw-away `bootstrap-test@consentshield.in` user via Supabase Auth UI; verify `admin.admin_users` cascade-deletes the row.

**Status:** `[ ] planned`

---

## Architecture Changes

- `docs/admin/architecture/consentshield-admin-schema.md` — confirmed source of truth; this ADR ports it into migrations exactly as specified. Any deviation discovered during implementation is documented as an amendment to the schema doc + a note in the relevant sprint's Test Results.
- `docs/admin/architecture/consentshield-admin-platform.md` §10 — bootstrap procedure documented (Sprint 4.1 deliverable).
- `docs/architecture/consentshield-complete-schema-design.md` — small additions noted in `consentshield-admin-schema.md` §7: customer-side `public.integration_connectors.connector_catalogue_id` FK becomes part of the customer schema documentation (cross-reference back to admin schema).
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §6 — tick the "Bootstrap admin" deferred-gap row when this ADR completes, then close the prerequisite for ADR-0028.

### Sprint 2.1 amendments to `consentshield-admin-schema.md` (landed 2026-04-17)

Three deviations from the schema doc are baked into the migrations and documented here as amendments. The schema doc itself should be updated when the next review pass runs.

1. **§3.5 `admin.connector_catalogue` cross-reference table name.** Doc says `alter table public.integrations add column ...`; the real customer-side table created in `20260413000003_operational_tables.sql` is `public.integration_connectors`. Migration `20260417000003_admin_connector_catalogue.sql` adds the FK column to `integration_connectors`. The schema doc should be updated to read `public.integration_connectors` wherever `public.integrations` currently appears in §3.5.
2. **§3.9 `admin.feature_flags` primary key.** Doc specifies `primary key (flag_key, scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid))`. PostgreSQL rejects expressions in PRIMARY KEY. Migration `20260417000007_admin_feature_flags.sql` uses a surrogate `id uuid primary key default gen_random_uuid()` + a `unique index feature_flags_key_scope_org_uq` over the same COALESCE expression. Same uniqueness semantics; the schema doc should adopt this shape.
3. **§3.6 `admin.tracker_signature_catalogue.signature_type` CHECK constraint.** Doc lists four values (`script_src`, `cookie_name`, `localstorage_key`, `dom_attribute`). Real-world detection rules in the existing `supabase/seed/tracker_signatures.sql` also use `resource_url` (e.g., `google-analytics.com/g/collect`). Migration `20260417000004_admin_tracker_signatures.sql` widens the CHECK to include `resource_url`. The schema doc should pick up the fifth value.

---

## Test Results

_To be filled per sprint as the work executes._

### Sprint 1.1 — 2026-04-16 (Completed)

```
bunx supabase db push      → 8 migrations applied (5 core + 3 PostgREST-exposure follow-ups)
bun run test:rls           → 3 files, 55/55 pass
  - tests/rls/isolation.test.ts      → 25/25 (unchanged baseline)
  - tests/rls/url-path.test.ts       → 19/19 (unchanged baseline)
  - tests/admin/foundation.test.ts   → 11/11 (new)
cd app && bun run test     → 42/42 (unchanged baseline)
cd admin && bun run test   → 1/1 (unchanged smoke)
Combined: 98/98 (was 87/87 before Sprint 1.1)

New admin-foundation assertions (11):
  ✓ admin.is_admin() returns true for admin JWT
  ✓ admin.is_admin() returns false for customer JWT
  ✓ admin JWT can SELECT admin.admin_users
  ✓ customer JWT denied SELECT on admin.admin_users
  ✓ anon JWT denied SELECT on admin.admin_users
  ✓ admin JWT can SELECT admin.admin_audit_log
  ✓ customer JWT denied SELECT on admin.admin_audit_log
  ✓ admin JWT cannot INSERT into admin.admin_audit_log (append-only)
  ✓ admin JWT cannot UPDATE admin.admin_audit_log (append-only)
  ✓ admin JWT cannot DELETE from admin.admin_audit_log (append-only)
  ✓ customer regression — customer JWT can SELECT own org
```

### Sprint 2.1 — 2026-04-17 (Completed)

```
bunx supabase db push      → 10 migrations applied (20260417000001–10)
bun run test:rls           → 4 files, 88/88 pass
  - tests/rls/isolation.test.ts      → 25/25 (unchanged baseline)
  - tests/rls/url-path.test.ts       → 19/19 (unchanged baseline)
  - tests/admin/foundation.test.ts   → 11/11 (unchanged Sprint 1.1 baseline)
  - tests/admin/rls.test.ts          → 33/33 (new)
cd app && bun run test     → 42/42 (unchanged baseline)
cd admin && bun run test   → 1/1 (unchanged smoke)
Combined: 131/131 (was 98/98 after Sprint 1.1; +33 new)

Sprint 2.1 assertions (33) — by concern:
  ✓ 8 admin-only tables × 3 assertions (admin SELECT / customer denied /
     anon denied) = 24
     - sectoral_templates, connector_catalogue, tracker_signature_catalogue,
       support_tickets, support_ticket_messages, org_notes, feature_flags,
       platform_metrics_daily
  ✓ admin.impersonation_sessions (two-policy table)
     - admin JWT can SELECT all
     - customer JWT can SELECT via org_view policy (0 rows)
     - customer JWT can SELECT via public.org_support_sessions view (0 rows)
  ✓ admin.kill_switches (split read/write policies)
     - admin JWT sees 4 seeded switches with enabled=false
     - customer JWT denied SELECT
     - direct UPDATE denied (writes go via admin.toggle_kill_switch RPC, Sprint 3.1)
  ✓ customer-facing helper functions
     - public.list_sectoral_templates_for_sector('saas') → 0 rows
     - public.get_feature_flag('depa_dashboard_enabled') → NULL
  ✓ customer regression
     - public.integration_connectors still readable after FK column addition

Schema-doc amendments consolidated in Architecture Changes:
  1. public.integrations → public.integration_connectors (naming)
  2. feature_flags PK → surrogate id + unique index over coalesce expression
  3. tracker_signature_catalogue.signature_type CHECK widened with 'resource_url'
```


### Sprint 3.1 — TBD

### Sprint 3.2 — TBD

### Sprint 4.1 — TBD

---

## Risks and Mitigations

- **The `admin` schema's RLS-enabled tables and the `cs_admin` BYPASSRLS role interact with PostgREST in subtle ways** — specifically, BYPASSRLS applies to direct queries but security-definer functions run as the function owner. Mitigation: the schema doc's pattern (writes via security-definer RPCs owned by `postgres`, audit insert + write in same transaction) is exactly the pattern proven by ADR-0009 for the customer-side scoped roles. Tests in Sprint 3.1 cover the contract end-to-end.
- **PostgreSQL 16 `GRANT ROLE ... WITH SET TRUE`** is required for the admin pooler connection to assume `cs_admin` per session (per `reference_supabase_platform_gotchas.md`). Mitigation: Sprint 1.1 migration explicitly includes `with set true`; covered by the existing `migration 20260413000011_scoped_roles_set_option.sql` precedent.
- **Bootstrap admin lockout**: if the bootstrap script runs against the wrong email, the wrong user gets admin privileges. Mitigation: script reads from env vars (not CLI args); idempotency check (refuses if a bootstrap admin already exists); manual confirmation flag (`--i-understand-this-is-a-one-time-action`); rehearsal with a throw-away user before the real run.
- **Hardware key loss before second key registered**: bootstrap admin loses both keys, locked out. Mitigation: documented in `consentshield-admin-platform.md` §10 — break-glass procedure is direct DB update via service role to clear the hardware key requirement temporarily, re-enrol, then re-engage. ADR-0026 Phase 4 explicitly requires 2 hardware keys registered before AAL2 enforcement turns on in production.
- **Audit log partition for next month not created in time**: cron job runs on the 25th of each month for the following month's partition, so there's a 5-day buffer. Mitigation: if the cron fails, inserts into the next month would error; the test in Sprint 3.1 verifies the cron is scheduled, and the platform metrics dashboard (Phase 2) surfaces failed cron jobs.
- **Migration 13 (admin_rpcs.sql) is large** (~40 functions, ~1500 lines). Mitigation: split internally by category (Org management / Impersonation / Sectoral templates / etc.) with comment headers; each category's RPCs can be reviewed independently. If review feedback demands a true split into multiple migrations, that's a 30-minute restructuring inside Sprint 3.1 and does not change the deployment order.

---

## Out of Scope (Explicitly)

- **Admin UI panels** — Operations Dashboard real wiring, Audit Log viewer, Organisations table, etc. All scope for ADR-0028 onwards. The admin app skeleton from ADR-0026 remains a placeholder until ADR-0028.
- **Customer-side "Support sessions" tab** (W13) — wireframe addition + customer app implementation. Tracked in `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md`. Coordinated with admin ADR-0029 (Organisations + Impersonation).
- **Customer-side suspended-org banner state** (W14) — wireframe addition + Worker change + customer dashboard banner. Coordinated with admin ADR-0029.
- **Worker integration with kill switches and tracker signatures** beyond the Sprint 3.2 wiring. The Sprint 3.2 deliverables provide the read path; richer Worker behaviour (per-org kill switches, signature severity escalation) are future ADRs.
- **Admin role change UI** — adding/removing admins, changing admin_role between platform_operator/support/read_only. Deferred until a second admin is hired (deliberate gap per `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §5).
- **Cross-region operator console**, **audit log full-text search**, **side-by-side sectoral template diff viewer**, **real-time platform metrics** — all listed as deliberate gaps in the alignment doc; deferred to future ADRs.

---

## Changelog References

- `CHANGELOG-schema.md` — each sprint adds migration entries
- `CHANGELOG-edge-functions.md` — Sprint 3.2 adds `sync-admin-config-to-kv`
- `CHANGELOG-worker.md` — Sprint 3.2 adds `admin-config.ts` wiring + kill switch check in banner.ts + dynamic tracker signatures in observations.ts
- `CHANGELOG-infra.md` — Sprint 4.1 documents the bootstrap procedure

---

## Approval Gates

- **Before Sprint 1.1:** ADR-0026 must be Completed (workspace + admin app skeleton + Vercel project split all live). The admin schema lands against the dev database; production database doesn't differ in structure from dev (per `project_dev_only_no_prod` memory).
- **Before Sprint 3.2:** confirm Cloudflare KV namespace exists and the Cloudflare API token in Vercel env has Edit permissions on it (this is the path the sync-config-to-kv function writes to).
- **Before Sprint 4.1:** Sudhindra has signed up via admin app's `/login` UI and has a `auth.users` row; at least 2 hardware keys are registered (per ADR-0026 Phase 4 requirement); a backup of `auth.users.raw_app_meta_data` is recorded somewhere safe (in case the bootstrap script needs to be re-run).
- **Before marking Completed:** all four sprints' Status set to `[x] complete`; all 12 verification queries from `consentshield-admin-schema.md` §8 return the expected results; admin app placeholder Operations Dashboard renders Sudhindra's display name on signin; bootstrap-admin uniqueness invariant holds (`select count(*) from admin.admin_users where bootstrap_admin = true` → 1).

---

*ADR-0027 — Admin Schema. After this ADR completes, ADR-0028 (Admin App Skeleton + Operations Dashboard + Audit Log) becomes the next runnable work — it will wire the admin app's first real panels against the schema landed here.*
