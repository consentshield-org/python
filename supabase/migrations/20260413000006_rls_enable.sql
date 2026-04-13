-- Migration 006: Enable RLS on ALL tables
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
-- Reference data — RLS enabled but allows select for all authenticated
alter table tracker_signatures       enable row level security;
alter table sector_templates         enable row level security;
alter table dpo_partners             enable row level security;
