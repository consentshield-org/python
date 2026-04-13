-- Migration 007: RLS Policies — Operational Tables (org-scoped CRUD)

-- organisations
create policy "members can view own org" on organisations for select using (id = current_org_id());
create policy "admins can update own org" on organisations for update using (id = current_org_id() and is_org_admin());

-- organisation_members
create policy "members can view org members" on organisation_members for select using (org_id = current_org_id());
create policy "admins can manage members" on organisation_members for all using (org_id = current_org_id() and is_org_admin());

-- web_properties
create policy "org_select" on web_properties for select using (org_id = current_org_id());
create policy "org_insert" on web_properties for insert with check (org_id = current_org_id());
create policy "org_update" on web_properties for update using (org_id = current_org_id());
create policy "org_delete" on web_properties for delete using (org_id = current_org_id() and is_org_admin());

-- consent_banners
create policy "org_select" on consent_banners for select using (org_id = current_org_id());
create policy "org_insert" on consent_banners for insert with check (org_id = current_org_id());
create policy "org_update" on consent_banners for update using (org_id = current_org_id());

-- data_inventory
create policy "org_select" on data_inventory for select using (org_id = current_org_id());
create policy "org_insert" on data_inventory for insert with check (org_id = current_org_id());
create policy "org_update" on data_inventory for update using (org_id = current_org_id());
create policy "org_delete" on data_inventory for delete using (org_id = current_org_id() and is_org_admin());

-- breach_notifications
create policy "org_select" on breach_notifications for select using (org_id = current_org_id());
create policy "org_insert" on breach_notifications for insert with check (org_id = current_org_id());
create policy "org_update" on breach_notifications for update using (org_id = current_org_id());

-- export_configurations
create policy "org_select" on export_configurations for select using (org_id = current_org_id());
create policy "org_insert" on export_configurations for insert with check (org_id = current_org_id());
create policy "org_update" on export_configurations for update using (org_id = current_org_id());

-- tracker_overrides
create policy "org_select" on tracker_overrides for select using (org_id = current_org_id());
create policy "org_insert" on tracker_overrides for insert with check (org_id = current_org_id());
create policy "org_update" on tracker_overrides for update using (org_id = current_org_id());
create policy "org_delete" on tracker_overrides for delete using (org_id = current_org_id());

-- integration_connectors
create policy "org_select" on integration_connectors for select using (org_id = current_org_id());
create policy "org_insert" on integration_connectors for insert with check (org_id = current_org_id());
create policy "org_update" on integration_connectors for update using (org_id = current_org_id());
create policy "org_delete" on integration_connectors for delete using (org_id = current_org_id() and is_org_admin());

-- retention_rules
create policy "org_select" on retention_rules for select using (org_id = current_org_id());
create policy "org_insert" on retention_rules for insert with check (org_id = current_org_id());
create policy "org_update" on retention_rules for update using (org_id = current_org_id());

-- notification_channels
create policy "org_select" on notification_channels for select using (org_id = current_org_id());
create policy "org_insert" on notification_channels for insert with check (org_id = current_org_id());
create policy "org_update" on notification_channels for update using (org_id = current_org_id());
create policy "org_delete" on notification_channels for delete using (org_id = current_org_id());

-- consent_artefact_index
create policy "org_select" on consent_artefact_index for select using (org_id = current_org_id());
create policy "org_insert" on consent_artefact_index for insert with check (org_id = current_org_id());
create policy "org_update" on consent_artefact_index for update using (org_id = current_org_id());

-- consent_probes
create policy "org_select" on consent_probes for select using (org_id = current_org_id());
create policy "org_insert" on consent_probes for insert with check (org_id = current_org_id());
create policy "org_update" on consent_probes for update using (org_id = current_org_id());
create policy "org_delete" on consent_probes for delete using (org_id = current_org_id());

-- api_keys
create policy "org_select" on api_keys for select using (org_id = current_org_id());
create policy "org_insert" on api_keys for insert with check (org_id = current_org_id());
create policy "org_update" on api_keys for update using (org_id = current_org_id());
create policy "org_delete" on api_keys for delete using (org_id = current_org_id() and is_org_admin());

-- gdpr_configurations
create policy "org_select" on gdpr_configurations for select using (org_id = current_org_id());
create policy "org_insert" on gdpr_configurations for insert with check (org_id = current_org_id());
create policy "org_update" on gdpr_configurations for update using (org_id = current_org_id());

-- dpo_engagements
create policy "org_select" on dpo_engagements for select using (org_id = current_org_id());
create policy "org_insert" on dpo_engagements for insert with check (org_id = current_org_id());
create policy "org_update" on dpo_engagements for update using (org_id = current_org_id());

-- cross_border_transfers
create policy "org_select" on cross_border_transfers for select using (org_id = current_org_id());
create policy "org_insert" on cross_border_transfers for insert with check (org_id = current_org_id());
create policy "org_update" on cross_border_transfers for update using (org_id = current_org_id());
create policy "org_delete" on cross_border_transfers for delete using (org_id = current_org_id() and is_org_admin());

-- white_label_configs
create policy "org_select" on white_label_configs for select using (org_id = current_org_id());
create policy "org_insert" on white_label_configs for insert with check (org_id = current_org_id());
create policy "org_update" on white_label_configs for update using (org_id = current_org_id());
