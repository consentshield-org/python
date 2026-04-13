-- Migration 010: Scoped Database Roles
-- Three custom roles replace the single service role key in all running application code.
-- The full service_role is retained for migrations and emergency admin only.

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_worker — used by Cloudflare Worker ONLY
-- Can write consent events and tracker observations.
-- Cannot read any other table.
-- ═══════════════════════════════════════════════════════════
do $$
begin
  if not exists (select from pg_roles where rolname = 'cs_worker') then
    create role cs_worker with login password 'cs_worker_change_me';
  end if;
end
$$;

grant usage on schema public to cs_worker;
grant insert on consent_events to cs_worker;
grant insert on tracker_observations to cs_worker;
grant select on consent_banners to cs_worker;
grant select on web_properties to cs_worker;
grant update (snippet_last_seen_at) on web_properties to cs_worker;
grant usage on all sequences in schema public to cs_worker;

-- Explicit deny on sensitive tables
revoke all on organisations from cs_worker;
revoke all on organisation_members from cs_worker;
revoke all on rights_requests from cs_worker;
revoke all on audit_log from cs_worker;
revoke all on processing_log from cs_worker;
revoke all on integration_connectors from cs_worker;
revoke all on export_configurations from cs_worker;
revoke all on delivery_buffer from cs_worker;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_delivery — used by delivery Edge Function ONLY
-- Can read undelivered buffer rows, mark delivered, delete.
-- Can read export config. Cannot read operational data.
-- ═══════════════════════════════════════════════════════════
do $$
begin
  if not exists (select from pg_roles where rolname = 'cs_delivery') then
    create role cs_delivery with login password 'cs_delivery_change_me';
  end if;
end
$$;

grant usage on schema public to cs_delivery;

-- SELECT on all buffer tables
grant select on consent_events to cs_delivery;
grant select on tracker_observations to cs_delivery;
grant select on audit_log to cs_delivery;
grant select on processing_log to cs_delivery;
grant select on delivery_buffer to cs_delivery;
grant select on rights_request_events to cs_delivery;
grant select on deletion_receipts to cs_delivery;
grant select on withdrawal_verifications to cs_delivery;
grant select on security_scans to cs_delivery;
grant select on consent_probe_runs to cs_delivery;

-- UPDATE delivered_at on all buffer tables
grant update (delivered_at) on consent_events to cs_delivery;
grant update (delivered_at) on tracker_observations to cs_delivery;
grant update (delivered_at) on audit_log to cs_delivery;
grant update (delivered_at) on processing_log to cs_delivery;
grant update (delivered_at) on delivery_buffer to cs_delivery;
grant update (delivered_at) on rights_request_events to cs_delivery;
grant update (delivered_at) on deletion_receipts to cs_delivery;
grant update (delivered_at) on withdrawal_verifications to cs_delivery;
grant update (delivered_at) on security_scans to cs_delivery;
grant update (delivered_at) on consent_probe_runs to cs_delivery;

-- DELETE on all buffer tables
grant delete on consent_events to cs_delivery;
grant delete on tracker_observations to cs_delivery;
grant delete on audit_log to cs_delivery;
grant delete on processing_log to cs_delivery;
grant delete on delivery_buffer to cs_delivery;
grant delete on rights_request_events to cs_delivery;
grant delete on deletion_receipts to cs_delivery;
grant delete on withdrawal_verifications to cs_delivery;
grant delete on security_scans to cs_delivery;
grant delete on consent_probe_runs to cs_delivery;

-- Export config (encrypted credentials — needs master key to decrypt)
grant select on export_configurations to cs_delivery;

-- Clean expired artefact index entries
grant delete on consent_artefact_index to cs_delivery;
grant select on consent_artefact_index to cs_delivery;

grant usage on all sequences in schema public to cs_delivery;

-- Explicit deny on operational tables
revoke all on organisations from cs_delivery;
revoke all on organisation_members from cs_delivery;
revoke all on consent_banners from cs_delivery;
revoke all on integration_connectors from cs_delivery;

-- ═══════════════════════════════════════════════════════════
-- ROLE: cs_orchestrator — used by all other Edge Functions
-- Can write to audit/processing/deletion tables.
-- Can read operational data needed for orchestration.
-- Cannot directly read consent_events or tracker_observations.
-- ═══════════════════════════════════════════════════════════
do $$
begin
  if not exists (select from pg_roles where rolname = 'cs_orchestrator') then
    create role cs_orchestrator with login password 'cs_orchestrator_change_me';
  end if;
end
$$;

grant usage on schema public to cs_orchestrator;

-- INSERT into orchestration-written buffer tables
grant insert on audit_log to cs_orchestrator;
grant insert on processing_log to cs_orchestrator;
grant insert on rights_request_events to cs_orchestrator;
grant insert on deletion_receipts to cs_orchestrator;
grant insert on withdrawal_verifications to cs_orchestrator;
grant insert on security_scans to cs_orchestrator;
grant insert on consent_probe_runs to cs_orchestrator;
grant insert on delivery_buffer to cs_orchestrator;

-- SELECT operational tables for orchestration
grant select on organisations to cs_orchestrator;
grant select on organisation_members to cs_orchestrator;
grant select on web_properties to cs_orchestrator;
grant select on integration_connectors to cs_orchestrator;
grant select on retention_rules to cs_orchestrator;
grant select on notification_channels to cs_orchestrator;
grant select on rights_requests to cs_orchestrator;
grant select on consent_artefact_index to cs_orchestrator;
grant select on consent_probes to cs_orchestrator;
grant select on data_inventory to cs_orchestrator;

-- UPDATE specific fields for automated workflows
grant update (status, assignee_id) on rights_requests to cs_orchestrator;
grant update (plan, plan_started_at, razorpay_subscription_id, razorpay_customer_id) on organisations to cs_orchestrator;
grant update (validity_state) on consent_artefact_index to cs_orchestrator;
grant update (last_run_at, last_result, next_run_at) on consent_probes to cs_orchestrator;
grant update (last_health_check_at, last_error, status) on integration_connectors to cs_orchestrator;
grant update (last_checked_at, next_check_at) on retention_rules to cs_orchestrator;
grant update (status, confirmed_at, response_payload, failure_reason, retry_count) on deletion_receipts to cs_orchestrator;
grant update (scan_results, overall_status) on withdrawal_verifications to cs_orchestrator;

grant usage on all sequences in schema public to cs_orchestrator;

-- Explicit deny on consent events (Worker's domain)
revoke all on consent_events from cs_orchestrator;
revoke all on tracker_observations from cs_orchestrator;
