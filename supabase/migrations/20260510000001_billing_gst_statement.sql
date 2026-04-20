-- ADR-0050 Sprint 3.1 — admin.billing_gst_statement
--
-- GSTR-1-friendly per-invoice breakdown for an issuer × FY range.
-- Returns a jsonb envelope:
--   { rows: [per-invoice rows], summary: {count, subtotal, cgst, sgst, igst, total} }
--
-- Scope rule:
--   platform_operator:
--     · p_issuer_id NULL → resolves to the currently-active issuer
--     · p_issuer_id = active issuer → accepted
--     · p_issuer_id = any other issuer → raises
--   platform_owner:
--     · p_issuer_id NULL → ALL issuers (active + retired)
--     · p_issuer_id = <any> → accepted
--
-- support / read_only → raises via require_admin.
--
-- Every call is audit-logged with the caller's role + filter params so
-- statement generation itself is tamper-evident (ADR-0052's evidence
-- ledger will build on this).

create or replace function admin.billing_gst_statement(
  p_issuer_id uuid,
  p_fy_start  date,
  p_fy_end    date
)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_active_issuer  uuid;
  v_effective_scope uuid; -- null means "all issuers" (owner only)
  v_rows           jsonb;
  v_summary        jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_fy_start is null or p_fy_end is null then
    raise exception 'fy_start and fy_end required' using errcode = '22023';
  end if;
  if p_fy_end < p_fy_start then
    raise exception 'fy_end must not precede fy_start' using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  -- Scope resolution
  if v_role = 'platform_operator' then
    if p_issuer_id is null then
      v_effective_scope := v_active_issuer;
    elsif p_issuer_id = v_active_issuer then
      v_effective_scope := p_issuer_id;
    else
      raise exception 'platform_operator may only generate statements for the currently-active issuer'
        using errcode = '42501';
    end if;
    if v_effective_scope is null then
      raise exception 'No active issuer — activate one before generating a statement'
        using errcode = '22023';
    end if;
  else
    -- platform_owner
    v_effective_scope := p_issuer_id; -- null means all-issuers
  end if;

  with scoped as (
    select
      i.id,
      i.invoice_number,
      i.issue_date,
      i.status,
      i.subtotal_paise,
      i.cgst_paise,
      i.sgst_paise,
      i.igst_paise,
      i.total_paise,
      e.gstin                  as issuer_gstin,
      e.registered_state_code  as issuer_state_code,
      a.billing_legal_name     as customer_legal_name,
      a.billing_gstin          as customer_gstin,
      a.billing_state_code     as customer_state_code,
      -- HSN/SAC from the first line item's hsn_sac key (defaults to 9983).
      coalesce(
        (i.line_items -> 0 ->> 'hsn_sac'),
        '9983'
      ) as hsn_sac
    from public.invoices i
      join billing.issuer_entities e on e.id = i.issuer_entity_id
      join public.accounts a         on a.id = i.account_id
    where i.issue_date between p_fy_start and p_fy_end
      and i.status in ('issued', 'paid', 'partially_paid', 'overdue')
      and (
        v_effective_scope is null
        or i.issuer_entity_id = v_effective_scope
      )
    order by i.issue_date asc, i.fy_sequence asc, i.created_at asc
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'invoice_number',      s.invoice_number,
          'invoice_date',        s.issue_date,
          'customer_legal_name', s.customer_legal_name,
          'customer_gstin',      s.customer_gstin,
          'customer_state_code', s.customer_state_code,
          'place_of_supply',     s.customer_state_code,
          'hsn_sac',             s.hsn_sac,
          'taxable_value_paise', s.subtotal_paise,
          'cgst_paise',          s.cgst_paise,
          'sgst_paise',          s.sgst_paise,
          'igst_paise',          s.igst_paise,
          'total_paise',         s.total_paise,
          'status',              s.status,
          'issuer_gstin',        s.issuer_gstin,
          'issuer_state_code',   s.issuer_state_code
        )
      ),
      '[]'::jsonb
    ),
    jsonb_build_object(
      'count',          count(*),
      'subtotal_paise', coalesce(sum(s.subtotal_paise), 0)::bigint,
      'cgst_paise',     coalesce(sum(s.cgst_paise), 0)::bigint,
      'sgst_paise',     coalesce(sum(s.sgst_paise), 0)::bigint,
      'igst_paise',     coalesce(sum(s.igst_paise), 0)::bigint,
      'total_paise',    coalesce(sum(s.total_paise), 0)::bigint
    )
  into v_rows, v_summary
  from scoped s;

  -- Audit. Statement generation itself is a tamper-evident event.
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id,
     old_value, new_value, reason)
  values
    (v_operator, 'billing_gst_statement', 'public.invoices', null, null,
     null,
     jsonb_build_object(
       'issuer_id', v_effective_scope,
       'fy_start',  p_fy_start,
       'fy_end',    p_fy_end,
       'caller_role', v_role,
       'row_count', (v_summary -> 'count')::int
     ),
     'gst statement generated');

  return jsonb_build_object(
    'rows',    v_rows,
    'summary', v_summary,
    'scope',   jsonb_build_object(
      'caller_role',      v_role,
      'issuer_id',        v_effective_scope,
      'all_issuers',      v_effective_scope is null,
      'fy_start',         p_fy_start,
      'fy_end',           p_fy_end
    )
  );
end;
$$;

revoke all on function admin.billing_gst_statement(uuid, date, date) from public;
grant execute on function admin.billing_gst_statement(uuid, date, date)
  to cs_admin, authenticated;

comment on function admin.billing_gst_statement(uuid, date, date) is
  'ADR-0050 Sprint 3.1. Per-invoice GSTR-1-friendly breakdown for an issuer × FY range. Scope: operator → active issuer only (NULL resolves); owner → any issuer (NULL = all).';
