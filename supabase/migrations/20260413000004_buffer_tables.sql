-- Migration 004: Buffer Tables (Category B — transient, deliver then delete)
-- These tables hold user data for seconds to minutes. Rows are deleted
-- immediately after confirmed delivery to customer storage.

-- ═══════════════════════════════════════════════════════════
-- DELIVERY BUFFER — write-ahead log for export pipeline
-- ═══════════════════════════════════════════════════════════
create table delivery_buffer (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations(id) on delete cascade,
  event_type         text not null,
  payload            jsonb not null,
  export_config_id   uuid references export_configurations(id),
  attempt_count      integer not null default 0,
  first_attempted_at timestamptz,
  last_attempted_at  timestamptz,
  delivered_at       timestamptz,
  delivery_error     text,
  created_at         timestamptz default now()
);

create index idx_delivery_buffer_undelivered on delivery_buffer (org_id, delivered_at) where delivered_at is null;
create index idx_delivery_buffer_stale on delivery_buffer (created_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- CONSENT EVENTS — legally significant, append-only
-- Written by Cloudflare Worker via cs_worker role.
-- ═══════════════════════════════════════════════════════════
create table consent_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,             -- denormalised, no FK (avoids join for RLS)
  property_id         uuid not null references web_properties(id),
  banner_id           uuid not null references consent_banners(id),
  banner_version      integer not null,
  session_fingerprint text not null,
  event_type          text not null,
  purposes_accepted   jsonb not null default '[]',
  purposes_rejected   jsonb not null default '[]',
  ip_truncated        text,
  user_agent_hash     text,
  delivered_at        timestamptz,
  created_at          timestamptz default now()
);

create index idx_consent_events_org_time on consent_events (org_id, property_id, created_at desc);
create index idx_consent_events_undelivered on consent_events (delivered_at) where delivered_at is null;
create index idx_consent_events_delivered_stale on consent_events (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- TRACKER OBSERVATIONS — what the banner script detected
-- ═══════════════════════════════════════════════════════════
create table tracker_observations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references web_properties(id) on delete cascade,
  session_fingerprint text not null,
  consent_state       jsonb not null,
  trackers_detected   jsonb not null,
  violations          jsonb not null default '[]',
  page_url_hash       text,
  observed_at         timestamptz default now(),
  delivered_at        timestamptz,
  created_at          timestamptz default now()
);

create index idx_tracker_obs_violations on tracker_observations (org_id, observed_at desc) where violations != '[]'::jsonb;
create index idx_tracker_obs_undelivered on tracker_observations (delivered_at) where delivered_at is null;
create index idx_tracker_obs_delivered_stale on tracker_observations (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- AUDIT LOG — every significant action. Append-only buffer.
-- ═══════════════════════════════════════════════════════════
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,                   -- denormalised, no FK (avoids join for RLS)
  actor_id     uuid,
  actor_email  text,
  event_type   text not null,
  entity_type  text,
  entity_id    uuid,
  payload      jsonb,
  ip_address   text,
  delivered_at timestamptz,
  created_at   timestamptz default now()
);

create index idx_audit_log_org_time on audit_log (org_id, created_at desc);
create index idx_audit_log_undelivered on audit_log (delivered_at) where delivered_at is null;
create index idx_audit_log_delivered_stale on audit_log (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- PROCESSING LOG — continuous record of processing activities
-- ═══════════════════════════════════════════════════════════
create table processing_log (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  activity_name     text not null,
  data_categories   text[] not null,
  purpose           text not null,
  legal_basis       text not null,
  processor_name    text,
  third_parties     text[] not null default '{}',
  data_subjects_count integer,
  delivered_at      timestamptz,
  created_at        timestamptz default now()
);

create index idx_processing_log_org_time on processing_log (org_id, created_at desc);
create index idx_processing_log_undelivered on processing_log (delivered_at) where delivered_at is null;
create index idx_processing_log_delivered_stale on processing_log (delivered_at) where delivered_at is not null;

-- ═══════════════════════════════════════════════════════════
-- RIGHTS REQUEST EVENTS — append-only workflow audit trail
-- ═══════════════════════════════════════════════════════════
create table rights_request_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references rights_requests(id) on delete cascade,
  org_id       uuid not null,                   -- denormalised, no FK (avoids join for RLS)
  actor_id     uuid references auth.users(id),
  event_type   text not null,
  notes        text,
  metadata     jsonb,
  delivered_at timestamptz,
  created_at   timestamptz default now()
);

create index idx_rr_events_request on rights_request_events (request_id, created_at);
create index idx_rr_events_undelivered on rights_request_events (delivered_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- DELETION RECEIPTS — proof that data was actually deleted
-- ═══════════════════════════════════════════════════════════
create table deletion_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  trigger_type      text not null,
  trigger_id        uuid,
  connector_id      uuid references integration_connectors(id),
  target_system     text not null,
  identifier_hash   text not null,
  status            text not null default 'pending',
  request_payload   jsonb,
  response_payload  jsonb,
  requested_at      timestamptz default now(),
  confirmed_at      timestamptz,
  failure_reason    text,
  retry_count       integer default 0,
  delivered_at      timestamptz,
  created_at        timestamptz default now()
);

create index idx_deletion_receipts_org on deletion_receipts (org_id, created_at desc);
create index idx_deletion_receipts_pending on deletion_receipts (status) where status = 'pending';
create index idx_deletion_receipts_undelivered on deletion_receipts (delivered_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- WITHDRAWAL VERIFICATIONS — consent withdrawal enforcement
-- ═══════════════════════════════════════════════════════════
create table withdrawal_verifications (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  property_id           uuid not null references web_properties(id) on delete cascade,
  consent_event_id      uuid,
  withdrawn_purposes    text[] not null,
  scan_schedule         jsonb not null,
  scan_results          jsonb not null default '[]',
  overall_status        text not null default 'pending',
  delivered_at          timestamptz,
  created_at            timestamptz default now()
);

create index idx_withdrawal_ver_org on withdrawal_verifications (org_id, overall_status, created_at desc);

-- ═══════════════════════════════════════════════════════════
-- SECURITY SCANS — nightly posture check results
-- ═══════════════════════════════════════════════════════════
create table security_scans (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  property_id     uuid not null references web_properties(id) on delete cascade,
  scan_type       text not null,
  severity        text not null,
  signal_key      text not null,
  details         jsonb,
  remediation     text,
  scanned_at      timestamptz default now(),
  delivered_at    timestamptz,
  created_at      timestamptz default now()
);

create index idx_security_scans_org on security_scans (org_id, property_id, scanned_at desc);

-- ═══════════════════════════════════════════════════════════
-- CONSENT PROBE RUNS — synthetic compliance test results
-- ═══════════════════════════════════════════════════════════
create table consent_probe_runs (
  id              uuid primary key default gen_random_uuid(),
  probe_id        uuid not null,
  org_id          uuid not null references organisations(id) on delete cascade,
  consent_state   jsonb not null,
  trackers_detected jsonb not null,
  violations      jsonb not null default '[]',
  page_html_hash  text,
  duration_ms     integer,
  status          text not null,
  error_message   text,
  run_at          timestamptz default now(),
  delivered_at    timestamptz
);

create index idx_probe_runs_org on consent_probe_runs (org_id, probe_id, run_at desc);
