-- ADR-0022 Sprint 1.2 — artefact-revocation dispatch trigger + safety-net cron.
--
-- Wires the Q2 Option D hybrid trigger+polling pipeline for the
-- out-of-database revocation cascade, mirroring ADR-0021's consent-event
-- dispatch shape. Primary path: AFTER INSERT trigger on artefact_revocations
-- fires net.http_post to process-artefact-revocation Edge Function. Safety
-- net: pg_cron every 5 minutes sweeps revocations with NULL dispatched_at.
--
-- Idempotency contract is enforced by a UNIQUE partial index on
-- deletion_receipts(trigger_id, connector_id) WHERE trigger_type =
-- 'consent_revoked' + ON CONFLICT DO NOTHING in the Edge Function.
-- Both trigger and cron paths are safe to fire concurrently.
--
-- Trigger ordering: Postgres fires AFTER triggers of the same event in
-- trigger-name order. `trg_artefact_revocation` (cascade, from ADR-0020)
-- sorts before `trg_artefact_revocation_dispatch` (this migration) so the
-- in-DB cascade completes first. If the cascade raises (artefact not
-- active, replaced-chain frozen invariant per S-5), the whole INSERT
-- rolls back and no dispatch occurs.
--
-- Depends on:
--   - ADR-0020 schema (artefact_revocations, deletion_receipts, trg_artefact_revocation)
--   - Vault secrets `supabase_url` + `cs_orchestrator_key`
--   - pg_net + pg_cron extensions
--   - Deployed Edge Function process-artefact-revocation (Sprint 1.3).

-- ═══════════════════════════════════════════════════════════
-- dispatched_at flag on artefact_revocations — fast-path pivot for
-- the safety-net cron and for Edge Function idempotency.
-- ═══════════════════════════════════════════════════════════
alter table artefact_revocations
  add column dispatched_at timestamptz;

create index idx_revocations_pending_dispatch
  on artefact_revocations (created_at)
  where dispatched_at is null;

comment on column artefact_revocations.dispatched_at is
  'Timestamp at which the process-artefact-revocation Edge Function '
  'finished writing all deletion_receipts rows for this revocation. '
  'NULL means dispatch is still pending or dropped; safety-net cron '
  'picks these up after 5 minutes. Set in a guarded UPDATE by the '
  'Edge Function (eq dispatched_at null).';

-- ═══════════════════════════════════════════════════════════
-- Idempotency guard — UNIQUE (trigger_id, connector_id) partial on
-- deletion_receipts for consent_revoked triggers. One receipt per
-- connector per revocation. Duplicate inserts from a trigger+cron
-- race collide at the index; Edge Function uses ON CONFLICT DO NOTHING.
-- Partial on trigger_type preserves the pre-DEPA semantics of
-- deletion_receipts for erasure_request and retention_expired rows
-- (which may legitimately write multiple rows per trigger_id).
-- ═══════════════════════════════════════════════════════════
create unique index deletion_receipts_revocation_connector_uq
  on deletion_receipts (trigger_id, connector_id)
  where trigger_type = 'consent_revoked';

comment on index deletion_receipts_revocation_connector_uq is
  'ADR-0022 idempotency guard. Prevents duplicate deletion_receipts '
  'when the AFTER INSERT trigger on artefact_revocations and the '
  'safety-net cron both dispatch for the same revocation. Partial '
  'index scoped to trigger_type = ''consent_revoked'' so other '
  'deletion trigger_types are unaffected.';

-- ═══════════════════════════════════════════════════════════
-- trigger_process_artefact_revocation() — AFTER INSERT on
-- artefact_revocations. Fires net.http_post to the Edge Function.
-- EXCEPTION swallowed so dispatch failure never rolls back the
-- revocation INSERT (the in-DB cascade already committed status
-- flip + index removal + audit log by the time this trigger runs).
-- ═══════════════════════════════════════════════════════════
create or replace function trigger_process_artefact_revocation()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = 'supabase_url' limit 1)
             || '/functions/v1/process-artefact-revocation',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                       where name = 'cs_orchestrator_key' limit 1),
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object(
        'artefact_id',   NEW.artefact_id,
        'revocation_id', NEW.id
      )
    );
  exception when others then
    null;  -- Safety-net cron will pick this up.
  end;
  return null;  -- AFTER INSERT — return value ignored.
end;
$$;

comment on function trigger_process_artefact_revocation() is
  'AFTER INSERT trigger function on artefact_revocations (ADR-0022 '
  'Q2 Option D primary path). Dispatches to process-artefact-revocation '
  'Edge Function via net.http_post. Fires after trg_artefact_revocation '
  '(alphabetic trigger ordering) so the in-DB cascade is already '
  'committed. EXCEPTION WHEN OTHERS is load-bearing — dispatch failure '
  'must not roll back the revocation itself.';

create trigger trg_artefact_revocation_dispatch
  after insert on artefact_revocations
  for each row execute function trigger_process_artefact_revocation();

-- ═══════════════════════════════════════════════════════════
-- safety_net_process_artefact_revocations() — picks up revocations
-- with NULL dispatched_at older than 5 minutes and re-fires the Edge
-- Function. Idempotency guaranteed by the UNIQUE partial index above
-- + ON CONFLICT DO NOTHING in the Edge Function.
-- ═══════════════════════════════════════════════════════════
create or replace function safety_net_process_artefact_revocations()
returns integer language plpgsql security definer as $$
declare
  v_row       record;
  v_count     integer := 0;
begin
  for v_row in
    select id, artefact_id
      from artefact_revocations
     where dispatched_at is null
       and created_at < now() - interval '5 minutes'
       and created_at > now() - interval '24 hours'
     limit 100
  loop
    begin
      perform net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
                where name = 'supabase_url' limit 1)
               || '/functions/v1/process-artefact-revocation',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                         where name = 'cs_orchestrator_key' limit 1),
          'Content-Type',  'application/json'
        ),
        body := jsonb_build_object(
          'artefact_id',   v_row.artefact_id,
          'revocation_id', v_row.id
        )
      );
      v_count := v_count + 1;
    exception when others then
      null;  -- Continue with other revocations.
    end;
  end loop;
  return v_count;
end;
$$;

comment on function safety_net_process_artefact_revocations() is
  'ADR-0022 Q2 Option D safety-net path. Scheduled every 5 minutes by '
  'pg_cron. Re-fires process-artefact-revocation for artefact_revocations '
  'rows where dispatched_at is still NULL 5+ minutes after INSERT '
  '(implies the primary trigger dispatch failed). 100-row batch cap; '
  '24-hour lookback.';

grant execute on function safety_net_process_artefact_revocations()
  to authenticated, cs_orchestrator;

-- ═══════════════════════════════════════════════════════════
-- pg_cron: artefact-revocations-dispatch-safety-net every 5 minutes.
-- ═══════════════════════════════════════════════════════════
do $$ begin perform cron.unschedule('artefact-revocations-dispatch-safety-net');
exception when others then null; end $$;

select cron.schedule(
  'artefact-revocations-dispatch-safety-net',
  '*/5 * * * *',
  $$select safety_net_process_artefact_revocations()$$
);

-- Verification (§11.11-style queries after this migration):
--
-- Query A (dispatch trigger exists on artefact_revocations):
--   select trigger_name, event_manipulation, action_timing
--     from information_schema.triggers
--    where event_object_table = 'artefact_revocations'
--      and trigger_name = 'trg_artefact_revocation_dispatch';
--    → 1 row, AFTER INSERT
--
-- Query B (safety-net cron):
--   select jobname, schedule, active
--     from cron.job
--    where jobname = 'artefact-revocations-dispatch-safety-net';
--    → 1 row, schedule '*/5 * * * *', active = true
--
-- Query C (idempotency index):
--   select indexname, indexdef
--     from pg_indexes
--    where indexname = 'deletion_receipts_revocation_connector_uq';
--    → 1 row, UNIQUE partial on (trigger_id, connector_id)
--      WHERE trigger_type = 'consent_revoked'
