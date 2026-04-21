-- ADR-0058 Sprint 1.1 — seed_quick_data_inventory RPC.
--
-- Backs Step 3 of the onboarding wizard: 3 yes/no questions →
-- 6 draft data_inventory rows (2 per question, paired). The
-- wireframe (`consentshield-screens.html` line 2280) promises
-- "auto-generated with 6 data categories based on your answers".
--
-- Idempotent: each seeded row carries source_type='quick_inventory_seed';
-- re-running with the same answers is a no-op (per WHERE NOT EXISTS
-- guard). Re-running with NEW answers adds the new pairs without
-- touching previously-inserted ones.
--
-- Returns the number of rows actually inserted (0..6) so the wizard can
-- show "we drafted N entries" feedback.

create or replace function public.seed_quick_data_inventory(
  p_org_id          uuid,
  p_has_email       boolean default false,
  p_has_payments    boolean default false,
  p_has_analytics   boolean default false
) returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text;
  v_inserted int := 0;

  -- Each pair is (data_category, purposes_default).
  -- Conservative legal_basis defaults to 'consent' per table default;
  -- payment_records gets 'contract' since checkout is contractually
  -- necessary regardless of consent.
  v_email_pair text[][] := array[
    array['Email addresses', 'service_communication'],
    array['Names', 'service_communication']
  ];
  v_payment_pair text[][] := array[
    array['Payment card details', 'payment_processing'],
    array['Billing addresses', 'payment_processing']
  ];
  v_analytics_pair text[][] := array[
    array['Page views and events', 'analytics'],
    array['Device and browser metadata', 'analytics']
  ];

  procedure_seed text;
  v_pair text[];
begin
  -- Authorisation: caller must be an account-owner or org-admin on the
  -- target org. effective_org_role accounts for the account-tier
  -- inheritance already implemented in ADR-0044.
  v_role := public.effective_org_role(p_org_id);
  if v_role is null or v_role not in ('account_owner', 'org_admin') then
    raise exception 'insufficient role for org %', p_org_id
      using errcode = '42501';
  end if;

  if p_has_email then
    foreach v_pair slice 1 in array v_email_pair loop
      insert into public.data_inventory (
        org_id, data_category, purposes, legal_basis,
        source_type, is_complete
      )
      select p_org_id, v_pair[1], array[v_pair[2]]::text[], 'consent',
             'quick_inventory_seed', false
      where not exists (
        select 1 from public.data_inventory
         where org_id = p_org_id
           and data_category = v_pair[1]
           and source_type = 'quick_inventory_seed'
      );
      get diagnostics procedure_seed = row_count;
      v_inserted := v_inserted + procedure_seed::int;
    end loop;
  end if;

  if p_has_payments then
    foreach v_pair slice 1 in array v_payment_pair loop
      insert into public.data_inventory (
        org_id, data_category, purposes, legal_basis,
        source_type, is_complete
      )
      select p_org_id, v_pair[1], array[v_pair[2]]::text[], 'contract',
             'quick_inventory_seed', false
      where not exists (
        select 1 from public.data_inventory
         where org_id = p_org_id
           and data_category = v_pair[1]
           and source_type = 'quick_inventory_seed'
      );
      get diagnostics procedure_seed = row_count;
      v_inserted := v_inserted + procedure_seed::int;
    end loop;
  end if;

  if p_has_analytics then
    foreach v_pair slice 1 in array v_analytics_pair loop
      insert into public.data_inventory (
        org_id, data_category, purposes, legal_basis,
        source_type, is_complete
      )
      select p_org_id, v_pair[1], array[v_pair[2]]::text[], 'consent',
             'quick_inventory_seed', false
      where not exists (
        select 1 from public.data_inventory
         where org_id = p_org_id
           and data_category = v_pair[1]
           and source_type = 'quick_inventory_seed'
      );
      get diagnostics procedure_seed = row_count;
      v_inserted := v_inserted + procedure_seed::int;
    end loop;
  end if;

  return v_inserted;
end;
$$;

revoke execute on function public.seed_quick_data_inventory(uuid, boolean, boolean, boolean) from public;
revoke execute on function public.seed_quick_data_inventory(uuid, boolean, boolean, boolean) from anon;
grant execute on function public.seed_quick_data_inventory(uuid, boolean, boolean, boolean) to authenticated;

comment on function public.seed_quick_data_inventory(uuid, boolean, boolean, boolean) is
  'ADR-0058 Step 3: 3 yes/no toggles → up to 6 draft data_inventory rows. Idempotent.';
