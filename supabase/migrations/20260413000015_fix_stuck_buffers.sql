-- Migration 015: Fix detect_stuck_buffers — consent_probe_runs uses run_at, not created_at

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
  select 'consent_probe_runs', count(*), min(run_at)
  from consent_probe_runs where delivered_at is null and run_at < now() - interval '1 hour';
end;
$$;
