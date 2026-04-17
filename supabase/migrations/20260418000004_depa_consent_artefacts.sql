-- ADR-0020 Sprint 1.1 — DEPA consent_artefacts table.
--
-- Part 4 of 9: the DEPA-native consent record. One row per purpose per
-- consent interaction.
--
-- Per §11.4.3 + §11.5 + §11.6 + §11.7.
--
-- APPEND-ONLY for authenticated role (Rule 19). No INSERT / UPDATE /
-- DELETE RLS policy — writes flow through the process-consent-event
-- Edge Function running as cs_orchestrator (BYPASSRLS). Status
-- transitions happen via:
--   (a) artefact_revocations INSERT trigger (ADR-0022 / already in
--       migration 20260418000005)
--   (b) enforce_artefact_expiry() pg_cron (ADR-0023)
--   (c) process-consent-event re-consent path (ADR-0021)
--
-- Replacement chain semantics (S-5 in the Phase A review): if A is
-- replaced by B and B is later revoked, A stays frozen at 'replaced'.
-- Revocation does NOT walk the replaced_by chain.
--
-- The expiry-queue insert trigger trg_consent_artefact_expiry_queue is
-- defined in migration 20260418000006 (after consent_expiry_queue is
-- created).

create table consent_artefacts (
  id                    uuid primary key default gen_random_uuid(),
  artefact_id           text not null unique default generate_artefact_id(),
  org_id                uuid not null,                 -- denormalised for RLS (same pattern as consent_events)
  property_id           uuid not null references web_properties(id),
  banner_id             uuid not null references consent_banners(id),
  banner_version        integer not null,
  consent_event_id      uuid not null references consent_events(id),
  session_fingerprint   text not null,
  purpose_definition_id uuid not null references purpose_definitions(id),
  purpose_code          text not null,
  data_scope            text[] not null default '{}',
  framework             text not null default 'dpdp',
  expires_at            timestamptz not null,
  status                text not null default 'active',
  replaced_by           text references consent_artefacts(artefact_id),
  abdm_artefact_id      text,
  abdm_hip_id           text,
  abdm_hiu_id           text,
  abdm_fhir_types       text[],
  created_at            timestamptz default now()
  -- No updated_at. Status transitions are externally enforced.
);

comment on table consent_artefacts is
  'DEPA-native consent artefact table. One row per purpose per consent '
  'interaction. Authoritative record for compliance, audit, and deletion '
  'orchestration. APPEND-ONLY for authenticated role (Rule 19). Status '
  'changes via triggers, pg_cron, and Edge Functions only. Exported to '
  'customer storage via delivery_buffer staging; the row itself is '
  'retained while status = ''active'' for revocation and expiry queries. '
  'data_scope and abdm_fhir_types are category declarations — never '
  'regulated content values (Rule 3).';

comment on column consent_artefacts.data_scope is
  'SNAPSHOT of purpose_definitions.data_scope at artefact creation. '
  'CATEGORY labels only — never actual values.';

comment on column consent_artefacts.abdm_fhir_types is
  'FHIR resource type NAMES (e.g. ''Observation'', ''MedicationRequest''). '
  'NEVER resource content. Rule 3 broadened.';

-- Indexes (§11.5)
create index idx_artefacts_org_status
  on consent_artefacts (org_id, status);
create index idx_artefacts_org_status_expires
  on consent_artefacts (org_id, status, expires_at)
  where status = 'active';
create index idx_artefacts_fingerprint
  on consent_artefacts (org_id, session_fingerprint)
  where status = 'active';
create index idx_artefacts_event_id
  on consent_artefacts (consent_event_id);
create index idx_artefacts_purpose_def
  on consent_artefacts (purpose_definition_id);
create index idx_artefacts_framework
  on consent_artefacts (org_id, framework, status)
  where status = 'active';
create index idx_artefacts_abdm
  on consent_artefacts (abdm_artefact_id)
  where abdm_artefact_id is not null;

-- RLS (§11.6) — SELECT only for authenticated. No INSERT / UPDATE /
-- DELETE policy: writes flow through cs_orchestrator (BYPASSRLS).
alter table consent_artefacts enable row level security;

create policy "artefacts_select_own"
  on consent_artefacts for select
  using (org_id = current_org_id());

-- Grants (§11.7) — authenticated can SELECT (RLS-gated). cs_orchestrator
-- inserts + selects + updates (status, replaced_by only). cs_delivery
-- reads to assemble delivery payloads.
grant select                       on consent_artefacts to authenticated;
grant insert, select               on consent_artefacts to cs_orchestrator;
grant update (status, replaced_by) on consent_artefacts to cs_orchestrator;
grant select                       on consent_artefacts to cs_delivery;

-- Verification (§11.11 query 2):
--   select grantee, table_name, privilege_type
--     from information_schema.table_privileges
--    where table_schema = 'public' and grantee = 'authenticated'
--      and table_name = 'consent_artefacts'
--      and privilege_type in ('UPDATE', 'DELETE', 'INSERT');
--     → 0 rows (authenticated has SELECT only)
