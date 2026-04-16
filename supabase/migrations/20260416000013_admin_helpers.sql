-- ADR-0027 Sprint 1.1 — Admin helper functions.
--
-- Thin wrappers around the JWT claim check. Used by RLS policies on
-- admin tables (see subsequent migrations) and by admin RPCs to assert
-- role tiers at the top of every function body.
--
-- Per `docs/admin/architecture/consentshield-admin-schema.md` §4.

-- 4.1 admin.is_admin() — convenience predicate.
create or replace function admin.is_admin()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
$$;

grant execute on function admin.is_admin() to authenticated, cs_admin;

-- 4.2 admin.current_admin_role() — returns 'platform_operator' | 'support' | 'read_only' | null.
create or replace function admin.current_admin_role()
returns text language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'admin_role';
$$;

grant execute on function admin.current_admin_role() to authenticated, cs_admin;

-- 4.3 admin.require_admin(p_min_role) — assertion raised at RPC entry.
create or replace function admin.require_admin(p_min_role text default 'support')
returns void language plpgsql as $$
begin
  if not admin.is_admin() then
    raise exception 'admin claim required' using errcode = '42501';
  end if;
  if p_min_role = 'platform_operator' and admin.current_admin_role() <> 'platform_operator' then
    raise exception 'platform_operator role required' using errcode = '42501';
  end if;
  if p_min_role = 'support' and admin.current_admin_role() not in ('support','platform_operator') then
    raise exception 'support or platform_operator role required' using errcode = '42501';
  end if;
end;
$$;

grant execute on function admin.require_admin(text) to authenticated, cs_admin;

-- 4.4 admin.create_next_audit_partition() — monthly partition helper.
-- Scheduled by pg_cron in Sprint 3.1 (admin-create-next-audit-partition).
create or replace function admin.create_next_audit_partition()
returns void language plpgsql security definer as $$
declare
  v_next_month_start date := (date_trunc('month', now()) + interval '1 month')::date;
  v_following_month  date := (v_next_month_start + interval '1 month')::date;
  v_partition_name   text := 'admin_audit_log_' || to_char(v_next_month_start, 'YYYY_MM');
begin
  execute format(
    'create table if not exists admin.%I partition of admin.admin_audit_log for values from (%L) to (%L)',
    v_partition_name, v_next_month_start, v_following_month
  );
end;
$$;

-- create_next_audit_partition is invoked only by pg_cron (runs as postgres).
-- No execute grant to authenticated/cs_admin — no app code calls it.

-- Verification:
--   select proname, prosecdef, prolang::regtype
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'admin' and proname in
--       ('is_admin','current_admin_role','require_admin','create_next_audit_partition');
--     → 4 rows; create_next_audit_partition has prosecdef=true (SECURITY DEFINER).
