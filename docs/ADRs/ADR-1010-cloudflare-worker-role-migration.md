# ADR-1010: Cloudflare Worker — scoped-role migration off HS256 JWT

**Status:** Proposed
**Date proposed:** 2026-04-21
**Date completed:** —
**Superseded by:** —

---

## Context

The Cloudflare Worker (`worker/src/`) authenticates to Supabase REST using `SUPABASE_WORKER_KEY` — an HS256 JWT claiming `role: cs_worker`, signed with the project's **legacy HS256 shared secret**. PostgREST respects the `role` claim and executes subsequent queries as `cs_worker` (INSERT into `consent_events` / `tracker_observations`; SELECT from `consent_banners` / `web_properties`; UPDATE only `web_properties.snippet_last_seen_at`).

Discovered during ADR-1009 Phase 2 (2026-04-21): Supabase has rotated the project's JWT signing keys from HS256 (shared secret) to **ECC P-256 (asymmetric)**. The dashboard now shows:

- **Current key:** ECC P-256 (Supabase holds the private key — we cannot sign new role JWTs from our side).
- **Previous key:** Legacy HS256 shared secret (flagged "Previously used, 8 days ago"; slated for revocation once all HS256-signed tokens have expired).

`SUPABASE_WORKER_KEY` is an HS256 token with no expiry (scoped-role JWTs have historically been long-lived). It keeps verifying as long as the legacy HS256 key is kept alive for verification. When Supabase (or the user) revokes the legacy key, every `/rest/v1/*` call from the Worker stops working:

- Banner script delivery (`GET /v1/banner.js`) → 401 → the banner fails to load → customer websites show no consent UI.
- Consent event ingestion (`POST /v1/events`) → 401 → consent state never reaches the pipeline.
- Tracker observation ingestion (`POST /v1/observations`) → 401 → trackers go unmonitored.
- Worker error logging (`worker_errors` INSERT) → 401 → operator dashboards go silent.
- Banner signing-secret verification (reads `web_properties.event_signing_secret`) → 401 → every event's HMAC check fails.

This is a timer-driven production break, not a deferred feature. The runway is whatever window Supabase keeps the legacy key verifying.

The same architectural problem will hit any other customer surface that uses HS256-signed scoped-role JWTs. Currently that's limited to the Worker (ADR-1009 already migrated the customer-app `/v1/*` handlers to `cs_api` via direct Postgres; `cs_delivery` / `cs_orchestrator` / `cs_admin` already used direct-Postgres connections from Edge Functions and never depended on HS256 JWTs).

## Decision

Migrate the Worker off the HS256 `cs_worker` JWT to a mechanism that survives the JWT signing-key rotation.

Cloudflare Workers introduce a wrinkle: they don't run `postgres.js` cleanly (raw TCP sockets aren't the native primitive; Workers have HTTP + `connect()` API and a growing TCP surface but postgres.js's connection management isn't a drop-in fit). Three candidate mechanisms:

- **A. Cloudflare Hyperdrive** — Cloudflare's Postgres connection pooler / proxy. Speaks the Postgres wire protocol. Works with `postgres.js` and `pg` from Workers. Supabase is a first-class origin. The Worker connects to Hyperdrive; Hyperdrive connects to the Supavisor pooler as `cs_worker`.
- **B. Supabase Data API (REST over `sb_secret_*`)** — the new opaque-token gateway. Works today for the Edge Function path (with `--no-verify-jwt`; see V2-K1). Not yet fully clean at the gateway level; waiting on Supabase to close the format gap.
- **C. Minimal Workers-native Postgres client** — hand-rolled 200–300 line TCP client using Workers' `connect()` API. Avoids Hyperdrive dependency. More surface to maintain.

Leaning toward **A (Hyperdrive)** for production strength + low code lift, but all three deserve a prototype before committing. This ADR captures the migration scope and defers the mechanism choice to Phase 1 Sprint 1.1 research.

## Consequences

Worker hardens against the JWT rotation. Same ADR-1009 pattern extended to the Worker. `SUPABASE_WORKER_KEY` (HS256 JWT) is removed from wrangler secrets; replaced with `SUPABASE_WORKER_DATABASE_URL` (Supavisor pooler connection string as `cs_worker`) or Hyperdrive binding (as chosen in Sprint 1.1).

Consent ingestion — the highest-volume path on the platform — moves from PostgREST to native Postgres. Expected p50 improvement: REST adds JSON-in-JSON-out overhead; direct Postgres is a binary protocol with fewer hops. Expected p99 impact: mixed; Hyperdrive adds a pooler hop but amortizes across connections.

Rule 5 (CLAUDE.md) reaffirmed — the Worker remains scoped to `cs_worker`, no service-role credential acquired.

**What this does not change:** the Worker's zero-npm-dep policy (Rule 16). Whatever library is picked must be Worker-native (`node:*` compatibility shim OK if bundled) or hand-rolled. `postgres.js` uses `Node`-only APIs and is not Worker-compatible without a compat shim.

---

## Implementation Plan

### Phase 1 — Research + mechanism choice

**Goal:** Pick A / B / C based on a prototype against dev DB.

#### Sprint 1.1 — Prototype all three
**Estimated effort:** 1 day

**Deliverables:**
- [ ] Create a scratch Worker route `/v1/_cs_api_probe` that attempts `select 1` as `cs_worker` via each mechanism:
  - A: Hyperdrive binding + `postgres.js` (or Cloudflare's documented Hyperdrive client).
  - B: Supabase REST with `sb_secret_*`-shaped credential (noting the gateway-JWT issue).
  - C: hand-rolled TCP postgres client (use a community reference implementation, e.g. `@workers-pg/core` if Workers-compatible, else custom).
- [ ] Measure: connection establishment latency, query p50/p99, bundle-size impact on the Worker, operational footprint (extra dashboard/configuration required).
- [ ] Decide the mechanism in an ADR-1010 amendment; rip out the other two probes.

**Testing plan:**
- [ ] Each probe returns `[{ ?column? : 1 }]` and logs the elapsed ms.
- [ ] Revoke-simulation: temporarily set `SUPABASE_WORKER_KEY` to an invalid value; the legacy HS256 path 401s as expected; the chosen new mechanism still works.

**Status:** `[ ] planned`

### Phase 2 — Cs_worker LOGIN readiness

**Goal:** Make sure `cs_worker` is ready to receive direct connections, however the Worker ends up connecting.

#### Sprint 2.1 — Password + env + pool sanity
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] Verify `cs_worker` is LOGIN-enabled (check `pg_roles.rolcanlogin`). The migration `20260413000010` sets `with login password 'cs_worker_change_me'`; rotate out-of-band if not already rotated.
- [ ] Store rotated password in `.secrets` as `CS_WORKER_PASSWORD`; build `SUPABASE_WORKER_DATABASE_URL` (Supavisor pooler, transaction mode: port 6543). Mirror into wrangler secrets.
- [ ] Confirm `cs_worker` can connect via psql against the pooler; `select current_user;` returns `cs_worker`.
- [ ] Confirm the existing grant set (`INSERT on consent_events + tracker_observations`; `SELECT on consent_banners + web_properties`; `UPDATE (snippet_last_seen_at) on web_properties`; `INSERT on worker_errors`) works via direct Postgres.

**Testing plan:**
- [ ] Integration test skipped-on-missing-env (same pattern as `tests/integration/cs-api-role.test.ts`): `cs_worker` via postgres.js can INSERT `consent_events` and SELECT `consent_banners` but cannot SELECT `organisations`.

**Status:** `[ ] planned`

### Phase 3 — Worker rewrite

**Goal:** Swap the `fetch(${SUPABASE_URL}/rest/v1/...)` call sites in the Worker source to the chosen mechanism.

#### Sprint 3.1 — banner.ts + origin.ts + signatures.ts (read paths)
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Replace the REST fetches in `worker/src/banner.ts`, `origin.ts`, `signatures.ts` with the chosen mechanism.
- [ ] Miniflare test harness at `app/tests/worker/` continues to pass — extend it with the new mock if the mechanism introduces new bindings.

**Testing plan:**
- [ ] Banner delivery harness test (serve banner.js for a seeded web_property) returns the expected compiled script.

**Status:** `[ ] planned`

#### Sprint 3.2 — events.ts + observations.ts + worker-errors.ts (write paths)
**Estimated effort:** 0.5 day

**Deliverables:**
- [ ] Replace the REST fetches in `worker/src/events.ts`, `observations.ts`, `worker-errors.ts` with the chosen mechanism.
- [ ] Preserve Rule 16 — Worker's npm-dep budget remains zero (either no dep, or the chosen mechanism's Worker-native library).

**Testing plan:**
- [ ] Consent event ingestion integration test (full HMAC + origin + INSERT path) passes.
- [ ] Tracker observation ingestion test passes.
- [ ] Worker-error INSERT test: a deliberately-malformed event produces a `worker_errors` row.

**Status:** `[ ] planned`

### Phase 4 — Cutover + deprecation

#### Sprint 4.1 — Wrangler secret swap + legacy removal
**Estimated effort:** 0.25 day

**Deliverables:**
- [ ] `wrangler secret put SUPABASE_WORKER_DATABASE_URL` (or Hyperdrive binding config).
- [ ] `wrangler secret delete SUPABASE_WORKER_KEY` — remove the HS256 JWT. Redeploy.
- [ ] `.wolf/cerebrum.md` — update the "Worker uses cs_worker via HS256 JWT" Key Learning to "Worker uses cs_worker via direct Postgres / Hyperdrive (ADR-1010)."
- [ ] `docs/architecture/consentshield-definitive-architecture.md` §5.4 — update cs_worker block to note the direct-Postgres connection.
- [ ] V2-BACKLOG — ADR-1009 follow-up entry moves to the Closed section with "→ ADR-1010".

**Testing plan:**
- [ ] Production smoke: fetch a deployed banner.js from a seeded property; POST a signed test event; verify `consent_events` row appears.
- [ ] Synthetic HS256 revoke: there isn't an easy local reproduction, but the Phase 1 probe already established the new mechanism doesn't depend on HS256. Document the canary in the ADR.

**Status:** `[ ] planned`

---

## Architecture Changes

To be recorded at Phase 4 close:

- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_worker block updated to reflect direct Postgres (or Hyperdrive) connection; the "SUPABASE_WORKER_KEY=<cs_worker password>" env line changed to the new variable name.
- `.wolf/cerebrum.md` — stale HS256 JWT learning corrected, replaced with the new mechanism.

---

## Test Results

_Populated per sprint._

---

## Changelog References

- CHANGELOG-worker.md — Sprint 3.1 / 3.2 Worker rewrites
- CHANGELOG-schema.md — Phase 2 cs_worker password rotation (if any migration is needed for role grants tweak)
- CHANGELOG-infra.md — Sprint 4.1 wrangler secret swap
- CHANGELOG-docs.md — Phase 4 doc sync
