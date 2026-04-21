// ADR-1009 Phase 2 Sprint 2.3 — fire-and-forget API request logging over
// the cs_api pool. Previously used a service-role Supabase client; now
// calls rpc_api_request_log_insert via postgres.js. Rule 5 compliant —
// no service-role key in the customer-app runtime.

import { csApi } from './cs-api-client'
import type { ApiKeyContext } from './auth'

export function logApiRequest(
  context: ApiKeyContext,
  route: string,
  method: string,
  status: number,
  latencyMs: number,
): void {
  // Fire-and-forget — never await; never block the response. Silently
  // swallow any DB error; telemetry failure must not cascade into a 500.
  const sql = csApi()
  void sql`
    select rpc_api_request_log_insert(
      ${context.key_id}::uuid,
      ${context.org_id}::uuid,
      ${context.account_id}::uuid,
      ${route}::text,
      ${method}::text,
      ${status}::int,
      ${latencyMs}::int
    )
  `.catch(() => {
    /* telemetry failure — swallow */
  })
}
