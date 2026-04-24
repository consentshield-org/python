# ConsentShield — Complete Schema Design

*(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com*
*Source of truth for all database objects · April 2026*
*Companion to: Definitive Architecture Reference*
*Amended: 2026-04-16 (DEPA alignment — see [`docs/reviews/2026-04-16-depa-package-architecture-review.md`](../reviews/2026-04-16-depa-package-architecture-review.md). DEPA content is in §11.)*

---

## Document Purpose

This file contains every SQL statement required to create ConsentShield's database from scratch. It is ordered for execution — run it top to bottom on a fresh Supabase Postgres instance and the database is ready.

Every table, index, policy, trigger, function, and scheduled job is here. Nothing is implied. Nothing is "obvious." If it's not in this file, it doesn't exist.

---

## Execution Order

1. Extensions
2. Helper functions
3. Tables (operational state → buffer tables → enforcement tables → phase 3-4 tables)
4. Indexes
5. Row-Level Security — enable + policies
6. Restricted database roles (deny UPDATE/DELETE on buffer tables)
7. Triggers (updated_at, SLA deadlines, breach deadlines)
8. Buffer lifecycle functions (immediate delete, sweep, stuck detection)
9. Scheduled jobs (pg_cron)
10. Verification queries (run after setup to confirm guards are active)
11. **DEPA alignment (2026-04-16)** — helper functions, new tables, ALTER TABLE amendments, indexes, RLS, scoped-role grant additions, triggers (including the `AFTER INSERT` trigger on `consent_events` for the hybrid artefact-creation pipeline), scheduled jobs (expiry alerts, expiry enforcement, DEPA score refresh, artefact-creation safety-net sweep), verification queries, guard additions. Run §11 in its entirety after §1–§10. All DEPA content is self-contained in §11 so future readers see it as one coherent extension.

---

## 1. Extensions

```sql
create extension if not exists "pgcrypto";     -- Encryption for sensitive fields
create extension if not exists "pg_cron";       -- Scheduled buffer cleanup and SLA checks
create extension if not exists "uuid-ossp";     -- UUID generation (backup for gen_random_uuid)
```

---

## 2. Helper Functions

```sql
-- Returns the current user's org_id from their JWT
create or replace function current_org_id()
returns uuid language sql stable as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

-- Returns true if current user is an admin of their org
create or replace function is_org_admin()
returns boolean language sql stable as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;

-- Auto-update updated_at on mutable tables
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-set SLA deadline: 30 calendar days from creation
create or replace function set_rights_request_sla()
returns trigger language plpgsql as $$
begin
  new.sla_deadline = new.created_at + interval '30 days';
  return new;
end;
$$;

-- Auto-set DPB deadline: 72 hours from discovery
create or replace function set_breach_deadline()
returns trigger language plpgsql as $$
begin
  new.dpb_notification_deadline = new.discovered_at + interval '72 hours';
  return new;
end;
$$;

-- JWT custom claims hook — injects org_id and org_role into every token
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb;
  v_org_id uuid;
  v_org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into v_org_id, v_org_role
  from organisation_members om
  where om.user_id = (event ->> 'user_id')::uuid
  limit 1;
  if v_org_id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(v_org_role));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
```

---

## 3. Tables

### 3.1 Operational State Tables (Category A — permanent)

```sql
-- ═══════════════════════════════════════════════════════════
-- ORGANISATIONS — root of all multi-tenant data
-- ═══════════════════════════════════════════════════════════
create table organisations (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  industry                  text,                          -- 'saas' | 'edtech' | 'healthcare' | 'ecommerce' | 'hrtech' | 'fintech'
  plan                      text not null default 'trial', -- 'trial' | 'starter' | 'growth' | 'pro' | 'enterprise'
  storage_mode              text not null default 'standard', -- 'standard' | 'insulated' | 'zero_storage'
  plan_started_at           timestamptz default now(),
  trial_ends_at             timestamptz default (now() + interval '14 days'),
  razorpay_subscription_id  text unique,
  razorpay_customer_id      text unique,
  compliance_contact_email  text,
  dpo_name                  text,
  encryption_salt           text not null default encode(gen_random_bytes(16), 'hex'), -- per-org key derivation salt
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- ORGANISATION MEMBERS — links auth.users to organisations
-- ═══════════════════════════════════════════════════════════
create table organisation_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',  -- 'admin' | 'member' | 'readonly' | 'auditor'
  created_at  timestamptz default now(),
  unique (org_id, user_id)
);

-- ═══════════════════════════════════════════════════════════
-- WEB PROPERTIES — each customer can have multiple sites/apps
-- ═══════════════════════════════════════════════════════════
create table web_properties (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  name                  text not null,
  url                   text not null,
  allowed_origins       text[] not null default '{}',  -- validated origins for HMAC events, e.g. {'https://app.acme.com'}
  event_signing_secret  text not null default encode(gen_random_bytes(32), 'hex'), -- HMAC key compiled into banner
  snippet_verified_at   timestamptz,
  snippet_last_seen_at  timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- CONSENT BANNERS — versioned. Every change = new version.
-- ═══════════════════════════════════════════════════════════
create table consent_banners (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  property_id         uuid not null references web_properties(id) on delete cascade,
  version             integer not null default 1,
  is_active           boolean not null default false,
  headline            text not null,
  body_copy           text not null,
  position            text not null default 'bottom-bar',
  purposes            jsonb not null default '[]',
  monitoring_enabled  boolean not null default true,
  created_at          timestamptz default now(),
  unique (property_id, version)
);

-- Purpose object schema: { id, name, description, required, default }

-- ═══════════════════════════════════════════════════════════
-- DATA INVENTORY — maps data flows
-- ═══════════════════════════════════════════════════════════
create table data_inventory (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  data_category     text not null,
  collection_source text,
  purposes          text[] not null default '{}',
  legal_basis       text not null default 'consent',
  retention_period  text,
  third_parties     text[] not null default '{}',
  data_locations    text[] not null default '{}',     -- ['IN', 'US', 'EU']
  source_type       text not null default 'manual',   -- 'manual' | 'auto_detected'
  notes             text,
  is_complete       boolean not null default false,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- BREACH NOTIFICATIONS — one per breach event
-- ═══════════════════════════════════════════════════════════
create table breach_notifications (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references organisations(id) on delete cascade,
  discovered_at               timestamptz not null,
  reported_by                 uuid not null references auth.users(id),
  dpb_notification_deadline   timestamptz not null,      -- auto-set: discovered_at + 72h
  dpb_notified_at             timestamptz,
  affected_categories         text[] not null default '{}',
  estimated_affected_count    integer,
  description                 text,
  incident_reference          text,
  status                      text not null default 'open',
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- RIGHTS REQUESTS — one per Data Principal request
-- ═══════════════════════════════════════════════════════════
create table rights_requests (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organisations(id) on delete cascade,
  request_type            text not null,             -- 'erasure' | 'access' | 'correction' | 'nomination'
  requestor_name          text not null,
  requestor_email         text not null,
  requestor_message       text,
  turnstile_verified      boolean not null default false,  -- Cloudflare Turnstile bot check passed
  email_verified          boolean not null default false,  -- OTP email verification passed
  email_verified_at       timestamptz,                     -- when OTP was confirmed
  identity_verified       boolean not null default false,
  identity_verified_at    timestamptz,
  identity_verified_by    uuid references auth.users(id),
  identity_method         text,
  status                  text not null default 'new',
  assignee_id             uuid references auth.users(id),
  sla_deadline            timestamptz not null,      -- auto-set: created_at + 30 days
  response_sent_at        timestamptz,
  closure_notes           text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- EXPORT CONFIGURATIONS — per-org storage destination
-- ═══════════════════════════════════════════════════════════
create table export_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  storage_provider      text not null default 'r2',    -- 'r2' | 's3'
  bucket_name           text not null,
  path_prefix           text not null default '',
  region                text,
  write_credential_enc  bytea not null,                -- pgcrypto-encrypted IAM credential
  is_verified           boolean not null default false,
  last_export_at        timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id)
);

-- ═══════════════════════════════════════════════════════════
-- TRACKER SIGNATURES — reference data (not per-org)
-- ═══════════════════════════════════════════════════════════
create table tracker_signatures (
  id              uuid primary key default gen_random_uuid(),
  service_name    text not null,
  service_slug    text not null unique,
  category        text not null,             -- 'analytics' | 'marketing' | 'personalisation' | 'functional'
  detection_rules jsonb not null,
  data_locations  text[] not null default '{}',
  is_functional   boolean not null default false,
  version         integer not null default 1,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- TRACKER OVERRIDES — per-org false positive config
-- ═══════════════════════════════════════════════════════════
create table tracker_overrides (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  property_id       uuid references web_properties(id) on delete cascade,
  domain_pattern    text not null,
  override_category text not null,
  reason            text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (org_id, property_id, domain_pattern)
);

-- ═══════════════════════════════════════════════════════════
-- INTEGRATION CONNECTORS — deletion API connections
-- ═══════════════════════════════════════════════════════════
create table integration_connectors (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  connector_type  text not null,
  display_name    text not null,
  config          bytea not null,            -- pgcrypto-encrypted: OAuth tokens, webhook URLs
  status          text not null default 'active',
  last_health_check_at timestamptz,
  last_error      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- RETENTION RULES — per-org data lifecycle
-- ═══════════════════════════════════════════════════════════
create table retention_rules (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  data_category       text not null,
  retention_days      integer not null,
  connected_systems   uuid[] default '{}',
  auto_delete         boolean not null default false,
  last_checked_at     timestamptz,
  next_check_at       timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATION CHANNELS — alert delivery config
-- ═══════════════════════════════════════════════════════════
create table notification_channels (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  channel_type    text not null,             -- 'email' | 'slack' | 'teams' | 'discord' | 'webhook'
  config          jsonb not null,            -- webhook_url, channel, auth
  alert_types     text[] not null default '{}', -- which alert types this channel receives
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- CONSENT ARTEFACT INDEX — active consent validation cache
-- No personal data. TTL-based. Operational state only.
-- ═══════════════════════════════════════════════════════════
-- ADR-1002 Sprint 1.1 extends this table with identifier-based lookup
-- columns so /v1/consent/verify can resolve without a consent_artefacts JOIN.
-- All new columns nullable: Mode A (web banner) consent is anonymous and
-- leaves identifier_hash / identifier_type null; only Mode B (/v1/consent/record,
-- ADR-1002 Sprint 2.1) populates them. Revocation cascade UPDATEs the row
-- (validity_state='revoked', revoked_at, revocation_record_id) rather than
-- DELETing it, so verify can distinguish revoked from never_consented.
create table consent_artefact_index (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  property_id           uuid references web_properties(id) on delete cascade,
  artefact_id           text not null,
  consent_event_id      uuid references consent_events(id) on delete set null,
  validity_state        text not null default 'active',  -- 'active' | 'revoked' | 'expired'
  framework             text not null default 'abdm',    -- 'dpdp' | 'abdm' | 'gdpr'
  purpose_code          text,
  identifier_hash       text,                            -- hash_data_principal_identifier() output
  identifier_type       text check (identifier_type in ('email','phone','pan','aadhaar','custom')),
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  revocation_record_id  uuid references artefact_revocations(id) on delete set null,
  created_at            timestamptz default now(),
  unique (org_id, artefact_id)
);

-- Hot-path partial index for identifier-based verify.
create index idx_consent_artefact_index_identifier_hot
  on consent_artefact_index (org_id, property_id, identifier_hash, purpose_code)
  where validity_state = 'active' and identifier_hash is not null;
```

### 3.2 Buffer Tables (Category B — transient, deliver then delete)

**CRITICAL: These tables use `bytea` for no fields that could hold personal data in plaintext. All personal data fields are hashed or transient. The buffer lifecycle (Section 8) enforces immediate deletion after confirmed delivery.**

```sql
-- ═══════════════════════════════════════════════════════════
-- DELIVERY BUFFER — write-ahead log for export pipeline
-- A row here means: "this event has been generated but not
-- yet confirmed delivered to customer storage."
-- Retention: seconds to minutes. NEVER hours.
-- ═══════════════════════════════════════════════════════════
create table delivery_buffer (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organisations(id) on delete cascade,
  event_type         text not null,               -- 'consent_event' | 'audit_entry' | 'tracker_obs' | etc.
  payload            jsonb not null,              -- the event to export
  export_config_id   uuid references export_configurations(id),
  attempt_count      integer not null default 0,
  first_attempted_at timestamptz,
  last_attempted_at  timestamptz,
  delivered_at       timestamptz,                 -- set on confirmed write. Row deleted immediately after.
  delivery_error     text,
  created_at         timestamptz default now()
  -- NO updated_at. Buffer, not mutable state.
  -- Rows with delivered_at IS NOT NULL are deleted immediately by the delivery function.
  -- Rows with attempt_count > 10 trigger an alert and are held for manual review.
);

create index idx_delivery_buffer_undelivered on delivery_buffer (org_id, delivered_at) where delivered_at is null;
create index idx_delivery_buffer_stale on delivery_buffer (created_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- CONSENT EVENTS — the most important buffer in the system
-- Legally significant. Append-only for authenticated users.
-- Written by Cloudflare Worker via service role.
-- Delivered to customer storage, then DELETED.
-- ═══════════════════════════════════════════════════════════
create table consent_events (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,             -- denormalised, no FK (avoids join for RLS)
  property_id         uuid not null references web_properties(id),
  banner_id           uuid not null references consent_banners(id),
  banner_version      integer not null,
  session_fingerprint text not null,             -- SHA-256(user_agent + truncated_ip + org_id)
  event_type          text not null,             -- 'consent_given' | 'consent_withdrawn' | 'purpose_updated' | 'banner_dismissed'
  purposes_accepted   jsonb not null default '[]',
  purposes_rejected   jsonb not null default '[]',
  ip_truncated        text,                      -- last octet removed
  user_agent_hash     text,                      -- SHA-256, not raw
  delivered_at        timestamptz,               -- set on confirmed export. Row deleted immediately after.
  created_at          timestamptz default now()
  -- NO updated_at. APPEND-ONLY. No UPDATE or DELETE policy for any authenticated role.
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
  page_url_hash       text,                      -- SHA-256 of URL, not the URL itself
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
  org_id       uuid not null,                   -- denormalised, no FK (same pattern as consent_events — avoids join for RLS)
  actor_id     uuid,
  actor_email  text,                            -- denormalised
  event_type   text not null,
  entity_type  text,
  entity_id    uuid,
  payload      jsonb,
  ip_address   text,
  delivered_at timestamptz,
  created_at   timestamptz default now()
  -- APPEND-ONLY. No UPDATE or DELETE policy.
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
  org_id       uuid not null,                   -- denormalised, no FK (same pattern as consent_events — avoids join for RLS)
  actor_id     uuid references auth.users(id),
  event_type   text not null,
  notes        text,
  metadata     jsonb,
  delivered_at timestamptz,
  created_at   timestamptz default now()
  -- APPEND-ONLY. No UPDATE or DELETE policy.
);

create index idx_rr_events_request on rights_request_events (request_id, created_at);
create index idx_rr_events_undelivered on rights_request_events (delivered_at) where delivered_at is null;

-- ═══════════════════════════════════════════════════════════
-- DELETION RECEIPTS — proof that data was actually deleted
-- ═══════════════════════════════════════════════════════════
create table deletion_receipts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  trigger_type      text not null,             -- 'erasure_request' | 'retention_expired' | 'consent_withdrawn'
  trigger_id        uuid,
  connector_id      uuid references integration_connectors(id),
  target_system     text not null,
  identifier_hash   text not null,             -- SHA-256 of the data principal identifier
  status            text not null default 'pending',
  request_payload   jsonb,                     -- PII-redacted
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
  probe_id        uuid not null,              -- references consent_probes(id)
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
```

### 3.3 Phase 3 Tables (operational state)

```sql
-- Consent probes — scheduled synthetic tests
create table consent_probes (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  property_id       uuid not null references web_properties(id) on delete cascade,
  probe_type        text not null,
  consent_state     jsonb not null,
  schedule          text not null default 'weekly',
  last_run_at       timestamptz,
  last_result       jsonb,
  next_run_at       timestamptz,
  is_active         boolean not null default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- API keys (v2 — ADR-1001 Sprint 2.1; migrations 20260520000001–20260520000003)
-- Plaintext is returned once at creation; only the SHA-256 hex hash is stored.
-- Rotation preserves `id`, moves old hash to previous_key_hash for a 24h window.
-- Revocation sets revoked_at and clears previous_key_hash (both plaintexts stop).
create table api_keys (
  id                       uuid primary key default gen_random_uuid(),
  account_id               uuid not null references accounts(id) on delete cascade,
  org_id                   uuid references organisations(id) on delete cascade,  -- null = account-scoped
  key_hash                 text not null unique,   -- SHA-256 hex of plaintext (never stored)
  key_prefix               text not null,          -- 'cs_live_xxxxxxxx' (first 16 chars)
  name                     text not null,
  scopes                   text[] not null default '{}'
                             check (api_keys_scopes_valid(scopes)),
  rate_tier                text not null default 'starter',
  is_active                boolean not null generated always as (revoked_at is null) stored,
  last_used_at             timestamptz,
  previous_key_hash        text,                   -- set during dual-window rotation
  previous_key_expires_at  timestamptz,
  last_rotated_at          timestamptz,
  created_by               uuid references auth.users(id) on delete set null,
  revoked_at               timestamptz,
  revoked_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now()
);

-- Scope allow-list enforced at DDL boundary.
create function api_keys_scopes_valid(scopes text[]) returns boolean language sql immutable as $$
  select scopes <@ array['read:consent','write:consent','read:score','read:tracker',
    'read:rights','write:rights','read:deletion','write:deletion',
    'read:audit','read:security','read:probes','read:artefacts','write:artefacts']
$$;

-- Day-partitioned usage audit (90-day retention; pg_cron drops old partitions weekly).
create table api_request_log (
  id              uuid not null default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  key_id          uuid references api_keys(id) on delete set null,
  account_id      uuid,
  org_id          uuid,
  route           text not null,
  method          text not null,
  status          integer not null,
  latency_ms      integer,
  response_bytes  integer,
  user_agent      text
) partition by range (occurred_at);

-- cs_api Postgres role — minimum privilege for the Bearer verify path.
-- Granted: EXECUTE on rpc_api_key_verify only; no direct table DML.
-- Used by future direct-connection poolers; the Next.js proxy currently uses
-- service_role for the Supabase REST API call (REST does not support custom roles).
-- create role cs_api nologin;
-- grant execute on function public.rpc_api_key_verify(text) to cs_api;

-- RPCs (SECURITY DEFINER, search_path = public, extensions, pg_catalog):
--   rpc_api_key_create(account_id, org_id, scopes[], rate_tier, name) → jsonb
--     Returns { id, plaintext, prefix, scopes, rate_tier, created_at }. Plaintext returned once only.
--   rpc_api_key_rotate(key_id) → jsonb
--     Returns { id, new_plaintext, new_prefix, rotated_at }. Old hash held in previous_key_hash 24h.
--   rpc_api_key_revoke(key_id) → void
--     Sets revoked_at, clears previous_key_hash.
--   rpc_api_key_verify(plaintext) → jsonb | null    ← service_role only
--     Returns { id, account_id, org_id, scopes, rate_tier, name, prefix } or null.
--     Called by proxy.ts on every /api/v1/* request.
--   rpc_api_request_log_insert(key_id, org_id, account_id, route, method, status, latency_ms) → void
--     ← service_role only. Fire-and-forget insert into api_request_log; exceptions swallowed.
--     Called by route handlers via logApiRequest() helper (ADR-1001 Sprint 2.4).
--   rpc_api_key_usage(key_id, days=7) → table(day, request_count, p50_ms, p95_ms)
--     ← authenticated. Checks caller is account_owner/account_viewer for the key's account.
--     Powers /dashboard/settings/api-keys/[id]/usage (ADR-1001 Sprint 2.4).

-- RLS: account_owner/account_viewer see all account keys; org_admin sees org-scoped keys.
-- authenticated role has no INSERT/UPDATE/DELETE (flows via SECURITY DEFINER RPCs).
-- is_account_member() and is_org_member() SECURITY DEFINER helpers bypass RLS recursion.

-- GDPR configuration
create table gdpr_configurations (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  enabled               boolean not null default false,
  legal_bases           jsonb not null default '[]',
  dpa_contacts          jsonb default '[]',
  representative_name   text,
  representative_email  text,
  dpia_required         boolean default false,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id)
);

-- Sector templates
create table sector_templates (
  id              uuid primary key default gen_random_uuid(),
  sector          text not null unique,
  display_name    text not null,
  privacy_notice_template jsonb not null,
  data_inventory_defaults jsonb not null,
  tracker_allowlist jsonb not null,
  consent_purposes jsonb not null,
  risk_categories jsonb not null,
  parental_consent_required boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- DPO marketplace
create table dpo_partners (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  firm_name       text,
  email           text not null,
  phone           text,
  specialisations text[] default '{}',
  languages       text[] default '{}',
  monthly_fee_range jsonb,
  bio             text,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

create table dpo_engagements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  dpo_id          uuid not null references dpo_partners(id),
  status          text not null default 'requested',
  started_at      timestamptz,
  ended_at        timestamptz,
  referral_fee_percent numeric default 15,
  created_at      timestamptz default now()
);

-- Cross-border transfer declarations
create table cross_border_transfers (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  destination_country   text not null,
  destination_entity    text not null,
  data_categories       text[] not null,
  legal_basis           text not null,
  safeguards            text,
  transfer_volume       text,
  auto_detected         boolean default false,
  declared_by_user      boolean default false,
  scc_status            text,                  -- 'signed' | 'pending' | 'not_required'
  status                text not null default 'active',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

-- White-label config
create table white_label_configs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  brand_name      text not null,
  logo_url        text,
  primary_colour  text default '#1E40AF',
  banner_domain   text,
  portal_domain   text,
  email_from_name text,
  email_from_domain text,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
```

---

## 4. Row-Level Security

### 4.1 Enable RLS on ALL tables

```sql
-- No table is exempt. If it has data, it has RLS.
alter table organisations            enable row level security;
alter table organisation_members     enable row level security;
alter table web_properties           enable row level security;
alter table consent_banners          enable row level security;
alter table consent_events           enable row level security;
alter table data_inventory           enable row level security;
alter table rights_requests          enable row level security;
alter table rights_request_events    enable row level security;
alter table processing_log           enable row level security;
alter table breach_notifications     enable row level security;
alter table audit_log                enable row level security;
alter table delivery_buffer          enable row level security;
alter table export_configurations    enable row level security;
alter table consent_artefact_index   enable row level security;
alter table tracker_observations     enable row level security;
alter table tracker_overrides        enable row level security;
alter table integration_connectors   enable row level security;
alter table retention_rules          enable row level security;
alter table notification_channels    enable row level security;
alter table deletion_receipts        enable row level security;
alter table withdrawal_verifications enable row level security;
alter table security_scans           enable row level security;
alter table consent_probes           enable row level security;
alter table consent_probe_runs       enable row level security;
alter table api_keys                 enable row level security;
alter table gdpr_configurations      enable row level security;
alter table dpo_engagements          enable row level security;
alter table cross_border_transfers   enable row level security;
alter table white_label_configs      enable row level security;
-- tracker_signatures, sector_templates, dpo_partners: public reference data — RLS allows select for all authenticated
alter table tracker_signatures       enable row level security;
alter table sector_templates         enable row level security;
alter table dpo_partners             enable row level security;
```

### 4.2 Policies — Operational Tables (read/write by org)

```sql
-- Pattern: org members can read and write their own org's data
-- Apply this macro to: web_properties, consent_banners, data_inventory,
-- breach_notifications, tracker_overrides, integration_connectors,
-- retention_rules, notification_channels, export_configurations,
-- consent_artefact_index, consent_probes, api_keys, gdpr_configurations,
-- dpo_engagements, cross_border_transfers, white_label_configs

-- organisations
create policy "members can view own org" on organisations for select using (id = current_org_id());
create policy "admins can update own org" on organisations for update using (id = current_org_id() and is_org_admin());

-- organisation_members
create policy "members can view org members" on organisation_members for select using (org_id = current_org_id());
create policy "admins can manage members" on organisation_members for all using (org_id = current_org_id() and is_org_admin());

-- Standard org-scoped CRUD (generate for each operational table)
-- Using web_properties as example; apply same pattern to all operational tables listed above:
create policy "org_select" on web_properties for select using (org_id = current_org_id());
create policy "org_insert" on web_properties for insert with check (org_id = current_org_id());
create policy "org_update" on web_properties for update using (org_id = current_org_id());
create policy "org_delete" on web_properties for delete using (org_id = current_org_id() and is_org_admin());

-- Repeat for: consent_banners, data_inventory, breach_notifications, tracker_overrides,
-- integration_connectors, retention_rules, notification_channels, export_configurations,
-- consent_artefact_index, consent_probes, api_keys, gdpr_configurations,
-- dpo_engagements, cross_border_transfers, white_label_configs
```

### 4.3 Policies — Buffer Tables (read-only for users, written by service role)

```sql
-- consent_events: org members can READ. NO insert/update/delete for any user role.
create policy "org_read_consent_events" on consent_events for select using (org_id = current_org_id());

-- tracker_observations
create policy "org_read_tracker_obs" on tracker_observations for select using (org_id = current_org_id());

-- audit_log
create policy "org_read_audit_log" on audit_log for select using (org_id = current_org_id());

-- processing_log
create policy "org_read_processing_log" on processing_log for select using (org_id = current_org_id());

-- rights_request_events
create policy "org_read_rr_events" on rights_request_events for select using (org_id = current_org_id());

-- deletion_receipts
create policy "org_read_deletion_receipts" on deletion_receipts for select using (org_id = current_org_id());

-- withdrawal_verifications
create policy "org_read_withdrawal_ver" on withdrawal_verifications for select using (org_id = current_org_id());

-- security_scans
create policy "org_read_security_scans" on security_scans for select using (org_id = current_org_id());

-- consent_probe_runs
create policy "org_read_probe_runs" on consent_probe_runs for select using (org_id = current_org_id());

-- delivery_buffer
create policy "org_read_delivery_buffer" on delivery_buffer for select using (org_id = current_org_id());

-- NO insert, update, or delete policies on ANY of the above tables.
-- All writes come through the service role key which bypasses RLS.
```

### 4.4 Policies — Special Cases

```sql
-- rights_requests: public insert (Data Principal submits from hosted form)
create policy "org_read_rights_requests" on rights_requests for select using (org_id = current_org_id());
create policy "org_update_rights_requests" on rights_requests for update using (org_id = current_org_id());
create policy "public_insert_rights_requests" on rights_requests for insert with check (true);

-- Reference data: any authenticated user can read
create policy "auth_read_tracker_sigs" on tracker_signatures for select using (auth.role() = 'authenticated');
create policy "auth_read_sector_templates" on sector_templates for select using (auth.role() = 'authenticated');
create policy "auth_read_dpo_partners" on dpo_partners for select using (auth.role() = 'authenticated');
```

---

## 5. Scoped Database Roles

Three custom roles replace the single service role key in all running application code. The full `service_role` is retained for migrations and emergency admin only.

### 5.1 Role Creation

```sql
-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_worker — used by Cloudflare Worker ONLY
-- Principle: can write consent events and tracker observations.
-- Cannot read any other table. If this credential leaks,
-- the attacker can insert garbage but cannot read any data.
-- ═══════════════════════════════════════════════════════════
create role cs_worker with login password '<generate-strong-password>';

grant usage on schema public to cs_worker;

-- Can INSERT into consent event and observation buffers
grant insert on consent_events to cs_worker;
grant insert on tracker_observations to cs_worker;

-- Can SELECT banner config and web property info (to serve banners and verify HMAC)
grant select on consent_banners to cs_worker;
grant select on web_properties to cs_worker;

-- Can UPDATE snippet_last_seen_at on web_properties (non-blocking async update)
grant update (snippet_last_seen_at) on web_properties to cs_worker;

-- Can SELECT sequences (required for INSERT with gen_random_uuid)
grant usage on all sequences in schema public to cs_worker;

-- EXPLICITLY DENY everything else
-- (PostgreSQL denies by default, but being explicit for documentation)
revoke all on organisations from cs_worker;
revoke all on organisation_members from cs_worker;
revoke all on rights_requests from cs_worker;
revoke all on audit_log from cs_worker;
revoke all on processing_log from cs_worker;
revoke all on integration_connectors from cs_worker;
revoke all on export_configurations from cs_worker;
revoke all on delivery_buffer from cs_worker;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_delivery — used by delivery Edge Function ONLY
-- Principle: can read undelivered buffer rows, mark them delivered,
-- and delete them. Can read export config (to know where to deliver).
-- Cannot read any operational data.
-- ═══════════════════════════════════════════════════════════
create role cs_delivery with login password '<generate-strong-password>';

grant usage on schema public to cs_delivery;

-- Can SELECT undelivered rows from all buffer tables
grant select on consent_events to cs_delivery;
grant select on tracker_observations to cs_delivery;
grant select on audit_log to cs_delivery;
grant select on processing_log to cs_delivery;
grant select on delivery_buffer to cs_delivery;
grant select on rights_request_events to cs_delivery;
grant select on deletion_receipts to cs_delivery;
grant select on withdrawal_verifications to cs_delivery;
grant select on security_scans to cs_delivery;
grant select on consent_probe_runs to cs_delivery;

-- Can UPDATE delivered_at on all buffer tables
grant update (delivered_at) on consent_events to cs_delivery;
grant update (delivered_at) on tracker_observations to cs_delivery;
grant update (delivered_at) on audit_log to cs_delivery;
grant update (delivered_at) on processing_log to cs_delivery;
grant update (delivered_at) on delivery_buffer to cs_delivery;
grant update (delivered_at) on rights_request_events to cs_delivery;
grant update (delivered_at) on deletion_receipts to cs_delivery;
grant update (delivered_at) on withdrawal_verifications to cs_delivery;
grant update (delivered_at) on security_scans to cs_delivery;
grant update (delivered_at) on consent_probe_runs to cs_delivery;

-- Can DELETE delivered rows from all buffer tables
grant delete on consent_events to cs_delivery;
grant delete on tracker_observations to cs_delivery;
grant delete on audit_log to cs_delivery;
grant delete on processing_log to cs_delivery;
grant delete on delivery_buffer to cs_delivery;
grant delete on rights_request_events to cs_delivery;
grant delete on deletion_receipts to cs_delivery;
grant delete on withdrawal_verifications to cs_delivery;
grant delete on security_scans to cs_delivery;
grant delete on consent_probe_runs to cs_delivery;

-- Can read export configuration (encrypted credentials — needs master key to decrypt)
grant select on export_configurations to cs_delivery;

-- Can clean expired artefact index entries
grant delete on consent_artefact_index to cs_delivery;
grant select on consent_artefact_index to cs_delivery;

grant usage on all sequences in schema public to cs_delivery;

-- EXPLICITLY DENY operational tables
revoke all on organisations from cs_delivery;
revoke all on organisation_members from cs_delivery;
revoke all on consent_banners from cs_delivery;
revoke all on integration_connectors from cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_orchestrator — used by all other Edge Functions
-- Principle: can write to audit/processing/deletion tables,
-- can read operational data needed for orchestration.
-- Cannot directly read or delete consent_events.
-- ═══════════════════════════════════════════════════════════
create role cs_orchestrator with login password '<generate-strong-password>';

grant usage on schema public to cs_orchestrator;

-- Can INSERT into orchestration-written buffer tables
grant insert on audit_log to cs_orchestrator;
grant insert on processing_log to cs_orchestrator;
grant insert on rights_request_events to cs_orchestrator;
grant insert on deletion_receipts to cs_orchestrator;
grant insert on withdrawal_verifications to cs_orchestrator;
grant insert on security_scans to cs_orchestrator;
grant insert on consent_probe_runs to cs_orchestrator;
grant insert on delivery_buffer to cs_orchestrator;

-- Can read operational tables needed for orchestration
grant select on organisations to cs_orchestrator;
grant select on organisation_members to cs_orchestrator;
grant select on web_properties to cs_orchestrator;
grant select on integration_connectors to cs_orchestrator;
grant select on retention_rules to cs_orchestrator;
grant select on notification_channels to cs_orchestrator;
grant select on rights_requests to cs_orchestrator;
grant select on consent_artefact_index to cs_orchestrator;
grant select on consent_probes to cs_orchestrator;
grant select on data_inventory to cs_orchestrator;
-- deletion_receipts: rpc_deletion_receipt_confirm (SECURITY DEFINER owned by
-- cs_orchestrator) reads the row before updating. Added under ADR-1014
-- Sprint 3.4 via migration 20260804000030 — missing from initial migration 010.
grant select on deletion_receipts to cs_orchestrator;

-- export_configurations: ADR-1025 Phase 2 Sprint 2.1 — the Next.js
-- /api/internal/provision-storage route runs as cs_orchestrator and reads +
-- upserts export_configurations after a successful verification probe.
-- bypassrls covers RLS but NOT SQL-level privilege checks, so the grants
-- are explicit. No DELETE — ADR-1025's lifecycle model never deletes rows
-- from app-code. Added via migration 20260804000037.
grant select, insert, update on export_configurations to cs_orchestrator;
grant insert on export_verification_failures to cs_orchestrator;  -- migration 35 (Sprint 1.3)

-- storage_migrations: ADR-1025 Phase 3 Sprint 3.2 — the BYOK migration
-- orchestrator reads migration rows on every chunk and advances them
-- through queued → copying → completed | failed. INSERT is used by the
-- customer-facing /api/orgs/[orgId]/storage/byok-migrate route (which
-- runs as cs_orchestrator) and by admin.storage_migrate(). Migration 38.
grant select, insert, update on storage_migrations to cs_orchestrator;

-- Can update specific fields for automated workflows
grant update (status) on rights_requests to cs_orchestrator;
grant update (assignee_id) on rights_requests to cs_orchestrator;
grant update (plan, plan_started_at, razorpay_subscription_id, razorpay_customer_id) on organisations to cs_orchestrator;
grant update (validity_state) on consent_artefact_index to cs_orchestrator;
grant update (last_run_at, last_result, next_run_at) on consent_probes to cs_orchestrator;
grant update (last_health_check_at, last_error, status) on integration_connectors to cs_orchestrator;
grant update (last_checked_at, next_check_at) on retention_rules to cs_orchestrator;
grant update (status, confirmed_at, response_payload, failure_reason, retry_count) on deletion_receipts to cs_orchestrator;
grant update (scan_results, overall_status) on withdrawal_verifications to cs_orchestrator;

grant usage on all sequences in schema public to cs_orchestrator;

-- EXPLICITLY DENY direct access to consent events (Worker's domain)
revoke all on consent_events from cs_orchestrator;
revoke all on tracker_observations from cs_orchestrator;
```

### 5.2 Authenticated Role Restrictions (unchanged from before)

RLS prevents cross-tenant access. Role-level REVOKE prevents the application from modifying buffer tables even within the current org.

```sql
-- REVOKE UPDATE and DELETE on all buffer tables for the authenticated role
revoke update, delete on consent_events from authenticated;
revoke update, delete on tracker_observations from authenticated;
revoke update, delete on audit_log from authenticated;
revoke update, delete on processing_log from authenticated;
revoke update, delete on rights_request_events from authenticated;
revoke update, delete on delivery_buffer from authenticated;
revoke update, delete on deletion_receipts from authenticated;
revoke update, delete on withdrawal_verifications from authenticated;
revoke update, delete on security_scans from authenticated;
revoke update, delete on consent_probe_runs from authenticated;

-- REVOKE INSERT on critical buffers (written only by scoped roles)
revoke insert on consent_events from authenticated;
revoke insert on tracker_observations from authenticated;
revoke insert on audit_log from authenticated;
revoke insert on processing_log from authenticated;
revoke insert on delivery_buffer from authenticated;
```

---

## 6. Triggers

```sql
-- Auto-update updated_at on all mutable operational tables
create trigger trg_updated_at_organisations before update on organisations for each row execute function set_updated_at();
create trigger trg_updated_at_web_properties before update on web_properties for each row execute function set_updated_at();
create trigger trg_updated_at_data_inventory before update on data_inventory for each row execute function set_updated_at();
create trigger trg_updated_at_rights_requests before update on rights_requests for each row execute function set_updated_at();
create trigger trg_updated_at_breach_notifications before update on breach_notifications for each row execute function set_updated_at();
create trigger trg_updated_at_export_configs before update on export_configurations for each row execute function set_updated_at();
create trigger trg_updated_at_tracker_overrides before update on tracker_overrides for each row execute function set_updated_at();
create trigger trg_updated_at_integration_connectors before update on integration_connectors for each row execute function set_updated_at();
create trigger trg_updated_at_retention_rules before update on retention_rules for each row execute function set_updated_at();
create trigger trg_updated_at_notification_channels before update on notification_channels for each row execute function set_updated_at();
create trigger trg_updated_at_consent_probes before update on consent_probes for each row execute function set_updated_at();
create trigger trg_updated_at_gdpr_configs before update on gdpr_configurations for each row execute function set_updated_at();
create trigger trg_updated_at_cross_border before update on cross_border_transfers for each row execute function set_updated_at();
create trigger trg_updated_at_white_label before update on white_label_configs for each row execute function set_updated_at();

-- Auto-set legal deadlines
create trigger trg_sla_deadline before insert on rights_requests for each row execute function set_rights_request_sla();
create trigger trg_breach_deadline before insert on breach_notifications for each row execute function set_breach_deadline();
```

---

## 7. Buffer Lifecycle Functions

These functions implement the "process, deliver, delete" pipeline. They are called by Edge Functions using the service role key.

```sql
-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Mark a buffer row as delivered and delete it
-- Called immediately after confirmed write to customer storage.
-- Two-step: SET delivered_at, then DELETE. Both in one function call.
-- This matches the definitive architecture Section 7.1 specification.
-- ═══════════════════════════════════════════════════════════
create or replace function mark_delivered_and_delete(
  p_table_name text,
  p_row_id uuid
) returns void language plpgsql security definer as $$
begin
  execute format(
    'UPDATE %I SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL',
    p_table_name
  ) using p_row_id;

  execute format(
    'DELETE FROM %I WHERE id = $1 AND delivered_at IS NOT NULL',
    p_table_name
  ) using p_row_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Sweep — safety net for rows that survived immediate delete
-- Should find 0 rows in normal operation. Finding rows = investigate.
-- ═══════════════════════════════════════════════════════════
create or replace function sweep_delivered_buffers()
returns jsonb language plpgsql security definer as $$
declare
  counts jsonb := '{}';
  c integer;
begin
  delete from consent_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_events', c);

  delete from tracker_observations where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('tracker_observations', c);

  delete from audit_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('audit_log', c);

  delete from processing_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('processing_log', c);

  delete from delivery_buffer where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('delivery_buffer', c);

  delete from rights_request_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('rights_request_events', c);

  delete from deletion_receipts where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('deletion_receipts', c);

  delete from withdrawal_verifications where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('withdrawal_verifications', c);

  delete from security_scans where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('security_scans', c);

  delete from consent_probe_runs where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_probe_runs', c);

  -- Clean expired consent artefact index entries
  delete from consent_artefact_index where expires_at < now();
  get diagnostics c = row_count; counts := counts || jsonb_build_object('expired_artefacts', c);

  return counts;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- FUNCTION: Stuck row detection — alert if anything is undelivered for > 1 hour
-- Returns a table of (table_name, stuck_count). Empty = healthy.
-- ═══════════════════════════════════════════════════════════
create or replace function detect_stuck_buffers()
returns table(buffer_table text, stuck_count bigint, oldest_created timestamptz) language plpgsql security definer as $$
begin
  return query
  select 'consent_events'::text, count(*), min(created_at)
  from consent_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'tracker_observations', count(*), min(created_at)
  from tracker_observations where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'audit_log', count(*), min(created_at)
  from audit_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'processing_log', count(*), min(created_at)
  from processing_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'delivery_buffer', count(*), min(created_at)
  from delivery_buffer where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'rights_request_events', count(*), min(created_at)
  from rights_request_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'deletion_receipts', count(*), min(created_at)
  from deletion_receipts where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'withdrawal_verifications', count(*), min(created_at)
  from withdrawal_verifications where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'security_scans', count(*), min(created_at)
  from security_scans where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'consent_probe_runs', count(*), min(created_at)
  from consent_probe_runs where delivered_at is null and created_at < now() - interval '1 hour';
end;
$$;
```

---

## 8. Scheduled Jobs (pg_cron)

**Key choice:** All Edge Function invocations from pg_cron use the `cs_orchestrator` key, not the service role key. The sweep function (`sweep_delivered_buffers`) runs as a `security definer` function within PostgreSQL and does not call Edge Functions — it operates directly on the database. The service role key is never used in running application code, including scheduled jobs.

```sql
-- ═══════════════════════════════════════════════════════════
-- SWEEP: every 15 minutes — clean up any rows that survived
-- immediate deletion. Should find 0 rows in normal operation.
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'buffer-sweep-15min',
  '*/15 * * * *',
  $$ select sweep_delivered_buffers(); $$
);

-- ═══════════════════════════════════════════════════════════
-- STUCK DETECTION: every hour — alert if delivery pipeline is broken
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'stuck-buffer-detection-hourly',
  '0 * * * *',
  $$
  -- Call Edge Function to check and alert
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/check-stuck-buffers',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- SLA REMINDERS: daily at 08:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'sla-reminders-daily',
  '30 2 * * *',  -- 02:30 UTC = 08:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-sla-reminders',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- SECURITY SCAN: daily at 02:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'security-scan-nightly',
  '30 20 * * *',  -- 20:30 UTC = 02:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/run-security-scans',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);

-- ═══════════════════════════════════════════════════════════
-- RETENTION CHECK: daily at 03:00 IST
-- ═══════════════════════════════════════════════════════════
select cron.schedule(
  'retention-check-daily',
  '30 21 * * *',  -- 21:30 UTC = 03:00 IST
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/check-retention-rules',
    headers := '{"Authorization": "Bearer <cs_orchestrator_key>"}'::jsonb
  );
  $$
);
```

---

## 9. Post-Setup Verification Queries

Run these after initial setup to confirm all guards are active. Every query must return the expected result. If any fails, do not proceed with development.

```sql
-- ═══════════════════════════════════════════════════════════
-- VERIFY 1: RLS is enabled on every table
-- Expected: every table in the list. If any is missing, RLS is not active.
-- ═══════════════════════════════════════════════════════════
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'organisations', 'organisation_members', 'web_properties', 'consent_banners',
    'consent_events', 'data_inventory', 'rights_requests', 'rights_request_events',
    'processing_log', 'breach_notifications', 'audit_log', 'delivery_buffer',
    'export_configurations', 'consent_artefact_index', 'tracker_observations',
    'tracker_overrides', 'integration_connectors', 'retention_rules',
    'notification_channels', 'deletion_receipts', 'withdrawal_verifications',
    'security_scans', 'consent_probes', 'consent_probe_runs', 'api_keys',
    'gdpr_configurations', 'dpo_partners', 'dpo_engagements',
    'cross_border_transfers', 'white_label_configs', 'tracker_signatures',
    'sector_templates'
  )
order by tablename;
-- EXPECTED: rowsecurity = true for EVERY row

-- ═══════════════════════════════════════════════════════════
-- VERIFY 2: Buffer tables have no UPDATE/DELETE grants for authenticated role
-- ═══════════════════════════════════════════════════════════
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (
    'consent_events', 'tracker_observations', 'audit_log', 'processing_log',
    'rights_request_events', 'delivery_buffer', 'deletion_receipts',
    'withdrawal_verifications', 'security_scans', 'consent_probe_runs'
  )
  and privilege_type in ('UPDATE', 'DELETE');
-- EXPECTED: 0 rows. No UPDATE or DELETE privilege for authenticated on any buffer table.

-- ═══════════════════════════════════════════════════════════
-- VERIFY 3: Buffer tables have no INSERT grants for authenticated role
-- ═══════════════════════════════════════════════════════════
select grantee, table_name, privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in ('consent_events', 'tracker_observations', 'audit_log', 'processing_log', 'delivery_buffer')
  and privilege_type = 'INSERT';
-- EXPECTED: 0 rows.

-- ═══════════════════════════════════════════════════════════
-- VERIFY 4: SLA deadline trigger is active
-- ═══════════════════════════════════════════════════════════
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'rights_requests' and trigger_name = 'trg_sla_deadline';
-- EXPECTED: 1 row, INSERT, BEFORE

-- ═══════════════════════════════════════════════════════════
-- VERIFY 5: Breach deadline trigger is active
-- ═══════════════════════════════════════════════════════════
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_table = 'breach_notifications' and trigger_name = 'trg_breach_deadline';
-- EXPECTED: 1 row, INSERT, BEFORE

-- ═══════════════════════════════════════════════════════════
-- VERIFY 6: pg_cron jobs are scheduled
-- ═══════════════════════════════════════════════════════════
select jobname, schedule, active from cron.job;
-- EXPECTED: buffer-sweep-15min, stuck-buffer-detection-hourly,
-- sla-reminders-daily, security-scan-nightly, retention-check-daily
-- All active = true

-- ═══════════════════════════════════════════════════════════
-- VERIFY 7: No buffer tables contain stale data (should be 0 on fresh setup)
-- ═══════════════════════════════════════════════════════════
select * from detect_stuck_buffers() where stuck_count > 0;
-- EXPECTED: 0 rows

-- ═══════════════════════════════════════════════════════════
-- VERIFY 8: Scoped roles exist and have correct privileges
-- ═══════════════════════════════════════════════════════════
-- 8a: cs_worker role exists
select rolname from pg_roles where rolname = 'cs_worker';
-- EXPECTED: 1 row

-- 8b: cs_worker CANNOT select from organisations
-- (run as cs_worker)
-- SET ROLE cs_worker;
-- SELECT count(*) FROM organisations;
-- EXPECTED: permission denied

-- 8c: cs_worker CAN insert into consent_events
-- SET ROLE cs_worker;
-- INSERT INTO consent_events (org_id, property_id, banner_id, banner_version, session_fingerprint, event_type)
--   VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'test', 'consent_given');
-- EXPECTED: success (row will fail FK check but permission is granted)

-- 8d: cs_delivery CANNOT select from organisations
-- SET ROLE cs_delivery;
-- SELECT count(*) FROM organisations;
-- EXPECTED: permission denied

-- 8e: cs_delivery CAN delete from consent_events
-- SET ROLE cs_delivery;
-- DELETE FROM consent_events WHERE id = '<test_id>' AND delivered_at IS NOT NULL;
-- EXPECTED: success (0 rows affected on fresh DB, but permission is granted)

-- 8f: cs_orchestrator CANNOT select from consent_events
-- SET ROLE cs_orchestrator;
-- SELECT count(*) FROM consent_events;
-- EXPECTED: permission denied

-- 8g: cs_orchestrator CAN insert into audit_log
-- SET ROLE cs_orchestrator;
-- INSERT INTO audit_log (org_id, event_type) VALUES (gen_random_uuid(), 'test');
-- EXPECTED: success

-- RESET ROLE; after all scoped role tests

-- ═══════════════════════════════════════════════════════════
-- VERIFY 9: Event signing secrets exist on all web properties
-- ═══════════════════════════════════════════════════════════
select count(*) from web_properties where event_signing_secret is null or length(event_signing_secret) < 32;
-- EXPECTED: 0 rows (all properties have a signing secret)

-- ═══════════════════════════════════════════════════════════
-- VERIFY 10: All organisations have encryption salts
-- ═══════════════════════════════════════════════════════════
select count(*) from organisations where encryption_salt is null or length(encryption_salt) < 16;
-- EXPECTED: 0 rows

-- ═══════════════════════════════════════════════════════════
-- VERIFY 11: Cross-tenant isolation test
-- Run as authenticated user with org_id = 'org_A':
-- ═══════════════════════════════════════════════════════════
-- select count(*) from consent_events where org_id = 'org_B_id';
-- EXPECTED: 0
-- insert into consent_events (org_id, ...) values ('org_B_id', ...);
-- EXPECTED: new row violates row-level security policy (or permission denied)
```

---

## 10. Guard Summary

| Guard | What it protects | How it's enforced | Failure mode |
|---|---|---|---|
| RLS on every table | Cross-tenant data access | PostgreSQL RLS policies | Query returns 0 rows for wrong org |
| Revoked UPDATE/DELETE on buffer tables | Compliance record immutability | PostgreSQL role-level REVOKE | Permission denied error |
| Revoked INSERT on critical buffers | Preventing app-level writes to audit tables | PostgreSQL role-level REVOKE | Permission denied error |
| Append-only (no UPDATE/DELETE policy) | Consent event integrity | No RLS policy exists for UPDATE/DELETE | No policy = denied by default |
| SLA deadline trigger | Legal deadline accuracy | PostgreSQL trigger on INSERT | Deadline auto-set, cannot be forgotten |
| Breach deadline trigger | 72-hour DPB notification | PostgreSQL trigger on INSERT | Deadline auto-set, cannot be forgotten |
| Immediate deletion after delivery | Buffer tables don't accumulate personal data | mark_delivered_and_delete() function | Row deleted in same transaction as delivery confirmation |
| 15-minute sweep | Safety net for orphaned delivered rows | pg_cron job | Catches edge cases (crash between mark and delete) |
| 1-hour stuck detection | Delivery pipeline health | pg_cron → Edge Function → alert | Fires notification if pipeline is broken |
| Scoped role: cs_worker | Worker credential leak → vandalism not theft | PostgreSQL role with INSERT on 2 tables only | Attacker can insert garbage, cannot read data |
| Scoped role: cs_delivery | Delivery credential leak → read in-flight data only | PostgreSQL role with SELECT/DELETE on buffers only | Attacker sees minutes of hashed/truncated data |
| Scoped role: cs_orchestrator | Orchestration credential leak → limited operational access | PostgreSQL role without consent_events access | Attacker cannot read consent data |
| HMAC-signed consent events | Fake event injection from curl/bots | Banner script computes HMAC, Worker verifies | Invalid signature → 403 |
| Origin validation on Worker | Cross-origin event injection | Worker checks Origin/Referer vs registered URL | Mismatch → 403 |
| Worker rate limiting | Brute-force abuse of public endpoints | Cloudflare rate limiting rules | Excess requests → 429 |
| Signed deletion callbacks | Forged deletion confirmations | HMAC signature in callback URL | Invalid signature → rejected |
| Cloudflare Turnstile on rights requests | Bot spam flooding rights requests | Invisible CAPTCHA on submission form | Failed challenge → rejected |
| Email OTP on rights requests | Spam via fake email addresses | OTP verification before notification fires | Unverified → no compliance contact notification |
| Per-org encryption key derivation | Single master key leak exposing all credentials | HMAC-SHA256(master_key, org_id + salt) | Master key leak → still need per-org derivation |
| Event signing secret per property | Replay attacks on consent events | Timestamp ±5 min window + HMAC | Expired timestamp or wrong secret → 403 |
| Write-only export credentials | Customer data cannot be read back | IAM scoped to PutObject only | Compromise = write to encrypted bucket you can't decrypt |
| Encrypted connector credentials | OAuth tokens for deletion APIs | pgcrypto encryption with per-org derived key | Stored as bytea, never in logs |
| Sentry scrubbing | Credential/PII leak via error tracking | beforeSend strips headers/body/cookies/params | Only stack traces reach Sentry |
| Hardware 2FA on infrastructure | Social engineering / credential stuffing | YubiKey required on all admin accounts | Cannot authenticate without physical key |
| Zero Worker dependencies | Supply chain attack via npm | Vanilla TypeScript policy | No third-party code in banner delivery path |
| Processing mode enforcement | Zero-Storage orgs never persist data | Checked at API gateway before any write | Wrong mode = data persisted that should be in-memory only |

---

## 11. DEPA Alignment

*Added 2026-04-16 per the [DEPA package architecture review](../reviews/2026-04-16-depa-package-architecture-review.md).*

### 11.1 Overview

§11 extends the schema to make ConsentShield DEPA-native: one consent artefact per purpose per interaction, each with a stable external ID, declared `data_scope`, explicit `expires_at`, and independent revocation and expiry lifecycles. The existing §1–§10 schema is unchanged except for the ALTER TABLE amendments in §11.3. All new objects live in §11.

**Categorisation (per Q1 Option B in the Phase A review):** `consent_artefacts`, `purpose_definitions`, `purpose_connector_mappings`, `consent_expiry_queue`, and `depa_compliance_metrics` are Category A (operational). `artefact_revocations` is Category B (buffer). `consent_artefacts` and a few other Category A tables carry the orthogonal "delivered to customer storage" property via `delivery_buffer` staging — see definitive-architecture §3 for the classification model.

**Artefact-creation pipeline (per Q2 Option D in the Phase A review):** primary path is an `AFTER INSERT` trigger on `consent_events` that fires `net.http_post()` to the `process-consent-event` Edge Function. Safety net is a pg_cron job every 5 minutes that sweeps orphan events. Both paths share the same idempotent Edge Function. The trigger body is wrapped in `EXCEPTION WHEN OTHERS THEN NULL` so a failing trigger never rolls back the Worker's INSERT — the Worker always returns 202.

**No legacy in the data model (per the Phase B review).** Runtime behaviour: every banner purpose MUST carry a `purpose_definition_id`; missing mappings are configuration errors to be caught and fixed, not gradients to tolerate. This is a *data-model* posture, not a statement about schema objects — the dev Supabase instance does have pre-DEPA tables (`consent_events`, `deletion_receipts`, `consent_artefact_index`, `consent_banners`), and §11.3 evolves them in place via ALTER TABLE. Customer consent data is zero across all environments, so no data-migration path exists or is needed; schema-object evolution is a routine dev operation. See §11.13 for the ALTER-vs-DROP+RECREATE decision per amendment.

**Regulated sensitive content (per Rule 3 as broadened in Phase B).** The DEPA `data_scope` column on `consent_artefacts` and `purpose_definitions` holds **category declarations** (e.g., `'pan'`, `'email_address'`, `'MedicationRequest'`) — never actual values. No DDL in §11 admits a column where regulated content (FHIR resource payloads, PAN values, Aadhaar values, bank statements, transaction records) could be written. A review that encounters such a column rejects the change.

---

### 11.2 New Helper Functions

```sql
-- ═══════════════════════════════════════════════════════════
-- generate_artefact_id() — stable, time-sortable external ID
-- Format: 'cs_art_' + 26-character ULID.
-- Stored as text (not uuid) so time-ordered retrieval does not
-- require a created_at index on large tables.
-- ═══════════════════════════════════════════════════════════
create or replace function generate_artefact_id()
returns text language plpgsql as $$
declare
  t bigint;
  r text := '';
  chars text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  i int;
begin
  t := extract(epoch from now()) * 1000;
  for i in 1..10 loop
    r := substring(chars from (t % 32)::int + 1 for 1) || r;
    t := t / 32;
  end loop;
  for i in 1..16 loop
    r := r || substring(chars from (floor(random() * 32))::int + 1 for 1);
  end loop;
  return 'cs_art_' || r;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- compute_depa_score(org_id) — 0–20 DEPA-quality score
-- Called by depa-score-refresh-nightly pg_cron job.
-- ═══════════════════════════════════════════════════════════
create or replace function compute_depa_score(p_org_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_coverage_score   numeric;
  v_expiry_score     numeric;
  v_freshness_score  numeric;
  v_revocation_score numeric;
  v_total            numeric;
begin
  -- Sub-metric 1: Artefact coverage
  -- % of active purpose_definitions that have data_scope populated.
  select case
    when count(*) = 0 then 0
    else round((count(*) filter (where array_length(data_scope, 1) > 0)::numeric / count(*)) * 5, 1)
  end
  into v_coverage_score
  from purpose_definitions
  where org_id = p_org_id and is_active = true;

  -- Sub-metric 2: Expiry definition
  -- % of active purpose_definitions with an explicitly set expiry (not the system default).
  select case
    when count(*) = 0 then 0
    else round((count(*) filter (where default_expiry_days != 365)::numeric / count(*)) * 5, 1)
  end
  into v_expiry_score
  from purpose_definitions
  where org_id = p_org_id and is_active = true;

  -- Sub-metric 3: Artefact freshness
  -- % of active artefacts that expire more than 90 days in the future.
  select case
    when count(*) = 0 then 5
    else round((count(*) filter (where expires_at > now() + interval '90 days')::numeric / count(*)) * 5, 1)
  end
  into v_freshness_score
  from consent_artefacts
  where org_id = p_org_id and status = 'active';

  -- Sub-metric 4: Revocation chain completeness
  -- % of revocations with a confirmed deletion_receipt within 30 days.
  select case
    when count(*) = 0 then 5
    else round((count(dr.id)::numeric / count(ar.id)) * 5, 1)
  end
  into v_revocation_score
  from artefact_revocations ar
  left join deletion_receipts dr
    on dr.artefact_id = ar.artefact_id
   and dr.status = 'completed'
   and dr.created_at < ar.revoked_at + interval '30 days'
  where ar.org_id = p_org_id
    and ar.revoked_at > now() - interval '90 days';

  v_total := coalesce(v_coverage_score, 0)
           + coalesce(v_expiry_score, 0)
           + coalesce(v_freshness_score, 0)
           + coalesce(v_revocation_score, 0);

  return jsonb_build_object(
    'total',             v_total,
    'coverage_score',    v_coverage_score,
    'expiry_score',      v_expiry_score,
    'freshness_score',   v_freshness_score,
    'revocation_score',  v_revocation_score,
    'computed_at',       now()
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- enforce_artefact_expiry() — nightly pg_cron job
-- Transitions expired active artefacts to status = 'expired',
-- removes them from the validity cache, writes audit log, and
-- stages deletion if the purpose definition has
-- auto_delete_on_expiry = true.
-- ═══════════════════════════════════════════════════════════
create or replace function enforce_artefact_expiry()
returns void language plpgsql security definer as $$
declare
  v_artefact record;
  v_auto_delete boolean;
begin
  for v_artefact in
    select ca.id, ca.org_id, ca.artefact_id, ca.purpose_definition_id, ca.data_scope
    from consent_artefacts ca
    where ca.status = 'active'
      and ca.expires_at <= now()
  loop
    update consent_artefacts set status = 'expired' where id = v_artefact.id;

    delete from consent_artefact_index
     where artefact_id = v_artefact.artefact_id
       and org_id = v_artefact.org_id;

    insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
    values (
      v_artefact.org_id,
      'consent_artefact_expired',
      'consent_artefacts',
      v_artefact.id,
      jsonb_build_object('artefact_id', v_artefact.artefact_id, 'reason', 'ttl_exceeded')
    );

    select auto_delete_on_expiry into v_auto_delete
      from purpose_definitions where id = v_artefact.purpose_definition_id;

    if v_auto_delete then
      insert into delivery_buffer (org_id, event_type, payload)
      values (
        v_artefact.org_id,
        'artefact_expiry_deletion',
        jsonb_build_object(
          'artefact_id', v_artefact.artefact_id,
          'data_scope',  v_artefact.data_scope,
          'reason',      'consent_expired'
        )
      );
    end if;

    update consent_expiry_queue
       set processed_at = now()
     where artefact_id = v_artefact.artefact_id
       and processed_at is null;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- send_expiry_alerts() — daily pg_cron job
-- Identifies artefacts approaching expiry and stages expiry-alert
-- payloads in delivery_buffer (Edge Function dispatches emails).
-- ═══════════════════════════════════════════════════════════
create or replace function send_expiry_alerts()
returns void language plpgsql security definer as $$
declare
  v_entry record;
begin
  for v_entry in
    select ceq.id, ceq.org_id, ceq.artefact_id, ceq.purpose_code,
           ceq.expires_at, o.compliance_contact_email
      from consent_expiry_queue ceq
      join organisations o on o.id = ceq.org_id
     where ceq.notify_at <= now()
       and ceq.notified_at is null
       and ceq.processed_at is null
       and ceq.superseded = false
  loop
    update consent_expiry_queue set notified_at = now() where id = v_entry.id;

    insert into delivery_buffer (org_id, event_type, payload)
    values (
      v_entry.org_id,
      'consent_expiry_alert',
      jsonb_build_object(
        'artefact_id',        v_entry.artefact_id,
        'purpose_code',       v_entry.purpose_code,
        'expires_at',         v_entry.expires_at,
        'compliance_contact', v_entry.compliance_contact_email
      )
    );
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- trigger_process_consent_event() — AFTER INSERT on consent_events
-- Q2 Option D primary path: fires net.http_post to the
-- process-consent-event Edge Function. Trigger body is wrapped in
-- EXCEPTION WHEN OTHERS THEN NULL so a failing trigger NEVER rolls
-- back the Worker's INSERT. Safety-net cron (§11.10) picks up any
-- dropped events.
-- ═══════════════════════════════════════════════════════════
create or replace function trigger_process_consent_event()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'supabase_url' limit 1)
             || '/functions/v1/process-consent-event',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'cs_orchestrator_key' limit 1),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object('consent_event_id', NEW.id)
    );
  exception when others then
    -- Never block the INSERT. The safety-net cron catches orphans.
    null;
  end;
  return null;  -- AFTER INSERT trigger — return value ignored.
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- trigger_process_artefact_revocation() — AFTER INSERT on
-- artefact_revocations. Dispatches the out-of-database cascade
-- (purpose_connector_mappings lookup + deletion_receipts fan-out)
-- to the process-artefact-revocation Edge Function. The in-
-- database cascade (status update, validity index removal, audit
-- log) is handled by trg_artefact_revocation_cascade (§11.8).
-- Idempotency contract (load-bearing, mirrors ADR-0021):
--   UNIQUE (trigger_id, connector_id) WHERE trigger_type =
--   'consent_revoked' on deletion_receipts + ON CONFLICT DO
--   NOTHING in the Edge Function + dispatched_at fast-path on
--   artefact_revocations.
-- ═══════════════════════════════════════════════════════════
create or replace function trigger_process_artefact_revocation()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'supabase_url' limit 1)
             || '/functions/v1/process-artefact-revocation',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'cs_orchestrator_key' limit 1),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object(
        'artefact_id',   NEW.artefact_id,
        'revocation_id', NEW.id
      )
    );
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- safety_net_process_consent_events() — pg_cron helper
-- Picks up consent_events with empty artefact_ids older than 5
-- minutes (trigger dispatch dropped) and re-fires the Edge
-- Function. Idempotent — the Edge Function's idempotency contract
-- (§11.1, load-bearing) prevents duplicate artefact creation.
-- ═══════════════════════════════════════════════════════════
create or replace function safety_net_process_consent_events()
returns integer language plpgsql security definer as $$
declare
  v_event_id uuid;
  v_count    integer := 0;
begin
  for v_event_id in
    select id from consent_events
     where artefact_ids = '{}'
       and created_at < now() - interval '5 minutes'
       and created_at > now() - interval '24 hours'
     limit 100
  loop
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                where name = 'supabase_url' limit 1)
               || '/functions/v1/process-consent-event',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                         where name = 'cs_orchestrator_key' limit 1),
          'Content-Type',  'application/json'
        ),
        body := jsonb_build_object('consent_event_id', v_event_id)
      );
      v_count := v_count + 1;
    exception when others then
      null;  -- Continue processing other events.
    end;
  end loop;
  return v_count;
end;
$$;
```

---

### 11.3 Amendments to Existing Tables (ALTER TABLE)

Five existing tables gain columns to connect them to the DEPA artefact model.

```sql
-- ═══════════════════════════════════════════════════════════
-- consent_events — gain artefact_ids back-reference
-- Populated by the process-consent-event Edge Function after
-- artefact creation. Empty array → event has no artefacts yet
-- (either the trigger/cron dispatch is still in flight, or the
-- event is orphaned and needs investigation — see §11.10 for the
-- safety-net pickup rules).
-- ═══════════════════════════════════════════════════════════
alter table consent_events
  add column artefact_ids text[] not null default '{}';

create index idx_consent_events_artefact_ids
  on consent_events using gin (artefact_ids);

create index idx_consent_events_awaiting_artefact
  on consent_events (created_at)
  where artefact_ids = '{}';

comment on column consent_events.artefact_ids is
  'Denormalised list of consent_artefacts.artefact_id values generated from this event. '
  'Populated by process-consent-event Edge Function after successful fan-out. '
  'Empty array older than 5 minutes indicates the dispatch pipeline is broken — '
  'safety-net pg_cron (§11.10) picks these up for retry.';

-- ═══════════════════════════════════════════════════════════
-- deletion_receipts — request+receipt hybrid for the artefact-
-- scoped chain of custody. Populated by process-artefact-
-- revocation (for consent_revoked triggers), enforce_artefact_
-- expiry() (for consent_expired / retention_expired triggers),
-- and the rights-portal erasure dispatcher (erasure_request
-- trigger, NULL artefact_id).
--
-- Semantics (per ADR-0022 Option 2): deletion_receipts is both
-- the dispatch instruction and the confirmation receipt for a
-- single connector instruction. status='pending' means the row
-- has been created but the connector has not confirmed;
-- status='confirmed' or 'failed' means the callback has closed
-- the loop. There is no separate deletion_requests table — the
-- two roles are disambiguated by status.
-- ═══════════════════════════════════════════════════════════
alter table deletion_receipts
  add column artefact_id text references consent_artefacts(artefact_id) on delete set null;

create index idx_deletion_receipts_artefact
  on deletion_receipts (artefact_id)
  where artefact_id is not null;

comment on column deletion_receipts.artefact_id is
  'Consent artefact whose revocation or expiry triggered this deletion. '
  'NULL for rights-request-triggered erasures (DPDP Section 13 full erasure) '
  'and for retention-rule-driven deletions. '
  'Non-null for consent_revoked and consent_expired triggers. '
  'Completes the 3-link chain-of-custody: '
  'consent_artefacts → artefact_revocations → deletion_receipts.';

-- ═══════════════════════════════════════════════════════════
-- consent_artefact_index — extend from ABDM-specific to
-- multi-framework validity cache (per S-3 in the Phase A review).
-- Populated by process-consent-event for every created artefact;
-- removed by the revocation trigger and by enforce_artefact_expiry().
-- ═══════════════════════════════════════════════════════════
alter table consent_artefact_index
  add column framework   text not null default 'abdm',
  add column purpose_code text;

create index idx_consent_artefact_index_framework
  on consent_artefact_index (org_id, framework)
  where validity_state = 'active';

comment on column consent_artefact_index.framework is
  'dpdp | abdm | gdpr — which framework this artefact belongs to. '
  'Default ''abdm'' preserves the pre-DEPA semantics of this table; '
  'new DEPA artefacts write the correct framework at insert time.';

comment on column consent_artefact_index.purpose_code is
  'Machine-readable purpose code. Used for fast lookup during tracker enforcement '
  'without joining back to consent_artefacts.';

-- ═══════════════════════════════════════════════════════════
-- consent_banners.purposes — JSONB object-schema extension
-- (documentation only; no ALTER TABLE needed).
--
-- Every purpose object in the purposes array MUST include
-- purpose_definition_id after this amendment. The banner save
-- and publish API endpoints reject requests with HTTP 422 if any
-- purpose object lacks it — see definitive-architecture §6.7.
--
-- Updated purpose object schema:
--   {
--     id: string,                    -- 'analytics' | 'marketing' | custom
--     purpose_definition_id: uuid,   -- REQUIRED. FK to purpose_definitions.id.
--     name: string,
--     description: string,
--     data_scope: string[],          -- snapshot copy from purpose_definitions at save time
--     default_expiry_days: integer,  -- snapshot copy
--     auto_delete_on_expiry: boolean,-- snapshot copy
--     required: boolean,
--     default: boolean
--   }
-- ═══════════════════════════════════════════════════════════
```

---

### 11.4 New Tables

Execute in order. Foreign-key dependencies require `purpose_definitions` before `consent_artefacts`, and `consent_artefacts` before `artefact_revocations` and `consent_expiry_queue`.

```sql
-- ═══════════════════════════════════════════════════════════
-- 11.4.1  purpose_definitions  (Category A.1 operational)
-- Canonical purpose library per organisation. Banners reference
-- purpose_definition_id from their purposes JSONB. Artefacts copy
-- data_scope and default_expiry_days from here at creation time.
-- Mutable (admins can edit descriptions and expiry windows);
-- purpose_code is stable (unique per org per framework).
-- ═══════════════════════════════════════════════════════════
create table purpose_definitions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  purpose_code          text not null,                 -- machine-readable, stable
  display_name          text not null,                 -- shown to user in banner
  description           text not null,                 -- plain language, shown in preference centre
  data_scope            text[] not null default '{}',  -- CATEGORIES (e.g. 'email_address'), never values
  default_expiry_days   integer not null default 365,  -- 0 → 'infinity' (rarely used)
  auto_delete_on_expiry boolean not null default false,
  is_required           boolean not null default false,-- required purposes generate NO artefacts
  framework             text not null default 'dpdp',  -- 'dpdp' | 'abdm' | 'gdpr' (gdpr reserved for Phase 3)
  abdm_hi_types         text[] default null,           -- FHIR resource type NAMES (not content), abdm only
  is_active             boolean not null default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (org_id, purpose_code, framework)
);

comment on table purpose_definitions is
  'Canonical purpose library per organisation. Source of truth for what each '
  'purpose means: what data category it covers, how long consent lasts, and '
  'what to delete on revocation. data_scope is a CATEGORY list (e.g. ''pan'', '
  '''email_address'') — never actual values. Do not delete a purpose_definition '
  'that has active consent_artefacts; deactivate via is_active = false instead.';

-- ═══════════════════════════════════════════════════════════
-- 11.4.2  purpose_connector_mappings  (Category A.1 operational)
-- Maps (purpose_definition × data_scope category) → connector.
-- Drives the artefact-scoped deletion orchestration in §8.4 of
-- the definitive architecture.
-- ═══════════════════════════════════════════════════════════
create table purpose_connector_mappings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organisations(id) on delete cascade,
  purpose_definition_id uuid not null references purpose_definitions(id) on delete cascade,
  connector_id          uuid not null references integration_connectors(id) on delete cascade,
  data_categories       text[] not null default '{}',  -- SUBSET of purpose_definitions.data_scope
  created_at            timestamptz default now(),
  unique (purpose_definition_id, connector_id)
);

comment on table purpose_connector_mappings is
  'Links purpose data_scope categories to deletion connectors. When an artefact '
  'is revoked, this table determines which connectors handle which data categories. '
  'Without a mapping, the revocation alert fires but automated deletion cannot execute.';

-- ═══════════════════════════════════════════════════════════
-- 11.4.3  consent_artefacts  (Category A.1 operational,
--                             delivered via delivery_buffer staging)
--
-- The DEPA-native consent record. One row per purpose per consent
-- interaction. APPEND-ONLY for authenticated role (Rule 19);
-- status transitions via (a) artefact_revocations INSERT trigger,
-- (b) enforce_artefact_expiry() pg_cron, or (c) process-consent-
-- event re-consent path. Rows are NOT deleted on delivery — the
-- delivery happens via delivery_buffer staging while the row
-- stays in this table for active-status queries.
--
-- Replacement chain semantics (per S-5 in the Phase A review):
-- if A is replaced by B and B is later revoked, A stays frozen
-- at 'replaced'. Revocation does NOT walk the replaced_by chain.
-- ═══════════════════════════════════════════════════════════
create table consent_artefacts (
  id                    uuid primary key default gen_random_uuid(),
  artefact_id           text not null unique default generate_artefact_id(),
  org_id                uuid not null,                 -- denormalised for RLS (same pattern as consent_events)
  property_id           uuid not null references web_properties(id),
  banner_id             uuid not null references consent_banners(id),
  banner_version        integer not null,              -- snapshot of banner version user saw
  consent_event_id      uuid not null references consent_events(id),
  session_fingerprint   text not null,                 -- matches consent_events.session_fingerprint
  purpose_definition_id uuid not null references purpose_definitions(id),
  purpose_code          text not null,                 -- denormalised from purpose_definitions
  data_scope            text[] not null default '{}',  -- SNAPSHOT of data_scope at creation — CATEGORIES, not values
  framework             text not null default 'dpdp',
  expires_at            timestamptz not null,          -- mandatory per Rule 20
  status                text not null default 'active',-- 'active' | 'revoked' | 'expired' | 'replaced'
  replaced_by           text references consent_artefacts(artefact_id),
  abdm_artefact_id      text,                          -- framework = 'abdm' only
  abdm_hip_id           text,
  abdm_hiu_id           text,
  abdm_fhir_types       text[],                        -- FHIR resource type NAMES — not content
  created_at            timestamptz default now()
  -- No updated_at. Status transitions are externally enforced.
);

comment on table consent_artefacts is
  'DEPA-native consent artefact table. One row per purpose per consent interaction. '
  'Authoritative record for compliance, audit, and deletion orchestration. '
  'APPEND-ONLY for authenticated role (Rule 19). Status changes via triggers, pg_cron, '
  'and Edge Functions only. Exported to customer storage via delivery_buffer staging; '
  'the row itself is retained while status = ''active'' for revocation and expiry queries. '
  'data_scope and abdm_fhir_types are category declarations — never regulated content values (Rule 3).';

-- ═══════════════════════════════════════════════════════════
-- 11.4.4  artefact_revocations  (Category B buffer)
-- Immutable revocation records. Inserting a row triggers the
-- in-database cascade (status → revoked, index removal, audit
-- log) AND the out-of-database cascade (Edge Function creates
-- deletion_receipts for the mapped connectors). See §11.8.
-- APPEND-ONLY. No UPDATE or DELETE for any role.
-- ═══════════════════════════════════════════════════════════
create table artefact_revocations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,                       -- denormalised for RLS
  artefact_id     text not null references consent_artefacts(artefact_id),
  revoked_at      timestamptz not null default now(),
  reason          text not null,                       -- 'user_preference_change' | 'user_withdrawal' |
                                                       -- 'business_withdrawal' | 'data_breach' | 'regulatory_instruction'
  revoked_by_type text not null,                       -- 'data_principal' | 'organisation' | 'system' | 'regulator'
  revoked_by_ref  text,                                -- session_fingerprint | user_id | instruction ref | NULL
  notes           text,
  delivered_at    timestamptz,                         -- buffer-pattern delivery tracking
  created_at      timestamptz default now()
);

comment on table artefact_revocations is
  'Immutable log of every consent artefact revocation. Inserting a row here is '
  'the mechanism for revoking an artefact — the trigger updates consent_artefacts.status. '
  'Do not attempt to UPDATE consent_artefacts.status directly from application code. '
  'Exported to customer storage and deleted from this table after confirmed delivery.';

-- ═══════════════════════════════════════════════════════════
-- 11.4.5  consent_expiry_queue  (Category A.1 operational)
-- Scheduled expiry management per artefact. Rows are retained as
-- a historical expiry audit trail — NOT deleted after processing.
-- ═══════════════════════════════════════════════════════════
create table consent_expiry_queue (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  artefact_id     text not null references consent_artefacts(artefact_id) on delete cascade,
  purpose_code    text not null,                       -- denormalised for efficient alert batching
  expires_at      timestamptz not null,
  notify_at       timestamptz not null,                -- expires_at - 30 days
  notified_at     timestamptz,                         -- null = alert not yet sent
  processed_at    timestamptz,                         -- null = pending enforcement
  superseded      boolean not null default false,      -- true if re-consented before expiry
  created_at      timestamptz default now()
);

comment on table consent_expiry_queue is
  'Scheduled expiry management for consent artefacts. One row per finite-expiry '
  'artefact, created by trigger on consent_artefacts INSERT. notify_at fires '
  'expiry alerts via send_expiry_alerts() pg_cron; enforce_artefact_expiry() reads '
  'consent_artefacts directly and updates this table as a side effect. Rows are '
  'NOT deleted after processing — they form a historical expiry audit trail.';

-- ═══════════════════════════════════════════════════════════
-- 11.4.6  depa_compliance_metrics  (Category A.1 operational)
-- Cached DEPA compliance score per organisation. Refreshed nightly
-- by the depa-score-refresh-nightly pg_cron job. Read by the
-- compliance score API without recomputing.
-- ═══════════════════════════════════════════════════════════
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
  'depa-score-refresh-nightly pg_cron job. Stale by at most 24 hours. '
  'Staleness is surfaced in the dashboard if computed_at is older than 25 hours.';
```

---

### 11.5 New Indexes

```sql
-- purpose_definitions
create index idx_purpose_defs_org           on purpose_definitions (org_id);
create index idx_purpose_defs_org_framework on purpose_definitions (org_id, framework);
create index idx_purpose_defs_code          on purpose_definitions (org_id, purpose_code);

-- purpose_connector_mappings
create index idx_pcm_purpose_def on purpose_connector_mappings (purpose_definition_id);
create index idx_pcm_connector   on purpose_connector_mappings (connector_id);

-- consent_artefacts
create index idx_artefacts_org_status
  on consent_artefacts (org_id, status);
create index idx_artefacts_org_status_expires
  on consent_artefacts (org_id, status, expires_at)
  where status = 'active';
create index idx_artefacts_fingerprint
  on consent_artefacts (org_id, session_fingerprint)
  where status = 'active';
create index idx_artefacts_event_id
  on consent_artefacts (consent_event_id);
create index idx_artefacts_purpose_def
  on consent_artefacts (purpose_definition_id);
create index idx_artefacts_framework
  on consent_artefacts (org_id, framework, status)
  where status = 'active';
create index idx_artefacts_abdm
  on consent_artefacts (abdm_artefact_id)
  where abdm_artefact_id is not null;

-- artefact_revocations
create index idx_revocations_artefact   on artefact_revocations (artefact_id);
create index idx_revocations_org_time   on artefact_revocations (org_id, revoked_at desc);
create index idx_revocations_undelivered on artefact_revocations (delivered_at)
  where delivered_at is null;

-- consent_expiry_queue
create index idx_expiry_queue_alert_pending
  on consent_expiry_queue (notify_at)
  where notified_at is null and superseded = false;
create index idx_expiry_queue_org_upcoming
  on consent_expiry_queue (org_id, expires_at)
  where processed_at is null and superseded = false;
create index idx_expiry_queue_artefact
  on consent_expiry_queue (artefact_id);
```

---

### 11.6 Row-Level Security — New Policies

```sql
alter table purpose_definitions         enable row level security;
alter table purpose_connector_mappings  enable row level security;
alter table consent_artefacts           enable row level security;
alter table artefact_revocations        enable row level security;
alter table consent_expiry_queue        enable row level security;
alter table depa_compliance_metrics     enable row level security;

-- ═══════════════════════════════════════════════════════════
-- purpose_definitions — admin-managed mutable config
-- ═══════════════════════════════════════════════════════════
create policy "purpose_defs_select_own"
  on purpose_definitions for select
  using (org_id = current_org_id());

create policy "purpose_defs_insert_admin"
  on purpose_definitions for insert
  with check (org_id = current_org_id() and is_org_admin());

create policy "purpose_defs_update_admin"
  on purpose_definitions for update
  using (org_id = current_org_id() and is_org_admin());
-- No DELETE policy. Deactivate via is_active = false.

-- ═══════════════════════════════════════════════════════════
-- purpose_connector_mappings — admin-managed
-- ═══════════════════════════════════════════════════════════
create policy "pcm_select_own"
  on purpose_connector_mappings for select
  using (org_id = current_org_id());

create policy "pcm_insert_admin"
  on purpose_connector_mappings for insert
  with check (org_id = current_org_id() and is_org_admin());

create policy "pcm_delete_admin"
  on purpose_connector_mappings for delete
  using (org_id = current_org_id() and is_org_admin());

-- ═══════════════════════════════════════════════════════════
-- consent_artefacts — append-only for authenticated (Rule 19)
-- No INSERT, UPDATE, or DELETE policy for authenticated role.
-- All writes flow through the process-consent-event Edge Function
-- running as cs_orchestrator (bypass-RLS scoped role).
-- ═══════════════════════════════════════════════════════════
create policy "artefacts_select_own"
  on consent_artefacts for select
  using (org_id = current_org_id());

-- ═══════════════════════════════════════════════════════════
-- artefact_revocations — append-only; any org member can revoke
-- via the rights centre or preference centre. The BEFORE trigger
-- (§11.8) validates the artefact belongs to the claimed org.
-- ═══════════════════════════════════════════════════════════
create policy "revocations_select_own"
  on artefact_revocations for select
  using (org_id = current_org_id());

create policy "revocations_insert_own"
  on artefact_revocations for insert
  with check (org_id = current_org_id());
-- No UPDATE or DELETE policy (immutability).

-- ═══════════════════════════════════════════════════════════
-- consent_expiry_queue — read-only for authenticated
-- ═══════════════════════════════════════════════════════════
create policy "expiry_queue_select_own"
  on consent_expiry_queue for select
  using (org_id = current_org_id());

-- ═══════════════════════════════════════════════════════════
-- depa_compliance_metrics — read-only for authenticated
-- ═══════════════════════════════════════════════════════════
create policy "depa_metrics_select_own"
  on depa_compliance_metrics for select
  using (org_id = current_org_id());
```

---

### 11.7 Scoped Role Grant Additions

Mirrors the amendments in definitive-architecture §5.4.

```sql
-- ═══════════════════════════════════════════════════════════
-- cs_worker — NO new grants. The Worker creates consent_events;
-- the Edge Function running as cs_orchestrator creates artefacts.
-- cs_worker has no DEPA table access.
-- ═══════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- cs_delivery — extends to the new buffer table and the artefact
-- + purpose_definitions tables (needed to assemble delivery payload).
-- ═══════════════════════════════════════════════════════════
grant select, delete                on artefact_revocations to cs_delivery;
grant update (delivered_at)         on artefact_revocations to cs_delivery;
grant select                        on consent_artefacts    to cs_delivery;
grant select                        on purpose_definitions  to cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- cs_orchestrator — extends to create artefacts, read the DEPA
-- tables, and update the specific fields the DEPA pipeline mutates.
-- ═══════════════════════════════════════════════════════════
grant select                                on consent_events           to cs_orchestrator;
grant update (artefact_ids)                 on consent_events           to cs_orchestrator;

grant select                                on purpose_definitions      to cs_orchestrator;
grant select                                on purpose_connector_mappings to cs_orchestrator;

grant insert, select                        on consent_artefacts        to cs_orchestrator;
grant update (status, replaced_by)          on consent_artefacts        to cs_orchestrator;

grant insert                                on artefact_revocations     to cs_orchestrator;

grant select                                on consent_expiry_queue     to cs_orchestrator;
grant update (notified_at, processed_at, superseded)
                                            on consent_expiry_queue     to cs_orchestrator;

grant insert, select, update                on depa_compliance_metrics  to cs_orchestrator;

grant usage on all sequences in schema public to cs_delivery, cs_orchestrator;
```

---

### 11.8 New Triggers

```sql
-- ═══════════════════════════════════════════════════════════
-- trg_consent_event_artefact_dispatch (AFTER INSERT on consent_events)
-- Q2 Option D primary path. Fires net.http_post to
-- process-consent-event. EXCEPTION swallowed so a failing trigger
-- can never roll back the Worker's INSERT.
-- ═══════════════════════════════════════════════════════════
create trigger trg_consent_event_artefact_dispatch
  after insert on consent_events
  for each row execute function trigger_process_consent_event();

-- ═══════════════════════════════════════════════════════════
-- trg_consent_artefact_expiry_queue (AFTER INSERT on consent_artefacts)
-- Creates the corresponding consent_expiry_queue row for every
-- finite-expiry artefact. Artefacts with expires_at = 'infinity'
-- are skipped.
-- ═══════════════════════════════════════════════════════════
create or replace function trg_artefact_create_expiry_entry()
returns trigger language plpgsql security definer as $$
begin
  if new.expires_at < 'infinity'::timestamptz then
    insert into consent_expiry_queue (
      org_id, artefact_id, purpose_code, expires_at, notify_at
    ) values (
      new.org_id,
      new.artefact_id,
      new.purpose_code,
      new.expires_at,
      new.expires_at - interval '30 days'
    );
  end if;
  return new;
end;
$$;

create trigger trg_consent_artefact_expiry_queue
  after insert on consent_artefacts
  for each row execute function trg_artefact_create_expiry_entry();

-- ═══════════════════════════════════════════════════════════
-- trg_revocation_org_validation (BEFORE INSERT on artefact_revocations)
-- Rejects cross-tenant revocation attempts by validating the
-- artefact's org_id matches the revocation's org_id BEFORE INSERT.
-- ═══════════════════════════════════════════════════════════
create or replace function trg_revocation_org_check()
returns trigger language plpgsql as $$
declare v_artefact_org_id uuid;
begin
  select org_id into v_artefact_org_id
    from consent_artefacts where artefact_id = new.artefact_id;

  if v_artefact_org_id is null then
    raise exception 'Artefact % does not exist', new.artefact_id;
  end if;

  if v_artefact_org_id != new.org_id then
    raise exception 'Artefact % does not belong to org %', new.artefact_id, new.org_id;
  end if;

  return new;
end;
$$;

create trigger trg_revocation_org_validation
  before insert on artefact_revocations
  for each row execute function trg_revocation_org_check();

-- ═══════════════════════════════════════════════════════════
-- trg_artefact_revocation_cascade (AFTER INSERT on artefact_revocations)
-- In-database cascade: updates status, removes from validity index,
-- marks expiry queue superseded, writes audit log. Does NOT walk
-- the replaced_by chain (S-5: replaced artefacts stay frozen).
-- ═══════════════════════════════════════════════════════════
create or replace function trg_artefact_revocation_cascade()
returns trigger language plpgsql security definer as $$
begin
  update consent_artefacts
     set status = 'revoked'
   where artefact_id = new.artefact_id
     and status = 'active';

  if not found then
    raise exception 'Cannot revoke artefact %: not found or not active', new.artefact_id;
  end if;

  delete from consent_artefact_index
   where artefact_id = new.artefact_id;

  update consent_expiry_queue
     set superseded = true
   where artefact_id = new.artefact_id
     and processed_at is null;

  insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
  values (
    new.org_id,
    'consent_artefact_revoked',
    'consent_artefacts',
    (select id from consent_artefacts where artefact_id = new.artefact_id),
    jsonb_build_object(
      'artefact_id', new.artefact_id,
      'reason',      new.reason,
      'revoked_by',  new.revoked_by_type
    )
  );

  return new;
end;
$$;

create trigger trg_artefact_revocation
  after insert on artefact_revocations
  for each row execute function trg_artefact_revocation_cascade();

-- ═══════════════════════════════════════════════════════════
-- trg_artefact_revocation_dispatch (AFTER INSERT on artefact_revocations)
-- Out-of-database cascade: fires net.http_post to
-- process-artefact-revocation for the connector fan-out. Runs
-- AFTER trg_artefact_revocation so the in-DB state is already
-- consistent by the time the Edge Function queries it.
-- ═══════════════════════════════════════════════════════════
create trigger trg_artefact_revocation_dispatch
  after insert on artefact_revocations
  for each row execute function trigger_process_artefact_revocation();

-- ═══════════════════════════════════════════════════════════
-- updated_at triggers on mutable DEPA tables
-- ═══════════════════════════════════════════════════════════
create trigger trg_purpose_defs_updated_at
  before update on purpose_definitions
  for each row execute function set_updated_at();

create trigger trg_depa_metrics_updated_at
  before update on depa_compliance_metrics
  for each row execute function set_updated_at();
```

---

### 11.9 Buffer Lifecycle Function Additions

```sql
-- ═══════════════════════════════════════════════════════════
-- confirm_revocation_delivery(id) — mirrors mark_delivered_and_delete
-- for artefact_revocations. Called by the delivery pipeline after
-- the revocation record is confirmed written to customer storage.
-- ═══════════════════════════════════════════════════════════
create or replace function confirm_revocation_delivery(p_revocation_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from artefact_revocations
   where id = p_revocation_id
     and delivered_at is not null;

  if not found then
    raise exception 'Revocation % not found or not marked delivered', p_revocation_id;
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- detect_stuck_buffers() — extended to include artefact_revocations.
-- Redefinition (CREATE OR REPLACE) of the existing function from §7.
-- ═══════════════════════════════════════════════════════════
create or replace function detect_stuck_buffers()
returns table(table_name text, stuck_count bigint, oldest_stuck_at timestamptz)
language sql security definer as $$
  select 'consent_events'::text, count(*), min(created_at)
    from consent_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'tracker_observations', count(*), min(created_at)
    from tracker_observations where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'audit_log', count(*), min(created_at)
    from audit_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'processing_log', count(*), min(created_at)
    from processing_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'rights_request_events', count(*), min(created_at)
    from rights_request_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'deletion_receipts', count(*), min(created_at)
    from deletion_receipts where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'withdrawal_verifications', count(*), min(created_at)
    from withdrawal_verifications where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'security_scans', count(*), min(created_at)
    from security_scans where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'consent_probe_runs', count(*), min(created_at)
    from consent_probe_runs where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'artefact_revocations', count(*), min(created_at)
    from artefact_revocations where delivered_at is null and created_at < now() - interval '1 hour'
$$;
```

---

### 11.10 New Scheduled Jobs

```sql
-- ═══════════════════════════════════════════════════════════
-- expiry-alerts-daily — fires send_expiry_alerts() at 02:30 UTC (08:00 IST).
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('expiry-alerts-daily');
exception when others then null; end $$;

select cron.schedule(
  'expiry-alerts-daily',
  '30 2 * * *',
  $$select send_expiry_alerts()$$
);

-- ═══════════════════════════════════════════════════════════
-- expiry-enforcement-daily — fires enforce_artefact_expiry() at
-- 19:00 UTC (00:30 IST), slightly before the alert job so expired
-- artefacts are cleaned before the day's alert batch fires.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('expiry-enforcement-daily');
exception when others then null; end $$;

select cron.schedule(
  'expiry-enforcement-daily',
  '0 19 * * *',
  $$select enforce_artefact_expiry()$$
);

-- ═══════════════════════════════════════════════════════════
-- depa-score-refresh-nightly — computes compute_depa_score() for
-- every organisation and upserts into depa_compliance_metrics.
-- 19:30 UTC (01:00 IST).
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('depa-score-refresh-nightly');
exception when others then null; end $$;

select cron.schedule(
  'depa-score-refresh-nightly',
  '30 19 * * *',
  $$
    insert into depa_compliance_metrics (
      org_id, total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at
    )
    select
      id as org_id,
      (compute_depa_score(id) ->> 'total')::numeric,
      (compute_depa_score(id) ->> 'coverage_score')::numeric,
      (compute_depa_score(id) ->> 'expiry_score')::numeric,
      (compute_depa_score(id) ->> 'freshness_score')::numeric,
      (compute_depa_score(id) ->> 'revocation_score')::numeric,
      now()
    from organisations
    on conflict (org_id) do update set
      total_score      = excluded.total_score,
      coverage_score   = excluded.coverage_score,
      expiry_score     = excluded.expiry_score,
      freshness_score  = excluded.freshness_score,
      revocation_score = excluded.revocation_score,
      computed_at      = excluded.computed_at,
      updated_at       = now()
  $$
);

-- ═══════════════════════════════════════════════════════════
-- consent-events-artefact-safety-net — Q2 Option D secondary path.
-- Every 5 minutes, picks up consent_events with empty artefact_ids
-- older than 5 minutes and re-fires the process-consent-event Edge
-- Function. Idempotency in the Edge Function prevents duplicates.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('consent-events-artefact-safety-net');
exception when others then null; end $$;

select cron.schedule(
  'consent-events-artefact-safety-net',
  '*/5 * * * *',
  $$select safety_net_process_consent_events()$$
);
```

---

### 11.11 New Verification Queries

Run after §11 migrations are applied.

```sql
-- VERIFY 1: RLS enabled on all 6 new tables.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'purpose_definitions', 'purpose_connector_mappings',
     'consent_artefacts', 'artefact_revocations',
     'consent_expiry_queue', 'depa_compliance_metrics'
   )
 order by tablename;
-- EXPECTED: rowsecurity = true for all 6 rows.

-- VERIFY 2: authenticated role has NO INSERT/UPDATE/DELETE on consent_artefacts.
select grantee, table_name, privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
   and grantee = 'authenticated'
   and table_name = 'consent_artefacts'
   and privilege_type in ('UPDATE', 'DELETE', 'INSERT');
-- EXPECTED: 0 rows.

-- VERIFY 3: authenticated role has NO UPDATE/DELETE on artefact_revocations.
select grantee, table_name, privilege_type
  from information_schema.table_privileges
 where table_schema = 'public'
   and grantee = 'authenticated'
   and table_name = 'artefact_revocations'
   and privilege_type in ('UPDATE', 'DELETE');
-- EXPECTED: 0 rows.

-- VERIFY 4: Revocation cascade trigger is active.
select trigger_name, event_manipulation, action_timing
  from information_schema.triggers
 where event_object_table = 'artefact_revocations'
   and trigger_name in ('trg_artefact_revocation', 'trg_artefact_revocation_dispatch', 'trg_revocation_org_validation');
-- EXPECTED: 3 rows — BEFORE INSERT (org validation), AFTER INSERT (cascade), AFTER INSERT (dispatch).

-- VERIFY 5: Consent event dispatch trigger active.
select trigger_name, event_manipulation, action_timing
  from information_schema.triggers
 where event_object_table = 'consent_events'
   and trigger_name = 'trg_consent_event_artefact_dispatch';
-- EXPECTED: 1 row, AFTER INSERT.

-- VERIFY 6: Expiry queue trigger active on consent_artefacts.
select trigger_name, event_manipulation, action_timing
  from information_schema.triggers
 where event_object_table = 'consent_artefacts'
   and trigger_name = 'trg_consent_artefact_expiry_queue';
-- EXPECTED: 1 row, AFTER INSERT.

-- VERIFY 7: All four new pg_cron jobs scheduled.
select jobname, schedule, active
  from cron.job
 where jobname in (
   'expiry-alerts-daily',
   'expiry-enforcement-daily',
   'depa-score-refresh-nightly',
   'consent-events-artefact-safety-net'
 );
-- EXPECTED: 4 rows, all active = true.

-- VERIFY 8: generate_artefact_id() produces correctly-prefixed 33-char IDs.
select generate_artefact_id() like 'cs_art_%' as has_prefix,
       length(generate_artefact_id()) as id_length;
-- EXPECTED: has_prefix = true, id_length = 33.

-- VERIFY 9: Unique constraint on (org_id, purpose_code, framework).
select count(*) from information_schema.table_constraints
 where table_name = 'purpose_definitions'
   and constraint_type = 'UNIQUE';
-- EXPECTED: >= 1.

-- VERIFY 10: Vault secrets required by triggers/cron exist.
select name from vault.secrets where name in ('supabase_url', 'cs_orchestrator_key');
-- EXPECTED: 2 rows.

-- VERIFY 11: Revocation with invalid artefact_id is blocked (FK + trigger).
-- (Commented out — run interactively in a transaction block.)
-- do $$ begin
--   insert into artefact_revocations (org_id, artefact_id, reason, revoked_by_type)
--   values (gen_random_uuid(), 'cs_art_DOESNOTEXIST', 'test', 'system');
--   raise exception 'Should have failed';
-- exception when foreign_key_violation then
--   raise notice 'PASS: FK violation raised';
-- when others then
--   raise notice 'PASS: % raised', SQLERRM;
-- end $$;
-- EXPECTED: FK violation OR trigger exception.

-- VERIFY 12: compute_depa_score returns the expected JSONB structure.
select compute_depa_score((select id from organisations limit 1));
-- EXPECTED: jsonb with keys total, coverage_score, expiry_score, freshness_score,
--           revocation_score, computed_at.
```

---

### 11.12 Guard Summary Additions

Supplements the guard table in §10.

| Guard | What it protects | How it's enforced | Failure mode |
|---|---|---|---|
| `consent_artefacts` append-only (Rule 19) | Status transitions happen only via defined paths | No INSERT/UPDATE/DELETE RLS policy for authenticated; cs_orchestrator has INSERT and UPDATE (status, replaced_by) only | Permission denied for any authenticated write |
| `artefact_revocations` immutability | Revocations cannot be edited or undone | No UPDATE or DELETE RLS policy for any role | Permission denied |
| `trg_revocation_org_validation` (BEFORE trigger) | Cross-tenant revocation attempt | Trigger validates `consent_artefacts.org_id = NEW.org_id` before INSERT | Exception raised; INSERT rolled back |
| `trg_artefact_revocation` (AFTER trigger) | Status consistency between revocation and artefact | Trigger updates `consent_artefacts.status` inside the same transaction as the revocation INSERT | Transaction rollback if status update fails |
| `trg_consent_artefact_expiry_queue` (AFTER trigger) | Every finite-expiry artefact has an expiry queue entry | Trigger inserts into `consent_expiry_queue` on every artefact INSERT where `expires_at < infinity` | Missing queue entry surfaced by the coverage verification query |
| `trg_consent_event_artefact_dispatch` (AFTER trigger) | Consent events reach the artefact fan-out pipeline | Trigger calls `net.http_post` to the Edge Function; wrapped in EXCEPTION swallow; safety-net cron picks up orphans | Orphan detection metric (Q2 Option D) |
| Mandatory `expires_at` (Rule 20) | No open-ended consent | `NOT NULL` column + application-layer validation that banner save requires an expiry window | NULL INSERT rejected |
| `data_scope` category-only (Rule 3 broadened) | Regulated sensitive content never persisted | Structural — no column in DEPA tables admits FHIR content, PAN values, account numbers, or other regulated values. `data_scope` is documented as category labels only | Reviewer rejects any change that adds a value-holding column |
| `generate_artefact_id()` prefix | Artefact IDs distinguishable from UUIDs in logs and APIs | Function always prepends `cs_art_` | Cannot fail silently — ID is always prefixed |
| Unique `(org_id, purpose_code, framework)` on `purpose_definitions` | Duplicate purpose codes per org per framework | Unique constraint | Unique violation on INSERT |
| `depa_compliance_metrics` staleness detection | Dashboard never shows a silently-stale score | `computed_at` surfaced in API; UI warns if > 25h old | User sees warning, not a wrong score |
| `consent_artefact_index.framework` | Multi-framework validity cache without joins | Denormalised `framework` on index entry | Wrong framework = wrong cache; caught by integration test |
| `process-consent-event` idempotency (S-7) | Duplicate artefacts from trigger + cron race | Edge Function does `SELECT count(*)` keyed on `consent_event_id` before INSERT | Would produce duplicates if contract is violated — enforced by code review |
| Banner purpose validation (Point 1 flip) | No legacy banner can generate orphan consent events | API-layer 422 on any `purposes` object missing `purpose_definition_id` | Banner cannot be saved or published with an unmapped purpose |

---

### 11.13 Migration Note

The dev Supabase instance carries existing pre-DEPA schema objects (tables, columns, indexes, policies, triggers, functions). Customer consent data across all environments is zero, so no data-migration is needed — this section is about **schema-object evolution**, not about migrating data.

**ALTER in place vs DROP + RECREATE.** Two strategies are available per amendment; the table below records the choice and the rationale for each DEPA amendment to an existing object.

| Existing object | §11.x | Strategy | Rationale |
|---|---|---|---|
| `consent_events` | 11.3 | ALTER TABLE (add `artefact_ids`) | Additive column; no semantics change; preserves seed rows used by the RLS suite. |
| `deletion_receipts` | 11.3 | ALTER TABLE (add `artefact_id`) | Additive column; FK to `consent_artefacts` (set null on delete). Request+receipt hybrid per ADR-0022. |
| `consent_artefact_index` | 11.3 | ALTER TABLE (add `framework`, `purpose_code`) | Existing rows receive `framework = 'abdm'` by default (preserves pre-DEPA semantics). |
| `consent_banners.purposes` | 11.3 | No DDL — JSONB schema documentation only | Enforcement is at the API layer (422 on missing `purpose_definition_id`). |
| `detect_stuck_buffers()` | 11.9 | `CREATE OR REPLACE FUNCTION` (adds `artefact_revocations` to the UNION) | Function body changes; signature unchanged; no callers break. |

DROP + RECREATE is available as a fallback if any future DEPA amendment requires a change that ALTER cannot express cleanly (e.g., altering a column type with a non-trivial cast, or reseating a primary key). None of the §11 amendments require it today. Development seed data is regeneratable via `supabase/seed.sql`, so losing it is not a blocker.

**Apply procedure.** `supabase db push` applies §11 end-to-end. Before the first §11.10 cron fires, confirm Vault secrets `supabase_url` and `cs_orchestrator_key` exist (operator prerequisite). After apply, run §11.11 verification queries. Regenerate dev seed data if any prior seed rows depended on the pre-DEPA purpose-object shape.

**No back-fill of historical `consent_events` into `consent_artefacts` is permitted.** Back-filled artefacts would carry inaccurate `data_scope` snapshots from purposes that predate the `purpose_definitions` registry. The pre-DEPA `consent_events` rows that exist in dev are test fixtures; they stay in `consent_events` as their own (now-amendment-compliant with the new `artefact_ids = '{}'` default) rows and are not promoted to artefacts.

---

*Document prepared April 2026. This is the complete schema design. Run top to bottom on a fresh Supabase Postgres instance. Every guard must be verified before any customer data enters the system. Security hardening changes integrated April 2026. DEPA alignment (§11) added 2026-04-16.*

---

## 12. Post-DEPA Amendments (ADRs 0033–0049, April 2026)

Schema changes that landed between the admin platform roadmap (ADRs 0027–0036) and the security-observability bundle (ADR-0049). This section is the catalogue; each ADR's migration file remains the authoritative source.

### 12.1 Overview

| ADR | Scope |
|---|---|
| ADR-0033 / 0048 | Admin Ops + Security panel data sources + Worker 403 logging |
| ADR-0034 | Billing Operations (refunds, plan_adjustments, effective-plan helper) |
| ADR-0044 | Accounts layer (Terminal B — already documented in §11.x and scattered) |
| ADR-0045 | Admin user lifecycle (extends `admin.admin_users` with `invited` status + four RPCs) |
| ADR-0046 Phase 1 | Significant Data Fiduciary (SDF) status marker on `organisations` |
| ADR-0048 | `public.blocked_ips` + Worker blocked-IP enforcement + admin Accounts panel |
| ADR-0049 | `public.rate_limit_events` + `public.sentry_events` + webhook ingestion |

### 12.2 New operational tables

All operational (non-buffer). No `delivered_at`. Each has a 7-day retention cron unless noted.

| Table | ADR | Purpose | Read path | Write path |
|---|---|---|---|---|
| `public.refunds` | 0034 | Refund ledger (intent + outcome) — `account_id` scoped | `admin.billing_refunds_list` | `admin.billing_create_refund` + `billing_mark_refund_issued` / `_failed` |
| `public.plan_adjustments` | 0034 | Comp + override grants (`kind` discriminator) — `account_id` scoped | `admin.billing_plan_adjustments_list`, `public.account_effective_plan` | `admin.billing_upsert_plan_adjustment` / `billing_revoke_plan_adjustment` |
| `public.blocked_ips` | 0033 Sprint 2.1 | Operator-managed global block list (CIDRs) | `admin.security_blocked_ips_list` + Worker via `admin_config` KV snapshot | `admin.security_block_ip` / `security_unblock_ip` |
| `public.rate_limit_events` | 0049 Phase 1 | Persisted rate-limit denials (Upstash bucket is stateless) | `admin.security_rate_limit_triggers` (grouped by endpoint/IP) | `app/src/lib/rights/rate-limit-log.ts` fire-and-forget anon-key INSERT |
| `public.sentry_events` | 0049 Phase 2 | Webhook-ingested Sentry escalations (severity ≥ warning) | `admin.security_sentry_events_list` | `app/src/app/api/webhooks/sentry/route.ts` HMAC-verified anon-key upsert on `sentry_id` |
| `public.worker_errors` (existing) | 0016 + 0048 | Worker → Supabase write failures AND 403 rejection categories (ADR-0048 prefix discipline: `hmac_*` / `origin_*`) | `admin.pipeline_worker_errors_list`, `admin.security_worker_reasons_list` | `cs_worker` role + `ctx.waitUntil` fire-and-forget from Worker |

RLS baseline for all five new tables: enabled, customer-facing SELECT policy absent, INSERT granted narrowly (anon/authenticated for the public-endpoint logger; `cs_worker` for the Worker path; `cs_admin` for admin writes via SECURITY DEFINER RPCs). Admin reads route through SECURITY DEFINER functions owned by the admin schema.

### 12.3 Amendments to existing tables

- `organisations.sdf_status text not null default 'not_designated'` (CHECK: `not_designated` / `self_declared` / `notified` / `exempt`) — ADR-0046 Phase 1.
- `organisations.sdf_notified_at timestamptz` — ADR-0046 Phase 1.
- `organisations.sdf_notification_ref text` — ADR-0046 Phase 1 (Gazette reference or Ministry letter ID as a category — Rule 3: no PDF bytes).
- Partial index `organisations_sdf_designated_idx ON organisations(sdf_status) WHERE sdf_status <> 'not_designated'`.
- `admin.admin_users.status` CHECK widened to include `invited` — ADR-0045 Sprint 1.1.
- `organisations.status` CHECK widened to include `suspended_by_plan` — ADR-0044 Phase 0 (cross-reference).
- `public.admin_config_snapshot()` JSON extended with `blocked_ips` array (ADR-0033 Sprint 2.3 via 20260427000002).

### 12.4 New helper / effective-plan RPCs

- `public.account_effective_plan(p_account_id uuid) returns text` — override > comp > `accounts.plan_code`. Replaces the short-lived `org_effective_plan` from the original ADR-0034 Sprint 1.1 (dropped during the ADR-0044 Phase 0 amendment).
- `public.current_plan()` — Terminal B's reader for the caller's own account (ADR-0044 Phase 0). Called from customer dashboards; cross-reference from ADR-0044.

### 12.5 Admin RPC catalogue (post-0034 additions)

All SECURITY DEFINER, all gated by `admin.require_admin(<tier>)`, all audit-logged into `admin.admin_audit_log` with `old_value` + `new_value` diffs for writes.

| RPC | Tier | ADR |
|---|---|---|
| `admin.billing_payment_failures_list(int)` | support | 0034 |
| `admin.billing_refunds_list(int)` | support | 0034 |
| `admin.billing_create_refund(uuid, text, bigint, text)` | support | 0034 |
| `admin.billing_mark_refund_issued(uuid, text)` | support | 0034 2.2 |
| `admin.billing_mark_refund_failed(uuid, text)` | support | 0034 2.2 |
| `admin.billing_plan_adjustments_list(text)` | support | 0034 |
| `admin.billing_upsert_plan_adjustment(uuid, text, text, timestamptz, text)` | platform_operator | 0034 |
| `admin.billing_revoke_plan_adjustment(uuid, text)` | platform_operator | 0034 |
| `admin.accounts_list(text, text, text)` | support | 0048 |
| `admin.account_detail(uuid) returns jsonb` | support | 0048 |
| `admin.suspend_account(uuid, text) returns jsonb` | platform_operator | 0048 |
| `admin.restore_account(uuid, text) returns jsonb` | platform_operator | 0048 |
| `admin.pipeline_worker_errors_list(int)` | support | 0033 Sprint 1.1 |
| `admin.pipeline_stuck_buffers_snapshot()` | support | 0033 Sprint 1.1 |
| `admin.pipeline_depa_expiry_queue()` | support | 0033 Sprint 1.1 |
| `admin.pipeline_delivery_health(int)` | support | 0033 Sprint 1.1 |
| `admin.security_rate_limit_triggers(int)` | support | 0033 (stub) → 0049 (real) |
| `admin.security_worker_reasons_list(text, int, int)` | support | 0033 Sprint 2.1 |
| `admin.security_blocked_ips_list()` | support | 0033 Sprint 2.1 |
| `admin.security_block_ip(cidr, text, timestamptz)` | platform_operator | 0033 Sprint 2.1 |
| `admin.security_unblock_ip(uuid, text)` | platform_operator | 0033 Sprint 2.1 |
| `admin.security_sentry_events_list(int)` | support | 0049 Phase 2 |
| `admin.set_sdf_status(uuid, text, text, timestamptz, text)` | platform_operator | 0046 Phase 1 |
| `admin.admin_invite_create(uuid, text, text, text)` | platform_operator | 0045 |
| `admin.admin_change_role(uuid, text, text)` | platform_operator | 0045 (refuses self-change, last-active-PO demotion) |
| `admin.admin_disable(uuid, text)` | platform_operator | 0045 (refuses self-disable, last-active-PO disable) |
| `admin.admin_list()` | support | 0045 |

### 12.6 Worker 403 logging categories (ADR-0048 Sprint 2.1)

Prefix discipline so `admin.security_worker_reasons_list` can filter via `ILIKE 'hmac_%'` / `ILIKE 'origin_%'`:

- `hmac_timestamp_drift: <ts>` — request timestamp outside ±5 min.
- `hmac_signature_mismatch` — signature verification failed (even after previous-secret retry during rotation grace).
- `origin_missing: ...` — unsigned request with no Origin/Referer.
- `origin_mismatch: <origin>` — Origin present but not in `web_properties.allowed_origins`.

Every 403 site in `worker/src/events.ts` + `worker/src/observations.ts` fires `ctx.waitUntil(logWorkerError(...))` with one of these prefixes. Errors swallowed inside `logWorkerError` — logging failures never DoS customers.

### 12.7 Identity-isolation guards (CLAUDE.md Rule 12)

Enforced at RPC level:

- `public.accept_invitation(p_token text)` — raises 42501 if caller JWT carries `app_metadata.is_admin=true`. Migration `20260504000002`.
- `admin.admin_invite_create(p_user_id, p_display_name, p_admin_role, p_reason)` — raises 42501 if target user has any `public.account_memberships` or `public.org_memberships` rows. Migration `20260504000003`.

Combined with proxy-level enforcement (admin proxy rejects non-`is_admin`; customer proxy rejects `is_admin=true`), these guards prevent any single `auth.users` row from holding both customer and admin identities.
