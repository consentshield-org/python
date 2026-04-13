-- Migration 003: Operational State Tables (Category A — permanent)
-- These tables hold ConsentShield's business data. They persist for the life of the service relationship.

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
  encryption_salt           text not null default encode(extensions.gen_random_bytes(16), 'hex'),
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
  allowed_origins       text[] not null default '{}',
  event_signing_secret  text not null default encode(extensions.gen_random_bytes(32), 'hex'),
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
  data_locations    text[] not null default '{}',
  source_type       text not null default 'manual',
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
  dpb_notification_deadline   timestamptz not null,
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
  request_type            text not null,
  requestor_name          text not null,
  requestor_email         text not null,
  requestor_message       text,
  turnstile_verified      boolean not null default false,
  email_verified          boolean not null default false,
  email_verified_at       timestamptz,
  identity_verified       boolean not null default false,
  identity_verified_at    timestamptz,
  identity_verified_by    uuid references auth.users(id),
  identity_method         text,
  status                  text not null default 'new',
  assignee_id             uuid references auth.users(id),
  sla_deadline            timestamptz not null default (now() + interval '30 days'),
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
  storage_provider      text not null default 'r2',
  bucket_name           text not null,
  path_prefix           text not null default '',
  region                text,
  write_credential_enc  bytea not null,
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
  category        text not null,
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
  config          bytea not null,
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
  channel_type    text not null,
  config          jsonb not null,
  alert_types     text[] not null default '{}',
  is_active       boolean not null default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- CONSENT ARTEFACT INDEX — active consent validation cache
-- No personal data. TTL-based. Operational state only.
-- ═══════════════════════════════════════════════════════════
create table consent_artefact_index (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organisations(id) on delete cascade,
  artefact_id         text not null,
  validity_state      text not null default 'active',
  expires_at          timestamptz not null,
  created_at          timestamptz default now(),
  unique (org_id, artefact_id)
);
