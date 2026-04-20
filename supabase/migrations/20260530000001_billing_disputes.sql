-- Migration: ADR-0050 Sprint 3.2 — public.disputes table + dispute-upsert RPC + admin RPCs
--
-- Adds the dispute workspace: a durable record of every Razorpay chargeback/dispute
-- event, linked to the originating payment and account. Webhook handler extends to
-- call rpc_razorpay_dispute_upsert after the verbatim insert so the dispute row is
-- created/updated atomically. Admin RPCs handle evidence bundle tagging and status
-- transitions.

-- ============================================================================
-- 1. public.disputes
-- ============================================================================

create table if not exists public.disputes (
  id                      uuid         primary key default gen_random_uuid(),
  razorpay_dispute_id     text         not null unique,
  razorpay_payment_id     text         not null,
  account_id              uuid         references public.accounts(id) on delete restrict,
  invoice_id              uuid         references public.invoices(id) on delete restrict,
  status                  text         not null
    check (status in ('open', 'under_review', 'won', 'lost', 'closed')),
  amount_paise            bigint       not null,
  currency                text         not null default 'INR',
  reason_code             text,
  phase                   text
    check (phase in ('chargeback', 'pre_arbitration', 'arbitration')),
  deadline_at             timestamptz,
  evidence_bundle_r2_key  text,
  evidence_assembled_at   timestamptz,
  submitted_at            timestamptz,
  resolved_at             timestamptz,
  resolved_reason         text,
  opened_at               timestamptz  not null,
  created_at              timestamptz  not null default now(),
  updated_at              timestamptz  not null default now()
);

create index if not exists disputes_account_idx
  on public.disputes (account_id, opened_at desc)
  where account_id is not null;

create index if not exists disputes_payment_idx
  on public.disputes (razorpay_payment_id);

create index if not exists disputes_status_deadline_idx
  on public.disputes (status, deadline_at)
  where status = 'open';

alter table public.disputes enable row level security;

-- cs_admin: read-only (dispute workspace + debugging)
grant select on public.disputes to cs_admin;

-- cs_orchestrator: full write for webhook upserts + state transitions
grant select, insert, update on public.disputes to cs_orchestrator;

-- No authenticated / anon access (disputes are admin-only data)

create policy "cs_admin select disputes"
  on public.disputes
  for select
  to cs_admin
  using (true);

create policy "cs_orchestrator all disputes"
  on public.disputes
  for all
  to cs_orchestrator
  using (true)
  with check (true);

-- ============================================================================
-- 2. updated_at trigger
-- ============================================================================

create or replace function public.disputes_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

create trigger disputes_updated_at_trigger
  before update on public.disputes
  for each row execute function public.disputes_set_updated_at();

-- ============================================================================
-- 3. public.rpc_razorpay_dispute_upsert
--
-- Called by the webhook handler after the verbatim insert for dispute.* events.
-- Upserts the dispute row and resolves account_id by looking up the payment_id
-- in prior webhook events (subscription.charged / payment.captured events
-- that carried the same payment entity id and a resolved account_id).
-- Callable by anon (same pattern as rpc_razorpay_webhook_insert_verbatim).
-- ============================================================================

create or replace function public.rpc_razorpay_dispute_upsert(
  p_razorpay_dispute_id  text,
  p_event_type           text,
  p_razorpay_payment_id  text,
  p_amount_paise         bigint,
  p_currency             text,
  p_reason_code          text,
  p_phase                text,
  p_deadline_at          timestamptz,
  p_opened_at            timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, billing, pg_catalog
as $$
declare
  v_account_id  uuid;
  v_new_status  text;
  v_dispute_id  uuid;
begin
  if length(coalesce(p_razorpay_dispute_id, '')) < 1 then
    raise exception 'p_razorpay_dispute_id required';
  end if;

  -- Resolve account from prior webhook events that carried this payment entity
  if p_razorpay_payment_id is not null then
    select account_id into v_account_id
      from billing.razorpay_webhook_events
     where payload->'payload'->'payment'->'entity'->>'id' = p_razorpay_payment_id
       and account_id is not null
     order by received_at desc
     limit 1;
  end if;

  -- Map event type to dispute status
  v_new_status := case p_event_type
    when 'dispute.created'  then 'open'
    when 'dispute.won'      then 'won'
    when 'dispute.lost'     then 'lost'
    when 'dispute.closed'   then 'closed'
    else 'under_review'
  end;

  insert into public.disputes
    (razorpay_dispute_id, razorpay_payment_id, account_id, status,
     amount_paise, currency, reason_code, phase, deadline_at, opened_at)
  values
    (p_razorpay_dispute_id, p_razorpay_payment_id, v_account_id, v_new_status,
     p_amount_paise, p_currency, p_reason_code, p_phase, p_deadline_at, p_opened_at)
  on conflict (razorpay_dispute_id) do update
    set status     = excluded.status,
        deadline_at = coalesce(excluded.deadline_at, disputes.deadline_at),
        account_id  = coalesce(disputes.account_id, excluded.account_id),
        resolved_at = case
          when excluded.status in ('won', 'lost', 'closed') then now()
          else disputes.resolved_at
        end,
        updated_at  = now()
  returning id into v_dispute_id;

  return jsonb_build_object(
    'dispute_id',  v_dispute_id,
    'account_id',  v_account_id,
    'status',      v_new_status
  );
end;
$$;

revoke execute on function public.rpc_razorpay_dispute_upsert(text, text, text, bigint, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.rpc_razorpay_dispute_upsert(text, text, text, bigint, text, text, text, timestamptz, timestamptz)
  to anon, authenticated, cs_orchestrator;

-- ============================================================================
-- 4. admin.billing_dispute_set_evidence
--
-- Called by the evidence bundle server action after uploading to R2.
-- Records the r2 key, timestamps, and audit-logs the assembly event.
-- ============================================================================

create or replace function admin.billing_dispute_set_evidence(
  p_dispute_id  uuid,
  p_r2_key      text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator  uuid := auth.uid();
begin
  perform admin.require_admin('platform_operator');

  if not exists (select 1 from public.disputes where id = p_dispute_id) then
    raise exception 'dispute not found: %', p_dispute_id;
  end if;

  update public.disputes
     set evidence_bundle_r2_key = p_r2_key,
         evidence_assembled_at  = now()
   where id = p_dispute_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_dispute_evidence_assembled', 'public.disputes', p_dispute_id, null,
     null,
     jsonb_build_object('r2_key', p_r2_key, 'assembled_at', now()),
     'Evidence bundle assembled and uploaded to R2');
end;
$$;

revoke execute on function admin.billing_dispute_set_evidence(uuid, text) from public;
grant execute on function admin.billing_dispute_set_evidence(uuid, text) to cs_admin;

-- ============================================================================
-- 5. admin.billing_dispute_mark_state
--
-- State transitions: submitted, won, lost, closed. Requires a reason.
-- ============================================================================

create or replace function admin.billing_dispute_mark_state(
  p_dispute_id  uuid,
  p_new_status  text,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = admin, public, pg_catalog
as $$
declare
  v_operator    uuid := auth.uid();
  v_old_status  text;
begin
  perform admin.require_admin('platform_operator');

  if p_new_status not in ('under_review', 'won', 'lost', 'closed') then
    raise exception 'invalid status transition: %', p_new_status;
  end if;
  if length(coalesce(p_reason, '')) < 1 then
    raise exception 'reason required for state transition';
  end if;

  select status into v_old_status from public.disputes where id = p_dispute_id;
  if v_old_status is null then
    raise exception 'dispute not found: %', p_dispute_id;
  end if;

  update public.disputes
     set status          = p_new_status,
         submitted_at    = case when p_new_status = 'under_review' then now() else submitted_at end,
         resolved_at     = case when p_new_status in ('won', 'lost', 'closed') then now() else resolved_at end,
         resolved_reason = case when p_new_status in ('won', 'lost', 'closed') then p_reason else resolved_reason end
   where id = p_dispute_id;

  insert into admin.admin_audit_log
    (admin_user_id, action, target_table, target_id, org_id, old_value, new_value, reason)
  values
    (v_operator, 'billing_dispute_state_change', 'public.disputes', p_dispute_id, null,
     jsonb_build_object('status', v_old_status),
     jsonb_build_object('status', p_new_status),
     p_reason);
end;
$$;

revoke execute on function admin.billing_dispute_mark_state(uuid, text, text) from public;
grant execute on function admin.billing_dispute_mark_state(uuid, text, text) to cs_admin;

-- ============================================================================
-- Verification
-- ============================================================================
-- select column_name from information_schema.columns where table_name = 'disputes' order by ordinal_position;
-- select polname from pg_policies where tablename = 'disputes';
-- select proname from pg_proc where pronamespace = 'public'::regnamespace and proname like 'rpc_razorpay_dispute%';
-- select proname from pg_proc where pronamespace = 'admin'::regnamespace and proname like 'billing_dispute%';
