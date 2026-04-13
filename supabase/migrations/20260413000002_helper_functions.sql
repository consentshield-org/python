-- Migration 002: Helper Functions
-- RLS helpers, triggers, JWT custom claims hook

-- Returns the current user's org_id from their JWT
create or replace function current_org_id()
returns uuid language sql stable as $$
  select (auth.jwt() ->> 'org_id')::uuid;
$$;

-- Returns true if current user is an admin of their org
create or replace function is_org_admin()
returns boolean language sql stable as $$
  select (auth.jwt() ->> 'org_role') = 'admin';
$$;

-- Auto-update updated_at on mutable tables
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Auto-set SLA deadline: 30 calendar days from creation
create or replace function set_rights_request_sla()
returns trigger language plpgsql as $$
begin
  new.sla_deadline = new.created_at + interval '30 days';
  return new;
end;
$$;

-- Auto-set DPB deadline: 72 hours from discovery
create or replace function set_breach_deadline()
returns trigger language plpgsql as $$
begin
  new.dpb_notification_deadline = new.discovered_at + interval '72 hours';
  return new;
end;
$$;

-- JWT custom claims hook — injects org_id and org_role into every token
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claims jsonb;
  v_org_id uuid;
  v_org_role text;
begin
  claims := event -> 'claims';
  select om.org_id, om.role into v_org_id, v_org_role
  from organisation_members om
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
