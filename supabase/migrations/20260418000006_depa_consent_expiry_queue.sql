-- ADR-0020 Sprint 1.1 — DEPA consent_expiry_queue table.
--
-- Part 6 of 9: scheduled expiry management per artefact. One row per
-- finite-expiry artefact, created by trigger on consent_artefacts INSERT
-- (trg_consent_artefact_expiry_queue — wired in this migration now that
-- the target table exists).
--
-- Per §11.4.5 + §11.5 + §11.6 + §11.7 + §11.8.
--
-- Rows are retained as a historical expiry audit trail — NOT deleted
-- after processing. Expiry enforcement (enforce_artefact_expiry) is
-- deferred to ADR-0023; send_expiry_alerts is deferred to ADR-0023.
-- This migration ships only the table + the insert-on-artefact-create
-- trigger.

create table consent_expiry_queue (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organisations(id) on delete cascade,
  artefact_id     text not null references consent_artefacts(artefact_id) on delete cascade,
  purpose_code    text not null,
  expires_at      timestamptz not null,
  notify_at       timestamptz not null,
  notified_at     timestamptz,
  processed_at    timestamptz,
  superseded      boolean not null default false,
  created_at      timestamptz default now()
);

comment on table consent_expiry_queue is
  'Scheduled expiry management for consent artefacts. One row per '
  'finite-expiry artefact, created by trigger on consent_artefacts '
  'INSERT. notify_at fires expiry alerts via send_expiry_alerts() '
  'pg_cron (ADR-0023); enforce_artefact_expiry() reads consent_artefacts '
  'directly and updates this table as a side effect. Rows are NOT deleted '
  'after processing — they form a historical expiry audit trail.';

-- Indexes (§11.5)
create index idx_expiry_queue_alert_pending
  on consent_expiry_queue (notify_at)
  where notified_at is null and superseded = false;
create index idx_expiry_queue_org_upcoming
  on consent_expiry_queue (org_id, expires_at)
  where processed_at is null and superseded = false;
create index idx_expiry_queue_artefact
  on consent_expiry_queue (artefact_id);

-- RLS (§11.6) — read-only for authenticated.
alter table consent_expiry_queue enable row level security;

create policy "expiry_queue_select_own"
  on consent_expiry_queue for select
  using (org_id = current_org_id());

-- Grants (§11.7) — authenticated reads via RLS. cs_orchestrator reads +
-- updates (notified_at, processed_at, superseded) during the expiry
-- pipeline (ADR-0023). The table receives INSERTs via the trigger
-- function, which runs as SECURITY DEFINER — no direct INSERT grant
-- needed for authenticated.
grant select on consent_expiry_queue to authenticated;
grant select on consent_expiry_queue to cs_orchestrator;
grant update (notified_at, processed_at, superseded)
              on consent_expiry_queue to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- trigger_process_consent_event trigger function + trigger are NOT
-- created here — they dispatch to an Edge Function that does not exist
-- yet (ADR-0021 wires them).
--
-- trg_consent_artefact_expiry_queue (AFTER INSERT on consent_artefacts):
-- creates a consent_expiry_queue row for every finite-expiry artefact.
-- Artefacts with expires_at = 'infinity' are skipped.
-- ═══════════════════════════════════════════════════════════
create or replace function trg_artefact_create_expiry_entry()
returns trigger language plpgsql security definer as $$
begin
  if new.expires_at < 'infinity'::timestamptz then
    insert into consent_expiry_queue (
      org_id, artefact_id, purpose_code, expires_at, notify_at
    ) values (
      new.org_id,
      new.artefact_id,
      new.purpose_code,
      new.expires_at,
      new.expires_at - interval '30 days'
    );
  end if;
  return new;
end;
$$;

create trigger trg_consent_artefact_expiry_queue
  after insert on consent_artefacts
  for each row execute function trg_artefact_create_expiry_entry();

-- Verification (§11.11 query 6):
--   select trigger_name, event_manipulation, action_timing
--     from information_schema.triggers
--    where event_object_table = 'consent_artefacts'
--      and trigger_name = 'trg_consent_artefact_expiry_queue';
--     → 1 row, AFTER INSERT
