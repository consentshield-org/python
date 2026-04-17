-- ADR-0027 Sprint 2.1 — admin.kill_switches + 4 seed switches.
--
-- Named toggles for emergency-stopping subsystems. Semantics: enabled=true
-- means the kill is ENGAGED (subsystem disabled). Writes are restricted
-- to platform_operator role; reads available to all admins. Worker and
-- Edge Functions consume via Cloudflare KV sync (Sprint 3.2).
--
-- Per docs/admin/architecture/consentshield-admin-schema.md §3.10.

create table admin.kill_switches (
  switch_key    text        primary key,
  display_name  text        not null,
  description   text        not null,
  enabled       boolean     not null default false,
  reason        text,
  set_by        uuid        references admin.admin_users(id),
  set_at        timestamptz not null default now()
);

alter table admin.kill_switches enable row level security;

-- Read: any admin.
create policy kill_switches_read on admin.kill_switches
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Write: platform_operator only.
create policy kill_switches_write on admin.kill_switches
  for all to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
    and (auth.jwt() -> 'app_metadata' ->> 'admin_role') = 'platform_operator'
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
    and (auth.jwt() -> 'app_metadata' ->> 'admin_role') = 'platform_operator'
  );

grant select on admin.kill_switches to authenticated;

-- Seed: 4 default switches, all disengaged. set_by is null here because no
-- admin user exists yet (bootstrap is Sprint 4.1); admin.toggle_kill_switch
-- RPC (Sprint 3.1) will set set_by = auth.uid() on any subsequent update.
insert into admin.kill_switches (switch_key, display_name, description, enabled) values
  ('banner_delivery',
   'Banner delivery',
   'When engaged, the Cloudflare Worker serves a no-op banner in place of the real banner.',
   false),
  ('depa_processing',
   'DEPA consent-artefact processing',
   'When engaged, process-consent-event Edge Function halts — inbound events queue in consent_events until released.',
   false),
  ('deletion_dispatch',
   'Deletion dispatch',
   'When engaged, deletion orchestration halts — new rights_request rows still accept but connectors are not called.',
   false),
  ('rights_request_intake',
   'Rights request intake',
   'When engaged, public /api/public/rights-request returns 503 — existing rights flows unaffected.',
   false);

-- Verification:
--   select count(*) from pg_policies where schemaname='admin' and tablename='kill_switches'; → 2
--   select count(*) from admin.kill_switches; → 4
--   select count(*) from admin.kill_switches where enabled = true; → 0
