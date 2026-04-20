-- Migration: ADR-0051 Sprint 1.2 — additional evidence capture points.
--
-- Adds three trigger-driven capture points for customer-activity signals
-- the dispute bundle should carry:
--   · customer_signup       — account created (proves contractual setup)
--   · rights_request_filed  — a data subject verified-email request
--   · banner_published      — banner versioned live on a web property
--
-- All three are additive. Existing Sprint 1.1 triggers + consumers continue
-- to work unchanged. Rule 3: metadata holds category names + ids only —
-- never requestor email / name / message content.

-- ============================================================================
-- 1. Extend event_type CHECK to include the three new kinds.
-- ============================================================================
alter table billing.evidence_ledger
  drop constraint if exists evidence_ledger_event_type_check;

alter table billing.evidence_ledger
  add constraint evidence_ledger_event_type_check
  check (event_type in (
    -- plan / billing actions
    'admin_plan_change',
    'admin_refund_issued',
    'admin_plan_adjustment',
    'admin_account_suspended',
    'admin_account_restored',
    -- subscription lifecycle
    'subscription_activated',
    'subscription_charged',
    'subscription_cancelled',
    'subscription_paused',
    'subscription_resumed',
    'payment_captured',
    'payment_failed',
    -- invoice lifecycle
    'invoice_issued',
    'invoice_emailed',
    'invoice_paid',
    'invoice_voided',
    -- dispute
    'dispute_opened',
    'dispute_resolved',
    -- Sprint 1.2 — customer-activity signals
    'customer_signup',
    'rights_request_filed',
    'banner_published'
  ));

-- Extend event_source CHECK for the new trigger kinds.
alter table billing.evidence_ledger
  drop constraint if exists evidence_ledger_event_source_check;

alter table billing.evidence_ledger
  add constraint evidence_ledger_event_source_check
  check (event_source in (
    'admin_audit_trigger',
    'webhook_trigger',
    'invoice_trigger',
    'rpc_direct',
    -- Sprint 1.2
    'account_trigger',
    'rights_request_trigger',
    'banner_trigger'
  ));

-- ============================================================================
-- 2. Trigger: public.accounts INSERT → customer_signup
--
-- Fires when a new account row is created (signup path). occurred_at is
-- the account's created_at timestamp.
-- ============================================================================
create or replace function billing.evidence_capture_from_account()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
begin
  insert into billing.evidence_ledger (
    account_id, event_type, event_source, occurred_at, source_ref, metadata
  )
  values (
    NEW.id, 'customer_signup', 'account_trigger',
    coalesce(NEW.created_at, now()), NEW.id::text,
    jsonb_build_object(
      'account_name', NEW.name,
      'plan_code',    NEW.plan_code,
      'status',       NEW.status
    )
  );
  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_account_trigger on public.accounts;
create trigger evidence_capture_from_account_trigger
  after insert on public.accounts
  for each row execute function billing.evidence_capture_from_account();

-- ============================================================================
-- 3. Trigger: public.rights_requests UPDATE (email_verified null→ts)
--
-- Unverified rights requests are noise — only capture verified ones.
-- Resolves account_id via org.account_id.
-- ============================================================================
create or replace function billing.evidence_capture_from_rights_request()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
declare
  v_account_id uuid;
begin
  -- Only fire when email_verified transitions from null to ts (or false→true).
  if not (
    (OLD.email_verified_at is null and NEW.email_verified_at is not null)
  ) then
    return NEW;
  end if;

  select account_id into v_account_id
    from public.organisations where id = NEW.org_id;

  if v_account_id is null then
    return NEW;
  end if;

  insert into billing.evidence_ledger (
    account_id, org_id, event_type, event_source, occurred_at, source_ref, metadata
  )
  values (
    v_account_id, NEW.org_id, 'rights_request_filed', 'rights_request_trigger',
    NEW.email_verified_at, NEW.id::text,
    jsonb_build_object(
      'request_id',   NEW.id,
      'request_type', NEW.request_type,
      -- Rule 3: requestor email / name omitted. Category only.
      'status',       NEW.status
    )
  );
  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_rights_request_trigger on public.rights_requests;
create trigger evidence_capture_from_rights_request_trigger
  after update on public.rights_requests
  for each row execute function billing.evidence_capture_from_rights_request();

-- ============================================================================
-- 4. Trigger: public.consent_banners UPDATE (is_active false→true)
--
-- Capture banner version-publish events. Resolves account_id via org.account_id.
-- ============================================================================
create or replace function billing.evidence_capture_from_banner()
returns trigger
language plpgsql
security definer
set search_path = billing, public, pg_catalog
as $$
declare
  v_account_id uuid;
begin
  if not (OLD.is_active = false and NEW.is_active = true) then
    return NEW;
  end if;

  select account_id into v_account_id
    from public.organisations where id = NEW.org_id;

  if v_account_id is null then
    return NEW;
  end if;

  insert into billing.evidence_ledger (
    account_id, org_id, event_type, event_source, occurred_at, source_ref, metadata
  )
  values (
    v_account_id, NEW.org_id, 'banner_published', 'banner_trigger',
    now(), NEW.id::text,
    jsonb_build_object(
      'banner_id',   NEW.id,
      'version',     NEW.version,
      'property_id', NEW.property_id,
      'headline',    NEW.headline
    )
  );
  return NEW;
end;
$$;

drop trigger if exists evidence_capture_from_banner_trigger on public.consent_banners;
create trigger evidence_capture_from_banner_trigger
  after update on public.consent_banners
  for each row execute function billing.evidence_capture_from_banner();
