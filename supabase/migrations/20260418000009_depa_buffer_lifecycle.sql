-- ADR-0020 Sprint 1.1 — DEPA buffer lifecycle additions.
--
-- Part 9 of 9: buffer-lifecycle helpers for artefact_revocations, which
-- is a Category B buffer (rows deleted after confirmed delivery to
-- customer storage).
--
-- Per §11.9.

-- ═══════════════════════════════════════════════════════════
-- confirm_revocation_delivery(id) — mirrors mark_delivered_and_delete
-- for artefact_revocations. Called by the delivery pipeline after the
-- revocation record is confirmed written to customer storage.
-- ═══════════════════════════════════════════════════════════
create or replace function confirm_revocation_delivery(p_revocation_id uuid)
returns void language plpgsql security definer as $$
begin
  delete from artefact_revocations
   where id = p_revocation_id
     and delivered_at is not null;

  if not found then
    raise exception 'Revocation % not found or not marked delivered', p_revocation_id;
  end if;
end;
$$;

comment on function confirm_revocation_delivery(uuid) is
  'Deletes an artefact_revocations row after confirmed delivery to '
  'customer storage. Raises if the row does not exist or if delivered_at '
  'is NULL. Only callable by cs_delivery.';

grant execute on function confirm_revocation_delivery(uuid) to cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- detect_stuck_buffers() — extended to include artefact_revocations.
--
-- The existing function (migration 20260413000015_fix_stuck_buffers.sql)
-- covers 10 tables. CREATE OR REPLACE cannot change the existing
-- signature's RETURNS TABLE column names, so this migration preserves
-- the `(buffer_table, stuck_count, oldest_created)` shape and simply
-- extends the UNION body.
-- ═══════════════════════════════════════════════════════════
create or replace function detect_stuck_buffers()
returns table(buffer_table text, stuck_count bigint, oldest_created timestamptz)
language plpgsql security definer as $$
begin
  return query
  select 'consent_events'::text, count(*), min(created_at)
  from consent_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'tracker_observations', count(*), min(created_at)
  from tracker_observations where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'audit_log', count(*), min(created_at)
  from audit_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'processing_log', count(*), min(created_at)
  from processing_log where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'delivery_buffer', count(*), min(created_at)
  from delivery_buffer where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'rights_request_events', count(*), min(created_at)
  from rights_request_events where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'deletion_receipts', count(*), min(created_at)
  from deletion_receipts where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'withdrawal_verifications', count(*), min(created_at)
  from withdrawal_verifications where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'security_scans', count(*), min(created_at)
  from security_scans where delivered_at is null and created_at < now() - interval '1 hour'
  union all
  select 'consent_probe_runs', count(*), min(run_at)
  from consent_probe_runs where delivered_at is null and run_at < now() - interval '1 hour'
  union all
  select 'artefact_revocations', count(*), min(created_at)
  from artefact_revocations where delivered_at is null and created_at < now() - interval '1 hour';
end;
$$;

comment on function detect_stuck_buffers() is
  'Returns one row per buffer table with the count of rows older than '
  '1 hour still awaiting delivery. Extended 2026-04-17 (ADR-0020) to '
  'include artefact_revocations. The §11.9 spec uses column names '
  '(table_name, stuck_count, oldest_stuck_at); the implementation '
  'preserves the pre-existing (buffer_table, stuck_count, oldest_created) '
  'shape because CREATE OR REPLACE cannot rename OUT columns.';
