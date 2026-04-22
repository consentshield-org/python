// ADR-1010 Phase 2 Sprint 2.1 follow-up — SUPABASE_WORKER_KEY role guard.
//
// Rule 5 (CLAUDE.md) requires that the Worker authenticate as cs_worker, not
// as service_role. The Worker authenticates to Supabase REST via the JWT in
// SUPABASE_WORKER_KEY. This guard decodes the JWT payload (no signature
// verification — that's Supabase's job server-side) and refuses to start
// unless `role === 'cs_worker'`.
//
// Local-dev stand-in: ADR-1014 Sprint 1.3 allows the service-role
// `sb_secret_*` opaque key in `worker/.dev.vars` for the E2E test harness
// where wrangler dev runs against the same Supabase project but a scoped
// cs_worker JWT would be overhead. That path opts in via the
// `ALLOW_SERVICE_ROLE_LOCAL=1` env var, which must NOT be set in production.
//
// Zero npm deps per Rule 16 — base64url decoding is done inline.

export interface RoleGuardEnv {
  SUPABASE_WORKER_KEY: string
  // Present-and-truthy → allow opaque sb_secret_* keys (local dev / E2E only).
  ALLOW_SERVICE_ROLE_LOCAL?: string
}

export class WorkerRoleGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkerRoleGuardError'
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split('.')
  if (segments.length !== 3) return null
  const payloadSeg = segments[1]
  // base64url → base64
  const b64 = payloadSeg.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '==='.slice(0, (4 - (b64.length % 4)) % 4)
  try {
    const json = atob(padded)
    const parsed = JSON.parse(json)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/**
 * Throws `WorkerRoleGuardError` if `env.SUPABASE_WORKER_KEY` is missing, is
 * not a JWT claiming `role === 'cs_worker'`, or is an sb_secret_* opaque key
 * without the local-dev opt-in. Intended to be called once per Worker
 * instance lifetime (see `index.ts` caching).
 */
export function assertWorkerKeyRole(env: RoleGuardEnv): void {
  const key = env.SUPABASE_WORKER_KEY
  if (!key || typeof key !== 'string' || key.length === 0) {
    throw new WorkerRoleGuardError('SUPABASE_WORKER_KEY is not set')
  }

  const allowLocal =
    env.ALLOW_SERVICE_ROLE_LOCAL === '1' ||
    env.ALLOW_SERVICE_ROLE_LOCAL === 'true'

  // Local-dev + test-harness bypass. ADR-1014 Sprint 1.3 permits a
  // service-role sb_secret_* stand-in in worker/.dev.vars for the E2E
  // fixtures; Miniflare-based unit tests (app/tests/worker/*.test.ts) use
  // a synthetic mock key. Both paths opt in via ALLOW_SERVICE_ROLE_LOCAL=1
  // which MUST NOT be set in production (enforced by wrangler secrets
  // being the only way to write to prod — .dev.vars is not pushed).
  if (allowLocal) return

  // Supabase new-format opaque keys. Never a JWT; rejected in prod.
  if (key.startsWith('sb_secret_') || key.startsWith('sb_publishable_')) {
    throw new WorkerRoleGuardError(
      'SUPABASE_WORKER_KEY is an sb_secret_*/sb_publishable_* opaque key. ' +
        "Rule 5 requires a scoped JWT claiming role='cs_worker'. Set " +
        'ALLOW_SERVICE_ROLE_LOCAL=1 in worker/.dev.vars only for local ' +
        'wrangler dev against E2E test fixtures (ADR-1014 Sprint 1.3).',
    )
  }

  const payload = decodeJwtPayload(key)
  if (!payload) {
    throw new WorkerRoleGuardError(
      'SUPABASE_WORKER_KEY is not a valid JWT (expected 3 base64url segments ' +
        "separated by '.'; decoded payload is not a JSON object).",
    )
  }

  const role = payload.role
  if (role !== 'cs_worker') {
    throw new WorkerRoleGuardError(
      `SUPABASE_WORKER_KEY claims role='${String(role ?? '<missing>')}', but ` +
        "Rule 5 requires role='cs_worker'. Mint a cs_worker-scoped JWT and " +
        '`wrangler secret put SUPABASE_WORKER_KEY`.',
    )
  }

  // Optional: refuse obviously-expired JWTs so a stale token isn't silently
  // sent on every request. Supabase would reject with 401 anyway, but an
  // explicit local diagnosis beats a silent 401 loop.
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new WorkerRoleGuardError(
      `SUPABASE_WORKER_KEY is expired (exp=${payload.exp}). Mint a fresh ` +
        'cs_worker JWT and redeploy.',
    )
  }
}
