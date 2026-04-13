-- Migration 012: Triggers
-- Auto-update updated_at on all mutable operational tables.
-- Auto-set legal deadlines on insert.

-- updated_at triggers
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

-- Legal deadline triggers
create trigger trg_sla_deadline before insert on rights_requests for each row execute function set_rights_request_sla();
create trigger trg_breach_deadline before insert on breach_notifications for each row execute function set_breach_deadline();
