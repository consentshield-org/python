-- ADR-0020 Sprint 1.1 — DEPA artefact_revocations table.
--
-- Part 5 of 9: immutable revocation records (Category B buffer).
-- Inserting a row here is the mechanism for revoking an artefact — the
-- AFTER trigger updates consent_artefacts.status and cascades in-DB.
-- The out-of-DB cascade (fan-out to deletion_requests via Edge Function)
-- is wired by ADR-0022 (trg_artefact_revocation_dispatch).
--
-- Per §11.4.4 + §11.5 + §11.6 + §11.7 + §11.8.
--
-- APPEND-ONLY. No UPDATE or DELETE policy for any role — truly immutable.
-- (cs_delivery has UPDATE (delivered_at) grant for the buffer-lifecycle
-- pattern, which is gated at the column level.)

create table artefact_revocations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,                       -- denormalised for RLS
  artefact_id     text not null references consent_artefacts(artefact_id),
  revoked_at      timestamptz not null default now(),
  reason          text not null,                       -- 'user_preference_change' | 'user_withdrawal' | 'business_withdrawal' | 'data_breach' | 'regulatory_instruction'
  revoked_by_type text not null,                       -- 'data_principal' | 'organisation' | 'system' | 'regulator'
  revoked_by_ref  text,                                -- session_fingerprint | user_id | instruction ref | NULL
  notes           text,
  delivered_at    timestamptz,                         -- buffer-pattern delivery tracking
  created_at      timestamptz default now()
);

comment on table artefact_revocations is
  'Immutable log of every consent artefact revocation. Inserting a row '
  'here is the mechanism for revoking an artefact — the trigger updates '
  'consent_artefacts.status. Do not attempt to UPDATE consent_artefacts.'
  'status directly from application code. Exported to customer storage '
  'and deleted from this table after confirmed delivery.';

-- Indexes (§11.5)
create index idx_revocations_artefact
  on artefact_revocations (artefact_id);
create index idx_revocations_org_time
  on artefact_revocations (org_id, revoked_at desc);
create index idx_revocations_undelivered
  on artefact_revocations (delivered_at)
  where delivered_at is null;

-- RLS (§11.6) — any org member can revoke (via rights centre or
-- preference centre). The BEFORE trigger validates artefact ownership.
-- No UPDATE or DELETE policy (immutability).
alter table artefact_revocations enable row level security;

create policy "revocations_select_own"
  on artefact_revocations for select
  using (org_id = current_org_id());

create policy "revocations_insert_own"
  on artefact_revocations for insert
  with check (org_id = current_org_id());

-- Grants (§11.7) — authenticated via RLS. cs_orchestrator inserts via
-- Edge Function. cs_delivery reads + updates delivered_at + deletes
-- confirmed rows (buffer lifecycle).
grant select, insert          on artefact_revocations to authenticated;
grant insert                  on artefact_revocations to cs_orchestrator;
grant select, delete          on artefact_revocations to cs_delivery;
grant update (delivered_at)   on artefact_revocations to cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- BEFORE INSERT trigger: validate artefact org ownership (§11.8)
-- Rejects cross-tenant revocation attempts before the row lands.
-- ═══════════════════════════════════════════════════════════
create or replace function trg_revocation_org_check()
returns trigger language plpgsql as $$
declare v_artefact_org_id uuid;
begin
  select org_id into v_artefact_org_id
    from consent_artefacts where artefact_id = new.artefact_id;

  if v_artefact_org_id is null then
    raise exception 'Artefact % does not exist', new.artefact_id;
  end if;

  if v_artefact_org_id != new.org_id then
    raise exception 'Artefact % does not belong to org %', new.artefact_id, new.org_id;
  end if;

  return new;
end;
$$;

create trigger trg_revocation_org_validation
  before insert on artefact_revocations
  for each row execute function trg_revocation_org_check();

-- ═══════════════════════════════════════════════════════════
-- AFTER INSERT trigger: in-DB revocation cascade (§11.8)
-- Updates consent_artefacts.status, removes from consent_artefact_index,
-- marks matching consent_expiry_queue rows superseded, writes audit log.
-- Does NOT walk the replaced_by chain (S-5: replaced artefacts stay
-- frozen).
--
-- The out-of-DB cascade (net.http_post to process-artefact-revocation
-- Edge Function) is wired by ADR-0022 as a separate AFTER trigger.
-- ═══════════════════════════════════════════════════════════
create or replace function trg_artefact_revocation_cascade()
returns trigger language plpgsql security definer as $$
begin
  update consent_artefacts
     set status = 'revoked'
   where artefact_id = new.artefact_id
     and status = 'active';

  if not found then
    raise exception 'Cannot revoke artefact %: not found or not active', new.artefact_id;
  end if;

  delete from consent_artefact_index
   where artefact_id = new.artefact_id;

  update consent_expiry_queue
     set superseded = true
   where artefact_id = new.artefact_id
     and processed_at is null;

  insert into audit_log (org_id, event_type, entity_type, entity_id, payload)
  values (
    new.org_id,
    'consent_artefact_revoked',
    'consent_artefacts',
    (select id from consent_artefacts where artefact_id = new.artefact_id),
    jsonb_build_object(
      'artefact_id', new.artefact_id,
      'reason',      new.reason,
      'revoked_by',  new.revoked_by_type
    )
  );

  return new;
end;
$$;

create trigger trg_artefact_revocation
  after insert on artefact_revocations
  for each row execute function trg_artefact_revocation_cascade();

-- Verification (§11.11 query 3):
--   select grantee, table_name, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and grantee = 'authenticated'
--      and table_name = 'artefact_revocations'
--      and privilege_type in ('UPDATE', 'DELETE');
--     → 0 rows
--
-- Verification (§11.11 query 4 — partial; dispatch trigger lands in ADR-0022):
--   select trigger_name, event_manipulation, action_timing
--     from information_schema.triggers
--    where event_object_table = 'artefact_revocations'
--      and trigger_name in ('trg_artefact_revocation',
--                           'trg_revocation_org_validation');
--     → 2 rows (dispatch trigger deferred)
