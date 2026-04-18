-- ADR-0050 Sprint 2.1 chunk 2 — fix admin.billing_issuer_update parse error.
--
-- The prior migration used `v_key <> all(v_mutable)` which PG was parsing
-- as `text <> text[]` (no matching operator) rather than the scalar-vs-array
-- ALL form. Rewriting the mutable-field check as `not (v_key = any(v_mutable))`
-- avoids the ambiguity — `= ANY` was already parsing correctly in the same
-- function's immutable-field check.

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

  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key = any(v_immutable) then
      raise exception
        'Immutable field `%` — retire the current issuer and create a new one to change identity',
        v_key
        using errcode = '42501';
    end if;
    if not (v_key = any(v_mutable)) then
      raise exception
        'Unknown or non-editable field `%` — allowed: %',
        v_key, array_to_string(v_mutable, ', ')
        using errcode = '42501';
    end if;
  end loop;

  v_old_subset := jsonb_build_object(
    'registered_address',    v_row.registered_address,
    'logo_r2_key',           v_row.logo_r2_key,
    'signatory_name',        v_row.signatory_name,
    'signatory_designation', v_row.signatory_designation,
    'bank_account_masked',   v_row.bank_account_masked
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
