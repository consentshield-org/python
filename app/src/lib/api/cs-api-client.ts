// ADR-1009 Phase 2 — cs_api direct-Postgres client.
//
// Replaces the service-role Supabase REST client in /api/v1/* handlers. The
// Next.js server runtime connects as `cs_api` via postgres.js against the
// Supavisor transaction pooler; all data access is through whitelisted
// SECURITY DEFINER RPCs (cs_api has zero table privileges — enforced in the
// 20260520000001 migration).
//
// Why direct Postgres (not Supabase REST + a cs_api JWT)? Supabase is rotating
// the project JWT signing keys from HS256 (shared secret) to ECC P-256
// (asymmetric). HS256-signed scoped-role JWTs are living off the "Previously
// used" key tail; once that legacy key is revoked, every such JWT stops
// working. Direct Postgres connections as LOGIN roles are unaffected — the
// same pattern cs_delivery / cs_orchestrator already use from Edge Functions.
//
// Fluid Compute note: the module-scope `sql` singleton is reused across
// concurrent requests on the same function instance. postgres.js manages its
// own connection pool inside; we don't create a pool per request.
//
// Env: SUPABASE_CS_API_DATABASE_URL
//   postgresql://cs_api.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require

import postgres from 'postgres'

const connectionString = process.env.SUPABASE_CS_API_DATABASE_URL

// Lazy-initialise: throw on first use if env missing, not at import time.
// Keeps `next build` clean in environments where the DB URL isn't set yet
// (CI, preview without env, etc.) and lets tests skip gracefully.
let _sql: ReturnType<typeof postgres> | null = null

export function csApi() {
  if (!connectionString) {
    throw new Error(
      'SUPABASE_CS_API_DATABASE_URL is not set. ADR-1009 Phase 2 requires a ' +
        'cs_api connection string (Supavisor pooler, transaction mode). See ' +
        'migration 20260801000006 for role setup.',
    )
  }
  if (_sql === null) {
    _sql = postgres(connectionString, {
      // Transaction-mode pooler — no prepared statements (Supavisor caveat).
      prepare: false,
      // Modest pool size: serverless instances handle few concurrent queries
      // each; postgres.js multiplexes well.
      max: 5,
      // Bail fast on idle connection errors rather than waiting 30s.
      idle_timeout: 20,
      connect_timeout: 10,
      // Supabase ships Postgres with TLS required; Supavisor enforces it too.
      ssl: 'require',
      // Never log the connection string or query values to stdout.
      debug: false,
      // JSON transforms — keep rows as-is. RPCs return jsonb directly.
      transform: { undefined: null },
    })
  }
  return _sql
}

// Helper for call-sites that expect a skipped test when env is missing.
export function isCsApiConfigured(): boolean {
  return !!connectionString
}
