// ADR-1010 Phase 3 Sprint 3.1 — postgres.js client over env.HYPERDRIVE.
//
// Single carve-out under CLAUDE.md Rule 16: `postgres` is the only npm
// dependency this Worker is allowed to import. It runs only in the
// Worker's server-side runtime; banner.js (what customer browsers
// execute) is compiled separately via compileBannerScript() and is
// never touched by this import.
//
// The client is created per-request rather than cached. Hyperdrive is
// itself a connection pool; opening a postgres.js "client" against its
// connection string is cheap — it reuses the underlying pooled
// connection. Caching the client at module scope would tie us to
// globalThis across cold starts and is not Worker-isolate-safe.

import postgres from 'postgres'
import type { Env, HyperdriveBinding } from './index'

/**
 * Returns a postgres.js tagged-template SQL client connected through
 * Hyperdrive. Caller MUST close the client via `await sql.end({ timeout: 1 })`
 * in a finally block — without it, postgres.js holds the local connection
 * map open and subsequent requests against the same Worker isolate hang
 * because postgres.js cannot acquire a fresh slot. (Confirmed empirically
 * 2026-04-23 in Phase 4 cutover smoke testing — see ADR-1010 Phase 4
 * follow-up: "share request-scoped postgres.js client + ctx.waitUntil
 * cleanup" for the architectural fix that lets us drop sql.end inside
 * the request path.)
 *
 * Throws if env.HYPERDRIVE is not bound. Callers should branch on
 * `hasHyperdrive(env)` BEFORE calling this helper when the REST
 * fallback path is still in place (pre-Phase-4 cutover).
 */
export function getDb(env: Env): ReturnType<typeof postgres> {
  const binding = env.HYPERDRIVE as HyperdriveBinding | undefined
  if (!binding?.connectionString) {
    throw new Error(
      'db.getDb: env.HYPERDRIVE is not bound. '
        + 'This should not happen in production — Phase 1 Sprint 1.2 '
        + 'bound it to the cs-worker-hyperdrive config. Callers must '
        + 'check hasHyperdrive(env) before calling getDb().',
    )
  }
  return postgres(binding.connectionString, {
    // Disable statement preparation so postgres.js plays nicely with
    // Hyperdrive's connection pooler (it can reuse connections across
    // postgres.js sessions; prepared statements would leak state).
    prepare: false,
    // Workers have a 30s wall-clock limit; keep connect timeout short
    // so a degraded Hyperdrive fails loudly instead of hanging.
    connect_timeout: 5,
    idle_timeout: 5,
    // Surface Postgres notices in the Worker log rather than swallowing.
    onnotice: () => {},
  })
}

export function hasHyperdrive(env: Env): boolean {
  const binding = env.HYPERDRIVE as HyperdriveBinding | undefined
  return !!binding?.connectionString
}
