-- ADR-0020 Sprint 1.1 — §11.3 ALTER TABLE amendments to existing tables.
--
-- Part 8 of 9: back-references that connect pre-DEPA tables to the new
-- DEPA artefact model. All additive — no existing column modified, no
-- existing behaviour changed. Existing rows gain the new columns with
-- safe defaults.
--
-- Per §11.3.
--
-- ═══════════════════════════════════════════════════════════
-- ARCHITECTURE FINDING: §11.3 specifies a fifth ALTER —
--   ALTER TABLE deletion_requests ADD COLUMN artefact_id text ...
-- but the deletion_requests table does not exist in the current schema.
-- The pre-DEPA deletion flow (ADR-0007) uses deletion_receipts directly
-- as a request+receipt hybrid (request_payload, response_payload, status,
-- requested_at, confirmed_at on a single row).
--
-- Resolution is deferred to ADR-0022 (revocation pipeline), which will
-- either create the table and migrate the existing flow, or amend the
-- architecture doc to remove references to deletion_requests.
-- This migration ships the remaining four ALTERs; deletion_requests is
-- skipped intentionally.
-- ═══════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════
-- consent_events.artefact_ids — back-reference to the artefacts
-- generated from this event by process-consent-event (ADR-0021).
-- Empty array → event has no artefacts yet (dispatch is in flight
-- or the event is orphaned; safety-net cron picks it up in ADR-0021).
-- ═══════════════════════════════════════════════════════════
alter table consent_events
  add column artefact_ids text[] not null default '{}';

create index idx_consent_events_artefact_ids
  on consent_events using gin (artefact_ids);

create index idx_consent_events_awaiting_artefact
  on consent_events (created_at)
  where artefact_ids = '{}';

comment on column consent_events.artefact_ids is
  'Denormalised list of consent_artefacts.artefact_id values generated '
  'from this event. Populated by process-consent-event Edge Function '
  '(ADR-0021) after successful fan-out. Empty array older than 5 minutes '
  'indicates the dispatch pipeline is broken — safety-net pg_cron '
  '(ADR-0021) picks these up for retry.';

-- Grant on the new column: cs_orchestrator (Edge Function) updates the
-- array after artefact fan-out.
grant update (artefact_ids) on consent_events to cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- deletion_receipts.artefact_id — denormalised back-reference for
-- chain-of-custody queries. Populated when a deletion is created from
-- an artefact-triggered flow (revocation or expiry). NULL for non-
-- artefact-triggered deletions (rights-request erasures that sweep
-- all active artefacts).
-- ═══════════════════════════════════════════════════════════
alter table deletion_receipts
  add column artefact_id text;

create index idx_deletion_receipts_artefact
  on deletion_receipts (artefact_id)
  where artefact_id is not null;

comment on column deletion_receipts.artefact_id is
  'Denormalised from the triggering artefact for chain-of-custody '
  'queries. NULL for non-artefact-triggered deletions. Completes the '
  'audit chain: consent_artefacts → artefact_revocations → '
  'deletion_receipts. (The four-link chain in the architecture doc '
  'includes deletion_requests, which does not exist — see ADR-0020 '
  'architecture finding and ADR-0022 resolution.)';

-- ═══════════════════════════════════════════════════════════
-- consent_artefact_index — extend from ABDM-specific to multi-framework
-- validity cache. Existing rows receive framework = 'abdm' by default,
-- which preserves their pre-DEPA semantics.
-- ═══════════════════════════════════════════════════════════
alter table consent_artefact_index
  add column framework   text not null default 'abdm',
  add column purpose_code text;

create index idx_consent_artefact_index_framework
  on consent_artefact_index (org_id, framework)
  where validity_state = 'active';

comment on column consent_artefact_index.framework is
  'dpdp | abdm | gdpr — which framework this artefact belongs to. '
  'Default ''abdm'' preserves the pre-DEPA semantics of this table; '
  'new DEPA artefacts write the correct framework at insert time '
  'inside the process-consent-event Edge Function (ADR-0021).';

comment on column consent_artefact_index.purpose_code is
  'Machine-readable purpose code. Used for fast lookup during tracker '
  'enforcement without joining back to consent_artefacts.';
