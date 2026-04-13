-- Migration 011: Authenticated Role Restrictions
-- REVOKE UPDATE/DELETE on all buffer tables for the authenticated role.
-- REVOKE INSERT on critical buffers (written only by scoped roles).

-- No UPDATE or DELETE on any buffer table for authenticated users
revoke update, delete on consent_events from authenticated;
revoke update, delete on tracker_observations from authenticated;
revoke update, delete on audit_log from authenticated;
revoke update, delete on processing_log from authenticated;
revoke update, delete on rights_request_events from authenticated;
revoke update, delete on delivery_buffer from authenticated;
revoke update, delete on deletion_receipts from authenticated;
revoke update, delete on withdrawal_verifications from authenticated;
revoke update, delete on security_scans from authenticated;
revoke update, delete on consent_probe_runs from authenticated;

-- No INSERT on critical buffers (written only by scoped roles)
revoke insert on consent_events from authenticated;
revoke insert on tracker_observations from authenticated;
revoke insert on audit_log from authenticated;
revoke insert on processing_log from authenticated;
revoke insert on delivery_buffer from authenticated;
