# Attribution note — 2026-04-20/21

Terminals A and B shared a working tree through the ADR-1009 Phase 1 rollout. Three commits have scrambled attribution but intact content; leaving them as-is to avoid untangling work that later commits build on:

| Commit | Labelled as | Actually contains |
|--------|-------------|-------------------|
| `3823a45` | `feat(ADR-0501): phase 3 sprint 3.2 — legal downloads pipeline` | ADR-0501 marketing-site legal downloads **plus** ADR-1009 Sprint 1.1 file set (migration + helpers + routes + tests + ADR + changelogs) |
| `9fddd0f` | `docs(ADR-1009): attribution — Sprint 1.1 content is in commit 3823a45` | Pure marketing files (was meant to be empty — picked up a concurrent stage) |
| `4a95a96` | `feat(ADR-1009): sprint 1.2 — DB tenant fence on v1 read RPCs` | ADR-1009 Sprint 1.2 **plus** four marketing files (ADR-0501 contact form + env isolation) |

Going forward: Terminal A moves to a new sibling tree; collisions end here. Both terminals should continue avoiding `git add -A` / `git add .` even in single-tree mode.

---

# Session Handoff — 2026-04-20 (Terminal B — customer-app public API)

Terminal B shipped **ADR-1001 close-out** (Sprints 2.3 / 2.4 / 3.1) and **ADR-1002 complete** (Sprints 1.1 / 1.2 / 1.3 / 2.1 / 3.1 / 3.2 / 4.1 / 5.1) in one session. 10 public `/v1/*` endpoints now live with 92 new integration tests. Full integration + DEPA suite: 121/121 PASS.

Terminal A (concurrent, admin-app track) closed ADR-0046 Phases 2–4, ADR-0051, 0052, 0053, 0055, 0056, 0057, 0054, plus 0048/0029 follow-ups. See Terminal A's own handoff for that surface.

**Final commit of this session:** `e0d5ceb` — ADR-1002 Sprint 5.1 + ADR-1002 COMPLETED.

---

## Files modified / created this session

### Migrations (13 applied to remote dev DB)

| File | What changed |
|------|-------------|
| `supabase/migrations/20260601000001_api_request_log.sql` | Sprint 2.4: `api_rate_limit_per_hour` + `api_burst` on `public.plans`; `rpc_api_request_log_insert` + `rpc_api_key_usage` RPCs. |
| `supabase/migrations/20260701000001_consent_artefact_index_identifier.sql` | Sprint 1.1: `consent_artefact_index` += 6 nullable cols (property_id, identifier_hash, identifier_type, consent_event_id, revoked_at, revocation_record_id) + partial hot-path index + `hash_data_principal_identifier()` + replaced `trg_artefact_revocation_cascade` (DELETE → UPDATE). |
| `supabase/migrations/20260710000001_rpc_consent_verify.sql` | Sprint 1.2: `rpc_consent_verify` SECURITY DEFINER (single-identifier verification). |
| `supabase/migrations/20260720000001_rpc_consent_verify_batch.sql` | Sprint 1.3: `rpc_consent_verify_batch` (up to 10k identifiers, `unnest WITH ORDINALITY` preserves order). |
| `supabase/migrations/20260720000002_consent_record_columns.sql` | Sprint 2.1: `consent_events` relaxed (banner_id/banner_version/session_fingerprint nullable); adds `source`, `data_principal_identifier_hash`, `identifier_type`, `client_request_id` + shape CHECK + idempotency unique index; same nullability changes on `consent_artefacts`; `rpc_consent_record` all-in-one transaction. |
| `supabase/migrations/20260720000003_artefact_event_list_rpcs.sql` | Sprint 3.1: `rpc_artefact_list` / `rpc_artefact_get` / `rpc_event_list` — keyset cursor pagination + replacement-chain CTE. |
| `supabase/migrations/20260801000001_artefact_event_rpc_fixes.sql` | Sprint 3.1 follow-up: fixes `record is not assigned yet` (55000) in `rpc_artefact_get` and `max(uuid) does not exist` (42883) in `rpc_event_list`. Caught by tests. |
| `supabase/migrations/20260801000002_rpc_artefact_revoke.sql` | Sprint 3.2: `rpc_artefact_revoke` with idempotent already-revoked + terminal-state (expired/replaced) guards. |
| `supabase/migrations/20260801000003_rpc_deletion.sql` | Sprint 4.1: `rpc_deletion_trigger` (consent_revoked / erasure_request; retention_expired deferred → 501) + `rpc_deletion_receipts_list`. |

### Customer app — routes

| File | What it does |
|------|-------------|
| `app/src/app/(dashboard)/dashboard/settings/api-keys/page.tsx` | Sprint 2.3: API keys panel (account_owner only); locked card for other roles. |
| `app/src/app/(dashboard)/dashboard/settings/api-keys/api-keys-panel.tsx` | Sprint 2.3: client component — table, create/rotate/revoke modals, plaintext-reveal modal (shown once). |
| `app/src/app/(dashboard)/dashboard/settings/api-keys/actions.ts` | Sprint 2.3: server actions (createApiKey / rotateApiKey / revokeApiKey). |
| `app/src/app/(dashboard)/dashboard/settings/api-keys/[id]/usage/page.tsx` | Sprint 2.4: per-key usage chart (7-day SVG bar + p50/p95 table). |
| `app/src/components/dashboard-nav.tsx` | Sprint 2.3: nav entry "API keys" added. |
| `app/src/app/api/v1/_ping/route.ts` | Sprint 2.4: reads `x-cs-t` and calls `logApiRequest`. |
| `app/src/app/api/v1/consent/verify/route.ts` | Sprint 1.2: GET — single-identifier verification. |
| `app/src/app/api/v1/consent/verify/batch/route.ts` | Sprint 1.3: POST — batch verify (≤10k). |
| `app/src/app/api/v1/consent/record/route.ts` | Sprint 2.1: POST — Mode B record. |
| `app/src/app/api/v1/consent/artefacts/route.ts` | Sprint 3.1: GET — list (cursor-paginated, 7 filters). |
| `app/src/app/api/v1/consent/artefacts/[id]/route.ts` | Sprint 3.1: GET — detail + revocation + replacement chain. |
| `app/src/app/api/v1/consent/artefacts/[id]/revoke/route.ts` | Sprint 3.2: POST — revoke. |
| `app/src/app/api/v1/consent/events/route.ts` | Sprint 3.1: GET — event summary list. |
| `app/src/app/api/v1/deletion/trigger/route.ts` | Sprint 4.1: POST — erasure_request / consent_revoked trigger. |
| `app/src/app/api/v1/deletion/receipts/route.ts` | Sprint 4.1: GET — receipts list. |

### Customer app — lib helpers

| File | Purpose |
|------|---------|
| `app/src/proxy.ts` | Sprint 2.4: added `checkRateLimit('api_key:<key_id>', perHour, 60)` after Bearer verify; 429 + `Retry-After` + `X-RateLimit-Limit`; injects `x-cs-t` (epoch ms) for latency tracking. |
| `app/src/lib/api/context.ts` | Sprint 2.4: added `requestStart: 'x-cs-t'` to `API_HDR`. |
| `app/src/lib/api/rate-limits.ts` | Sprint 2.4: static tier→limits map (mirror of `public.plans.api_rate_limit_per_hour`). |
| `app/src/lib/api/log-request.ts` | Sprint 2.4: fire-and-forget `logApiRequest` via service-role client. |
| `app/src/lib/api/v1-helpers.ts` | Sprint 3.1: `readContext` / `respondV1` / `gateScopeOrProblem` / `requireOrgOrProblem` — extracted to deduplicate v1 handler boilerplate. |
| `app/src/lib/consent/verify.ts` | Sprint 1.2 + 1.3: `verifyConsent` + `verifyConsentBatch` typed helpers. |
| `app/src/lib/consent/record.ts` | Sprint 2.1: `recordConsent` typed helper. |
| `app/src/lib/consent/read.ts` | Sprint 3.1: `listArtefacts` + `getArtefact` + `listEvents`. |
| `app/src/lib/consent/revoke.ts` | Sprint 3.2: `revokeArtefact`. |
| `app/src/lib/consent/deletion.ts` | Sprint 4.1: `triggerDeletion` + `listDeletionReceipts`. |

### OpenAPI

| File | What changed |
|------|-------------|
| `app/public/openapi.yaml` | Sprints 2.4 → 5.1: grew from zero paths to 10 (`/_ping`, `/consent/verify`, `/consent/verify/batch`, `/consent/record`, `/consent/artefacts`, `/consent/artefacts/{id}`, `/consent/artefacts/{id}/revoke`, `/consent/events`, `/deletion/trigger`, `/deletion/receipts`). All with `bearerAuth` scopes + request/response schemas + full error matrix (401/403/404/409/410/413/422/429/501). |

### Edge Functions

| File | What changed |
|------|-------------|
| `supabase/functions/process-consent-event/index.ts` | Sprint 1.1: index insert now stamps `property_id` + `consent_event_id` (previously null). |

### Tests (92 new)

| File | Tests | Covers |
|------|-------|--------|
| `tests/integration/api-keys.e2e.test.ts` | 13 | ADR-1001 Sprint 3.1 — create → entropy → verify → rotate → dual-window → request-log → revoke → 410 |
| `tests/depa/artefact-index-identifier.test.ts` | 9 | Sprint 1.1 — hash determinism, per-type normalisation, per-org salt, revocation cascade UPDATE |
| `tests/integration/consent-verify.test.ts` | 9 | Sprint 1.2 — 4 status states, cross-org isolation, error cases |
| `tests/integration/consent-verify-batch.test.ts` | 8 | Sprint 1.3 — ordered 5-element + 25-element fixtures, 10001→413, perf smoke |
| `tests/integration/consent-record.test.ts` | 10 | Sprint 2.1 — 5-grant + 2-rejected; record→verify loop; idempotency; validation errors |
| `tests/integration/artefact-event-read.test.ts` | 17 | Sprint 3.1 — list/detail/events, pagination, chain traversal, cross-org |
| `tests/integration/consent-revoke.test.ts` | 10 | Sprint 3.2 — cascade fires; idempotent; terminal states 409; cross-org 404 |
| `tests/integration/deletion-api.test.ts` | 14 | Sprint 4.1 — consent_revoked / erasure_request; retention_expired 501; receipts filters |
| `tests/integration/mrs-sharma.e2e.test.ts` | 10 | Sprint 5.1 — §11 BFSI worked example end-to-end |
| `docs/reviews/2026-04-20-api-key-security-review.md` | — | ADR-1001 Sprint 3.1 — threat model, logging redaction, constant-time lookup (0 blocking, 0 should-fix) |

### Documentation

| File | What changed |
|------|-------------|
| `docs/ADRs/ADR-1001-truth-in-marketing-and-public-api-foundation.md` | Sprints 2.3 / 2.4 / 3.1 all flipped to `[x] complete`; ADR status → Completed. |
| `docs/ADRs/ADR-1002-dpdp-section6-runtime-enforcement.md` | Scope-correction note at Phase 1 (Sprint 1.1 split); all 8 sprints `[x]`; ADR → Completed. |
| `docs/ADRs/ADR-index.md` | ADR-1001 + ADR-1002 both Completed. |
| `docs/changelogs/CHANGELOG-schema.md` | 6 new Sprint entries (migration summaries). |
| `docs/changelogs/CHANGELOG-api.md` | 8 new Sprint entries (route + helper summaries). |
| `docs/changelogs/CHANGELOG-dashboard.md` | Sprint 2.3 + 2.4 API keys UI entries. |
| `docs/changelogs/CHANGELOG-edge-functions.md` | Sprint 1.1 pipeline write changes. |
| `docs/changelogs/CHANGELOG-docs.md` | Sprint 5.1 ADR-completion entry. |
| `docs/architecture/consentshield-definitive-architecture.md` | Rate-tier section (Sprint 2.4) moved from "future" to "shipped"; rate-tier mapping table; request audit log + RPCs documented. |
| `docs/architecture/consentshield-complete-schema-design.md` | `consent_artefact_index` DDL updated to the extended shape; new RPCs in the api_keys RPC section. |
| `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` | Appendix E: 7 rows moved Roadmap → Shipping today (keys + verify + verify/batch + record + artefacts ops + deletion trigger + receipts + rate-tier). |
| `docs/V2-BACKLOG.md` | Added C-1 (rotate+revoke 401 vs 410) and C-2 (rate-tier static sync) from security review. |

---

## Architectural decisions this session

1. **API key `/api/v1/*` middleware uses the service role, not a user JWT.**
   Request handlers have no authenticated Supabase session — the caller presents a `cs_live_*` Bearer token. The proxy resolves it via `rpc_api_key_verify` using the service-role client and injects a typed context (`x-api-*` headers). Every RPC the handlers call (`rpc_consent_verify`, `rpc_consent_record`, `rpc_artefact_revoke`, `rpc_deletion_trigger`, etc.) is SECURITY DEFINER, granted to `service_role` only. **Why:** Supabase REST does not support custom Postgres roles; the service-role carve-out pattern already existed for `verifyBearerToken` + `logApiRequest`. Rule 5 in CLAUDE.md explicitly allows this for the v1-middleware path (documented inline in `auth.ts`).

2. **Rate-tier limits are a static TS mirror of `public.plans`, not a per-request DB query.**
   `app/src/lib/api/rate-limits.ts` mirrors `api_rate_limit_per_hour` + `api_burst` values. **Why:** querying the DB in middleware on every API call is too expensive; plan tiers change rarely and always via migration (where the TS file change is part of the same PR). Drift is recorded in `V2-BACKLOG.md` (C-2) as a future CI check.

3. **Revocation cascade UPDATEs `consent_artefact_index`, not DELETE.**
   Original `trg_artefact_revocation_cascade` deleted the row on revoke. That made `/v1/consent/verify` unable to distinguish `revoked` from `never_consented`. Sprint 1.1 rewrote the trigger to `UPDATE ... SET validity_state='revoked', revoked_at=now(), revocation_record_id=new.id`. **Why:** the verify endpoint is the single most important compliance surface; it must return `revoked` with a pointer to the revocation record, not `never_consented`.

4. **Identifier hashing uses per-org salt from `organisations.encryption_salt`.**
   `hash_data_principal_identifier(org_id, identifier, identifier_type)` normalises per type (email: trim+lowercase; phone/aadhaar: digits-only; pan: trim+uppercase; custom: trim) then SHA-256-hashes with the org's existing encryption_salt. **Why:** prevents cross-org rainbow tables; reuses Rule 11's provisioned salt; single source of truth for both write-time (record) and read-time (verify) hashing.

5. **Mode B artefacts have nullable `banner_id` + `banner_version` + `session_fingerprint`.**
   These columns were all NOT NULL pre-Sprint 2.1 — assumed web-banner capture. Sprint 2.1 relaxed them on both `consent_events` and `consent_artefacts`, plus added a CHECK enforcing the shape-by-source rule (`source='web'` requires banner + fingerprint; `source='api'` requires identifier hash + type). **Why:** API-captured consent has no banner and no browser fingerprint; the identifier carries the identity instead.

6. **`rpc_consent_record` is all-in-one (no Edge Function roundtrip for Mode B).**
   The RPC inserts `consent_events` + `consent_artefacts` + `consent_artefact_index` in a single transaction. The existing dispatch trigger still fires to the Edge Function, but the EF's 23505 idempotency absorbs the duplicate. **Why:** synchronous response with artefact IDs is the spec; avoiding an HTTP roundtrip from route → EF → back is cleaner and atomic.

7. **Cursors are opaque base64-encoded JSON of `(created_at, id)` keyset tuples.**
   All paginated endpoints (artefacts list, events list, deletion receipts list) use the same pattern. Decoded server-side; callers treat as opaque strings. Malformed → `bad_cursor` (22023) → 422. **Why:** keyset pagination is stable under writes; opaque encoding lets the server change the inner shape without breaking callers.

8. **Sprint 1.1 split (honest re-scope).** Original ADR-1002 Sprint 1.1 was "verify handler" but the underlying `consent_artefact_index` lacked property_id, identifier_hash, identifier_type, and the cascade trigger deleted rows. Split into Sprint 1.1 (schema + pipeline) + Sprint 1.2 (handler) + renumbered former 1.2 to 1.3. ADR updated with a scope-correction note at the top of Phase 1. **Why:** 2-day sprint scope was wrong; amendment is cleaner than pretending the work wasn't discovered.

9. **`retention_expired` deletion mode deferred (returns 501).**
   Data-scope-driven retention sweeps are a distinct orchestration problem. Sprint 4.1 ships `consent_revoked` + `erasure_request`. **Why:** no retention-scope orchestration exists in the codebase today; deserves its own ADR.

10. **Mrs. Sharma e2e scaled down to 10,000 identifiers for CI.** The whitepaper §11 scenario is 12M identifiers; we run 10k against dev DB in <10s. **Why:** 12M is staging/load-test territory (ADR-1008). 10k is plenty to prove ordering + correctness + perf envelope.

---

## Current state of in-progress work

**Nothing is in flight.** Last commit (`e0d5ceb`) left the tree clean for Terminal B's changes. Full integration + DEPA suite: 121/121 PASS. Build + lint: clean.

Terminal A has separate uncommitted files (admin/ disputes, Terminal A scope) that are not this terminal's concern.

---

## Exact next step to continue tomorrow

The natural next workstream is **ADR-1003 — v2 Whitepaper Phase 3: Processor posture**. Per `ADR-index.md` line 62:

> ADR-1003 | v2 Whitepaper Phase 3 — Processor posture (`storage_mode` enforcement + BYOS + Zero-Storage + Healthcare seed + sandbox) | Proposed | 2026-04-19 | 5 phases | 8 sprints

Tomorrow's first actions:

1. `cd /Users/sudhindra/projects/aiSpirit/consent-sheild`
2. Read `docs/ADRs/ADR-1003-processor-posture-and-healthcare-unlock.md` end-to-end.
3. Check for scope discoveries before writing any code (look at the `storage_mode` column on `organisations` if it exists; check what BYOS / Zero-Storage infrastructure is in place).
4. If the first sprint's scope matches reality, flip ADR-1003 status to `In Progress` + ADR-index.md, then proceed Sprint 1.1.
5. If scope has drifted, split the first sprint honestly (like Sprint 1.1 of ADR-1002) and document the correction in the ADR.

**Alternative next workstreams** (pick what the user wants first):

- ADR-1004 — Statutory retention / Regulatory Exemption Engine (closes the `retention_expired` gap this session deferred)
- ADR-1005 — Operations maturity (webhook reference, test_delete endpoint, status page, non-email rights channels)
- ADR-1006 — Developer experience (client libraries + OpenAPI CI drift check — adds `redocly lint` to the build)
- ADR-1008 — Scale / perf hardening (load tests against verify, p99 < 50ms SLO baseline, HMAC rotation)

---

## Gotchas + constraints discovered this session

1. **Supabase CLI refuses out-of-order migrations.** If the remote has a migration with a timestamp newer than your local one, `supabase db push` refuses to apply. Terminal A pushes new migrations throughout the day; my migrations had to be bumped twice (20260601000002 → 20260701000001, then 20260710000002 → 20260720000001, then 20260720000004 → 20260801000001). **Always check `bunx supabase migration list | tail -5` before naming a new migration** and pick a timestamp strictly greater than the last applied.

2. **Terminal A's `git add -A` swept one of my changelog edits into their commit (`b9c28e9`).** My ADR-1002 Sprint 1.2 entry on `CHANGELOG-schema.md` ended up inside a commit labeled `feat(ADR-0051): sprint 1.2 — customer-activity triggers`. Content is correct; just attribution is off. **When two terminals are active, never use `git add -A` or `git add .` — always stage by explicit path list**, as already captured in the `feedback_explicit_git_staging` memory.

3. **PL/pgSQL records must be assigned before dereferencing.** `rpc_artefact_get` in Sprint 3.1 hit PostgreSQL error 55000 ("record `v_rev` is not assigned yet") when no revocation existed. Replaced with a subquery-driven `jsonb_build_object` (`select jsonb_build_object(...) from artefact_revocations where id = v_cai.revocation_record_id`) which returns NULL naturally when the row doesn't exist. **Pattern: prefer subquery-builds over record-variable + conditional field access.**

4. **`max(uuid)` doesn't exist in PostgreSQL.** Caught by testing — a stray `max(id) filter (where true) as nothing` placeholder in `rpc_event_list` failed with 42883. Obvious in hindsight. **Remove placeholders before applying migrations.**

5. **Rotate+revoke edge case for API keys.** After `rpc_api_key_rotate` + `rpc_api_key_revoke`, the *original* plaintext returns 401/invalid instead of 410/revoked because revocation clears `previous_key_hash`. The *rotated* plaintext correctly returns 410. Documented in `auth.ts`, the e2e test (`api-keys.e2e.test.ts` line 182), and V2-BACKLOG.md C-1. **Acceptable security trade-off** — both tokens block the call; the 401-vs-410 distinction is informational.

6. **`consent_events.banner_id`, `banner_version`, `session_fingerprint` are no longer NOT NULL.** Any code that assumed these are always populated needs to branch on `source`. The shape-CHECK enforces the invariant at the DB level. Same for `consent_artefacts`.

7. **`hash_data_principal_identifier` requires `organisations.encryption_salt`.** This column exists for all orgs (default via `gen_random_bytes(16)`), but if a future test creates an org without going through `createTestOrg` and bypasses the default, hash calls will raise `organisation % has no encryption_salt`.

8. **Async deletion_receipts fan-out is not testable in CI.** The Edge Function (`process-artefact-revocation`) runs via `net.http_post` from the dispatch trigger. Integration tests use seeded receipt fixtures to test listing; live fan-out + connector dispatch is a staging verification. Noted in Sprint 4.1 ADR deliverables.

9. **`artefact_revocations.reason` is a free-text column (not an enum).** Comment lists suggested values (`user_preference_change | user_withdrawal | business_withdrawal | data_breach | regulatory_instruction`) but no CHECK. The revoke API accepts any string; callers should stick to the conventional vocabulary.

10. **`identifiers_too_large` check at 10,000 is enforced BOTH at the route layer (413) and the RPC (defense-in-depth 22023).** If either path drifts, the other still stops the call. Same pattern could apply to other `limit` caps if volumes grow.
