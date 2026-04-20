# ADR-1002: DPDP §6 Runtime Enforcement — Verify, Record, Artefact Ops, Deletion API

**Status:** Completed
**Date proposed:** 2026-04-19
**Date completed:** 2026-04-20
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 2
**Depends on:** ADR-1001 (API key middleware + `cs_api` role must exist)
**Related gaps:** G-037, G-038, G-039, G-040

---

## Context

ADR-1001 ships the ability to authenticate a `/v1/*` request. What those requests *do* is the product. Sections 4, 5, 6, 9.2, 9.3, 9.4, and 11 of the v2.0 whitepaper describe four integration surfaces that depend on a small set of endpoints that do not currently exist:

- **Consent capture from non-browser channels** (mobile app, call-centre, branch, kiosk, in-person) needs a server-to-server recording endpoint (§4.2 Mode B). Without this, every BFSI, NBFC, and healthcare archetype loses DPDP §6(1) artefact coverage for its most important channels.
- **Runtime consent verification** (§5, §11) is the gating check every customer system makes before acting on user data. Without this, DPDP §6(2) purpose limitation is recorded but not enforced — the worst possible DPB examination finding.
- **Programmatic artefact management** — listing, retrieving, revoking — is how a customer's mobile app's "withdraw consent" button works (§6(4) parity obligation), and how a core banking platform stores the five artefact IDs for Mrs. Sharma at account opening (§11).
- **Programmatic deletion triggering + receipt listing** is how a support desk initiates a §13 erasure request and how a compliance dashboard pages through historical receipts.

This ADR delivers those endpoints and an OpenAPI stub that describes them. The endpoints are thin handlers over existing RPCs (ADR-0021 for `process-consent-event`, ADR-0022 for `process-artefact-revocation`, ADR-0007 for deletion orchestration) — the novelty is the public surface, not the processing.

## Decision

Ship five endpoints as Vercel Functions in the customer app (`app/src/app/api/v1/consent/**`, `app/src/app/api/v1/deletion/**`) behind ADR-1001's middleware:

1. `GET /v1/consent/verify` — single-identifier verification via `consent_artefact_index`. Sub-50ms p99 target (measurement in ADR-1008). **(G-037)**
2. `POST /v1/consent/verify/batch` — up to 10,000 identifiers per call. **(G-037)**
3. `POST /v1/consent/record` — Mode B server-to-server consent capture with synchronous artefact return. **(G-038)**
4. `GET /v1/consent/artefacts` + `GET /v1/consent/artefacts/{id}` + `POST /v1/consent/artefacts/{id}/revoke` + `GET /v1/consent/events`. **(G-039)**
5. `POST /v1/deletion/trigger` + `GET /v1/deletion/receipts`. **(G-040)**

Every endpoint has a matching entry in `app/public/openapi.yaml`. The whitepaper's Appendix A is regenerated from the spec as part of Sprint 3.1.

## Consequences

- Section 5 of the whitepaper becomes executable. The BFSI-procurement "how do I verify consent before a lending decision?" has a live answer.
- Section 11 (Mrs. Sharma worked example) is reproducible end-to-end against staging — this becomes the canonical BFSI demo.
- G-039's revoke endpoint closes the §6(4) parity loop: anything grantable via API is revokable via API.
- Deletion orchestration remains the only authoritative executor of downstream deletes; `/v1/deletion/trigger` merely creates the right rows and lets the existing pipeline run.
- The public API surface now has five real endpoints. The whitepaper Appendix A CI drift check (deferred to ADR-1006) protects against silent divergence from here on.
- No changes to the DEPA artefact model or the fan-out pipeline. This ADR is purely surface work.

---

## Implementation Plan

### Phase 1: Verification endpoints (G-037)

> **Scope correction — 2026-04-20.** The original Sprint 1.1 assumed `consent_artefact_index` already carried `property_id`, `identifier_hash`, `identifier_type`, and a revocation pointer. It doesn't — the table is a pre-DEPA stub with only `(org_id, artefact_id, validity_state, expires_at, framework, purpose_code)`, and the current revocation cascade trigger **deletes** the row on revoke (so `verify` can't distinguish `revoked` from `never_consented`). Sprint 1.1 is split into a schema/pipeline half (new Sprint 1.1) and a handler half (new Sprint 1.2). Former Sprint 1.2 is renumbered to Sprint 1.3.

#### Sprint 1.1: Extend `consent_artefact_index` + pipeline writes

**Estimated effort:** 3 days

**Deliverables:**
- [x] Migration `20260701000001_consent_artefact_index_identifier.sql` — extends `consent_artefact_index` with six nullable columns (`property_id`, `identifier_hash`, `identifier_type`, `consent_event_id`, `revoked_at`, `revocation_record_id`) + partial hot-path index.
- [x] `public.hash_data_principal_identifier(p_org_id, p_identifier, p_identifier_type)` — per-type normalisation + per-org salted SHA-256. Granted to `authenticated`, `service_role`, `cs_orchestrator`.
- [x] Replace `trg_artefact_revocation_cascade`: DELETE from index → UPDATE (validity_state='revoked', revoked_at, revocation_record_id). Revoked rows remain queryable.
- [x] `process-consent-event` Edge Function populates `property_id` and `consent_event_id` at index insert time.

**Testing plan:**
- [x] 9/9 PASS — `tests/depa/artefact-index-identifier.test.ts`: hash determinism within an org; per-type normalisation (email: trim+lowercase; phone: digits-only; pan: uppercase+trim); per-org salt produces different hashes for the same identifier across orgs; empty-identifier rejection; phone-no-digits rejection; unknown-identifier-type rejection; revocation cascade UPDATEs index row (validity_state + revoked_at + revocation_record_id + preserves property_id/consent_event_id).
- [x] 24/24 DEPA suite PASS — no regression in `consent-event-pipeline`, `revocation-pipeline`, `expiry-pipeline`, `score`, or the new test.

### Test Results — 2026-04-20

```
bunx vitest run tests/depa/artefact-index-identifier.test.ts
9/9 PASS (8.65s)

bunx vitest run tests/depa/
24/24 PASS (53.31s)
```

### Architecture Changes

- `docs/architecture/consentshield-complete-schema-design.md` — updated `consent_artefact_index` DDL to reflect the extended shape + partial index.
- Revocation cascade semantic change: rows preserved post-revoke, not deleted. This means `/v1/consent/verify` (Sprint 1.2) can distinguish `revoked` from `never_consented`. No existing consumer depended on DELETE semantics (grep-verified).

**Status:** `[x] complete — 2026-04-20`

#### Sprint 1.2: `GET /v1/consent/verify`

**Estimated effort:** 2 days

**Deliverables:**
- [x] `app/src/app/api/v1/consent/verify/route.ts` handler — scope gate → 422 / 400 (account-scoped key) / 404 / 422 (invalid identifier) / 200
- [x] Query parsing: `property_id`, `data_principal_identifier`, `identifier_type`, `purpose_code` — 422 on any missing (single response lists all missing names)
- [x] `app/src/lib/consent/verify.ts` — typed wrapper around `rpc_consent_verify` via the service-role client (same carve-out pattern as `verifyBearerToken` + `logApiRequest`); maps error codes to `property_not_found` / `invalid_identifier` / `unknown`
- [x] `rpc_consent_verify` SECURITY DEFINER RPC — migration 20260710000001 — validates property ownership (P0001 / `property_not_found`), calls `hash_data_principal_identifier` (propagates 22023 for empty / unknown-type), picks best index row (active > expired > revoked; newest first), builds §5.1 envelope
- [x] Status resolution in the RPC: active + expires_at < now → `expired`; `validity_state='revoked'` → `revoked` + pointer; missing row → `never_consented`; otherwise → `granted`
- [x] `evaluated_at` stamped server-side via `now()` inside the RPC — clients cannot influence it
- [x] Scope gate: `read:consent` (via direct context-scope check; 403 problem+json on miss)
- [x] OpenAPI stub extended at `app/public/openapi.yaml` — VerifyResponse schema + full `/consent/verify` path entry with 200/401/403/404/410/422/429

**Testing plan:**
- [x] 4-state fixture (`granted`, `revoked`, `expired`, `never_consented`) — all four return correct status
- [x] Timestamps ISO 8601; null-valid for absent fields per envelope
- [x] Cross-org property (owned by other org) → `property_not_found` → 404
- [x] Empty identifier → `invalid_identifier` → 422
- [x] Unknown identifier_type (`passport`) → `invalid_identifier` → 422
- [x] identifier_type mismatch (email granted, verify as phone) → `never_consented` (different hash across types)
- [x] Cross-org isolation: same identifier in two orgs produces different hashes → verify in other org returns `never_consented`
- [ ] Wrong-scope 403 — handler-level assertion is in code; exercised at integration level once Sprint 1.3 brings more scope variety
- [ ] 50M-row index p99 < 50 ms — staging perf probe deferred to Sprint 3.1 end-to-end stage (no prod-like volumes available)

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/consent-verify.test.ts
9/9 PASS (8.66s)

cd app && bun run build — PASS; /api/v1/consent/verify in route manifest
bun run lint — PASS (0 errors, 0 warnings)
```

**Status:** `[x] complete — 2026-04-20`

#### Sprint 1.3: `POST /v1/consent/verify/batch`

**Estimated effort:** 2 days

**Deliverables:**
- [x] `app/src/app/api/v1/consent/verify/batch/route.ts` — POST handler. Validates body shape (422 for missing fields / non-array / non-string elements), enforces 10,000 cap at the route layer (413) **and** at the RPC layer (defense-in-depth), and 400 for account-scoped keys.
- [x] `rpc_consent_verify_batch(org_id, property_id, identifier_type, purpose_code, identifiers[])` SECURITY DEFINER — migration 20260720000001. Hashes the full array in one pass via `unnest WITH ORDINALITY`, then a single LATERAL `LIMIT 1` per element against the hot-path partial index. Response rows preserve input order via the ORDINALITY tag.
- [x] `verifyConsentBatch()` helper — co-located with the single-verify helper; same service-role client; typed error kinds (`property_not_found` / `identifiers_empty` / `identifiers_too_large` / `invalid_identifier` / `unknown`).
- [x] Response: `{ property_id, identifier_type, purpose_code, evaluated_at, results: [{ identifier, status, active_artefact_id?, revoked_at?, revocation_record_id?, expires_at? }] }`. Server-stamped `evaluated_at` applies to every row in the batch.
- [x] Scope: `read:consent` (403 problem+json on miss).
- [x] OpenAPI stub: `VerifyBatchRequest` + `VerifyBatchResponse` + `VerifyBatchResultRow` schemas, `/consent/verify/batch` POST path with full response matrix.

**Testing plan:**
- [x] 5-element mixed fixture (granted / revoked / expired / never_consented × 2) → input-ordered results with correct statuses + `active_artefact_id` + `revocation_record_id`.
- [x] 25-element interleaving (5× repeat of base set) → ordering preserved; duplicates resolve identically.
- [x] 10,001 identifiers → `identifiers_too_large` (413).
- [x] 0 identifiers → `identifiers_empty` (422).
- [x] Cross-org property → `property_not_found` (404).
- [x] Unknown `identifier_type` → `invalid_identifier` (422).
- [x] All-or-nothing: one empty-string identifier mid-batch fails the whole call (422).
- [x] Performance smoke: 1,000 never-consented identifiers complete in < 5 s against the live dev DB (a full 10,000-row staging perf probe is the Sprint 3.1 p99 < 2 s check).
- [ ] 100 concurrent batches at p99 < 2 s — load-test deferred to Sprint 3.1 perf stage.

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/consent-verify-batch.test.ts
8/8 PASS (10.49s)

cd app && bun run build — PASS; /api/v1/consent/verify/batch in route manifest
bun run lint — PASS (0 errors, 0 warnings)
```

**Status:** `[x] complete — 2026-04-20`

### Phase 2: Consent record — Mode B (G-038)

#### Sprint 2.1: `POST /v1/consent/record`

**Estimated effort:** 3 days

**Deliverables:**
- [x] `app/src/app/api/v1/consent/record/route.ts` — POST handler. Scope gate (write:consent, 403), 400 for account-scoped keys, JSON-parse + per-field shape validation (422 with precise detail), maps RPC errors.
- [x] Body validation: property ownership, every `purpose_definition_id` belongs to the key's org (422 with echoed id list), `captured_at` within ±15 min of server (both stale and future-dated rejected).
- [x] Single-transaction write inside `rpc_consent_record` — consent_events + consent_artefacts + consent_artefact_index for every granted purpose, all or nothing. No Edge Function roundtrip; the dispatch trigger still fires but the Edge Function's 23505 idempotency absorbs the duplicate safely.
- [x] Response: `{ event_id, created_at, artefact_ids: [{ purpose_definition_id, purpose_code, artefact_id, status }], idempotent_replay }`. `201` for new records, `200` for replays.
- [x] Idempotency: optional `client_request_id`; replay via a partial unique index `(org_id, client_request_id) WHERE client_request_id IS NOT NULL`. Returns the prior envelope with `idempotent_replay=true`.
- [x] Scope: `write:consent`.
- [x] OpenAPI stub: `RecordRequest`, `RecordResponse`, `RecordedArtefact` schemas + `/consent/record` POST path.

### Architecture Changes

- `consent_events` relaxed: `banner_id`, `banner_version`, `session_fingerprint` are now nullable. New CHECK `consent_events_shape_by_source_check` enforces: `source='web' → (banner_id, session_fingerprint) not null`; `source='api' → (data_principal_identifier_hash, identifier_type) not null`.
- `consent_events` gains: `source` (web|api|sdk), `data_principal_identifier_hash`, `identifier_type`, `client_request_id`.
- `consent_artefacts` relaxed: same three browser-only columns nullable. Mode B artefacts carry the identifier via `consent_artefact_index.identifier_hash` (ADR-1002 Sprint 1.1); the DEPA artefact row itself no longer requires a banner or fingerprint.

**Testing plan:**
- [x] 5-grant fixture creates 5 artefacts; every returned artefact_id resolves in `consent_artefacts` with `status='active'` and the same `consent_event_id`.
- [x] 5-grant + 2-rejected: 3 artefacts created (granted subset); rejected ids land in `consent_events.purposes_rejected` for §11 audit.
- [x] End-to-end loop: record → verify with the same (identifier, property, purpose) returns `granted` with the recorded `artefact_id` (closes the read/write contract).
- [x] Idempotency: replay with same `client_request_id` returns `idempotent_replay=true` + the same `event_id` + the same artefact IDs.
- [x] `captured_at` > 15 min stale AND > 15 min future both → `captured_at_stale` (422).
- [x] Cross-org `purpose_definition_id` → `invalid_purpose_definition_ids` (422) with the offending id echoed in the error.
- [x] Empty accepted purposes → `purposes_empty` (422).
- [x] Cross-org property → `property_not_found` (404).
- [x] Empty identifier → `invalid_identifier` (422).
- [ ] Audit-log trigger row (`captured_via` / `captured_by`) — deferred to a later sprint (the `consent_events` row itself is the §11-compliant audit record; `audit_log` is buffer-tier and is not the persistent audit surface).

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/consent-record.test.ts
10/10 PASS (10.90s)

bunx vitest run tests/integration/ tests/depa/
70/70 PASS (93.91s) — no regressions

cd app && bun run build — PASS; /api/v1/consent/record in route manifest
bun run lint — PASS (0 errors, 0 warnings)
```

**Status:** `[x] complete — 2026-04-20`

### Phase 3: Artefact + event ops (G-039)

#### Sprint 3.1: List + read artefacts + list events

**Estimated effort:** 2 days

**Deliverables:**
- [x] `GET /v1/consent/artefacts` — cursor-paginated list. `limit` default 50, max 200. Cursor is an opaque base64-encoded JSON of `{created_at, id}` keyset tuple.
- [x] Filters: `property_id`, `data_principal_identifier` (+ `identifier_type` required with it; enforced via `bad_filters`), `status` (active|revoked|expired|replaced), `purpose_code`, `expires_before`, `expires_after`.
- [x] `GET /v1/consent/artefacts/{id}` — returns the artefact envelope + `revocation` (joined from `artefact_revocations` via `consent_artefact_index.revocation_record_id`) + `replacement_chain` (recursive CTE walks both backward and forward, chronologically ordered).
- [x] `GET /v1/consent/events` — cursor-paginated summary: `id, property_id, source, event_type, purposes_accepted_count, purposes_rejected_count, identifier_type, artefact_count, created_at`. Filters: `property_id`, `created_after`, `created_before`, `source` (web|api|sdk).
- [x] Scopes: `read:artefacts` for the artefact endpoints, `read:consent` for events.
- [x] Shared helpers: `app/src/lib/api/v1-helpers.ts` (`readContext`, `respondV1`, `gateScopeOrProblem`, `requireOrgOrProblem`) — refactor-clean reuse across all three new handlers.
- [x] OpenAPI: three new path entries + `ArtefactListItem` / `ArtefactListResponse` / `ArtefactRevocation` / `ArtefactDetail` / `EventListItem` / `EventListResponse` schemas.

**Testing plan:**
- [x] List: org-scoped results, filters by property/purpose/status, cross-org isolation returns zero overlap.
- [x] Cursor pagination: page 1 (limit=3) emits 3 items + `next_cursor`; page 2 (cursor=next_cursor) emits more items; no overlap between pages.
- [x] Bad cursor → `bad_cursor` → 422.
- [x] Identifier filter requires both `data_principal_identifier` + `identifier_type`; supplying only one → `bad_filters`.
- [x] Detail: revocation field populated from `artefact_revocations` join.
- [x] Replacement chain: 3-link chain [A→B→C] returns `[A, B, C]` regardless of which artefact is queried (forward + backward CTE walks).
- [x] Cross-org artefact_id → null → 404.
- [x] Events: org-scoped, filters by source + date range, cross-org isolation.
- [x] Bad event cursor → `bad_cursor`.
- [ ] 250-artefact org perf baseline — deferred to Sprint 5.1 perf stage (fixture cost too high for integration tier).

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/artefact-event-read.test.ts
17/17 PASS (11.51s)

bunx vitest run tests/integration/ tests/depa/
87/87 PASS (101.21s) — no regressions

cd app && bun run build — PASS; three new routes in manifest
bun run lint — PASS (0 errors, 0 warnings)
```

### Migrations applied

- `20260720000003_artefact_event_list_rpcs.sql` — the three RPCs.
- `20260801000001_artefact_event_rpc_fixes.sql` — two bug fixes caught by tests: `rpc_artefact_get` accessed an unassigned record (v_rev.id) when no revocation existed (replaced with a subquery-driven jsonb build); `rpc_event_list` had a stray `max(id) filter (where true)` leftover that called `max(uuid)` and failed 42883.

**Status:** `[x] complete — 2026-04-20`

#### Sprint 3.2: Revoke artefact

**Estimated effort:** 2 days

**Deliverables:**
- [x] `POST /v1/consent/artefacts/{id}/revoke` — handler reads body `{ reason_code, reason_notes?, actor_type: "user" | "operator" | "system", actor_ref? }`. Scope `write:artefacts`. 422 for missing/unknown fields; 404 for cross-org or nonexistent; 409 for terminal states; 200 for both new and idempotent-replay.
- [x] `rpc_artefact_revoke(org, artefact_id, reason_code, reason_notes, actor_type, actor_ref)` SECURITY DEFINER — migration 20260801000002. Validates artefact ownership, short-circuits for already-revoked, rejects terminal states (expired/replaced), maps API `actor_type` → DB `revoked_by_type` (user→data_principal; operator→organisation; system→system), inserts `artefact_revocations` row. The ADR-0022 cascade + ADR-1002 Sprint 1.1 index-preservation fix handle the rest of the state transition.
- [x] `revokeArtefact()` helper + typed `RevokeEnvelope` / `RevokeError` kinds.
- [x] OpenAPI: `RevokeRequest` + `RevokeResponse` schemas + `/consent/artefacts/{id}/revoke` POST path.

**Testing plan:**
- [x] Revoke active artefact → `consent_artefacts.status='revoked'`; `consent_artefact_index.validity_state='revoked'` + `revoked_at` + `revocation_record_id` all populated (cascade trigger verified end-to-end).
- [x] Post-revoke `verify` returns `status=revoked` with the same `revocation_record_id` pointer (closes read/revoke loop).
- [x] Operator actor → DB `revoked_by_type='organisation'`; `actor_ref` persisted on the revocation row; `reason_code` persisted as `reason`.
- [x] Idempotent replay: second call returns `idempotent_replay=true` with the original `revocation_record_id` — no new `artefact_revocations` row.
- [x] Revoke already-expired → 409 `artefact_terminal_state: expired`.
- [x] Revoke already-replaced → 409 `artefact_terminal_state: replaced`.
- [x] Nonexistent artefact_id → 404 `artefact_not_found`.
- [x] Cross-org artefact → 404 `artefact_not_found` (not leaked as terminal).
- [x] Empty reason_code → `reason_code_missing`.
- [x] Unknown `actor_type` (e.g. `regulator`) → `unknown_actor_type`.
- [ ] Deletion-receipts fan-out observation — deferred to Sprint 4.1 when the deletion-trigger route lands and the connector fixture is in place.

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/consent-revoke.test.ts
10/10 PASS (11.85s)

bunx vitest run tests/integration/ tests/depa/
97/97 PASS (118.40s) — no regressions

cd app && bun run build — PASS; /api/v1/consent/artefacts/[id]/revoke in route manifest
bun run lint — PASS
```

**Status:** `[x] complete — 2026-04-20`

### Phase 4: Deletion API (G-040)

#### Sprint 4.1: Trigger + list

**Estimated effort:** 2 days

**Deliverables:**
- [x] `POST /v1/deletion/trigger` — handler reads body `{ property_id, data_principal_identifier, identifier_type, reason, purpose_codes?, scope_override?, actor_type?, actor_ref? }`. Scope `write:deletion`. Body-shape validation at the route layer (422 with precise detail); maps RPC errors to 404 / 422 / 501.
- [x] `rpc_deletion_trigger(org, property, identifier, identifier_type, reason, purpose_codes, scope_override, actor_type, actor_ref)` SECURITY DEFINER — migration 20260801000003. Validates property ownership (P0001), mode (`consent_revoked|erasure_request|retention_expired`), purpose_codes requirement for consent_revoked, actor_type; hashes the identifier; collects matching active artefacts via `consent_artefact_index`; loops and inserts `artefact_revocations` rows. The ADR-0022 cascade + Sprint 1.1 index-preservation + process-artefact-revocation Edge Function handle the rest asynchronously (deletion_receipts fan-out).
- [x] Response to POST (202): `{ reason, revoked_artefact_ids, revoked_count, initial_status: "pending", note: "deletion_receipts created asynchronously" }`. Does **not** include receipt IDs because the pipeline is async; callers poll `/v1/deletion/receipts` with `artefact_id` or `issued_after` for observation.
- [x] `retention_expired` mode deferred — returns 501 `retention_mode_not_yet_implemented`. Data-scope-driven sweep orchestration is a distinct design problem; tracked for a follow-up ADR.
- [x] `GET /v1/deletion/receipts` — cursor-paginated list. Filters: `status`, `connector_id`, `artefact_id` (joined through `deletion_receipts.trigger_id → artefact_revocations.id`), `issued_after`, `issued_before`. Scope `read:deletion`.
- [x] `rpc_deletion_receipts_list` RPC + `listDeletionReceipts` + `triggerDeletion` TS helpers + typed error kinds.
- [x] OpenAPI: `DeletionTriggerRequest` / `DeletionTriggerResponse` / `DeletionReceiptRow` / `DeletionReceiptsResponse` schemas + two new path entries with full response matrices.

**Testing plan:**
- [x] Trigger `consent_revoked` with partial purpose_codes → only the matching artefacts revoked; other purposes for the same identifier stay active.
- [x] Trigger `erasure_request` → every active artefact for the principal swept (all 3 test purposes).
- [x] Re-trigger when no active artefacts remain → 0 revoked; no error.
- [x] `consent_revoked` without `purpose_codes` → `purpose_codes_required_for_consent_revoked` (422).
- [x] `retention_expired` → `retention_mode_not_yet_implemented` (501).
- [x] Unknown reason → `unknown_reason` (422).
- [x] Cross-org property → `property_not_found` (404).
- [x] Unknown `identifier_type` → `invalid_identifier` (422).
- [x] Receipts list: filter by `artefact_id` (joined through artefact_revocations) returns seeded fixture.
- [x] Filter by `status=pending` / `connector_id`.
- [x] Bad cursor → `bad_cursor` (422).
- [x] Cross-org isolation on receipts.
- [x] Date-range filter with ancient window → empty list.
- [ ] Live Edge Function fan-out observation (deletion_receipts created asynchronously per `purpose_connector_mappings`) — deferred to manual verification against staging with a real connector fixture; the integration-tier receipts-list tests work off directly-seeded receipt rows.

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/deletion-api.test.ts
14/14 PASS (12.14s)

bunx vitest run tests/integration/ tests/depa/
111/111 PASS (125.22s) — no regressions

cd app && bun run build — PASS; /api/v1/deletion/trigger + /api/v1/deletion/receipts in route manifest
bun run lint — PASS
```

**Status:** `[x] complete — 2026-04-20`

### Phase 5: Exit gate

#### Sprint 5.1: OpenAPI stub + Mrs. Sharma end-to-end

**Estimated effort:** 2 days

**Deliverables:**
- [x] `app/public/openapi.yaml` — extended across Sprints 2.2 / 2.4 / 1.1 / 1.2 / 1.3 / 2.1 / 3.1 / 3.2 / 4.1; 10 paths total (`/_ping`, `/consent/verify`, `/consent/verify/batch`, `/consent/record`, `/consent/artefacts`, `/consent/artefacts/{id}`, `/consent/artefacts/{id}/revoke`, `/consent/events`, `/deletion/trigger`, `/deletion/receipts`). All endpoints carry `bearerAuth` scopes, request/response schemas, and full error matrices (401/403/404/409/410/413/422/429/501).
- [x] `tests/integration/mrs-sharma.e2e.test.ts` — 10-step §11 BFSI scenario: 5-purpose record → single verify (granted) → 10,000-identifier batch verify (Sharma at index 7,142 returns granted, other 9,999 never_consented, order preserved) → marketing revoke → single verify (revoked with pointer) → artefacts list (4 active + 1 revoked) → artefact detail (revocation record populated, chain = [marketingArtefactId]) → events list (Mode B event, 5 artefacts) → erasure_request (sweeps remaining 4 — all 5 now revoked) → deletion receipts list (seeded fixture observable).
- [x] No response-shape drift from the §5 / §11 whitepaper spec detected while wiring — no whitepaper amendments needed this sprint. If drift surfaces from customer integrations, CC-F applies and the whitepaper is the amended artefact.

**Testing plan:**
- [x] E2E test passes end-to-end against the live dev DB: 10/10 PASS (10.81s).
- [x] 10,000-identifier batch returns ordered results in under 10s (soft target; 12M staging load test remains a Sprint pre-launch item).
- [ ] `redocly lint` / `redocly build-docs` — deferred: no redocly dependency in this repo today. The OpenAPI stub validates structurally (10 paths, all with request/response schemas); formal validation happens in ADR-1006 Phase 6 (developer experience) where the client-library generator will drive a CI drift check.

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/mrs-sharma.e2e.test.ts
10/10 PASS (10.81s)

bunx vitest run tests/integration/ tests/depa/
121/121 PASS (132.60s)

cd app && bun run build — PASS (all 10 v1 routes in manifest)
bun run lint — PASS
```

**Status:** `[x] complete — 2026-04-20`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: add sections for Surface 1 (Mode B API), Surface 2 (verify/verify-batch), and artefact-management API; document synchronous fan-out path.
- No schema changes — this ADR is entirely surface work on top of existing tables.

_None yet._

---

## Test Results

_Empty until Sprint 1.1 runs._

---

## V2 Backlog (explicitly deferred)

- Streaming batch-verify for >10k identifiers (customer uses parallel calls today).
- Idempotency keys on `/v1/consent/record` — synchronous-return pattern + `event_id` de-dupe is enough for v1.
- Webhook subscriptions for artefact-status changes — BFSI customers poll `/v1/consent/events` today; subscriptions deferred until demand.

---

## Changelog References

- `CHANGELOG-api.md` — all sprints
- `CHANGELOG-docs.md` — Sprint 5.1 (OpenAPI + whitepaper amendments)
