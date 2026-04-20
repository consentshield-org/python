-- Migration: ADR-1001 Sprint 2.1 — fixes to 20260520000001
-- Two issues surfaced during test:
--   1. RLS recursion — api_keys policies query account_memberships directly,
--      which has its own RLS that recurses. Replace with SECURITY DEFINER
--      helpers that bypass RLS.
--   2. NULL in IN — rpc_api_key_create's `v_caller_role not in (...)` was
--      false when v_caller_role was null (no account membership), so a
--      non-member caller passed the gate. Fix with explicit null-check.

-- ============================================================================
-- 1. Membership-check helpers (SECURITY DEFINER; bypass RLS recursion)
-- ============================================================================

create or replace function public.is_account_member(
  p_account_id uuid,
  p_roles text[] default array['account_owner','account_viewer']
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.account_memberships am
     where am.account_id = p_account_id
       and am.user_id   = public.current_uid()
       and am.status    = 'active'
       and am.role      = any (p_roles)
  );
$$;

grant execute on function public.is_account_member(uuid, text[]) to authenticated;

create or replace function public.is_org_member(
  p_org_id uuid,
  p_roles text[] default array['org_admin','admin','viewer']
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.org_memberships om
     where om.org_id  = p_org_id
       and om.user_id = public.current_uid()
       and om.role    = any (p_roles)
  );
$$;

grant execute on function public.is_org_member(uuid, text[]) to authenticated;

-- ============================================================================
-- 2. Replace the recursive api_keys SELECT policies
-- ============================================================================

drop policy if exists "api_keys_select_account_member" on public.api_keys;
drop policy if exists "api_keys_select_org_admin" on public.api_keys;

create policy "api_keys_select_account_member"
  on public.api_keys
  for select
  using (
    account_id is not null
    and public.is_account_member(account_id, array['account_owner','account_viewer'])
  );

create policy "api_keys_select_org_admin"
  on public.api_keys
  for select
  using (
    org_id is not null
    and public.is_org_member(org_id, array['org_admin'])
  );

-- Same fix for api_request_log.
drop policy if exists "api_request_log_select_account_member" on public.api_request_log;
drop policy if exists "api_request_log_select_org_admin" on public.api_request_log;

create policy "api_request_log_select_account_member"
  on public.api_request_log
  for select
  using (
    account_id is not null
    and public.is_account_member(account_id, array['account_owner','account_viewer'])
  );

create policy "api_request_log_select_org_admin"
  on public.api_request_log
  for select
  using (
    org_id is not null
    and public.is_org_member(org_id, array['org_admin'])
  );

-- ============================================================================
-- 3. rpc_api_key_create — explicit null-check on caller role
-- ============================================================================

create or replace function public.rpc_api_key_create(
  p_account_id uuid,
  p_org_id uuid,
  p_scopes text[],
  p_rate_tier text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_plaintext text;
  v_prefix text;
  v_hash text;
  v_key_id uuid;
  v_is_account_owner boolean;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- account_owner of target account? (SECURITY DEFINER check bypasses RLS recursion)
  v_is_account_owner := public.is_account_member(p_account_id, array['account_owner']);

  if not v_is_account_owner then
    -- Must be org_admin of target org AND org must belong to target account.
    if p_org_id is null then
      raise exception 'only account_owner may create account-scoped keys'
        using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.org_memberships om
        join public.organisations o on o.id = om.org_id
       where om.org_id = p_org_id
         and om.user_id = v_uid
         and om.role = 'org_admin'
         and o.account_id = p_account_id
    ) then
      raise exception 'not an org_admin of target org'
        using errcode = '42501';
    end if;
  end if;

  if not public.api_keys_scopes_valid(p_scopes) then
    raise exception 'invalid scope in array' using errcode = '22023';
  end if;

  if p_rate_tier not in ('starter','growth','pro','enterprise','sandbox') then
    raise exception 'invalid rate_tier' using errcode = '22023';
  end if;

  v_plaintext := 'cs_live_' || translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=', '-_'
  );
  v_prefix := substring(v_plaintext from 1 for 16);
  v_hash := encode(extensions.digest(v_plaintext, 'sha256'), 'hex');

  insert into public.api_keys (
    account_id, org_id, key_hash, key_prefix, name, scopes, rate_tier,
    created_by
  ) values (
    p_account_id, p_org_id, v_hash, v_prefix, p_name, p_scopes, p_rate_tier,
    v_uid
  )
  returning id into v_key_id;

  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
  values (
    coalesce(p_org_id, (select id from public.organisations where account_id = p_account_id limit 1)),
    v_uid,
    'api_key.created',
    'api_key',
    v_key_id,
    jsonb_build_object(
      'prefix', v_prefix,
      'scopes', p_scopes,
      'rate_tier', p_rate_tier,
      'account_id', p_account_id,
      'org_scoped', p_org_id is not null
    )
  );

  return jsonb_build_object(
    'id', v_key_id,
    'plaintext', v_plaintext,
    'prefix', v_prefix,
    'scopes', p_scopes,
    'rate_tier', p_rate_tier,
    'created_at', now()
  );
end;
$$;

grant execute on function public.rpc_api_key_create(uuid, uuid, text[], text, text)
  to authenticated;
