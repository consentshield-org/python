-- ADR-1010 Phase 4 cutover — close the Phase-1-Sprint-1.2 prep flag
-- (already resolved in 20260804000027), and seed a new follow-up flag
-- for the connection-lifecycle refinement that the Phase 4 smoke test
-- surfaced.
--
-- What landed in Phase 4:
--   * worker/src/role-guard.ts deleted
--   * worker/src/prototypes/ deleted
--   * /v1/_cs_api_probe route deleted
--   * SUPABASE_WORKER_KEY wrangler secret deleted (worker now reads
--     from env.HYPERDRIVE only in production)
--   * Worker version 3db2f123-725f-431f-b964-5280b9172bdc deployed
--   * Live banner.js smoke test 5/5 — cold start 2.9s, warm 60-100ms
--
-- Known follow-up: each call site opens its own postgres.js client and
-- closes it in a finally block. This works (5/5 responses) but is
-- per-request connection churn — opening 4 clients per banner request
-- (banner config + property config + signatures + snippet update) and
-- closing each in turn. Cloudflare's recommended pattern is one
-- request-scoped client + ctx.waitUntil(sql.end()) so cleanup runs
-- after the response is sent. Tracked here as a follow-up.

insert into admin.ops_readiness_flags (
  title, description, source_adr, blocker_type, severity, status, owner
)
select * from (values
  (
    'ADR-1010 Phase 4 follow-up — share request-scoped postgres.js client + ctx.waitUntil cleanup',
    'Each Worker call site (banner config, property config, signatures, '
    'snippet last-seen, consent_events insert, tracker_observations '
    'insert, worker_errors insert) currently opens its own postgres.js '
    'client and closes it in a finally block. This works (5/5 banner.js '
    'live smoke test), but a banner request can open up to 4 clients '
    'serially. Refactor: one client per request, share across helpers, '
    'cleanup via ctx.waitUntil(sql.end()) so the close runs AFTER the '
    'response goes out. Should reduce cold-start latency (currently 2.9s '
    'first request, 60-100ms warm) and avoid Hyperdrive pool churn. '
    'Pure code; no external blocker.',
    'ADR-1010 Phase 4 follow-up (connection lifecycle)',
    'other',
    'low',
    'pending',
    'claude-code (next session)'
  )
) as v(title, description, source_adr, blocker_type, severity, status, owner)
where not exists (
  select 1 from admin.ops_readiness_flags f
   where f.source_adr = v.source_adr
);
