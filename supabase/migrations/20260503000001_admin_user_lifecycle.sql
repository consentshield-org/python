-- ADR-0045 Sprint 1.1 — admin user lifecycle: invite + role change + disable.
--
-- Extends admin.admin_users.status to allow 'invited'. Adds four RPCs:
--   admin.admin_invite_create  — records a pending admin row (platform_operator)
--   admin.admin_change_role    — flips admin_role (platform_operator; cannot
--                                 self-change, cannot demote last PO)
--   admin.admin_disable        — sets status='disabled' (platform_operator;
--                                 cannot self-disable, cannot disable last PO)
--   admin.admin_list           — reads active + invited rows for the UI
--
-- Auth-side sync (auth.users.raw_app_meta_data) is the Route Handler's
-- responsibility (Sprint 1.2) because plpgsql can't call the
-- auth.admin.* service-role API. The RPCs own postgres state; the
-- handler follows with the JWT-side update.

-- ═══════════════════════════════════════════════════════════
-- 1 · Extend status check to include 'invited'
-- ═══════════════════════════════════════════════════════════
alter table admin.admin_users
  drop constraint if exists admin_users_status_check;

alter table admin.admin_users
  add constraint admin_users_status_check
  check (status in ('active', 'invited', 'disabled', 'suspended'));

-- ═══════════════════════════════════════════════════════════
-- 2 · admin.admin_invite_create
-- ═══════════════════════════════════════════════════════════
create or replace function admin.admin_invite_create(
  p_user_id      uuid,
  p_display_name text,
  p_admin_role   text,
  p_reason       text
)
returns uuid
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
begin
  perform admin.require_admin('platform_operator');

  if p_admin_role not in ('platform_operator', 'support', 'read_only') then
    raise exception 'admin_role must be platform_operator, support, or read_only';
  end if;
  if length(coalesce(p_display_name, '')) < 1 then
    raise exception 'display_name required';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if exists (select 1 from admin.admin_users where id = p_user_id) then
    raise exception 'admin row already exists for this user';
  end if;

  insert into admin.admin_users
    (id, display_name, admin_role, status, created_by)
  values
    (p_user_id, p_display_name, p_admin_role, 'invited', v_operator);

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_invite_create', 'admin.admin_users', p_user_id, null,
     null,
     jsonb_build_object(
       'display_name', p_display_name,
       'admin_role',   p_admin_role,
       'status',       'invited'
     ),
     p_reason);

  return p_user_id;
end;
$$;

grant execute on function admin.admin_invite_create(uuid, text, text, text) to authenticated, cs_admin;

comment on function admin.admin_invite_create(uuid, text, text, text) is
  'ADR-0045 Sprint 1.1. Records a pending admin_users row with status=invited. '
  'Auth user must already exist (Route Handler creates it via service-role). '
  'platform_operator only.';

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.admin_change_role
-- ═══════════════════════════════════════════════════════════
create or replace function admin.admin_change_role(
  p_admin_id uuid,
  p_new_role text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row      admin.admin_users%rowtype;
  v_active_po_count int;
begin
  perform admin.require_admin('platform_operator');

  if p_new_role not in ('platform_operator', 'support', 'read_only') then
    raise exception 'admin_role must be platform_operator, support, or read_only';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_admin_id = v_operator then
    raise exception 'cannot change your own role';
  end if;

  select * into v_row from admin.admin_users where id = p_admin_id;
  if v_row.id is null then
    raise exception 'admin not found';
  end if;
  if v_row.admin_role = p_new_role then
    raise exception 'admin_role is already %', p_new_role;
  end if;

  -- Last-platform_operator protection: refuse demoting the only active
  -- platform_operator. Count includes 'active' + 'invited' rows; a
  -- disabled/suspended admin does not count.
  if v_row.admin_role = 'platform_operator' and p_new_role <> 'platform_operator' then
    select count(*) into v_active_po_count
      from admin.admin_users
     where admin_role = 'platform_operator'
       and status in ('active', 'invited');
    if v_active_po_count <= 1 then
      raise exception 'cannot demote the last active platform_operator';
    end if;
  end if;

  update admin.admin_users
     set admin_role = p_new_role
   where id = p_admin_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_change_role', 'admin.admin_users', p_admin_id, null,
     jsonb_build_object('admin_role', v_row.admin_role),
     jsonb_build_object('admin_role', p_new_role),
     p_reason);
end;
$$;

grant execute on function admin.admin_change_role(uuid, text, text) to authenticated, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.admin_disable
-- ═══════════════════════════════════════════════════════════
create or replace function admin.admin_disable(
  p_admin_id uuid,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row      admin.admin_users%rowtype;
  v_active_po_count int;
begin
  perform admin.require_admin('platform_operator');

  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;
  if p_admin_id = v_operator then
    raise exception 'cannot disable yourself';
  end if;

  select * into v_row from admin.admin_users where id = p_admin_id;
  if v_row.id is null then
    raise exception 'admin not found';
  end if;
  if v_row.status = 'disabled' then
    raise exception 'admin already disabled';
  end if;

  if v_row.admin_role = 'platform_operator' then
    select count(*) into v_active_po_count
      from admin.admin_users
     where admin_role = 'platform_operator'
       and status in ('active', 'invited');
    if v_active_po_count <= 1 then
      raise exception 'cannot disable the last active platform_operator';
    end if;
  end if;

  update admin.admin_users
     set status          = 'disabled',
         disabled_at     = now(),
         disabled_reason = p_reason
   where id = p_admin_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'admin_disable', 'admin.admin_users', p_admin_id, null,
     jsonb_build_object('status', v_row.status, 'admin_role', v_row.admin_role),
     jsonb_build_object('status', 'disabled'),
     p_reason);
end;
$$;

grant execute on function admin.admin_disable(uuid, text) to authenticated, cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 5 · admin.admin_list — read for the UI panel
-- ═══════════════════════════════════════════════════════════
create or replace function admin.admin_list()
returns table (
  id               uuid,
  display_name     text,
  admin_role       text,
  status           text,
  bootstrap_admin  boolean,
  created_at       timestamptz,
  disabled_at      timestamptz,
  disabled_reason  text
)
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
begin
  perform admin.require_admin('support');

  return query
  select au.id, au.display_name, au.admin_role, au.status,
         au.bootstrap_admin, au.created_at, au.disabled_at, au.disabled_reason
    from admin.admin_users au
   order by
     case au.status when 'active' then 0 when 'invited' then 1 when 'suspended' then 2 else 3 end,
     au.created_at desc;
end;
$$;

grant execute on function admin.admin_list() to authenticated, cs_admin;

-- Verification:
--   select conname from pg_constraint where conrelid = 'admin.admin_users'::regclass and contype='c';
--     → admin_users_status_check (new definition with 'invited').
--
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'admin' and proname like 'admin_%';
--    → admin_invite_create, admin_change_role, admin_disable, admin_list, ...
