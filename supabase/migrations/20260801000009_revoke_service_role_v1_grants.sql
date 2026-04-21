-- ADR-1009 Phase 2 Sprint 2.4 — revoke service_role EXECUTE on the 12 v1
-- RPCs. Sprint 2.3 swapped the customer-app runtime to cs_api; 106/106
-- tests are green against the swapped pool. Revoking service_role now
-- removes the fallback so any accidental re-introduction of
-- SUPABASE_SERVICE_ROLE_KEY / sb_secret_* into the v1 path fails loudly.
--
-- Covers:
--   • 9 v1 business RPCs (consent_verify / verify_batch / record,
--     artefact_list / get / revoke, event_list, deletion_trigger,
--     deletion_receipts_list)
--   • 3 auth/telemetry RPCs (api_key_verify, api_key_status,
--     api_request_log_insert)
--   • 1 helper (assert_api_key_binding) — called only from SECURITY
--     DEFINER bodies, but service_role had EXECUTE; cleanup for
--     consistency.
--
-- cs_api grants remain untouched.

-- ── 9 v1 business RPCs ───────────────────────────────────────────────────────

revoke execute on function public.rpc_consent_verify(
  uuid, uuid, uuid, text, text, text
) from service_role;

revoke execute on function public.rpc_consent_verify_batch(
  uuid, uuid, uuid, text, text, text[]
) from service_role;

revoke execute on function public.rpc_artefact_list(
  uuid, uuid, uuid, text, text, text, text, timestamptz, timestamptz, text, int
) from service_role;

revoke execute on function public.rpc_artefact_get(uuid, uuid, text) from service_role;

revoke execute on function public.rpc_event_list(
  uuid, uuid, uuid, timestamptz, timestamptz, text, text, int
) from service_role;

revoke execute on function public.rpc_deletion_receipts_list(
  uuid, uuid, text, uuid, text, timestamptz, timestamptz, text, int
) from service_role;

revoke execute on function public.rpc_consent_record(
  uuid, uuid, uuid, text, text, uuid[], uuid[], timestamptz, text
) from service_role;

revoke execute on function public.rpc_artefact_revoke(
  uuid, uuid, text, text, text, text, text
) from service_role;

revoke execute on function public.rpc_deletion_trigger(
  uuid, uuid, uuid, text, text, text, text[], text[], text, text
) from service_role;

-- ── auth + telemetry RPCs ────────────────────────────────────────────────────

revoke execute on function public.rpc_api_key_verify(text) from service_role;

revoke execute on function public.rpc_api_key_status(text) from service_role;

revoke execute on function public.rpc_api_request_log_insert(
  uuid, uuid, uuid, text, text, int, int
) from service_role;

-- ── fence helper ─────────────────────────────────────────────────────────────

revoke execute on function public.assert_api_key_binding(uuid, uuid) from service_role;
