-- ADR-0034 Sprint 2.2 — refund outcome RPCs.
--
-- After admin.billing_create_refund writes a pending ledger row, the
-- admin Next.js app calls Razorpay's POST /v1/payments/:id/refund. The
-- response tells us whether the refund was issued or failed; we need
-- two RPCs to record the outcome + write the matching audit-log row.
--
-- Both RPCs are support+ (same tier as billing_create_refund) and
-- idempotent on pending→terminal transitions (they raise if the row
-- is already terminal, so a retry doesn't silently clobber).

create or replace function admin.billing_mark_refund_issued(
  p_refund_id          uuid,
  p_razorpay_refund_id text
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_row   public.refunds%rowtype;
begin
  perform admin.require_admin('support');
  if p_razorpay_refund_id is null or length(p_razorpay_refund_id) = 0 then
    raise exception 'razorpay_refund_id required';
  end if;

  select * into v_row from public.refunds where id = p_refund_id;
  if v_row.id is null then
    raise exception 'refund not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'refund already terminal (status=%)', v_row.status;
  end if;

  update public.refunds
     set status             = 'issued',
         razorpay_refund_id = p_razorpay_refund_id,
         issued_at          = now()
   where id = p_refund_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_mark_refund_issued', 'public.refunds', p_refund_id, null,
     jsonb_build_object('status', 'pending'),
     jsonb_build_object(
       'status', 'issued',
       'razorpay_refund_id', p_razorpay_refund_id,
       'account_id', v_row.account_id
     ),
     'Razorpay round-trip succeeded');
end;
$$;

grant execute on function admin.billing_mark_refund_issued(uuid, text) to cs_admin;

create or replace function admin.billing_mark_refund_failed(
  p_refund_id      uuid,
  p_failure_reason text
)
returns void
language plpgsql
security definer
set search_path = public, admin, pg_catalog
as $$
declare
  v_admin uuid := auth.uid();
  v_row   public.refunds%rowtype;
begin
  perform admin.require_admin('support');
  if p_failure_reason is null or length(p_failure_reason) = 0 then
    raise exception 'failure_reason required';
  end if;

  select * into v_row from public.refunds where id = p_refund_id;
  if v_row.id is null then
    raise exception 'refund not found';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'refund already terminal (status=%)', v_row.status;
  end if;

  update public.refunds
     set status         = 'failed',
         failure_reason = p_failure_reason
   where id = p_refund_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_admin, 'billing_mark_refund_failed', 'public.refunds', p_refund_id, null,
     jsonb_build_object('status', 'pending'),
     jsonb_build_object(
       'status', 'failed',
       'failure_reason', p_failure_reason,
       'account_id', v_row.account_id
     ),
     'Razorpay round-trip failed');
end;
$$;

grant execute on function admin.billing_mark_refund_failed(uuid, text) to cs_admin;

-- Verification:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'admin' and proname like 'billing_mark_refund%';
--    → 2 rows.
