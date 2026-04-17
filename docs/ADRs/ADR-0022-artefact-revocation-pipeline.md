# ADR-0022: `process-artefact-revocation` Edge Function + Revocation Dispatch

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** In Progress
**Date proposed:** 2026-04-17
**Depends on:** ADR-0020 (DEPA schema — `artefact_revocations`, `consent_artefacts`, `purpose_connector_mappings`), ADR-0021 (Edge Function deploy convention — `--no-verify-jwt` with `sb_secret_*` Vault key), ADR-0004/0018 (rights-request dispatch pattern that already writes `deletion_receipts`).
**Unblocks:** ADR-0023 (rights-request full-erasure reuse of the same dispatcher), ADR-0025 (artefact-scoped chain-of-custody UI).

---

## Context

ADR-0020 created `artefact_revocations` as the canonical mechanism for revoking a consent artefact. Inserting a row fires `trg_artefact_revocation_cascade` (AFTER INSERT) which flips `consent_artefacts.status = 'revoked'`, removes the validity-index entry, marks `consent_expiry_queue` rows superseded, and writes an audit log entry — all inside the same transaction as the revocation INSERT. That's the **in-database cascade**.

The **out-of-database cascade** — instructing third-party connectors to actually delete the user's data — is missing. ADR-0022 wires it:

1. An AFTER INSERT trigger on `artefact_revocations` that fires `net.http_post()` to a new Edge Function (mirrors the ADR-0021 Q2 Option D pattern).
2. The Edge Function `process-artefact-revocation` which looks up `purpose_connector_mappings` for the revoked artefact's purpose, computes the data-scope intersection per connector, and inserts one `deletion_receipts` row per connector. The existing `deliver-consent-events`/rights-dispatcher pathway then delivers those receipts to the connectors.
3. A 5-minute `pg_cron` safety-net that catches trigger dispatch failures (same pattern as ADR-0021's safety-net).

### Decision locked — Option 2: no `deletion_requests` table

The current architecture docs (schema §11.3, §11.13; architecture §8.4) describe a two-table flow: `deletion_requests` (the instruction) → `deletion_receipts` (the proof). **No `deletion_requests` table exists in the codebase.** The live rights-request path (`app/src/lib/rights/deletion-dispatch.ts`) already writes directly to `deletion_receipts` with `status='pending'` and flips it to `status='confirmed'` when the customer's webhook callback returns. This is the spec/reality drift flagged during ADR-0022 planning.

Two options were weighed:

- **Option 1** — Add the missing `deletion_requests` table and migrate the existing rights code to the two-table shape. ~800 LOC of code churn, one migration, one breaking change to `/v1/deletion-receipts/{id}` callback URL semantics, and new tests across the rights flow.
- **Option 2** — Amend the docs to reflect `deletion_receipts` as the request+receipt hybrid. Add the DEPA-era fields (`artefact_id`, `data_scope`, `reason`) to the existing table via ALTER, and document it as "the receipt is the request before it is confirmed." Zero code churn on the rights path; revocation dispatcher writes to the same table with `trigger_type='consent_revoked'`.

**Option 2 is chosen.** The missing abstraction is not load-bearing — the two responsibilities are already disambiguated by `status` (`pending` → sent as request, `confirmed`/`failed` → final receipt). The `feedback_docs_vs_code_drift.md` memory captures the general rule: amend docs over restructuring code when the abstraction isn't load-bearing. Blast radius: zero code; a pure doc + migration delta.

### Edge Function data flow

```
POST /functions/v1/process-artefact-revocation
{ "artefact_id": "cs_art_...", "revocation_id": "uuid" }

1. Fetch artefact (org_id, purpose_definition_id, data_scope,
   session_fingerprint, status, replaced_by).
2. Guard: status must be 'revoked' (trg_artefact_revocation_cascade
   already ran). If 'active', return 409 — trigger ordering bug.
3. Guard: do NOT walk the replaced_by chain. Replaced artefacts stay
   frozen per S-5. A revocation on artefact A does not propagate to
   its successor A' — that needs a separate revocation row on A'.
4. Fetch purpose_connector_mappings WHERE
   purpose_definition_id = artefact.purpose_definition_id AND
   is_active = true.
5. For each mapping:
   a. Compute scoped_fields = intersection of mapping.data_fields
      with artefact.data_scope. Skip if empty.
   b. INSERT deletion_receipts (
        org_id, trigger_type='consent_revoked',
        trigger_id=<revocation_id>, connector_id=<mapping.connector_id>,
        target_system=<connector.target_system>,
        identifier_hash=<hash of session_fingerprint>,
        artefact_id=<artefact.artefact_id>,
        status='pending',
        request_payload={data_principal, data_scope=scoped_fields,
                         reason='consent_revoked',
                         callback_url, deadline}
      ) ON CONFLICT (trigger_id, connector_id)
        WHERE trigger_type = 'consent_revoked' DO NOTHING.
6. UPDATE artefact_revocations SET dispatched_at = now()
   WHERE id = <revocation_id> AND dispatched_at IS NULL.
7. Return 200 {dispatched: n, skipped: m}.
```

Dispatch of each pending `deletion_receipts` row to the connector webhook is **out of scope** for this ADR. The existing rights-dispatcher already handles that path; ADR-0023 will unify the two call sites.

### Test coverage — testing strategy §10 priority items

- **Test 10.4** — revocation cascade precision. Insert a `consent_events` row for a banner with two purposes (`analytics`, `marketing`). Wait for artefacts to land (ADR-0021 pipeline). Insert `artefact_revocations` for the `marketing` artefact. Verify: (a) the marketing artefact's `status='revoked'`; (b) the analytics artefact's `status='active'` — untouched; (c) one `deletion_receipts` row per connector mapped to `marketing`'s `purpose_definition_id`, scoped to the data_field intersection; (d) no receipts for `analytics` connectors.
- **Test 10.7** — replacement chain frozen on revocation. Create artefact A with purpose P. Re-consent: process-consent-event creates artefact A'; ADR-0020 logic marks A.status='replaced' and A'.replaced_from=A. Now revoke A directly. Verify: A.status stays `replaced` (NOT `revoked` — `trg_artefact_revocation_cascade` only flips `active` → `revoked`; the cascade trigger's `raise exception` on non-active should fire and roll back the revocation INSERT). Verify A'.status stays `active` and no deletion_receipts are written against A'. This confirms S-5: once frozen, always frozen.
- **Test 10.10** — artefact-scoped precision against siblings. Same org, two web properties, each with its own `marketing` artefact (different `purpose_definition_id` rows). Revoke property-1's marketing artefact. Verify only property-1's connectors get receipts; property-2's stay untouched.

---

## Decision

Ship the revocation dispatcher in a single sprint following the ADR-0021 template.

1. **Docs amendment sprint (1.1)** — remove the phantom `deletion_requests` table from schema §11.3/§11.13 and architecture §8.4. Move the `artefact_id` column and chain-of-custody description to reference `deletion_receipts` directly. Update the 4-link chain to the actual 3-link chain.
2. **Migration `20260420000001_depa_revocation_dispatch.sql`** (Sprint 1.2) — adds UNIQUE partial index on `deletion_receipts (trigger_id, connector_id) WHERE trigger_type = 'consent_revoked'`; adds `dispatched_at` column to `artefact_revocations`; creates `trg_artefact_revocation_dispatch` trigger (function already specced in §11.5 but not yet in any migration); creates `safety_net_process_artefact_revocations()`; schedules `artefact-revocations-dispatch-safety-net` pg_cron every 5 minutes.
3. **Edge Function `process-artefact-revocation`** (Sprint 1.3) — Deno function at `supabase/functions/process-artefact-revocation/index.ts`, deployed with `--no-verify-jwt` per ADR-0021.
4. **Tests** (Sprint 1.4) — `tests/depa/revocation-pipeline.test.ts` covering 10.4, 10.7, 10.10.

Idempotency enforced at **three layers** (same shape as ADR-0021):

- **Database** — `UNIQUE (trigger_id, connector_id) WHERE trigger_type = 'consent_revoked'` on `deletion_receipts`.
- **Edge Function** — `ON CONFLICT DO NOTHING` on every INSERT; fast-path skip when `artefact_revocations.dispatched_at` is non-null.
- **Cron** — safety-net only picks revocations with `dispatched_at IS NULL` and `created_at > now() - 24 hours`.

The Edge Function does **not** use advisory locks or explicit transactions. The UNIQUE constraint handles races; the guarded UPDATE on `dispatched_at` prevents the fast-path flag from flapping.

---

## Consequences

- **Every new `artefact_revocations` INSERT triggers an HTTP call** to the Edge Function. Trigger is fire-and-forget; revocation INSERT latency is unchanged. Failures in dispatch do NOT roll back the in-database cascade (status flip, index removal) — the cascade trigger runs first and commits with the revocation itself.
- **New UNIQUE partial index on `deletion_receipts`** adds an insert cost only for `consent_revoked` receipts. Existing `erasure_request` rows are unaffected (trigger_type filter in the WHERE clause).
- **`deletion_receipts.artefact_id` populated by the Edge Function** — previously nullable and unpopulated. Backfilling historical rights-request receipts is out of scope; new rights-request dispatches should also populate it (ADR-0023 follow-up).
- **No `deletion_requests` table is ever created.** The schema-design §11.3 ALTER block that was aimed at that table is deleted entirely. Chain-of-custody documentation rewrites from 4-link to 3-link: `consent_artefacts → artefact_revocations → deletion_receipts`.
- **pg_cron job `artefact-revocations-dispatch-safety-net` runs every 5 minutes** against dev. Can be unscheduled via `select cron.unschedule('artefact-revocations-dispatch-safety-net')`.
- **Test 10.7 assertion update**: the cascade trigger's `raise exception 'Cannot revoke artefact X: not found or not active'` is what enforces frozen-chain invariant. The test verifies both the exception (caught at the INSERT) and the absence of downstream deletion_receipts.
- **ADR-0023 (rights-request refactor) becomes simpler** — now has one dispatcher pattern (writes `deletion_receipts` with `trigger_type` differentiating the source). ADR-0023's scope can narrow to: factor shared logic into a helper, unify connector fan-out.

### Architecture Changes

- **Schema §11.3 loses the `deletion_requests` ALTER block** entirely. Nothing else in that section changes.
- **Schema §11.3 deletion_receipts ALTER block** — unchanged; the `artefact_id` column description already captures the hybrid role once §11.13 chain is rewritten.
- **Schema §11.13 chain-of-custody** rewrites from 4-link to 3-link. One sentence. One diagram box removed.
- **Architecture §8.4 "Deletion Orchestration"** rewrites the "scoped deletion requests" language to "scoped deletion receipts," updates the triggers table, rewrites the webhook callback URL template to pin on `{receipt_id}`, and rewrites the chain-of-custody paragraph.
- **`deliver-consent-events` Edge Function** unchanged — it reads `deletion_receipts` with `delivered_at IS NULL` and exports them. The new `consent_revoked` rows are exported by the same query.

---

## Implementation Plan

### Phase 1: Docs amendment + migration + Edge Function + tests

**Goal:** Inserting an `artefact_revocations` row fans out to exactly the right connector receipts with the right data-scope subsets; trigger and cron both produce the same outcome; frozen-chain invariant is preserved.

#### Sprint 1.1: Docs amendment

**Estimated effort:** 45 minutes.

**Deliverables:**

- [x] `docs/architecture/consentshield-complete-schema-design.md` §11.3 — phantom `deletion_requests` ALTER block deleted; `deletion_receipts.artefact_id` block rewritten with hybrid semantics + FK to `consent_artefacts(artefact_id) on delete set null`.
- [x] `docs/architecture/consentshield-complete-schema-design.md` §11.4.4 `artefact_revocations` table comment — `deletion_requests` → `deletion_receipts`.
- [x] `docs/architecture/consentshield-complete-schema-design.md` §11.5 `trigger_process_artefact_revocation()` comment — same substitution; idempotency contract documented inline.
- [x] `docs/architecture/consentshield-complete-schema-design.md` §11.13 — ALTER-vs-DROP matrix row for `deletion_requests` removed. "No legacy in the data model" paragraph no longer lists `deletion_requests`. 4-link chain rewrite lives in the `deletion_receipts.artefact_id` column comment (now 3-link).
- [x] `docs/architecture/consentshield-definitive-architecture.md` §7.x `process-artefact-revocation` entry rewritten. §8.4 "Deletion Orchestration" rewritten: scoping rule + triggers table + webhook callback URL + chain-of-custody paragraph. Single-table hybrid semantics documented explicitly.
- [x] `docs/architecture/consentshield-testing-strategy.md` §10 — revocation-drift failure mode, Test 10.4 assertion, and Test 10.10 expected outcomes updated to `deletion_receipts` + `trigger_type='consent_revoked'`.
- [ ] Append a `### Architecture Changes` note here once the Sprint 1.2 migration is applied.

**Status:** `[x] complete` — 2026-04-17

#### Sprint 1.2: Migration

**Estimated effort:** 30 minutes.

**Deliverables:**

- [x] `supabase/migrations/20260420000001_depa_revocation_dispatch.sql`:
  - `alter table artefact_revocations add column dispatched_at timestamptz;` + partial index `idx_revocations_pending_dispatch`.
  - `create unique index deletion_receipts_revocation_connector_uq on deletion_receipts (trigger_id, connector_id) where trigger_type = 'consent_revoked';`
  - `create or replace function trigger_process_artefact_revocation()` — Vault-backed URL + cs_orchestrator_key; EXCEPTION WHEN OTHERS swallowed.
  - `create trigger trg_artefact_revocation_dispatch after insert on artefact_revocations` — fires after `trg_artefact_revocation` cascade by name-alphabetic ordering.
  - `create or replace function safety_net_process_artefact_revocations()` — picks rows with `dispatched_at IS NULL`, `created_at` 5 min to 24 h old, 100-row batch.
  - `cron.schedule('artefact-revocations-dispatch-safety-net', '*/5 * * * *', ...)` guarded by `unschedule ... exception null`.
- [x] Apply: `bunx supabase db push --linked --include-all` — success on dev.
- [ ] Full verification queries A/B/C deferred to Sprint 1.4 test suite (integration tests exercise the trigger end-to-end).

**Status:** `[x] complete` — 2026-04-17

#### Sprint 1.3: Edge Function

**Estimated effort:** 2 hours.

**Deliverables:**

- [ ] `supabase/functions/process-artefact-revocation/index.ts` per the data-flow spec. Uses `createClient(SUPABASE_URL, CS_ORCHESTRATOR_ROLE_KEY)`. ~200 lines including the purpose_connector_mappings join and data-scope intersection logic.
- [ ] `callback_url` uses the same HMAC signature pattern as `app/src/lib/rights/callback-signing.ts` — import or re-derive; do not duplicate the secret logic in Deno.
- [ ] Deploy: `bunx supabase functions deploy process-artefact-revocation --no-verify-jwt`.
- [ ] Smoke: `curl` a fabricated `artefact_id` — expect 200 with `artefact_not_found` in the body, not a 500.

**Status:** `[ ] planned`

#### Sprint 1.4: Tests

**Estimated effort:** 2 hours.

**Deliverables:**

- [ ] `tests/depa/revocation-pipeline.test.ts` — Vitest suite implementing tests 10.4, 10.7, 10.10. Reuses `tests/rls/helpers.ts` fixtures and `tests/depa/helpers.ts` (from ADR-0021) if it helps.
- [ ] `tests/depa/revocation-pipeline.test.ts` test 10.7 note — the cascade trigger raises on non-active revocation. The test catches the DB error and asserts no receipts were written.

**Testing plan:**

- [ ] **Test 10.4 (PASS required)** — revocation cascade precision. Two-purpose banner, two artefacts created. Revoke one; verify `deletion_receipts` fan-out only to that purpose's connectors with scoped `data_scope` subsets.
- [ ] **Test 10.7 (PASS required)** — replacement-chain frozen. Re-consent creates replacement artefact; attempt to revoke the replaced (frozen) artefact; verify exception + no receipts + `trg_artefact_revocation_cascade` behaviour as specced.
- [ ] **Test 10.10 (PASS required)** — sibling artefacts untouched. Two properties in the same org; revoke one property's artefact; verify only that property's connectors get receipts.
- [ ] **Full test:rls suite** — `bun run test:rls` expected green. New test file adds ~3 tests to the 135 existing.
- [ ] **Customer regression** — `cd app && bun run test` still green.
- [ ] **Edge Function smoke** — manual curl with fabricated artefact_id returns 200 + `artefact_not_found`.
- [ ] **Cron verification** — `select jobname, schedule, active from cron.job where jobname = 'artefact-revocations-dispatch-safety-net'` → 1 row active.

**Status:** `[ ] planned`

---

## Test Results

### Sprint 1.4 — _pending_

_To be filled in when Sprint 1.4 completes._

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.2 entry: UNIQUE idempotency index on `deletion_receipts`, `dispatched_at` column on `artefact_revocations`, dispatch trigger + safety-net cron.
- `CHANGELOG-edge-functions.md` — Sprint 1.3 entry: `process-artefact-revocation` Edge Function added.
- `CHANGELOG-docs.md` — Sprint 1.1 entry: schema §11.3/§11.13 + architecture §8.4 amended to remove phantom `deletion_requests` table; chain-of-custody rewritten 4→3 links.
