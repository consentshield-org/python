# ADR-1026: Rewind ADR-1010 Phase 3 — Worker connects directly to Supavisor; drop Hyperdrive binding

**Status:** Proposed
**Date proposed:** 2026-04-24
**Date completed:** —
**Supersedes (partial):** ADR-1010 Phase 3 Sprint 3.1's *mechanism* choice (Hyperdrive binding). All other Phase 3/4 work — `cs_worker` scoped role, direct-Postgres via `postgres.js`, Supavisor transaction pooler as the origin, Rule 16 carve-out, `SUPABASE_WORKER_KEY` retirement, role-guard removal, 20/20 Miniflare harness — stays intact.
**Upstream dependency:** —
**Related:** ADR-1010 (Worker scoped-role migration), ADR-1013 (cs_orchestrator direct-Postgres — same mechanism pattern, already Hyperdrive-free).

---

## Context

### What ADR-1010 Phase 3 bought — and what it actually delivered

ADR-1010 Phase 3 Sprint 3.1 introduced Cloudflare Hyperdrive as the *transport* between the Worker and Supabase. The rationale in that sprint:

> "Hyperdrive is itself a connection pool; opening a postgres.js client against its connection string is cheap — it reuses the underlying pooled connection."

The implicit bets:
1. Hyperdrive's edge-side pool cuts the first-query TCP+TLS+auth round-trip to Supavisor.
2. Hyperdrive's optional query-result caching will later absorb read load.
3. Hyperdrive's observability panel is useful.

Seven weeks in, none of those bets have paid:

| Promised | Actually delivered |
|---|---|
| Cut cold-start latency | Banner config is cached in `env.BANNER_KV` for 300 s. Cold path is already rare, and when it fires, Hyperdrive's cold-path is no cheaper than a direct Supavisor TCP handshake (≈300–800 ms from APAC edges either way). |
| Query-result caching | Never turned on. The Worker uses `postgres.prepare: false` (CLAUDE.md Rule 16 carve-out comment — statement-preparation conflicts with Supavisor transaction-mode pool). Hyperdrive's cache is prepared-statement keyed. We get nothing. |
| Observability panel | Dashboard shows "0 metrics" for long stretches. `wrangler tail` is our real observability. |
| Burst handling | Dev traffic is < 100 req/day. "Burst" is not a workload we have. |

And Hyperdrive has added two concrete failure surfaces that Phase 3/4 did not anticipate:

### Incident 1 — pool saturation (bug-725 / bug-726, 2026-04-23 → 24)

A broken iteration of Sprint 4.2 scheduled `ctx.waitUntil(sql.end({timeout:1}))` inside `openRequestSql`, flipping postgres.js into an "ending" state before queries ran. Every banner request rejected with `CONNECTION_ENDED` and left a half-open socket from Hyperdrive to Supavisor. Hours of that burst exhausted the upstream pool. Subsequent queries hit SQLSTATE 58000 ("Timed out while waiting for an open slot in the pool"). `pg_stat_activity` showed zero `cs_worker` sessions — the pool was full of zombie connections that Hyperdrive could not reap. Recovery required:

1. `wrangler hyperdrive delete` on the stuck config.
2. `wrangler hyperdrive create` for a fresh config (binding ID change → `worker/wrangler.toml` update → re-deploy).
3. CF dashboard pre-save password validation additionally cool-off-rejected from Supavisor (Supavisor appears to rate-limit CF's control-plane IPs after failed-auth bursts). CLI path (`wrangler hyperdrive update`) bypasses that validation, so that was the only way to push the correct password.
4. CF API token required `Account › Hyperdrive › Edit`, which a narrowly-scoped token lacked (code 10000 on every Hyperdrive API call).

No code change could have prevented this class of failure as long as Hyperdrive sits between us and Supavisor — the pool is Hyperdrive's, not ours, and it is not observably resettable.

### Incident 2 — intermittent `CONNECTION_CLOSED` mid-query (ongoing)

After Sprint 4.2 shipped green (10/10 probes, cold 796 ms / warm 55–140 ms), subsequent probe bursts regressed to 15-second `CONNECTION_CLOSED` failures to `*.hyperdrive.local:5432`. The same cs_worker credential over the same Supavisor endpoint via direct `psql` continued to complete in < 100 ms. This is the documented Hyperdrive-plus-transaction-mode-pooler flakiness discussed in CF community threads. Our workload sits in the intersection that produces it — we can't "fix" it from the Worker.

### The architectural comparison

With Hyperdrive:

```
Worker isolate → Hyperdrive edge pool → Hyperdrive-to-Supavisor pool → Supavisor (6543, transaction mode) → Postgres
       │               │                         │
       │               │                         └─ bug-726: zombie connections, 58000
       │               └─ intermittent: CONNECTION_CLOSED mid-query
       └─ app code
```

Without Hyperdrive:

```
Worker isolate → Supavisor (6543, transaction mode) → Postgres
       │               └─ same pooler cs_orchestrator already talks to via Supavisor directly (ADR-1013)
       └─ app code
```

Supavisor *is* a connection pool. Hyperdrive has been a pool-of-pools. The two layers don't compose cleanly for our case.

### Why now

- Sprint 4.2 shipped. cs_worker's direct-Postgres work is stable; only the *transport wrapper* is flaky.
- ADR-1013 already has cs_orchestrator going to Supavisor directly via `postgres.js` from the Next.js runtime on Vercel — the pattern is battle-tested in-repo.
- Cloudflare Workers' outbound TCP via `nodejs_compat` is GA and we already have the flag set in `worker/wrangler.toml` for postgres.js.
- The drop is low-risk: every piece of Phase 3/4 work stays; one binding disappears.

## Decision

1. The Worker connects `postgres.js` **directly** to the Supabase Supavisor transaction pooler `aws-1-ap-northeast-1.pooler.supabase.com:6543` as `cs_worker.<project_ref>`, using a connection string stored as a Wrangler secret `CS_WORKER_DSN`.
2. The `[[hyperdrive]]` binding in `worker/wrangler.toml` is removed. `Env.HYPERDRIVE` is removed from `worker/src/index.ts`.
3. `worker/src/db.ts` `openRequestSql(env)` reads `env.CS_WORKER_DSN` instead of `env.HYPERDRIVE.connectionString`. All call-site signatures (`sql: Sql | null` parameter, deferred `ctx.waitUntil(sql.end())` in the fetch handler) are unchanged — Sprint 4.2's lifecycle correctness is preserved.
4. postgres.js options stay as Sprint 4.2 tuned them: `max: 5, prepare: false, fetch_types: false, connect_timeout: 30`. These options are Supavisor-appropriate; nothing in them was Hyperdrive-specific.
5. Hyperdrive config `cs-worker-hyperdrive-v2` (`87c60a8ac9b741e38b9abb24d74690cd`) is deleted at the end of Phase 1 Sprint 1.4 after a 7-day quiet period confirms no rollback is needed.

### What stays (non-negotiable — the rewind is narrow)

- **Scoped role `cs_worker`** — INSERT on `consent_events` + `tracker_observations` (column-grant limited), SELECT on `consent_banners` + `web_properties` + `tracker_signatures`, UPDATE on `web_properties.snippet_last_seen_at`. No privilege change.
- **Rule 16 / CLAUDE.md carve-out** — `postgres@3.4.9` remains the single permitted Worker dependency. The rule text is tightened to drop the Hyperdrive-specific phrasing, but the carve-out itself is unchanged. Rewording in Phase 1 Sprint 1.5.
- **Rule 5 / CLAUDE.md** — cs_worker password never in `NEXT_PUBLIC_*`, never committed, stored as `wrangler secret`. Unchanged.
- **Miniflare suite (20/20)** — no test depends on Hyperdrive. REST fallback path already exists for the harness and stays.
- **cs_delivery, cs_orchestrator** — unaffected. Neither uses Hyperdrive. (cs_orchestrator already goes Supavisor-direct per ADR-1013.)
- **Phase 4 cutover** — `SUPABASE_WORKER_KEY` stays deleted. No HS256 re-introduction.

### What changes in infra

- **New Wrangler secret:** `CS_WORKER_DSN` = full connection URI including the password the `.secrets` file already holds. Added via `wrangler secret put`, never committed.
- **`worker/wrangler.toml`:** `[[hyperdrive]]` block removed. Optional addition of a comment pointing at this ADR so a future reader doesn't re-add it out of habit.
- **Deleted:** Hyperdrive config `87c60a8ac9b741e38b9abb24d74690cd` (end of Phase 1).

## Consequences

### Enables

- **Removes the class of failure surfaced in bug-725 and bug-726.** The Worker now owns its own pool behaviour end-to-end via `postgres.js`. Pool state is resettable by redeploying the Worker.
- **Aligns Worker and Next.js runtime mechanisms.** Both the Worker and the customer app now talk to Supavisor directly via `postgres.js`. One less pattern for operators to hold in their head. ADR-1010 and ADR-1013 converge.
- **Operator troubleshooting simplifies.** `wrangler tail` + `pg_stat_activity` are the full story. No Hyperdrive dashboard to cross-reference; no CF API token permission dance for Hyperdrive-specific operations.

### New constraints

- **Cold-start latency.** Without Hyperdrive's warm edge pool, the Worker's first query after an idle period runs through a full TCP + TLS + auth handshake to Tokyo Supavisor. We measured Sprint 4.1 on Hyperdrive at ~2.9 s cold and Sprint 4.2 at ~800 ms cold. Post-ADR-1026 cold is expected in the 400–900 ms range from APAC edges — within Sprint 4.2's observed envelope. The `env.BANNER_KV` 300-s cache absorbs the great majority of requests; cold is rare.
- **Warm pool reuse is now Worker-isolate-local.** Cloudflare's Workers runtime reuses isolates for subsequent requests, so the `postgres.js` client's open TCP connection survives across requests within the same isolate's lifetime. Across isolate boundaries, each new isolate re-handshakes. This is the same reuse behaviour we already rely on for `openRequestSql`'s `max: 5` pool to matter.
- **cs_worker password lives in one more place.** It is already in `.secrets` and at Supavisor; it now also needs to be in `wrangler secret` as `CS_WORKER_DSN`. `.secrets` rotation runbook grows a single `wrangler secret put` step.

### New failure modes

- **Supavisor availability is now a hard dependency with no edge buffer.** If Supavisor is offline, the Worker's banner + events + observations endpoints fail immediately. Previously Hyperdrive's cached queries (though we didn't use them) could have masked transient blips. In practice: banner config lives in KV for 5 min, events/observations return 202 on failure (CLAUDE.md §"modifying the CF Worker" rule 5) — so a 5-minute Supavisor blip is invisible to customer websites, matching today's behaviour.
- **TCP connection reuse within an isolate is Cloudflare-runtime-version-sensitive.** If a future workerd release changes idle-socket GC behaviour, warm latency could regress. Mitigation: cover with a smoke-test bench in Sprint 1.4 and a standing runbook check.

### What we're not doing

- **Not reintroducing SUPABASE_WORKER_KEY or any HS256 JWT.** Phase 4 cutover stands.
- **Not switching pooler mode.** Supavisor stays on transaction mode (port 6543). Session mode is untested in this stack and opens its own failure surface.
- **Not touching cs_delivery, cs_orchestrator, or the Edge Functions.** They already do the right thing.
- **Not changing Rule 16.** `postgres.js` stays the single permitted Worker dependency. The rule text gets a minor wording refresh to stop referencing Hyperdrive as the justification; the behaviour is unchanged.

---

## Implementation plan — Phase 1 only

Single phase, five sprints. No multi-phase scope inflation.

### Sprint 1.1 — Provision `CS_WORKER_DSN` as a Wrangler secret — [ ] planned

**Deliverables:**
- [ ] Construct the connection URI from existing `.secrets` values: `postgres://cs_worker.xlqiakmkdjycfiioslgs:<CS_WORKER_PASSWORD>@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?sslmode=require`.
- [ ] `wrangler secret put CS_WORKER_DSN` — push secret to the `consentshield-cdn` Worker.
- [ ] Verify via `wrangler secret list` that `CS_WORKER_DSN` appears, `HYPERDRIVE` is still listed (we haven't touched it yet).
- [ ] No code change in this sprint.

**Test:**
- `wrangler secret list` shows `CS_WORKER_DSN` present.
- Miniflare suite 20/20 PASS (unchanged — Miniflare uses REST fallback path).

### Sprint 1.2 — Update `worker/src/db.ts` to read `CS_WORKER_DSN` — [ ] planned

**Deliverables:**
- [ ] `openRequestSql(env): Sql | null` reads `env.CS_WORKER_DSN` (now `string | undefined`), returns `null` when absent (Miniflare REST-fallback branch unchanged).
- [ ] Postgres options (`max: 5, prepare: false, fetch_types: false, connect_timeout: 30`) unchanged.
- [ ] Comment block in `db.ts` revised to reference Supavisor directly; Hyperdrive references removed.
- [ ] `worker/src/index.ts` — `Env.HYPERDRIVE?` removed, `HyperdriveBinding` interface removed. `Env.CS_WORKER_DSN?: string` added. Fetch-handler body unchanged (still schedules `ctx.waitUntil(sql.end({timeout: 5}))` after the response).

**Test:**
- `bunx tsc --noEmit` clean.
- Miniflare suite 20/20 PASS.
- `wrangler deploy` succeeds (the Hyperdrive binding is still in `wrangler.toml` at this point, but not read by code — harmless).
- Live smoke: 10 probes. Success + latency target: cold < 1.5 s, warm < 200 ms (matches Sprint 4.2 or better). Confirms direct-Supavisor is viable before removing Hyperdrive.

### Sprint 1.3 — Remove `[[hyperdrive]]` from `worker/wrangler.toml` — [ ] planned

**Deliverables:**
- [ ] Delete the `[[hyperdrive]]` block. Replace with a one-line comment referencing this ADR and the fact that `CS_WORKER_DSN` is the direct-Supavisor mechanism.
- [ ] `wrangler deploy` — Worker redeploys without the binding. Wrangler's output no longer lists `env.HYPERDRIVE`.

**Test:**
- `wrangler deploy` output shows bindings without `HYPERDRIVE`.
- Live smoke: 10 probes identical to Sprint 1.2. No regression.
- One additional probe confirming `/v1/health` still 200s in < 100 ms.

### Sprint 1.4 — Bench cold + warm latency, publish the delta — [ ] planned

**Deliverables:**
- [ ] Run a 30-probe smoke (cold + warm) against `/v1/banner.js` and `/v1/health`. Record p50, p95, p99 and cold-start time.
- [ ] Publish the numbers in `CHANGELOG-worker.md` next to Sprint 4.2's numbers so the cold / warm delta is visible.
- [ ] If cold > 1.5 s p50 or warm > 250 ms p50, pause and decide whether to address before Sprint 1.5 (rollback = restore `[[hyperdrive]]` block). If within envelope, proceed.

**Test:**
- Smoke passes (green 30/30, within latency envelope).
- No regressions on `/v1/events` or `/v1/observations` (authenticated with test HMAC sig). 5/5 each.

### Sprint 1.5 — Sunset: delete Hyperdrive v2 config + refresh Rule 16 text — [ ] planned

**Deliverables:**
- [ ] Wait a calendar week from Sprint 1.4 close with no rollback trigger.
- [ ] `wrangler hyperdrive delete 87c60a8ac9b741e38b9abb24d74690cd`.
- [ ] Update `CLAUDE.md` Rule 16 to drop the "because Hyperdrive exposes only the PostgreSQL wire protocol" phrasing. Keep the carve-out; replace justification with "because Supavisor exposes only the PostgreSQL wire protocol — no HTTP surface — and hand-rolling the wire protocol is ~500 LOC of owned binary code." Exact-pin stays.
- [ ] Update `docs/architecture/consentshield-definitive-architecture.md` §5.4 (cs_worker block) to drop the Hyperdrive references. Replace with the direct-Supavisor mechanism.
- [ ] Close any lingering `admin.ops_readiness_flags` rows referencing Hyperdrive.

**Test:**
- `wrangler hyperdrive list` — empty (or only unrelated configs).
- Architecture doc review cross-checked against the code.
- No rollback path triggered in the preceding week.

---

## Test Results

_Populated per sprint._

---

## Acceptance criteria

- [ ] All 5 sprints complete.
- [ ] `worker/src/db.ts` reads `env.CS_WORKER_DSN`. No `env.HYPERDRIVE` reference in the repo.
- [ ] `worker/wrangler.toml` has no `[[hyperdrive]]` block.
- [ ] Hyperdrive config `87c60a8ac9b741e38b9abb24d74690cd` deleted.
- [ ] Sprint 1.4 bench results published in `CHANGELOG-worker.md`. Cold < 1.5 s p50 and warm < 250 ms p50 on the banner path.
- [ ] 20/20 Miniflare tests still pass.
- [ ] CLAUDE.md Rule 16 text refreshed.
- [ ] `docs/architecture/consentshield-definitive-architecture.md` §5.4 updated.

---

## Architecture Changes

To be recorded at Sprint 1.5 close:

- `docs/architecture/consentshield-definitive-architecture.md` §5.4 — cs_worker transport changes from Hyperdrive to direct Supavisor.
- `CLAUDE.md` Rule 16 — justification prose refresh (keep carve-out; drop Hyperdrive-specific language).
- `.wolf/cerebrum.md` — if a Hyperdrive-specific learning was recorded in ADR-1010 context, mark superseded.

---

## Changelog References

- `CHANGELOG-worker.md` — per-sprint entries.
- `CHANGELOG-infra.md` — Sprint 1.1 secret push + Sprint 1.5 Hyperdrive config deletion.
- `CHANGELOG-docs.md` — Sprint 1.5 CLAUDE.md + architecture doc refresh.
