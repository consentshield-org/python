-- ADR-0058 Sprint 1.1 — admin.create_operator_intake RPC.
--
-- Operator-initiated intake for contracted customers. Same row shape as
-- create_signup_intake (account_id=null, org_id=null, plan_code=set,
-- default_org_name=set) but distinguished by origin='operator_intake'.
--
-- Unlike the public intake RPC, this one ERRORS loudly on bad inputs —
-- the caller is an admin who needs feedback, not an anonymous visitor
-- who must not learn anything.
--
-- Gates:
--   · admin.require_admin('platform_operator') — minimum role
--   · plan_code must exist + is_active
--   · target email must not already belong to an admin user (Rule 12)
--   · target email must not already belong to a customer (ADR-0047
--     single-account-per-identity)
--
-- Emits the same dispatch trigger → email → /onboarding?token=
-- pipeline as marketing intakes.

create or replace function admin.create_operator_intake(
  p_email      text,
  p_plan_code  text,
  p_org_name   text default null
) returns table (id uuid, token text)
language plpgsql
security definer
set search_path = admin, public, pg_catalog, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_id    uuid;
  v_existing_user_id uuid;
  v_is_admin boolean;
begin
  perform admin.require_admin('platform_operator');

  if length(v_email) < 5 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.plans
     where plan_code = p_plan_code and is_active = true
  ) then
    raise exception 'plan_code % is not active', p_plan_code using errcode = '22023';
  end if;

  select u.id,
         coalesce((u.raw_app_meta_data->>'is_admin')::boolean, false)
    into v_existing_user_id, v_is_admin
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  if v_existing_user_id is not null then
    if v_is_admin then
      raise exception
        'cannot intake email %: target is an admin identity (Rule 12)', v_email
        using errcode = '23514';
    else
      raise exception
        'cannot intake email %: target already has a customer account (ADR-0047)', v_email
        using errcode = '23505';
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (
    token, invited_email, account_id, org_id, role,
    plan_code, default_org_name, origin,
    invited_by, expires_at
  ) values (
    v_token, v_email, null, null, 'account_owner',
    p_plan_code, nullif(trim(coalesce(p_org_name, '')), ''),
    'operator_intake',
    auth.uid(), now() + interval '14 days'
  )
  returning public.invitations.id into v_id;

  return query select v_id, v_token;
end;
$$;

revoke execute on function admin.create_operator_intake(text, text, text) from public;
revoke execute on function admin.create_operator_intake(text, text, text) from anon;
grant execute on function admin.create_operator_intake(text, text, text) to authenticated;
-- The internal admin.require_admin() check inside the function is the
-- effective gate; granting to authenticated is fine because non-admins
-- get an exception immediately.

comment on function admin.create_operator_intake(text, text, text) is
  'ADR-0058: operator-initiated intake for contracted customers. Errors loudly on bad input (caller is an admin).';
