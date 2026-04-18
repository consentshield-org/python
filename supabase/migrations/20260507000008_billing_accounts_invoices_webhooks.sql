-- ADR-0050 Sprint 2.1 chunk 3 — accounts billing-profile + invoices + verbatim Razorpay store.
--
-- Three blocks:
--   1. public.accounts — nullable billing_* columns (required at first
--      invoice issuance; ADR-0054 will wire the customer-side form).
--   2. public.invoices — canonical invoice record. REVOKE DELETE from
--      every app-code role; UPDATE restricted to a narrow allow-list
--      via BEFORE UPDATE trigger. invoice PDFs land in R2 (chunk 4);
--      this migration only ships the schema.
--   3. billing.razorpay_webhook_events — verbatim, signature-verified,
--      append-only store of every Razorpay webhook. INSERT via a
--      public.rpc_razorpay_webhook_insert_verbatim RPC that resolves
--      account_id from subscription / customer ids in the payload.
--      Webhook handler refactor in app/src/app/api/webhooks/razorpay/
--      route.ts calls this RPC before any state mutation.

-- ═══════════════════════════════════════════════════════════
-- 1 · public.accounts billing-profile columns
-- ═══════════════════════════════════════════════════════════

alter table public.accounts
  add column if not exists billing_legal_name text,
  add column if not exists billing_gstin text,
  add column if not exists billing_state_code text,
  add column if not exists billing_address text,
  add column if not exists billing_email text,
  add column if not exists billing_profile_updated_at timestamptz;

comment on column public.accounts.billing_legal_name is
  'ADR-0050 Sprint 2.1. Legal name as billed. Required by admin.billing_issue_invoice.';
comment on column public.accounts.billing_gstin is
  'ADR-0050 Sprint 2.1. Customer GSTIN if registered; null = unregistered customer. Drives IGST vs CGST+SGST via state_code match.';
comment on column public.accounts.billing_state_code is
  'ADR-0050 Sprint 2.1. 2-digit GST state code. When equal to issuer.registered_state_code → CGST+SGST; otherwise → IGST.';

-- ═══════════════════════════════════════════════════════════
-- 2 · public.invoices
-- ═══════════════════════════════════════════════════════════

create table if not exists public.invoices (
  id                   uuid         primary key default gen_random_uuid(),
  issuer_entity_id     uuid         not null references billing.issuer_entities(id) on delete restrict,
  account_id           uuid         not null references public.accounts(id) on delete restrict,
  invoice_number       text         not null,
  fy_year              text         not null,
  fy_sequence          integer      not null,
  period_start         date         not null,
  period_end           date         not null,
  issue_date           date         not null default current_date,
  due_date             date         not null,
  currency             text         not null default 'INR',
  line_items           jsonb        not null,
  subtotal_paise       bigint       not null,
  cgst_paise           bigint       not null default 0,
  sgst_paise           bigint       not null default 0,
  igst_paise           bigint       not null default 0,
  total_paise          bigint       not null,
  status               text         not null
                          check (status in ('draft','issued','paid','partially_paid','overdue','void','refunded')),
  razorpay_invoice_id  text,
  razorpay_order_id    text,
  pdf_r2_key           text,
  pdf_sha256           text,
  issued_at            timestamptz,
  paid_at              timestamptz,
  voided_at            timestamptz,
  voided_reason        text,
  email_message_id     text,
  email_delivered_at   timestamptz,
  notes                text,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now()
);

create unique index if not exists invoices_issuer_fy_seq_uniq
  on public.invoices (issuer_entity_id, fy_year, fy_sequence);
create unique index if not exists invoices_issuer_number_uniq
  on public.invoices (issuer_entity_id, invoice_number);
create index if not exists invoices_account_issue_idx
  on public.invoices (account_id, issue_date desc);
create index if not exists invoices_status_idx
  on public.invoices (status)
  where status not in ('paid', 'void');
create index if not exists invoices_razorpay_invoice_idx
  on public.invoices (razorpay_invoice_id)
  where razorpay_invoice_id is not null;

alter table public.invoices enable row level security;

-- No direct-access policies — all access via admin RPCs. Customer-side
-- read policy lands in ADR-0054. Revoke everything the DDL owner
-- implicitly grants to app-code roles; re-grant narrowly.
revoke all on public.invoices from public, authenticated, anon;
revoke all on public.invoices from cs_admin, cs_orchestrator, cs_delivery, cs_worker;

-- cs_admin: SELECT only (admin RPCs read through this; the SECURITY
-- DEFINER path overrides anyway but this makes the grant explicit).
grant select on public.invoices to cs_admin;

-- cs_orchestrator: INSERT + SELECT + UPDATE (webhook reconciliation flips
-- status to 'paid' on invoice.paid events; Razorpay ids recorded).
-- No DELETE on any role — invoices are immutable.
grant insert, select, update on public.invoices to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 3 · Invoice allow-list UPDATE trigger
-- ═══════════════════════════════════════════════════════════
-- Immutable columns:
--   id, issuer_entity_id, account_id, invoice_number, fy_year, fy_sequence,
--   period_start, period_end, issue_date, due_date, currency, line_items,
--   subtotal_paise, cgst_paise, sgst_paise, igst_paise, total_paise,
--   created_at
-- Mutable (allow-list):
--   status, razorpay_invoice_id, razorpay_order_id, pdf_r2_key, pdf_sha256,
--   issued_at, paid_at, voided_at, voided_reason, email_message_id,
--   email_delivered_at, notes, updated_at

create or replace function public.invoices_enforce_immutability()
returns trigger
language plpgsql
as $$
begin
  if NEW.id                is distinct from OLD.id                then raise exception 'Immutable column `id` on public.invoices' using errcode = '42501'; end if;
  if NEW.issuer_entity_id  is distinct from OLD.issuer_entity_id  then raise exception 'Immutable column `issuer_entity_id` on public.invoices' using errcode = '42501'; end if;
  if NEW.account_id        is distinct from OLD.account_id        then raise exception 'Immutable column `account_id` on public.invoices' using errcode = '42501'; end if;
  if NEW.invoice_number    is distinct from OLD.invoice_number    then raise exception 'Immutable column `invoice_number` on public.invoices' using errcode = '42501'; end if;
  if NEW.fy_year           is distinct from OLD.fy_year           then raise exception 'Immutable column `fy_year` on public.invoices' using errcode = '42501'; end if;
  if NEW.fy_sequence       is distinct from OLD.fy_sequence       then raise exception 'Immutable column `fy_sequence` on public.invoices' using errcode = '42501'; end if;
  if NEW.period_start      is distinct from OLD.period_start      then raise exception 'Immutable column `period_start` on public.invoices' using errcode = '42501'; end if;
  if NEW.period_end        is distinct from OLD.period_end        then raise exception 'Immutable column `period_end` on public.invoices' using errcode = '42501'; end if;
  if NEW.issue_date        is distinct from OLD.issue_date        then raise exception 'Immutable column `issue_date` on public.invoices' using errcode = '42501'; end if;
  if NEW.due_date          is distinct from OLD.due_date          then raise exception 'Immutable column `due_date` on public.invoices' using errcode = '42501'; end if;
  if NEW.currency          is distinct from OLD.currency          then raise exception 'Immutable column `currency` on public.invoices' using errcode = '42501'; end if;
  if NEW.line_items        is distinct from OLD.line_items        then raise exception 'Immutable column `line_items` on public.invoices' using errcode = '42501'; end if;
  if NEW.subtotal_paise    is distinct from OLD.subtotal_paise    then raise exception 'Immutable column `subtotal_paise` on public.invoices' using errcode = '42501'; end if;
  if NEW.cgst_paise        is distinct from OLD.cgst_paise        then raise exception 'Immutable column `cgst_paise` on public.invoices' using errcode = '42501'; end if;
  if NEW.sgst_paise        is distinct from OLD.sgst_paise        then raise exception 'Immutable column `sgst_paise` on public.invoices' using errcode = '42501'; end if;
  if NEW.igst_paise        is distinct from OLD.igst_paise        then raise exception 'Immutable column `igst_paise` on public.invoices' using errcode = '42501'; end if;
  if NEW.total_paise       is distinct from OLD.total_paise       then raise exception 'Immutable column `total_paise` on public.invoices' using errcode = '42501'; end if;
  if NEW.created_at        is distinct from OLD.created_at        then raise exception 'Immutable column `created_at` on public.invoices' using errcode = '42501'; end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists invoices_enforce_immutability on public.invoices;
create trigger invoices_enforce_immutability
  before update on public.invoices
  for each row execute function public.invoices_enforce_immutability();

-- ═══════════════════════════════════════════════════════════
-- 4 · billing.razorpay_webhook_events
-- ═══════════════════════════════════════════════════════════

create table if not exists billing.razorpay_webhook_events (
  id                 uuid         primary key default gen_random_uuid(),
  event_id           text         not null unique,
  event_type         text         not null,
  signature_verified boolean      not null,
  signature          text         not null,
  payload            jsonb        not null,
  account_id         uuid         references public.accounts(id) on delete set null,
  received_at        timestamptz  not null default now(),
  processed_at       timestamptz,
  processed_outcome  text
);

create index if not exists razorpay_webhook_events_type_recv_idx
  on billing.razorpay_webhook_events (event_type, received_at desc);
create index if not exists razorpay_webhook_events_account_idx
  on billing.razorpay_webhook_events (account_id, received_at desc)
  where account_id is not null;
create index if not exists razorpay_webhook_events_unprocessed_idx
  on billing.razorpay_webhook_events (received_at desc)
  where processed_at is null;

alter table billing.razorpay_webhook_events enable row level security;

-- Admin read (dispute workspace + debugging); writes only via the RPCs
-- below which are SECURITY DEFINER (so these role grants are a belt).
grant select on billing.razorpay_webhook_events to cs_admin;
grant insert, select, update on billing.razorpay_webhook_events to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 5 · public.rpc_razorpay_webhook_insert_verbatim
-- ═══════════════════════════════════════════════════════════
-- Called by the webhook handler AFTER signature verification passes, and
-- BEFORE any state-mutation work. Resolves account_id by matching the
-- subscription / customer id found in the payload against public.accounts.
-- Uses ON CONFLICT (event_id) DO NOTHING so Razorpay retries of the same
-- event do not double-insert; returns {id, account_id, duplicate} so the
-- handler can dedup its downstream logic.

create or replace function public.rpc_razorpay_webhook_insert_verbatim(
  p_event_id   text,
  p_event_type text,
  p_signature  text,
  p_payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, billing, pg_catalog
as $$
declare
  v_row_id          uuid;
  v_account_id      uuid;
  v_subscription_id text;
  v_customer_id     text;
  v_is_duplicate    boolean := false;
begin
  if length(coalesce(p_event_id, '')) < 1 then
    raise exception 'p_event_id required';
  end if;

  v_subscription_id := p_payload->'payload'->'subscription'->'entity'->>'id';
  v_customer_id     := p_payload->'payload'->'customer'->'entity'->>'id';

  if v_subscription_id is not null then
    select id into v_account_id
      from public.accounts
     where razorpay_subscription_id = v_subscription_id
     limit 1;
  end if;
  if v_account_id is null and v_customer_id is not null then
    select id into v_account_id
      from public.accounts
     where razorpay_customer_id = v_customer_id
     limit 1;
  end if;

  insert into billing.razorpay_webhook_events
    (event_id, event_type, signature_verified, signature, payload, account_id)
  values
    (p_event_id, p_event_type, true, p_signature, p_payload, v_account_id)
  on conflict (event_id) do nothing
  returning id into v_row_id;

  if v_row_id is null then
    select id, account_id
      into v_row_id, v_account_id
      from billing.razorpay_webhook_events
     where event_id = p_event_id;
    v_is_duplicate := true;
  end if;

  return jsonb_build_object(
    'id',         v_row_id,
    'account_id', v_account_id,
    'duplicate',  v_is_duplicate
  );
end;
$$;

grant execute on function public.rpc_razorpay_webhook_insert_verbatim(text, text, text, jsonb)
  to anon, authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- 6 · public.rpc_razorpay_webhook_stamp_processed
-- ═══════════════════════════════════════════════════════════
-- Called by the webhook handler AFTER state mutation completes. Sets
-- processed_at + processed_outcome on the verbatim row. Idempotent:
-- only stamps when processed_at is null (Razorpay retries of the same
-- event don't double-stamp).

create or replace function public.rpc_razorpay_webhook_stamp_processed(
  p_event_id text,
  p_outcome  text
)
returns void
language plpgsql
security definer
set search_path = public, billing, pg_catalog
as $$
begin
  update billing.razorpay_webhook_events
     set processed_at      = now(),
         processed_outcome = p_outcome
   where event_id = p_event_id
     and processed_at is null;
end;
$$;

grant execute on function public.rpc_razorpay_webhook_stamp_processed(text, text)
  to anon, authenticated, cs_orchestrator;

-- Verification:
--   \d public.invoices                              → triggers + indexes present
--   \d billing.razorpay_webhook_events              → unique(event_id) + RLS enabled
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and proname in ('rpc_razorpay_webhook_insert_verbatim','rpc_razorpay_webhook_stamp_processed');
--     → 2 rows
