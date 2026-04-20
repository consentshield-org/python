-- Migration: ADR-0046 Phase 2 Sprint 2.1 — DPIA records schema + RPCs.
--
-- Adds public.dpia_records so Significant Data Fiduciaries (SDFs) can
-- record DPDP §10(d) DPIA cycles in ConsentShield. Rule 3 respected —
-- we store structured metadata + category declarations + references to
-- the customer-held DPIA artefact, never the DPIA document bytes
-- themselves (customers keep the narrative PDF in their own storage).
--
-- Write path is restricted to `org_admin` effective role (account_owner
-- of the parent account inherits org_admin via effective_org_role).
-- Read path is open to any member of the org.
--
-- DPIA lifecycle: draft → published → superseded.
-- Superseded DPIAs link to their replacement via superseded_by.

-- ============================================================================
-- 1. public.dpia_records
-- ============================================================================
create table if not exists public.dpia_records (
  id                       uuid        primary key default gen_random_uuid(),
  org_id                   uuid        not null references public.organisations(id) on delete cascade,
  title                    text        not null check (length(title) between 3 and 200),
  processing_description   text        not null check (length(processing_description) between 10 and 5000),
  -- Array of category strings only (e.g. ["contact.email", "financial.balance_range"]); never raw values.
  data_categories          jsonb       not null default '[]'::jsonb check (jsonb_typeof(data_categories) = 'array'),
  risk_level               text        not null check (risk_level in ('low','medium','high')),
  -- Structured mitigation object (freeform but JSONB-shape-checked).
  mitigations              jsonb       not null default '{}'::jsonb check (jsonb_typeof(mitigations) = 'object'),
  auditor_attestation_ref  text        check (auditor_attestation_ref is null or length(auditor_attestation_ref) <= 500),
  auditor_name             text        check (auditor_name is null or length(auditor_name) between 2 and 200),
  conducted_at             date        not null,
  next_review_at           date,
  status                   text        not null default 'draft'
                             check (status in ('draft','published','superseded')),
  superseded_by            uuid        references public.dpia_records(id) on delete set null,
  created_by               uuid        not null references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  published_at             timestamptz,
  superseded_at            timestamptz
);

create index if not exists dpia_records_org_idx
  on public.dpia_records (org_id, status, conducted_at desc);
create index if not exists dpia_records_review_due_idx
  on public.dpia_records (next_review_at)
  where status = 'published' and next_review_at is not null;

alter table public.dpia_records enable row level security;

-- ══════════════════════════════════════════════════════════
-- 2. RLS policies — read via effective_org_role (covers account_owner inheritance)
-- ══════════════════════════════════════════════════════════

drop policy if exists dpia_records_read on public.dpia_records;
create policy dpia_records_read on public.dpia_records
  for select to authenticated
  using (public.effective_org_role(org_id) is not null);

-- Writes are RPC-only; revoke direct write grants
revoke insert, update, delete on public.dpia_records from authenticated, anon, public;
grant select on public.dpia_records to authenticated;
grant select, insert, update on public.dpia_records to cs_orchestrator;

-- ══════════════════════════════════════════════════════════
-- 3. updated_at trigger
-- ══════════════════════════════════════════════════════════

create or replace function public.dpia_records_set_updated_at()
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

drop trigger if exists dpia_records_updated_at_trigger on public.dpia_records;
create trigger dpia_records_updated_at_trigger
  before update on public.dpia_records
  for each row execute function public.dpia_records_set_updated_at();

-- ══════════════════════════════════════════════════════════
-- 4. public.create_dpia_record
-- ══════════════════════════════════════════════════════════
create or replace function public.create_dpia_record(
  p_org_id                  uuid,
  p_title                   text,
  p_processing_description  text,
  p_data_categories         jsonb,
  p_risk_level              text,
  p_mitigations             jsonb,
  p_auditor_attestation_ref text,
  p_auditor_name            text,
  p_conducted_at            date,
  p_next_review_at          date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid        uuid := public.current_uid();
  v_eff_role   text;
  v_id         uuid;
begin
  if v_uid is null then
    raise exception 'no_auth_context' using errcode = '42501';
  end if;

  v_eff_role := public.effective_org_role(p_org_id);
  if v_eff_role is null or v_eff_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if p_conducted_at is null then
    raise exception 'conducted_at required';
  end if;
  if p_next_review_at is not null and p_next_review_at < p_conducted_at then
    raise exception 'next_review_at cannot precede conducted_at';
  end if;

  insert into public.dpia_records (
    org_id, title, processing_description, data_categories, risk_level,
    mitigations, auditor_attestation_ref, auditor_name,
    conducted_at, next_review_at, status, created_by
  ) values (
    p_org_id, p_title, p_processing_description,
    coalesce(p_data_categories, '[]'::jsonb), p_risk_level,
    coalesce(p_mitigations, '{}'::jsonb), p_auditor_attestation_ref, p_auditor_name,
    p_conducted_at, p_next_review_at, 'draft', v_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_dpia_record(uuid, text, text, jsonb, text, jsonb, text, text, date, date) from public;
grant execute on function public.create_dpia_record(uuid, text, text, jsonb, text, jsonb, text, text, date, date) to authenticated;

-- ══════════════════════════════════════════════════════════
-- 5. public.publish_dpia_record
-- ══════════════════════════════════════════════════════════
create or replace function public.publish_dpia_record(p_dpia_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_org_id     uuid;
  v_status     text;
  v_eff_role   text;
begin
  select org_id, status into v_org_id, v_status
    from public.dpia_records where id = p_dpia_id;

  if v_org_id is null then
    raise exception 'dpia_not_found' using errcode = '42501';
  end if;

  v_eff_role := public.effective_org_role(v_org_id);
  if v_eff_role is null or v_eff_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_status != 'draft' then
    raise exception 'cannot_publish_from_status:%', v_status;
  end if;

  update public.dpia_records
     set status = 'published', published_at = now()
   where id = p_dpia_id;
end;
$$;

revoke execute on function public.publish_dpia_record(uuid) from public;
grant execute on function public.publish_dpia_record(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════
-- 6. public.supersede_dpia_record
--
-- Flips old record to 'superseded', stamps superseded_at + superseded_by.
-- Replacement record must exist and belong to the same org. Replacement
-- must be in 'draft' or 'published' status; if draft, publish it now.
-- ══════════════════════════════════════════════════════════
create or replace function public.supersede_dpia_record(
  p_old_id          uuid,
  p_replacement_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_old_org_id         uuid;
  v_old_status         text;
  v_replacement_org_id uuid;
  v_replacement_status text;
  v_eff_role           text;
begin
  if p_old_id = p_replacement_id then
    raise exception 'replacement cannot equal old record';
  end if;

  select org_id, status into v_old_org_id, v_old_status
    from public.dpia_records where id = p_old_id;
  if v_old_org_id is null then
    raise exception 'old_dpia_not_found' using errcode = '42501';
  end if;

  select org_id, status into v_replacement_org_id, v_replacement_status
    from public.dpia_records where id = p_replacement_id;
  if v_replacement_org_id is null then
    raise exception 'replacement_dpia_not_found' using errcode = '42501';
  end if;

  if v_old_org_id != v_replacement_org_id then
    raise exception 'replacement must belong to same org';
  end if;

  v_eff_role := public.effective_org_role(v_old_org_id);
  if v_eff_role is null or v_eff_role not in ('org_admin', 'admin') then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_old_status not in ('draft', 'published') then
    raise exception 'cannot_supersede_from_status:%', v_old_status;
  end if;

  -- Auto-publish replacement if still draft.
  if v_replacement_status = 'draft' then
    update public.dpia_records
       set status = 'published', published_at = now()
     where id = p_replacement_id;
  end if;

  update public.dpia_records
     set status = 'superseded', superseded_at = now(), superseded_by = p_replacement_id
   where id = p_old_id;
end;
$$;

revoke execute on function public.supersede_dpia_record(uuid, uuid) from public;
grant execute on function public.supersede_dpia_record(uuid, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════
-- Verification (manual)
-- ══════════════════════════════════════════════════════════
-- select column_name from information_schema.columns
--   where table_name = 'dpia_records' order by ordinal_position;
-- select polname from pg_policies where tablename = 'dpia_records';
-- select proname from pg_proc where pronamespace = 'public'::regnamespace
--   and proname in ('create_dpia_record','publish_dpia_record','supersede_dpia_record');
