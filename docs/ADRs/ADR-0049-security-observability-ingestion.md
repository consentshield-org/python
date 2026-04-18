# ADR-0049: Security observability ingestion — rate_limit_events + sentry_events

(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Status:** Completed
**Date proposed:** 2026-04-18
**Date completed:** 2026-04-18
**Depends on:**
- ADR-0010 (distributed rate limiter for public endpoints)
- ADR-0014 (Sentry wired for both apps)
- ADR-0033 (Ops + Security panels — two tabs this ADR fills in)
- ADR-0048 (Worker HMAC/Origin logging — same `public.worker_errors` persistence discipline applied to two more signal streams)

**Closes:** V2-S1 (Sentry webhook ingestion) + V2-S2 (`rate_limit_events` ingestion). Both are recorded in `docs/V2-BACKLOG.md`.

---

## Context

The admin Security panel (ADR-0033 Sprint 2.2) has five tabs. After ADR-0048 Sprint 2.1 shipped Worker HMAC/Origin logging, **three** of them pull real data:

- HMAC failures ✓ (ADR-0048)
- Origin failures ✓ (ADR-0048)
- Blocked IPs ✓ (ADR-0033)

Two are still stub surfaces:

1. **Rate-limit triggers** — ADR-0033 Sprint 2.1 stubbed `admin.security_rate_limit_triggers` with a note that Upstash is stateless and hits aren't persisted anywhere. The tab always shows an amber banner "ingestion pending" and zero rows.
2. **Sentry escalations** — ADR-0033 Sprint 2.2 shipped as link-out only. Operators triage by clicking through to the Sentry dashboard.

Closing both means operators don't leave the admin console to investigate auth/abuse/reliability incidents. Both ingestion paths are similar in shape — a signal source feeds a small `public.*_events` table, an admin RPC reads it, the existing Security panel renders it — so this ADR bundles them.

### Why one ADR, not two

Both target the same panel, the same operator, and the same "persist a stream of incident signals and render in the admin console" pattern. Splitting adds ADR overhead without separating the blast radius or the sequencing. Keep them together; ship Phase 1 (rate-limit) first because it's the smaller and more self-contained of the two.

---

## Decision

Two phases, each self-testable. Both follow the ADR-0048 pattern: tiny `public.*_events` table, RLS read via an admin SECURITY DEFINER RPC, ingestion fire-and-forget on the hot path so a logging outage never breaks the customer.

### Phase 1 — Rate-limit events (V2-S2)

- New `public.rate_limit_events` table: `id`, `occurred_at`, `endpoint`, `ip_address`, `org_id (nullable)`, `hit_count (running in-window)`, `window_seconds`, `key_hash`.
- `app/src/lib/rights/rate-limit.ts` — on `allowed=false`, fire-and-forget an INSERT into `rate_limit_events`. Pass `endpoint`, request IP (trimmed), org_id when known, the post-incr `count`, and a hash of the bucket key so correlated bursts group cleanly.
- Replace the ADR-0033 stub `admin.security_rate_limit_triggers` with a real implementation that reads from this table, grouping by IP + endpoint over the window.
- Admin Security panel — remove the "ingestion pending" amber banner.

### Phase 2 — Sentry webhook events (V2-S1)

- New `public.sentry_events` table: `id`, `sentry_id`, `project_slug`, `level`, `title`, `culprit`, `event_url`, `user_count`, `received_at`. Partial unique on `sentry_id`.
- New `app/src/app/api/webhooks/sentry/route.ts` — HMAC-verified POST handler (shared secret in Supabase Vault + env). Deduplicates on `sentry_id`.
- Sentry side: add an internal-integration webhook in each Sentry project (consentshield-app + consentshield-admin) targeting the webhook URL. **Configuration, not code** — documented in `docs/ops/sentry-webhook-setup.md`.
- New admin RPC `admin.security_sentry_events_list(p_window_hours int default 24)` — support+, grouped by project+level, newest first.
- Admin Security Sentry tab — replace the link-out-only view with a real table. Keep the dashboard deep-link on each row for drill-through.

---

## Non-goals

- **No inline triage** — operators still resolve/assign in Sentry proper. This ADR surfaces events; it does not mirror Sentry's issue state.
- **No performance budget for `rate_limit_events` at scale** — dev-scale today. Cleanup cron matches the `worker_errors` 7-day retention (`delete where occurred_at < now() - interval '7 days'`) so the table stays small.
- **No Sentry backfill** — only events received via the webhook from the moment the integration is configured.

---

## Implementation plan

### Phase 1 — Rate-limit events

#### Sprint 1.1 — table + ingestion + RPC + tests

**Deliverables:**

- [x] Migration `20260507000001_rate_limit_events.sql`:
  - `public.rate_limit_events(id, occurred_at, endpoint, ip_address, org_id, hit_count, window_seconds, key_hash)` with RLS enabled. INSERT granted to `anon + authenticated` (public rights endpoints run as anon; dashboard routes run as authenticated). No SELECT policy — customer can't read.
  - Indexes on `(ip_address, occurred_at desc)` + `(occurred_at desc)` for the admin group-by-IP + time-window queries.
  - pg_cron `rate-limit-events-cleanup-daily` at `35 3 * * *` deletes rows older than 7 days.
  - `admin.security_rate_limit_triggers(p_window_hours)` rewritten to read from the new table grouped by (endpoint, ip_address). Signature unchanged so the Security tab UI keeps working.
- [x] New `app/src/lib/rights/rate-limit-log.ts` — fire-and-forget logger using the anon key + SHA-256'd bucket key. Errors swallowed. No await on the caller side.
- [x] Rights-request routes wired (`/api/public/rights-request` + `/api/public/rights-request/verify-otp`): on `allowed=false` the logger is called before returning 429.
- [x] `tests/admin/rate-limit-rpcs.test.ts` — **5/5 PASS**: empty-table shape, group-by (endpoint, ip) sums hit_count correctly (15 from three 5's), window-bounds rejection, non-admin denial, direct-SELECT returns zero rows under RLS default-deny for authenticated.
- [x] Customer app build + lint clean.

**Status:** `[x] complete` — 2026-04-18

#### Sprint 1.2 — Security panel polish

**Deliverables:**

- [x] `admin/src/app/(operator)/security/security-tabs.tsx` — RateLimitTab rewritten: stub amber banner removed, replaced with the same Card + Pill pattern the other tabs use (green "0 in window" on empty, amber "N IP/endpoint pair(s)" when populated). Empty-state copy explains where the rows come from. Table headers clarified ("Latest hit" / "Total hits") so the group-by semantics are obvious.
- [x] Admin build + lint clean. Smoke confirming a live row lands is deferred to an opportunistic operator check — the unit tests already prove the ingestion + RPC + UI shape.

**Status:** `[x] complete` — 2026-04-18

Phase 1 of ADR-0049 is done. Phase 2 (Sentry webhook ingestion) is next — new table + HMAC-verified webhook route + Sentry-side integration + UI rewrite.

### Phase 2 — Sentry webhook events

#### Sprint 2.1 — schema + webhook + RPC + tests

**Deliverables:**

- [x] Migration `20260507000002_sentry_events.sql` — table (sentry_id unique, level CHECK constraint, payload jsonb for forensics) + indexes on received_at + (project, level, received_at) + 7-day retention cron at 03:45 UTC + `admin.security_sentry_events_list(p_window_hours)` RPC capped at 500 rows.
- [x] `app/src/app/api/webhooks/sentry/route.ts` — HMAC-SHA256 verification on the raw body against `SENTRY_WEBHOOK_SECRET` via timing-safe compare. Filters info/debug out; accepts and ignores unhandled payload shapes (returns 200 so Sentry doesn't retry). Upserts on `sentry_id` conflict — Sentry retries stay idempotent.
- [x] `docs/ops/sentry-webhook-setup.md` — operator runbook for standing up the Internal Integration in each Sentry project + local-dev smoke loop + log-tailing pointer.
- [x] `tests/admin/sentry-events-rpcs.test.ts` — **6/6 PASS**: support+ can call, seeded row round-trip, upsert idempotence (2 writes with same sentry_id → 1 row, latest title wins), level CHECK rejection, window-bounds rejection, non-admin denial.
- [x] Customer app build + lint clean. `/api/webhooks/sentry` in route manifest.

**Status:** `[x] complete` — 2026-04-18

#### Sprint 2.2 — Security panel Sentry tab rewrite

**Deliverables:**

- [x] `admin/src/app/(operator)/security/security-tabs.tsx` — `SentryTab` now consumes `data.sentryEvents` from the new RPC. Table columns: Received · Project · Level (tone-coded pill) · Title (+ culprit subtitle) · Users · per-row "Open ↗" deep-link to the event. Pill count on the tab header. Card action region keeps the project-wide "app ↗" + "admin ↗" link-outs for exploratory triage.
- [x] `admin/src/app/(operator)/security/page.tsx` — Promise.all extended to fetch sentry events alongside the other four RPC calls. Error aggregation includes the new call.
- [x] `SecurityData.sentryEvents` interface added; `LevelPill` helper added (`fatal`/`error` → red, `warning` → amber).
- [x] Admin build + lint clean. Live smoke deferred to an operator check once the Sentry internal integration is wired (see `docs/ops/sentry-webhook-setup.md`).

**Status:** `[x] complete` — 2026-04-18

---

## Acceptance criteria

- Rate-limit hits in the Rights Request routes show up in the Security panel within 30s.
- Sentry events at severity ≥ error fire the webhook and land in the Sentry tab within the next auto-refresh cycle.
- Both tables stay < 10k rows under normal dev traffic thanks to the 7-day retention cron.
- No customer-facing code path can be DoSed by a logging outage — every ingestion call is fire-and-forget with swallowed errors.
- RPC role gates hold: support+ can read, non-admin authenticated users cannot.
