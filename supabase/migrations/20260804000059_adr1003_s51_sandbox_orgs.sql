-- ADR-1003 Sprint 5.1 — sandbox org provisioning (G-046), round 1 of 3.
-- (c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com
--
-- Scope this round:
--   (1) New column public.organisations.sandbox boolean default false.
--   (2) public.is_sandbox_org(uuid) helper — SECURITY DEFINER (cs_api /
--       cs_orchestrator / cs_delivery / cs_admin have no USAGE on the
--       auth schema; plain-SQL functions that read public.organisations
--       would trigger the RLS policy whose current_org_id() transitively
--       touches auth. See migration 57 for precedent.).
--   (3) public.rpc_provision_sandbox_org(p_name text,
--           p_template_code text default null) — authenticated caller
--       RPC. Creates an org under the caller's account with
--       sandbox=true, adds the caller as org_admin + adds the account-
--       level account_owner role where missing, applies an optional
--       sectoral template (honouring the ADR-1003 Sprint 4.1 storage-
--       mode gate), and returns {org_id, account_id, template_applied?,
--       storage_mode?}. Does not create billing rows.
--   (4) public.rpc_api_key_create — re-published with a sandbox branch:
--       when the target org has sandbox=true, the plaintext key gains a
--       `cs_test_` prefix (not `cs_live_`) and rate_tier is forced to
--       'sandbox' regardless of the argument. The `sandbox` rate_tier
--       enum label was seeded back in ADR-1001 Sprint 2.1 (20260520);
--       the plan-tier TIER_LIMITS map already carries it.
--
-- Design note — flag placement.
--
-- The original Sprint 5.1 spec said `accounts.sandbox boolean default
-- false`. That reading pre-dated full reconciliation with ADR-0047's
-- single-account-per-identity invariant: a user can only be in one
-- account, so a separate sandbox account is not a valid path. Moving
-- the flag to `organisations` keeps a user's one account and lets
-- sandbox + prod orgs coexist under it — the Stripe/Razorpay pattern
-- (live vs test mode on the same account). The ADR's Sprint 5.1 spec +
-- Architecture Changes block are amended in the same commit to match.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Column
-- ─────────────────────────────────────────────────────────────────────

alter table public.organisations
  add column if not exists sandbox boolean not null default false;

comment on column public.organisations.sandbox is
  'ADR-1003 Sprint 5.1. When true: this org is a sandbox. Sandbox orgs '
  'do not count against account plan limits, issue cs_test_* API keys '
  'with rate_tier=''sandbox'', are excluded from cross-customer metrics '
  '(compliance scores, aggregates), and their exports carry a sandbox=true '
  'manifest marker. A user''s single account can hold a mix of prod and '
  'sandbox orgs (see ADR-0047 single-account-per-identity).';

create index if not exists organisations_sandbox_idx
  on public.organisations (sandbox)
  where sandbox = true;

-- ─────────────────────────────────────────────────────────────────────
-- 2. public.is_sandbox_org(uuid)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.is_sandbox_org(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(sandbox, false)
    from public.organisations
   where id = p_org_id
$$;

comment on function public.is_sandbox_org(uuid) is
  'ADR-1003 Sprint 5.1. Resolves the sandbox flag of an org. '
  'SECURITY DEFINER so scoped roles can call without tripping the '
  'organisations RLS policy that transitively references schema auth '
  '(see migration 57 for the same pattern on get_storage_mode). '
  'Returns false when the org is missing.';

grant execute on function public.is_sandbox_org(uuid)
  to cs_api, cs_orchestrator, cs_delivery, cs_admin;

-- ─────────────────────────────────────────────────────────────────────
-- 3. public.rpc_provision_sandbox_org
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.rpc_provision_sandbox_org(
  p_name          text,
  p_template_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid          uuid  := public.current_uid();
  v_account_id   uuid;
  v_org_id       uuid;
  v_applied      jsonb := null;
  v_storage_mode text  := 'standard';
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  if length(trim(p_name)) > 120 then
    raise exception 'name_too_long' using errcode = '22023';
  end if;

  -- Caller must be account_owner of exactly one account. Single-
  -- account-per-identity (ADR-0047) means there's at most one anyway.
  select am.account_id into v_account_id
    from public.account_memberships am
   where am.user_id = v_uid
     and am.status = 'active'
     and am.role = 'account_owner'
   limit 1;

  if v_account_id is null then
    raise exception 'not_an_account_owner' using errcode = '42501';
  end if;

  -- Create the sandbox org. No plan-gate (sandbox orgs are free and
  -- uncapped by ADR-1003 Sprint 5.1 design). Name gets a ' (sandbox)'
  -- suffix unless the caller already tagged it, so the UI list can
  -- separate prod from sandbox orgs at a glance.
  insert into public.organisations (name, account_id, sandbox, storage_mode)
    values (
      case when position('(sandbox)' in lower(p_name)) > 0
           then trim(p_name)
           else trim(p_name) || ' (sandbox)'
      end,
      v_account_id,
      true,
      'standard'
    )
    returning id into v_org_id;

  -- Caller becomes org_admin of the new sandbox org.
  insert into public.org_memberships (org_id, user_id, role)
    values (v_org_id, v_uid, 'org_admin');

  -- Optional: apply the requested sectoral template. Goes through
  -- public.apply_sectoral_template which honours the Sprint 4.1
  -- storage-mode gate. If the template demands zero_storage and this
  -- fresh org is 'standard', the apply will raise P0004 — we let that
  -- propagate so the caller can re-provision with storage_mode
  -- pre-switched (operator action).
  if p_template_code is not null and length(trim(p_template_code)) > 0 then
    -- public.apply_sectoral_template reads current_org_id() from the
    -- caller's JWT, but the freshly-minted org isn't on that JWT yet
    -- (the session was issued against the previous org or none).
    -- public.apply_sectoral_template_for_org accepts an explicit
    -- p_org_id and is otherwise structurally identical — same Sprint
    -- 4.1 storage-mode gate.
    perform public.apply_sectoral_template_for_org(
      v_org_id,
      trim(p_template_code)
    );

    select jsonb_build_object(
        'code',         t.template_code,
        'version',      t.version,
        'display_name', t.display_name
      )
      into v_applied
      from admin.sectoral_templates t
     where t.template_code = trim(p_template_code)
       and t.status = 'published'
     order by t.version desc
     limit 1;

    select coalesce(storage_mode, 'standard') into v_storage_mode
      from public.organisations where id = v_org_id;
  end if;

  -- Audit trail. audit_log is a buffer-like table (org-scoped) — insert
  -- is safe for the freshly-minted org_id.
  insert into public.audit_log (org_id, actor_id, event_type, entity_type, entity_id, payload)
    values (
      v_org_id,
      v_uid,
      'sandbox_org.provisioned',
      'organisation',
      v_org_id,
      jsonb_build_object(
        'template_code', p_template_code,
        'storage_mode',  v_storage_mode
      )
    );

  return jsonb_build_object(
    'ok',               true,
    'org_id',           v_org_id,
    'account_id',       v_account_id,
    'sandbox',          true,
    'template_applied', v_applied,
    'storage_mode',     v_storage_mode
  );
end;
$$;

revoke all on function public.rpc_provision_sandbox_org(text, text) from public;
grant execute on function public.rpc_provision_sandbox_org(text, text) to authenticated;

comment on function public.rpc_provision_sandbox_org(text, text) is
  'ADR-1003 Sprint 5.1. Authenticated account_owner creates a sandbox '
  'org under their account. Optionally applies a sectoral template. '
  'Sandbox orgs are free (no billing), capped at the sandbox rate tier, '
  'and excluded from cross-customer metrics.';

-- ─────────────────────────────────────────────────────────────────────
-- 3a. helper: public.apply_sectoral_template_for_org
-- ─────────────────────────────────────────────────────────────────────
-- The existing public.apply_sectoral_template reads current_org_id()
-- from the caller's JWT; the freshly-provisioned sandbox org isn't on
-- the JWT yet (the session was issued against the previous org). This
-- helper accepts an explicit p_org_id and is otherwise structurally
-- identical — same pre-flight storage_mode gate, same materialisation
-- loop, same return shape. Not granted to authenticated (it bypasses
-- the JWT-org check); only callers that have already validated the
-- target org (rpc_provision_sandbox_org) invoke it.

create or replace function public.apply_sectoral_template_for_org(
  p_org_id        uuid,
  p_template_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_template     admin.sectoral_templates%rowtype;
  v_org_mode     text;
  v_purpose      jsonb;
  v_materialised int := 0;
begin
  select * into v_template
    from admin.sectoral_templates
   where template_code = p_template_code
     and status = 'published'
   order by version desc
   limit 1;

  if v_template.id is null then
    raise exception 'no published template with code %', p_template_code;
  end if;

  if v_template.default_storage_mode is not null then
    select coalesce(storage_mode, 'standard') into v_org_mode
      from public.organisations where id = p_org_id;
    if v_org_mode is distinct from v_template.default_storage_mode then
      raise exception
        'template % requires storage_mode=% but this org is %; flip storage mode first',
        v_template.template_code,
        v_template.default_storage_mode,
        v_org_mode
        using errcode = 'P0004';
    end if;
  end if;

  update public.organisations
     set settings = coalesce(settings, '{}'::jsonb)
       || jsonb_build_object(
            'sectoral_template',
            jsonb_build_object(
              'code', v_template.template_code,
              'version', v_template.version,
              'applied_at', now(),
              'applied_by', public.current_uid()
            )
          )
   where id = p_org_id;

  for v_purpose in
    select * from jsonb_array_elements(coalesce(v_template.purpose_definitions, '[]'::jsonb))
  loop
    if v_purpose->>'purpose_code' is null or (v_purpose->>'purpose_code') = '' then
      continue;
    end if;

    insert into public.purpose_definitions (
      org_id, purpose_code, display_name, description,
      data_scope, default_expiry_days, auto_delete_on_expiry,
      framework, is_active
    ) values (
      p_org_id,
      v_purpose->>'purpose_code',
      coalesce(v_purpose->>'display_name', v_purpose->>'purpose_code'),
      coalesce(v_purpose->>'description', ''),
      coalesce(
        (select array_agg(x) from jsonb_array_elements_text(
          coalesce(v_purpose->'data_scope', '[]'::jsonb)
        ) x),
        '{}'::text[]
      ),
      coalesce((v_purpose->>'default_expiry_days')::int, 365),
      coalesce((v_purpose->>'auto_delete_on_expiry')::boolean, false),
      coalesce(v_purpose->>'framework', 'dpdp'),
      true
    )
    on conflict (org_id, purpose_code, framework) do update set
      display_name          = excluded.display_name,
      description           = excluded.description,
      data_scope            = excluded.data_scope,
      default_expiry_days   = excluded.default_expiry_days,
      auto_delete_on_expiry = excluded.auto_delete_on_expiry,
      is_active             = true,
      updated_at            = now();

    v_materialised := v_materialised + 1;
  end loop;

  return jsonb_build_object(
    'code',               v_template.template_code,
    'version',            v_template.version,
    'materialised_count', v_materialised,
    'storage_mode',       v_template.default_storage_mode
  );
end;
$$;

comment on function public.apply_sectoral_template_for_org(uuid, text) is
  'ADR-1003 Sprint 5.1. Sibling of public.apply_sectoral_template that '
  'takes an explicit org_id instead of reading current_org_id() from '
  'the JWT. Used by rpc_provision_sandbox_org to apply a template to '
  'a freshly-created org before the caller refreshes their session. '
  'Same storage-mode gate (Sprint 4.1) applies.';

-- No grant to authenticated — only rpc_provision_sandbox_org (the
-- validated caller) invokes this. The owner (postgres, via SECURITY
-- DEFINER) has EXECUTE inherently.

-- ─────────────────────────────────────────────────────────────────────
-- 4. Update public.rpc_api_key_create — cs_test_ + sandbox rate_tier
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.rpc_api_key_create(
  p_account_id uuid,
  p_org_id     uuid,
  p_scopes     text[],
  p_rate_tier  text,
  p_name       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid          uuid := public.current_uid();
  v_plaintext    text;
  v_prefix       text;
  v_hash         text;
  v_key_id       uuid;
  v_caller_role  text;
  v_is_sandbox   boolean := false;
  v_final_tier   text    := p_rate_tier;
  v_key_ns       text    := 'cs_live_';
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Caller must be account_owner of the target account OR org_admin of
  -- the target org (if org-scoped) AND the org belongs to the claimed
  -- account. Identical to the 20260520 original — unchanged.
  select am.role into v_caller_role
    from public.account_memberships am
   where am.account_id = p_account_id
     and am.user_id = v_uid
     and am.status = 'active';

  if v_caller_role not in ('account_owner') then
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

  -- ADR-1003 Sprint 5.1: sandbox-org branch. When target org is
  -- sandbox=true, force rate_tier='sandbox' and swap the plaintext
  -- prefix to cs_test_. Never accept a live rate_tier on a sandbox
  -- org — the DB is the authority, not the caller argument.
  -- Account-scoped keys (p_org_id is null) cannot be sandbox by
  -- design; the live-vs-test distinction needs an org.
  if p_org_id is not null then
    select coalesce(sandbox, false) into v_is_sandbox
      from public.organisations where id = p_org_id;

    if v_is_sandbox then
      v_final_tier := 'sandbox';
      v_key_ns     := 'cs_test_';
    else
      -- Explicit refusal: the caller asked for sandbox rate tier on a
      -- non-sandbox org. That would create a cs_live_ key with the
      -- sandbox rate limit, which has no legitimate use. Raise.
      if p_rate_tier = 'sandbox' then
        raise exception 'sandbox rate_tier requires a sandbox org'
          using errcode = '22023';
      end if;
    end if;
  else
    if p_rate_tier = 'sandbox' then
      raise exception 'sandbox rate_tier requires a sandbox org'
        using errcode = '22023';
    end if;
  end if;

  -- Generate 32 random bytes → base64url → prefix with cs_live_ or cs_test_
  v_plaintext := v_key_ns || translate(
    encode(extensions.gen_random_bytes(32), 'base64'),
    '+/=', '-_'
  );
  v_prefix := substring(v_plaintext from 1 for 16);  -- cs_live_XXXXXXXX or cs_test_XXXXXXXX

  v_hash := encode(extensions.digest(v_plaintext, 'sha256'), 'hex');

  insert into public.api_keys (
    account_id, org_id, key_hash, key_prefix, name, scopes, rate_tier,
    created_by
  ) values (
    p_account_id, p_org_id, v_hash, v_prefix, p_name, p_scopes, v_final_tier,
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
        'name',      p_name,
        'scopes',    p_scopes,
        'rate_tier', v_final_tier,
        'sandbox',   v_is_sandbox
      )
    );

  return jsonb_build_object(
    'id',         v_key_id,
    'plaintext',  v_plaintext,
    'prefix',     v_prefix,
    'scopes',     to_jsonb(p_scopes),
    'rate_tier',  v_final_tier,
    'sandbox',    v_is_sandbox
  );
end;
$$;

-- Grants are preserved by CREATE OR REPLACE.

comment on function public.rpc_api_key_create(uuid, uuid, text[], text, text) is
  'ADR-1001 Sprint 2.1, amended ADR-1003 Sprint 5.1 (2026-04-25): '
  'creates an API key under the caller''s account/org. When the target '
  'org has sandbox=true, the plaintext gets a cs_test_ prefix and '
  'rate_tier is forced to ''sandbox''. Raises when the caller requests '
  'sandbox rate_tier on a non-sandbox org (or account-scoped key).';

-- Verification (run manually after db push):
--   -- Column + index present:
--     \d+ public.organisations            -- should list `sandbox` with default false + index organisations_sandbox_idx.
--
--   -- Sandbox provisioning (as account_owner):
--     select public.rpc_provision_sandbox_org('My Test', null);
--     -- expected: {ok:true, org_id:<uuid>, account_id:<uuid>, sandbox:true, template_applied:null, storage_mode:'standard'}
--
--   -- Sandbox API key (as org_admin of the freshly-provisioned org):
--     select public.rpc_api_key_create(<account_id>, <sandbox_org_id>, '{"read:consent"}'::text[], 'starter', 'test-key');
--     -- expected: plaintext starts with 'cs_test_', rate_tier='sandbox', sandbox=true
