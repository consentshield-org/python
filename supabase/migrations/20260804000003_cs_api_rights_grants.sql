-- ADR-1005 Sprint 5.1 — GRANT EXECUTE on the two new Rights API RPCs to
-- cs_api. Matches the ADR-1009 Phase 2 pattern (20260801000008).
--
-- service_role is deliberately NOT granted. These RPCs are v1-path only;
-- the ADR-1009 Sprint 2.4 revoke policy applies to them from day one.

revoke execute on function public.rpc_rights_request_create_api(
  uuid, uuid, text, text, text, text, text, text
) from anon, authenticated;

grant execute on function public.rpc_rights_request_create_api(
  uuid, uuid, text, text, text, text, text, text
) to cs_api;

revoke execute on function public.rpc_rights_request_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, int
) from anon, authenticated;

grant execute on function public.rpc_rights_request_list(
  uuid, uuid, text, text, timestamptz, timestamptz, text, text, int
) to cs_api;
