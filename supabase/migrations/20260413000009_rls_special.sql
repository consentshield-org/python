-- Migration 009: RLS Policies — Special Cases

-- rights_requests: public insert (Data Principal submits from hosted form)
create policy "org_read_rights_requests" on rights_requests for select using (org_id = current_org_id());
create policy "org_update_rights_requests" on rights_requests for update using (org_id = current_org_id());
create policy "public_insert_rights_requests" on rights_requests for insert with check (true);

-- Reference data: any authenticated user can read
create policy "auth_read_tracker_sigs" on tracker_signatures for select using (auth.role() = 'authenticated');
create policy "auth_read_sector_templates" on sector_templates for select using (auth.role() = 'authenticated');
create policy "auth_read_dpo_partners" on dpo_partners for select using (auth.role() = 'authenticated');
