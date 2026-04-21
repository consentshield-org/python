# ADR-1009: v1 API role hardening — remove service-role shortcut, adopt `cs_api` as designed

**Status:** In Progress
**Date proposed:** 2026-04-20
**Date completed:** —
**Superseded by:** —

---

## Context

ADR-1001 (`cs_live_*` keys + Bearer middleware) and ADR-1002 (`/v1/consent/*` + `/v1/deletion/*` handlers) shipped in the 2026-04-19 → 2026-04-20 sessions. Both, as implemented, violate **Rule 5** of CLAUDE.md (non-negotiable): **"Never use `SUPABASE_SERVICE_ROLE_KEY` in running application code — it is for migrations only."**

Concretely:

- `app/src/lib/api/auth.ts:21-26` (`makeServiceClient`) instantiates a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` for every `/v1/*` request. Called by `verifyBearerToken` (every request) and `getKeyStatus` (revoked-key fallback — also a direct `api_keys` table SELECT).
- `app/src/lib/api/log-request.ts:8-13` instantiates a second service-role client per request for fire-and-forget request-log insertion.
- `app/src/lib/consent/record.ts`, `verify.ts`, `read.ts`, `revoke.ts`, `deletion.ts` — every v1 business helper uses `SUPABASE_SERVICE_ROLE_KEY` to call its target SECURITY DEFINER RPC.
- Migration 20260520000001 created a **minimum-privilege `cs_api` role** as the intended execution context for `/v1/*` handlers (with no table privileges; access only via SECURITY DEFINER RPCs). That role is **unused** — every v1 RPC (`rpc_api_key_verify`, `rpc_consent_verify`, `rpc_consent_record`, `rpc_artefact_revoke`, `rpc_deletion_trigger`, `rpc_deletion_receipts_list`, etc.) grants EXECUTE to `service_role` instead of `cs_api`.

### Why the shortcut is dangerous

1. **Tenant isolation is TypeScript-deep only.** Each RPC accepts `p_org_id` and trusts it (`where org_id = p_org_id`). The handler passes `context.org_id` from the verified API key, but there is no DB-level fence. A single future handler that reads `org_id` from the request body or URL param — or a refactor that shuffles variable names — can write or read any tenant's data. Nothing in the database refuses a cross-tenant request.
2. **The master key is on the hot path of every public API request.** `SUPABASE_SERVICE_ROLE_KEY` bypasses ALL RLS on ALL tables across ALL tenants. Having it in `process.env` for every inbound `/v1/*` invocation converts any Node-process compromise (prototype pollution, SSRF-into-metadata, dependency supply-chain, stray `console.log`, Sentry breadcrumb leak) into a total-tenant-data exfiltration event.
3. **The `getKeyStatus` path does a direct table SELECT**, not an RPC. The "single whitelisted RPC" framing in the code comment is already broken.
4. **The justification comment at `auth.ts:16-20` rationalizes past Rule 5.** It invokes the Worker ("analogous to the Worker's use of the service key") as precedent. That precedent does not exist: the Worker uses `SUPABASE_WORKER_KEY`, a **custom-signed JWT** with `role: cs_worker`, over Supabase REST. PostgREST respects the claim and `SET ROLE cs_worker` for the transaction. The same pattern is available for `cs_api` and has been since migration 20260413000010 created the scoped-roles infrastructure.
5. **ADR-0045's carve-out has none of the guardrails this one has taken.** That carve-out (a) is limited to `auth.admin.*` operations — the only APIs Supabase exposes exclusively to service-role, (b) runs behind the admin proxy (`is_admin` + AAL2), (c) calls `admin.require_admin('platform_operator')` **inside** every SECURITY DEFINER RPC before the privileged call. The v1 carve-out has no AAL, no in-RPC caller check, no "match `p_org_id` against the Bearer token."

### What this ADR is NOT

- This ADR does **not** amend Rule 5. It does **not** create a second carve-out alongside ADR-0045. It removes the shortcut and adopts the pattern the `cs_api` role was created for.
- This ADR does **not** propose any change to the Worker, the delivery Edge Function, the orchestrator Edge Function, or the admin service-role carve-out (ADR-0045). Those are out of scope.
- Dev-only timing matters: there are no live customers (per `project_dev_only_no_prod` memory). Migrating now costs a day; migrating after customers costs vastly more.

---

## Decision

Adopt `cs_api` as the execution context for every `/api/v1/*` handler, exactly as the migration-20260520000001 design intended. Concretely:

1. **DB tenant fence (defense-in-depth).** Every v1 RPC that accepts `p_org_id` additionally accepts `p_key_id uuid` and calls `public.assert_api_key_binding(p_key_id, p_org_id)` at the top of its body. The helper raises `P0001` if the key is revoked, if `account_id` on the key doesn't match the org's `account_id`, or (for org-scoped keys) if `org_id` on the key doesn't match `p_org_id`. The DB — not the handler — enforces tenant binding.
2. **`cs_api` JWT minted once** (same tooling as `SUPABASE_WORKER_KEY`), stored as `SUPABASE_CS_API_KEY` (customer-app env). A new `makeCsApiClient()` helper in `app/src/lib/api/cs-api-client.ts` returns a Supabase client using it.
3. **Grants flip.** Every v1 RPC (`rpc_api_key_verify`, `rpc_api_key_status` [new — replaces the direct `api_keys` SELECT in `getKeyStatus`], `rpc_consent_verify`, `rpc_consent_verify_batch`, `rpc_consent_record`, `rpc_artefact_list`, `rpc_artefact_get`, `rpc_artefact_revoke`, `rpc_event_list`, `rpc_deletion_trigger`, `rpc_deletion_receipts_list`, `rpc_api_request_log_insert`) grants EXECUTE to `cs_api` and revokes from `service_role`.
4. **Runtime swap.** `auth.ts`, `log-request.ts`, and every helper in `app/src/lib/consent/*.ts` stop calling `makeServiceClient()` and use `makeCsApiClient()` instead. The direct `api_keys.SELECT` in `getKeyStatus` becomes a call to the new `rpc_api_key_status`.
5. **Env purge.** `SUPABASE_SERVICE_ROLE_KEY` is removed from the customer-app `.env.local`, `.env.example`, and all Vercel environments. CI grep gate blocks its reintroduction under `app/src/`.
6. **Comment + doc correction.** The misleading "analogous to the Worker's use of the service key" comment in `auth.ts` is rewritten to reflect reality (`cs_api` JWT, mirror of `cs_worker`). The cerebrum entry claiming the Worker uses service role is corrected. Rule 5 in CLAUDE.md gets a reaffirmation line stating v1 is on `cs_api` and there is no v1 service-role carve-out.

The admin service-role carve-out (ADR-0045) remains. It is genuinely required (Supabase exposes `auth.admin.*` only to service-role) and has defense-in-depth at both proxy and RPC layers that v1 was missing.

## Consequences

- Rule 5 is honoured across both apps.
- A compromise of the customer-app Node process no longer yields a key that bypasses all RLS. The attacker gets a `cs_api` JWT, which has no table privileges and can only execute a closed list of SECURITY DEFINER RPCs — each of which now checks `assert_api_key_binding` before reading or writing.
- Tenant boundary moves from TypeScript-only to DB-enforced. A future handler bug that passes the wrong `org_id` is refused by Postgres, not silently dispatched.
- One new operational task: minting the `cs_api` JWT (one-time, same tooling as `cs_worker`).
- Minor runtime cost: each v1 RPC grows one extra `assert_api_key_binding` lookup (indexed on `api_keys.id`). p99 impact expected <0.5ms; verified in Sprint 1.3 test results.
- No behavioural API change. All 92 v1 integration tests + 121 DEPA tests continue to pass.

---

## Implementation Plan

### Phase 1 — DB tenant fence

**Goal:** Every v1 RPC enforces `(p_key_id, p_org_id)` binding in-database before doing any real work. Handler remains on service-role during this phase — isolated change, low risk, immediately cuts the blast radius of any route-handler bug.

#### Sprint 1.1 — `assert_api_key_binding` + mutating RPCs
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Migration: `public.assert_api_key_binding(p_key_id uuid, p_org_id uuid)` — SECURITY DEFINER, raises `P0001 'api_key_not_authorised_for_org'` on mismatch. Lookups: `api_keys.id = p_key_id AND revoked_at IS NULL AND (org_id = p_org_id OR (org_id IS NULL AND account_id = (select account_id from organisations where id = p_org_id)))`. GRANT EXECUTE to `service_role` + `cs_api`.
- [ ] Add `p_key_id uuid` parameter + `perform public.assert_api_key_binding(p_key_id, p_org_id)` at the top of: `rpc_consent_record`, `rpc_artefact_revoke`, `rpc_deletion_trigger`.
- [ ] Route handler updates (`api/v1/consent/record/route.ts`, `api/v1/consent/artefacts/[id]/revoke/route.ts`, `api/v1/deletion/trigger/route.ts`) thread `context.key_id` through to their lib helpers.

**Testing plan:**
- [x] Existing mutation integration tests continue to pass — 63/63 across consent-record/consent-revoke/deletion-api/artefact-event-read/mrs-sharma suites.
- [x] New cross-key attack tests inline in consent-revoke + deletion-api: (a) key-for-orgA + p_org_id=orgB → `api_key_binding`, (b) otherOrg-bound key acting on org → `api_key_binding`, (c) intra-org key on same-org revoke → succeeds.

**Status:** `[x] complete`

#### Sprint 1.2 — Read-path RPCs
**Estimated effort:** 0.5 day

**Deliverables:**
- [x] Migration `20260801000005_api_key_binding_reads.sql` — `p_key_id` param + `assert_api_key_binding` call added to `rpc_consent_verify`, `rpc_consent_verify_batch`, `rpc_artefact_list`, `rpc_artefact_get`, `rpc_event_list`, `rpc_deletion_receipts_list`. DROP + CREATE for all six (signature change).
- [x] Lib helpers updated (`verify.ts`, `read.ts`, `deletion.ts.listDeletionReceipts`); each gains required `keyId` param + `api_key_binding` error kind.
- [x] Route handlers updated (`verify`, `verify/batch`, `consent/artefacts` list, `consent/artefacts/[id]` detail, `consent/events`, `deletion/receipts`) to thread `context.key_id` + map `api_key_binding` → 403.
- [x] All five affected test files threaded the new `keyId`; added one explicit cross-org fence test in `consent-verify.test.ts`.

**Testing plan:**
- [x] Existing read-path integration tests pass — 100/100 integration suite.
- [x] Cross-key fence rejects: `verifyConsent` with org-bound keyId but `p_org_id=otherOrg` → `api_key_binding` 403.

**Status:** `[x] complete`

#### Sprint 1.3 — Perf check + Phase 1 sign-off
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] Micro-bench: 10k calls to `rpc_consent_verify` pre/post `assert_api_key_binding` — capture p50/p99 delta. Target: p99 delta < 0.5ms.
- [ ] If target missed: add `api_keys_id_active_idx` partial index on `(id) where revoked_at is null`.

**Testing plan:**
- [ ] Full 121-test suite (`bun run test` + `bun run test:rls`) green.

**Status:** `[ ] planned`

### Phase 2 — `cs_api` role activation (revised 2026-04-21)

**Goal:** The customer-app Node process stops holding `SUPABASE_SERVICE_ROLE_KEY` (and does not acquire `SUPABASE_SECRET_KEY` either). Every v1 request runs as `cs_api` end-to-end over a direct Postgres connection.

**Scope amendment:** The original plan minted a `cs_api` HS256 JWT and called PostgREST with it — the same mechanism used for `SUPABASE_WORKER_KEY`. Supabase is rotating the project's JWT signing keys from HS256 (shared secret) to ECC P-256 (asymmetric). The legacy HS256 key is listed as "Previously used" in the dashboard; Supabase is nudging users to revoke it. Once revoked, every HS256-signed scoped-role JWT stops working — including the one this ADR originally proposed to mint.

Direct Postgres connections as scoped roles are unaffected by the JWT rotation. `cs_delivery` and `cs_orchestrator` already use this pattern from Supabase Edge Functions. We adopt the same pattern for `cs_api`. Side-effect: the same pattern will fix the Cloudflare Worker when its HS256 JWT stops working.

The abandoned `scripts/mint-role-jwt.ts` is removed in Sprint 2.1; its code and commit (`b6f41a2`) are preserved in history.

#### Sprint 2.1 — `cs_api` LOGIN + postgres.js pool
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Migration: `alter role cs_api with login password 'cs_api_change_me'` (placeholder, same pattern as the 20260413000010 cs_worker seed). User rotates the password immediately via psql: `alter role cs_api with password '<openssl rand -base64 32>';`.
- [ ] Store rotated password in `.secrets` as `SUPABASE_CS_API_PASSWORD`; mirror into Vercel preview + production as `SUPABASE_CS_API_DATABASE_URL` (full connection string against the Supavisor transaction pooler).
- [ ] Install `postgres@3.x` (postgres.js — zero sub-deps, ~8KB gzipped, implements the wire protocol natively). Rule 15 justification inline: Postgres wire protocol is non-trivial and an established, widely-used, zero-sub-dep library is strictly safer than a hand-rolled client.
- [ ] New helper `app/src/lib/api/cs-api-client.ts` exports `csApi`: a singleton `postgres.js` pool connecting to the Supavisor transaction pooler as `cs_api`. Hot-path safe (Fluid Compute reuses the instance across requests).
- [ ] New SECURITY DEFINER RPC `public.rpc_api_key_status(p_plaintext text) returns text` — replaces the direct `api_keys` SELECT in `getKeyStatus`. Returns `'active' | 'revoked' | 'not_found'`. Grants EXECUTE to `cs_api` (+ `service_role` for the transition window).
- [ ] Delete `scripts/mint-role-jwt.ts` with a note in the commit message referencing this scope amendment.

**Testing plan:**
- [x] `tests/integration/cs-api-role.test.ts` — 5 assertions: rpc_api_key_verify returns seeded context; rpc_api_key_status returns active / revoked / not_found correctly; cs_api cannot SELECT api_keys / consent_events / organisations; cs_api cannot (yet) execute rpc_consent_record (inverts in Sprint 2.2). Skips gracefully when `SUPABASE_CS_API_DATABASE_URL` is missing.
- [x] Without env set: 5 tests skip, 100/100 existing integration tests still pass.
- [ ] With env set: all 5 cs-api-role assertions pass (BLOCKED on user password rotation + env setup).

**Status:** `[~] in progress` — scaffolding shipped; closes once user rotates the placeholder password via psql and sets `SUPABASE_CS_API_DATABASE_URL` in `.secrets` + Vercel, then the 5 smoke tests run green.

**User action to close Sprint 2.1:**
```sh
# 1. Generate a strong password
PW=$(openssl rand -base64 32 | tr -d '+/=')
# 2. Rotate cs_api password via psql
psql "$SUPABASE_DIRECT_CONNECTION_STRING" -c "alter role cs_api with password '$PW';"
# 3. Persist in .secrets
echo "SUPABASE_CS_API_PASSWORD=$PW" >> .secrets
echo "SUPABASE_CS_API_DATABASE_URL=postgresql://cs_api.<project-ref>:$PW@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require" >> .secrets
# 4. Mirror into Vercel (preview + production)
vercel env add SUPABASE_CS_API_DATABASE_URL preview
vercel env add SUPABASE_CS_API_DATABASE_URL production
# 5. Re-run smoke
SUPABASE_CS_API_DATABASE_URL="<...>" bunx vitest run tests/integration/cs-api-role.test.ts
```

#### Sprint 2.2 — Flip RPC grants to `cs_api`
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Migration: `grant execute on function <each v1 RPC> to cs_api;` for all 12 v1 RPCs (verify, verify_batch, record, artefact_list, artefact_get, artefact_revoke, event_list, deletion_trigger, deletion_receipts_list, api_key_verify, api_key_status, api_request_log_insert, assert_api_key_binding).
- [ ] Keep `service_role` grants in place — this sprint is purely additive; Phase 2.4 revokes.

**Testing plan:**
- [ ] Direct psql-as-cs_api call to each RPC succeeds (12 smoke assertions).
- [ ] Direct psql-as-cs_api `select * from consent_events` returns `permission denied for table` (verifies cs_api has zero table privileges).

**Status:** `[ ] planned`

#### Sprint 2.3 — Runtime swap
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] `app/src/lib/api/auth.ts`: `makeServiceClient()` call sites → `csApi` pool queries. `getKeyStatus` switches from `.from('api_keys').select(...)` to `rpc_api_key_status`. Code comment rewritten — removes the Worker analogy; restates as "v1 handlers connect directly to Postgres as cs_api, bypassing PostgREST entirely (ADR-1009 Phase 2)."
- [ ] `app/src/lib/api/log-request.ts`: swap to `csApi`.
- [ ] `app/src/lib/consent/verify.ts`, `record.ts`, `read.ts`, `revoke.ts`, `deletion.ts`: swap to `csApi`. RPC calls translated from `.rpc('name', { p_k: v })` to `csApi\`select name($1, $2, ...)\`` (postgres.js tagged-template SQL).
- [ ] Full integration suite + DEPA suite re-run.

**Testing plan:**
- [ ] 124/124 integration + DEPA green with `SUPABASE_SERVICE_ROLE_KEY` absent from app runtime but present in test env for `tests/rls/helpers.ts` (admin ops).
- [ ] Manual curl smoke: `POST /v1/consent/record` with a seeded Bearer token succeeds end-to-end.

**Status:** `[ ] planned`

#### Sprint 2.4 — Revoke + env purge
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Migration: `revoke execute on function <each v1 RPC> from service_role;` for all 12 RPCs.
- [ ] Remove `SUPABASE_SERVICE_ROLE_KEY` from customer-app `.env.local`, `.env.example`, Vercel preview env, Vercel production env. (Test harness keeps it — it runs outside app runtime.)
- [ ] Verify `app/src/` has zero references to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`.

**Testing plan:**
- [ ] Full 124-test suite green with `SUPABASE_SERVICE_ROLE_KEY` absent from customer-app env.
- [ ] Negative test: direct psql-as-service_role `select * from rpc_consent_verify(...)` raises `42501 permission denied for function`.
- [ ] `bun run build` clean; customer app starts with only `SUPABASE_CS_API_DATABASE_URL` set (no service-role key).

**Status:** `[ ] planned`

### Phase 3 — Guardrails + documentation

**Goal:** Close the door on silent regression. Make Rule 5 enforcement mechanical, not reviewer-attention-dependent.

#### Sprint 3.1 — CI gate + comment correction
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] New script `scripts/check-no-service-role-in-customer-app.ts`: greps `app/src/` for `SUPABASE_SERVICE_ROLE_KEY` and `service_role` (outside of comments in migration references), exits non-zero on match.
- [ ] Wire into `app/package.json` `lint` script (runs before eslint).
- [ ] Pre-commit hook additions if applicable (local only; keep CI as the canonical gate).

**Testing plan:**
- [ ] Script passes on current tree after Phase 2 completes.
- [ ] Script fails when a test injection reintroduces `SUPABASE_SERVICE_ROLE_KEY` (then revert).

**Status:** `[ ] planned`

#### Sprint 3.2 — Doc sync + cerebrum correction
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] `CLAUDE.md` Rule 5: append one-line note — "v1 handlers run as `cs_api` (ADR-1009); there is no v1 service-role carve-out."
- [ ] `docs/architecture/consentshield-definitive-architecture.md`: add `cs_api` to the role layout section with grant scope summary.
- [ ] `docs/changelogs/CHANGELOG-schema.md`: migrations listed.
- [ ] `docs/changelogs/CHANGELOG-api.md`: runtime swap summary.
- [ ] `docs/changelogs/CHANGELOG-infra.md`: env-var change.
- [ ] `.wolf/cerebrum.md`: replace the "Worker uses service role" key-learning with "Worker uses `cs_worker` via signed JWT; v1 handlers use `cs_api` via signed JWT; `SUPABASE_SERVICE_ROLE_KEY` is migrations-only."

**Testing plan:**
- [ ] Architecture doc review: no stale references to service-role in v1 paths.

**Status:** `[ ] planned`

---

## Architecture Changes

To be recorded at Phase 3 close:

- `docs/architecture/consentshield-definitive-architecture.md` — role-layout section extended with `cs_api` (scope: EXECUTE on 12 SECURITY DEFINER RPCs, zero table privileges).
- `CLAUDE.md` Rule 5 — reaffirmation line; no amendment.

---

## Test Results

_Populated per sprint._

---

## Changelog References

- CHANGELOG-schema.md — Sprint 1.1 / 1.2 / 2.1 / 2.2 / 2.4 migrations
- CHANGELOG-api.md — Sprint 1.1 / 1.2 / 2.3 handler changes
- CHANGELOG-infra.md — Sprint 2.4 env-var purge
- CHANGELOG-docs.md — Sprint 3.2 doc sync
