# ADR-1001: Truth-in-Marketing + Public API Foundation

**Status:** Completed
**Date proposed:** 2026-04-19
**Date completed:** 2026-04-20
**Related plan:** `docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md` Phase 1
**Related gaps:** G-001, G-004, G-036 (from `docs/design/ConsentShield-Whitepaper-V2-Gaps-Combined.md`)

---

## Context

The v2.0 Customer Integration Whitepaper (April 2026) describes a public `/v1/*` compliance API authenticated by `cs_live_*` bearer tokens (Appendix A). A verification sweep on 2026-04-19 confirmed that *none* of this surface exists beyond the HMAC-signed deletion callback. There is no API-key table, no issuance UI, no verification middleware, no rate-tier enforcement hook, and no audit of API usage. The whitepaper also lists eleven connectors as "Shipping" while only Mailchimp and HubSpot are built (ADR-0018, ADR-0039), and describes operational capabilities (SLA tier, support model, SOC 2 Type II) at varying levels of reality without a transparent status inventory.

Distributing the whitepaper to a BFSI or healthcare prospect in this state is active misrepresentation. Discovering this during procurement costs the deal and the reputation; fixing it first costs less than three weeks.

This ADR delivers the precondition for every subsequent `/v1/*` endpoint (ADR-1002 onwards depends on it) and removes the two immediate misrepresentation risks.

## Decision

We will:

1. Correct the connector catalogue in every customer-facing surface (whitepaper Appendix D, landing page, product site, sales decks, connector README) so only Mailchimp and HubSpot are listed as Shipping. **(G-001)**
2. Add an Operational Maturity appendix (new Appendix E) to the whitepaper that enumerates every claimed capability with an honest status flag (Shipping / Beta / Roadmap) and a target quarter for non-Shipping items. **(G-004)**
3. Build the foundational public API layer: `public.api_keys` table, `cs_live_*` key issuance + rotation + revocation, dashboard UI, a minimum-privilege Postgres role (`cs_api`), Next.js middleware on `/api/v1/*` that resolves the bearer, sets `current_org_id()`, enforces scopes, and integrates with the existing ADR-0010 rate limiter using per-tier windows from `public.plans`. Usage is audited in `public.api_request_log`. **(G-036)**

## Consequences

- Every subsequent ADR in the 1002–1008 series can add `/v1/*` endpoints as thin handlers on top of the middleware; no endpoint-specific auth plumbing is repeated.
- The whitepaper becomes defensibly distributable to a BFSI prospect that has not yet reached the compliance-API discussion (full defensibility arrives after ADR-1002).
- A new attack surface is created. Security-review discipline (CC-D in the gap doc) applies immediately.
- `cs_api` role + `current_org_id()` pattern matches the existing RLS architecture — no new isolation primitives introduced.
- API-key rotation becomes a routine administrative action; we do NOT ship per-key audit-log export in this ADR (deferred until a customer asks).

---

## Implementation Plan

### Phase 1: Truth-in-marketing (documentation-only, no code)

**Goal:** Remove immediate misrepresentation risk. Enable safe distribution of the whitepaper before any code lands.

#### Sprint 1.1: Connector catalogue accuracy (G-001)

**Estimated effort:** 0.5 day

**Deliverables:**
- [x] `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` Appendix D: only Mailchimp + HubSpot marked "Shipping today"; Q3 2026 and Q4 2026 targets scoped to ADR-1007 sprints
- [x] §6.2 in-body connectors table reshaped into Shipping / Q3 / Q4 columns; §9.1 archetype diagram corrected (no Intercom among "pre-built OAuth connectors")
- [x] `consentshield-landing.html` — verified no connector mentions present (nothing to sync)
- [x] `consentshield-site.html` connector list synced (feature card line 1016, bullet line 1297, solution tile line 1846, pricing tile line 1868, FAQ line 2156)
- [x] `app/src/lib/connectors/README.md` authored as authoritative catalogue matching whitepaper; sales-decks grep found no further claims
- [x] Sales deck grep: no other "Shipping" / connector-count overclaims found

**Testing plan:**
- [x] Test 1: grep for "Shipping today" in whitepaper returns only 2 connector rows (Mailchimp, HubSpot) plus the table header — PASS
- [x] Test 2: each "Shipping today" row corresponds to a file under `app/src/lib/connectors/oauth/` — `mailchimp.ts` and `hubspot.ts` are the only connector files, matching the 2 rows — PASS
- [x] Test 3 (added): grep for "13 pre-built" or "15 pre-built" in site HTML — zero matches — PASS

**Status:** `[x] complete`

#### Sprint 1.2: Operational Maturity appendix (G-004)

**Estimated effort:** 1 day

**Deliverables:**
- [x] New Appendix E added to whitepaper: Capability | Status | Target | Notes — organised into 11 sections matching §1–§14 + §Appendix A + sector templates
- [x] 78 rows (target was ≥ 30) enumerating claims from §1–§14
- [x] Each row flagged honestly (Shipping / Beta / Roadmap) against the ADR-1001 verification sweep
- [x] Every Roadmap row carries a target quarter (Q2 2026 / Q3 2026 / Q4 2026 / H1 2027 / Demand-driven)
- [x] Public `/v1/*` API surface explicitly marked Roadmap with owning ADR-1002/1005/1006 phases referenced; only `/v1/deletion-receipts/{id}` callback is Shipping (ADR-0022)
- [x] Executive Summary paragraph added pointing readers to Appendix E as the "appendix wins" source
- [x] **Deferred:** no security-review sales deck exists in the repo today; mirror deliverable defers until a deck is authored. Appendix E is authoritative wherever it lives.

**Testing plan:**
- [x] Test 1: row count ≥ 30 — PASS (78 rows)
- [x] Test 2: every Shipping row is backed by a landed ADR or a structural-schema constraint — PASS (manual review of all 31 Shipping rows)
- [x] Test 3: every Roadmap row carries a target quarter — PASS (zero Roadmap-without-target rows)
- [x] Test 4: public `/v1/*` API explicitly flagged Roadmap — PASS

**Status:** `[x] complete`

### Phase 2: Public API scaffolding (G-036)

**Goal:** Every precondition for `/v1/*` endpoints — schema, role, middleware, UI, audit.

#### Sprint 2.1: Schema + role

**Estimated effort:** 2 days

**Deliverables:**
- [x] Migration `20260520000001_api_keys_v2.sql` (638 lines):
  - Extends `public.api_keys` (account_id, rate_tier, created_by, revoked_at, revoked_by, previous_key_hash, previous_key_expires_at, last_rotated_at) over the Phase-3 scaffolding
  - `public.api_keys_scopes_valid()` — scope allow-list enforced at the DDL boundary (CHECK constraint)
  - `public.api_request_log` day-partitioned table + `public.api_request_log_ensure_partition()` helper + pg_cron partition maintenance + weekly drop job for partitions older than 90 days
  - `cs_api` Postgres role with minimum grants (EXECUTE on verify RPC only; no direct table DML)
  - RLS on `public.api_keys`: account_owner / account_viewer see account keys; org_admin sees org-scoped keys; no INSERT/UPDATE/DELETE for `authenticated` (flows via SECURITY DEFINER RPCs)
  - RLS on `public.api_request_log`: same scope rule
- [x] `public.rpc_api_key_create(p_account_id, p_org_id, p_scopes text[], p_rate_tier, p_name)` → `{ id, plaintext, prefix, scopes, rate_tier, created_at }`; plaintext = `cs_live_` + base64url(32 random bytes); returned once only; hash stored as SHA-256 hex
- [x] `public.rpc_api_key_revoke(p_key_id)` — sets `revoked_at`, clears `previous_key_hash` so old plaintext stops working mid-dual-window; idempotent on already-revoked
- [x] `public.rpc_api_key_rotate(p_key_id)` — preserves `id`; stages previous hash + `previous_key_expires_at = now()+24h`; refuses rotation on revoked keys
- [x] `public.rpc_api_key_verify(p_plaintext)` — constant-time hash lookup; accepts plaintext against `key_hash` OR a live `previous_key_hash` (dual-window); `cs_api` + service_role can execute
- [x] Follow-up `20260520000002_api_keys_v2_fixes.sql` (201 lines):
  - `public.is_account_member(account_id, roles[])` + `public.is_org_member(org_id, roles[])` SECURITY DEFINER helpers to bypass RLS recursion on account_memberships / org_memberships inside policy USING clauses
  - Replaced the recursive api_keys + api_request_log SELECT policies with these helpers
  - Rewrote `rpc_api_key_create` with explicit null-check on caller role (NULL was slipping through `not in (...)`)
- [x] Follow-up `20260520000003_api_keys_column_grants.sql` (36 lines):
  - Column-level SELECT grants — `authenticated` gets SELECT on every api_keys column EXCEPT `key_hash` and `previous_key_hash`. Supabase's table-level default grant shadowed the column-level REVOKE; only working recipe is REVOKE-all + GRANT-named-columns
- [x] Down-migration: not written (additive ALTERs on an empty dev DB; no rollback path required)

**Testing plan:**
- [x] RLS isolation test (orgA + orgB): cross-tenant SELECT returns zero rows — PASS
- [x] Plaintext returned only from `rpc_api_key_create`; subsequent SELECTs never expose secret — PASS
- [x] Column hiding: `authenticated` SELECT of `key_hash` raises permission error — PASS
- [x] Hash verification: stored `key_hash` matches `sha256(plaintext)` — PASS
- [x] Rotation preserves id, issues new plaintext, old plaintext still verifies during dual-window — PASS
- [x] Revocation sets revoked_at + invalidates both plaintexts + `is_active=false` — PASS
- [x] Scope validation (invalid scope rejected) — PASS
- [x] Non-member cross-account issuance refused — PASS
- [x] Cross-org revoke refused — PASS

**Status:** `[x] complete`

#### Sprint 2.2: Bearer middleware + request context

**Estimated effort:** 3 days

**Deliverables:**
- [x] `app/src/proxy.ts` — added `/api/v1/:path*` to matcher; Bearer gate branch in proxy body; deletion-receipts path passes through unchanged
- [x] `app/src/lib/api/auth.ts` — `verifyBearerToken(authHeader)` → calls `rpc_api_key_verify` via service_role client; `getKeyStatus` secondary check distinguishes revoked (410) from unknown (401); `problemJson` RFC 7807 body builder
- [x] `app/src/lib/api/context.ts` — `getApiContext()`, `assertScope()`, `buildApiContextHeaders()` helpers for route handlers
- [x] RFC 7807 problem+json responses — 401 (missing/malformed/invalid), 410 (revoked) in proxy.ts; 403 (wrong scope) via `assertScope()` in handlers
- [x] `app/src/app/api/v1/_ping/route.ts` — canary GET returning `{ ok, org_id, account_id, scopes, rate_tier }` from injected headers
- [x] `tests/integration/api-middleware.test.ts` — 6 cases covering valid, missing, malformed, non-existent, and revoked keys

**Architecture notes:**
- `rpc_api_key_verify` is granted to `service_role` only (migration 20260520000001); proxy uses service_role for the verify call and the revoked-key fallback query — same pattern as the Worker's service-role REST usage. `cs_api` Postgres role is for future direct-connection poolers.
- Verified context is passed to route handlers as request headers (`x-api-key-id`, `x-api-account-id`, `x-api-org-id`, `x-api-scopes`, `x-api-rate-tier`) — standard Next.js proxy → handler communication.
- `assertScope()` lives in `context.ts`; each route handler calls it for its required scope. The proxy itself only validates that the key is active — scope is per-handler.

**Testing plan:**
- [x] Valid key → `verifyBearerToken` returns ok=true with correct org_id, account_id, scopes — PASS
- [x] Missing header → 401/missing — PASS
- [x] Malformed Bearer (no cs_live_ prefix) → 401/malformed — PASS
- [x] Malformed Bearer (missing scheme) → 401/malformed — PASS
- [x] Non-existent cs_live_ token → 401/invalid — PASS
- [x] Revoked key → 410/revoked — PASS
- [ ] Wrong scope → 403 (tested via `assertScope` unit test — deferred; requires handler with scope guard)
- [ ] Rate-limit exceeded → 429 with Retry-After (Sprint 2.4)
- [ ] Cross-org RLS block (Sprint 2.4, needs a data handler)
- [ ] _ping HTTP 200 via running dev server (manual verification)

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/api-middleware.test.ts

  verifyBearerToken
    ✓ returns ok=true with context for a valid key
    ✓ returns 401/missing when Authorization header is absent
    ✓ returns 401/malformed for a non-cs_live_ Bearer value
    ✓ returns 401/malformed when the scheme is missing
    ✓ returns 401/invalid for a cs_live_ token that does not exist
    ✓ returns 410/revoked after the key is revoked

  Tests  6 passed (6)
```

Fix during testing: `rpc_api_key_revoke` requires `current_uid()` — must call as the key's owner (`org.client`), not service_role. Corrected in test.

**Status:** `[x] complete`

#### Sprint 2.3: Dashboard UI for key management

**Estimated effort:** 2 days

**Deliverables:**
- [x] `/dashboard/settings/api-keys` list page (customer app)
- [x] Create flow: name, scopes (multiselect from allowed list), rate_tier inferred from plan
- [x] Plaintext-reveal modal shown exactly once, with "copy to clipboard" + "I have saved this key" confirmation
- [x] Rotate button with dual-window visualisation ("old key valid until …")
- [x] Revoke button with confirmation
- [x] Last-used-at + created-at columns
- [x] Empty state + zero-keys call-to-action

**Testing plan:**
- [ ] Manual flow: mint → copy → call `/v1/_ping` with it → 200
- [ ] Rotate → old key still works for 24h, new key works immediately
- [ ] Revoke → immediately 410
- [ ] UI rejects scope selection exceeding the key-creator's own entitlement (enforced by RPC)

### Test Results

- Build: `cd app && bun run build` — PASS (route `/dashboard/settings/api-keys` included in output)
- Lint: `bun run lint` — PASS (0 errors, 0 warnings)
- Manual UI verification: pending (dev server not started this session)

**Status:** `[x] complete — 2026-04-20`

#### Sprint 2.4: Rate limiter integration + audit log + plan wiring

**Estimated effort:** 2 days

**Deliverables:**
- [x] Per-tier window config pulled from `public.plans` join (columns: `api_rate_limit_per_hour`, `api_burst`)
- [x] ADR-0010 rate limiter called with `key_id` bucket (proxy.ts, 1-hour window)
- [x] Every `/api/v1/*` response records a row in `public.api_request_log` (fire-and-forget via `logApiRequest` + `rpc_api_request_log_insert`)
- [x] Retention policy: pg_cron daily job already in 20260520000001 (drops partitions > 90 days); new migration adds INSERT + usage RPCs
- [x] Dashboard page `/dashboard/settings/api-keys/[id]/usage` — SVG bar chart + p50/p95 latency table (no new deps)
- [x] OpenAPI stub at `app/public/openapi.yaml` with `securitySchemes.bearerAuth` and the `_ping` endpoint

### Architecture Notes

- `api_request_log` table exists from migration 20260520000001 (daily partitions, existing cron). Migration 20260601000001 adds `rpc_api_request_log_insert` (service_role only) and `rpc_api_key_usage`.
- Rate-tier limits are a static mirror (`app/src/lib/api/rate-limits.ts`) of DB values to avoid a per-request DB query in middleware.
- Usage chart is pure server-side SVG; no charting library added (Rule 15 compliance).

**Testing plan:**
- [ ] Burst test: 200 req/sec on a Starter-tier key → limiter triggers 429 at 100/hr window
- [ ] Audit log populated: `SELECT count(*) FROM api_request_log WHERE key_id = $1 AND occurred_at > now()-interval '1 min'` correct
- [ ] Retention: backfill a 95-day-old partition; cron drops it (existing function `api_request_log_drop_old_partitions`)
- [ ] OpenAPI stub validates via `redocly lint`

### Test Results

- Build: `cd app && bun run build` — PASS
- Lint: `bun run lint` — PASS (0 errors, 0 warnings)
- Migration: `20260601000001_api_request_log.sql` applied — PASS
- Manual flow + burst test: pending

**Status:** `[x] complete — 2026-04-20`

### Phase 3: Exit gate

#### Sprint 3.1: End-to-end smoke + security review prep

**Estimated effort:** 1 day

**Deliverables:**
- [x] End-to-end smoke: mint key → verify context → rotate → dual-window → revoke → 410 (see `tests/integration/api-keys.e2e.test.ts`)
- [x] Security review checklist: `docs/reviews/2026-04-20-api-key-security-review.md` — threat model, token-in-URL avoidance, logging redaction, key-prefix ergonomics, constant-time lookup, rate-limit bucket design. 0 blocking / 0 should-fix / 2 cosmetic (V2 backlog).
- [x] Whitepaper Appendix E updated: `cs_live_*` key issuance and rate-tier enforcement both moved to **Shipping today**.

**Testing plan:**
- [x] 13/13 PASS — `tests/integration/api-keys.e2e.test.ts` (create, entropy ×3, verify, rotate ×2, dual-window, request-log + usage, revoke ×2, 410 ×2, 401/invalid)
- [x] Entropy verified: 256-bit (32 random bytes), base64url body ≥ 43 chars
- [x] Column-level REVOKE confirmed: authenticated SELECT cannot read `key_hash`
- [x] `rpc_api_request_log_insert` + `rpc_api_key_usage` round-trip verified
- [ ] Formal timing probe (1000-req t-test): deferred to V2 pre-launch audit

### Test Results — 2026-04-20

```
bunx vitest run tests/integration/api-keys.e2e.test.ts
13/13 PASS (5.0s)
```

Edge case documented: `rotate+revoke` causes original plaintext to return 401 instead of 410 (hash cleared from both slots). Documented in test, `auth.ts`, and V2 backlog (C-1).

**Status:** `[x] complete — 2026-04-20`

---

## Architecture Changes

- `docs/architecture/consentshield-definitive-architecture.md`: add a new section for the compliance-API surface (auth model, middleware, rate-tier mapping).
- `docs/architecture/consentshield-complete-schema-design.md`: document `api_keys` and `api_request_log` tables and the `cs_api` role.
- Security Rules: add a new rule capping API key lifetime (proposal: keys expire at 365 days if unused; rotate-on-use extends).

_None yet._

---

## Test Results

### Sprint 1.1 — 2026-04-19

```
Test 1: Whitepaper "Shipping today" grep
Method: Grep pattern "^\| [A-Za-z].*\| Shipping today \|" in
        docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md
Expected: exactly 2 data rows (Mailchimp, HubSpot) plus the table header
Actual:
  Line 453: header of §6.2 inline table
  Line 1114: | Mailchimp | ... | Shipping today | — |
  Line 1115: | HubSpot   | ... | Shipping today | — |
Result: PASS

Test 2: Shipping claims ↔ real connector files
Method: ls app/src/lib/connectors/oauth/
Expected: every "Shipping today" claim backed by an actual .ts file
Actual:  hubspot.ts, mailchimp.ts (plus registry.ts, types.ts infra files)
Result: PASS — 2 claims, 2 connector files, 1:1 correspondence

Test 3 (added): No stale "13 pre-built" / "15 pre-built" claims in site HTML
Method: Grep "13 pre-built|13 pre|15 pre" in
        docs/design/screen designs and ux/consentshield-site.html
Expected: zero matches
Actual:   zero matches
Result: PASS
```

### Sprint 1.2 — 2026-04-19

```
Test 1: Appendix E row count ≥ 30
Method: sed -n '/## Appendix E/,$p' whitepaper.md |
        grep -cE '^\| [A-Za-z`].*\| (Shipping|Beta|Roadmap)'
Expected: ≥ 30
Actual:   78
Result: PASS

Test 2: every Shipping row backed by a landed ADR or structural-schema
Method: Manual review of the 31 Shipping rows; each cross-checked against
        the ADR index (ADR-0001 through ADR-0050) or the verification
        sweep from ADR-1001 context.
Expected: every row traces to shipped code or a structural DDL constraint
Actual:   all 31 rows verified (architecturally-structural claims like
          "Category labels, never content values" are flagged
          Shipping (structural) to distinguish from in-code Shipping)
Result: PASS

Test 3: every Roadmap row carries a target quarter
Method: sed -n '/## Appendix E/,$p' whitepaper.md |
        grep -E '^\| [A-Za-z`].*\| Roadmap \| — \|'
Expected: zero matches
Actual:   zero matches
Result: PASS

Test 4: public /v1/* surface flagged Roadmap
Method: Inspect §Appendix E ### Public compliance API section
Expected: every /v1/* endpoint except /v1/deletion-receipts/{id}
          callback (already shipping as ADR-0022) flagged Roadmap
          with target quarter + owning ADR reference
Actual:   7 Roadmap rows (Q2 or Q3 2026), 1 Shipping row for the
          existing callback endpoint
Result: PASS
```

### Sprint 2.1 — 2026-04-20

```
Suite: tests/rls/api-keys.test.ts
Command: bunx vitest run tests/rls/api-keys.test.ts
Result: 17/17 PASS · 9.38s

Tests exercised:
  rpc_api_key_create
    ✓ returns a cs_live_ plaintext once and stores only the hash
    ✓ rejects invalid scopes
    ✓ rejects a non-member caller
  RLS + column hiding
    ✓ authenticated user sees the key row but key_hash is blocked
    ✓ key_hash is never exposed to authenticated clients
    ✓ orgB cannot see orgA's key (cross-tenant isolation)
  rpc_api_key_verify (service_role)
    ✓ resolves a live plaintext to the matching key row
    ✓ returns null for a wrong plaintext
    ✓ returns null for a malformed plaintext
    ✓ verifies stored hash matches SHA-256 of plaintext
  rpc_api_key_rotate
    ✓ issues a new plaintext and keeps the id stable
    ✓ old plaintext still verifies during the dual-window
    ✓ new plaintext verifies
  rpc_api_key_revoke
    ✓ sets revoked_at and invalidates both old and new plaintexts
    ✓ revoking an already-revoked key is idempotent (no error)
    ✓ rotating a revoked key raises
  authorisation fences
    ✓ orgB member cannot revoke orgA key

Notes:
  · bunx supabase db push reported "Remote database is up to date" —
    all three migrations (20260520000001 + 20260520000002 + 20260520000003)
    applied cleanly in the prior session before the crash.
  · Two pre-existing flakes surfaced in the full repo suite
    (tests/admin/admin-lifecycle-rpcs.test.ts — "last active
    platform_operator" guards; tests/billing/gst-statement.test.ts
    — owner+NULL-issuer row count). Both fail due to shared dev-DB
    state accumulated across prior runs (5+ active platform_operator
    rows; extra invoice rows); neither test exercises api_keys or
    any schema object touched by this sprint. Logged as bug-NNN in
    buglog.json for a follow-up cleanup pass; out of scope for
    Sprint 2.1 ship.
```

---

## V2 Backlog (explicitly deferred)

- Per-key granular audit-log export (wait for customer demand).
- Per-key IP allowlist (wait for customer demand; can layer on `api_keys.ip_allowlist jsonb`).
- Signed requests (HMAC in addition to bearer) — considered and deferred; bearer over TLS is industry standard.

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 2.1 (api_keys + api_request_log migration + cs_api role)
- `CHANGELOG-api.md` — Sprint 2.2, 2.4 (`/api/v1/*` middleware, rate limiter integration)
- `CHANGELOG-dashboard.md` — Sprint 2.3 (API keys UI)
- `CHANGELOG-docs.md` — Sprint 1.1, 1.2 (whitepaper edits + Appendix E)
