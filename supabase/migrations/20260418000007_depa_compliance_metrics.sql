-- ADR-0020 Sprint 1.1 — DEPA depa_compliance_metrics table.
--
-- Part 7 of 9: cached DEPA compliance score per organisation. Refreshed
-- nightly by the depa-score-refresh-nightly pg_cron job (ADR-0025).
-- Read by the compliance-score dashboard panel without recomputing.
--
-- Per §11.4.6 + §11.6 + §11.7 + §11.8.
--
-- UNIQUE on org_id — exactly one cached row per org. Rows are upserted
-- by the nightly cron; staleness is surfaced in the dashboard if
-- computed_at is older than 25 hours.

create table depa_compliance_metrics (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organisations(id) on delete cascade unique,
  total_score      numeric(4,1) not null default 0,
  coverage_score   numeric(4,1) not null default 0,
  expiry_score     numeric(4,1) not null default 0,
  freshness_score  numeric(4,1) not null default 0,
  revocation_score numeric(4,1) not null default 0,
  computed_at      timestamptz not null default now(),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

comment on table depa_compliance_metrics is
  'Cached DEPA compliance score per organisation. Updated nightly by the '
  'depa-score-refresh-nightly pg_cron job (ADR-0025). Stale by at most '
  '24 hours. Staleness is surfaced in the dashboard if computed_at is '
  'older than 25 hours.';

-- RLS (§11.6) — read-only for authenticated.
alter table depa_compliance_metrics enable row level security;

create policy "depa_metrics_select_own"
  on depa_compliance_metrics for select
  using (org_id = current_org_id());

-- Grants (§11.7) — authenticated reads via RLS. cs_orchestrator upserts
-- inside the nightly refresh cron.
grant select                         on depa_compliance_metrics to authenticated;
grant select, insert, update         on depa_compliance_metrics to cs_orchestrator;

-- Updated_at trigger (§11.8)
create trigger trg_depa_metrics_updated_at
  before update on depa_compliance_metrics
  for each row execute function set_updated_at();
