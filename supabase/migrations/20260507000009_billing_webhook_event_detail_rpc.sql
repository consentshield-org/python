-- ADR-0050 Sprint 2.1 chunk 3 follow-up — admin.billing_webhook_event_detail.
--
-- Dispute workspace (Sprint 3.2) will read verbatim webhook events
-- by event_id to build the event timeline on a dispute detail page.
-- Billing schema is intentionally not PostgREST-exposed (every read
-- goes through an admin.* RPC), so we ship this single-row reader
-- now. Platform_operator+ gated.

create or replace function admin.billing_webhook_event_detail(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = billing, admin, public, pg_catalog
as $$
declare
  v_row billing.razorpay_webhook_events%rowtype;
begin
  perform admin.require_admin('platform_operator');

  select * into v_row
    from billing.razorpay_webhook_events
   where event_id = p_event_id;

  if not found then
    raise exception 'Webhook event % not found', p_event_id using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id',                 v_row.id,
    'event_id',           v_row.event_id,
    'event_type',         v_row.event_type,
    'signature_verified', v_row.signature_verified,
    'signature',          v_row.signature,
    'payload',            v_row.payload,
    'account_id',         v_row.account_id,
    'received_at',        v_row.received_at,
    'processed_at',       v_row.processed_at,
    'processed_outcome',  v_row.processed_outcome
  );
end;
$$;

grant execute on function admin.billing_webhook_event_detail(text) to cs_admin, authenticated;
