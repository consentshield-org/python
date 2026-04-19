-- ADR-0050 Sprint 2.3 — invoice list + detail RPCs and billing_account_summary expansion.
--
-- Three deliverables:
--
--   1. admin.billing_invoice_list(p_account_id uuid, p_limit int default 50)
--      → jsonb array. SECURITY DEFINER, platform_operator+. Scope rule:
--      platform_operator callers see only invoices under the currently-active
--      issuer; platform_owner callers see all issuers (active + retired).
--      Newest first by issue_date, then fy_sequence.
--
--   2. admin.billing_invoice_detail(p_invoice_id uuid) → jsonb.
--      Same tier + scope rule. Returns full invoice row + denormalised
--      issuer + account billing profile snapshot. Missing invoice raises.
--      Retired-issuer invoice accessed by platform_operator raises with
--      a scope-scoped error — operators cannot peek at history under a
--      retired issuer.
--
--   3. admin.billing_account_summary extension — add latest_invoice envelope +
--      real outstanding_balance_paise (sum of total_paise where status in
--      ('issued','partially_paid','overdue')). The stub 0 from Sprint 1
--      is replaced with a live computation.

-- ═══════════════════════════════════════════════════════════
-- Helper — look up the currently-active issuer.
-- ═══════════════════════════════════════════════════════════

create or replace function admin._billing_active_issuer_id()
returns uuid
language sql
stable
as $$
  select id from billing.issuer_entities where is_active = true limit 1;
$$;

revoke all on function admin._billing_active_issuer_id() from public;
grant execute on function admin._billing_active_issuer_id() to cs_admin, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 1 · admin.billing_invoice_list
-- ═══════════════════════════════════════════════════════════

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
    order by i.issue_date desc, i.fy_sequence desc
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
      order by s.issue_date desc, s.fy_sequence desc
    ),
    '[]'::jsonb
  )
  into v_rows
  from scoped s;

  return v_rows;
end;
$$;

revoke all on function admin.billing_invoice_list(uuid, integer) from public;
grant execute on function admin.billing_invoice_list(uuid, integer) to cs_admin, authenticated;

comment on function admin.billing_invoice_list(uuid, integer) is
  'ADR-0050 Sprint 2.3. Lists invoices for an account, newest first. Scope rule: platform_operator → current-active-issuer only; platform_owner → all issuers.';

-- ═══════════════════════════════════════════════════════════
-- 2 · admin.billing_invoice_detail
-- ═══════════════════════════════════════════════════════════

create or replace function admin.billing_invoice_detail(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_active_issuer  uuid;
  v_envelope       jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  v_active_issuer := admin._billing_active_issuer_id();

  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'id',                 i.id,
      'invoice_number',     i.invoice_number,
      'fy_year',            i.fy_year,
      'fy_sequence',        i.fy_sequence,
      'issue_date',         i.issue_date,
      'due_date',           i.due_date,
      'period_start',       i.period_start,
      'period_end',         i.period_end,
      'currency',           i.currency,
      'line_items',         i.line_items,
      'subtotal_paise',     i.subtotal_paise,
      'cgst_paise',         i.cgst_paise,
      'sgst_paise',         i.sgst_paise,
      'igst_paise',         i.igst_paise,
      'total_paise',        i.total_paise,
      'status',             i.status,
      'issuer_entity_id',   i.issuer_entity_id,
      'account_id',         i.account_id,
      'pdf_r2_key',         i.pdf_r2_key,
      'pdf_sha256',         i.pdf_sha256,
      'razorpay_invoice_id',i.razorpay_invoice_id,
      'razorpay_order_id',  i.razorpay_order_id,
      'issued_at',          i.issued_at,
      'paid_at',            i.paid_at,
      'voided_at',          i.voided_at,
      'voided_reason',      i.voided_reason,
      'email_message_id',   i.email_message_id,
      'email_delivered_at', i.email_delivered_at
    ),
    'issuer', jsonb_build_object(
      'id',                    e.id,
      'legal_name',            e.legal_name,
      'gstin',                 e.gstin,
      'pan',                   e.pan,
      'registered_state_code', e.registered_state_code,
      'registered_address',    e.registered_address,
      'invoice_prefix',        e.invoice_prefix,
      'signatory_name',        e.signatory_name,
      'signatory_designation', e.signatory_designation,
      'bank_account_masked',   e.bank_account_masked,
      'is_active',             e.is_active,
      'retired_at',            e.retired_at
    ),
    'account', jsonb_build_object(
      'id',                  a.id,
      'name',                a.name,
      'billing_legal_name',  a.billing_legal_name,
      'billing_gstin',       a.billing_gstin,
      'billing_state_code',  a.billing_state_code,
      'billing_address',     a.billing_address,
      'billing_email',       a.billing_email
    )
  )
  into v_envelope
  from public.invoices i
    join billing.issuer_entities e on e.id = i.issuer_entity_id
    join public.accounts a         on a.id = i.account_id
  where i.id = p_invoice_id;

  if v_envelope is null then
    raise exception 'Invoice not found: %', p_invoice_id using errcode = '22023';
  end if;

  -- Scope rule for operators: no peeking at retired-issuer invoices.
  if v_role = 'platform_operator'
     and ((v_envelope -> 'invoice' ->> 'issuer_entity_id')::uuid <> v_active_issuer)
  then
    raise exception 'Invoice belongs to a non-active issuer — viewing requires platform_owner'
      using errcode = '42501';
  end if;

  return v_envelope;
end;
$$;

revoke all on function admin.billing_invoice_detail(uuid) from public;
grant execute on function admin.billing_invoice_detail(uuid) to cs_admin, authenticated;

comment on function admin.billing_invoice_detail(uuid) is
  'ADR-0050 Sprint 2.3. Returns an invoice with denormalised issuer + account profile. Scope rule: platform_operator can only view current-active-issuer invoices.';

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.billing_account_summary — add latest_invoice + real balance
-- ═══════════════════════════════════════════════════════════
-- Rebuilds the summary envelope on top of the Sprint 1 shape. Backward
-- compatible (all Sprint 1 keys retained); adds:
--   · latest_invoice: invoice stub or null (newest invoice for this
--     account; no scope filter — the detail page decides when to gate).
--   · outstanding_balance_paise: sum of total_paise where status is
--     issued / partially_paid / overdue. Zero if no open invoices.

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

  -- Latest invoice (newest by issue_date). Summary RPC returns this
  -- unfiltered by issuer scope — the detail view layers its own gate.
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
  order by i.issue_date desc, i.fy_sequence desc
  limit 1;

  -- Outstanding balance: anything issued and not yet paid / voided.
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

comment on function admin.billing_account_summary(uuid) is
  'ADR-0050 Sprint 2.3 — per-account billing summary. Adds latest_invoice + real outstanding_balance_paise computed from public.invoices.';

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.billing_accounts_invoice_snapshot
-- ═══════════════════════════════════════════════════════════
-- Bulk last-invoice map for the /billing landing. Returns a jsonb array
-- of {account_id, invoice_number, status, total_paise, issue_date,
-- issuer_is_active} for every account that has at least one invoice.
-- Respects the same scope rule as billing_invoice_list.

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
      row_number() over (partition by i.account_id order by i.issue_date desc, i.fy_sequence desc) as rn
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

revoke all on function admin.billing_accounts_invoice_snapshot() from public;
grant execute on function admin.billing_accounts_invoice_snapshot() to cs_admin, authenticated;

comment on function admin.billing_accounts_invoice_snapshot() is
  'ADR-0050 Sprint 2.3. Latest invoice per account (one row each), scope-filtered. Backs the "Last invoice" column on the billing landing.';
