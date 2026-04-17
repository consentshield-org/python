-- ADR-0027 Sprint 2.1 — retrofit FK from admin.admin_audit_log.impersonation_session_id
-- to admin.impersonation_sessions(id).
--
-- The column was added in Sprint 1.1 (migration 20260416000015) as a plain
-- uuid because the target table didn't exist yet. Now that 20260417000001
-- has created admin.impersonation_sessions, add the FK constraint.
--
-- Per ADR-0027 Implementation Plan Phase 2 deliverables.

alter table admin.admin_audit_log
  add constraint admin_audit_log_impersonation_session_fk
  foreign key (impersonation_session_id)
  references admin.impersonation_sessions(id);

-- Verification:
--   select count(*) from pg_constraint
--     where conname = 'admin_audit_log_impersonation_session_fk'; → 1
