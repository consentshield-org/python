-- Closes three blocking findings from the 2026-04-14 review:
--   B-7: add missing delivered_at indexes on every buffer table so
--        sweep_delivered_buffers() and detect_stuck_buffers() use indexes.
--   B-9: daily cleanup of unverified rights_requests (ADR-0004 Sprint 1.2).
--   B-8: grant encryption RPC execute to the scoped roles that need it,
--        revoking the excessive service_role grant from migration 002.

-- -----------------------------------------------------------------------------
-- B-7: missing sweep indexes. Partial indexes keyed on delivered_at.
-- -----------------------------------------------------------------------------

create index if not exists idx_delivery_buffer_delivered_stale
  on delivery_buffer (delivered_at) where delivered_at is not null;

create index if not exists idx_rr_events_delivered_stale
  on rights_request_events (delivered_at) where delivered_at is not null;

create index if not exists idx_deletion_receipts_delivered_stale
  on deletion_receipts (delivered_at) where delivered_at is not null;

create index if not exists idx_withdrawal_ver_undelivered
  on withdrawal_verifications (delivered_at) where delivered_at is null;
create index if not exists idx_withdrawal_ver_delivered_stale
  on withdrawal_verifications (delivered_at) where delivered_at is not null;

create index if not exists idx_security_scans_undelivered
  on security_scans (delivered_at) where delivered_at is null;
create index if not exists idx_security_scans_delivered_stale
  on security_scans (delivered_at) where delivered_at is not null;

create index if not exists idx_probe_runs_undelivered
  on consent_probe_runs (delivered_at) where delivered_at is null;
create index if not exists idx_probe_runs_delivered_stale
  on consent_probe_runs (delivered_at) where delivered_at is not null;

-- -----------------------------------------------------------------------------
-- B-9: cleanup of unverified rights_requests.
-- Rows where the requestor never completed OTP verification are abandoned
-- after 24 hours. The cleanup function is security definer so cron can call
-- it without a service-role JWT.
-- -----------------------------------------------------------------------------

-- Migration role must be a member of cs_orchestrator (true for postgres
-- per migration 010).

create or replace function public.cleanup_unverified_rights_requests()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_deleted int;
begin
  delete from rights_requests
    where email_verified = false
      and created_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

alter function public.cleanup_unverified_rights_requests() owner to cs_orchestrator;
revoke all on function public.cleanup_unverified_rights_requests() from public;
-- pg_cron jobs run as the database owner, which has execute by default.

select cron.schedule(
  'cleanup-unverified-rights-requests-daily',
  '15 2 * * *',
  $$ select public.cleanup_unverified_rights_requests(); $$
);

-- -----------------------------------------------------------------------------
-- B-8: tighten encryption RPC grants. decrypt_secret / encrypt_secret
-- previously granted execute only to service_role — forcing application code
-- onto the master key. Shift to the scoped roles that actually need them.
-- -----------------------------------------------------------------------------

revoke execute on function public.encrypt_secret(text, text) from service_role;
revoke execute on function public.decrypt_secret(bytea, text) from service_role;
grant execute on function public.encrypt_secret(text, text) to cs_orchestrator;
grant execute on function public.decrypt_secret(bytea, text) to cs_orchestrator;
grant execute on function public.decrypt_secret(bytea, text) to cs_delivery;
