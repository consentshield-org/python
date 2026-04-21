-- ADR-0058 Sprint 1.1 — create_signup_intake RPC.
--
-- Public marketing-site self-serve intake. Called by
-- /api/public/signup-intake (Node route, service-role auth) after
-- Turnstile + rate-limit pass.
--
-- Returns a generic {status:'ok'} regardless of which branch fires
-- (Rule 18 spirit — no existence leak; an attacker probing whether
-- an email is already registered learns nothing from response shape
-- or latency).
--
-- Branches:
--   1. plan_code invalid          → silent refuse, return ok
--   2. email malformed            → silent refuse, return ok
--   3. email belongs to admin user (Rule 12) → silent refuse, return ok
--   4. email already a customer   → silent refuse, return ok
--                                    (no invitation row; user can
--                                    use /login if they remember)
--   5. fresh email                → INSERT invitation with
--                                    origin='marketing_intake';
--                                    AFTER INSERT trigger dispatches
--                                    email; return ok.
--
-- The Node route logs branch outcomes server-side for operator
-- visibility but never echoes them to the client.

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
begin
  -- 1. Plan validation. Failure = silent refuse.
  if not exists (
    select 1 from public.plans
     where plan_code = p_plan_code and is_active = true
  ) then
    return jsonb_build_object('status', 'ok', 'branch', 'invalid_plan');
  end if;

  -- 2. Email shape. Lax check; full validation happens at OTP time.
  if length(v_email) < 5 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('status', 'ok', 'branch', 'invalid_email');
  end if;

  -- 3. + 4. Existing user lookup.
  select id,
         coalesce((raw_app_meta_data->>'is_admin')::boolean, false)
    into v_existing_user_id, v_is_admin
    from auth.users
   where lower(email) = v_email
   limit 1;

  if v_existing_user_id is not null then
    -- Either is_admin (Rule 12 — never let admin identities into the
    -- customer flow) or already a customer (no double-account, ADR-0047).
    -- Both branches collapse to the same outward response.
    return jsonb_build_object(
      'status', 'ok',
      'branch', case when v_is_admin then 'admin_identity_refused'
                     else 'existing_customer' end
    );
  end if;

  -- 5. Fresh email — insert intake invitation. The 14-day expiry
  -- matches the documented marketing-intake TTL (M6).
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

  -- p_ip is captured for audit / abuse review; not stored on the
  -- invitation row itself (the route handler can log it).
  perform p_ip;

  return jsonb_build_object('status', 'ok', 'branch', 'created');
end;
$$;

revoke execute on function public.create_signup_intake(text, text, text, inet) from public;
revoke execute on function public.create_signup_intake(text, text, text, inet) from authenticated;
revoke execute on function public.create_signup_intake(text, text, text, inet) from anon;
grant execute on function public.create_signup_intake(text, text, text, inet) to cs_orchestrator;
grant execute on function public.create_signup_intake(text, text, text, inet) to service_role;

comment on function public.create_signup_intake(text, text, text, inet) is
  'ADR-0058: marketing-site self-serve intake. Returns generic ok regardless of branch. Service-role only.';
