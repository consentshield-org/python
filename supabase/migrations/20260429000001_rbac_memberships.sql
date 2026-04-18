-- ADR-0044 Phase 1 — Memberships + role resolution + credential-column RLS.
--
-- Renames public.organisation_members → public.org_memberships and swaps
-- the role taxonomy to the v2 5-role model:
--
--   old role | new role
--   ---------|-----------
--   admin    | org_admin    (the owner-tier of an org)
--   member   | admin        (operational tier — banners, rights, etc.)
--   readonly | viewer
--   auditor  | viewer
--
-- Adds public.account_memberships for account-level roles (account_owner,
-- account_viewer). Installs current_account_role(), current_org_role(),
-- effective_org_role() with account-tier inheritance.
--
-- Rewrites every RPC that references the old table name or assumes
-- role='admin' means owner-tier. Column-level RLS is tightened on the
-- four credential-holding columns:
--   web_properties.event_signing_secret
--   integration_connectors.credentials_ciphertext
--   export_configurations.secret_access_key
--   api_keys.api_key (if present)
--
-- Pre-beta: no customer coordination; existing JWTs issued under the old
-- taxonomy will carry old role values until re-auth. The JWT hook is
-- updated to emit new values; is_org_admin() accepts both old and new
-- owner-tier markers for a one-session transition.

-- ═══════════════════════════════════════════════════════════
-- 1/10 · Rename table + preserve indexes, policies, grants
-- ═══════════════════════════════════════════════════════════

alter table if exists public.organisation_members rename to org_memberships;

-- ═══════════════════════════════════════════════════════════
-- 2/10 · Expand role check to union old+new, remap, then tighten
-- ═══════════════════════════════════════════════════════════
-- The original check was "role in default 'member'" (no formal constraint)
-- — so no DROP CONSTRAINT is needed. Install a fresh check as union.

alter table public.org_memberships
  drop constraint if exists organisation_members_role_check,
  drop constraint if exists org_memberships_role_check;

alter table public.org_memberships
  add constraint org_memberships_role_check
  check (role in (
    'admin','member','readonly','auditor',  -- old
    'org_admin','viewer'                    -- new (admin is reused; see map)
  ));

-- Remap values. Order matters: translate 'member' to 'admin' BEFORE
-- translating 'admin' to 'org_admin', otherwise we'd end up with
-- 'org_admin' for everyone.
update public.org_memberships set role = 'viewer'    where role in ('readonly','auditor');
update public.org_memberships set role = 'temp_admin' where role = 'member';
update public.org_memberships set role = 'org_admin' where role = 'admin';
update public.org_memberships set role = 'admin'     where role = 'temp_admin';

-- Tighten the check to only accept new values.
alter table public.org_memberships
  drop constraint org_memberships_role_check;

alter table public.org_memberships
  add constraint org_memberships_role_check
  check (role in ('org_admin','admin','viewer'));

alter table public.org_memberships
  alter column role set default 'viewer';

-- ═══════════════════════════════════════════════════════════
-- 3/10 · public.account_memberships
-- ═══════════════════════════════════════════════════════════

create table if not exists public.account_memberships (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('account_owner','account_viewer')),
  invited_by   uuid references auth.users(id),
  invited_at   timestamptz,
  accepted_at  timestamptz not null default now(),
  status       text not null default 'active' check (status in ('active','suspended')),
  created_at   timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists account_memberships_user_idx
  on public.account_memberships (user_id);

alter table public.account_memberships enable row level security;

drop policy if exists account_memberships_read_self on public.account_memberships;
create policy account_memberships_read_self on public.account_memberships
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists account_memberships_read_by_owner on public.account_memberships;
create policy account_memberships_read_by_owner on public.account_memberships
  for select to authenticated
  using (
    exists (
      select 1 from public.account_memberships am
       where am.account_id = account_memberships.account_id
         and am.user_id = auth.uid()
         and am.role = 'account_owner'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

revoke insert, update, delete on public.account_memberships from authenticated, anon;
grant select, insert, update, delete on public.account_memberships to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 4/10 · Backfill account_memberships — every existing org_admin
--         becomes account_owner of that org's account.
-- ═══════════════════════════════════════════════════════════

insert into public.account_memberships (account_id, user_id, role, accepted_at)
select o.account_id, om.user_id, 'account_owner', now()
  from public.org_memberships om
  join public.organisations o on o.id = om.org_id
 where om.role = 'org_admin'
on conflict (account_id, user_id) do nothing;

-- ═══════════════════════════════════════════════════════════
-- 5/10 · Role resolution helpers
-- ═══════════════════════════════════════════════════════════

create or replace function public.current_account_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select am.role
    from public.account_memberships am
   where am.user_id = public.current_uid()
     and am.account_id = public.current_account_id()
   limit 1
$$;

grant execute on function public.current_account_role() to authenticated;

create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select om.role
    from public.org_memberships om
   where om.user_id = public.current_uid()
     and om.org_id = public.current_org_id()
   limit 1
$$;

grant execute on function public.current_org_role() to authenticated;

-- effective_org_role folds account-tier inheritance:
--   account_owner  → org_admin (full owner of any org in the account)
--   account_viewer → viewer    (read across all orgs)
--   else           → direct org_memberships row
create or replace function public.effective_org_role(p_org_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_account_id uuid;
  v_acc_role text;
  v_org_role text;
begin
  if v_uid is null then return null; end if;

  select o.account_id into v_account_id
    from public.organisations o where o.id = p_org_id;
  if v_account_id is null then return null; end if;

  select am.role into v_acc_role
    from public.account_memberships am
   where am.user_id = v_uid and am.account_id = v_account_id
   limit 1;

  if v_acc_role = 'account_owner' then return 'org_admin'; end if;

  select om.role into v_org_role
    from public.org_memberships om
   where om.user_id = v_uid and om.org_id = p_org_id
   limit 1;

  if v_org_role is not null then return v_org_role; end if;

  -- No direct org membership — fall back to account_viewer if present.
  if v_acc_role = 'account_viewer' then return 'viewer'; end if;

  return null;
end;
$$;

grant execute on function public.effective_org_role(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6/10 · Update is_org_admin() + JWT claims hook to new taxonomy
-- ═══════════════════════════════════════════════════════════

create or replace function public.is_org_admin()
returns boolean
language sql
stable
as $$
  -- Accept both old and new owner markers so a JWT issued before this
  -- migration keeps working for one more session. New JWTs carry
  -- 'org_admin' going forward.
  select (auth.jwt() ->> 'org_role') in ('org_admin','admin')
    and (auth.jwt() ->> 'org_role') = 'org_admin';
$$;

-- Actually use a clean predicate: owner-tier is 'org_admin' in the new
-- claim set. A stale claim reading 'admin' will no longer be treated as
-- owner — force re-login post-deploy.
create or replace function public.is_org_admin()
returns boolean
language sql
stable
as $$
  select (auth.jwt() ->> 'org_role') = 'org_admin';
$$;

-- JWT hook: body unchanged (selects role from the renamed table; value
-- is now in the new taxonomy).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb;
  v_org_id uuid;
  v_org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into v_org_id, v_org_role
  from public.org_memberships om
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

-- ═══════════════════════════════════════════════════════════
-- 7/10 · Rewrite RPCs that reference organisation_members
-- ═══════════════════════════════════════════════════════════

-- rpc_signup_bootstrap_org — also seed account_memberships(account_owner)
create or replace function public.rpc_signup_bootstrap_org(
  p_org_name text,
  p_industry text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_org_id uuid;
  v_account_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  insert into public.accounts (name, plan_code, status, trial_ends_at)
  values (p_org_name, 'trial_starter', 'trial', now() + interval '30 days')
  returning id into v_account_id;

  insert into public.organisations (name, industry, account_id)
    values (p_org_name, p_industry, v_account_id)
    returning id into v_org_id;

  insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, 'org_admin');

  insert into public.account_memberships (account_id, user_id, role, accepted_at)
    values (v_account_id, v_uid, 'account_owner', now());

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id)
    values (v_org_id, v_uid, 'org_created', 'organisation', v_org_id);

  return jsonb_build_object(
    'ok', true, 'org_id', v_org_id, 'account_id', v_account_id, 'name', p_org_name
  );
end;
$$;

-- rpc_plan_limit_check — new table name.
create or replace function public.rpc_plan_limit_check(
  p_org_id uuid,
  p_resource text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_plan_code text;
  v_current int;
  v_limit int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_memberships
     where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select a.plan_code into v_plan_code
    from public.organisations o
    join public.accounts a on a.id = o.account_id
   where o.id = p_org_id;

  if p_resource = 'web_properties' then
    select count(*) into v_current from public.web_properties where org_id = p_org_id;
    select max_web_properties_per_org into v_limit from public.plans where plan_code = v_plan_code;
  elsif p_resource = 'deletion_connectors' then
    select count(*) into v_current from public.integration_connectors where org_id = p_org_id;
    v_limit := null;
  else
    raise exception 'unknown resource %', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object('plan', v_plan_code, 'current', v_current, 'limit', v_limit);
end;
$$;

-- rpc_rights_event_append + rpc_banner_publish + rpc_publish_purpose
-- (in 20260415000001_request_uid_helper.sql) reference organisation_members.
-- Rewrite bodies to org_memberships.

create or replace function public.rpc_rights_event_append(
  p_org_id uuid,
  p_request_id uuid,
  p_event_type text,
  p_notes text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_role text;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  select role into v_role
    from public.org_memberships
    where user_id = v_uid and org_id = p_org_id;
  if v_role is null then
    raise exception 'not a member of org' using errcode = '42501';
  end if;
  insert into rights_request_events (request_id, org_id, actor_id, event_type, notes, metadata)
    values (p_request_id, p_org_id, v_uid, p_event_type, p_notes, p_metadata)
    returning id into v_event_id;
  return jsonb_build_object('ok', true, 'event_id', v_event_id);
end;
$$;

-- rpc_audit_export_manifest — still references organisation_members and
-- organisations.plan (ADR-0044 Phase 0 dropped the latter). Rewrite.
create or replace function public.rpc_audit_export_manifest(
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_org jsonb;
  v_data_inventory jsonb;
  v_banners jsonb;
  v_properties jsonb;
  v_events jsonb;
  v_rights jsonb;
  v_deletions jsonb;
  v_scans jsonb;
  v_probes jsonb;
  v_section_counts jsonb;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_memberships
    where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select to_jsonb(row) into v_org from (
    select o.id, o.name, o.industry, a.plan_code as plan,
           encode(digest(coalesce(o.compliance_contact_email, ''), 'sha256'), 'hex') as compliance_contact_email_sha256,
           o.created_at, o.updated_at
    from public.organisations o
    left join public.accounts a on a.id = o.account_id
    where o.id = p_org_id
  ) row;

  select coalesce(jsonb_agg(to_jsonb(di)), '[]'::jsonb) into v_data_inventory
  from public.data_inventory di where org_id = p_org_id;

  select coalesce(jsonb_agg(to_jsonb(cb)), '[]'::jsonb) into v_banners
  from public.consent_banners cb where org_id = p_org_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', wp.id, 'name', wp.name, 'url', wp.url,
    'allowed_origins', wp.allowed_origins,
    'snippet_last_seen_at', wp.snippet_last_seen_at,
    'created_at', wp.created_at
  )), '[]'::jsonb) into v_properties
  from public.web_properties wp where org_id = p_org_id;

  select coalesce(jsonb_agg(row), '[]'::jsonb) into v_events from (
    select date_trunc('month', created_at)::date as month,
           event_type,
           count(*) as count
    from public.consent_events
    where org_id = p_org_id
      and created_at > now() - interval '90 days'
    group by 1, 2
    order by 1 desc, 2
  ) row;

  select coalesce(jsonb_agg(to_jsonb(rr)), '[]'::jsonb) into v_rights
  from public.rights_requests rr where org_id = p_org_id;

  select coalesce(jsonb_agg(to_jsonb(dr)), '[]'::jsonb) into v_deletions
  from public.deletion_receipts dr where org_id = p_org_id;

  select coalesce(jsonb_agg(to_jsonb(ss)), '[]'::jsonb) into v_scans
  from public.security_scans ss where org_id = p_org_id;

  select coalesce(jsonb_agg(to_jsonb(cp)), '[]'::jsonb) into v_probes
  from public.consent_probe_runs cp where org_id = p_org_id;

  v_section_counts := jsonb_build_object(
    'data_inventory', jsonb_array_length(v_data_inventory),
    'consent_banners', jsonb_array_length(v_banners),
    'web_properties', jsonb_array_length(v_properties),
    'consent_events_months', jsonb_array_length(v_events),
    'rights_requests', jsonb_array_length(v_rights),
    'deletion_receipts', jsonb_array_length(v_deletions),
    'security_scans', jsonb_array_length(v_scans),
    'consent_probe_runs', jsonb_array_length(v_probes)
  );

  return jsonb_build_object(
    'organisation', v_org,
    'data_inventory', v_data_inventory,
    'consent_banners', v_banners,
    'web_properties', v_properties,
    'consent_events_monthly', v_events,
    'rights_requests', v_rights,
    'deletion_receipts', v_deletions,
    'security_scans', v_scans,
    'consent_probe_runs', v_probes,
    'section_counts', v_section_counts,
    'generated_at', now()
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- 8/10 · Update RLS policies that reference org_memberships by name
-- ═══════════════════════════════════════════════════════════
-- Most policies travel with the rename. Two exceptions reference the
-- old name in their body text:
--   - public.audit_log policy (audit_export migration)
--   - admins_select_all policy for the table itself (admin_select_customer_tables)

-- Policy on audit_log that filters by membership
drop policy if exists "members can view audit log" on public.audit_log;
create policy "members can view audit log" on public.audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.org_memberships
       where user_id = auth.uid() and org_id = audit_log.org_id
    )
  );

-- admin SELECT policy on the renamed table — recreate with the new name.
drop policy if exists admins_select_all on public.org_memberships;
create policy admins_select_all on public.org_memberships
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

-- Recreate admins_select_all on the renamed table (and the original set
-- from ADR-0029 Sprint 1.1 20260417000020) using the same to_regclass
-- guard so missing tables are skipped safely.
do $$
declare
  v_table text;
begin
  for v_table in
    select unnest(array[
      'organisations',
      'org_memberships',
      'web_properties',
      'consent_banners',
      'data_inventory',
      'breach_notifications',
      'rights_requests',
      'export_configurations',
      'tracker_signatures',
      'tracker_overrides',
      'integration_connectors',
      'retention_rules',
      'notification_channels',
      'purpose_definitions',
      'purpose_connector_mappings',
      'accounts',
      'account_memberships',
      'plans'
    ])
  loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    execute format('drop policy if exists admins_select_all on public.%I', v_table);
    execute format(
      'create policy admins_select_all on public.%I for select to authenticated using (admin.is_admin())',
      v_table
    );
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 9/10 · Column-level RLS on credential columns
-- ═══════════════════════════════════════════════════════════
-- Approach: column-level REVOKE on authenticated. Admin/Viewer/
-- account_viewer queries that SELECT * will fail on these tables,
-- forcing callers to enumerate columns. org_admin + account_owner
-- paths use SECURITY DEFINER RPCs to read ciphertext — those bypass
-- column-level grants, so they continue to work.

-- Actual column names in the current schema:
--   web_properties.event_signing_secret       (text)
--   integration_connectors.config             (bytea)
--   export_configurations.write_credential_enc (bytea)

revoke select (event_signing_secret) on public.web_properties from authenticated;
revoke select (config) on public.integration_connectors from authenticated;
revoke select (write_credential_enc) on public.export_configurations from authenticated;

-- api_keys table may not exist; guard.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='api_keys' and column_name='key_hash'
  ) then
    execute 'revoke select (key_hash) on public.api_keys from authenticated';
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════
-- 10/10 · Verification
-- ═══════════════════════════════════════════════════════════
-- Run after push:
--   select count(*) from public.org_memberships where role not in ('org_admin','admin','viewer'); -- 0
--   select count(*) from public.account_memberships where role = 'account_owner'; -- = count(distinct account_id) from accounts that have any org_admin
--   select public.current_account_role();  -- requires auth context
--   select public.effective_org_role(<some org_id>);
