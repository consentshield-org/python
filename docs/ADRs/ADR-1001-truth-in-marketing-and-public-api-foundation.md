# ADR-1001: Truth-in-Marketing + Public API Foundation

**Status:** In Progress
**Date proposed:** 2026-04-19
**Date completed:** —
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
- [ ] Migration `<date>_api_keys.sql`:
  - `public.api_keys` table with columns per G-036 acceptance criteria
  - `public.api_request_log` day-partitioned table, 90-day retention policy
  - `cs_api` Postgres role with minimum grants (SELECT/INSERT on relevant tables via SECURITY DEFINER RPCs; no direct table access)
  - RLS on `api_keys` — account_owner / org_admin can CRUD; nobody else
- [ ] Helper RPC `public.rpc_api_key_create(p_account_id, p_org_id?, p_scopes text[], p_rate_tier, p_name)` → returns `{ id, plaintext }`; plaintext shown only at creation
- [ ] Helper RPC `public.rpc_api_key_revoke(p_key_id)`
- [ ] Rotation RPC `public.rpc_api_key_rotate(p_key_id)`
- [ ] Down-migration tested

**Testing plan:**
- [ ] RLS isolation test: two orgs, each mints a key; neither can see the other's
- [ ] Plaintext never returned after creation: `SELECT` on `api_keys` via any role never exposes the secret
- [ ] Hash verification: stored `hashed_secret` matches SHA-256 of the once-shown plaintext
- [ ] Rotation preserves key_id but changes hash; old plaintext stops working
- [ ] Revocation sets `revoked_at`; queries filter revoked keys

**Status:** `[ ] planned`

#### Sprint 2.2: Bearer middleware + request context

**Estimated effort:** 3 days

**Deliverables:**
- [ ] Next.js middleware matcher for `/api/v1/*` branch (excluding the existing `/v1/deletion-receipts/*` callback)
- [ ] Helper `app/src/lib/api/auth.ts`:
  - Parse `Authorization: Bearer cs_live_...`
  - Lookup + hash-compare against `api_keys`
  - Reject revoked / expired
  - Verify scope against handler-declared requirement
  - Set request context: `{ org_id, account_id, scopes, rate_tier, key_id }`
- [ ] Per-request Supabase client constructed with `cs_api` role and `current_org_id()` set from resolved key
- [ ] 401 (invalid / missing) / 403 (wrong scope) / 429 (rate-limit) / 410 (revoked) shaped as RFC 7807 problem+json
- [ ] One canary handler `GET /api/v1/_ping` that returns `{ ok: true, org_id }` purely to exercise the middleware

**Testing plan:**
- [ ] Valid key + `read:consent` scope → canary returns 200 with caller's org_id
- [ ] Missing header → 401
- [ ] Revoked key → 410
- [ ] Wrong scope → 403
- [ ] Rate-limit exceeded → 429 with Retry-After
- [ ] Cross-org: key from org A cannot reach resources of org B (RLS enforces)

**Status:** `[ ] planned`

#### Sprint 2.3: Dashboard UI for key management

**Estimated effort:** 2 days

**Deliverables:**
- [ ] `/dashboard/settings/api-keys` list page (customer app)
- [ ] Create flow: name, scopes (multiselect from allowed list), rate_tier inferred from plan
- [ ] Plaintext-reveal modal shown exactly once, with "copy to clipboard" + "I have saved this key" confirmation
- [ ] Rotate button with dual-window visualisation ("old key valid until …")
- [ ] Revoke button with confirmation
- [ ] Last-used-at + created-at columns
- [ ] Empty state + zero-keys call-to-action

**Testing plan:**
- [ ] Manual flow: mint → copy → call `/v1/_ping` with it → 200
- [ ] Rotate → old key still works for 24h, new key works immediately
- [ ] Revoke → immediately 410
- [ ] UI rejects scope selection exceeding the key-creator's own entitlement

**Status:** `[ ] planned`

#### Sprint 2.4: Rate limiter integration + audit log + plan wiring

**Estimated effort:** 2 days

**Deliverables:**
- [ ] Per-tier window config pulled from `public.plans` join (columns: `api_rate_limit_per_hour`, `api_burst`)
- [ ] ADR-0010 rate limiter called with `key_id` bucket
- [ ] Every `/api/v1/*` response records a row in `public.api_request_log` (async via pg trigger or explicit INSERT in finally block)
- [ ] Retention policy: pg_cron daily job drops partitions older than 90 days
- [ ] Dashboard page `/dashboard/settings/api-keys/[id]/usage` charts last 7 days of request counts + p50/p95 latency
- [ ] OpenAPI stub at `app/public/openapi.yaml` with `securitySchemes.bearerAuth` and the `_ping` endpoint

**Testing plan:**
- [ ] Burst test: 200 req/sec on a Starter-tier key → limiter triggers 429 at 100/hr window
- [ ] Audit log populated: `SELECT count(*) FROM api_request_log WHERE key_id = $1 AND occurred_at > now()-interval '1 min'` correct
- [ ] Retention: backfill a 95-day-old partition; cron drops it
- [ ] OpenAPI stub validates via `redocly lint`

**Status:** `[ ] planned`

### Phase 3: Exit gate

#### Sprint 3.1: End-to-end smoke + security review prep

**Estimated effort:** 1 day

**Deliverables:**
- [ ] End-to-end smoke: mint key in prod-like env → hit canary → verify audit log → rotate → verify dual-window → revoke → verify 410
- [ ] Security review checklist (prep for CC-D): threat model of API-key surface, token-in-URL avoidance, logging redaction, key-prefix search ergonomics
- [ ] Status update to whitepaper Appendix E: `cs_live_*` key issuance moved to Shipping

**Testing plan:**
- [ ] Full scenario captured in `tests/integration/api-keys.e2e.test.ts`
- [ ] Manual penetration probe: key prefix collision impossible (64 bits of entropy minimum); hashed-secret lookup constant-time; no plaintext ever in logs

**Status:** `[ ] planned`

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
