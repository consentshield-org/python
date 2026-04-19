-- ADR-0050 Sprint 2.2 — invoice issuance RPC + GST computation + finalize RPCs.
--
-- Three functions ship here:
--
--   1. public.billing_compute_gst(issuer_state, customer_state, subtotal_paise,
--                                 rate_bps default 1800)
--      → (cgst_paise, sgst_paise, igst_paise, total_gst_paise)
--      SQL is the system of record for money arithmetic. Intra-state splits
--      the tax 50/50 between CGST and SGST with deterministic remainder
--      handling so (cgst + sgst) always equals the total; inter-state puts
--      the full amount on IGST. Customer with no state_code is treated as
--      inter-state (registration-agnostic IGST fallback).
--
--   2. admin.billing_issue_invoice(p_account_id, p_period_start, p_period_end,
--                                  p_line_items, p_due_date)
--      → uuid
--      SECURITY DEFINER, platform_operator+. Loads the currently-active
--      issuer under FOR UPDATE, computes FY + next sequence, validates the
--      account's billing profile, computes GST, inserts public.invoices at
--      status='draft', audit-logs. PDF render + upload + email happen in the
--      Next.js Route Handler *after* this returns.
--
--   3. admin.billing_finalize_invoice_pdf(p_invoice_id, p_pdf_r2_key,
--                                         p_pdf_sha256)
--      + admin.billing_stamp_invoice_email(p_invoice_id, p_email_message_id)
--      Flip draft → issued and stamp email_message_id respectively. Both
--      SECURITY DEFINER, platform_operator+, scope-gated to the currently-
--      active issuer for operators; platform_owner may stamp across issuers
--      (edge case, present for completeness).
--
-- All mutation paths audit-log; all reject non-admin callers via
-- admin.require_admin.

-- ═══════════════════════════════════════════════════════════
-- 1 · public.billing_compute_gst
-- ═══════════════════════════════════════════════════════════
-- Intra-state (issuer_state = customer_state, both present):
--   total = floor(subtotal * rate_bps / 10000)
--   cgst  = floor(total / 2)
--   sgst  = total - cgst    ← remainder lands on SGST so the sum is exact
--   igst  = 0
-- Inter-state (issuer_state ≠ customer_state, or customer_state is null):
--   total = floor(subtotal * rate_bps / 10000)
--   cgst  = 0, sgst = 0, igst = total
-- Rounding: floor (`/` on bigint in Postgres is integer division). Exact at
-- paise; operators should price in whole paise to avoid surprises.

create or replace function public.billing_compute_gst(
  p_issuer_state   text,
  p_customer_state text,
  p_subtotal_paise bigint,
  p_rate_bps       integer default 1800
)
returns table (
  cgst_paise     bigint,
  sgst_paise     bigint,
  igst_paise     bigint,
  total_gst_paise bigint
)
language plpgsql
immutable
as $$
declare
  v_total bigint;
  v_intra boolean;
begin
  if p_subtotal_paise is null or p_subtotal_paise < 0 then
    raise exception 'subtotal_paise must be non-negative' using errcode = '22023';
  end if;
  if p_rate_bps is null or p_rate_bps < 0 or p_rate_bps > 10000 then
    raise exception 'rate_bps must be 0–10000 (basis points of the taxable value)' using errcode = '22023';
  end if;
  if p_issuer_state is null or length(p_issuer_state) = 0 then
    raise exception 'issuer_state required' using errcode = '22023';
  end if;

  v_total := (p_subtotal_paise * p_rate_bps) / 10000;
  v_intra := p_customer_state is not null
             and length(p_customer_state) > 0
             and upper(p_issuer_state) = upper(p_customer_state);

  if v_intra then
    cgst_paise := v_total / 2;
    sgst_paise := v_total - cgst_paise;
    igst_paise := 0;
  else
    cgst_paise := 0;
    sgst_paise := 0;
    igst_paise := v_total;
  end if;
  total_gst_paise := v_total;
  return next;
end;
$$;

revoke all on function public.billing_compute_gst(text, text, bigint, integer) from public;
grant execute on function public.billing_compute_gst(text, text, bigint, integer)
  to cs_admin, cs_orchestrator, authenticated;

comment on function public.billing_compute_gst(text, text, bigint, integer) is
  'ADR-0050 Sprint 2.2. GST split: intra-state → CGST+SGST (50/50 with remainder on SGST), inter-state → IGST. Customer with null state_code → IGST (registration-agnostic). Subtotal × rate_bps / 10000 floored at paise.';

-- ═══════════════════════════════════════════════════════════
-- 2 · admin.billing_issue_invoice
-- ═══════════════════════════════════════════════════════════
-- Steps 1–4 of the ADR-0050 issuance flow:
--   1. Load active issuer (FOR UPDATE) — raises if none
--   2. Validate accounts.billing_* columns present
--   3. Compute FY year + next fy_sequence scoped to (issuer, fy_year)
--   4. Insert public.invoices at status='draft'
-- PDF + R2 upload + Resend happen in the calling Route Handler.

create or replace function admin.billing_issue_invoice(
  p_account_id    uuid,
  p_period_start  date,
  p_period_end    date,
  p_line_items    jsonb,
  p_due_date      date default null
)
returns uuid
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator           uuid := auth.uid();
  v_issuer             billing.issuer_entities%rowtype;
  v_account            public.accounts%rowtype;
  v_fy_start_year      integer;
  v_fy_year            text;
  v_fy_start_date      date;
  v_fy_end_date        date;
  v_next_seq           integer;
  v_invoice_number     text;
  v_line              jsonb;
  v_subtotal_paise     bigint := 0;
  v_item_amount        bigint;
  v_gst                record;
  v_due_date           date;
  v_invoice_id         uuid;
begin
  perform admin.require_admin('platform_operator');

  -- Inputs ----------------------------------------------------
  if p_account_id is null then
    raise exception 'account_id required' using errcode = '22023';
  end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period_start and period_end required' using errcode = '22023';
  end if;
  if p_period_end < p_period_start then
    raise exception 'period_end must not be before period_start' using errcode = '22023';
  end if;
  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' or jsonb_array_length(p_line_items) = 0 then
    raise exception 'line_items must be a non-empty array' using errcode = '22023';
  end if;

  -- 1 · Active issuer under row lock ---------------------------
  select * into v_issuer
  from billing.issuer_entities
  where is_active = true
  for update;

  if not found then
    raise exception 'No active issuer — create and activate a billing.issuer_entities row before issuing invoices'
      using errcode = '22023';
  end if;

  -- 2 · Account + billing profile ------------------------------
  select * into v_account
  from public.accounts
  where id = p_account_id;

  if not found then
    raise exception 'Account not found: %', p_account_id using errcode = '22023';
  end if;
  if coalesce(length(v_account.billing_legal_name), 0) = 0 then
    raise exception 'Account billing_legal_name is required — capture it on the account before issuing an invoice'
      using errcode = '22023';
  end if;
  if coalesce(length(v_account.billing_state_code), 0) = 0 then
    raise exception 'Account billing_state_code is required — capture it on the account before issuing an invoice'
      using errcode = '22023';
  end if;
  if coalesce(length(v_account.billing_email), 0) = 0 then
    raise exception 'Account billing_email is required — capture it on the account before issuing an invoice'
      using errcode = '22023';
  end if;
  if coalesce(length(v_account.billing_address), 0) = 0 then
    raise exception 'Account billing_address is required — capture it on the account before issuing an invoice'
      using errcode = '22023';
  end if;

  -- 3 · FY computation -----------------------------------------
  -- Indian FY starts on the issuer's fy_start_month (default April).
  -- If period_end falls on or after that month, FY begins in period_end's
  -- year; otherwise it began the previous calendar year.
  if extract(month from p_period_end)::int >= v_issuer.fy_start_month then
    v_fy_start_year := extract(year from p_period_end)::int;
  else
    v_fy_start_year := extract(year from p_period_end)::int - 1;
  end if;
  v_fy_year := v_fy_start_year::text || '-' || lpad(((v_fy_start_year + 1) % 100)::text, 2, '0');
  v_fy_start_date := make_date(v_fy_start_year, v_issuer.fy_start_month, 1);
  v_fy_end_date   := (v_fy_start_date + interval '1 year' - interval '1 day')::date;

  if p_period_start < v_fy_start_date or p_period_end > v_fy_end_date then
    raise exception 'period (% to %) crosses FY boundary (% to %); split into one invoice per FY',
      p_period_start, p_period_end, v_fy_start_date, v_fy_end_date
      using errcode = '22023';
  end if;

  -- Next fy_sequence. MAX + 1 is safe under FOR UPDATE on the issuer row.
  select coalesce(max(fy_sequence), 0) + 1 into v_next_seq
  from public.invoices
  where issuer_entity_id = v_issuer.id
    and fy_year = v_fy_year;

  v_invoice_number := v_issuer.invoice_prefix || '/' || v_fy_year || '/' || lpad(v_next_seq::text, 4, '0');

  -- Subtotal from line items ----------------------------------
  for v_line in select * from jsonb_array_elements(p_line_items)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Each line item must be a JSON object' using errcode = '22023';
    end if;
    if v_line ? 'amount_paise' is not true then
      raise exception 'Each line item must have an amount_paise integer' using errcode = '22023';
    end if;
    v_item_amount := (v_line ->> 'amount_paise')::bigint;
    if v_item_amount is null or v_item_amount < 0 then
      raise exception 'amount_paise must be a non-negative integer' using errcode = '22023';
    end if;
    v_subtotal_paise := v_subtotal_paise + v_item_amount;
  end loop;

  -- GST split --------------------------------------------------
  select *
  into v_gst
  from public.billing_compute_gst(
    v_issuer.registered_state_code,
    v_account.billing_state_code,
    v_subtotal_paise,
    1800
  );

  -- Due date default: period_end + 7 days --------------------
  v_due_date := coalesce(p_due_date, (p_period_end + interval '7 days')::date);
  if v_due_date < p_period_end then
    raise exception 'due_date must not be before period_end' using errcode = '22023';
  end if;

  -- 4 · Insert draft invoice ----------------------------------
  insert into public.invoices (
    issuer_entity_id,
    account_id,
    invoice_number,
    fy_year,
    fy_sequence,
    period_start,
    period_end,
    issue_date,
    due_date,
    currency,
    line_items,
    subtotal_paise,
    cgst_paise,
    sgst_paise,
    igst_paise,
    total_paise,
    status
  ) values (
    v_issuer.id,
    v_account.id,
    v_invoice_number,
    v_fy_year,
    v_next_seq,
    p_period_start,
    p_period_end,
    current_date,
    v_due_date,
    'INR',
    p_line_items,
    v_subtotal_paise,
    v_gst.cgst_paise,
    v_gst.sgst_paise,
    v_gst.igst_paise,
    v_subtotal_paise + v_gst.total_gst_paise,
    'draft'
  )
  returning id into v_invoice_id;

  -- Audit ------------------------------------------------------
  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_issue_invoice', 'public.invoices', v_invoice_id, null,
     null,
     jsonb_build_object(
       'issuer_entity_id', v_issuer.id,
       'account_id', v_account.id,
       'invoice_number', v_invoice_number,
       'fy_year', v_fy_year,
       'fy_sequence', v_next_seq,
       'subtotal_paise', v_subtotal_paise,
       'cgst_paise', v_gst.cgst_paise,
       'sgst_paise', v_gst.sgst_paise,
       'igst_paise', v_gst.igst_paise,
       'total_paise', v_subtotal_paise + v_gst.total_gst_paise
     ),
     'invoice draft created');

  return v_invoice_id;
end;
$$;

revoke all on function admin.billing_issue_invoice(uuid, date, date, jsonb, date) from public;
grant execute on function admin.billing_issue_invoice(uuid, date, date, jsonb, date)
  to cs_admin, authenticated;

comment on function admin.billing_issue_invoice(uuid, date, date, jsonb, date) is
  'ADR-0050 Sprint 2.2. Allocates the next FY sequence against the currently-active issuer, validates the account billing profile, computes GST, inserts public.invoices at status=draft. PDF render + upload + email run in the Route Handler.';

-- ═══════════════════════════════════════════════════════════
-- 3 · admin.billing_finalize_invoice_pdf
-- ═══════════════════════════════════════════════════════════
-- Called after the PDF has been uploaded to R2. Stamps the storage key
-- and hash, flips status to 'issued', records issued_at. Only draft
-- invoices are accepted. Operator callers are scope-gated to the
-- currently-active issuer.

create or replace function admin.billing_finalize_invoice_pdf(
  p_invoice_id    uuid,
  p_pdf_r2_key    text,
  p_pdf_sha256    text
)
returns void
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_invoice        public.invoices%rowtype;
  v_active_issuer  uuid;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;
  if coalesce(length(p_pdf_r2_key), 0) = 0 then
    raise exception 'pdf_r2_key required' using errcode = '22023';
  end if;
  if coalesce(length(p_pdf_sha256), 0) <> 64 then
    raise exception 'pdf_sha256 must be a 64-character hex digest' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found: %', p_invoice_id using errcode = '22023';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'Invoice % is already % — only drafts can be finalized', p_invoice_id, v_invoice.status
      using errcode = '22023';
  end if;

  -- Scope rule: platform_operator may only finalize invoices on the
  -- currently-active issuer; platform_owner can finalize across issuers
  -- (edge case for backfill / recovery).
  select admin_role into v_role from admin.admin_users where id = v_operator;
  if v_role = 'platform_operator' then
    select id into v_active_issuer from billing.issuer_entities where is_active = true;
    if v_invoice.issuer_entity_id is distinct from v_active_issuer then
      raise exception 'Invoice belongs to a non-active issuer — finalization requires platform_owner'
        using errcode = '42501';
    end if;
  end if;

  update public.invoices
    set status     = 'issued',
        issued_at  = now(),
        pdf_r2_key = p_pdf_r2_key,
        pdf_sha256 = p_pdf_sha256
    where id = p_invoice_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_finalize_invoice_pdf', 'public.invoices', p_invoice_id, null,
     jsonb_build_object('status', 'draft'),
     jsonb_build_object(
       'status', 'issued',
       'pdf_r2_key', p_pdf_r2_key,
       'pdf_sha256', p_pdf_sha256
     ),
     'invoice issued');
end;
$$;

revoke all on function admin.billing_finalize_invoice_pdf(uuid, text, text) from public;
grant execute on function admin.billing_finalize_invoice_pdf(uuid, text, text)
  to cs_admin, authenticated;

comment on function admin.billing_finalize_invoice_pdf(uuid, text, text) is
  'ADR-0050 Sprint 2.2. Flips draft → issued after PDF upload. Stamps pdf_r2_key, pdf_sha256, issued_at.';

-- ═══════════════════════════════════════════════════════════
-- 4 · admin.billing_stamp_invoice_email
-- ═══════════════════════════════════════════════════════════
-- Called after Resend returns a message id. Stamps email_message_id.
-- email_delivered_at is stamped separately by the Resend webhook path.

create or replace function admin.billing_stamp_invoice_email(
  p_invoice_id       uuid,
  p_email_message_id text
)
returns void
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_operator       uuid := auth.uid();
  v_role           text;
  v_invoice        public.invoices%rowtype;
  v_active_issuer  uuid;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;
  if coalesce(length(p_email_message_id), 0) = 0 then
    raise exception 'email_message_id required' using errcode = '22023';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found: %', p_invoice_id using errcode = '22023';
  end if;
  if v_invoice.status = 'draft' then
    raise exception 'Invoice % is still draft — finalize the PDF first', p_invoice_id
      using errcode = '22023';
  end if;

  select admin_role into v_role from admin.admin_users where id = v_operator;
  if v_role = 'platform_operator' then
    select id into v_active_issuer from billing.issuer_entities where is_active = true;
    if v_invoice.issuer_entity_id is distinct from v_active_issuer then
      raise exception 'Invoice belongs to a non-active issuer — operation requires platform_owner'
        using errcode = '42501';
    end if;
  end if;

  update public.invoices
    set email_message_id = p_email_message_id
    where id = p_invoice_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_stamp_invoice_email', 'public.invoices', p_invoice_id, null,
     jsonb_build_object('email_message_id', v_invoice.email_message_id),
     jsonb_build_object('email_message_id', p_email_message_id),
     'invoice email dispatched');
end;
$$;

revoke all on function admin.billing_stamp_invoice_email(uuid, text) from public;
grant execute on function admin.billing_stamp_invoice_email(uuid, text)
  to cs_admin, authenticated;

comment on function admin.billing_stamp_invoice_email(uuid, text) is
  'ADR-0050 Sprint 2.2. Stamps Resend message id on an issued invoice.';

-- ═══════════════════════════════════════════════════════════
-- 5 · admin.billing_invoice_pdf_envelope
-- ═══════════════════════════════════════════════════════════
-- Returns a single jsonb with invoice + issuer + account fields needed to
-- render the PDF, eliminating three round-trips from the Route Handler.
-- public.invoices, billing.issuer_entities, and public.accounts billing_*
-- columns are all gated at the role-grant level; this SECURITY DEFINER
-- RPC is the one sanctioned read surface for the rendering path.

create or replace function admin.billing_invoice_pdf_envelope(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = admin, public, billing, pg_catalog
as $$
declare
  v_envelope jsonb;
begin
  perform admin.require_admin('platform_operator');

  if p_invoice_id is null then
    raise exception 'invoice_id required' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'id',               i.id,
      'invoice_number',   i.invoice_number,
      'fy_year',          i.fy_year,
      'fy_sequence',      i.fy_sequence,
      'issue_date',       i.issue_date,
      'due_date',         i.due_date,
      'period_start',     i.period_start,
      'period_end',       i.period_end,
      'currency',         i.currency,
      'line_items',       i.line_items,
      'subtotal_paise',   i.subtotal_paise,
      'cgst_paise',       i.cgst_paise,
      'sgst_paise',       i.sgst_paise,
      'igst_paise',       i.igst_paise,
      'total_paise',      i.total_paise,
      'status',           i.status,
      'issuer_entity_id', i.issuer_entity_id,
      'account_id',       i.account_id
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
      'bank_account_masked',   e.bank_account_masked
    ),
    'account', jsonb_build_object(
      'id',                  a.id,
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

  return v_envelope;
end;
$$;

revoke all on function admin.billing_invoice_pdf_envelope(uuid) from public;
grant execute on function admin.billing_invoice_pdf_envelope(uuid)
  to cs_admin, authenticated;

comment on function admin.billing_invoice_pdf_envelope(uuid) is
  'ADR-0050 Sprint 2.2. Returns the invoice + issuer + account fields needed to render the PDF, in a single call.';

-- ═══════════════════════════════════════════════════════════
-- Verification (run manually after apply)
-- ═══════════════════════════════════════════════════════════
--   select * from public.billing_compute_gst('KA','KA',100000);     → 9000 / 9000 / 0
--   select * from public.billing_compute_gst('KA','MH',100000);     → 0 / 0 / 18000
--   select * from public.billing_compute_gst('KA', null, 100000);   → 0 / 0 / 18000
--   select * from public.billing_compute_gst('KA','ka', 100000);    → 9000 / 9000 / 0   (case-insensitive)
--   select * from public.billing_compute_gst('KA','KA', 333);       → cgst=29 sgst=30 igst=0 (remainder to SGST)
