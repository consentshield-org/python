-- Migration 005: Phase 3+ Tables (operational state)
-- Consent probes, API keys, GDPR config, sector templates,
-- DPO marketplace, cross-border transfers, white-label config

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

create table api_keys (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  key_hash        text not null unique,
  key_prefix      text not null,
  name            text not null,
  scopes          text[] not null default '{}',
  last_used_at    timestamptz,
  expires_at      timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz default now()
);

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
  scc_status            text,
  status                text not null default 'active',
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

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

-- Add FK from consent_probe_runs to consent_probes now that consent_probes exists
alter table consent_probe_runs
  add constraint fk_probe_runs_probe
  foreign key (probe_id) references consent_probes(id) on delete cascade;
