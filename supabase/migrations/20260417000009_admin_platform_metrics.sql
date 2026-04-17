-- ADR-0027 Sprint 2.1 — admin.platform_metrics_daily.
--
-- Daily system-wide metrics rollup backing the Operations Dashboard.
-- Written by admin.refresh_platform_metrics(p_date) (Sprint 3.1) invoked
-- by the admin-refresh-platform-metrics pg_cron job (Sprint 3.1).
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.11.

create table admin.platform_metrics_daily (
  metric_date                 date        primary key,
  total_orgs                  int         not null,
  active_orgs                 int         not null,
  total_consents              bigint      not null,
  total_artefacts_active      bigint      not null,
  total_artefacts_revoked     bigint      not null,
  total_rights_requests_open  int         not null,
  rights_requests_breached    int         not null,
  worker_errors_24h           int         not null,
  delivery_buffer_max_age_min int         not null,
  refreshed_at                timestamptz not null default now()
);

alter table admin.platform_metrics_daily enable row level security;

create policy platform_metrics_admin on admin.platform_metrics_daily
  for all to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true)
  with check ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

grant select on admin.platform_metrics_daily to authenticated;

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='platform_metrics_daily'; → 1
