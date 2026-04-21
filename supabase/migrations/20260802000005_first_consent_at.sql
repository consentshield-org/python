-- ADR-0058 Sprint 1.1 — onboarding watermarks on organisations.
--
-- Three columns + one trigger:
--   first_consent_at   stamped by the AFTER INSERT trigger on
--                      consent_events the first time any consent
--                      lands for the org. Wizard Step 7 polls this.
--   onboarded_at       set by the wizard when it hands off (either
--                      Step 7 success OR Step 7 timeout — see ADR for
--                      timeout rationale).
--   onboarding_step    persisted progress so a wizard refresh restores
--                      at the last completed step (0..7).

alter table public.organisations
  add column if not exists first_consent_at timestamptz,
  add column if not exists onboarded_at     timestamptz,
  add column if not exists onboarding_step  smallint not null default 0
    check (onboarding_step between 0 and 7);

comment on column public.organisations.first_consent_at is
  'ADR-0058: stamped by trigger on first consent_events row for this org.';
comment on column public.organisations.onboarded_at is
  'ADR-0058: set by wizard when it hands off to dashboard.';
comment on column public.organisations.onboarding_step is
  'ADR-0058: 0..7 wizard progress; 7 = complete (also implies onboarded_at set).';

-- Index for the dashboard "show welcome toast?" lookup pattern.
create index if not exists organisations_pending_onboarding_idx
  on public.organisations (id)
  where onboarded_at is null;

-- Trigger: stamp first_consent_at on first consent_events insert.
-- Runs as the inserter (cs_worker for the live ingest path,
-- cs_orchestrator for delivery replay). Since first_consent_at is
-- COALESCE'd, repeated triggers don't overwrite the original
-- timestamp — once set, immutable.

create or replace function public.fn_stamp_first_consent_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.organisations
     set first_consent_at = coalesce(first_consent_at, now())
   where id = new.org_id
     and first_consent_at is null;
  return new;
end;
$$;

drop trigger if exists trg_stamp_first_consent_at on public.consent_events;
create trigger trg_stamp_first_consent_at
  after insert on public.consent_events
  for each row
  execute function public.fn_stamp_first_consent_at();

comment on function public.fn_stamp_first_consent_at() is
  'ADR-0058: idempotent stamp of organisations.first_consent_at on first consent_events insert.';

-- The function is SECURITY DEFINER so it can update organisations even
-- when the inserting role (cs_worker) lacks UPDATE on organisations.
-- The function body is narrow (single UPDATE; no caller-controlled SQL)
-- so the privilege widening is safe.
