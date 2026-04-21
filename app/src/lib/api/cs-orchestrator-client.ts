// ADR-1013 Phase 1 — cs_orchestrator direct-Postgres client.
//
// Mirrors app/src/lib/api/cs-api-client.ts exactly; the only difference is
// the connection string and the role it logs in as. See ADR-1013 for why the
// Next.js runtime needs a cs_orchestrator pool alongside the cs_api one.
//
// Called by:
//   * /api/public/signup-intake — public RPC `create_signup_intake`
//   * /api/internal/invitation-dispatch — reads + updates public.invitations
//   * app/src/lib/invitations/dispatch.ts — same, via the reusable helper
//
// All data access goes through existing SECURITY DEFINER RPCs or through
// direct SELECT/UPDATE on public.invitations that cs_orchestrator already
// has grants for (seed migration 20260413000010 + downstream bypassrls).
//
// Fluid Compute note: module-scope `sql` singleton is reused across
// concurrent requests on the same function instance; postgres.js manages
// its own pool internally.

import postgres from 'postgres'

const connectionString = process.env.SUPABASE_CS_ORCHESTRATOR_DATABASE_URL

let _sql: ReturnType<typeof postgres> | null = null

export function csOrchestrator() {
  if (!connectionString) {
    throw new Error(
      'SUPABASE_CS_ORCHESTRATOR_DATABASE_URL is not set. ADR-1013 Phase 1 ' +
        'requires a cs_orchestrator connection string (Supavisor pooler, ' +
        'transaction mode). Mirror SUPABASE_CS_API_DATABASE_URL — only the ' +
        'user + password differ (cs_orchestrator.<ref> / rotated password ' +
        'from ADR-1013 Sprint 1.2 step 1).',
    )
  }
  if (_sql === null) {
    _sql = postgres(connectionString, {
      // Transaction-mode pooler — no prepared statements (Supavisor caveat).
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: 'require',
      debug: false,
      transform: { undefined: null },
    })
  }
  return _sql
}
