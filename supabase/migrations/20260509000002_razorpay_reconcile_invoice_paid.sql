-- ADR-0050 Sprint 2.3 — Razorpay invoice.paid reconciliation.
--
-- Called from the Razorpay webhook handler (anon-callable, SECURITY
-- DEFINER). Matches public.invoices by razorpay_invoice_id first, then
-- razorpay_order_id. On match, flips status → 'paid' and stamps paid_at
-- (idempotent — already-paid invoices are a no-op). No match is not
-- an error: the orphan is visible in billing.razorpay_webhook_events
-- via the verbatim row's processed_outcome (stamped by the caller).
--
-- Returned jsonb:
--   { matched: boolean,
--     invoice_id: uuid | null,
--     invoice_number: text | null,
--     previous_status: text | null,
--     new_status: text,
--     paid_at: timestamptz | null }

create or replace function public.rpc_razorpay_reconcile_invoice_paid(
  p_razorpay_invoice_id text,
  p_razorpay_order_id   text,
  p_paid_at             timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_invoice      public.invoices%rowtype;
  v_paid_at      timestamptz := coalesce(p_paid_at, now());
  v_prev_status  text;
begin
  -- At least one matcher must be present.
  if coalesce(length(p_razorpay_invoice_id), 0) = 0
     and coalesce(length(p_razorpay_order_id), 0) = 0
  then
    return jsonb_build_object(
      'matched',        false,
      'invoice_id',     null,
      'invoice_number', null,
      'previous_status',null,
      'new_status',     null,
      'paid_at',        null,
      'reason',         'no matcher'
    );
  end if;

  -- Prefer razorpay_invoice_id; fall back to razorpay_order_id.
  if coalesce(length(p_razorpay_invoice_id), 0) > 0 then
    select * into v_invoice
    from public.invoices
    where razorpay_invoice_id = p_razorpay_invoice_id
    limit 1;
  end if;

  if v_invoice.id is null and coalesce(length(p_razorpay_order_id), 0) > 0 then
    select * into v_invoice
    from public.invoices
    where razorpay_order_id = p_razorpay_order_id
    limit 1;
  end if;

  if v_invoice.id is null then
    return jsonb_build_object(
      'matched',        false,
      'invoice_id',     null,
      'invoice_number', null,
      'previous_status',null,
      'new_status',     null,
      'paid_at',        null,
      'reason',         'no matching invoice'
    );
  end if;

  v_prev_status := v_invoice.status;

  -- Idempotent: already paid → no mutation, return matched.
  if v_invoice.status = 'paid' then
    return jsonb_build_object(
      'matched',        true,
      'invoice_id',     v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'previous_status',v_prev_status,
      'new_status',     v_invoice.status,
      'paid_at',        v_invoice.paid_at,
      'reason',         'already paid'
    );
  end if;

  update public.invoices
    set status  = 'paid',
        paid_at = v_paid_at
    where id = v_invoice.id;

  return jsonb_build_object(
    'matched',        true,
    'invoice_id',     v_invoice.id,
    'invoice_number', v_invoice.invoice_number,
    'previous_status',v_prev_status,
    'new_status',     'paid',
    'paid_at',        v_paid_at,
    'reason',         'reconciled'
  );
end;
$$;

revoke all on function public.rpc_razorpay_reconcile_invoice_paid(text, text, timestamptz) from public;
grant execute on function public.rpc_razorpay_reconcile_invoice_paid(text, text, timestamptz)
  to anon, authenticated, cs_admin, cs_orchestrator;

comment on function public.rpc_razorpay_reconcile_invoice_paid(text, text, timestamptz) is
  'ADR-0050 Sprint 2.3. Flips a matching public.invoices row to status=paid on an invoice.paid webhook. Idempotent; orphans return matched=false (no error).';
