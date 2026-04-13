-- Migration 013: Buffer Lifecycle Functions
-- mark_delivered_and_delete: two-step mark + delete in one call
-- sweep_delivered_buffers: safety net for orphaned rows
-- detect_stuck_buffers: alert if delivery pipeline is broken

-- ═══════════════════════════════════════════════════════════
-- Mark delivered and delete — called after confirmed write to customer storage
-- Two-step: SET delivered_at, then DELETE. Matches definitive architecture Section 7.1.
-- ═══════════════════════════════════════════════════════════
create or replace function mark_delivered_and_delete(
  p_table_name text,
  p_row_id uuid
) returns void language plpgsql security definer as $$
begin
  execute format(
    'UPDATE %I SET delivered_at = now() WHERE id = $1 AND delivered_at IS NULL',
    p_table_name
  ) using p_row_id;

  execute format(
    'DELETE FROM %I WHERE id = $1 AND delivered_at IS NOT NULL',
    p_table_name
  ) using p_row_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- Sweep — safety net for rows that survived immediate deletion
-- Should find 0 rows in normal operation. Finding rows = investigate.
-- ═══════════════════════════════════════════════════════════
create or replace function sweep_delivered_buffers()
returns jsonb language plpgsql security definer as $$
declare
  counts jsonb := '{}';
  c integer;
begin
  delete from consent_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_events', c);

  delete from tracker_observations where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('tracker_observations', c);

  delete from audit_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('audit_log', c);

  delete from processing_log where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('processing_log', c);

  delete from delivery_buffer where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('delivery_buffer', c);

  delete from rights_request_events where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('rights_request_events', c);

  delete from deletion_receipts where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('deletion_receipts', c);

  delete from withdrawal_verifications where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('withdrawal_verifications', c);

  delete from security_scans where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('security_scans', c);

  delete from consent_probe_runs where delivered_at is not null and delivered_at < now() - interval '5 minutes';
  get diagnostics c = row_count; counts := counts || jsonb_build_object('consent_probe_runs', c);

  -- Clean expired consent artefact index entries
  delete from consent_artefact_index where expires_at < now();
  get diagnostics c = row_count; counts := counts || jsonb_build_object('expired_artefacts', c);

  return counts;
end;
$$;

-- ═══════════════════════════════════════════════════════════
-- Stuck row detection — alert if anything is undelivered for > 1 hour
-- All 10 buffer tables checked.
-- ═══════════════════════════════════════════════════════════
create or replace function detect_stuck_buffers()
returns table(buffer_table text, stuck_count bigint, oldest_created timestamptz) language plpgsql security definer as $$
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
  select 'consent_probe_runs', count(*), min(created_at)
  from consent_probe_runs where delivered_at is null and created_at < now() - interval '1 hour';
end;
$$;
