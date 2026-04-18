-- ADR-0050 Sprint 2.1 chunk 2 — billing.issuer_entities.
--
-- The legal entity that issues invoices. A runtime-configurable value,
-- not a code constant — ConsentShield may be marketed/serviced by a
-- different entity (LLP / servicing company) than the one building the
-- software, and the invoicing entity can change over time.
--
-- Identity fields (legal_name, gstin, pan, registered_state_code,
-- invoice_prefix, fy_start_month) are immutable once set. Changing any
-- of them forces retire + create — a new issuer row with new identity.
-- Invoices before the retire keep their original issuer linkage via the
-- FK from public.invoices (lands in chunk 3); the FK will be
-- `on delete restrict`, so retired-but-referenced issuers cannot be
-- hard-deleted.
--
-- Write access is restricted to `platform_owner` (seeded in migration
-- 20260507000004). Read access is `platform_operator+` — operators need
-- to know which issuer is currently live to reason about invoices they
-- issue, but they cannot mutate the issuer identity.
--
-- RPCs landing here:
--   READ   (platform_operator+)   list · detail
--   WRITE  (platform_owner only)  create · update · activate · retire · hard_delete

-- ═══════════════════════════════════════════════════════════
-- 1 · billing schema
-- ═══════════════════════════════════════════════════════════

create schema if not exists billing;

grant usage on schema billing to cs_admin;
-- cs_orchestrator needs INSERT on billing.razorpay_webhook_events (chunk 3);
-- grant usage now so that follow-up migration works. Narrow table grants
-- still gate individual access.
grant usage on schema billing to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 2 · billing.issuer_entities
-- ═══════════════════════════════════════════════════════════

create table if not exists billing.issuer_entities (
  id                      uuid         primary key default gen_random_uuid(),
  legal_name              text         not null check (length(legal_name) between 1 and 200),
  gstin                   text         not null check (length(gstin) = 15),
  pan                     text         not null check (length(pan) = 10),
  registered_state_code   text         not null check (length(registered_state_code) between 2 and 4),
  registered_address      text         not null check (length(registered_address) between 1 and 500),
  invoice_prefix          text         not null check (length(invoice_prefix) between 1 and 10),
  fy_start_month          smallint     not null default 4 check (fy_start_month between 1 and 12),
  logo_r2_key             text,
  signatory_name          text         not null check (length(signatory_name) between 1 and 200),
  signatory_designation   text,
  bank_account_masked     text         check (bank_account_masked is null or length(bank_account_masked) between 4 and 50),
  is_active               boolean      not null default false,
  activated_at            timestamptz,
  retired_at              timestamptz,
  retired_reason          text,
  created_at              timestamptz  not null default now(),
  created_by              uuid,
  updated_at              timestamptz  not null default now()
);

-- At-most-one-active: partial unique index on (is_active=true).
create unique index if not exists issuer_entities_single_active_idx
  on billing.issuer_entities ((true))
  where is_active = true;

-- GSTIN is unique across all issuers (one GSTIN = one legal entity).
create unique index if not exists issuer_entities_gstin_uniq
  on billing.issuer_entities (gstin);

alter table billing.issuer_entities enable row level security;

-- No direct-access policies. All reads/writes go through the RPCs below,
-- which are SECURITY DEFINER and run with postgres privilege. cs_admin
-- gets a SELECT grant so that any future non-security-definer read path
-- (none today) would still be denied by RLS — the grant is a belt.
grant select on billing.issuer_entities to cs_admin;

-- ═══════════════════════════════════════════════════════════
-- 3 · Identity-field immutability trigger
-- ═══════════════════════════════════════════════════════════

create or replace function billing.issuer_entities_immutable_identity()
returns trigger
language plpgsql
as $$
begin
  if NEW.legal_name is distinct from OLD.legal_name then
    raise exception
      'Immutable field `legal_name` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  if NEW.gstin is distinct from OLD.gstin then
    raise exception
      'Immutable field `gstin` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  if NEW.pan is distinct from OLD.pan then
    raise exception
      'Immutable field `pan` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  if NEW.registered_state_code is distinct from OLD.registered_state_code then
    raise exception
      'Immutable field `registered_state_code` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  if NEW.invoice_prefix is distinct from OLD.invoice_prefix then
    raise exception
      'Immutable field `invoice_prefix` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  if NEW.fy_start_month is distinct from OLD.fy_start_month then
    raise exception
      'Immutable field `fy_start_month` — retire the current issuer and create a new one to change identity'
      using errcode = '42501';
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists issuer_entities_immutable_identity on billing.issuer_entities;
create trigger issuer_entities_immutable_identity
  before update on billing.issuer_entities
  for each row execute function billing.issuer_entities_immutable_identity();

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.billing_issuer_list — platform_operator+ read
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_issuer_list()
returns table (
  id                      uuid,
  legal_name              text,
  gstin                   text,
  pan                     text,
  registered_state_code   text,
  registered_address      text,
  invoice_prefix          text,
  fy_start_month          smallint,
  logo_r2_key             text,
  signatory_name          text,
  signatory_designation   text,
  bank_account_masked     text,
  is_active               boolean,
  activated_at            timestamptz,
  retired_at              timestamptz,
  retired_reason          text,
  created_at              timestamptz,
  updated_at              timestamptz
)
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
begin
  perform admin.require_admin('platform_operator');

  return query
  select e.id, e.legal_name, e.gstin, e.pan, e.registered_state_code,
         e.registered_address, e.invoice_prefix, e.fy_start_month,
         e.logo_r2_key, e.signatory_name, e.signatory_designation,
         e.bank_account_masked, e.is_active, e.activated_at,
         e.retired_at, e.retired_reason, e.created_at, e.updated_at
    from billing.issuer_entities e
   order by
     e.is_active desc,      -- active first
     e.retired_at asc nulls first,  -- then by retirement order
     e.created_at desc;
end;
$$;

grant execute on function admin.billing_issuer_list() to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 5 · admin.billing_issuer_detail — platform_operator+ read
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_issuer_detail(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_row billing.issuer_entities%rowtype;
  v_envelope jsonb;
begin
  perform admin.require_admin('platform_operator');

  select * into v_row from billing.issuer_entities where id = p_id;
  if not found then
    raise exception 'Issuer % not found', p_id using errcode = 'P0002';
  end if;

  -- invoice_count placeholder — chunk 3 will join against public.invoices.
  v_envelope := jsonb_build_object(
    'issuer', jsonb_build_object(
      'id',                    v_row.id,
      'legal_name',            v_row.legal_name,
      'gstin',                 v_row.gstin,
      'pan',                   v_row.pan,
      'registered_state_code', v_row.registered_state_code,
      'registered_address',    v_row.registered_address,
      'invoice_prefix',        v_row.invoice_prefix,
      'fy_start_month',        v_row.fy_start_month,
      'logo_r2_key',           v_row.logo_r2_key,
      'signatory_name',        v_row.signatory_name,
      'signatory_designation', v_row.signatory_designation,
      'bank_account_masked',   v_row.bank_account_masked,
      'is_active',             v_row.is_active,
      'activated_at',          v_row.activated_at,
      'retired_at',            v_row.retired_at,
      'retired_reason',        v_row.retired_reason,
      'created_at',            v_row.created_at,
      'updated_at',            v_row.updated_at
    ),
    'invoice_count', 0
  );

  return v_envelope;
end;
$$;

grant execute on function admin.billing_issuer_detail(uuid) to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 6 · admin.billing_issuer_create — platform_owner only
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_issuer_create(
  p_legal_name            text,
  p_gstin                 text,
  p_pan                   text,
  p_registered_state_code text,
  p_registered_address    text,
  p_invoice_prefix        text,
  p_fy_start_month        smallint,
  p_signatory_name        text,
  p_signatory_designation text,
  p_bank_account_masked   text,
  p_logo_r2_key           text
)
returns uuid
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_id uuid;
begin
  perform admin.require_admin('platform_owner');

  -- Required-field checks beyond column-level CHECKs so the error is
  -- clear to the operator UI rather than a generic constraint violation.
  if length(coalesce(p_legal_name, '')) < 1 then
    raise exception 'legal_name required';
  end if;
  if coalesce(length(p_gstin), 0) <> 15 then
    raise exception 'gstin must be 15 characters';
  end if;
  if coalesce(length(p_pan), 0) <> 10 then
    raise exception 'pan must be 10 characters';
  end if;
  if length(coalesce(p_registered_state_code, '')) between 2 and 4 is not true then
    raise exception 'registered_state_code must be 2–4 characters';
  end if;
  if length(coalesce(p_registered_address, '')) < 1 then
    raise exception 'registered_address required';
  end if;
  if length(coalesce(p_invoice_prefix, '')) between 1 and 10 is not true then
    raise exception 'invoice_prefix must be 1–10 characters';
  end if;
  if p_fy_start_month is null or p_fy_start_month not between 1 and 12 then
    raise exception 'fy_start_month must be between 1 and 12';
  end if;
  if length(coalesce(p_signatory_name, '')) < 1 then
    raise exception 'signatory_name required';
  end if;

  insert into billing.issuer_entities (
    legal_name, gstin, pan, registered_state_code, registered_address,
    invoice_prefix, fy_start_month, signatory_name, signatory_designation,
    bank_account_masked, logo_r2_key, is_active, created_by
  ) values (
    p_legal_name, p_gstin, p_pan, p_registered_state_code, p_registered_address,
    p_invoice_prefix, p_fy_start_month, p_signatory_name, p_signatory_designation,
    p_bank_account_masked, p_logo_r2_key, false, v_operator
  )
  returning id into v_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issuer_create', 'billing.issuer_entities', v_id, null,
     null,
     jsonb_build_object(
       'legal_name', p_legal_name,
       'gstin', p_gstin,
       'pan', p_pan,
       'registered_state_code', p_registered_state_code,
       'invoice_prefix', p_invoice_prefix,
       'fy_start_month', p_fy_start_month
     ),
     'issuer entity created');

  return v_id;
end;
$$;

grant execute on function admin.billing_issuer_create(text, text, text, text, text, text, smallint, text, text, text, text)
  to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 7 · admin.billing_issuer_update — platform_owner only; mutable-field allow-list
-- ═══════════════════════════════════════════════════════════
-- Accepts a JSONB patch; any key outside the mutable allow-list raises.
-- The DB-level immutability trigger is the last line of defence — this
-- RPC gives the operator a clear error *before* the trigger fires.

create or replace function admin.billing_issuer_update(
  p_id    uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row billing.issuer_entities%rowtype;
  v_mutable constant text[] := array[
    'registered_address',
    'logo_r2_key',
    'signatory_name',
    'signatory_designation',
    'bank_account_masked'
  ];
  v_immutable constant text[] := array[
    'legal_name',
    'gstin',
    'pan',
    'registered_state_code',
    'invoice_prefix',
    'fy_start_month'
  ];
  v_key text;
  v_old_subset jsonb;
  v_new_subset jsonb;
begin
  perform admin.require_admin('platform_owner');

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'p_patch must be a JSONB object';
  end if;

  select * into v_row from billing.issuer_entities where id = p_id;
  if not found then
    raise exception 'Issuer % not found', p_id using errcode = 'P0002';
  end if;

  -- Reject any key outside the mutable allow-list. Identity fields are
  -- specifically called out so the error message guides the operator to
  -- retire + create.
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = any(v_immutable) then
      raise exception
        'Immutable field `%` — retire the current issuer and create a new one to change identity',
        v_key
        using errcode = '42501';
    end if;
    if v_key <> all(v_mutable) then
      raise exception
        'Unknown or non-editable field `%` — allowed: %',
        v_key, array_to_string(v_mutable, ', ')
        using errcode = '42501';
    end if;
  end loop;

  -- Capture old/new for audit diff.
  v_old_subset := to_jsonb(v_row) - (
    select array_agg(k) from jsonb_object_keys(to_jsonb(v_row)) k
    where k <> all(
      (select array_agg(v) from jsonb_object_keys(p_patch) v)
    )
  );
  v_new_subset := p_patch;

  update billing.issuer_entities
     set registered_address    = coalesce(p_patch->>'registered_address',    registered_address),
         logo_r2_key           = case when p_patch ? 'logo_r2_key' then p_patch->>'logo_r2_key' else logo_r2_key end,
         signatory_name        = coalesce(p_patch->>'signatory_name',        signatory_name),
         signatory_designation = case when p_patch ? 'signatory_designation' then p_patch->>'signatory_designation' else signatory_designation end,
         bank_account_masked   = case when p_patch ? 'bank_account_masked'   then p_patch->>'bank_account_masked'   else bank_account_masked end
   where id = p_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issuer_update', 'billing.issuer_entities', p_id, null,
     v_old_subset, v_new_subset,
     'issuer entity mutable-field update');
end;
$$;

grant execute on function admin.billing_issuer_update(uuid, jsonb) to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 8 · admin.billing_issuer_activate — platform_owner only; single-active invariant
-- ═══════════════════════════════════════════════════════════
-- Flips the current active issuer (if any) to is_active=false, then
-- flips the target to is_active=true. Runs in a single transaction;
-- the partial unique index guarantees no two rows ever sit at active=true
-- even under concurrent activation attempts.

create or replace function admin.billing_issuer_activate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row billing.issuer_entities%rowtype;
  v_prev_active_id uuid;
begin
  perform admin.require_admin('platform_owner');

  select * into v_row from billing.issuer_entities where id = p_id;
  if not found then
    raise exception 'Issuer % not found', p_id using errcode = 'P0002';
  end if;
  if v_row.retired_at is not null then
    raise exception 'Cannot activate a retired issuer (retired at %)', v_row.retired_at
      using errcode = '42501';
  end if;
  if v_row.is_active then
    raise exception 'Issuer is already active';
  end if;

  select id into v_prev_active_id
    from billing.issuer_entities
   where is_active = true
   limit 1;

  if v_prev_active_id is not null then
    update billing.issuer_entities
       set is_active = false
     where id = v_prev_active_id;
  end if;

  update billing.issuer_entities
     set is_active = true,
         activated_at = coalesce(activated_at, now())
   where id = p_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issuer_activate', 'billing.issuer_entities', p_id, null,
     jsonb_build_object('previous_active_id', v_prev_active_id),
     jsonb_build_object('is_active', true, 'activated_at', now()),
     'issuer activated');
end;
$$;

grant execute on function admin.billing_issuer_activate(uuid) to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 9 · admin.billing_issuer_retire — platform_owner only
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_issuer_retire(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row billing.issuer_entities%rowtype;
begin
  perform admin.require_admin('platform_owner');

  if length(coalesce(p_reason, '')) < 10 then
    raise exception 'reason required (≥10 chars)';
  end if;

  select * into v_row from billing.issuer_entities where id = p_id;
  if not found then
    raise exception 'Issuer % not found', p_id using errcode = 'P0002';
  end if;
  if v_row.retired_at is not null then
    raise exception 'Issuer is already retired (at %)', v_row.retired_at;
  end if;

  update billing.issuer_entities
     set is_active = false,
         retired_at = now(),
         retired_reason = p_reason
   where id = p_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issuer_retire', 'billing.issuer_entities', p_id, null,
     jsonb_build_object('is_active', v_row.is_active, 'retired_at', null),
     jsonb_build_object('is_active', false, 'retired_at', now()),
     p_reason);
end;
$$;

grant execute on function admin.billing_issuer_retire(uuid, text) to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 10 · admin.billing_issuer_hard_delete — platform_owner only
-- ═══════════════════════════════════════════════════════════
-- Pure dev-state cleanup escape hatch. Refused once any public.invoices
-- row references the issuer (chunk 3's FK is `on delete restrict`).
-- For this chunk the check is a no-op because public.invoices doesn't
-- exist yet — the DELETE will always succeed if the row exists.

create or replace function admin.billing_issuer_hard_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_operator uuid := auth.uid();
  v_row billing.issuer_entities%rowtype;
begin
  perform admin.require_admin('platform_owner');

  select * into v_row from billing.issuer_entities where id = p_id;
  if not found then
    raise exception 'Issuer % not found', p_id using errcode = 'P0002';
  end if;

  -- Chunk 3 adds this guard directly (checks public.invoices FK). For
  -- now the DELETE either succeeds or fails on a FK raise once that
  -- table exists; either way the RPC contract is unchanged.
  delete from billing.issuer_entities where id = p_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issuer_hard_delete', 'billing.issuer_entities', p_id, null,
     jsonb_build_object('legal_name', v_row.legal_name, 'gstin', v_row.gstin),
     null,
     'issuer entity hard-deleted (dev-state cleanup; requires zero invoice references)');
end;
$$;

grant execute on function admin.billing_issuer_hard_delete(uuid) to cs_admin, authenticated;

-- Verification:
--   select count(*) from billing.issuer_entities;                         → 0 initially
--   select indexname from pg_indexes where tablename = 'issuer_entities'; → single_active + gstin_uniq
--   select tgname from pg_trigger where tgrelid = 'billing.issuer_entities'::regclass;
--     → issuer_entities_immutable_identity
