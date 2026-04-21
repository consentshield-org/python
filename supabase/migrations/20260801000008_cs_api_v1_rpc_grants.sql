-- ADR-1009 Phase 2 Sprint 2.2 — grant cs_api EXECUTE on the 9 v1 business RPCs.
--
-- Additive: service_role grants are preserved through Sprint 2.3 (runtime
-- swap) as a regression net. Sprint 2.4 revokes from service_role.
--
-- Signatures reflect the Phase 1 fence: every RPC's first parameter is
-- p_key_id uuid, so the uuid-count on each function differs from pre-
-- Phase 1. Matched against migrations 000004 (mutations) and 000005 (reads).
--
-- NOT granted here (already granted earlier):
--   rpc_api_key_verify          — Sprint 2.1 follow-up (000007)
--   rpc_api_key_status          — Sprint 2.1 (000006)
--   rpc_api_request_log_insert  — Sprint 2.1 follow-up (000007)
--
-- NOT needed for cs_api:
--   assert_api_key_binding — called from within every v1 RPC as SECURITY
--   DEFINER; runs with the function owner's privileges, not cs_api's.

-- ── Reads ────────────────────────────────────────────────────────────────────

grant execute on function public.rpc_consent_verify(
  uuid, uuid, uuid, text, text, text
) to cs_api;

grant execute on function public.rpc_consent_verify_batch(
  uuid, uuid, uuid, text, text, text[]
) to cs_api;

grant execute on function public.rpc_artefact_list(
  uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int
) to cs_api;

grant execute on function public.rpc_artefact_get(uuid, uuid, text) to cs_api;

grant execute on function public.rpc_event_list(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, int
) to cs_api;

grant execute on function public.rpc_deletion_receipts_list(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, int
) to cs_api;

-- ── Mutations ────────────────────────────────────────────────────────────────

grant execute on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) to cs_api;

grant execute on function public.rpc_artefact_revoke(
  uuid, uuid, text, text, text, text, text
) to cs_api;

grant execute on function public.rpc_deletion_trigger(
  uuid, uuid, uuid, text, text, text, text[], text[], text, text
) to cs_api;
