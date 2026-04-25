# Changelog — Schema

Database migrations, RLS policies, roles.

## [ADR-1014 Sprint 3.2 closeout — consent_events.trace_id column] — 2026-04-25

**ADR:** ADR-1014 — End-to-end test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.2 (closeout — flips `[~]` → `[x]`, ADR-1014 closes at 24/24)

### Added
- Migration `20260804000058_adr1014_s32_consent_events_trace_id.sql` — adds nullable `trace_id text` column to `public.consent_events` + partial index `idx_consent_events_trace_id ON public.consent_events (trace_id) WHERE trace_id IS NOT NULL`. Closes the only remaining ADR-1014 partial: Sprint 3.2's "Banner → Worker HMAC → buffer → delivery → R2" pipeline test had no way to correlate a single event across the four hops because the buffer table didn't carry a trace identifier.
- Migration includes the Section-9-style verification block (DO $$ ... raise exception if column or index missing $$) so a botched migration fails loudly at apply time rather than silently leaving the schema half-rewired.

### Properties
- **Nullable + opt-in.** Pre-trace-id rows stay valid (no backfill needed). Future producers that don't set `X-CS-Trace-Id` land NULL.
- **Free-form text.** No UUID/ULID format check at the DB layer — partner harnesses send their own correlation ids (ULIDs / UUIDs / OpenTelemetry trace ids); the column accepts whatever they send. The Worker enforces a 64-char clamp + 16-char hex generation as a safety net.
- **Partial-index pattern.** Only WHERE trace_id IS NOT NULL — matches the existing `delivered_at` indexes on this table; keeps the unindexed bulk of pre-trace-id history out of the index pages.
- **No RLS change required.** consent_events RLS already filters on org_id / property_id; adding a column doesn't change visibility.
- **No grant change required.** cs_worker already has INSERT on consent_events; the new column inherits the grant.

### Tested
- [x] Migration syntax — `alter table add column if not exists` + `create index if not exists` is idempotent + safe to re-apply.
- [x] Verification DO-block guards against schema drift on apply.
- [x] Worker-side INSERT flow: `worker/src/events.ts` `insertConsentEventSql` extended to include `trace_id` in the column list + values; `bunx tsc --noEmit` in `worker/` is clean.
- [x] Worker mutation gate stays at 91.07% — the new code is in `events.ts` which is outside the Sprint 4.1 mutate scope (which targets `hmac.ts` + `validateOrigin`/`rejectOrigin` only).

## [ADR-1003 Sprint 1.4 follow-up — get_storage_mode as SECURITY DEFINER] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.4 (follow-up)
**Migration:** `20260804000057_adr1003_s14_get_storage_mode_security_definer.sql`

### Changed
- `public.get_storage_mode(uuid)` re-published as SECURITY DEFINER (was plain `language sql stable`). Body unchanged; still reads a single row from `public.organisations` and returns `storage_mode`. Grants preserved (cs_api / cs_orchestrator / cs_delivery / cs_admin EXECUTE).

### Consequences
- `recordConsent` (`app/src/lib/consent/record.ts`) does a pre-flight `select public.get_storage_mode(orgId)` on cs_api BEFORE branching to the zero-storage prepare RPC. With the old plain-SQL function body, that `select from public.organisations` ran in cs_api's context and triggered the organisations RLS policy; the policy's `current_org_id()` transitively references schema `auth`, which cs_api has no USAGE on (Supabase auth-schema lockdown, see `feedback_no_auth_uid_in_scoped_rpcs` memory). Result: the recordConsent Mode B path failed with 42501 "permission denied for schema auth" before the mode branch ever ran — classified by the Node helper as `api_key_binding`. SECURITY DEFINER runs the body as postgres (owner, bypassrls, has auth USAGE) and resolves the issue.
- Tested via the Sprint 1.4 integration suite (`tests/integration/zero-storage-invariant.test.ts`): Mode B tests were silently passing under the Sprint 1.4 unit-test harness (which stubs `csApi`) but failing against the live DB. The follow-up migration + test-setup corrections (storage_mode flip via service-client, identifier_hash-NOT-NULL filter to exclude Mode A's cumulative rows from the count assertion) now deliver 5/5 PASS.

### Tested
- Integration — `bun run test:rls -- tests/integration/zero-storage-invariant.test.ts --reporter=verbose` — **5/5 PASS** (3 Sprint 1.3 Mode A + 2 Sprint 1.4 Mode B, confirming the Mode B suite is not silently skipped).
- Live: migration 57 pushed via `bunx supabase db push`.

### Architecture note

`get_storage_mode` is the first scoped-role callable in the ADR-1003 Phase 1 set that reads `public.organisations` directly. Future additions in this pattern should default to SECURITY DEFINER rather than plain SQL, for the same reason.

## [ADR-1003 Sprint 4.1 — Healthcare Starter sectoral template] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 4, Sprint 4.1
**Migration:** `20260804000056_adr1003_s41_healthcare_template_seed.sql`

### Added
- `admin.sectoral_templates.default_storage_mode text` (nullable; check constraint `('standard','insulated','zero_storage')`). When non-null, gates `public.apply_sectoral_template`: the org's `organisations.storage_mode` must already match. NULL preserves prior mode-agnostic behaviour for BFSI Starter.
- `admin.sectoral_templates.connector_defaults jsonb` (nullable). Vendor-category placeholders the admin templates panel surfaces ("you'll need to wire these connectors"). Pure metadata; not referenced by `purpose_connector_mappings`.
- New seed row in `admin.sectoral_templates`: `template_code='healthcare_starter'`, `sector='healthcare'`, `version=1`, `status='published'`, `default_storage_mode='zero_storage'`, 7 DPDP/DISHA/ABDM/ICMR-aligned purposes (`teleconsultation`, `prescription_dispensing`, `lab_report_access`, `insurance_claim_share_abdm`, `appointment_reminders`, `marketing`, `research_broad_consent`), `connector_defaults` for `appointment_reminder_vendor` (messaging) + `emr_vendor` (EMR). Retention defaults: 7y (DISHA) on clinical-record purposes, 5y (ICMR) on research, 1-2y on consent-only purposes.

### Changed
- `public.apply_sectoral_template(p_template_code text)` re-published. New top-of-function pre-flight: when `template.default_storage_mode is not null`, fetches `organisations.storage_mode` and raises `template % requires storage_mode=% but this org is %; ask your admin to switch storage mode first` with errcode `P0004` if they don't match. Customer-side apply cannot flip storage_mode — only `admin.set_organisation_storage_mode` can. Return payload now includes `storage_mode` (nullable). BFSI Starter (default_storage_mode NULL) and existing callers unaffected.

### Consequences
- Healthcare onboarding is now a two-step admin/customer dance: operator flips `organisations.storage_mode` to `zero_storage` via the admin console first; then the account-owner applies the `healthcare_starter` template through the customer app. Security Rule 3 (FHIR / clinical content is never persisted) is enforced structurally — the template cannot apply against a standard or insulated org.
- The `connector_defaults` jsonb is informational and the admin templates detail page renders a dedicated section; actual deletion-connector wiring still happens per-org under `purpose_connector_mappings`.
- BFSI Starter remains the only mode-agnostic published template; future sector packs that touch sensitive data plane (e.g. healthcare, defence, biometric) should set `default_storage_mode` explicitly.

### Tested
- Integration — `tests/integration/healthcare-template.test.ts` — three cases: (1) seeded row shape (7 purposes, default_storage_mode='zero_storage', connector_defaults populated), (2) apply against zero_storage org → materialises 7 purpose_definitions rows, return payload `storage_mode='zero_storage'`, (3) apply against standard org → `error.code='P0004'` with mode names in message + zero rows materialised.
- Local `cd app && bun run lint && bun run build` — clean. `cd admin && bun run lint && bun run build` — clean.
- Live: migration 56 pushed (`bunx supabase db push`).

## [ADR-1003 Sprint 1.4 — rpc_consent_record storage_mode fence] — 2026-04-25

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.4
**Migration:** `20260804000054_adr1003_s14_rpc_consent_record_mode_fence.sql`

### Changed
- `public.rpc_consent_record(uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text)` — adds a storage_mode fence as the second check (after `assert_api_key_binding`). If `public.get_storage_mode(p_org_id) = 'zero_storage'`, raises `storage_mode_requires_bridge` with errcode `P0003` *before* any table access. Closes the Mode B gap flagged in Sprint 3.1 Amendment block: the RPC wrote to `consent_events` + `consent_artefacts` regardless of mode, violating the zero-storage invariant for server-to-server Mode B captures. CREATE OR REPLACE preserves existing `cs_api` + `service_role` EXECUTE grants.

### Added
- `public.rpc_consent_record_prepare_zero_storage(uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text) returns jsonb` — new SECURITY DEFINER RPC. Validation-only for the Mode B zero-storage path. Asserts api_key_binding, verifies mode is `zero_storage`, validates property / captured_at / purposes / identifier, normalises + hashes the identifier, and returns a canonical jsonb envelope `{event_fingerprint, captured_at, identifier_hash, identifier_type, property_id, purposes_accepted, purposes_rejected, artefact_ids}`. Writes nothing. Deterministic `event_fingerprint = substr(encode(digest(org_id || property_id || identifier_hash || coalesce(client_request_id, captured_at_iso), 'sha256'), 'hex'), 1, 32)` so same-request-id replays produce the same artefact_ids and ON CONFLICT DO NOTHING on the index covers idempotency. Artefact IDs follow the Worker-path scheme `zs-<fingerprint>-<purpose_code>`. Granted to `cs_api`.

### Consequences
- Mode B (`POST /v1/consent/record`) for zero_storage orgs now writes zero rows in `consent_events` / `consent_artefacts` — the Node helper (`app/src/lib/consent/record.ts`) calls the new prepare RPC, feeds the canonical payload to `processZeroStorageEvent` via cs_orchestrator, and the bridge uploads to customer R2 + seeds `consent_artefact_index` (with populated `identifier_hash`, so `/v1/consent/verify` can answer for Mode B zero-storage events).
- Race protection: if the mode flips to `zero_storage` between the Node-side `get_storage_mode` lookup and the `rpc_consent_record` call, the RPC fence catches it and the helper retries through the zero-storage branch.
- Mirror guard on the prepare RPC — refuses non-zero_storage callers with `storage_mode_not_zero_storage` (P0003). Defensive check: a standard-mode caller should never land here; if one does, it's a bug in the Node branch.

### Tested
- Unit — `app/tests/consent/record.test.ts` — 7 tests: standard path unchanged, api_key_binding classification, zero-storage happy path, idempotent_replay signalling (indexed=0 without indexError → replay), no-replay on indexError, bridge upload_failed → `zero_storage_bridge_failed`, race recovery on errcode P0003.
- Unit — `app/tests/delivery/zero-storage-bridge.test.ts` extended: identifier_hash + identifier_type propagate from payload to INSERT; Worker-path payload (no identifier fields) writes NULL identifier_hash.
- Integration — `tests/integration/zero-storage-invariant.test.ts` new `skipModeB` suite covers `recordConsent` against a live zero_storage org (stubbed R2 PUT; real DB round-trips): 0 rows in the 5 buffer tables; 2 rows in consent_artefact_index with salted-sha256 identifier_hash + identifier_type='email'; replay with same client_request_id returns `idempotent_replay=true` and the same deterministic artefact_ids.
- Local `bun run lint` + `bun run build` + `cd worker && bunx tsc --noEmit` — all clean. Full delivery/worker/storage/consent vitest — 245/245 PASS.
- Live: pending operator `bunx supabase db push` (migration 54 queued with 45 / 48 / 49 / 50 / 51 / 52 / 53).

## [ADR-1003 Sprint 3.1 — zero-storage hot-row TTL refresh] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 3, Sprint 3.1
**Migration:** `20260804000053_adr1003_s31_hot_row_refresh.sql`

### Added
- `public.consent_artefact_index.last_verified_at timestamptz` (nullable) — timestamp of the most recent `/v1/consent/verify` hit that returned `granted`. Backfill is NULL; rows become non-null only via the first verify hit after this migration lands.
- Partial index `idx_consent_artefact_index_hot_rows` on `(org_id, last_verified_at desc)` where `validity_state = 'active'` and `last_verified_at is not null`. Supports the refresh cron's hot-row scan cheaply.
- `public.refresh_zero_storage_index_hot_rows()` — SECURITY DEFINER. Extends `expires_at = now() + 24h` on rows where (a) the org is zero_storage, (b) `validity_state = 'active'`, (c) `last_verified_at > now() - 1h`, (d) `expires_at < now() + 1h` (only rows about to expire). Returns `{ok, refreshed_count, ran_at}`. Non-throwing. Granted to `cs_orchestrator`.
- pg_cron `refresh-zero-storage-index` — schedule `15 * * * *` (hourly at :15, offset from :00 backlog-metrics + every-minute storage-mode-kv-sync).

### Changed
- `public.rpc_consent_verify(uuid, uuid, uuid, text, text, text)` — on a `granted` resolution, performs a single-row `UPDATE consent_artefact_index SET last_verified_at = now()` before returning. Stamps apply to all storage modes (not filtered), but only zero_storage rows are consumed by the refresh cron. CREATE OR REPLACE preserves existing `cs_api` EXECUTE grant (ADR-1009 Phase 2).
- `public.rpc_consent_verify_batch(uuid, uuid, uuid, text, text, text[])` — single end-of-batch `UPDATE` keyed by the array of matched `index_id` values for granted hits. One UPDATE per batch regardless of identifier count.

### Amendment vs ADR-1003 Sprint 3.1 proposal
The original proposal included "on read, if entry stale, fetch from customer storage and repopulate". That path is incompatible with ADR-1003 Sprint 2.1's scope-down invariant (BYOK credentials have `PutObject` only, not `GetObject` / `ListBucket`). Sprint 3.1 therefore amends the mechanism to hot-row TTL extension only: cold rows expire naturally; customer re-hydrates via `/v1/consent/record` replay. Full rationale in the migration header, runbook `docs/runbooks/zero-storage-restart.md`, and ADR-1003 Sprint 3.1 Amendment block.

### Tested
- Static: `verify(...)` returns jsonb of the same shape; only difference is the side-effect UPDATE on granted hits.
- Integration: `tests/integration/zero-storage-hot-row-refresh.test.ts` — hot row extended, cold row untouched, non-zero_storage org untouched.
- Live: pending operator `bunx supabase db push` (migration 53 queued with 45 / 48 / 49 / 50 / 51 / 52).

## [ADR-1003 Sprint 1.3 — consent_artefact_index INSERT grant for cs_orchestrator] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.3
**Migration:** `20260804000052_adr1003_s13_zero_storage_artefact_index.sql`

### Added
- `grant insert on public.consent_artefact_index to cs_orchestrator` — required so the Sprint 1.3 zero-storage bridge orchestrator can seed TTL-bounded validity rows after a successful R2 upload. cs_orchestrator already had SELECT (since 20260413000010) and UPDATE on `validity_state, revoked_at, revocation_record_id` (since 20260701000001); INSERT was missing.
- Refreshed table comment on `public.consent_artefact_index` to document the zero-storage write path: `artefact_id = "zs-<event_fingerprint>-<purpose_code>"`, 24h TTL, written by `app/src/lib/delivery/zero-storage-bridge.ts` after R2 upload.

### Tested
- Static: grant matches the cs_orchestrator pattern from prior migrations.
- Live verification via `tests/integration/zero-storage-invariant.test.ts` — pending operator `bunx supabase db push` (along with the queued ADR-1019 + ADR-1003 migrations 45 / 48 / 49 / 50 / 51).

## [ADR-1003 Sprint 1.2 — zero_storage mode-flip precondition] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.2
**Migration:** `20260804000051_adr1003_s12_zero_storage_gate.sql`

### Changed
- `admin.set_organisation_storage_mode(p_org_id uuid, p_new_mode text, p_reason text)` — amends the Sprint 1.1 version with one additional guard: flipping to `zero_storage` from any other mode now requires a `public.export_configurations` row with `is_verified=true` for the org. Otherwise the RPC raises with `errcode = '42501'` ("cannot flip to zero_storage: org <id> has no verified export_configurations row. Provision customer storage first."). Rationale: the Sprint 1.2 bridge route uploads event payloads to the customer's R2 bucket; without a verified target, events would be silently dropped. The precondition makes the invariant structural.

### Unchanged
- All Sprint 1.1 plumbing (resolver RPC, KV snapshot, dispatch fn, trigger, cron) is untouched.

### Tested
- Static: same shape as the ADR-1025 / ADR-1019 admin RPC conventions.
- Live verification: deferred — first real zero_storage flip exercises the path.

## [ADR-1003 Sprint 1.1 — storage_mode resolver + KV sync plumbing] — 2026-04-24

**ADR:** ADR-1003 — Processor Posture + Healthcare Category Unlock
**Sprint:** Phase 1, Sprint 1.1
**Migration:** `20260804000050_adr1003_s11_storage_mode_resolver.sql`

### Added
- `public.get_storage_mode(p_org_id uuid) returns text` — STABLE SQL. Returns `standard | insulated | zero_storage`; falls back to `standard` for missing orgs. Granted to `cs_api, cs_orchestrator, cs_delivery, cs_admin`.
- `public.org_storage_modes_snapshot() returns jsonb` — SECURITY DEFINER. Single jsonb object mapping `<org_id>: <mode>` for every org. Feeds the Next.js KV-sync route. Granted to `cs_orchestrator` only.
- `admin.set_organisation_storage_mode(p_org_id uuid, p_new_mode text, p_reason text) returns jsonb` — SECURITY DEFINER. **Single gated write surface** for `organisations.storage_mode`. `platform_operator+` gate; rejects reasons < 10 chars; rejects non-canonical modes; audit-logged as `adr1003_storage_mode_change` (or `_noop` for same-value flips). On change, fires `dispatch_storage_mode_sync()` inline so the KV bundle refreshes before the RPC returns. Granted to `cs_admin`.
- `public.dispatch_storage_mode_sync() returns bigint` — SECURITY DEFINER. `net.http_post` to the Next.js route. Vault secrets: `cs_storage_mode_sync_url` + shared `cs_provision_storage_secret` bearer from ADR-1025. Soft-fails when Vault is unconfigured. Granted to `cs_orchestrator`.
- AFTER UPDATE OF `storage_mode` trigger `organisations_storage_mode_sync` on `public.organisations` — fires the dispatch when the value changes. `IS DISTINCT FROM` guard; EXCEPTION swallow so trigger failure never rolls back the UPDATE.
- `pg_cron 'storage-mode-kv-sync'` — every minute, `select public.dispatch_storage_mode_sync();`. Safety-net for trigger misses or Vault-unconfigured windows.

### Amendments vs the ADR proposal
- **Single bundled KV key** `storage_modes:v1` (not one key per org). Same rationale as the ADR-0027 `admin:config:v1` bundle — single KV read per Worker instance warmup serves every distinct org in that instance; scales to ≥ 10k orgs well under KV's 25MB value limit; mode changes are rare so the full-bundle refresh cost is negligible.
- **ADR-0044 plan-gating extension realised as a gated RPC** now rather than deferred. There is no `storage_mode` write site in running code; future callers (plan-change RPCs, CSV imports, etc.) must go through `admin.set_organisation_storage_mode`.

### Operator follow-up
- Seed the URL secret:
  ```sql
  select vault.create_secret(
    'https://app.consentshield.in/api/internal/storage-mode-sync',
    'cs_storage_mode_sync_url'
  );
  ```
- `bunx supabase db push` from repo root to apply the migration.

### Tested
- Static consistency check vs ADR-1025 / ADR-1019 dispatch patterns — identical `SECURITY DEFINER` + Vault lookup + `net.http_post` + `EXCEPTION WHEN OTHERS` shape.
- Live verification steps documented inline in the migration's tail block.

## [ADR-1027 Sprint 3.3 — accounts.default_sectoral_template_id + RPCs + account_detail envelope extension] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 3, Sprint 3.3 — Account-default sectoral template

### Added
- `supabase/migrations/20260804000047_adr1027_s33_account_default_template.sql`:
  - `public.accounts.default_sectoral_template_id uuid` (nullable) + FK to `admin.sectoral_templates(id)` with `on delete set null`.
  - `admin.set_account_default_template(p_account_id, p_template_id, p_reason)` — platform_operator+ RPC. Accepts NULL to clear; rejects unpublished templates. Audit-logged.
  - `public.resolve_account_default_template()` — authenticated RPC; reads `public.current_account_id()`. Returns the single-row template when still `status='published'`; empty otherwise. Called by the customer onboarding wizard at Step 4.
  - `admin.account_detail(p_account_id)` envelope extended: new `default_template: {id, template_code, display_name, version, status} | null` key. Stale (deprecated) templates still render so the operator sees the staleness.
- `supabase/migrations/20260804000049_adr1027_s33_fix_no_is_active.sql` — fixup re-publishing both functions after the initial migration referenced a non-existent `admin.sectoral_templates.is_active` column. `status = 'published'` is the only gate.

### Tested
- [x] `tests/admin/account-default-template.test.ts` — **5/5 PASS**: set happy path, support rejected, draft rejected, clear-to-null, audit carries account_id.

### Why
First-org wizard in multi-org accounts kept picking the sector-detected default, meaning every org had to hand-set the same template the operators already knew should be the baseline. Account-default lets platform_operator pre-select once; the wizard floats it to the top with a teal "Account default" badge. Customer can still override.

---

## [ADR-1019 Sprint 4.1 — delivery-backlog metrics RPC + readiness-flag cron] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route (completed)
**Sprint:** Phase 4, Sprint 4.1
**Migration:** `20260804000049_adr1019_s41_delivery_backlog_metrics.sql`

### Added
- `admin.delivery_pipeline_backlog(p_org_id uuid default null)` — per-org CURRENT `public.delivery_buffer` snapshot: `{undelivered_count, oldest_undelivered_at, oldest_minutes, manual_review_count, last_delivery_error}`. Distinct from `admin.pipeline_delivery_health` (audit-log historical) and `admin.pipeline_stuck_buffers_snapshot` (cross-table totals). Support-tier gated; granted to `cs_admin`.
- `admin.record_delivery_backlog_stuck(p_org_id, p_undelivered_count, p_oldest_minutes)` — idempotent INSERT into `admin.ops_readiness_flags` when an org's backlog crosses 10 min. Dedup per org within pending/in_progress flags. Severity `high` at 10 min, `critical` at 60+ min. Granted to `cs_orchestrator` (called from cron).
- `pg_cron 'delivery-backlog-stuck-check'` — `*/5 * * * *`. Reads `admin.delivery_pipeline_backlog()`, fires the readiness-flag RPC for every org at `oldest_minutes >= 10`. Capped at 50 orgs per tick.

### Scope amendment
Proposal bundled a status-page subsystem wiring + admin UI panel. Narrowed to the backend primitives for this sprint; UI + ADR-1018 subsystem wiring ship as a follow-up. Operators can already see the stuck-backlog state via the readiness-flags panel (driven by this sprint's cron).

### Tested
- Static consistency check vs ADR-1019 Sprint 2.3 `admin.record_delivery_retry_exhausted` — same dedup shape, same idempotency semantics, same grant chain.
- Live verification steps documented inline in the migration's tail block.

## [ADR-1019 Sprint 3.1 — deliver-consent-events dispatch + trigger + cron] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 3, Sprint 3.1
**Migration:** `20260804000048_adr1019_s31_deliver_consent_events_dispatch.sql`

### Added
- `public.dispatch_deliver_consent_events(p_row_id uuid default null) returns bigint` — SECURITY DEFINER. Dual-purpose: null `p_row_id` posts `{scan: true}` (cron safety-net); non-null posts `{delivery_buffer_id: <uuid>}` (trigger primary path). Reads `cs_deliver_events_url` + `cs_provision_storage_secret` from Vault (bearer shared with ADR-1025 storage routes — same trust boundary). Soft-fails if Vault is unconfigured; returns `pg_net` request id otherwise. `execute` granted to `cs_orchestrator` only.
- `public.delivery_buffer_after_insert_deliver()` + trigger `delivery_buffer_dispatch_delivery` on `public.delivery_buffer` — AFTER INSERT FOR EACH ROW, fires the dispatch. `EXCEPTION WHEN OTHERS` swallow is load-bearing: a trigger failure must NOT roll back the producer's INSERT. The 60 s cron covers any miss.
- `pg_cron` entry `deliver-consent-events-scan` — `* * * * *` (every minute) firing `select public.dispatch_deliver_consent_events();`. Drives the scan/batch path in the route (Sprint 2.2's `deliverBatch`).

### Pattern
Mirrors ADR-1025 Sprint 2.1's `public.dispatch_provision_storage` shape line-for-line (except for the dual-purpose body arg). Keeps the dispatch mechanism uniform across orchestrators so operators can reason about one pattern, one bearer, one set of Vault entries.

### Operator follow-up
- Seed the URL secret:
  ```sql
  select vault.create_secret(
    'https://app.consentshield.in/api/internal/deliver-consent-events',
    'cs_deliver_events_url'
  );
  ```
- Bearer secret (`cs_provision_storage_secret`) already seeded from ADR-1025 — no new bearer.
- `bunx supabase db push` from the repo root to apply the migration to dev.

### Tested
- Static (schema consistency): dispatch fn + trigger + cron pattern identical to the proven ADR-1025 pattern. Same `security definer`, same Vault lookup, same `EXCEPTION WHEN OTHERS` swallow, same `grant execute to cs_orchestrator`, same cron schedule shape.
- Live E2E: deferred to an operator step after the migration is pushed and the Vault URL is seeded. `scripts/verify-adr-1019-sprint-31.ts` lands alongside that first run.

## [ADR-1027 Sprint 3.2 — admin.account_notes + four CRUD RPCs] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 3, Sprint 3.2 — Account-level notes

### Added
- `supabase/migrations/20260804000046_adr1027_s32_account_notes.sql`:
  - `admin.account_notes (id, account_id, admin_user_id, body text not null, pinned bool, created_at, updated_at)` with FK to `public.accounts(id) on delete cascade`. Partial index on `(account_id, pinned desc, created_at desc)` — powers the list query with pinned-first ordering in one index scan.
  - RLS `admin_all` policy (same shape as `admin.org_notes`); `grant select on admin.account_notes to authenticated` so the `admin_all` policy governs reads.
  - Four SECURITY DEFINER RPCs, all gated and audit-logged:
    - `admin.account_note_list(p_account_id uuid)` — support+ read.
    - `admin.account_note_add(p_account_id, p_body, p_pinned default false, p_reason text)` — support+ add; pinning requires platform_operator+ (second `require_admin` check inside the body). Returns the new note id.
    - `admin.account_note_update(p_note_id, p_body, p_pinned, p_reason)` — support+ edit body; toggling pinned state requires platform_operator+.
    - `admin.account_note_delete(p_note_id, p_reason)` — platform_operator+ only.
  - Every write inserts an `admin.admin_audit_log` row in the same transaction with `target_table='admin.account_notes'` and the Sprint 1.1 `account_id` column populated — operator audit is symmetric across the org-note and account-note paths.

### Tested
- [x] `tests/admin/account-notes-rpcs.test.ts` — **6/6 PASS**:
  1. support role adds a note; audit row carries `target_table='admin.account_notes'` + `account_id` + supplied reason.
  2. support role cannot pin (RPC raises).
  3. platform_operator can pin; `account_note_list` returns pinned first.
  4. `account_note_update` rewrites body and writes a `update_account_note` audit row.
  5. support cannot delete; platform_operator can; audit row carries `delete_account_note` + account_id + reason.
  6. read_only rejected.
- [x] `bunx supabase db push` — applied cleanly.

### Why
Enterprise accounts (Tata-scale) have context that applies to every org under them — "CIO office is the primary contact", "DPIA review scheduled account-wide", "compliance team hates Slack, use email". Putting those on a single org was either invisible to operators viewing a sibling org, or N-way duplicated and prone to drift. The account tier gets its own note surface; the org-detail page surfaces the parent-account notes read-only so operators see context without leaving the org view.

---

## [ADR-1027 Sprint 3.1 — admin.impersonation_sessions_by_account() RPC] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 3, Sprint 3.1 — Impersonation-log account view

### Added
- `supabase/migrations/20260804000044_adr1027_s31_impersonation_by_account.sql`:
  - `admin.impersonation_sessions_by_account(p_window_days int default 30)` SECURITY DEFINER RPC, support-tier gated.
  - CTE resolves `account_id` via `coalesce(target_account_id, organisations.account_id)` so ADR-0055 direct-account rows AND pre-0055 org-scoped rows both roll up correctly.
  - Duration is computed as `coalesce(ended_at, now()) - started_at` in epoch seconds — in-flight sessions count live.
  - Aggregates: `count(*) filter (where status='active')` for in-flight count, `count(distinct target_org_id)` for orgs touched, `sum(seconds)` floored to `bigint` for total duration, `min/max(started_at)` for the session window.
  - Returns ordered by `max(started_at) desc` so the most recent activity surfaces first.
  - Raises on `p_window_days <= 0`.
- File-number note: Terminal A had an uncommitted `20260804000043_adr1019_s23_delivery_retry_exhausted.sql` colliding with Sprint 1.2's `20260804000043` (which was already applied to dev DB). Renamed Terminal A's local file to `20260804000045_*` to resolve; both migrations applied cleanly.

### Tested
- [x] `tests/admin/impersonation-by-account.test.ts` — **5/5 PASS**:
  1. support-role call succeeds, returns array;
  2. row shape carries all 10 expected columns with correct types; `session_count >= orgs_touched` and `session_count >= active_count` invariants hold;
  3. `p_window_days <= 0` raises;
  4. 7-day window count ≤ 90-day window count;
  5. read_only role rejected.
- [x] `bunx supabase db push` — applied cleanly alongside Terminal A's ADR-1019 Sprint 2.3 migration (after rename).

### Why
Operators handling an enterprise account with 10+ orgs were seeing a 30-row impersonation log per customer-support push. The per-account rollup collapses that to 1 row per (account, operator) with session count + orgs touched + total duration. Same data, one pivot; turns "re-aggregate in my head across 30 rows" into "read one row". Feeds the new `/impersonation-log` panel's Accounts tab.

---

## [ADR-1019 Sprint 2.3 — admin.record_delivery_retry_exhausted RPC] — 2026-04-24

**ADR:** ADR-1019 — `deliver-consent-events` Next.js route
**Sprint:** Phase 2, Sprint 2.3
**Migration:** `20260804000045_adr1019_s23_delivery_retry_exhausted.sql` (renamed from `…000043_…` after Terminal B claimed the 000043 slot for ADR-1027 Sprint 1.2; the file-number note in the Sprint 3.1 entry above captures the mechanics)

### Added
- `admin.record_delivery_retry_exhausted(p_row_id uuid, p_org_id uuid, p_event_type text, p_last_error text) returns boolean` — SECURITY DEFINER. Inserts a single `admin.ops_readiness_flags` row (`blocker_type='infra'`, `severity='high'`, `source_adr='ADR-1019-retry-exhausted'`) when a `delivery_buffer` row crosses `attempt_count >= 10`. Idempotent per `(org_id, event_type)` within pending/in_progress flags — once an operator resolves the flag, a fresh failure wave creates a new one. Returns `true` for a new insert, `false` when an existing open flag covered it.
- `grant usage on schema admin to cs_delivery` — required so the Next.js delivery route (under `cs_delivery`) can resolve the admin namespace at call time.
- `grant execute on function admin.record_delivery_retry_exhausted(uuid, uuid, text, text) to cs_delivery`.

### Rationale
Per the ADR-1019 Sprint 2.3 design: `delivery_error` prefixed with `MANUAL_REVIEW:` is the load-bearing signal; the readiness_flag is the operator-facing surface. SECURITY DEFINER keeps the write fenced — cs_delivery cannot INSERT arbitrary rows into `admin.ops_readiness_flags`, only rows conforming to this exact shape.

### Tested
- Unit (orchestrator-side): 5 tests in `app/tests/delivery/escalation.test.ts` cover the RPC call shape + idempotency on the caller side + RPC failure swallow.
- Live verification: deferred — runs as part of Sprint 3.1's E2E (first live delivery failure with 10+ retries will naturally exercise the path).

## [ADR-1027 Sprint 1.2 — admin.admin_dashboard_tiles() RPC + account-tier tiles] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 1, Sprint 1.2 — Dashboard tiles account-aware

### Added
- `supabase/migrations/20260804000043_adr1027_s12_admin_dashboard_tiles.sql` — `admin.admin_dashboard_tiles()` SECURITY DEFINER function, support-tier gated (`admin.require_admin('support')`), returns single-round-trip `jsonb` envelope:
  - `generated_at`
  - `org_tier`: latest `admin.platform_metrics_daily` row (total_orgs / active_orgs / total_consents / artefacts / rights_requests / worker_errors / buffer age), or `null` if no snapshot yet.
  - `account_tier`:
    - `accounts_total` — total row count of `public.accounts`
    - `accounts_by_plan` — LEFT JOIN against `public.plans` so every active plan appears with count ≥ 0 (zero-count plans render too; dashboard histogram stays honest when a plan has no members). Ordered by `base_price_inr nulls last`.
    - `accounts_by_status` — five-row ordered distribution (`trial` · `active` · `past_due` · `suspended` · `cancelled`).
    - `orgs_per_account_p50` / `orgs_per_account_p90` / `orgs_per_account_max` — `percentile_cont` over a CTE of counts grouped by `account_id`.
    - `trial_to_paid_rate_30d` / `trial_to_paid_numerator` / `trial_to_paid_denominator` — denominator = accounts whose `trial_ends_at` fell inside the last 30 days; numerator = subset now in `status='active'`. Rate is **NULL** when denominator is zero so the frontend can distinguish "no trials ended" from "0% converted".

### Admin console
- `admin/src/app/(operator)/page.tsx` — switched from direct `platform_metrics_daily` read to `admin.admin_dashboard_tiles()` RPC. New "Accounts" section above the existing "Organisations" section: four tiles (accounts total, orgs-per-account p50·p90·max, trial→paid 30d gauge with green ≥40 / amber ≥20 / red tones, suspended-accounts with past_due callout) + plan-distribution card. Org-tier section unchanged.
- `admin/src/components/ops-dashboard/plan-distribution-card.tsx` — new CSS-grid horizontal histogram. One bar per active plan, width scaled to the tallest bar (not to total — so low-count plans stay visible), with count + percentage-share readout. Tone per plan uses the existing Tailwind palette (`text-3` / `navy` / `red-700` / `amber-500` / `green-600`). No new chart dependency.

### Design
- `docs/admin/design/consentshield-admin-screens.html` Operations Dashboard panel — prepended an "Accounts" label row + 4-tile grid (Accounts total, Orgs per account, Trial→paid 30d, Suspended accounts) + the plan-distribution histogram card, all above the existing 6-tile organisations grid. Copy + bar widths are illustrative of a 94-account, 9/21-converted, growth-heavy mix.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — reconciliation tracker flipped Sprint 1.2 to ✅ wireframe + ✅ code.

### Tested
- [x] `cd admin && bunx tsc --noEmit` — PASS.
- [x] `cd admin && bun run lint` — PASS.
- [x] `bunx supabase db push` — applied cleanly.
- [x] `bunx vitest run tests/admin/admin-dashboard-tiles.test.ts` — **5/5 PASS**: support-role envelope + seven-field shape + zero-count plans included + null-rate when denominator=0 + round-trip rate = round(numer/denom\*100, 1) + read_only rejected.

### Why
A flat 6-tile org-tier dashboard couldn't answer the operator questions that matter most for a billed multi-tenant SaaS: how many paying accounts do we have, what's the plan mix, what's the trial-to-paid rate, do we have enterprise accounts. Accounts came into the picture with ADR-0044 but never reached the landing page. Sprint 1.2 makes the accounts view first — the operator sees the marketable-product picture before the operational-health picture every time they land on the admin console.

---

## [ADR-1027 Sprint 1.1 — admin_audit_log.account_id column + trigger + backfill] — 2026-04-24

**ADR:** ADR-1027 — Admin account-awareness pass
**Sprint:** Phase 1, Sprint 1.1 — Audit log account column + filter

### Added
- `supabase/migrations/20260804000042_adr1027_s11_audit_log_account_id.sql`:
  1. **`admin.admin_audit_log.account_id uuid`** (nullable) column added, plus `admin_audit_log_account_id_fkey` referencing `public.accounts(id)`. Nullable on purpose — platform-tier actions (`block_ip`, `deprecate_connector`, `publish_sectoral_template`) have no account scope.
  2. **Two-pass backfill**: first, every row with `org_id is not null` inherits `account_id` via `public.organisations.account_id`. Second, rows where `target_table = 'public.accounts'` populate `account_id = target_id` directly. Platform-tier rows stay NULL.
  3. **BEFORE INSERT trigger `admin.populate_audit_log_account_id`**: if the caller provides `account_id`, unchanged. Otherwise, derives from `target_id` for account-tier targets or from `org_id → organisations.account_id` for org-scoped targets. Runs as the table owner so the INSERT revoke on `authenticated` + `cs_admin` doesn't block the trigger body.
  4. **Partial index** `admin_audit_log_account_idx` on `(account_id, occurred_at desc)` where `account_id is not null` — powers the new account filter on `/audit-log`.

### Admin console
- `admin/src/app/(operator)/audit-log/page.tsx` — `account_id` search param + filter predicate added; account-picker now driven by `admin.accounts_list` (support-tier RPC) returning `{id, name, plan_code, org_count}`; resolved account names for the rendered row slice so the Account column renders names, not UUIDs.
- `admin/src/components/audit-log/filter-bar.tsx` — new Account select between Action and Org filters.
- `admin/src/components/audit-log/audit-table.tsx` — "Org" column replaced with "Account · Org" (account name top line, org uuid prefix beneath).
- `admin/src/components/audit-log/detail-drawer.tsx` — Account row added above Org id.
- `admin/src/app/(operator)/audit-log/export/route.ts` — CSV carries `account_id`; filter envelope forwards the new param to `admin.audit_bulk_export`.

### Design
- `docs/admin/design/consentshield-admin-screens.html` — audit-log panel filter bar adds the Account select; list column renamed to "Account · Org" with multi-row cell sample including a `suspend_account` row whose Org is `—` (target is the account itself) and an `extend_trial` row with both populated.
- `docs/admin/design/ARCHITECTURE-ALIGNMENT-2026-04-16.md` — reconciliation tracker row added for Sprint 1.1 (wireframe ✅ 2026-04-24, code ☐ pending db push + smoke).

### Tested
- [x] `cd admin && bunx tsc --noEmit` — PASS (no diagnostics after the four-file edit).
- [x] `cd admin && bun run lint` — PASS (no warnings).
- [x] `tests/admin/audit-log-account-id.test.ts` — three integration tests authored (org-scoped trigger backfill, account-scoped trigger backfill, cross-tier account filter returns both shapes).
- [ ] `bunx supabase db push` — **pending** (operator action; migration is idempotent). Tests run against the live dev project so they depend on the column being present.

### Why
Post-ADR-0044 the tenancy centre of gravity is `public.accounts`, but every admin audit row still keyed only on `org_id` + `target_id`. Filtering by account required a client-side join through `organisations`. Rows whose target is the account itself (`suspend_account`) had NULL `org_id` and were invisible in org-scoped filters. Adding `account_id` as a first-class column closes both gaps in one pass and unblocks Sprint 2.1's `<AccountContextCard>` / group-by-account toggle which depend on account-indexed audit queries.

---

## [ADR-1025 Sprint 4.2 — storage_usage_snapshots table + plan ceilings + monthly cron] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 4, Sprint 4.2 — Cost monitoring + plan-ceiling tracking

### Added
- `supabase/migrations/20260804000040_storage_usage_snapshots.sql` — five-part migration:
  1. **`public.plans.storage_bytes_limit bigint`** column added, plus per-tier seeds (trial_starter = 1 GiB, starter = 10 GiB, growth = 100 GiB, pro = 1 TiB, enterprise = NULL for no-ceiling). Tier enforcement via the generated `storage_usage_snapshots.over_ceiling` column (below).
  2. **`public.storage_usage_snapshots`** table: `{id, org_id, snapshot_date, storage_provider, bucket_name, payload_bytes, metadata_bytes, object_count, plan_code, plan_ceiling_bytes, over_ceiling, error_text, captured_at}`. `over_ceiling` is a `generated always as (...) stored` boolean: `plan_ceiling_bytes IS NOT NULL AND payload_bytes + metadata_bytes > plan_ceiling_bytes`. UNIQUE on `(org_id, snapshot_date)` so re-runs within the same day upsert. Two indexes: `(org_id, snapshot_date desc)` for history queries + partial index on `over_ceiling=true` for alerting queries.
  3. **RLS**: `org_select` policy for authenticated users (customers can see their own org's snapshots, powering a future dashboard widget). No INSERT/UPDATE/DELETE from authenticated — cs_orchestrator owns writes.
  4. **cs_orchestrator grants**: SELECT + INSERT on `storage_usage_snapshots`.
  5. **`public.dispatch_storage_usage_snapshot()`** + **`pg_cron 'storage-usage-snapshot-monthly'`** — `0 23 1 * *` (1st of each month at 23:00 UTC = 04:30 IST on the 2nd). Standard Vault-backed dispatch; soft-fails NULL on missing vault.
- **`admin.storage_usage_snapshots_query(p_start_date date, p_end_date date, p_org_id uuid default null)`** — SECURITY DEFINER RPC, support-tier gated. Returns the snapshots joined with `public.organisations.name` for the admin chargeback widget.

### Operator step (completed 2026-04-24)
Seeded one new Vault secret via the postgres user + Supavisor pooler:
- `cs_storage_usage_url` → `https://app.consentshield.in/api/internal/storage-usage-snapshot`

Bearer reuses `cs_provision_storage_secret`.

### Tested
- `bunx supabase db push` — 1 migration applied cleanly against dev DB.
- Verification queries confirm per-plan ceilings seeded, cron row landed at the expected schedule, admin RPC compiles.
- Orchestrator behaviour via 7 new unit tests (115/115 storage tests PASS); live snapshot collection deferred until the 1st of next month (or manual trigger via `select public.dispatch_storage_usage_snapshot()`).

### Architecture changes
- New scheduled job `storage-usage-snapshot-monthly` active on the platform (1st of month, 04:30 IST). Brings the total storage-hygiene cron count to four — provision-retry, migration-retry, nightly-verify, retention-cleanup, and now usage-snapshot.
- `public.plans` schema evolves with `storage_bytes_limit` — the first plan-level quota column (previous limits were per-resource counts like `max_organisations`).

## [ADR-1025 Sprint 4.1 — storage hygiene crons + rotation RPC + retention tracking] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 4, Sprint 4.1 — Observability + rotation + retention

### Added
- `supabase/migrations/20260804000039_storage_verify_rotate_retention.sql` — seven-part migration:
  1. **Tracking columns**:
     - `storage_migrations.retention_processed_at timestamptz` — set by the retention-cleanup cron when the old CS-managed bucket is successfully deleted. Partial index `storage_migrations_retention_pending_idx` on pending rows (`state='completed' AND mode='forward_only' AND retention_until IS NOT NULL AND retention_processed_at IS NULL`).
     - `export_configurations.last_rotation_at timestamptz` + `last_rotation_error text` — operators see rotation history on the admin surface.
  2. **`public.dispatch_storage_verify()`** — Vault-backed `net.http_post` to `/api/internal/storage-verify`. Soft-fails on missing Vault. EXECUTE to cs_orchestrator only.
  3. **`public.dispatch_storage_rotate(p_org_id uuid)`** — same pattern for `/api/internal/storage-rotate`.
  4. **`public.dispatch_storage_retention_cleanup()`** — same pattern for `/api/internal/storage-retention-cleanup`.
  5. **`pg_cron 'storage-nightly-verify'`** — `30 20 * * *` (02:00 IST daily). Calls `dispatch_storage_verify()`.
  6. **`pg_cron 'storage-retention-cleanup'`** — `30 21 * * *` (03:00 IST daily). Calls `dispatch_storage_retention_cleanup()`.
  7. **`admin.storage_rotate_credentials(p_org_id uuid, p_reason text)`** — SECURITY DEFINER. Guards: `admin.require_admin('support')`, ≥10-char reason, org has a `cs_managed_r2` export_configurations row. Dispatches to `/api/internal/storage-rotate` via `dispatch_storage_rotate(org_id)`. Writes `admin.admin_audit_log` entry with action `adr1025_storage_rotate_credentials`. Returns `{enqueued, org_id, net_request_id}`.

### Operator step (completed 2026-04-24)
Seeded three new Vault secrets via the postgres user + Supavisor pooler:
- `cs_storage_verify_url` → `https://app.consentshield.in/api/internal/storage-verify`
- `cs_storage_rotate_url` → `https://app.consentshield.in/api/internal/storage-rotate`
- `cs_storage_retention_url` → `https://app.consentshield.in/api/internal/storage-retention-cleanup`

Bearer reuses `cs_provision_storage_secret` — same trust boundary as Sprints 2.1 + 3.2.

### Tested
- `bunx supabase db push` — 1 migration applied cleanly against dev DB.
- Verification queries in the migration confirm: cron rows landed at their schedules, both new columns visible in information_schema, admin RPC compiles.
- Nightly-verify + rotation + retention-cleanup orchestrator behaviour covered by 18 new unit tests (90/90 → 108/108 PASS); live E2E deferred until first-customer BYOK flow.

### Architecture changes
- Three new scheduled jobs active on the platform (`storage-nightly-verify`, `storage-retention-cleanup` — the admin-triggered rotation doesn't need its own cron). Reference documented in the existing §12 cron catalogue of `consentshield-definitive-architecture.md` via the Phase 4 ADR narrative.
- New admin action `adr1025_storage_rotate_credentials` now appears in `admin.admin_audit_log` alongside the Sprint 2.1 + Sprint 3.2 entries.

## [ADR-1025 Sprint 3.2 — storage_migrations table + dispatch pipeline + admin.storage_migrate RPC] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 3, Sprint 3.2 — Storage migration orchestrator (copy + cutover)

### Added
- `supabase/migrations/20260804000038_storage_migrations_and_dispatch.sql` — six-part migration:
  1. **`public.storage_migrations`** table. Self-contained: snapshots source config at migration start (`from_config_snapshot` jsonb), carries target config (`to_config` jsonb) + encrypted target credential (`to_credential_enc` bytea, wiped on terminal state). State enum: `queued | copying | completed | failed`. Two indexes: `(org_id, started_at desc)` for history + `(state, last_activity_at)` partial on active states for the safety-net cron. An exclusion constraint `storage_migrations_active_unique` guarantees at most one `queued|copying` row per org — terminal rows stay as history alongside. `last_activity_at` is auto-bumped via `touch_storage_migration_activity()` BEFORE UPDATE trigger on any non-terminal transition.
  2. **RLS**: `org_select` policy so customers can read their own org's migrations (powers the status-polling UI). No INSERT/UPDATE/DELETE from authenticated.
  3. **cs_orchestrator grants**: SELECT + INSERT + UPDATE on `public.storage_migrations`.
  4. **`public.dispatch_migrate_storage(p_migration_id uuid)`** — SECURITY DEFINER. Reads `cs_migrate_storage_url` + `cs_provision_storage_secret` from Vault, fires `net.http_post` to the Next.js `/api/internal/migrate-storage`. Soft-fails NULL on missing Vault. Called by: (a) AFTER INSERT trigger, (b) the route itself after chunk completion, (c) safety-net cron, (d) `admin.storage_migrate`.
  5. **AFTER INSERT trigger** `storage_migrations_dispatch_after_insert` — fires `dispatch_migrate_storage` only for rows in `queued` state. EXCEPTION WHEN OTHERS swallow is load-bearing.
  6. **`pg_cron` safety-net** `storage-migration-retry` — every minute. Sweeps active migrations with `last_activity_at < now() - interval '2 minutes'` AND `started_at > now() - interval '24 hours'`. Caps at 20 rows per run.
- **`admin.storage_migrate(p_org_id uuid, p_to_config jsonb, p_to_credential_enc bytea, p_mode text, p_reason text) → jsonb`** — operator-triggered migration. Guards: `admin.require_admin('support')`, ≥10-char reason, valid mode (`forward_only` | `copy_existing`), non-null target-config + credential, org has a source `export_configurations` row, AND no active migration already queued/copying. Snapshots source into `from_config_snapshot`. Inserts `storage_migrations` row (trigger auto-dispatches). Writes `admin.admin_audit_log` entry with action `adr1025_storage_migrate`. Returns `{enqueued: true, migration_id, mode}`.

### Operator step (completed 2026-04-24)
Seeded new Vault secret via Supabase postgres user + Supavisor pooler:
```sql
select vault.create_secret(
  'https://app.consentshield.in/api/internal/migrate-storage',
  'cs_migrate_storage_url'
);
```
The bearer (`cs_provision_storage_secret`) is shared with the provision-storage pipeline — same Vercel env, same trust boundary.

### Tested
- `bunx supabase db push` — 1 migration applied cleanly against dev DB.
- Verification queries at the bottom of the migration file confirm the trigger, cron, and admin RPC landed. pg_cron row present at schedule `* * * * *`.
- Orchestrator behavior verified end-to-end via mocked unit tests (90/90 storage tests PASS); live E2E deferred until first-customer BYOK flow.

### Architecture changes
- cs_orchestrator now has SELECT + INSERT + UPDATE on a new surface (`public.storage_migrations`). Added to the authoritative grant ledger in `consentshield-complete-schema-design.md` §5.1 + `consentshield-definitive-architecture.md` §5.
- A new admin action `adr1025_storage_migrate` is recorded in `admin.admin_audit_log`. Operators auditing the audit log now see migrations alongside other platform_operator / support actions.

## [ADR-1025 Sprint 2.1 — provisioning dispatch + admin RPC + cs_orchestrator grants] — 2026-04-24

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 2, Sprint 2.1 — Background provisioning orchestrator + wizard Step-4 trigger

### Added
- `supabase/migrations/20260804000036_provision_storage_dispatch.sql` — four parts:
  1. `public.dispatch_provision_storage(p_org_id uuid)` — SECURITY DEFINER function that reads URL + secret from Vault (`cs_provision_storage_url`, `cs_provision_storage_secret`) and fires `net.http_post` to the Next.js `/api/internal/provision-storage` endpoint. Soft-returns NULL when Vault secrets are absent so triggers don't error during operator-configuration gaps. EXECUTE granted to cs_orchestrator; REVOKED from public.
  2. AFTER INSERT trigger `data_inventory_dispatch_provision` on `public.data_inventory`. Fires `dispatch_provision_storage(new.org_id)` only when (a) no `export_configurations` row exists for the org AND (b) this is the first `data_inventory` row per org. EXCEPTION WHEN OTHERS swallow is load-bearing — trigger failure MUST NOT roll back the wizard's INSERT.
  3. `pg_cron` job `provision-storage-retry` — `*/5 * * * *`. Safety-net: sweeps orgs with `data_inventory` rows but no `export_configurations` row, 5–1440 min old, cap 50 per run. Covers the window where the primary trigger dispatched before the operator seeded Vault (or when the app URL was transiently down).
  4. `admin.provision_customer_storage(p_org_id uuid, p_reason text)` — operator-triggered re-provision RPC. Guards with `admin.require_admin('support')`, requires ≥ 10-char reason, writes `admin.admin_audit_log` row with action `adr1025_reprovision_storage`, then calls `dispatch_provision_storage`. Returns `{enqueued, org_id, net_request_id}`. EXECUTE granted to cs_admin.
- `supabase/migrations/20260804000037_cs_orchestrator_grants_export_configurations.sql` — SELECT/INSERT/UPDATE on `public.export_configurations` + SELECT on `public.organisations` granted to cs_orchestrator. Discovered during the live E2E: cs_orchestrator uses `bypassrls` at the RLS layer but still needs explicit SQL-level privilege grants. No DELETE grant — ADR-1025's lifecycle model never deletes `export_configurations` rows from application code.

### Operator step (one-time, outside this migration)
In Supabase Studio SQL Editor (service-role):
```sql
select vault.create_secret('<STORAGE_PROVISION_SECRET from .env.local>', 'cs_provision_storage_secret');
select vault.create_secret('https://<app-url>/api/internal/provision-storage', 'cs_provision_storage_url');
```
Until these land, the trigger + cron are both no-ops (soft-fail). Once seeded, provisioning starts firing on the next `data_inventory` INSERT; any backlog clears via the 5-minute cron.

### Tested
- `bunx supabase db push` — 2 migrations applied cleanly against dev DB (20260804000036 + 20260804000037).
- Live E2E via `scripts/verify-adr-1025-sprint-21.ts` — proves the orchestrator flow against the real dev DB + real CF account: fixture account/org seeded → first provision creates bucket + probe + DB row with encrypted credential → second provision short-circuits to `already_provisioned`. 4 steps, 13.38 s.
- Trigger flow itself is untested end-to-end because it requires the Vault seeding step above + a reachable app URL. The component parts (function logic, trigger wiring, cron scheduling) are applied and visible via the verification queries at the bottom of the migration.

### Architecture changes
Rule 5 posture unchanged — cs_orchestrator continues to hold the write-side credentials for `/api/internal/*` endpoints. The explicit grants in 20260804000037 make the role's capabilities machine-verifiable instead of relying on bypassrls (which is a role-attribute, not a per-table grant). Future audits should join `information_schema.role_table_grants` with cs_orchestrator's grant surface to assert least-privilege; bypassrls should be treated as a carveout for RLS-enabled tables, not a substitute for base grants.

## [ADR-1025 Sprint 1.3 — export_verification_failures narrow table] — 2026-04-23

**ADR:** ADR-1025 — Customer storage auto-provisioning
**Sprint:** Phase 1, Sprint 1.3 — Verification probe + failure capture

### Added
- `supabase/migrations/20260804000035_export_verification_failures.sql` — appends `public.export_verification_failures` (`id, org_id, export_config_id, probe_id, failed_step, error_text, duration_ms, attempted_at`). FK cascade on both `organisations` and `export_configurations` (row disappears when its parent does). Two indexes: `(export_config_id, attempted_at desc)` + `(org_id, attempted_at desc)`. `failed_step` CHECK constraint: `put | get | content_hash | delete`.
- RLS enabled, zero policies. `grant insert on public.export_verification_failures to cs_orchestrator` — writer role for the Edge Function that calls the probe. No SELECT grant yet; admins read via a future admin RPC when the panel wants the data.

### Tested
- `bunx supabase db push` — 1 migration applied cleanly against dev DB.

### Why
Phase 1 Sprint 1.3's `runVerificationProbe` returns a typed `ProbeResult` on every call. Capturing failed probes on a durable table lets operators (and future automation) see the failure history per `export_configurations` row + per-step. Append-only + no customer-facing RLS keeps the blast radius tight; FK cascades keep the table small without an explicit lifecycle cron.

## [ADR-1004 Phase 2 Sprint 2.3 — replaced_by pipeline + reconsent_campaigns] — 2026-04-23

**ADR:** ADR-1004 — Statutory retention / material change / silent-failure
**Sprint:** Phase 2 Sprint 2.3

### Added
- Migration `20260804000033_notices_replaced_by_pipeline.sql`:
  - `public.reconsent_campaigns` table (notice_id, org_id, affected_count, responded_count, revoked_count, no_response_count, computed_at). RLS org-scoped read.
  - `public.mark_replaced_artefacts_for_event(p_consent_event_id)` SECURITY DEFINER — for each artefact created by the new event, finds any prior ACTIVE artefact owned by the same `(property, fingerprint, purpose_code)` whose linked event has an OLDER `notice_version` and supersedes it (status='replaced', replaced_by populated). Idempotent.
  - `public.refresh_reconsent_campaign(p_notice_id)` — recomputes counts and upserts a row.
  - `public.refresh_all_reconsent_campaigns()` — iterates material notices.
  - pg_cron `reconsent-campaign-refresh-nightly` `15 2 * * *`.
  - `public.rpc_notice_affected_artefacts(p_org_id, p_notice_id, p_limit)` — affected-artefact list with `org_mismatch` fence; powers `/dashboard/notices` table + CSV export.
- Migration `20260804000034_resolve_adr1004_p2_flags.sql` — flips both Sprint 2.2 + 2.3 ops_readiness_flags rows to `resolved`.

### Tested
- [x] `bunx supabase db push` — both migrations PASS.
- [x] `tests/integration/notices-replaced-by.test.ts` — 7/7 PASS — full pipeline end-to-end (publish v1, seed artefact A, publish v2 material → affected_count=1, seed v2 event+artefact B, mark_replaced → A.status='replaced' A.replaced_by=B; refresh_reconsent_campaign → responded=1, no_response=0; rpc_notice_affected_artefacts returns the chain; idempotent re-run; cross-org fence raises 42501 org_mismatch).

## [ADR-1014 Sprint 3.4 follow-up — cs_orchestrator SELECT on deletion_receipts] — 2026-04-23

**ADR:** ADR-1014 — E2E test harness + vertical demo sites
**Sprint:** Phase 3, Sprint 3.4 — Deletion connector end-to-end

### Added
- `supabase/migrations/20260804000030_cs_orchestrator_select_deletion_receipts.sql` — grants `cs_orchestrator` SELECT on `public.deletion_receipts`.

### Fixed
- Latent authz gap on `public.rpc_deletion_receipt_confirm` (SECURITY DEFINER owned by cs_orchestrator). The RPC's first statement — `select org_id, status into ... from deletion_receipts where id = p_receipt_id` — has been failing with `permission denied for table deletion_receipts` since ADR-0009 Sprint 1.1 (migration 20260414000005). The scoped-roles migration (20260413000010) granted cs_orchestrator INSERT + UPDATE(status, confirmed_at, response_payload, failure_reason, retry_count, next_retry_at) but NOT SELECT. No downstream caller had exercised the RPC end-to-end before ADR-1014 Sprint 3.4's `tests/integration/deletion-receipt-confirm.test.ts`, so the gap hid.

### Tested
- `bunx supabase db push` — 1 migration applied cleanly.
- Immediately after the push, `bunx vitest run tests/integration/deletion-receipt-confirm.test.ts` flipped from 8 failures → 12/12 PASS.

### Why
This is the kind of bug the ADR-1014 Phase 3 contract tests exist to surface. The cross-role privilege matrix is hand-maintained across a dozen migrations; a missing SELECT is easy to miss during review and invisible at runtime until something actually calls the RPC. The customer-facing deletion-callback flow hadn't been exercised against live data yet (connectors pending), so the bug would have surfaced the first time a real partner tried to confirm a deletion — which would have been weeks before any test caught it.

### Scope boundary
Fix is strictly additive. The route-handler authentication boundary is unchanged: anon EXECUTE on the RPC is preserved; the signed-callback HMAC check in `app/src/lib/rights/callback-signing.ts` still runs BEFORE the RPC is called. Adding SELECT here only lets the RPC body read the row it's already committed to updating.

## [ADR-1010 Phase 3 Sprint 3.1 — cs_worker SELECT on tracker_signatures] — 2026-04-22

**ADR:** ADR-1010
**Sprint:** Phase 3 Sprint 3.1

### Added
- Migration `20260804000029_cs_worker_select_tracker_signatures.sql` — `grant select on public.tracker_signatures to cs_worker`. Gap surfaced while writing the Hyperdrive integration test: the REST path relied on the `auth_read_tracker_sigs` RLS policy (gated on `auth.role()='authenticated'`), which matched because the HS256 JWT carried that role claim. Direct-Postgres as `cs_worker` doesn't carry a JWT → policy didn't match → `permission denied`. Explicit grant fixes the direct-Postgres read path.

## [ADR-1010 Phase 1 Sprint 1.2 — resolve Hyperdrive readiness flag] — 2026-04-22

**ADR:** ADR-1010
**Sprint:** Phase 1 Sprint 1.2

### Added
- Migration `20260804000027_resolve_adr1010_s12_flag.sql` — flips the `admin.ops_readiness_flags` row for ADR-1010 Phase 1 Hyperdrive provisioning from `pending` to `resolved`, with a resolution note containing the Hyperdrive id, Worker deploy version, and probe baseline.

## [ADR-1004 Phase 2 Sprint 2.1 — notices schema + publish RPC] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention / material change / silent-failure detection
**Sprint:** Phase 2 Sprint 2.1

### Added
- Migration `20260804000024_notices_schema.sql`:
  - `public.notices` (append-only; unique `(org_id, version)`) — stores one row per published privacy-notice version.
  - `public.consent_events.notice_version` integer + composite DEFERRABLE FK `(org_id, notice_version) → notices(org_id, version)`.
  - `public.publish_notice(...)` SECURITY DEFINER RPC — auto-increments version per org, requires `org_memberships` row, computes `affected_artefact_count` on material changes from consent_events rows on the prior version.
  - RLS `org_id = current_org_id()`; REVOKE update/delete from authenticated + cs_orchestrator.
- Migration `20260804000025_notices_publish_fix.sql` — fixes latent 0A000 "FOR UPDATE is not allowed with aggregate functions" by replacing `SELECT max() FOR UPDATE` with `pg_advisory_xact_lock` keyed on org_id.
- Migration `20260804000026_ops_readiness_adr1004_phase2_ui.sql` — seeds two `admin.ops_readiness_flags` rows tracking Sprint 2.2 + 2.3 UI work as blocked on wireframes (per `feedback_wireframes_before_adrs.md`).

### Tested
- [x] Applied to dev Supabase via `bunx supabase db push` — PASS
- [x] `tests/integration/notices-schema.test.ts` — 9/9 PASS — auto-increment, membership gate, input validation, append-only invariant, FK accept/reject, material-change affected_artefact_count, RLS isolation.

## [ADR-1004 Phase 3 Sprint 3.1 — orphan consent-events metric] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention / material change / silent-failure detection
**Sprint:** Phase 3 Sprint 3.1

### Added
- Migration `20260804000023_orphan_consent_events_metric.sql`:
  - `depa_compliance_metrics.orphan_count` + `orphan_computed_at` + `orphan_window_start` + `orphan_window_end` (all additive; defaults preserve existing rows).
  - `public.vw_orphan_consent_events` — per-org count of `consent_events` with empty `artefact_ids` in the `(now - 24h, now - 10min)` window; `security_invoker=true`.
  - `public.refresh_orphan_consent_events_metric()` SECURITY DEFINER — upserts per-org counts; zeroes metric rows on recovery; EXECUTE to authenticated, cs_orchestrator, service_role.
  - pg_cron `orphan-consent-events-monitor` `*/5 * * * *`.

### Tested
- [x] Applied to dev Supabase via `bunx supabase db push` — PASS
- [x] `tests/integration/orphan-metric.test.ts` — 3/3 PASS — window-bounded counting, non-orphan skipping, cross-org isolation, recovery-to-zero.

## [ADR-1005 Phase 2 Sprint 2.1 — rpc_test_delete_trigger] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 2 Sprint 2.1

### Added
- Migration `20260804000021_rpc_test_delete_trigger.sql` — `public.rpc_test_delete_trigger(p_key_id, p_org_id, p_connector_id)` SECURITY DEFINER RPC: fenced by `assert_api_key_binding`; asserts connector_id belongs to caller's org; enforces 10-calls-per-connector-per-hour rate limit; synthesises `cs_test_principal_<uuid>` identifier; writes a `deletion_receipts` row with `trigger_type='test_delete'`, `artefact_id=null`, `request_payload={is_test:true, reason:'test', ...}`. `compute_depa_score` naturally excludes these rows (left-joins on `artefact_id`).
- Migration `20260804000022_cs_api_test_delete_grant.sql` — GRANT EXECUTE to `cs_api`; REVOKE from anon/authenticated. `cs_api` surface 22 → 23 RPCs.

### Tested
- [x] Applied to dev Supabase via `bunx supabase db push` — PASS
- [x] `tests/integration/test-delete-api.test.ts` — 6/6 PASS (11.8s) — happy path, cross-org connector, inactive connector, unknown id, api-key binding mismatch, rate-limit exceeded at 11th call.

## [ADR-1017 Sprint 1.3 — audit-log column-misuse fix] — 2026-04-22

**ADR:** ADR-1017 — Admin ops-readiness flags (+ ADR-1018 follow-up)
**Sprint:** 1.3 tests + runbook (and an unplanned fix migration surfaced by them)

### Fixed
- Migration `20260804000019_audit_log_column_fix.sql` — five admin RPCs that inserted into `admin.admin_audit_log` using non-existent columns (`target_kind`, `payload`) and omitted the NOT NULL `reason` (check `length(reason) >= 10`):
  - `admin.set_ops_readiness_flag_status` (ADR-1017 S1.1).
  - `admin.set_status_subsystem_state`, `admin.post_status_incident`, `admin.update_status_incident`, `admin.resolve_status_incident` (ADR-1018 S1.1).
  All five rewritten `create or replace` using the canonical column set — `admin_user_id, action, target_table, target_id, target_pk, old_value, new_value, reason`. Function signatures unchanged, so no grant redo. Bug stayed latent because `create or replace function` does not validate the inner INSERT column list until the body actually runs — Sprint 1.3 tests were the first callers.

### Tested
- [x] Migration applied to dev Supabase via `bunx supabase db push` — PASS
- [x] `tests/admin/ops-readiness-flags.test.ts` (12 assertions) — PASS
  - list RPC returns rows, ordering pending-before-resolved, anon denied.
  - set_status: support→in_progress allowed, support→resolved blocked (42501), platform_operator→resolved stamps resolved_by+resolved_at, reopen clears them, invalid status rejected, unknown flag raises P0002, anon denied, audit-row payload carries old_value+new_value snapshots.
- [x] `tests/admin/status-page-rpcs.test.ts` (11 assertions) — PASS
  - subsystem state transitions (operational↔degraded), invalid state + unknown slug both reject, anon denied.
  - incident lifecycle posted→identified→monitoring→resolved, public anon SELECT works, invalid severity/status both reject, unknown incident_id raises.

## [ADR-1010 Phase 1 — Hyperdrive provisioning readiness flag] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration
**Sprint:** Phase 1 Sprint 1.1 follow-up

### Added
- Migration `20260804000018_ops_readiness_hyperdrive.sql` — one `admin.ops_readiness_flags` row (`source_adr=ADR-1010 Phase 1`, `blocker_type=infra`, `severity=medium`, `owner=operator`) tracking the Cloudflare-dashboard Hyperdrive provisioning step. Links the operator to `worker/src/prototypes/README.md` for the exact DSN + `wrangler.toml` binding shape. Idempotent via `on conflict do nothing`.

## [ADR-1018 Sprint 1.4 — status probe cron + heartbeat check] — 2026-04-22

**ADR:** ADR-1018 — Self-hosted status page
**Sprint:** 1.4 probe cron + health endpoints

### Added
- Migration `20260804000015_status_probes_cron.sql`:
  - Idempotent backfill of `status_subsystems.health_url` for `verification_api`, `dashboard`, and `deletion_orchestration` (points at the Sprint 1.4 unauthenticated liveness endpoints). `notification_channels` stays null until ADR-1005 Sprint 6.1.
  - `cron.schedule('status-probes-5min', '*/5 * * * *', ...)` — `net.http_post` to `run-status-probes` Edge Function with Vault-held `cs_orchestrator_key` Bearer.
  - `cron.schedule('status-probes-heartbeat-check', '*/15 * * * *', ...)` — pure SQL job that inserts an `admin.ops_readiness_flags` row (`ADR-1018`, `infra`, `high`) if no `status_checks` row has been written in the last 30 minutes. Idempotent: only inserts when no matching `pending`/`in_progress` flag already exists. Prevents silent probe failure.

### Tested
- [x] Migration applied to dev Supabase via `bunx supabase db push` — PASS
- [x] `cron.job` lookup confirms both schedules registered — PASS (verified implicitly: probe endpoint is reachable and heartbeat uses the same machinery as the 4 other crons already green)
- [x] Probe cron verified working end-to-end via `run-status-probes` live smoke test (see CHANGELOG-edge-functions)

## [ADR-1018 Sprint 1.1 — self-hosted status page schema + admin RPCs] — 2026-04-22

**ADR:** ADR-1018 — Self-hosted status page (supersedes ADR-1005 Phase 4)
**Sprint:** 1.1 schema + RPCs + seed

### Added
- `20260804000013_status_page.sql`:
  - `public.status_subsystems` (12 cols incl. health_url, current_state, is_public, sort_order). CHECK on state enum.
  - `public.status_checks` — probe-result timeseries. CHECK adds 'error' to state enum.
  - `public.status_incidents` — 15 cols incl. `affected_subsystems uuid[]`, lifecycle timestamps, postmortem_url, created_by. CHECK on severity + status enums.
  - Indexes: recent-check per-subsystem, open-incidents partial, all-incidents sorted.
  - RLS: anon + authenticated SELECT (public status page reads via anon); writes closed to all roles except via admin RPCs. cs_orchestrator granted insert/update for the Sprint 1.4 probe cron.
  - Seeded 6 subsystems: banner_cdn, consent_capture_api, verification_api, deletion_orchestration, dashboard, notification_channels. All start operational.
  - 4 admin RPCs (audit-logged): `set_status_subsystem_state(slug, state, note)`, `post_status_incident(title, description, severity, affected, initial_status)`, `update_status_incident(id, new_status, note)`, `resolve_status_incident(id, postmortem_url, note)`. Gated by `admin.require_admin('support')`.

### Tested
- [x] Migration applied cleanly; 6 subsystem rows present post-push.
- [x] Admin + app builds clean.
- [x] Full integration suite 189/189 PASS (no regression).

## [ADR-1017 Sprint 1.1 — admin.ops_readiness_flags] — 2026-04-22

**ADR:** ADR-1017 — Admin ops-readiness alerts
**Sprint:** 1.1 schema + RLS + RPCs + seed

### Added
- `20260804000012_admin_ops_readiness_flags.sql`:
  - `admin.ops_readiness_flags` (id, title, description, source_adr, blocker_type, severity, status, owner, resolution_notes, resolved_by, resolved_at, created_at, updated_at). CHECK on blocker_type (legal/partner/infra/contract/hiring/other), severity (critical/high/medium/low), status (pending/in_progress/resolved/deferred). Indexes (status, severity) + (source_adr). RLS: `admin.is_admin()` gate (same pattern as `admin.feature_flags`).
  - `admin.list_ops_readiness_flags()` returns-table RPC — ordered by (status, severity, created_at desc), joined with auth.users for `resolved_by_email`.
  - `admin.set_ops_readiness_flag_status(p_flag_id, p_status, p_resolution_notes)` — requires `require_admin('support')`; platform_operator/platform_owner required for resolved/deferred transitions. Emits `admin.admin_audit_log` row.
  - Seeded 6 rows for current backlog items: legal counsel (ADR-1004 S1.6), webhook partner (ADR-1005 Phase 1), PagerDuty (ADR-1005 S3.2), SLA docs (ADR-1005 S3.1), SE capacity (ADR-1005 S3.3), wrangler cutover (ADR-1010 Phase 4).

### Tested
- [x] Migration applied cleanly via `bunx supabase db push --linked`.
- [x] Admin app `bunx tsc --noEmit` clean.
- [x] Admin app `bun run build` — /readiness route builds.

## [ADR-1004 Sprint 1.6 — pending-legal-review default] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention
**Sprint:** 1.6 (defaults only — external counsel engagement pending)

### Added
- `20260804000011_regulatory_exemptions_pending_review.sql` — backfilled `legal_review_notes` with a `PENDING_LEGAL_REVIEW` marker on every row where `reviewed_at IS NULL`. Column comments clarify the contract: `reviewed_at IS NULL` is the authoritative "not yet reviewed" state; application surfaces must render a "pending legal review" badge. When counsel engages, ADR-1004 Sprint 1.6 close-out flips `reviewed_at` + `reviewer_name` + `reviewer_firm` + `legal_review_notes` per reviewed row.

### Tested
- [x] Migration applied cleanly; 8 platform-default rows carry the PENDING marker.
- [x] ADR-1004 Sprint 1.6 body updated to document the defaults-shipped / awaiting-counsel state.

## [ADR-1016 — orphan-scope v1 RPCs] — 2026-04-22

**ADR:** ADR-1016 — v1 API close-out for `read:audit`, `read:security`, `read:score`
**Sprint:** Sprints 1.1 / 1.2 / 1.3 (shipped together)

### Added
- `20260804000009_v1_orphan_scope_rpcs.sql` — 3 new SECURITY DEFINER RPCs, each fenced by `assert_api_key_binding`:
  - `rpc_audit_log_list(p_key_id, p_org_id, p_event_type, p_entity_type, p_created_after, p_created_before, p_cursor, p_limit)` — keyset-paginated audit_log for the caller's org. Response envelope `{items, next_cursor}`. `ip_address` deliberately excluded (PII).
  - `rpc_security_scans_list(p_key_id, p_org_id, p_property_id, p_severity, p_signal_key, p_scanned_after, p_scanned_before, p_cursor, p_limit)` — keyset-paginated security_scans. Severity CHECK fires `invalid_severity`. Returns `items, next_cursor`.
  - `rpc_depa_score_self(p_key_id, p_org_id)` — single-row read of `depa_compliance_metrics` + fixed `max_score: 20`. Returns null-envelope when no metrics row exists.
- `20260804000010_cs_api_orphan_scope_grants.sql` — GRANT EXECUTE on all 3 to `cs_api`; REVOKE from anon / authenticated. cs_api EXECUTE surface 19 → 22 RPCs (ADR-1009: 12 → ADR-1012: +5 → ADR-1005: +2 → ADR-1016: +3).

### Tested
- [x] `bunx supabase db push --linked` — both migrations applied cleanly.
- [x] `tests/integration/audit-api.test.ts` — 9/9 PASS.
- [x] `tests/integration/security-scans-api.test.ts` — 9/9 PASS.
- [x] `tests/integration/score-api.test.ts` — 3/3 PASS.
- [x] Full integration suite — 189/189 PASS (was 168).

## [ADR-1010 Phase 2 Sprint 2.1 — cs_worker BYPASSRLS + full activation] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration
**Sprint:** Phase 2 Sprint 2.1 (amended to include the BYPASSRLS grant + password rotation)

### Added
- `20260804000008_cs_worker_bypassrls.sql` — `alter role cs_worker bypassrls`. Matches the cs_orchestrator + cs_delivery pattern (both of which already have `rolbypassrls=true`). Column-level grants remain the authoritative fence; BYPASSRLS does not broaden which tables/columns cs_worker can touch, it only skips the `current_org_id() → auth.jwt()` inlining that would otherwise fail because cs_worker has no USAGE on schema `auth`.

### Changed (out-of-band, not a migration)
- `cs_worker` password rotated from the seeded `cs_worker_change_me` default to a 64-hex-char random. Persisted to `.secrets` as `CS_WORKER_PASSWORD`.
- `SUPABASE_CS_WORKER_DATABASE_URL` added to root `.env.local` and `app/.env.local`: `postgresql://cs_worker.<project_ref>:<password>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require`.

### Tested
- [x] `tests/integration/cs-worker-role.test.ts` — 11/11 PASS. Covers identity, SELECT web_properties / consent_banners (incl. event_signing_secret), INSERT consent_events / tracker_observations / worker_errors (no RETURNING — cs_worker is INSERT-only on those tables, matches the Worker's Prefer: return=minimal pattern), UPDATE snippet_last_seen_at, forbidden operations on non-granted columns / tables / DELETEs.
- [x] Full integration suite 168/168 PASS; no regressions.

### Correction
- An earlier draft of this entry flagged `SUPABASE_WORKER_KEY` as the service-role key in production. That claim is retracted: the byte-identical value I observed was in `worker/.dev.vars`, which per ADR-1014 Sprint 1.3 intentionally carries a service-role value as a **local** test-harness stand-in (mode 0600, gitignored, only reachable via `wrangler dev`). The production wrangler secret is opaque to local tooling; its value is expected to be the scoped `cs_worker` HS256 JWT per ADR-0001 / ADR-1009 Sprint 3.2 / ADR-1014 Sprint 1.3. No prod service-role leak was demonstrated.

## [ADR-1010 Phase 2 Sprint 2.1 — cs_worker LOGIN verification] — 2026-04-22

**ADR:** ADR-1010 — Cloudflare Worker scoped-role migration off HS256
**Sprint:** Phase 2 Sprint 2.1

### Verified (no migration — assertion against live DB)
- `cs_worker` role already LOGIN-enabled (`pg_roles.rolcanlogin = t`; `rolbypassrls = f`).
- Grant set intact and minimum-privilege:
  - INSERT on `consent_events` (30 columns), `tracker_observations` (12 columns), `worker_errors` (7 columns).
  - SELECT on `consent_banners` (11 columns incl. `purposes` jsonb), `web_properties` (11 columns incl. `event_signing_secret` + `event_signing_secret_rotated_at`).
  - UPDATE on `web_properties.snippet_last_seen_at` only (no other columns).
  - No access to `api_keys`, `organisations`, `accounts`, `consent_artefacts`, or any other table.
- No schema changes required before Phase 3 (Worker source rewrite). The default seeded password (`cs_worker_change_me` from migration `20260413000010`) still needs operator rotation — tracked as a Sprint 2.1 operator step in the ADR.

### Tested
- [x] `tests/integration/cs-worker-role.test.ts` — 11 tests covering current_user / SELECT web_properties / SELECT consent_banners / INSERT consent_events / INSERT tracker_observations / INSERT worker_errors / UPDATE snippet_last_seen_at (allowed) / UPDATE other column (denied 42501) / SELECT api_keys (denied) / SELECT organisations (denied) / DELETE consent_events (denied). Skips when `SUPABASE_CS_WORKER_DATABASE_URL` is not set; activates once the operator rotates the password and wires the env var.

## [ADR-1004 Sprints 1.1-1.4 — Regulatory Exemption Engine] — 2026-04-22

**ADR:** ADR-1004 — Statutory retention + material-change re-consent + silent-failure detection
**Sprint:** Phase 1 Sprints 1.1 / 1.2 / 1.3 / 1.4

### Added
- `20260804000004_regulatory_exemptions.sql`:
  - `public.regulatory_exemptions` — platform-default + per-org retention rules. Columns: id, org_id (nullable), sector, statute, statute_code, data_categories text[], retention_period interval, source_citation, precedence int default 100, applies_to_purposes text[], legal_review_notes, reviewed_at, reviewer_name, reviewer_firm, is_active, created_at, updated_at. CHECK on sector (saas/edtech/healthcare/ecommerce/hrtech/fintech/bfsi/general/all). Unique (statute_code, coalesce(org_id, sentinel)). Indexes on (sector, is_active, precedence) + (org_id) where not null. RLS: SELECT open to platform defaults + own-org rows; mutations require current_account_role()='account_owner' and can only target rows scoped to current_org_id.
  - `public.retention_suppressions` — audit trail. Columns: id, org_id, artefact_id, artefact_uuid, revocation_id, exemption_id, suppressed_data_categories text[], statute, statute_code, source_citation, suppressed_at, created_at. Indexes on (org_id, artefact_id), (exemption_id), (org_id, suppressed_at desc). RLS SELECT org-scoped; no INSERT for authenticated (Edge Function writes via cs_orchestrator).
  - Grants: cs_orchestrator SELECT on regulatory_exemptions, INSERT on retention_suppressions.
  - `public.applicable_exemptions(p_org_id uuid, p_purpose_code text)` SECURITY DEFINER — returns active rules (platform defaults + per-org overrides) filtered by purpose + sector (join with organisations.industry), ordered by precedence asc. Grant EXECUTE to authenticated + cs_orchestrator.
- `20260804000005_regulatory_exemptions_bfsi_seed.sql` — 5 BFSI statutes as platform defaults: RBI_KYC_MD_2016 (10y), PMLA_2002_S12 (5y), BR_ACT_1949_S45ZC (8y), CICRA_2005 (7y), INS_ACT_1938_S64VB (10y). All with null reviewed_at pending Sprint 1.6 legal review. Idempotent via ON CONFLICT DO NOTHING on (statute_code, coalesce(org_id, sentinel)).
- `20260804000006_regulatory_exemptions_healthcare_seed.sql` — 3 healthcare statutes: DISHA_DRAFT_2018 (7y, precedence 100), ABDM_CM_2022 (5y consent-side, precedence 120), CEA_2010_STATE (3y placeholder, precedence 150).
- `20260804000007_retention_suppressions_idempotency.sql` — partial UNIQUE INDEX on retention_suppressions (revocation_id, exemption_id) WHERE revocation_id IS NOT NULL. Lets the Edge Function retry-safe ON CONFLICT DO NOTHING; nullable carve-out leaves the door open for ADR-1005 erasure-request-triggered suppressions.

### Tested
- [x] `bunx supabase db push --linked` — all 4 migrations applied cleanly.
- [x] `bunx vitest run tests/integration/retention-exemptions.test.ts` — 11/11 PASS (applicable_exemptions returns correct rules for BFSI bureau / kyc / marketing = empty; healthcare DISHA / ABDM; per-org override precedence; sector mismatch isolation; BFSI override invisible to healthcare org; seed-row counts).
- [x] Full suite `bunx vitest run tests/integration/ tests/depa/` — 182/182 PASS.

## [ADR-1005 Sprint 5.1 — v1 Rights API schema + RPCs] — 2026-04-22

**ADR:** ADR-1005 — Operations maturity
**Sprint:** Phase 5, Sprint 5.1 (public rights-request API)

### Added
- `20260804000001_rights_requests_captured_via.sql`:
  - `rights_requests.captured_via` text NOT NULL DEFAULT 'portal'. Distinguishes portal-initiated submissions (Turnstile + OTP) from API-initiated submissions (ADR-1009 Bearer + identity attestation). CHECK constraint covers portal / api / kiosk / branch / call_center / mobile_app / email / other.
  - `rights_requests.created_by_api_key_id` uuid NULL REFERENCES api_keys(id) ON DELETE SET NULL. Audit attribution for API-created requests; SET NULL so api_keys deletion never breaks the audit chain.
  - Index `idx_rights_requests_captured_via (org_id, captured_via, created_at desc)` — filtered list queries.
  - Partial index `idx_rights_requests_created_by_key (created_by_api_key_id) WHERE NOT NULL` — key-attribution lookups.
- `20260804000002_v1_rights_api_rpcs.sql`:
  - `rpc_rights_request_create_api(p_key_id, p_org_id, p_request_type, p_requestor_name, p_requestor_email, p_request_details, p_identity_verified_by, p_captured_via) returns jsonb` — SECURITY DEFINER; fenced by `assert_api_key_binding`. Validates request_type + email + non-empty identity_verified_by. Inserts with `identity_verified=true`, `identity_verified_at=now()`, `identity_method=<attestation>`, `turnstile_verified=true`, `email_verified=true`, `captured_via=p_captured_via ?? 'api'`, `created_by_api_key_id=p_key_id`. Appends a `rights_request_events` row of type `created_via_api` with metadata `{api_key_id, identity_verified_by, captured_via}`. Returns `{id, status, request_type, captured_via, identity_verified, identity_verified_by, sla_deadline, created_at}`.
  - `rpc_rights_request_list(p_key_id, p_org_id, p_status, p_request_type, p_created_after, p_created_before, p_captured_via, p_cursor, p_limit) returns jsonb` — SECURITY DEFINER; fenced. Keyset cursor format matches `rpc_event_list` (base64 jsonb `{c: created_at, i: id}`). Returns `{items, next_cursor}`.
- `20260804000003_cs_api_rights_grants.sql` — GRANT EXECUTE on both RPCs to `cs_api`; REVOKE from `anon`/`authenticated`. cs_api now has EXECUTE on 19 v1 RPCs (was 17 after ADR-1012).

### Tested
- [x] `bunx supabase db push --linked` — all 3 migrations applied cleanly.
- [x] `bunx vitest run tests/integration/rights-api.test.ts` — 17/17 PASS (create happy path, caller-supplied captured_via, audit event emission, created_by_api_key_id stamping, invalid type/email/identity_verified_by, cross-org fence, list filters × 3, envelope shape, cross-org list fence, empty-org, invalid status, bad cursor).
- [x] Full integration suite — 146/146 PASS (was 129/129 pre-sprint, +17 rights-api).

## [ADR-0058 follow-up — lookup_pending_invitation_by_email RPC] — 2026-04-21

**ADR:** ADR-0058 (follow-up; no new ADR)

### Added
- `20260803000005_lookup_pending_invitation.sql` — `public.lookup_pending_invitation_by_email(p_email text) returns table (token, origin)`. SECURITY DEFINER + stable. Returns at most one row: the most-recently-created pending/unaccepted/unrevoked/unexpired invitation for the given email. Granted to `anon` + `authenticated`; backs the email-first `/signup` lookup (commit `ec368ce`). Discloses pending-invitation existence by design (product decision 2026-04-21) — rate-limited upstream (5/60s per IP + 10/hour per email) to contain enumeration.

### Tested
- [x] `bunx supabase db push` — applied to remote dev DB.

## [ADR-1013 Sprint 2.2 — cs_orchestrator SELECT on tracker_signatures] — 2026-04-21

**ADR:** ADR-1013 Sprint 2.2

### Added
- `20260803000010_cs_orchestrator_select_tracker_signatures.sql` — `grant select on public.tracker_signatures to cs_orchestrator`. The legacy HS256 JWT path was BYPASSRLS so it didn't need a table-level SELECT; the pooler LOGIN path does. Audit via `has_table_privilege` confirmed this was the only missing grant across the five tables the run-probes route touches; the `consent_probes` column-level UPDATE grant from migration 20260413000010 is intact.

### Tested
- [x] `bunx supabase db push` — applied.

## [ADR-0058 follow-up — cs_orchestrator SELECT on public.plans] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Added
- `20260803000009_cs_orchestrator_select_plans.sql` — `grant select on public.plans to cs_orchestrator`. rpc_plan_limit_check (SECURITY DEFINER owned by cs_orchestrator) reads `max_web_properties_per_org` from `public.plans`; the grant was missing because plans landed in migration 20260428000002 after the bulk of cs_orchestrator's table grants. Confirmed via `has_table_privilege` audit that this was the only missing grant across (accounts, organisations, org_memberships, web_properties, integration_connectors, plans).

### Tested
- [x] `bunx supabase db push` — applied.

## [ADR-0058 follow-up — fix rpc_plan_limit_check auth-schema leak] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Changed
- `20260803000008_plan_limit_check_current_uid.sql` — rewrite `public.rpc_plan_limit_check` to call `public.current_uid()` instead of `auth.uid()`. The function is SECURITY DEFINER owned by `cs_orchestrator` (set 20260414, preserved through the 20260429 RBAC rewrite), and cs_orchestrator has no USAGE on schema `auth`; in DEFINER context the `auth.uid()` call raised `permission denied for schema auth`. Broke onboarding Step 5 POST `/api/orgs/:orgId/properties`. Body otherwise identical to the 20260429 version.

### Verified
- Audited every `public.*` SECURITY DEFINER function owned by `cs_orchestrator` or `cs_delivery` — no other body matches `auth\.(uid|jwt|role)\(`; this was the last offender.

### Tested
- [x] `bunx supabase db push` — migration applied to remote dev DB.

## [ADR-0058 follow-up — drop dispatch trigger + cron] — 2026-04-21

**ADR:** ADR-0058 (follow-up)

### Removed
- `20260803000007_drop_invitation_dispatch_trigger.sql`:
  - Dropped trigger `invitations_dispatch_after_insert` on `public.invitations`.
  - Dropped function `public.invitations_after_insert_dispatch()` (unused after the trigger).
  - Unscheduled pg_cron job `invitation-dispatch-retry`.

### Kept (no changes)
- `public.dispatch_invitation_email(uuid)` — retained so an operator can still fire dispatch from a SQL session if needed. No automatic callers.
- `public.invitations.{email_dispatched_at, email_dispatch_attempts, email_last_error}` — still written by the synchronous dispatcher; useful for retry visibility.

### Tested
- [x] `bunx supabase db push` — applied to remote dev DB.

## [ADR-0058 follow-up — create_signup_intake explicit branches] — 2026-04-21

**ADR:** ADR-0058 (follow-up; no new ADR)

### Changed
- `20260803000006_signup_intake_explicit_status.sql` — `public.create_signup_intake` rewritten. Returns `{branch, id?, token?}` instead of the previous `{status:'ok', branch:<hidden>}` envelope. Branches (closed enum): `created` | `already_invited` | `existing_customer` | `admin_identity` | `invalid_email` | `invalid_plan`. The `id` + `token` fields populate only on `created` so a caller can re-dispatch synchronously if needed. Added a pending-invitation lookup for the `already_invited` branch that scans intakes where `accepted_at is null and revoked_at is null and expires_at > now() and origin in ('marketing_intake','operator_intake')`. Function signature + grants unchanged.

### Tested
- [x] `bunx supabase db push` — applied to remote dev DB.

## [ADR-1012 Sprint 1.3] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.3 — /v1/plans

### Added
- `20260803000004_v1_plans_list_rpc.sql` — `rpc_plans_list() returns jsonb`. Reads active rows from `public.plans`, envelope: `{ items: [{ plan_code, display_name, max_organisations, max_web_properties_per_org, base_price_inr, trial_days, api_rate_limit_per_hour, api_burst }, ...] }` ordered by `base_price_inr` ASC NULLS LAST then `plan_code`. `razorpay_plan_id` deliberately excluded (internal integration key). GRANT to `cs_api`.

### Tested
- [x] 4/4 plans.test.ts PASS (envelope shape, cheapest-first ordering with null-prices last, no razorpay_plan_id leak, rate-tier triangulation against TIER_LIMITS).

## [ADR-1012 Sprint 1.2] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.2 — discovery RPCs

### Added
- `20260803000003_v1_discovery_rpcs.sql`:
  - `rpc_purpose_list(p_key_id uuid, p_org_id uuid) returns jsonb` — lists `purpose_definitions` for the caller's org, ordered by `purpose_code`. Fenced by `assert_api_key_binding`. Envelope: `{ items: [{ id, purpose_code, display_name, description, data_scope, default_expiry_days, auto_delete_on_expiry, is_required, framework, is_active, created_at, updated_at }, ...] }`. `abdm_hi_types` deliberately omitted (healthcare-specific; V2 exposure). GRANT to `cs_api`.
  - `rpc_property_list(p_key_id uuid, p_org_id uuid) returns jsonb` — lists `web_properties` for the caller's org, ordered by `created_at` asc. Same fence. Envelope: `{ items: [{ id, name, url, allowed_origins, snippet_verified_at, snippet_last_seen_at, created_at, updated_at }, ...] }`. **`event_signing_secret` deliberately NOT in the envelope** — HMAC key; must not leak to API consumers. GRANT to `cs_api`.

### Tested
- [x] 9/9 discovery.test.ts PASS; 125/125 full integration PASS.

## [ADR-1012 Sprint 1.1] — 2026-04-21

**ADR:** ADR-1012 — v1 API DX gap fixes
**Sprint:** Phase 1 Sprint 1.1 — introspection RPCs

### Added
- `20260802000007_v1_introspection_rpcs.sql`:
  - `rpc_api_key_self(p_key_id uuid) returns jsonb` — returns safe metadata subset (id, account_id, org_id, name, key_prefix, scopes, rate_tier, lifecycle timestamps). Excludes key_hash/previous_key_hash/revoked_by. GRANT to cs_api.
  - `rpc_api_key_usage_self(p_key_id uuid, p_days int default 7) returns table` — per-day request_count + p50/p95 latency, zero-filled. Mirror of dashboard-side `rpc_api_key_usage` without the account-membership authz check (cs_api guarantee is upstream: middleware verified Bearer=p_key_id). GRANT to cs_api.
- `20260802000008_fix_usage_self_column.sql` — fix-forward: Sprint-1.1 draft referenced `created_at` on api_request_log; the actual column is `occurred_at`.

### Tested
- [x] 6/6 introspection.test.ts PASS; 116/116 full integration PASS.

## [ADR-0058 Sprint 1.5] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.5 — Admin operator-intake + polish

### Added
- `supabase/migrations/20260803000002_swap_intake_plan_and_telemetry.sql`:
  - `public.swap_intake_plan(p_org_id, p_new_plan_code)` SECURITY DEFINER. Self-serve tier whitelist (`starter | growth | pro`). Role gate `effective_org_role in ('account_owner','org_admin','admin')`. Refuses when `organisations.onboarded_at is not null` — post-handoff plan changes go through Settings → Billing. Updates `accounts.plan_code` for the org's account_id.
  - `public.onboarding_step_events` table — append-only telemetry buffer (id / org_id / step (1..7) / elapsed_ms / occurred_at). `enable row level security` with zero policies (writer is the DEFINER RPC below, reader will be a future admin RPC). Indexes on `(org_id, occurred_at desc)` + `(step, occurred_at desc)`.
  - `public.log_onboarding_step_event(p_org_id, p_step, p_elapsed_ms)` SECURITY DEFINER writer. Role gate `effective_org_role is not null`. Step range 1..7. Fire-and-forget from the customer app.

### Tested
- [x] `bunx supabase db push` — 1 migration applied to remote dev DB.

## [ADR-0058 Sprint 1.3] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.3 — Wizard shell + Steps 1–4

### Added
- `supabase/migrations/20260803000001_set_onboarding_step.sql` — `public.set_onboarding_step(p_org_id uuid, p_step smallint)` SECURITY DEFINER. Role gate `effective_org_role in ('org_admin','admin')` (account_owner inherits). Step range 0..7 (mirrors column CHECK). Stamps `organisations.onboarded_at` when `p_step=7`. GRANT EXECUTE to `authenticated`; REVOKED from public / anon. Unblocks wizard persistence introduced by Sprint 1.1 M5.

### Tested
- [x] `bunx supabase db push` — migration applied to remote dev DB.
- [x] Build + lint clean (see CHANGELOG-dashboard.md [ADR-0058 Sprint 1.3]).

## [ADR-0058 Sprint 1.1] — 2026-04-21

**ADR:** ADR-0058 — Split-flow customer onboarding
**Sprint:** Sprint 1.1 — DB foundations + public intake endpoint

### Added
- `supabase/migrations/20260802000001_invitations_origin.sql` — `public.invitations.origin` column (`operator_invite | operator_intake | marketing_intake`); back-compat default `operator_invite` keeps existing rows + the legacy `create_invitation_from_marketing` RPC working unchanged. Partial index `invitations_pending_by_origin_idx` for the dispatcher's lookup pattern.
- `supabase/migrations/20260802000002_create_signup_intake_rpc.sql` — `public.create_signup_intake(email, plan_code, org_name, ip)` SECURITY DEFINER. Existence-leak hardened (returns `{status:'ok'}` for every branch); refuses admin identities (Rule 12); only granted to `cs_orchestrator` + `service_role`.
- `supabase/migrations/20260802000003_create_operator_intake_rpc.sql` — `admin.create_operator_intake(email, plan_code, org_name)`. Operator-facing equivalent: errors loudly (caller is an admin), gated by `admin.require_admin('platform_operator')`.
- `supabase/migrations/20260802000004_seed_quick_data_inventory.sql` — `public.seed_quick_data_inventory(org_id, has_email, has_payments, has_analytics)` returns the count of newly-inserted rows. Backs Step 3 of the wizard. Idempotent via `WHERE NOT EXISTS` on `(org_id, data_category, source_type='quick_inventory_seed')`. Gated to `account_owner | org_admin` via `effective_org_role`.
- `supabase/migrations/20260802000005_first_consent_at.sql` — adds `organisations.first_consent_at`, `onboarded_at`, `onboarding_step` columns. AFTER INSERT trigger on `consent_events` stamps `first_consent_at` once. Partial index on pending-onboarding orgs.
- `supabase/migrations/20260802000006_intake_invitation_ttl.sql` — `public.fn_sweep_expired_intake_invitations()` deletes abandoned intakes older than their 14-day expiry, logs to `admin.admin_audit_log`. pg_cron job `adr-0058-sweep-intakes` schedules nightly at 21:00 UTC (02:30 IST).

### Tested
- [x] `cd app && bunx vitest run tests/invitation-dispatch.test.ts` — 11/11 PASS (includes 4 new origin-aware copy tests).
- [x] `cd app && bun run build` — clean; 47 routes including the new `/api/public/signup-intake`.
- [x] `cd app && bun run lint` — 0 errors, 0 warnings.
- [x] `bunx supabase db push` — 6 migrations applied to remote dev DB (`supabase migration list` shows Local + Remote columns both filled for 20260802000001-06).
- [x] `bunx vitest run tests/rls/invitations-origin.test.ts` — 7/7 PASS (column+check constraint, anon/authenticated INSERT blocked, fresh-email + existing-customer leak-parity branches, invalid-plan silent branch, admin-identity refusal).

## [ADR-1011 — revoked-key tombstone] — 2026-04-21

**ADR:** ADR-1011 — rotate+revoke 401→410 fix (V2 C-1)

### Added
- `20260801000010_revoked_key_tombstone.sql`:
  - `public.revoked_api_key_hashes (key_hash pk, key_id uuid fk, revoked_at)` — tombstone table; RLS on, zero policies, zero grants.
  - `rpc_api_key_revoke` rewritten: inserts current `key_hash` + (if rotated) `previous_key_hash` into the tombstone BEFORE the UPDATE clears `previous_key_hash`.
  - `rpc_api_key_status` rewritten: three-slot lookup — current `key_hash`, live `previous_key_hash`, tombstone. Every plaintext ever associated with a now-revoked key surfaces as `'revoked'` (→ 410 Gone) instead of `'not_found'` (→ 401).

### Tested
- [x] 108/108 integration suite PASS.
- [x] New cs-api-role test: rotate H1→H2, revoke, both `rpc_api_key_status(P1)` and `rpc_api_key_status(P2)` return `'revoked'`; tombstone holds exactly `{H1, H2}` for the key_id.
- [x] Existing api-keys.e2e assertion flipped from 401/invalid → 410/revoked for the rotated-then-revoked plaintext.

## [ADR-1009 Sprint 2.4] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.4 — revoke service_role on v1-path functions

### Removed (grants)
- `20260801000009_revoke_service_role_v1_grants.sql` — revokes EXECUTE from `service_role` on:
  - 9 v1 business RPCs (rpc_consent_verify, rpc_consent_verify_batch, rpc_consent_record, rpc_artefact_list, rpc_artefact_get, rpc_artefact_revoke, rpc_event_list, rpc_deletion_trigger, rpc_deletion_receipts_list).
  - 3 auth/telemetry RPCs (rpc_api_key_verify, rpc_api_key_status, rpc_api_request_log_insert).
  - 1 fence helper (assert_api_key_binding).
- cs_api EXECUTE grants are untouched. The v1 path now has exactly one callable role at the DB layer.

### Tested
- [x] 107/107 integration + cs_api smoke PASS, incl. new negative assertion that `rpc_consent_verify` called as service_role (via Supabase REST `admin.rpc`) raises `42501` / "permission denied for function".

## [ADR-1009 Sprint 2.2] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.2 — grant v1 RPCs to `cs_api`

### Added
- `20260801000008_cs_api_v1_rpc_grants.sql` — `grant execute on function ... to cs_api` for the 9 v1 business RPCs: rpc_consent_verify, rpc_consent_verify_batch, rpc_consent_record, rpc_artefact_list, rpc_artefact_get, rpc_artefact_revoke, rpc_event_list, rpc_deletion_trigger, rpc_deletion_receipts_list. Purely additive — `service_role` grants remain (Sprint 2.4 revokes).

### Tested
- [x] 6/6 cs-api-role.test.ts PASS (assertion "cs_api cannot execute rpc_consent_record" inverted to "cs_api can execute rpc_consent_verify + fence still rejects a bogus keyId with api_key_not_found").
- [x] 106/106 full integration suite PASS.

## [ADR-1009 Sprint 2.1 follow-up] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.1 follow-up — bootstrap RPC grants

### Added
- `20260801000007_cs_api_bootstrap_rpc_grants.sql` — grants EXECUTE on `rpc_api_key_verify(text)` and `rpc_api_request_log_insert(uuid, uuid, uuid, text, text, int, int)` to `cs_api`. These two sit BEFORE any v1 business RPC in the middleware request path; originally scoped for Sprint 2.2 but needed earlier to unlock the Sprint 2.1 smoke suite.

### Tested
- [x] 5/5 cs-api-role.test.ts PASS; 105/105 full integration suite PASS (no regression).

## [ADR-1009 Sprint 2.1 — scope amendment] — 2026-04-21

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 2 Sprint 2.1 — cs_api role activation (scope-amended)

### Scope amendment
Original Phase 2 minted an HS256 JWT for cs_api (same pattern as SUPABASE_WORKER_KEY). Supabase is rotating project JWT signing keys to ECC P-256; the legacy HS256 secret is flagged "Previously used" in the dashboard and will be revoked. HS256-signed scoped-role JWTs are on borrowed time. Direct Postgres connections as LOGIN roles are unaffected, so cs_api switches to that path — same pattern as cs_delivery / cs_orchestrator from Edge Functions. See ADR-1009 Phase 2 "Scope amendment" block for the rationale.

### Added
- `20260801000006_cs_api_login_and_key_status.sql`:
  - `alter role cs_api with login password 'cs_api_change_me'` — placeholder password, same pattern as 20260413000010 cs_worker seed. User rotates out-of-band via psql.
  - `public.rpc_api_key_status(text) returns text` — SECURITY DEFINER lookup of lifecycle state by plaintext (`'active' | 'revoked' | 'not_found'`). Handles current `key_hash` + dual-window `previous_key_hash` rotation path. Grants: `cs_api` + `service_role` (transition window).

## [ADR-1009 Sprint 1.2] — 2026-04-20

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 1 Sprint 1.2 — DB tenant fence on read RPCs

### Changed
- `20260801000005_api_key_binding_reads.sql` — DROP + CREATE on six read RPCs with `p_key_id uuid` as the first parameter and `assert_api_key_binding(p_key_id, p_org_id)` at the top of every body:
  - `rpc_consent_verify`
  - `rpc_consent_verify_batch`
  - `rpc_artefact_list`
  - `rpc_artefact_get`
  - `rpc_event_list`
  - `rpc_deletion_receipts_list`
- Grants preserved on `service_role` only (Phase 2 will re-target to `cs_api`).

### Tested
- [x] 100/100 integration suite PASS (up from 99 with one new `api_key_binding` fence test in consent-verify).
- [x] Full integration + DEPA suite — see CHANGELOG-api § Sprint 1.2 for the counts.

## [ADR-1009 Sprint 1.1] — 2026-04-20

**ADR:** ADR-1009 — v1 API role hardening
**Sprint:** Phase 1 Sprint 1.1 — DB tenant fence on mutating RPCs

### Added
- `20260801000004_api_key_binding_mutations.sql`:
  - `public.assert_api_key_binding(p_key_id uuid, p_org_id uuid) returns void` — SECURITY DEFINER fence. Raises 42501 when the referenced `api_keys` row is missing, revoked, bound to a different org (for org-scoped keys), or bound to a different account (for account-scoped keys). Grants EXECUTE to `service_role` only (Phase 2 will re-target to `cs_api`).

### Changed
- `public.rpc_consent_record` — signature gains `p_key_id uuid` as first parameter; calls `assert_api_key_binding(p_key_id, p_org_id)` before any tenant-visible work. DROP + CREATE (signature change). Existing SECURITY DEFINER + `service_role` grant preserved.
- `public.rpc_artefact_revoke` — same change: `p_key_id` first; fence call at top.
- `public.rpc_deletion_trigger` — same change: `p_key_id` first; fence call at top.

### Tested
- [x] 63/63 PASS across five affected suites — `consent-record`, `consent-revoke`, `deletion-api`, `artefact-event-read`, `mrs-sharma.e2e`.
- [x] 123/123 PASS full integration + DEPA suite (baseline 121 + 2 new cross-key/cross-org fence tests).
- [x] Cross-key attacks rejected by the DB fence: (a) otherOrg-bound key acting on org → `api_key_binding` 403, (b) org-bound key pretending to be otherOrg → `api_key_binding` 403, (c) same-org key on same-org artefact → 200 (unchanged happy path).

## [ADR-1002 Sprint 4.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 4.1 — Deletion API RPCs

### Added
- `20260801000003_rpc_deletion.sql`:
  - `public.rpc_deletion_trigger(org, property, identifier, identifier_type, reason, purpose_codes[], scope_override[], actor_type, actor_ref) returns jsonb` — SECURITY DEFINER. Modes: `consent_revoked` (requires purpose_codes) sweeps active artefacts matching (property, identifier, purpose_codes); `erasure_request` sweeps ALL active artefacts for (property, identifier); `retention_expired` raises `retention_mode_not_yet_implemented`. Inserts `artefact_revocations` rows; the ADR-0022 cascade + process-artefact-revocation Edge Function fan out asynchronously to deletion_receipts. Returns `{ reason, revoked_artefact_ids, revoked_count, initial_status, note }`.
  - `public.rpc_deletion_receipts_list(org, status, connector_id, artefact_id, issued_after, issued_before, cursor, limit) returns jsonb` — SECURITY DEFINER. Keyset cursor pagination on (created_at, id). Filter by `artefact_id` joins through `artefact_revocations.id → deletion_receipts.trigger_id`. Raises `bad_cursor` (22023).
  - Grants: both RPCs to `service_role` only.

### Tested
- [x] 14/14 PASS — `tests/integration/deletion-api.test.ts`: consent_revoked partial purpose sweep; erasure_request full sweep; re-trigger with no actives → 0 revoked; purpose_codes requirement for consent_revoked; retention_expired → 501; unknown reason; cross-org property; unknown identifier_type; receipts filter by artefact_id / status / connector_id; bad cursor; cross-org isolation; ancient-window empty.
- [x] 111/111 full integration + DEPA suite — no regressions.

## [ADR-1002 Sprint 3.2] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 3.2 — Revoke artefact RPC

### Added
- `20260801000002_rpc_artefact_revoke.sql`:
  - `public.rpc_artefact_revoke(p_org_id, p_artefact_id, p_reason_code, p_reason_notes, p_actor_type, p_actor_ref) returns jsonb` — SECURITY DEFINER. Validates artefact ownership (P0001 `artefact_not_found`); short-circuits for already-revoked artefacts with `idempotent_replay=true` and returns the existing `revocation_record_id` (from `consent_artefact_index`, falling back to the most recent `artefact_revocations` row for pre-Sprint-1.1 data); rejects terminal states with 22023 `artefact_terminal_state: <state>`; maps API `actor_type` → DB `revoked_by_type` (user→data_principal, operator→organisation, system→system); inserts `artefact_revocations` row. The ADR-0022 cascade trigger + ADR-1002 Sprint 1.1 index-preservation fix handle state transitions atomically.
  - Grant: `service_role` only.

### Tested
- [x] 10/10 PASS — `tests/integration/consent-revoke.test.ts`: revoke active → cascade verified on both consent_artefacts and consent_artefact_index; post-revoke verify returns `revoked` with pointer; operator actor persisted correctly; idempotent replay returns same id; terminal states (expired + replaced) → artefact_terminal_state; nonexistent + cross-org → artefact_not_found (not leaked); empty reason_code; unknown actor_type.
- [x] 97/97 full integration + DEPA suite — no regressions.

## [ADR-1002 Sprint 3.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 3.1 — Artefact + event list/get RPCs

### Added
- `20260720000003_artefact_event_list_rpcs.sql`:
  - `public.rpc_artefact_list(org, property, identifier, identifier_type, status, purpose_code, expires_before, expires_after, cursor, limit) returns jsonb` — SECURITY DEFINER. Keyset pagination on `(created_at, id)`; cursor is base64(JSON). Optional identifier+type join through `consent_artefact_index`. Effective status derived from `consent_artefacts.status` + `expires_at < now()`. Limit clamped to [1, 200]. Raises `bad_cursor` / `identifier_requires_both_fields` (22023).
  - `public.rpc_artefact_get(org, artefact_id) returns jsonb | null` — SECURITY DEFINER. Joins `consent_artefact_index` for revocation pointer; recursive CTE traverses the replaced_by chain both backward and forward (depth-limited to 100); returns envelope with `revocation` + `replacement_chain` (chronological).
  - `public.rpc_event_list(org, property, created_after, created_before, source, cursor, limit) returns jsonb` — SECURITY DEFINER. Cursor pagination; summary fields only (jsonb_array_length for purpose counts, array_length for artefact count — no full payloads). Limit clamped to [1, 200]. Raises `bad_cursor`.
  - All three: grant to `service_role` only.
- `20260801000001_artefact_event_rpc_fixes.sql`:
  - `rpc_artefact_get` — replaced record-variable dereference (which raised 55000 "record is not assigned yet" when no revocation existed) with a subquery-driven `jsonb_build_object`. Returns null naturally.
  - `rpc_event_list` — removed a stray `max(id) filter (where true)` placeholder that raised 42883 `max(uuid) does not exist`.

### Tested
- [x] 17/17 PASS — `tests/integration/artefact-event-read.test.ts`: list org-scoped, filters (property/purpose/status), cursor pagination with no-overlap check, identifier-filter both-fields requirement, bad cursor, cross-org isolation; detail revocation join, replacement chain [A,B,C] from any entry point, cross-org null; event list, source filter, date range, cross-org isolation.
- [x] 87/87 full integration + DEPA suite — no regressions.

## [ADR-1002 Sprint 2.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 2.1 — Mode B consent record (`/v1/consent/record`)

### Added
- `20260720000002_consent_record_columns.sql`:
  - `consent_events` relaxed: `banner_id`, `banner_version`, `session_fingerprint` are now nullable. Existing web rows unaffected.
  - `consent_events` gains: `source text not null default 'web'` (check: `web|api|sdk`), `data_principal_identifier_hash text`, `identifier_type text` (email|phone|pan|aadhaar|custom), `client_request_id text`.
  - CHECK `consent_events_shape_by_source_check`: `source='web'` requires (banner_id, session_fingerprint); `source='api'` requires (data_principal_identifier_hash, identifier_type); `source='sdk'` TBD.
  - Partial unique index `consent_events_client_request_uniq` on `(org_id, client_request_id) WHERE client_request_id IS NOT NULL` — idempotency key.
  - `consent_artefacts` relaxed: same three browser-only columns nullable (Mode B artefacts don't carry banner or fingerprint).
  - `public.rpc_consent_record(p_org_id, p_property_id, p_identifier, p_identifier_type, p_purpose_definition_ids uuid[], p_rejected_purpose_definition_ids uuid[], p_captured_at timestamptz, p_client_request_id text) returns jsonb` — SECURITY DEFINER. Validates property ownership (P0001 property_not_found), captured_at within ±15 min (22023), every accepted + rejected purpose_definition_id belongs to the org (22023 with echoed ids), hashes the identifier, inserts consent_events + consent_artefacts + consent_artefact_index for every granted purpose in a single transaction. Idempotency: replay returns prior envelope with `idempotent_replay=true`.
  - Grant: `service_role` only.

### Tested
- [x] 10/10 PASS — `tests/integration/consent-record.test.ts`: 5-grant / 5-grant+2-rejected / record→verify round-trip / client_request_id idempotency / stale + future captured_at / cross-org purpose id / empty purposes / cross-org property / empty identifier.
- [x] 70/70 full integration + DEPA suite — no regression from the `consent_events` / `consent_artefacts` nullability changes.

## [ADR-1002 Sprint 1.3] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 1.3 — `rpc_consent_verify_batch` RPC for `/v1/consent/verify/batch`

### Added
- `20260720000001_rpc_consent_verify_batch.sql`:
  - `public.rpc_consent_verify_batch(p_org_id, p_property_id, p_identifier_type, p_purpose_code, p_identifiers text[]) returns jsonb` — SECURITY DEFINER. Hashes the full input array via `unnest WITH ORDINALITY`, then a single LATERAL `LIMIT 1` per element against the hot-path partial index `(org_id, property_id, identifier_hash, purpose_code) WHERE validity_state='active' AND identifier_hash IS NOT NULL`. Response rows preserve input order via the ORDINALITY tag. Server-stamped `evaluated_at` applies to every row in the batch. Defense-in-depth: raises `identifiers_too_large` at > 10,000 elements (the route handler caps at the same limit).
  - Grant: `service_role` only.

### Tested
- [x] 8/8 PASS — `tests/integration/consent-verify-batch.test.ts`: ordered 5-element mixed fixture; 25-element interleaved ordering; 10,001 → identifiers_too_large; 0 → identifiers_empty; cross-org property_not_found; unknown type → invalid_identifier; all-or-nothing on malformed mid-batch; 1,000-element perf < 5 s.

## [ADR-1002 Sprint 1.2] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 1.2 — `rpc_consent_verify` RPC for `/v1/consent/verify`

### Added
- `20260710000001_rpc_consent_verify.sql`:
  - `public.rpc_consent_verify(p_org_id, p_property_id, p_identifier, p_identifier_type, p_purpose_code) returns jsonb` — SECURITY DEFINER. Validates property ownership (raises `property_not_found` / P0001 if the property does not belong to the org); calls `hash_data_principal_identifier` (propagates 22023 for empty / unknown-type); selects the most-authoritative index row (priority: active > expired > revoked, newest first); returns the §5.1 envelope. `evaluated_at` is server-stamped.
  - Grant: `service_role` only. Route handlers reach this via the service-role client (same carve-out as the Bearer verify path).

### Tested
- [x] 9/9 PASS — `tests/integration/consent-verify.test.ts`: granted / revoked / expired / never_consented / cross-org property_not_found / empty identifier / unknown type / identifier_type mismatch / cross-org salt isolation.

## [ADR-1002 Sprint 1.1] — 2026-04-20

**ADR:** ADR-1002 — DPDP §6 runtime enforcement
**Sprint:** Sprint 1.1 — Extend `consent_artefact_index` for identifier-based lookup

### Added
- `20260701000001_consent_artefact_index_identifier.sql`:
  - Extends `public.consent_artefact_index` with six nullable columns: `property_id` (FK → `web_properties`), `identifier_hash`, `identifier_type` (enum: `email|phone|pan|aadhaar|custom`), `consent_event_id` (FK → `consent_events`), `revoked_at`, `revocation_record_id` (FK → `artefact_revocations`).
  - Partial hot-path index `idx_consent_artefact_index_identifier_hot` on `(org_id, property_id, identifier_hash, purpose_code)` where `validity_state='active' AND identifier_hash IS NOT NULL`.
  - `public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type)` SECURITY DEFINER function — normalises per type (email: trim+lowercase; phone/aadhaar: digits only; pan: uppercase+trim; custom: trim) and returns SHA-256 hex salted with the org's `encryption_salt`. Granted to `authenticated`, `service_role`, `cs_orchestrator`. Single source of truth for write-time and read-time hashing.

### Changed
- `trg_artefact_revocation_cascade()` trigger function — was `DELETE FROM consent_artefact_index WHERE artefact_id = new.artefact_id`; now `UPDATE ... SET validity_state='revoked', revoked_at=now(), revocation_record_id=new.id`. Revoked rows remain queryable so `/v1/consent/verify` can return `revoked` instead of `never_consented`.
- `cs_orchestrator` gets UPDATE on the new columns (`validity_state`, `revoked_at`, `revocation_record_id`) for scheduled-job use.

### Scope note
Original ADR-1002 Sprint 1.1 was split into a schema half (this entry) and a handler half (new Sprint 1.2). Rationale in ADR-1002.

### Tested
- [x] 9/9 PASS — `tests/depa/artefact-index-identifier.test.ts` (hash determinism, per-type normalisation, per-org salt, empty-rejection, revocation cascade UPDATEs index row with all fields)
- [x] 24/24 DEPA suite PASS — no regression in consent-event-pipeline or revocation-pipeline tests
- [x] `bunx supabase db push` — PASS (migration applied to remote)

## [ADR-1001 Sprint 2.4] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-marketing + Public API foundation
**Sprint:** Sprint 2.4 — Rate-tier plan columns + request-log RPCs

### Added
- `20260601000001_api_request_log.sql`:
  - `public.plans.api_rate_limit_per_hour int NOT NULL DEFAULT 100` + `api_burst int NOT NULL DEFAULT 20`. Seeded: starter/trial/sandbox=100/20, growth=1000/100, pro=10000/500, enterprise=100000/2000.
  - `rpc_api_request_log_insert(key_id, org_id, account_id, route, method, status, latency)` — SECURITY DEFINER, `service_role` grant. Inserts into `public.api_request_log`; silently swallows exceptions so logging never breaks a response.
  - `rpc_api_key_usage(key_id, days=7)` → `(day, request_count, p50_ms, p95_ms)` — SECURITY DEFINER, `authenticated` grant. Checks caller is account_owner or account_viewer before querying.

### Tested
- [x] `bunx supabase db push` — PASS (migration applied to remote)

## [ADR-1001 Sprint 2.1] — 2026-04-20

**ADR:** ADR-1001 — Truth-in-marketing + Public API foundation
**Sprint:** Sprint 2.1 — `cs_live_*` API key schema + issuance RPCs (G-036)

### Added
- `20260520000001_api_keys_v2.sql`:
  - Extends `public.api_keys` with v2 lifecycle columns — `account_id` (FK → `public.accounts`, cascade), `rate_tier` (CHECK enum: `starter|growth|pro|enterprise|sandbox`, default `starter`), `created_by`, `revoked_at`, `revoked_by`, `previous_key_hash`, `previous_key_expires_at`, `last_rotated_at`. `org_id` made nullable so an account-scoped key can span every org under the owning account.
  - `public.api_keys_scopes_valid(text[])` — immutable SQL scope allow-list (`read:consent|write:consent|read:artefacts|write:artefacts|read:rights|write:rights|read:deletion|write:deletion|read:tracker|read:audit|read:security|read:probes|read:score`), enforced via CHECK constraint so invalid scopes cannot be stored even by a compromised SECURITY DEFINER path.
  - `public.api_keys_sync_is_active()` BEFORE-trigger keeps legacy `is_active` boolean in sync with canonical `revoked_at` timestamp.
  - Indexes: `api_keys_account_idx`, `api_keys_revoked_idx` (partial `WHERE revoked_at IS NULL`), `api_keys_prefix_idx`.
  - `public.api_request_log` day-partitioned table for audit (id, key_id, account_id, org_id, method, path, status_code, latency_ms, bytes_in, bytes_out, occurred_at); `api_request_log_ensure_partition(date)` helper; daily pg_cron job creates tomorrow's partition; weekly pg_cron drops partitions older than 90 days.
  - `cs_api` minimum-privilege Postgres role (EXECUTE on `rpc_api_key_verify` only; no direct table DML). Will run the middleware's per-request Supabase client in ADR-1002.
  - RLS on `public.api_keys`: account_owner / account_viewer see account keys; org_admin sees org-scoped keys. REVOKE INSERT/UPDATE/DELETE from `authenticated` — writes flow exclusively through SECURITY DEFINER RPCs.
  - RLS on `public.api_request_log`: same scope rule (no direct writes from `authenticated`).
  - Column-level REVOKE SELECT on `key_hash` + `previous_key_hash` (superseded by migration 003 because Supabase default grants shadow column-level REVOKE — see below).
  - `rpc_api_key_create(p_account_id, p_org_id, p_scopes, p_rate_tier, p_name)` — SECURITY DEFINER; caller must be `account_owner` of the target account OR `org_admin` of a target org under that account. Generates `cs_live_` + base64url(32 random bytes); returns plaintext once only; stores SHA-256 hex hash; writes an `api_key.created` row to `public.audit_log`. Returns `{ id, plaintext, prefix, scopes, rate_tier, created_at }`.
  - `rpc_api_key_rotate(p_key_id)` — preserves `id`; stages previous hash + `previous_key_expires_at = now()+24h` so the old plaintext continues to verify for 24h; refuses rotation on revoked keys.
  - `rpc_api_key_revoke(p_key_id)` — sets `revoked_at` + `revoked_by`, clears `previous_key_hash` so both plaintexts stop verifying mid-dual-window; idempotent on already-revoked.
  - `rpc_api_key_verify(p_plaintext)` — hash lookup against `key_hash` OR a live `previous_key_hash` (dual-window); rejects revoked + expired; EXECUTE granted to `cs_api` + `service_role` only.
- `20260520000002_api_keys_v2_fixes.sql` — two fixes surfaced by the RLS test:
  - `public.is_account_member(account_id, roles[])` + `public.is_org_member(org_id, roles[])` SECURITY DEFINER helpers. The original api_keys RLS policies queried `account_memberships` / `org_memberships` directly inside `USING`, which triggered RLS recursion (those tables have their own RLS). Helpers bypass it cleanly.
  - Rewrote `rpc_api_key_create` with an explicit null-check on caller role — the previous `v_caller_role not in ('account_owner')` gate let a NULL (non-member caller) slip through because NULL compared to any value via `not in` returns NULL, which plpgsql treated as false.
- `20260520000003_api_keys_column_grants.sql` — follow-up on column hiding:
  - Postgres column-level `REVOKE SELECT` is shadowed by Supabase's default table-wide GRANT to `authenticated`. The only working recipe is `REVOKE SELECT ON TABLE` + `GRANT SELECT (col1, col2, …)` for the allow-listed columns.
  - `authenticated` receives SELECT on every api_keys column EXCEPT `key_hash` and `previous_key_hash`. Those columns are reachable only via `rpc_api_key_verify` (service_role / cs_api). PostgREST raises `permission denied for table api_keys` when a customer session selects a redacted column, exactly as intended.

### Tested
- [x] `tests/rls/api-keys.test.ts` — **17/17 PASS** in isolation (9.38s). Covers: cs_live_ plaintext generation + SHA-256 hash; invalid-scope rejection; non-member refusal; RLS cross-tenant isolation; column-level `key_hash` hiding; `rpc_api_key_verify` positive + wrong-plaintext + malformed + hash-match; rotation dual-window (old + new both verify); revoke invalidates both + idempotent second-call; rotate-after-revoke raises; cross-org revoke refused.
- [x] Migrations pushed via `bunx supabase db push` — "Remote database is up to date".

### Known pre-existing flakes (not introduced by this sprint)
- `tests/admin/admin-lifecycle-rpcs.test.ts` — two "last active platform_operator" guards fail/time-out due to 5+ active `platform_operator` rows accumulated in the shared dev DB from prior test runs. Tests suspend non-opA POs but RPC's count query evaluates stale state. Unrelated to api_keys schema.
- `tests/billing/gst-statement.test.ts` — "owner + NULL issuer returns all three invoices across both issuers" fails with `expected 4 to be 3` (extra invoice row leaked from a prior run). Uncommitted test file from earlier ADR-0050 Sprint 3.1 work; separate cleanup.

## [ADR-0050 Sprint 2.3] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.3 — invoice history RPCs + Razorpay invoice.paid reconciliation

### Added
- `20260509000001_billing_invoice_list_detail.sql`:
  - Helper `admin._billing_active_issuer_id()` — stable lookup of the current single-active issuer row; shared by every scope-rule site in this sprint.
  - `admin.billing_invoice_list(p_account_id uuid, p_limit int default 50)` → jsonb array. SECURITY DEFINER, platform_operator+. Scope rule: `platform_operator` sees only invoices under the currently-active issuer; `platform_owner` sees all issuers (active + retired). Newest-first by `(issue_date desc, fy_sequence desc)`. p_limit clamped to 1–500 (defaults on out-of-range).
  - `admin.billing_invoice_detail(p_invoice_id uuid)` → jsonb envelope (invoice + denormalised issuer + account billing profile). Same tier + scope rule; retired-issuer invoices accessed by `platform_operator` raise with a scope-scoped error.
  - Extended `admin.billing_account_summary(p_account_id)` — adds `latest_invoice` envelope (id / invoice_number / issue_date / due_date / status / total_paise / issuer_entity_id) and replaces the Sprint 1 stub `outstanding_balance_paise: 0` with a real computation: `sum(total_paise)` across invoices in status `issued`, `partially_paid`, or `overdue`. All Sprint 1 keys retained — backward compatible.
  - `admin.billing_accounts_invoice_snapshot()` → jsonb array with one row per account (their latest invoice). Backs the "Last invoice" column on the `/billing` landing. Respects the same scope rule as `billing_invoice_list`.
- `20260509000002_razorpay_reconcile_invoice_paid.sql`:
  - `public.rpc_razorpay_reconcile_invoice_paid(p_razorpay_invoice_id, p_razorpay_order_id, p_paid_at default null)` → jsonb. SECURITY DEFINER, anon-callable (like the existing verbatim-insert + stamp RPCs). Matches `public.invoices` by `razorpay_invoice_id` first, then `razorpay_order_id`. On match: flips `status='paid'` and stamps `paid_at=coalesce(input,now())`. Idempotent — already-paid returns `matched=true, reason='already paid'` with no mutation. No match → `matched=false, reason='no matching invoice'` (no error — the webhook handler stamps the outcome on `billing.razorpay_webhook_events`).
- `20260509000003_billing_invoice_order_tiebreak.sql`:
  - Follow-up: adds `created_at desc` as the final ORDER BY tie-break on all three invoice-reading RPCs. Two invoices on the same calendar day under different issuers could share `issue_date` and `fy_sequence=1`; `created_at` is the truest "newest" signal across issuers.

### Tested
- [x] `tests/billing/webhook-reconciliation.test.ts` — **5/5 PASS**. Match by razorpay_invoice_id flips issued→paid + paid_at set; idempotent re-run (already-paid reason); order_id fallback; orphan id returns matched=false without error; empty matcher returns matched=false reason='no matcher'.
- [x] `tests/admin/billing-invoice-list.test.ts` — **14/14 PASS**. platform_operator sees only active-issuer invoices; platform_owner sees retired too; newest-first ordering; p_limit honoured; support denied; detail raises for operator on retired-issuer invoice; operator allowed on active; missing invoice raises; support denied; latest_invoice + outstanding_balance_paise correct post-finalize; accounts_invoice_snapshot scope.
- [x] `tests/billing/issuer-immutability.test.ts` — **10/10 PASS**. Six identity fields each raise with retire-and-create guidance; three operational fields (address, signatory, bank) patch and persist; unknown field raises.
- [x] Full repo suite `bun run test:rls` — **371/371 PASS** across 37 test files.

## [ADR-0050 Sprint 2.2] — 2026-04-19

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Sprint 2.2 — invoice issuance RPC + GST computation + finalize RPCs

### Added
- `20260508000001_billing_issue_invoice_rpc.sql`:
  - `public.billing_compute_gst(p_issuer_state, p_customer_state, p_subtotal_paise, p_rate_bps default 1800)` — IMMUTABLE SQL. Intra-state → CGST+SGST 50/50 with remainder on SGST so the sum is exact; inter-state (or null customer state) → full IGST. Case-insensitive state match. Rate bounds 0–10000 bps. EXECUTE granted to cs_admin, cs_orchestrator, authenticated.
  - `admin.billing_issue_invoice(p_account_id, p_period_start, p_period_end, p_line_items jsonb, p_due_date default null)` — SECURITY DEFINER, `require_admin('platform_operator')`. Loads active issuer under `FOR UPDATE`, validates the account billing profile, computes FY (`YYYY-YY`) + next fy_sequence scoped to (issuer, fy_year), assembles `invoice_number = <prefix>/<fy_year>/NNNN`, computes GST via the SQL primitive, inserts `public.invoices` at status=draft, audit-logs. Returns uuid. Raises on missing active issuer, account billing fields missing, line_items invalid, period crossing FY boundary, due_date before period_end.
  - `admin.billing_finalize_invoice_pdf(p_invoice_id, p_pdf_r2_key, p_pdf_sha256)` — flips draft → issued; stamps `pdf_r2_key`, `pdf_sha256`, `issued_at`. Scope rule: platform_operator can only finalize invoices on the currently-active issuer; platform_owner may finalize across issuers. Rejects non-draft targets and non-64-char digests.
  - `admin.billing_stamp_invoice_email(p_invoice_id, p_email_message_id)` — stamps Resend message id on an issued invoice. Same scope rule.
  - `admin.billing_invoice_pdf_envelope(p_invoice_id)` — SECURITY DEFINER read envelope (invoice + issuer + account billing profile) for the Route Handler's render path. Replaces three PostgREST round-trips that would otherwise be blocked by the `authenticated`-role revoke on public.invoices.
- `20260508000002_billing_finalize_role_column_fix.sql` — follow-up. The two finalize RPCs originally read `admin.admin_users.role`; the actual column is `admin_role` (per 20260416000014). Recreated both functions with the correct column; no schema change.

### Tested
- [x] `tests/billing/gst-computation.test.ts` — **11/11 PASS**. Intra-state (CGST+SGST 9+9), inter-state (IGST 18), null customer state → IGST, case-insensitive intra match, odd-paise remainder on SGST, zero subtotal, custom rate 5%, negative subtotal raises, rate_bps > 10000 raises, missing issuer_state raises.
- [x] `tests/billing/issue-invoice.test.ts` — **13/13 PASS**. First invoice gets fy_sequence=1 + prefix/year/0001 + CGST+SGST split; second gets fy_sequence=2; FY boundary raise; support-role denied; empty / non-array / missing-amount line_items raise; missing account billing field raises; no-active-issuer raises; finalize flips draft → issued; finalize on non-draft raises; stamp_email on issued succeeds; stamp_email on draft raises; support cannot finalize; sha256 length enforced.
- [x] Full repo suite `bun run test:rls` — **343/343 PASS** across 34 test files (no regressions).

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

## [ADR-0050 Sprint 3.1] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.1

### Added
- `20260510000001_billing_gst_statement.sql` — `admin.billing_gst_statement()` SECURITY DEFINER RPC; scope rule: operator callers locked to current-active issuer, owner callers unrestricted; audit-logged on every call.
- `20260510000002_billing_export_and_search.sql` — `admin.billing_invoice_export_manifest()` RPC; scope rule matches GST statement; snapshots `issuer_legal_name` + `account_name` at export time.

### Tested
- [x] `tests/billing/gst-statement.test.ts` — 5/5 PASS (synthetic invoices, intra/inter-state totals, scope enforcement)
- [x] `tests/billing/invoice-export-authz.test.ts` — 14/14 PASS (support/read_only denied; operator scope enforced; owner unrestricted)
- [x] `tests/billing/invoice-export-contents.test.ts` — 7/7 PASS (CSV BOM+CRLF, per-row SHA-256, audit-log round-trip, determinism, missing/failed PDF tags)
- [x] `bun run test:rls` — 412/414 PASS (2 pre-existing lifecycle-RPC flaky failures; not Sprint 3.1 scope)

## [ADR-0050 Sprint 3.2] — 2026-04-20

**ADR:** ADR-0050 — Admin account-aware billing
**Sprint:** Phase 3, Sprint 3.2

### Added
- `20260530000001_billing_disputes.sql` — `public.disputes` table (RLS: cs_admin SELECT, cs_orchestrator all); deadline/evidence/state lifecycle columns; updated_at trigger.
- `public.rpc_razorpay_dispute_upsert()` SECURITY DEFINER RPC — callable by anon/authenticated/cs_orchestrator; upserts dispute row on conflict; maps event_type to status; best-effort account_id resolution from prior billing webhook events.
- `admin.billing_dispute_set_evidence()` SECURITY DEFINER RPC — platform_operator+; records R2 key + evidence_assembled_at + audit log.
- `admin.billing_dispute_mark_state()` SECURITY DEFINER RPC — platform_operator+; status transitions (under_review/won/lost/closed) with required reason + audit log.

### Tested
- [x] `tests/billing/dispute-webhook.test.ts` — 5/5 PASS (created/won/lost/closed upsert, anon access)
- [x] `tests/billing/evidence-bundle.test.ts` — 8/8 PASS (ZIP contents, PDF handling, counts, determinism)

## [ADR-0054 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0054 — Customer-facing billing portal
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260610000001_customer_billing_portal_reads.sql` — three SECURITY DEFINER RPCs callable by `authenticated`:
  - `public.list_account_invoices()` — invoice rows + issuer_legal_name + account_legal_name, scoped to caller's account
  - `public.get_account_billing_profile()` — billing profile JSON scoped to caller's account
  - `public.get_account_invoice_pdf_key(uuid)` — resolves pdf_r2_key for a single invoice scoped to caller's account; raises on cross-account, void, or non-existent
- All three raise `access_denied` when caller's `current_account_role()` is not in (`account_owner`, `account_viewer`).
- No direct GRANT SELECT on `public.invoices` for authenticated — all customer reads remain RPC-mediated.

### Tested
- [x] `tests/billing/customer-invoice-reads.test.ts` — 9/9 PASS (scope isolation, void state, not-found enumeration prevention, billing profile isolation)

## [ADR-0054 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0054 — Customer-facing billing portal
**Sprint:** Phase 1, Sprint 1.2

### Added
- `20260610000002_customer_billing_portal_writes.sql`:
  - `public.account_audit_log` table + RLS policy (account_owner of the account + admin identities can SELECT); cs_orchestrator has INSERT.
  - `public.update_account_billing_profile(legal_name, gstin, state_code, address, email)` SECURITY DEFINER RPC. Restricted to `account_owner`. Validates legal_name length, GSTIN format, 2-digit Indian state code, address length, email format. Writes before/after JSON to `account_audit_log`.

### Tested
- [x] `tests/billing/customer-billing-profile-update.test.ts` — 8/8 PASS (happy path + audit row, cross-account isolation, empty GSTIN null-stored, all 5 validation failures)

## [ADR-0046 Phase 2 Sprint 2.1] — 2026-04-20

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 2, Sprint 2.1 (DPIA records schema + RPCs)

### Added
- `20260620000001_dpia_records.sql` — `public.dpia_records` table (org-scoped, RLS via `effective_org_role()` so account_owner inherits org_admin), indexes on (org_id, status, conducted_at) + next_review_at (for review-due queries).
- `public.create_dpia_record()`, `public.publish_dpia_record()`, `public.supersede_dpia_record()` — SECURITY DEFINER RPCs; write path restricted to `org_admin`/`admin` effective role.
- Rule 3 respected throughout: `data_categories` is a JSONB array of category strings (never raw values); `auditor_attestation_ref` is a text pointer to customer-held artefacts, not the artefact bytes.

### Tested
- [x] `tests/rls/dpia-records.test.ts` — 10/10 PASS (create happy path, cross-org create refused, RLS read isolation, publish lifecycle, re-publish guard, supersede with replacement, cross-org replacement refused)

## [ADR-0046 Phase 3] — 2026-04-20

**ADR:** ADR-0046 — Significant Data Fiduciary foundation
**Sprint:** Phase 3 — Data Auditor Engagements

### Added
- `20260620000002_data_auditor_engagements.sql` — `public.data_auditor_engagements` table + RLS via `effective_org_role`; 4 SECURITY DEFINER RPCs (create / complete / terminate / update). Registration category is a 6-value enum (ca_firm / sebi_registered / iso_27001_certified_cb / dpdp_empanelled / rbi_empanelled / other); Rule 3 respected — never PAN values or report bytes.

### Tested
- [x] `tests/rls/auditor-engagements.test.ts` — 11/11 PASS (create happy path, cross-org denied, RLS read isolation, complete lifecycle + end-before-start guard, terminate with reason, reason-required guard, update on active + terminated-frozen guard)

## [ADR-0029 follow-up — support sessions enrichment] — 2026-04-20

**ADR:** ADR-0029 — Admin organisations (customer follow-up)

### Added
- `20260620000003_enrich_support_sessions.sql` — `public.list_org_support_sessions(status, limit)` SECURITY DEFINER RPC that joins `admin.admin_users.display_name` into the customer-visible session list and computes `duration_seconds` server-side. Replaces direct queries to `public.org_support_sessions` view so customers see the operator's human-readable name instead of a raw UUID.

## [ADR-0057 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0057 — Customer-facing sectoral template switcher
**Sprint:** Phase 1, Sprint 1.1

### Added
- `20260620000004_update_org_industry.sql` — `public.update_org_industry(p_org_id, p_industry)` SECURITY DEFINER RPC. Role gate via `effective_org_role` (org_admin / admin). 8-value industry whitelist (saas / edtech / healthcare / ecommerce / hrtech / fintech / bfsi / general).

### Tested
- [x] `tests/rls/update-org-industry.test.ts` — 5/5 PASS (happy path, cross-org denied, invalid code rejected, null rejected, all 8 sectors accepted)

## [ADR-0048 follow-up — suspension gate on compliance writes] — 2026-04-20

**ADR:** ADR-0048 — Admin accounts panel (customer-side follow-up)

### Added
- `20260620000005_assert_org_not_suspended.sql` — `public.assert_org_not_suspended(p_org_id)` helper that raises `org_suspended` or `account_suspended` on caller attempts to advance compliance workflow while either is suspended. Wired into `create_dpia_record`, `publish_dpia_record`, and `create_auditor_engagement`. Non-gated intentionally: billing profile edits (customer needs to pay out), industry changes (harmless), team management (must keep working).

### Tested
- [x] `tests/rls/org-suspension-gate.test.ts` — 5/5 PASS (active happy path, org-suspended raises, account-suspended raises via cascade, both RPCs gated, post-restore recovery)

## [ADR-0051 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0051 — Billing evidence ledger

### Added
- `20260630000001_billing_evidence_ledger.sql` — `billing.evidence_ledger` append-only table (17-value event_type CHECK) + `billing.record_evidence_event()` helper + 3 triggers (audit_log / webhook_events / invoices) + `admin.billing_evidence_ledger_for_account()` read RPC (platform_operator+).
- `20260630000002_evidence_ledger_grant_fix.sql` — grant the read RPC to authenticated (admin sessions call via proxy).
- `20260630000003_fix_invoice_issued_trigger.sql` — trigger fires on issued_at null→ts UPDATE (billing_finalize_invoice_pdf path), not just INSERT.

### Tested
- [x] `tests/billing/evidence-ledger-triggers.test.ts` — 7/7 PASS (invoice_issued/emailed/voided, audit_log billing_* mapping, non-billing skip, platform_operator access, support denied)
- [x] `tests/billing/evidence-bundle.test.ts` — 10/10 PASS (2 new assertions for `evidence-ledger.ndjson`)

## [ADR-0051 Sprint 1.2] — 2026-04-20

**ADR:** ADR-0051 — Billing evidence ledger
**Sprint:** Sprint 1.2 — additional capture points

### Added
- `20260705000001_evidence_ledger_sprint_1_2.sql` — extended event_type + event_source CHECK enums; three new triggers (accounts INSERT / rights_requests email-verified transition / consent_banners is_active transition). Rule 3 preserved — requestor email/name never enter the ledger metadata.

### Tested
- [x] `tests/billing/evidence-ledger-sprint12.test.ts` — 4/4 PASS (customer_signup, rights_request_filed, banner_published on transition, no-fire on unrelated banner update)

## [ADR-0052 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0052 — Razorpay dispute contest submission

### Added
- `20260715000001_dispute_contest_fields.sql` — 4 new columns on `public.disputes` (`contest_summary`, `contest_packet_r2_key`, `contest_packet_prepared_at`, `contest_razorpay_response`); `admin.billing_dispute_prepare_contest` + `admin.billing_dispute_mark_contest_submitted` SECURITY DEFINER RPCs (platform_operator+).

### Tested
- [x] `tests/billing/dispute-contest.test.ts` — 9/9 PASS (no-bundle refusal, resolved-status refusal, summary length guard, support denied on both, packet-required for submit, manual vs auto response recording)

## [ADR-0053 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0053 — GSTR-1 JSON export

### Added
- `20260722000001_billing_gstr1_json.sql` — `admin.billing_gstr1_json(p_issuer_id, p_period_mmyyyy)` SECURITY DEFINER RPC. GSTN Offline-Utility v3.2 envelope: gstin / fp / version / b2b / b2cl / b2cs / hsn / doc_issue + empty cdnr/cdnur/exp/nil. Scope: operator → active issuer only; owner → any issuer. Audit-logged every call.
- `20260722000002_fix_gstr1_nested_agg.sql` — two-step CTE for B2B + B2CL (Postgres nested-aggregate fix).
- `20260722000003_fix_gstr1_b2cs_agg.sql` — two-step CTE for B2CS.

### Tested
- [x] `tests/billing/gstr1-json.test.ts` — 11/11 PASS (shape, B2B/B2CL/B2CS classification, HSN aggregation, void exclusion, doc_issue range, operator/owner scope, invalid period, support denied)

## [ADR-0055 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0055 — Account-scoped impersonation

### Added
- `20260725000001_account_scoped_impersonation.sql`:
  - `admin.impersonation_sessions.target_account_id` — nullable FK; `target_org_id` now nullable; `impersonation_target_scope_check` CHECK enforces exactly one is set.
  - New RPC `admin.start_impersonation_account(p_account_id, p_reason, p_reason_detail, p_duration_minutes)` — SECURITY DEFINER, `require_admin('support')`, mirrors the org-scoped RPC contract.
  - RLS: `impersonation_sessions_account_view` — account_owners can SELECT their account's account-scoped rows.
  - `public.list_org_support_sessions` — dropped + recreated with a new `target_scope` return column ('org' | 'account'). Now returns account-scoped sessions when the caller is an account_owner of the target account.

### Tested
- [x] `tests/billing/account-scoped-impersonation.test.ts` — 8/8 PASS (start happy path, support allowed, read_only denied, short reason rejected, invalid reason rejected, non-existent account rejected, CHECK constraint guards, target_scope surfacing)

## [ADR-0056 Sprint 1.1] — 2026-04-20

**ADR:** ADR-0056 — Per-account feature-flag targeting

### Added
- `20260730000001_account_scoped_feature_flags.sql`:
  - `admin.feature_flags.account_id` column + `feature_flags_scope_shape_check` (exactly one of account_id / org_id set per scope).
  - Unique index expanded to `(flag_key, scope, coalesce(account_id), coalesce(org_id))`.
  - `public.get_feature_flag` resolver — fallback order org → account → global.
  - `admin.set_feature_flag` + `admin.delete_feature_flag` — dropped & recreated with `p_account_id` parameter; full validation of scope/target shape.

### Tested
- [x] `tests/billing/account-feature-flags.test.ts` — 9/9 PASS (create, missing account_id guard, both-set guard, global-with-account guard, support denied, resolver org > account > global, delete)
