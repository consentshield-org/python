-- ADR-1009 Phase 2 Sprint 2.1 follow-up — grant cs_api EXECUTE on the two
-- "bootstrap" RPCs the middleware calls BEFORE any v1 business RPC fires:
--
--   rpc_api_key_verify(text)            — middleware Bearer verification
--   rpc_api_request_log_insert(...)     — fire-and-forget telemetry insert
--
-- Separated from 20260801000006 only because that migration was already
-- applied by the time we caught the missing grant in the Sprint 2.1 smoke
-- suite. Sprint 2.2 grants the 12 v1 business RPCs; these two sit before
-- any of those in the request path and have to be live the moment we
-- swap auth.ts / log-request.ts to the cs_api pool.

grant execute on function public.rpc_api_key_verify(text) to cs_api;

-- rpc_api_request_log_insert's argument list (from 20260601000001):
--   (uuid, uuid, uuid, text, text, int, int)
-- = key_id, org_id, account_id, route, method, status, latency.
grant execute on function public.rpc_api_request_log_insert(
  uuid, uuid, uuid, text, text, int, int
) to cs_api;
