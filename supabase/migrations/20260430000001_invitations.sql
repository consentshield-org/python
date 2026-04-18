-- ADR-0044 Phase 2.1 — Invitation flow: schema + create/accept RPCs.
--
-- Five invite shapes, all in one table, discriminated by role +
-- presence of account_id / org_id / plan_code:
--
--   role                | account_id | org_id | plan_code | notes
--   --------------------|------------|--------|-----------|--------------------------------------
--   account_owner       | null       | null   | set       | creates a brand-new account + first org
--   account_owner       | set        | null   | null      | adds another account_owner to existing acct
--   account_viewer      | set        | null   | null      | adds cross-org read-only user
--   org_admin           | set        | set    | null      | promotes/adds org_admin of a specific org
--   admin | viewer      | set        | set    | null      | adds operational or read-only org member
--
-- Gates:
--   create_invitation
--     - account_owner (new account)  → admin-JWT only (marketing site
--                                      or operator-console via internal endpoint)
--     - account_owner (existing)     → account_owner of target account
--     - account_viewer               → account_owner of target account
--     - org_admin                    → account_owner of target account
--     - admin / viewer               → account_owner OR org_admin of target org
--
--   accept_invitation — invitee's auth email must match invited_email
--   (lower-cased compare). New account+org is created atomically when
--   the invite is of the "new account" shape.
--
-- Tokens are 32 random hex chars, one-shot.

-- ═══════════════════════════════════════════════════════════
-- 1/5 · public.invitations
-- ═══════════════════════════════════════════════════════════

create table if not exists public.invitations (
  id                 uuid         primary key default gen_random_uuid(),
  token              text         not null unique,
  invited_email      text         not null check (length(invited_email) between 3 and 320),
  account_id         uuid         references public.accounts(id) on delete cascade,
  org_id             uuid         references public.organisations(id) on delete cascade,
  role               text         not null check (
                       role in ('account_owner','account_viewer','org_admin','admin','viewer')
                     ),
  plan_code          text         references public.plans(plan_code),
  trial_days         int          check (trial_days is null or (trial_days >= 0 and trial_days <= 365)),
  default_org_name   text,
  invited_by         uuid         references auth.users(id) on delete set null,
  created_at         timestamptz  not null default now(),
  expires_at         timestamptz  not null default (now() + interval '14 days'),
  accepted_at        timestamptz,
  accepted_by        uuid         references auth.users(id) on delete set null,
  constraint invitations_shape check (
    -- Account-creating invite: role=account_owner, no account_id, plan_code set.
    (role = 'account_owner' and account_id is null and org_id is null and plan_code is not null)
    -- Add account_owner to existing account.
    or (role = 'account_owner' and account_id is not null and org_id is null)
    -- Account-level viewer.
    or (role = 'account_viewer' and account_id is not null and org_id is null)
    -- Org-level roles.
    or (role in ('org_admin','admin','viewer') and account_id is not null and org_id is not null)
  )
);

-- One pending invite per (email, scope). Scope is (account_id, org_id) with NULLs
-- distinguished via coalesce to sentinel uuids.
create unique index if not exists invitations_pending_uniq
  on public.invitations (
    lower(invited_email),
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where accepted_at is null;

create index if not exists invitations_email_idx on public.invitations (lower(invited_email)) where accepted_at is null;
create index if not exists invitations_account_idx on public.invitations (account_id) where accepted_at is null and account_id is not null;
create index if not exists invitations_org_idx on public.invitations (org_id) where accepted_at is null and org_id is not null;

alter table public.invitations enable row level security;

-- The invitee can read their own pending invite (for the /signup page
-- to display "You've been invited to…"). Lookup is by token, which is
-- unguessable, so we allow anon read by token only.
drop policy if exists invitations_read_by_token on public.invitations;
create policy invitations_read_by_token on public.invitations
  for select to anon, authenticated
  using (false);  -- No direct select; callers go through the RPC below.

-- Admins can read all.
drop policy if exists admins_select_all on public.invitations;
create policy admins_select_all on public.invitations
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean = true);

revoke insert, update, delete on public.invitations from authenticated, anon;
grant select, insert, update, delete on public.invitations to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 2/5 · public.invitation_preview(token) — read-only public RPC for /signup
-- ═══════════════════════════════════════════════════════════

create or replace function public.invitation_preview(p_token text)
returns table (
  invited_email text,
  role text,
  account_id uuid,
  org_id uuid,
  plan_code text,
  default_org_name text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select i.invited_email, i.role, i.account_id, i.org_id,
         i.plan_code, i.default_org_name, i.expires_at, i.accepted_at
    from public.invitations i
   where i.token = p_token
   limit 1
$$;

grant execute on function public.invitation_preview(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 3/5 · public.create_invitation(...)
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

  -- ────────────────────────────────────────────────────────────
  -- Authorisation gates
  -- ────────────────────────────────────────────────────────────

  -- account-creating invite: admin JWT only.
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

  -- add-to-existing-account invites (account_owner, account_viewer).
  if p_role in ('account_owner','account_viewer') and p_account_id is not null then
    select am.role into v_account_role
      from public.account_memberships am
     where am.user_id = v_uid and am.account_id = p_account_id;
    if coalesce(v_account_role, '') <> 'account_owner' and not v_is_admin_jwt then
      raise exception 'account_owner role required' using errcode = '42501';
    end if;
  end if;

  -- org-level invites.
  if p_role in ('org_admin','admin','viewer') then
    if p_org_id is null or p_account_id is null then
      raise exception 'org-level invites require p_org_id and p_account_id' using errcode = '22023';
    end if;
    -- Verify org belongs to the given account (prevents cross-account leaks).
    if not exists (
      select 1 from public.organisations o
       where o.id = p_org_id and o.account_id = p_account_id
    ) then
      raise exception 'org % does not belong to account %', p_org_id, p_account_id
        using errcode = '22023';
    end if;

    if v_is_admin_jwt then
      null; -- admin JWT bypasses
    elsif p_role = 'org_admin' then
      -- Only account_owner can invite/create org_admins.
      select am.role into v_account_role
        from public.account_memberships am
       where am.user_id = v_uid and am.account_id = p_account_id;
      if coalesce(v_account_role, '') <> 'account_owner' then
        raise exception 'account_owner role required to invite org_admin' using errcode = '42501';
      end if;
    else
      -- admin / viewer invites: account_owner OR org_admin of this org.
      v_org_effective_role := public.effective_org_role(p_org_id);
      if coalesce(v_org_effective_role, '') <> 'org_admin' then
        raise exception 'org_admin (or account_owner) role required'
          using errcode = '42501';
      end if;
    end if;
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

grant execute on function public.create_invitation(text, text, uuid, uuid, text, int, text, int) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 4/5 · public.accept_invitation(token)
-- ═══════════════════════════════════════════════════════════

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := public.current_uid();
  v_email text;
  v_inv record;
  v_account_id uuid;
  v_org_id uuid;
  v_org_name text;
  v_trial_days int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Fetch invite.
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

  -- Email match check.
  select email into v_email from auth.users where id = v_uid;
  if lower(coalesce(v_email,'')) <> lower(v_inv.invited_email) then
    raise exception 'invitation email does not match authenticated user'
      using errcode = '42501';
  end if;

  -- Branch by role.
  if v_inv.role = 'account_owner' and v_inv.account_id is null then
    -- Create a brand-new account + first org.
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
    -- Add to existing account.
    v_account_id := v_inv.account_id;
    insert into public.account_memberships (account_id, user_id, role, invited_by, invited_at, accepted_at)
    values (v_account_id, v_uid, v_inv.role, v_inv.invited_by, v_inv.created_at, now())
    on conflict (account_id, user_id) do update
      set role = excluded.role, status = 'active';

  else
    -- Org-level role.
    v_account_id := v_inv.account_id;
    v_org_id := v_inv.org_id;
    insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, v_inv.role)
    on conflict (org_id, user_id) do update
      set role = excluded.role;
  end if;

  -- Stamp invite as accepted.
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

grant execute on function public.accept_invitation(text) to authenticated;

-- ═══════════════════════════════════════════════════════════
-- 5/5 · Verification
-- ═══════════════════════════════════════════════════════════
-- select count(*) from public.invitations; -- starts at 0
-- select pg_get_functiondef('public.create_invitation(text,text,uuid,uuid,text,int,text,int)'::regprocedure);
-- select pg_get_functiondef('public.accept_invitation(text)'::regprocedure);
