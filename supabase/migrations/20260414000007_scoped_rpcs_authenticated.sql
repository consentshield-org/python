-- ADR-0009 Sprint 2.1 + 3.1 — remaining scoped-role RPCs.
-- Closes B-4 fully by eliminating every SUPABASE_SERVICE_ROLE_KEY usage in
-- running application code. Each RPC is security definer, owned by the
-- scoped role that should be the runtime principal, and granted to the
-- appropriate PostgREST role (anon or authenticated).

-- Migration role must be a member of cs_orchestrator (true for postgres
-- per migration 010).

-- -----------------------------------------------------------------------------
-- Public reads (replaces service-role use in the /rights/[orgId] and
-- /privacy/[orgId] server components).
-- -----------------------------------------------------------------------------

create or replace function public.rpc_get_rights_portal(p_org_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return query
    select o.id, o.name from organisations o where o.id = p_org_id;
end;
$$;

alter function public.rpc_get_rights_portal(uuid) owner to cs_orchestrator;
revoke all on function public.rpc_get_rights_portal(uuid) from public;
grant execute on function public.rpc_get_rights_portal(uuid) to anon, authenticated;

create or replace function public.rpc_get_privacy_notice(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org jsonb;
  v_inv jsonb;
begin
  select to_jsonb(t) into v_org
    from (
      select name, compliance_contact_email, dpo_name
      from organisations where id = p_org_id
    ) t;

  if v_org is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(to_jsonb(di) order by di.data_category), '[]'::jsonb) into v_inv
    from (
      select data_category, collection_source, purposes, legal_basis,
             retention_period, third_parties, data_locations
      from data_inventory
      where org_id = p_org_id
      order by data_category
    ) di;

  return jsonb_build_object('ok', true, 'org', v_org, 'inventory', v_inv);
end;
$$;

alter function public.rpc_get_privacy_notice(uuid) owner to cs_orchestrator;
revoke all on function public.rpc_get_privacy_notice(uuid) from public;
grant execute on function public.rpc_get_privacy_notice(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Authenticated writes — enforce org membership via auth.uid() inside the
-- function body. Replaces service-role usage in
-- /api/orgs/[orgId]/rights-requests/[id]/events,
-- /api/orgs/[orgId]/banners/[bannerId]/publish, and
-- /api/orgs/[orgId]/integrations.
-- -----------------------------------------------------------------------------

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
  v_uid uuid := auth.uid();
  v_role text;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
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

alter function public.rpc_rights_event_append(uuid, uuid, text, text, jsonb)
  owner to cs_orchestrator;
revoke all on function public.rpc_rights_event_append(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.rpc_rights_event_append(uuid, uuid, text, text, jsonb) to authenticated;

create or replace function public.rpc_banner_publish(
  p_banner_id uuid,
  p_org_id uuid,
  p_new_signing_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_property_id uuid;
  v_old_secret text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
    where user_id = v_uid and org_id = p_org_id;

  if v_role is null then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select property_id into v_property_id
    from consent_banners where id = p_banner_id and org_id = p_org_id;
  if v_property_id is null then
    return jsonb_build_object('ok', false, 'error', 'banner_not_found');
  end if;

  select event_signing_secret into v_old_secret
    from web_properties where id = v_property_id;

  update consent_banners set is_active = false
    where property_id = v_property_id and org_id = p_org_id;
  update consent_banners set is_active = true where id = p_banner_id;

  update web_properties set
    event_signing_secret = p_new_signing_secret,
    event_signing_secret_rotated_at = now()
  where id = v_property_id;

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
    values (
      p_org_id, v_uid, 'banner_published', 'consent_banner', p_banner_id,
      jsonb_build_object('property_id', v_property_id, 'secret_rotated', true)
    );

  return jsonb_build_object(
    'ok', true,
    'property_id', v_property_id,
    'old_secret', v_old_secret
  );
end;
$$;

alter function public.rpc_banner_publish(uuid, uuid, text) owner to cs_orchestrator;
revoke all on function public.rpc_banner_publish(uuid, uuid, text) from public;
grant execute on function public.rpc_banner_publish(uuid, uuid, text) to authenticated;

create or replace function public.rpc_integration_connector_create(
  p_org_id uuid,
  p_connector_type text,
  p_display_name text,
  p_encrypted_config bytea
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_connector_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select role into v_role
    from organisation_members
    where user_id = v_uid and org_id = p_org_id;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  insert into integration_connectors (
    org_id, connector_type, display_name, config, status
  ) values (
    p_org_id, p_connector_type, p_display_name, p_encrypted_config, 'active'
  ) returning id into v_connector_id;

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
    values (
      p_org_id, v_uid, 'connector_added', 'integration_connector', v_connector_id,
      jsonb_build_object('connector_type', p_connector_type, 'display_name', p_display_name)
    );

  return jsonb_build_object(
    'ok', true,
    'connector_id', v_connector_id,
    'connector_type', p_connector_type,
    'display_name', p_display_name
  );
end;
$$;

alter function public.rpc_integration_connector_create(uuid, text, text, bytea)
  owner to cs_orchestrator;
revoke all on function public.rpc_integration_connector_create(uuid, text, text, bytea) from public;
grant execute on function public.rpc_integration_connector_create(uuid, text, text, bytea) to authenticated;

-- -----------------------------------------------------------------------------
-- Signup bootstrap. Runs right after supabase.auth.signUp, under the new
-- user's JWT. Creates the org + adds the user as admin + writes audit_log.
-- -----------------------------------------------------------------------------

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
  v_uid uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  insert into organisations (name, industry) values (p_org_name, p_industry)
    returning id into v_org_id;

  insert into organisation_members (org_id, user_id, role)
    values (v_org_id, v_uid, 'admin');

  insert into audit_log (org_id, actor_id, event_type, entity_type, entity_id)
    values (v_org_id, v_uid, 'org_created', 'organisation', v_org_id);

  return jsonb_build_object('ok', true, 'org_id', v_org_id, 'name', p_org_name);
end;
$$;

alter function public.rpc_signup_bootstrap_org(text, text) owner to cs_orchestrator;
revoke all on function public.rpc_signup_bootstrap_org(text, text) from public;
grant execute on function public.rpc_signup_bootstrap_org(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Razorpay webhook. Owned by cs_orchestrator, granted to anon. The Node
-- route verifies the HMAC signature before calling this function; the RPC
-- handles org resolution and plan state transitions.
-- -----------------------------------------------------------------------------

create or replace function public.rpc_razorpay_apply_subscription(
  p_event text,
  p_subscription_id text,
  p_cs_plan text,
  p_org_id_hint uuid,
  p_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_org_id uuid;
begin
  v_org_id := p_org_id_hint;
  if v_org_id is null then
    select id into v_org_id
      from organisations where razorpay_subscription_id = p_subscription_id;
  end if;

  if v_org_id is null then
    return jsonb_build_object('ok', false, 'error', 'org_not_found');
  end if;

  case p_event
    when 'subscription.activated', 'subscription.charged', 'subscription.resumed' then
      if p_cs_plan is not null then
        update organisations set
          plan = p_cs_plan,
          plan_started_at = now(),
          razorpay_subscription_id = p_subscription_id
        where id = v_org_id;
      end if;
      insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'plan_activated', 'organisation', v_org_id,
          jsonb_build_object('plan', p_cs_plan, 'subscription_id', p_subscription_id)
        );
    when 'subscription.cancelled', 'subscription.paused' then
      update organisations set plan = 'trial' where id = v_org_id;
      insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'plan_downgraded', 'organisation', v_org_id,
          jsonb_build_object('reason', p_event, 'subscription_id', p_subscription_id)
        );
    when 'payment.failed' then
      insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
        values (
          v_org_id, 'payment_failed', 'organisation', v_org_id,
          jsonb_build_object('subscription_id', p_subscription_id, 'payment_id', p_payment_id)
        );
    else
      -- unknown event — ack without change
      null;
  end case;

  return jsonb_build_object('ok', true, 'org_id', v_org_id);
end;
$$;

alter function public.rpc_razorpay_apply_subscription(text, text, text, uuid, text)
  owner to cs_orchestrator;
revoke all on function public.rpc_razorpay_apply_subscription(text, text, text, uuid, text) from public;
grant execute on function public.rpc_razorpay_apply_subscription(text, text, text, uuid, text) to anon;

-- -----------------------------------------------------------------------------
-- Plan gating read. The billing library needs the org's plan plus counts of
-- gated resources. Exposed as a single RPC so the library doesn't need to
-- touch organisations/web_properties/integration_connectors directly.
-- -----------------------------------------------------------------------------

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
  v_plan text;
  v_current int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from organisation_members where user_id = v_uid and org_id = p_org_id
  ) then
    raise exception 'not a member of org' using errcode = '42501';
  end if;

  select plan into v_plan from organisations where id = p_org_id;

  if p_resource = 'web_properties' then
    select count(*) into v_current from web_properties where org_id = p_org_id;
  elsif p_resource = 'deletion_connectors' then
    select count(*) into v_current from integration_connectors where org_id = p_org_id;
  else
    raise exception 'unknown resource %', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object('plan', v_plan, 'current', v_current);
end;
$$;

alter function public.rpc_plan_limit_check(uuid, text) owner to cs_orchestrator;
revoke all on function public.rpc_plan_limit_check(uuid, text) from public;
grant execute on function public.rpc_plan_limit_check(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Widen encrypt/decrypt execute so the authenticated session can call them
-- via the Next.js library layer (crypto.ts). The RPCs themselves do no
-- authorization beyond holding the derived key — the derived key requires
-- the MASTER_ENCRYPTION_KEY which lives only on the Next.js server.
-- -----------------------------------------------------------------------------

grant execute on function public.encrypt_secret(text, text) to authenticated;
grant execute on function public.decrypt_secret(bytea, text) to authenticated;
