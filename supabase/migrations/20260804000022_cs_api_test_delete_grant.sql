-- ADR-1005 Phase 2 Sprint 2.1 — GRANT EXECUTE on rpc_test_delete_trigger
-- to cs_api. Matches the ADR-1009 Phase 2 pattern; service_role is
-- deliberately NOT granted (v1-path only).

revoke execute on function public.rpc_test_delete_trigger(uuid, uuid, uuid)
  from anon, authenticated;

grant execute on function public.rpc_test_delete_trigger(uuid, uuid, uuid)
  to cs_api;
