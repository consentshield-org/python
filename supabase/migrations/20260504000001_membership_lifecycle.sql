-- ADR-0047 Sprint 1.1 — customer membership lifecycle.
--
-- Adds:
--   1. public.membership_audit_log — append-only audit trail for
--      role-change + remove actions on account_memberships / org_memberships.
--   2. public.change_membership_role(p_user_id, p_scope, p_org_id, p_new_role, p_reason)
--   3. public.remove_membership(p_user_id, p_scope, p_org_id, p_reason)
--   4. Patch public.create_invitation — refuse if the invited email already
--      has an accepted account_memberships row on a different account
--      (single-account-per-identity invariant).
--   5. Patch public.create_invitation_from_marketing — same refusal.
--   6. Patch public.accept_invitation — race-condition check at accept time.
--
-- All new RPCs follow the ADR-0044 gate conventions:
--   * account_owner for account-tier actions
--   * account_owner OR org_admin of the org for org-tier actions
--   * admin-JWT bypass
--   * reason text length >= 10
--   * self-action refused
--   * last-account_owner refused

-- ═══════════════════════════════════════════════════════════
-- 1/7 · public.membership_audit_log
-- ═══════════════════════════════════════════════════════════

create table if not exists public.membership_audit_log (
  id              bigserial   primary key,
  occurred_at     timestamptz not null default now(),
  account_id      uuid        not null references public.accounts(id) on delete cascade,
  org_id          uuid        references public.organisations(id) on delete cascade,
  actor_user_id   uuid        not null,
  target_user_id  uuid        not null,
  action          text        not null check (action in (
                    'membership_role_change',
                    'membership_remove'
                  )),
  old_value       jsonb,
  new_value       jsonb,
  reason          text        not null check (length(reason) >= 10)
);

create index if not exists membership_audit_log_account_idx
  on public.membership_audit_log (account_id, occurred_at desc);
create index if not exists membership_audit_log_target_idx
  on public.membership_audit_log (target_user_id, occurred_at desc);

alter table public.membership_audit_log enable row level security;

-- account_owner of the account can SELECT their account's audit rows.
drop policy if exists membership_audit_log_read_by_owner on public.membership_audit_log;
create policy membership_audit_log_read_by_owner on public.membership_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.account_memberships am
       where am.account_id = membership_audit_log.account_id
         and am.user_id = auth.uid()
         and am.role = 'account_owner'
    )
    or (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true
  );

revoke insert, update, delete on public.membership_audit_log from authenticated, anon;
grant select, insert on public.membership_audit_log to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 2/7 · helper — single-account-per-identity lookup
-- ═══════════════════════════════════════════════════════════
-- Returns the account_id of a conflicting existing membership for
-- the given email, excluding p_except_account_id. NULL means no
-- conflict (either the email has no auth.users row yet, or its
-- existing membership is on the expected account).
--
-- Checks BOTH account_memberships and org_memberships (resolving
-- org→account). org-tier-only members do not have an
-- account_memberships row today, but their org's account is still
-- the account their identity is bound to for the invariant's
-- purposes.

create or replace function public._conflicting_account_for_email(
  p_email             text,
  p_except_account_id uuid default null
) returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with user_row as (
    select id from auth.users where lower(email) = lower(p_email) limit 1
  ),
  account_hits as (
    select am.account_id
      from public.account_memberships am
      join user_row u on am.user_id = u.id
     where (p_except_account_id is null or am.account_id <> p_except_account_id)
  ),
  org_hits as (
    select o.account_id
      from public.org_memberships om
      join user_row u on om.user_id = u.id
      join public.organisations o on o.id = om.org_id
     where (p_except_account_id is null or o.account_id <> p_except_account_id)
  )
  select account_id from account_hits
   union
  select account_id from org_hits
   limit 1
$$;

revoke execute on function public._conflicting_account_for_email(text, uuid) from public;
grant execute on function public._conflicting_account_for_email(text, uuid) to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 3/7 · public.change_membership_role
-- ═══════════════════════════════════════════════════════════

create or replace function public.change_membership_role(
  p_user_id  uuid,
  p_scope    text,
  p_org_id   uuid,
  p_new_role text,
  p_reason   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid          uuid    := public.current_uid();
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_target_account_id uuid;
  v_old_role     text;
  v_caller_acct_role text;
  v_caller_org_effective text;
  v_remaining_owners int;
begin
  if v_uid is null and not v_is_admin_jwt then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_scope not in ('account','org') then
    raise exception 'p_scope must be account or org' using errcode = '22023';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (>=10 chars)' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;

  if p_scope = 'account' then
    if p_new_role not in ('account_owner','account_viewer') then
      raise exception 'account-scope role must be account_owner or account_viewer'
        using errcode = '22023';
    end if;

    select am.role, am.account_id
      into v_old_role, v_target_account_id
      from public.account_memberships am
     where am.user_id = p_user_id
     limit 1;
    if v_target_account_id is null then
      raise exception 'target user has no account membership' using errcode = '22023';
    end if;

    if not v_is_admin_jwt then
      select am.role into v_caller_acct_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = v_target_account_id
       limit 1;
      if coalesce(v_caller_acct_role, '') <> 'account_owner' then
        raise exception 'account_owner role required' using errcode = '42501';
      end if;
    end if;

    if v_old_role = p_new_role then
      return;  -- idempotent
    end if;

    -- last-account_owner guard: refuse demoting the last active account_owner
    if v_old_role = 'account_owner' and p_new_role <> 'account_owner' then
      select count(*) into v_remaining_owners
        from public.account_memberships
       where account_id = v_target_account_id
         and role = 'account_owner'
         and status = 'active';
      if v_remaining_owners <= 1 then
        raise exception 'cannot demote the last account_owner' using errcode = '42501';
      end if;
    end if;

    update public.account_memberships
       set role = p_new_role
     where account_id = v_target_account_id and user_id = p_user_id;

    insert into public.membership_audit_log
      (account_id, org_id, actor_user_id, target_user_id, action, old_value, new_value, reason)
    values
      (v_target_account_id, null, coalesce(v_uid, p_user_id), p_user_id,
       'membership_role_change',
       jsonb_build_object('scope','account','role', v_old_role),
       jsonb_build_object('scope','account','role', p_new_role),
       p_reason);

  else
    -- scope = 'org'
    if p_new_role not in ('org_admin','admin','viewer') then
      raise exception 'org-scope role must be org_admin, admin, or viewer'
        using errcode = '22023';
    end if;
    if p_org_id is null then
      raise exception 'p_org_id required for scope=org' using errcode = '22023';
    end if;

    select o.account_id into v_target_account_id
      from public.organisations o
     where o.id = p_org_id;
    if v_target_account_id is null then
      raise exception 'org % not found', p_org_id using errcode = '22023';
    end if;

    select om.role into v_old_role
      from public.org_memberships om
     where om.org_id = p_org_id and om.user_id = p_user_id;
    if v_old_role is null then
      raise exception 'target user has no org membership on org %', p_org_id
        using errcode = '22023';
    end if;

    if not v_is_admin_jwt then
      -- account_owner of the org's account OR org_admin of the org
      select am.role into v_caller_acct_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = v_target_account_id;
      if coalesce(v_caller_acct_role, '') <> 'account_owner' then
        v_caller_org_effective := public.effective_org_role(p_org_id);
        if coalesce(v_caller_org_effective, '') <> 'org_admin' then
          raise exception 'org_admin (or account_owner) role required'
            using errcode = '42501';
        end if;
      end if;
    end if;

    if v_old_role = p_new_role then
      return;  -- idempotent
    end if;

    update public.org_memberships
       set role = p_new_role
     where org_id = p_org_id and user_id = p_user_id;

    insert into public.membership_audit_log
      (account_id, org_id, actor_user_id, target_user_id, action, old_value, new_value, reason)
    values
      (v_target_account_id, p_org_id, coalesce(v_uid, p_user_id), p_user_id,
       'membership_role_change',
       jsonb_build_object('scope','org','org_id', p_org_id, 'role', v_old_role),
       jsonb_build_object('scope','org','org_id', p_org_id, 'role', p_new_role),
       p_reason);
  end if;
end;
$$;

revoke execute on function public.change_membership_role(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.change_membership_role(uuid, text, uuid, text, text) to authenticated;

comment on function public.change_membership_role(uuid, text, uuid, text, text) is
  'ADR-0047 Sprint 1.1. Change an existing member''s role on account or org scope.';

-- ═══════════════════════════════════════════════════════════
-- 4/7 · public.remove_membership
-- ═══════════════════════════════════════════════════════════
-- Hard delete. For scope='account', also deletes all org_memberships
-- for the target user under that account — otherwise the user would
-- retain ghost access to orgs whose account-level membership was just
-- revoked.

create or replace function public.remove_membership(
  p_user_id uuid,
  p_scope   text,
  p_org_id  uuid,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid          uuid    := public.current_uid();
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_target_account_id uuid;
  v_old_role     text;
  v_caller_acct_role text;
  v_caller_org_effective text;
  v_remaining_owners int;
  v_old_orgs_json jsonb;
begin
  if v_uid is null and not v_is_admin_jwt then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_scope not in ('account','org') then
    raise exception 'p_scope must be account or org' using errcode = '22023';
  end if;
  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (>=10 chars)' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'p_user_id required' using errcode = '22023';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot remove yourself' using errcode = '42501';
  end if;

  if p_scope = 'account' then
    select am.role, am.account_id
      into v_old_role, v_target_account_id
      from public.account_memberships am
     where am.user_id = p_user_id
     limit 1;
    if v_target_account_id is null then
      raise exception 'target user has no account membership' using errcode = '22023';
    end if;

    if not v_is_admin_jwt then
      select am.role into v_caller_acct_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = v_target_account_id;
      if coalesce(v_caller_acct_role, '') <> 'account_owner' then
        raise exception 'account_owner role required' using errcode = '42501';
      end if;
    end if;

    if v_old_role = 'account_owner' then
      select count(*) into v_remaining_owners
        from public.account_memberships
       where account_id = v_target_account_id
         and role = 'account_owner'
         and status = 'active';
      if v_remaining_owners <= 1 then
        raise exception 'cannot remove the last account_owner' using errcode = '42501';
      end if;
    end if;

    -- Snapshot org memberships under this account (for audit diff) before cascade.
    select coalesce(jsonb_agg(jsonb_build_object('org_id', om.org_id, 'role', om.role)), '[]'::jsonb)
      into v_old_orgs_json
      from public.org_memberships om
      join public.organisations o on o.id = om.org_id
     where om.user_id = p_user_id and o.account_id = v_target_account_id;

    delete from public.org_memberships om
     using public.organisations o
     where om.org_id = o.id
       and o.account_id = v_target_account_id
       and om.user_id = p_user_id;

    delete from public.account_memberships
     where account_id = v_target_account_id and user_id = p_user_id;

    insert into public.membership_audit_log
      (account_id, org_id, actor_user_id, target_user_id, action, old_value, new_value, reason)
    values
      (v_target_account_id, null, coalesce(v_uid, p_user_id), p_user_id,
       'membership_remove',
       jsonb_build_object('scope','account','role', v_old_role, 'cascaded_orgs', v_old_orgs_json),
       null,
       p_reason);

  else
    -- scope = 'org'
    if p_org_id is null then
      raise exception 'p_org_id required for scope=org' using errcode = '22023';
    end if;

    select o.account_id into v_target_account_id
      from public.organisations o
     where o.id = p_org_id;
    if v_target_account_id is null then
      raise exception 'org % not found', p_org_id using errcode = '22023';
    end if;

    select om.role into v_old_role
      from public.org_memberships om
     where om.org_id = p_org_id and om.user_id = p_user_id;
    if v_old_role is null then
      raise exception 'target user has no org membership on org %', p_org_id
        using errcode = '22023';
    end if;

    if not v_is_admin_jwt then
      select am.role into v_caller_acct_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = v_target_account_id;
      if coalesce(v_caller_acct_role, '') <> 'account_owner' then
        v_caller_org_effective := public.effective_org_role(p_org_id);
        if coalesce(v_caller_org_effective, '') <> 'org_admin' then
          raise exception 'org_admin (or account_owner) role required'
            using errcode = '42501';
        end if;
      end if;
    end if;

    delete from public.org_memberships
     where org_id = p_org_id and user_id = p_user_id;

    insert into public.membership_audit_log
      (account_id, org_id, actor_user_id, target_user_id, action, old_value, new_value, reason)
    values
      (v_target_account_id, p_org_id, coalesce(v_uid, p_user_id), p_user_id,
       'membership_remove',
       jsonb_build_object('scope','org','org_id', p_org_id, 'role', v_old_role),
       null,
       p_reason);
  end if;
end;
$$;

revoke execute on function public.remove_membership(uuid, text, uuid, text) from public, anon;
grant execute on function public.remove_membership(uuid, text, uuid, text) to authenticated;

comment on function public.remove_membership(uuid, text, uuid, text) is
  'ADR-0047 Sprint 1.1. Hard-delete a membership. scope=account cascades org memberships within the same account.';

-- ═══════════════════════════════════════════════════════════
-- 5/7 · Patch public.create_invitation — single-account invariant
-- ═══════════════════════════════════════════════════════════

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
set search_path = public, pg_catalog, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_token text;
  v_id uuid;
  v_is_admin_jwt boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false);
  v_account_role text;
  v_org_effective_role text;
  v_conflict_account uuid;
  v_check_except_account uuid;
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

  -- ────────────────────────────────────────────────────────────
  -- Authorisation gates
  -- ────────────────────────────────────────────────────────────

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

  -- ────────────────────────────────────────────────────────────
  -- ADR-0047: single-account-per-identity invariant
  -- ────────────────────────────────────────────────────────────
  -- New-account invites: email must not be on any account yet.
  -- All other invites: email must not be on any account OTHER than p_account_id.
  v_check_except_account := p_account_id;  -- null for new-account invites → any conflict refused
  v_conflict_account := public._conflicting_account_for_email(trim(p_email), v_check_except_account);
  if v_conflict_account is not null then
    raise exception 'email already has a membership on account % — single-account-per-identity', v_conflict_account
      using errcode = '42501';
  end if;

  -- ────────────────────────────────────────────────────────────
  -- Insert
  -- ────────────────────────────────────────────────────────────

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

-- Preserve original grant surface (authenticated). Re-grant defensively.
revoke execute on function public.create_invitation(text, text, uuid, uuid, text, int, text, int) from public, anon;
grant execute on function public.create_invitation(text, text, uuid, uuid, text, int, text, int) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6/7 · Patch public.create_invitation_from_marketing
-- ═══════════════════════════════════════════════════════════

create or replace function public.create_invitation_from_marketing(
  p_email            text,
  p_plan_code        text,
  p_trial_days       int  default null,
  p_default_org_name text default null,
  p_expires_in_days  int  default 14
)
returns table (id uuid, token text)
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_token text;
  v_id uuid;
  v_conflict_account uuid;
begin
  if p_email is null or length(trim(p_email)) < 3 then
    raise exception 'invited_email required' using errcode = '22023';
  end if;

  if p_plan_code is null then
    raise exception 'p_plan_code required for account-creating invites' using errcode = '22023';
  end if;

  if not exists (select 1 from public.plans where plan_code = p_plan_code and is_active = true) then
    raise exception 'plan_code % is not active', p_plan_code using errcode = '22023';
  end if;

  if p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'p_expires_in_days must be in [1,90]' using errcode = '22023';
  end if;

  -- ADR-0047: single-account-per-identity — new-account invite refused
  -- if email already belongs to any account.
  v_conflict_account := public._conflicting_account_for_email(trim(p_email), null);
  if v_conflict_account is not null then
    raise exception 'email already has a membership on account % — single-account-per-identity', v_conflict_account
      using errcode = '42501';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (
    token, invited_email, account_id, org_id, role,
    plan_code, trial_days, default_org_name,
    invited_by, expires_at
  ) values (
    v_token, trim(p_email), null, null, 'account_owner',
    p_plan_code, p_trial_days, p_default_org_name,
    null, now() + make_interval(days => p_expires_in_days)
  )
  returning public.invitations.id into v_id;

  return query select v_id, v_token;
end;
$$;

revoke execute on function public.create_invitation_from_marketing(text, text, int, text, int) from public, authenticated, anon;
grant execute on function public.create_invitation_from_marketing(text, text, int, text, int) to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 7/7 · Patch public.accept_invitation — accept-time race check
-- ═══════════════════════════════════════════════════════════

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_email text;
  v_inv record;
  v_account_id uuid;
  v_org_id uuid;
  v_org_name text;
  v_trial_days int;
  v_conflict_account uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select * into v_inv
    from public.invitations
   where token = p_token
   for update;
  if v_inv is null then
    raise exception 'invitation not found' using errcode = '42704';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invitation already accepted' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email,'')) <> lower(v_inv.invited_email) then
    raise exception 'invitation email does not match authenticated user'
      using errcode = '42501';
  end if;

  -- ADR-0047: single-account-per-identity race check.
  -- For new-account invites, the email must not belong to any account.
  -- For existing-account invites (account_id set), the email must not
  -- belong to any account OTHER than the invite's account_id.
  -- For org-tier invites, same (account_id set).
  v_conflict_account := public._conflicting_account_for_email(v_inv.invited_email, v_inv.account_id);
  if v_conflict_account is not null then
    raise exception 'email has been added to account % since this invite was created — single-account-per-identity', v_conflict_account
      using errcode = '42501';
  end if;

  if v_inv.role = 'account_owner' and v_inv.account_id is null then
    v_org_name := coalesce(v_inv.default_org_name,
                           split_part(v_inv.invited_email, '@', 1));
    v_trial_days := coalesce(v_inv.trial_days,
                             (select trial_days from public.plans where plan_code = v_inv.plan_code));

    insert into public.accounts (name, plan_code, status, trial_ends_at)
    values (v_org_name,
            v_inv.plan_code,
            case when coalesce(v_trial_days, 0) > 0 then 'trial' else 'active' end,
            case when coalesce(v_trial_days, 0) > 0 then now() + make_interval(days => v_trial_days) else null end)
    returning id into v_account_id;

    insert into public.organisations (name, account_id)
    values (v_org_name, v_account_id)
    returning id into v_org_id;

    insert into public.account_memberships (account_id, user_id, role, accepted_at)
    values (v_account_id, v_uid, 'account_owner', now());

    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, 'org_admin');

  elsif v_inv.role in ('account_owner','account_viewer') then
    v_account_id := v_inv.account_id;
    insert into public.account_memberships (account_id, user_id, role, invited_by, invited_at, accepted_at)
    values (v_account_id, v_uid, v_inv.role, v_inv.invited_by, v_inv.created_at, now())
    on conflict (account_id, user_id) do update
      set role = excluded.role, status = 'active';

  else
    -- Org-level role. No implicit account_memberships row — the
    -- _conflicting_account_for_email helper checks org_memberships
    -- too, so the invariant still holds.
    v_account_id := v_inv.account_id;
    v_org_id := v_inv.org_id;
    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do update
      set role = excluded.role;
  end if;

  update public.invitations
     set accepted_at = now(),
         accepted_by = v_uid
   where id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'role', v_inv.role,
    'account_id', v_account_id,
    'org_id', v_org_id
  );
end;
$$;

revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- Verification queries
-- ═══════════════════════════════════════════════════════════
-- select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and proname in ('change_membership_role', 'remove_membership', '_conflicting_account_for_email');
-- select tablename from pg_tables where schemaname='public' and tablename='membership_audit_log';
