-- ADR-0025 Sprint 1.1 — DEPA score nightly refresh + pg_cron.
--
-- compute_depa_score(org_id) was shipped in ADR-0020 (20260418000001).
-- This migration wires the refresh loop that iterates organisations and
-- UPSERTs into depa_compliance_metrics so the dashboard and score API can
-- read a pre-computed row instead of recomputing on every request.
--
-- Depends on:
--   - ADR-0020 compute_depa_score + depa_compliance_metrics table.
--   - pg_cron extension.
--
-- Idempotency: `on conflict (org_id) do update` at the UPSERT. Concurrent
-- runs (cron + manual) race at the index; the winner's row wins. There is
-- no work to deduplicate — each run recomputes from scratch.

-- ═══════════════════════════════════════════════════════════
-- refresh_depa_compliance_metrics() — iterate orgs, recompute, UPSERT.
-- Returns the number of orgs processed for observability.
-- ═══════════════════════════════════════════════════════════
create or replace function refresh_depa_compliance_metrics()
returns integer language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_score  jsonb;
  v_count  integer := 0;
begin
  for v_org_id in select id from organisations loop
    v_score := compute_depa_score(v_org_id);

    insert into depa_compliance_metrics (
      org_id, total_score, coverage_score, expiry_score,
      freshness_score, revocation_score, computed_at
    ) values (
      v_org_id,
      coalesce((v_score->>'total')::numeric,             0),
      coalesce((v_score->>'coverage_score')::numeric,    0),
      coalesce((v_score->>'expiry_score')::numeric,      0),
      coalesce((v_score->>'freshness_score')::numeric,   0),
      coalesce((v_score->>'revocation_score')::numeric,  0),
      coalesce((v_score->>'computed_at')::timestamptz,   now())
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

comment on function refresh_depa_compliance_metrics() is
  'ADR-0025. Nightly pg_cron helper. Iterates every organisation, calls '
  'compute_depa_score(org_id), and UPSERTs the result into '
  'depa_compliance_metrics. Idempotent via ON CONFLICT (org_id). '
  'Scheduled at 19:30 UTC (01:00 IST) — after the ADR-0023 expiry '
  'enforcement cron (19:00 UTC) so the night''s expired artefacts are '
  'reflected in the score.';

grant execute on function refresh_depa_compliance_metrics()
  to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: depa-score-refresh-nightly at 19:30 UTC (01:00 IST)
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('depa-score-refresh-nightly');
exception when others then null; end $$;

select cron.schedule(
  'depa-score-refresh-nightly',
  '30 19 * * *',
  $$select refresh_depa_compliance_metrics()$$
);

-- Verification:
--
-- Query A (function exists):
--   select proname from pg_proc where proname = 'refresh_depa_compliance_metrics';
--    → 1 row
--
-- Query B (cron):
--   select jobname, schedule, active from cron.job
--    where jobname = 'depa-score-refresh-nightly';
--    → 1 row, schedule '30 19 * * *', active = true
