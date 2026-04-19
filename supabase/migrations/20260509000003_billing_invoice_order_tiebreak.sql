-- ADR-0050 Sprint 2.3 follow-up — deterministic newest-first ordering.
--
-- The three invoice-reading RPCs (list, account_summary latest_invoice
-- lookup, accounts_invoice_snapshot) originally ordered by
-- (issue_date desc, fy_sequence desc). When two invoices share the same
-- issue_date under different issuers, fy_sequence can tie (both = 1 for
-- their first-in-FY). created_at is the truest "newest" signal across
-- issuers, so add it as the last tie-break.
--
-- No schema change; re-creates three functions with an extended ORDER BY.

create or replace function admin.billing_invoice_list(
  p_account_id uuid,
  p_limit      integer default 50
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
  v_rows           jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_account_id is null then
    raise exception 'account_id required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    p_limit := 50;
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  with scoped as (
    select i.*
    from public.invoices i
    where i.account_id = p_account_id
      and (
        v_role = 'platform_owner'
        or i.issuer_entity_id = v_active_issuer
      )
    order by i.issue_date desc, i.fy_sequence desc, i.created_at desc
    limit p_limit
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',                s.id,
        'invoice_number',    s.invoice_number,
        'fy_year',           s.fy_year,
        'fy_sequence',       s.fy_sequence,
        'issue_date',        s.issue_date,
        'due_date',          s.due_date,
        'period_start',      s.period_start,
        'period_end',        s.period_end,
        'currency',          s.currency,
        'subtotal_paise',    s.subtotal_paise,
        'cgst_paise',        s.cgst_paise,
        'sgst_paise',        s.sgst_paise,
        'igst_paise',        s.igst_paise,
        'total_paise',       s.total_paise,
        'status',            s.status,
        'issuer_entity_id',  s.issuer_entity_id,
        'issuer_is_active',  s.issuer_entity_id = v_active_issuer,
        'pdf_r2_key',        s.pdf_r2_key,
        'pdf_sha256',        s.pdf_sha256,
        'issued_at',         s.issued_at,
        'paid_at',           s.paid_at,
        'email_message_id',  s.email_message_id,
        'email_delivered_at',s.email_delivered_at
      )
      order by s.issue_date desc, s.fy_sequence desc, s.created_at desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from scoped s;

  return v_rows;
end;
$$;

create or replace function admin.billing_account_summary(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_account          public.accounts%rowtype;
  v_plan             public.plans%rowtype;
  v_effective_plan   text;
  v_subscription     jsonb;
  v_plan_history     jsonb;
  v_latest_invoice   jsonb;
  v_outstanding      bigint;
begin
  perform admin.require_admin('support');

  select * into v_account from public.accounts where id = p_account_id;
  if not found then
    raise exception 'Account % not found', p_account_id using errcode = 'P0002';
  end if;

  select * into v_plan from public.plans where plan_code = v_account.plan_code;
  v_effective_plan := public.account_effective_plan(p_account_id);

  v_subscription := jsonb_build_object(
    'plan_code',                v_account.plan_code,
    'effective_plan_code',      v_effective_plan,
    'plan_display_name',        v_plan.display_name,
    'base_price_inr',           v_plan.base_price_inr,
    'status',                   v_account.status,
    'current_period_ends_at',   v_account.current_period_ends_at,
    'trial_ends_at',            v_account.trial_ends_at,
    'razorpay_customer_id',     v_account.razorpay_customer_id,
    'razorpay_subscription_id', v_account.razorpay_subscription_id,
    'next_charge_amount_paise', null
  );

  with events as (
    select
      v_account.created_at as effective_from,
      v_account.plan_code  as plan_code,
      'base'::text         as source,
      'granted'::text      as action,
      null::uuid           as adjustment_id,
      null::uuid           as actor_user_id,
      null::text           as reason
    union all
    select
      pa.starts_at, pa.plan, pa.kind, 'granted'::text,
      pa.id, pa.granted_by, pa.reason
    from public.plan_adjustments pa
    where pa.account_id = p_account_id
    union all
    select
      pa.revoked_at, pa.plan, pa.kind, 'revoked'::text,
      pa.id, pa.revoked_by, null::text
    from public.plan_adjustments pa
    where pa.account_id = p_account_id
      and pa.revoked_at is not null
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'effective_from', effective_from, 'plan_code', plan_code,
        'source', source, 'action', action, 'adjustment_id', adjustment_id,
        'actor_user_id', actor_user_id, 'reason', reason
      )
      order by effective_from asc
    ),
    '[]'::jsonb
  )
  into v_plan_history
  from events;

  select jsonb_build_object(
    'id',              i.id,
    'invoice_number',  i.invoice_number,
    'issue_date',      i.issue_date,
    'due_date',        i.due_date,
    'status',          i.status,
    'total_paise',     i.total_paise,
    'issuer_entity_id',i.issuer_entity_id
  )
  into v_latest_invoice
  from public.invoices i
  where i.account_id = p_account_id
  order by i.issue_date desc, i.fy_sequence desc, i.created_at desc
  limit 1;

  select coalesce(sum(i.total_paise), 0)::bigint
  into v_outstanding
  from public.invoices i
  where i.account_id = p_account_id
    and i.status in ('issued', 'partially_paid', 'overdue');

  return jsonb_build_object(
    'subscription_state',        v_subscription,
    'plan_history',              v_plan_history,
    'latest_invoice',            v_latest_invoice,
    'outstanding_balance_paise', v_outstanding
  );
end;
$$;

create or replace function admin.billing_accounts_invoice_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_active_issuer  uuid;
  v_rows           jsonb;
begin
  perform admin.require_admin('platform_operator');

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  with ranked as (
    select
      i.*,
      row_number() over (
        partition by i.account_id
        order by i.issue_date desc, i.fy_sequence desc, i.created_at desc
      ) as rn
    from public.invoices i
    where v_role = 'platform_owner' or i.issuer_entity_id = v_active_issuer
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'account_id',       r.account_id,
        'invoice_id',       r.id,
        'invoice_number',   r.invoice_number,
        'status',           r.status,
        'total_paise',      r.total_paise,
        'issue_date',       r.issue_date,
        'issuer_is_active', r.issuer_entity_id = v_active_issuer
      )
    ),
    '[]'::jsonb
  )
  into v_rows
  from ranked r
  where r.rn = 1;

  return v_rows;
end;
$$;
