-- ADR-0058 follow-up — surface explicit statuses on signup-intake.
--
-- Product decision (2026-04-21): the UX win of telling a visitor
-- "you're already a customer" on consentshield.in/signup outweighs
-- the existence-leak risk Sprint 1.1 protected against. The
-- marketing-side signup form already carries Turnstile + per-IP +
-- per-email rate limits; those are the enumeration ceiling now.
--
-- `create_signup_intake` gains explicit `branch` values and the Node
-- route surfaces them to the caller instead of collapsing to ok:true.
-- Branch values are a closed enum so the client can switch on them:
--
--   created              — fresh invite written; email dispatched
--   already_invited      — a valid pending invite exists for this email
--   existing_customer    — auth.users row with is_admin=false
--   admin_identity       — auth.users row with is_admin=true (Rule 12)
--   invalid_email        — shape check failed
--   invalid_plan         — plan_code missing or inactive
--
-- The `id` and `token` are returned ONLY for the `created` branch so
-- the caller can (optionally) re-dispatch synchronously.

create or replace function public.create_signup_intake(
  p_email      text,
  p_plan_code  text,
  p_org_name   text default null,
  p_ip         inet default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text;
  v_id    uuid;
  v_existing_user_id uuid;
  v_is_admin boolean;
  v_pending_id uuid;
begin
  -- 1. Plan validation.
  if p_plan_code is null or not exists (
    select 1 from public.plans
     where plan_code = p_plan_code and is_active = true
  ) then
    return jsonb_build_object('branch', 'invalid_plan');
  end if;

  -- 2. Email shape. Lax check.
  if length(v_email) < 5 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('branch', 'invalid_email');
  end if;

  -- 3. Existing user lookup (admin identity + already-customer).
  select id,
         coalesce((raw_app_meta_data->>'is_admin')::boolean, false)
    into v_existing_user_id, v_is_admin
    from auth.users
   where lower(email) = v_email
   limit 1;

  if v_existing_user_id is not null then
    if v_is_admin then
      return jsonb_build_object('branch', 'admin_identity');
    end if;
    return jsonb_build_object('branch', 'existing_customer');
  end if;

  -- 4. Pending-invitation lookup. If there's already a live intake
  -- for this email, return its id so the caller can decide whether
  -- to re-dispatch the existing email (via the dispatcher) rather
  -- than create a second row.
  select id into v_pending_id
    from public.invitations
   where invited_email = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
     and origin in ('marketing_intake', 'operator_intake')
   order by created_at desc
   limit 1;

  if v_pending_id is not null then
    return jsonb_build_object(
      'branch', 'already_invited',
      'id',     v_pending_id
    );
  end if;

  -- 5. Fresh email — insert intake invitation.
  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.invitations (
    token, invited_email, account_id, org_id, role,
    plan_code, default_org_name, origin,
    invited_by, expires_at
  ) values (
    v_token, v_email, null, null, 'account_owner',
    p_plan_code, nullif(trim(coalesce(p_org_name, '')), ''),
    'marketing_intake',
    null, now() + interval '14 days'
  )
  returning id into v_id;

  -- p_ip captured for audit; not persisted on the invitation row.
  perform p_ip;

  return jsonb_build_object(
    'branch', 'created',
    'id',     v_id,
    'token',  v_token
  );
end;
$$;

comment on function public.create_signup_intake(text, text, text, inet) is
  'ADR-0058: marketing-site intake. Returns explicit branch (product decision 2026-04-21; was ok-for-all).';
