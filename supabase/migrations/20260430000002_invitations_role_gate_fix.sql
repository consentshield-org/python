-- ADR-0044 Phase 2.1 follow-up — fix NULL-compare bug in create_invitation.
--
-- The original body compared v_account_role <> 'account_owner', which is
-- NULL (not true) when the caller has no account_memberships row. The
-- gate fell through silently, letting an admin-tier user invite an
-- org_admin. Fix: coalesce to '' before comparison so missing membership
-- is treated as "not account_owner".

create or replace function public.create_invitation(
  p_email            text,
  p_role             text,
  p_account_id       uuid default null,
  p_org_id           uuid default null,
  p_plan_code        text default null,
  p_trial_days       int default null,
  p_default_org_name text default null,
  p_expires_in_days  int default 14
)
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := public.current_uid();
  v_token text;
  v_id uuid;
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_account_role text;
  v_org_effective_role text;
begin
  if v_uid is null and not v_is_admin_jwt then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_email is null or length(trim(p_email)) < 3 then
    raise exception 'invited_email required' using errcode = '22023';
  end if;

  if p_role not in ('account_owner','account_viewer','org_admin','admin','viewer') then
    raise exception 'role must be one of account_owner|account_viewer|org_admin|admin|viewer'
      using errcode = '22023';
  end if;

  if p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'p_expires_in_days must be in [1,90]' using errcode = '22023';
  end if;

  if p_role = 'account_owner' and p_account_id is null then
    if not v_is_admin_jwt then
      raise exception 'account-creating invites are operator-only'
        using errcode = '42501';
    end if;
    if p_plan_code is null then
      raise exception 'account-creating invites require p_plan_code' using errcode = '22023';
    end if;
    if not exists (select 1 from public.plans where plan_code = p_plan_code and is_active = true) then
      raise exception 'plan_code % is not active', p_plan_code using errcode = '22023';
    end if;
  end if;

  if p_role in ('account_owner','account_viewer') and p_account_id is not null then
    select am.role into v_account_role
      from public.account_memberships am
     where am.user_id = v_uid and am.account_id = p_account_id;
    if coalesce(v_account_role, '') <> 'account_owner' and not v_is_admin_jwt then
      raise exception 'account_owner role required' using errcode = '42501';
    end if;
  end if;

  if p_role in ('org_admin','admin','viewer') then
    if p_org_id is null or p_account_id is null then
      raise exception 'org-level invites require p_org_id and p_account_id' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.organisations o
       where o.id = p_org_id and o.account_id = p_account_id
    ) then
      raise exception 'org % does not belong to account %', p_org_id, p_account_id
        using errcode = '22023';
    end if;

    if v_is_admin_jwt then
      null;
    elsif p_role = 'org_admin' then
      select am.role into v_account_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = p_account_id;
      if coalesce(v_account_role, '') <> 'account_owner' then
        raise exception 'account_owner role required to invite org_admin' using errcode = '42501';
      end if;
    else
      v_org_effective_role := public.effective_org_role(p_org_id);
      if coalesce(v_org_effective_role, '') <> 'org_admin' then
        raise exception 'org_admin (or account_owner) role required'
          using errcode = '42501';
      end if;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (
    token, invited_email, account_id, org_id, role,
    plan_code, trial_days, default_org_name,
    invited_by, expires_at
  ) values (
    v_token, trim(p_email), p_account_id, p_org_id, p_role,
    p_plan_code, p_trial_days, p_default_org_name,
    v_uid, now() + make_interval(days => p_expires_in_days)
  )
  returning public.invitations.id into v_id;

  return query select v_id, v_token;
end;
$$;

grant execute on function public.create_invitation(text, text, uuid, uuid, text, int, text, int) to authenticated;
