-- Migration 008: RLS Policies — Buffer Tables (read-only for authenticated users)
-- All writes come through scoped service roles which bypass RLS.
-- NO insert, update, or delete policies on any buffer table.

create policy "org_read_consent_events" on consent_events for select using (org_id = current_org_id());
create policy "org_read_tracker_obs" on tracker_observations for select using (org_id = current_org_id());
create policy "org_read_audit_log" on audit_log for select using (org_id = current_org_id());
create policy "org_read_processing_log" on processing_log for select using (org_id = current_org_id());
create policy "org_read_rr_events" on rights_request_events for select using (org_id = current_org_id());
create policy "org_read_deletion_receipts" on deletion_receipts for select using (org_id = current_org_id());
create policy "org_read_withdrawal_ver" on withdrawal_verifications for select using (org_id = current_org_id());
create policy "org_read_security_scans" on security_scans for select using (org_id = current_org_id());
create policy "org_read_probe_runs" on consent_probe_runs for select using (org_id = current_org_id());
create policy "org_read_delivery_buffer" on delivery_buffer for select using (org_id = current_org_id());
