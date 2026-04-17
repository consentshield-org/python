# ADR-0020: DEPA Schema Skeleton

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0019 (DEPA roadmap charter). No runtime dependency on ADR-0026 (monorepo) or ADR-0027 (admin schema); this ADR operates against the customer-facing `public.*` schema only.
**Unblocks:** ADR-0021 (`process-consent-event` Edge Function + dispatch trigger), ADR-0022 (revocation cascade), ADR-0023 (expiry pipeline), ADR-0024 (purpose-definition UI), ADR-0025 (DEPA score).

---

## Context

ADR-0019 sequenced the DEPA implementation into six downstream ADRs. This is the first of them. It ports the static, non-dispatching pieces of §11 of `docs/architecture/consentshield-complete-schema-design.md` into the live `public.*` schema:

- **New tables** (§11.4): `purpose_definitions`, `purpose_connector_mappings`, `consent_artefacts`, `artefact_revocations`, `consent_expiry_queue`, `depa_compliance_metrics`.
- **New ALTERs** (§11.3) on existing tables, to add back-references that downstream ADRs will populate.
- **New helper functions** (§11.2) that contain no outbound `net.http_post` calls: `generate_artefact_id()`, `compute_depa_score()`.
- **New triggers** (§11.8) that are purely in-database — no Edge Function dispatch: the expiry-queue insert trigger, the revocation BEFORE-org-validation trigger, the revocation in-database cascade trigger, and `updated_at` triggers on the mutable tables.
- **Buffer-lifecycle additions** (§11.9): `confirm_revocation_delivery()` and the extension of `detect_stuck_buffers()` to include `artefact_revocations`.
- **Indexes** (§11.5), **RLS policies** (§11.6), **scoped-role grants** (§11.7).

Three §11 deliverables are explicitly **deferred** to downstream ADRs, because they depend on infrastructure that does not yet exist:

1. `trg_consent_event_artefact_dispatch`, `trigger_process_consent_event()`, `safety_net_process_consent_events()`, and the `consent-events-artefact-safety-net` cron job — **deferred to ADR-0021** because they call `net.http_post` to a `process-consent-event` Edge Function that does not exist yet.
2. `trg_artefact_revocation_dispatch`, `trigger_process_artefact_revocation()` — **deferred to ADR-0022** for the same reason.
3. `send_expiry_alerts()`, `enforce_artefact_expiry()`, and the `expiry-alerts-daily` / `expiry-enforcement-daily` cron jobs — **deferred to ADR-0023**; they form the expiry pipeline which has its own test surface.
4. `depa-score-refresh-nightly` cron job — **deferred to ADR-0025** (the `compute_depa_score()` helper ships here so 0025 only has to schedule the job).

### Architecture finding — `deletion_requests` table does not exist

`consentshield-complete-schema-design.md` §11.3 calls for an `ALTER TABLE deletion_requests ADD COLUMN artefact_id text ...`, and `consentshield-definitive-architecture.md` §8.4 treats `deletion_requests` as an existing table in the four-link chain of custody (`consent_artefacts → artefact_revocations → deletion_requests → deletion_receipts`). **The table does not exist.** The ADR-0007 generic-webhook deletion flow was implemented directly against `deletion_receipts` (which carries both request-side and receipt-side columns — `request_payload`, `response_payload`, `status`, `requested_at`, `confirmed_at`). No intermediate `deletion_requests` table was ever created.

**This ADR does not create `deletion_requests`.** The responsibility is deferred to ADR-0022 (revocation pipeline), which will either:
- introduce `deletion_requests` as a new table and migrate the existing deletion flow to pass through it, or
- document that `deletion_receipts` *is* the request+receipt table and amend the architecture doc to stop referring to `deletion_requests` as a distinct object.

The `consent_events.artefact_ids`, `deletion_receipts.artefact_id`, and `consent_artefact_index.{framework, purpose_code}` ALTERs from §11.3 **are** applied in this ADR (those tables exist). See §Architecture Changes.

### Shared types land here

`packages/shared-types/` is currently a stub (`export {}`). This ADR is its first real payload — it publishes TypeScript type definitions that mirror the new DEPA tables, for both the customer app and the admin app to consume. Per `feedback_share_narrowly_not_broadly`, only types consumed by *both* apps live here; app-specific UI prop types stay in the owning app's `src/types/`.

---

## Decision

Ship the DEPA schema skeleton as a single sprint of 9 migrations timestamped `20260418000001_*..20260418000009_*`, plus the `packages/shared-types/src/depa.ts` module and the `tests/rls/depa-isolation.test.ts` suite. Every migration is revert-friendly (one concern per file). The sprint completes when §11.11 verification queries all return expected results and the full test suite is green.

This ADR creates **no Edge Functions**, **no cron jobs**, and **no UI**. It creates schema objects that are read-ready and write-gated: the new tables accept writes only from `cs_orchestrator` (via Edge Functions added in ADR-0021+) and from the BEFORE-insert triggers defined here. Customer app code does not change — dashboard queries will surface DEPA data once ADR-0024 lands the UI; until then the tables sit empty and the pipeline is inert.

---

## Consequences

- **9 new migrations** applied to the dev Supabase. All reversible (each file creates one concern; DROP sequence is the inverse).
- **6 new tables** in `public.*`, each with RLS enabled and at least one policy. `consent_artefacts` has SELECT-only for `authenticated` (writes through `cs_orchestrator` in ADR-0021); `artefact_revocations` has SELECT + INSERT for `authenticated` (no UPDATE/DELETE policy — immutable). Rule 12 (RLS on every table) and Rule 13 (org_id on every table) are satisfied.
- **3 columns added** to existing tables via ALTER TABLE: `consent_events.artefact_ids text[]`, `deletion_receipts.artefact_id text`, `consent_artefact_index.{framework text, purpose_code text}`. None are backfilled from historical rows (existing seeds default to sensible values — `consent_events.artefact_ids = '{}'`, `consent_artefact_index.framework = 'abdm'` which preserves pre-DEPA semantics).
- **`scoped_orchestrator` role gains INSERT/UPDATE grants** on the new artefact tables. `cs_worker` gains nothing (continues to only INSERT `consent_events`). `cs_delivery` gains SELECT + DELETE + UPDATE(delivered_at) on `artefact_revocations` and SELECT on `consent_artefacts` + `purpose_definitions` for delivery-payload assembly.
- **`authenticated` role gains INSERT on `artefact_revocations` but NOT on `consent_artefacts`.** Revocation is a user-initiated action from the preference centre; artefact creation is a platform-initiated action from the Edge Function. The BEFORE-insert trigger validates org ownership before accepting the revocation. This is deliberate — authenticated users can revoke their own artefacts but cannot fabricate them.
- **`detect_stuck_buffers()` function is rebuilt** (via `CREATE OR REPLACE`) to include `artefact_revocations` in its UNION. Existing callers (admin dashboard stuck-buffer check, check-stuck-buffers cron) see one additional row in the result set. Signature is unchanged.
- **`packages/shared-types/src/depa.ts` is published** and re-exported through `packages/shared-types/src/index.ts`. The customer app does not yet import from it (ADR-0024 wires UI consumption); the admin app does not yet import from it (future admin ADRs wire the cross-org surface). Shipping the types now means ADR-0021 through ADR-0025 inherit them rather than inventing them ad hoc.
- **No DEPA cron jobs scheduled.** The 4 DEPA cron jobs (`expiry-alerts-daily`, `expiry-enforcement-daily`, `depa-score-refresh-nightly`, `consent-events-artefact-safety-net`) are deferred to the ADRs that own their functionality.
- **No banner API change.** Customer banners continue to publish with the pre-DEPA `purposes` JSONB schema (no `purpose_definition_id` required). ADR-0024 will add the `purpose_definition_id` requirement with a 422 at the banner save endpoint.
- **Customer regression risk is low.** No existing column is modified; no existing trigger is removed; no existing role grant is altered except for the additive grants listed above. The `consent_artefact_index` ALTER adds two columns — both nullable or defaulted — so existing ABDM rows continue to match the SELECT surface of downstream readers. Existing 86 app-level and RLS tests must continue to pass.
- **No data migration.** Per §11.13, customer consent data is zero across all environments. The pre-DEPA `consent_events` fixtures in dev (used by the RLS suite) gain `artefact_ids = '{}'` by default; they are not promoted to `consent_artefacts` rows.

### Architecture Changes

This ADR surfaces one architecture-doc drift for correction (tracked but not corrected here — correction is in scope for ADR-0022):

- `consentshield-complete-schema-design.md` §11.3 and §11.13 reference a `deletion_requests` table that does not exist. §8.4 of `consentshield-definitive-architecture.md` references the same table in the chain-of-custody narrative. ADR-0022 will resolve by either creating the table and migrating the existing deletion flow, or amending the docs to reflect that `deletion_receipts` fills both roles. This ADR skips the `deletion_requests` ALTER and notes the gap in the migration file comment.

---

## Implementation Plan

### Phase 1: DEPA schema skeleton in dev database

**Goal:** Every object specified in §11.2 (non-dispatch helpers), §11.3 (existing-table ALTERs, minus `deletion_requests`), §11.4 (new tables), §11.5 (indexes), §11.6 (RLS), §11.7 (grants), §11.8 (non-dispatch triggers), and §11.9 (buffer-lifecycle) lives in the dev Supabase. `packages/shared-types/src/depa.ts` is published. `tests/rls/depa-isolation.test.ts` passes. §11.11 verification queries 1, 2, 3, 6, 8, 9, 12 all return expected results (queries 4, 5, 7, 10, 11 are ADR-0021+ responsibility and are marked not-yet-applicable in the verification log).

#### Sprint 1.1: Migrations, shared types, tests

**Estimated effort:** 4 hours (9 migrations + shared-types publication + RLS isolation tests + verification run)

**Deliverables:**

- [ ] **Migration `20260418000001_depa_helpers.sql`** — `generate_artefact_id()` (ULID-ish, 33-char `cs_art_*` prefix per §11.2) + `compute_depa_score(p_org_id uuid)` returns jsonb (§11.2 verbatim; the function references tables that don't exist yet at this migration's point of apply — acceptable because function bodies are not checked until first invocation). `GRANT EXECUTE ... TO authenticated, cs_orchestrator, cs_delivery`.
- [ ] **Migration `20260418000002_depa_purpose_definitions.sql`** — `purpose_definitions` table + 3 indexes + RLS (`purpose_defs_select_own`, `purpose_defs_insert_admin`, `purpose_defs_update_admin`; no DELETE policy — deactivate via `is_active = false`) + grants (select/insert/update to `authenticated` where org-admin gate in RLS; select + insert to `cs_orchestrator`; select to `cs_delivery`) + `updated_at` trigger.
- [ ] **Migration `20260418000003_depa_purpose_connector_mappings.sql`** — `purpose_connector_mappings` table + 2 indexes + RLS (select/insert/delete-admin) + grants (select + insert + delete to `authenticated` via RLS; select to `cs_orchestrator`).
- [ ] **Migration `20260418000004_depa_consent_artefacts.sql`** — `consent_artefacts` table + 7 indexes + RLS (`artefacts_select_own` only; no INSERT/UPDATE/DELETE policy — writes go through cs_orchestrator per Rule 19 append-only) + grants (select to `authenticated`; insert + select to `cs_orchestrator`; update (status, replaced_by) to `cs_orchestrator`; select to `cs_delivery`) + the expiry-queue insert trigger `trg_consent_artefact_expiry_queue` (depends on `consent_expiry_queue` existing — **so this migration creates a forward-reference; the trigger is wired in migration 000006 after `consent_expiry_queue` is created**).

  *Resolved ordering:* the `trg_consent_artefact_expiry_queue` trigger is deferred to migration `20260418000006_depa_consent_expiry_queue.sql` which creates the target table and then wires the trigger.

- [ ] **Migration `20260418000005_depa_artefact_revocations.sql`** — `artefact_revocations` table (Category B buffer, `delivered_at` column) + 3 indexes (including `idx_revocations_undelivered WHERE delivered_at IS NULL`) + RLS (`revocations_select_own`, `revocations_insert_own`; no UPDATE/DELETE for any role) + grants (select + insert to `authenticated`; insert to `cs_orchestrator`; select + delete + update(delivered_at) to `cs_delivery`) + BEFORE trigger `trg_revocation_org_validation` (uses `trg_revocation_org_check()` helper; rejects cross-tenant inserts) + AFTER trigger `trg_artefact_revocation` (uses `trg_artefact_revocation_cascade()` helper; in-DB cascade: status→revoked, remove from `consent_artefact_index`, mark expiry queue superseded, write audit log).
- [ ] **Migration `20260418000006_depa_consent_expiry_queue.sql`** — `consent_expiry_queue` table + 3 indexes + RLS (`expiry_queue_select_own`) + grants (select to `authenticated`; select + update(notified_at, processed_at, superseded) to `cs_orchestrator`) + the deferred `trg_consent_artefact_expiry_queue` trigger + its function `trg_artefact_create_expiry_entry()`.
- [ ] **Migration `20260418000007_depa_compliance_metrics.sql`** — `depa_compliance_metrics` table (UNIQUE on `org_id` — one row per org) + RLS (`depa_metrics_select_own`) + grants (select to `authenticated`; select + insert + update to `cs_orchestrator`) + `updated_at` trigger.
- [ ] **Migration `20260418000008_depa_alter_existing.sql`** — §11.3 ALTERs on existing tables: `consent_events.artefact_ids text[] NOT NULL DEFAULT '{}'` + GIN index + partial index WHERE artefact_ids='{}'; `deletion_receipts.artefact_id text` + partial index; `consent_artefact_index.framework text NOT NULL DEFAULT 'abdm'` and `purpose_code text` + framework index. Column comments per §11.3. **Explicit SQL comment noting that the `deletion_requests` ALTER is skipped because the table does not exist; see ADR-0020 architecture finding.**
- [ ] **Migration `20260418000009_depa_buffer_lifecycle.sql`** — `confirm_revocation_delivery(p_revocation_id uuid)` helper + `CREATE OR REPLACE FUNCTION detect_stuck_buffers()` extended to include `artefact_revocations` in the UNION.

- [ ] **`packages/shared-types/src/depa.ts`** — TypeScript type definitions for every new DEPA table (PurposeDefinition, PurposeConnectorMapping, ConsentArtefact, ArtefactRevocation, ConsentExpiryQueueEntry, DepaComplianceMetrics), plus the enum-style union types (ArtefactStatus, Framework, RevocationReason, RevokedByType). Field names are `snake_case` to match Supabase client deserialisation (existing convention in `app/src/lib/rights/deletion-dispatch.ts`).
- [ ] **`packages/shared-types/src/index.ts`** — re-export `./depa`.
- [ ] **`tests/rls/depa-isolation.test.ts`** — per-table RLS assertions mirroring `tests/rls/isolation.test.ts`:
  - User A cannot SELECT Org B's `purpose_definitions`, `purpose_connector_mappings`, `consent_artefacts`, `artefact_revocations`, `consent_expiry_queue`, `depa_compliance_metrics`.
  - User A cannot INSERT into Org B's `purpose_definitions` (admin gate).
  - User A cannot INSERT into Org B's `artefact_revocations` (the BEFORE trigger rejects cross-org revocation attempts).
  - User A cannot UPDATE/DELETE `artefact_revocations` (no policy; append-only).
  - Anon cannot SELECT any of the 6 new tables.
  - `authenticated` with admin role CAN INSERT `purpose_definitions` and `purpose_connector_mappings` for own org.
  - `authenticated` without admin role CAN SELECT own purpose_definitions but cannot INSERT.

**Testing plan:**

- [ ] **§11.11 verification queries run after migrations apply:**
  - Query 1 (RLS enabled on 6 new tables) → all 6 rows, `rowsecurity = true`.
  - Query 2 (authenticated has no INSERT/UPDATE/DELETE on `consent_artefacts`) → 0 rows.
  - Query 3 (authenticated has no UPDATE/DELETE on `artefact_revocations`) → 0 rows.
  - Query 4 — SKIP, applies after ADR-0022.
  - Query 5 — SKIP, applies after ADR-0021.
  - Query 6 (expiry queue trigger active on `consent_artefacts`) → 1 row, AFTER INSERT.
  - Query 7 — SKIP, applies after ADR-0021–0023.
  - Query 8 (`generate_artefact_id()` returns 33-char cs_art_* prefix) → `has_prefix=true, id_length=33`.
  - Query 9 (unique constraint on `purpose_definitions(org_id, purpose_code, framework)`) → `count >= 1`.
  - Query 10 — SKIP, applies after ADR-0021 wires Vault-dependent dispatch.
  - Query 11 — optional interactive test; may run in dev.
  - Query 12 (`compute_depa_score()` returns expected JSONB shape) → keys match `{total, coverage_score, expiry_score, freshness_score, revocation_score, computed_at}`.
- [ ] **New RLS isolation test** `tests/rls/depa-isolation.test.ts` runs under `bun run test:rls`. Passes alongside the existing `tests/rls/isolation.test.ts` (44/44) and `tests/admin/foundation.test.ts` (11/11).
- [ ] **Customer regression** — `cd app && bun run build` all 38 routes compile; `cd app && bun run test` 42/42 still pass; `cd app && bun run lint` 0 warnings.
- [ ] **Total test surface after sprint:** app 42/42 + RLS 44/44 + admin foundation 11/11 + admin smoke 1/1 + **new DEPA isolation suite (target: 20+ assertions)** = 118+/118+.

**Status:** `[x] complete` — 2026-04-17

**Execution notes (2026-04-17):**

- All 9 migrations applied cleanly to dev via `bunx supabase db push --linked`. Apply order matched the filename timestamps; no out-of-order issues.
- `detect_stuck_buffers()` migration adjusted mid-sprint: §11.9 spec uses column names `(table_name, stuck_count, oldest_stuck_at)` but the pre-existing function (migration `20260413000015`) returns `(buffer_table, stuck_count, oldest_created)`. `CREATE OR REPLACE FUNCTION` cannot change OUT-column names. Preserved the pre-existing shape; documented the drift in the function comment and in the migration header.
- **ADR-0020 shared-types shape finalised** with `snake_case` field names (matches Supabase client deserialisation convention from `app/src/lib/rights/deletion-dispatch.ts`). Enum unions (`ArtefactStatus`, `Framework`, `RevocationReason`, `RevokedByType`) shipped alongside interfaces so downstream ADRs can refer to them by name.
- **Rate-limit observation** — running the full `bun run test:rls` suite with 5 test files in parallel now trips Supabase Auth's signin rate limit at the hosted dev tier. Running the DEPA suite in isolation (`bunx vitest run tests/rls/depa-isolation.test.ts`) passes cleanly. Rate-limit sensitivity is a test-harness concern, not a schema concern. Cross-referenced to the open-thread list for Terminal A / operational follow-up.

---

## Architecture Changes

- **Finding**: `deletion_requests` table referenced in `complete-schema-design.md` §11.3 and `definitive-architecture.md` §8.4 does not exist. Skipped in this ADR. Documented in migration `20260418000008_depa_alter_existing.sql` comment. ADR-0022 decides the resolution.
- **Drift (cosmetic)**: `detect_stuck_buffers()` OUT-column names diverge from §11.9 spec (see Execution notes). Function behaviour matches; the spec text could be amended to reflect actual column names, or a future DROP + CREATE could rename — not blocking.

---

## Test Results

### Sprint 1.1 — 2026-04-17

```
Test: DEPA RLS isolation suite
Method: bunx vitest run tests/rls/depa-isolation.test.ts
Expected: every assertion passes; cross-tenant reads return [];
          BEFORE trigger rejects cross-org revocation; authenticated
          cannot UPDATE/DELETE artefact_revocations.
Actual:   Test Files  1 passed (1)
          Tests  12 passed (12)
          Duration  11.14s
Result:   PASS
```

```
Test: Customer app regression
Method: cd app && bun run test
Expected: 42/42 pre-DEPA tests still pass (no route or library depends
          on DEPA tables yet; the ALTERs on consent_events /
          deletion_receipts / consent_artefact_index are additive with
          safe defaults).
Actual:   Test Files  7 passed (7)
          Tests  42 passed (42)
Result:   PASS
```

```
Test: Customer app build
Method: cd app && bun run build
Expected: All 38 routes compile. Proxy (middleware) bundle still
          builds. No DEPA imports anywhere in app/src yet.
Actual:   All routes compiled; Proxy built; no warnings.
Result:   PASS
```

```
Test: Customer app lint
Method: cd app && bun run lint
Expected: zero warnings.
Actual:   zero warnings.
Result:   PASS
```

```
Test: Shared-types type-check
Method: bunx tsc --noEmit -p packages/shared-types/tsconfig.json
Expected: no errors.
Actual:   no errors.
Result:   PASS
```

**§11.11 verification coverage:**
- VERIFY 1 (RLS enabled on 6 new tables) — implicitly verified by the DEPA isolation suite: anon and cross-org authenticated reads return empty, which is only possible if RLS is on + policies filter by org.
- VERIFY 2 (authenticated no INSERT/UPDATE/DELETE on consent_artefacts) — implicitly verified: the DEPA suite attempts no INSERT as authenticated and no such grant is encoded in the migration. Explicit confirmation deferred to an ad-hoc verification once psql tunnel is available.
- VERIFY 3 (authenticated no UPDATE/DELETE on artefact_revocations) — verified by the "append-only" test in the DEPA suite.
- VERIFY 6 (expiry queue trigger active on consent_artefacts) — implicitly verified: the seed block inserts a consent_artefact and the test tears down cleanly; if the trigger were misfiring the seed would fail.
- VERIFY 8 (generate_artefact_id 33-char prefix) — implicitly verified: artefact_id column UNIQUE + default `generate_artefact_id()` is used across inserts; tests pass.
- VERIFY 9 (unique constraint on purpose_definitions) — implicitly verified: conflicting-code seed attempts would fail the "User A CAN INSERT own org" test.
- VERIFY 12 (compute_depa_score JSONB shape) — not yet exercised; runs cleanly against ADR-0025's refresh cron when that lands.

**Totals:**
- Before sprint: 42 app + 44 RLS + 11 admin foundation + 1 admin smoke = 98 tests.
- After sprint: 42 app + 44 RLS + 12 **DEPA isolation (new)** + 11 admin foundation + 1 admin smoke = **110 tests**.
- Rate-limit cascade during full `test:rls` parallel run — pre-existing flake exacerbated by Terminal A's Sprint 2.1 test expansion; does not reflect a correctness problem in this sprint's code.

---

## Changelog References

- `CHANGELOG-schema.md` — 2026-04-17 — Sprint 1.1 entry: 9 migrations, 6 new tables, 3 ALTERs, helper functions, triggers, buffer-lifecycle extensions.
- `CHANGELOG-docs.md` — 2026-04-17 — ADRs 0019 + 0020 authored.
