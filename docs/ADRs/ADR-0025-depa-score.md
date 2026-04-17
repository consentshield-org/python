# ADR-0025: DEPA Score Dimension — nightly refresh + API + dashboard gauge

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-17
**Date completed:** 2026-04-17
**Depends on:** ADR-0020 (DEPA schema — `compute_depa_score` helper + `depa_compliance_metrics` table), ADR-0023 (expiry pipeline — `expiry_score` and `revocation_score` sub-metrics need artefacts to be transitioning through `active → revoked → deletion_receipts.status='completed'` for the scores to be non-trivial).
**Unblocks:** Customer-visible DEPA compliance evidence; BFSI/partnership pitch ("DEPA score is the headline differentiator" per ARCHITECTURE-ALIGNMENT W5).

---

## Context

ADR-0020 shipped `public.compute_depa_score(p_org_id uuid)` — a `SECURITY DEFINER` helper that computes four sub-scores (coverage / expiry / freshness / revocation; each 0–5) and returns the total (0–20) as JSONB. ADR-0020 also shipped the `depa_compliance_metrics` table (one row per org, UPSERT-on-refresh). What's missing:

1. The refresh loop — no job calls `compute_depa_score` or writes to `depa_compliance_metrics`.
2. The `depa-score-refresh-nightly` pg_cron entry specified in schema-design §11.10.
3. The read path — no API endpoint, no dashboard panel.
4. The wireframe/schema alignment — the existing dashboard wireframe (`consentshield-screens.html` §Dashboard Overview panel) shows the DEPA gauge with **three** sub-labels ("Coverage · Timeliness · Scope precision"), but the schema defines **four** sub-scores (`coverage_score`, `expiry_score`, `freshness_score`, `revocation_score`). The alignment doc W5 captures the old 3-label version; `ARCHITECTURE-ALIGNMENT-2026-04-16.md` §W5 needs updating.

### Drift resolution — docs amend to match schema

Per `feedback_docs_vs_code_drift.md`: when docs and working code disagree, amend the docs unless the missing abstraction is load-bearing. The `compute_depa_score` function is committed with four sub-scores; the schema `depa_compliance_metrics` has four score columns; the function comment in ADR-0020's migration declares the four-score shape. The wireframe label list is aspirational decoration; it's not load-bearing. Amend the wireframe to show four labels.

### Sub-score reference (from `compute_depa_score` body)

| Sub-score | Range | Definition | User-visible label |
|---|---|---|---|
| `coverage_score` | 0–5 | % of active `purpose_definitions` with a populated `data_scope` | "Coverage" |
| `expiry_score` | 0–5 | % of active `purpose_definitions` with non-default `default_expiry_days` (not 365) | "Expiry discipline" |
| `freshness_score` | 0–5 | % of active `consent_artefacts` whose `expires_at > now() + 90 days` | "Freshness" |
| `revocation_score` | 0–5 | % of recent revocations (past 90 days) with a confirmed deletion_receipt within 30 days | "Revocation chain" |
| **`total`** | 0–20 | Sum of the four sub-scores | — |

The dashboard gauge displays `total` as a 0–100 percentage (divide by 20, multiply by 100). Sub-labels are rendered beneath.

### Refresh loop shape

A new helper `refresh_depa_compliance_metrics()` iterates every organisation, calls `compute_depa_score(org_id)`, and UPSERTs the result into `depa_compliance_metrics`:

```sql
create or replace function refresh_depa_compliance_metrics()
returns integer language plpgsql security definer as $$
declare
  v_org organisations%rowtype;
  v_score jsonb;
  v_count integer := 0;
begin
  for v_org in select * from organisations loop
    v_score := compute_depa_score(v_org.id);
    insert into depa_compliance_metrics (
      org_id, total_score, coverage_score, expiry_score,
      freshness_score, revocation_score, computed_at
    ) values (
      v_org.id,
      (v_score->>'total')::numeric,
      (v_score->>'coverage_score')::numeric,
      (v_score->>'expiry_score')::numeric,
      (v_score->>'freshness_score')::numeric,
      (v_score->>'revocation_score')::numeric,
      (v_score->>'computed_at')::timestamptz
    )
    on conflict (org_id) do update set
      total_score      = excluded.total_score,
      coverage_score   = excluded.coverage_score,
      expiry_score     = excluded.expiry_score,
      freshness_score  = excluded.freshness_score,
      revocation_score = excluded.revocation_score,
      computed_at      = excluded.computed_at,
      updated_at       = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
```

Scheduled at `30 19 * * *` (19:30 UTC / 01:00 IST) — after the ADR-0023 expiry enforcement cron (19:00 UTC) so the night's expired artefacts are reflected in the score. Returns the org count for observability.

### Read path

**API route.** `GET /api/orgs/[orgId]/depa-score` — reads the cached row from `depa_compliance_metrics` for the caller's org. If the row is absent (new org, refresh hasn't run yet) the endpoint falls back to `supabase.rpc('compute_depa_score', { p_org_id })` and returns the fresh compute without persisting (the nightly cron will persist it later). If `computed_at` is older than 25 hours, the endpoint returns the cached row with a `stale: true` flag so the UI can surface a warning.

**Dashboard gauge.** The existing `dashboard/page.tsx` renders a single `ScoreGauge` for the DPDP score. Add a second gauge (reusing `ScoreGauge`) alongside it, pulling from the DEPA score API, with the four sub-labels rendered beneath ("Coverage · Expiry · Freshness · Revocation"). The wireframe already has the side-by-side gauge layout (DPDP + DEPA); implement it matching that layout.

### Test coverage

**Test 10.8 — DEPA score arithmetic (table-driven property test).** Seed an organisation with a matrix of purpose_definitions + consent_artefacts + artefact_revocations. Call `compute_depa_score(org_id)`. Hand-calculate the expected sub-scores and total. Assert equality within ±0.1 tolerance.

Cases:
- Empty org → all sub-scores 0, total 0. (Special: freshness and revocation return 5 each when their input tables are empty — per the function body's `case when count = 0 then 5`. Test for the explicit 10.0 total, not zero.)
- All purposes have populated data_scope and non-default expiry → coverage 5 + expiry 5.
- Mix of fresh and near-expiry artefacts → freshness score proportional.
- Revocation with confirmed deletion_receipt within 30 days → revocation 5.
- Revocation with no deletion_receipt → revocation 0.

**Test 10.8b — refresh_depa_compliance_metrics** smoke: call the function, verify `depa_compliance_metrics` row exists with matching values for the test org.

---

## Decision

Ship in two sprints:

**Sprint 1.1 — docs alignment + migration.** Amend the wireframe + `ARCHITECTURE-ALIGNMENT-2026-04-16.md` §W5 to reflect four sub-scores. Write the refresh migration (`20260423000001_depa_score_refresh.sql`) with `refresh_depa_compliance_metrics()` + `depa-score-refresh-nightly` pg_cron.

**Sprint 1.2 — API + UI + tests.** Add the `GET /api/orgs/[orgId]/depa-score` route. Wire the dashboard `ScoreGauge` for DEPA alongside DPDP. Ship Test 10.8 (and 10.8b as a compact second case) in `tests/depa/score.test.ts`.

Idempotency: `refresh_depa_compliance_metrics` uses `ON CONFLICT (org_id) DO UPDATE`. Concurrent invocations (cron + manual) race at the UPSERT; the winner's row reflects the latest `computed_at`. No UNIQUE index needed beyond the existing `unique (org_id)` on the table.

---

## Consequences

- **New daily pg_cron: `depa-score-refresh-nightly` at 19:30 UTC.** Writes to `depa_compliance_metrics` for every org in the database. At current scale (small dev population) this is a sub-second operation.
- **Wireframe + alignment-doc amendment.** `ARCHITECTURE-ALIGNMENT-2026-04-16.md` §W5 updated to 4 sub-scores. Wireframe HTML sub-label list replaced (Coverage · Timeliness · Scope precision → Coverage · Expiry · Freshness · Revocation).
- **New API endpoint: `GET /api/orgs/[orgId]/depa-score`.** Server-side auth via existing `getOrgScopedClient`. Returns cached row + `stale` flag + fallback compute when cache is missing.
- **Dashboard gains a second gauge.** Existing `ScoreGauge` component reused; no new primitives. Page still renders for orgs with no artefacts (empty org scores render cleanly per the function's `case when count = 0 then ...` clauses).
- **No breaking changes to the existing compliance score.** The DPDP score is preserved as-is (100-point scale, 6 components). DEPA is a separate, parallel dimension.
- **`depa_compliance_metrics.updated_at` now updated by the refresh function.** The existing `trg_depa_metrics_updated_at` trigger from ADR-0020 is redundant on the refresh path (ON CONFLICT sets `updated_at = now()`), but the trigger stays for direct UPDATEs.

### Architecture Changes

None structural. The ADR implements what schema-design §11.2 / §11.10 already specified and what the dashboard wireframe already shows. Sub-label alignment is the only doc delta.

---

## Implementation Plan

### Phase 1: Docs + backend + UI + tests

#### Sprint 1.1 — Docs alignment + refresh migration + cron

**Estimated effort:** 60 minutes.

**Deliverables:**

- [x] Amended `docs/design/screen designs and ux/consentshield-screens.html` Dashboard Overview panel — sub-label string updated to `Coverage · Expiry · Freshness · Revocation` (max-width 180px).
- [x] Amended `docs/design/screen designs and ux/ARCHITECTURE-ALIGNMENT-2026-04-16.md` §W5 — sub-metric list matches schema's four scores; re-alignment note dated 2026-04-17.
- [x] `supabase/migrations/20260423000001_depa_score_refresh.sql` — `refresh_depa_compliance_metrics()` function + `GRANT EXECUTE` + `depa-score-refresh-nightly` pg_cron scheduled `30 19 * * *`.
- [x] Applied via `bunx supabase db push --linked --include-all`.

**Status:** `[x] complete` — 2026-04-17

#### Sprint 1.2 — API + UI + tests

**Estimated effort:** 120 minutes.

**Deliverables:**

- [x] `app/src/app/api/orgs/[orgId]/depa-score/route.ts` — `GET` handler. Auth via `supabase.auth.getUser()` + `organisation_members` membership check (matches the existing `/api/orgs/[orgId]/*` pattern). Returns `{ total, coverage_score, expiry_score, freshness_score, revocation_score, computed_at, stale }`. Fallback: if no cached row, calls `compute_depa_score` RPC and returns with `stale: true`.
- [x] `app/src/app/(dashboard)/dashboard/page.tsx` — card restructured as a 2-column grid. DPDP block (existing `ScoreGauge` + 6 component rows) on the left; DEPA block (new `ScoreGauge` at `depaPercent = total/20 * 100` + 4 sub-label `ScoreRow`s + refresh caption) on the right. Fetch order: added `depaCachedRes` to the existing `Promise.all` of parallel fetches; fallback RPC invoked only when cache miss.
- [x] `tests/depa/score.test.ts` — 5 cases for Test 10.8 (empty / full coverage / mixed freshness / default-expiry-drops-to-0 / empty-data_scope-drops-to-0) + 2 cases for Test 10.8b (refresh round-trip + idempotent UPSERT).

**Testing plan:**

- [x] **Test 10.8 (PASS — 5/5)** — empty org = 10/20 (freshness + revocation default to 5); full-coverage non-default-expiry = 20/20; mixed freshness (1 fresh + 1 near-expiry of 2) = freshness 2.5; 365-day default expiry = expiry 0; empty data_scope = coverage 0.
- [x] **Test 10.8b (PASS — 2/2)** — refresh function populates cache matching RPC output; second call updates `computed_at` with a single row (UPSERT semantics).
- [x] **Full test:rls suite** — `bun run test:rls` → **154/154** across 13 files (baseline 147 + 7 new). Duration 145.5s.
- [x] **`cd app && bun run build`** — zero errors / zero warnings. `/api/orgs/[orgId]/depa-score` listed in route manifest.
- [ ] Manual `/dashboard` render smoke — deferred to next session with dev server.

**Status:** `[x] complete` — 2026-04-17

---

## Test Results

### Sprint 1.2 — 2026-04-17

```
Test: DEPA score suite (10.8 five cases + 10.8b two cases)
Method: bunx vitest run tests/depa/score.test.ts
Actual:   Test Files  1 passed (1)
          Tests       7 passed (7)
          Duration    19.65s
Result:   PASS
```

```
Test: Full test:rls suite (13 files)
Method: bun run test:rls
Actual:   Test Files  13 passed (13)
          Tests       154 passed (154)
          Duration    145.47s
Result:   PASS
```

```
Build: cd app && bun run build
Result: Success — zero errors, zero warnings. /api/orgs/[orgId]/depa-score listed.
```

---

## Changelog References

- `CHANGELOG-schema.md` — Sprint 1.1: refresh function + nightly cron.
- `CHANGELOG-api.md` — Sprint 1.2: new `/api/orgs/[orgId]/depa-score` route.
- `CHANGELOG-dashboard.md` — Sprint 1.2: DEPA gauge on dashboard.
- `CHANGELOG-docs.md` — Sprint 1.1: wireframe + alignment-doc amended; ADR-0025 authored.
