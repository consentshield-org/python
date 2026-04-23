import { getAdminConfig } from './admin-config'
import { handleBannerScript } from './banner'
import { getClientIp, ipBlockedResponse, isIpBlocked } from './blocked-ip'
import { handleConsentEvent } from './events'
import { handleObservation } from './observations'

// ADR-1010 Phase 3 — Hyperdrive binding shape. Cloudflare injects this
// at runtime when wrangler.toml declares an [[hyperdrive]] binding.
// Optional in the Env interface so Miniflare tests that don't configure
// Hyperdrive still compile; call sites must branch on hasHyperdrive(env).
export interface HyperdriveBinding {
  connectionString: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}

export interface Env {
  BANNER_KV: KVNamespace
  SUPABASE_URL: string
  // ADR-1010 Phase 4 — SUPABASE_WORKER_KEY is no longer set in production.
  // The wrangler secret was deleted at Phase 4 cutover. The field stays
  // typed (and optional) because the legacy REST helpers in banner.ts /
  // origin.ts / signatures.ts / events.ts / observations.ts / worker-
  // errors.ts still reference it — they remain compiled-in for the
  // Miniflare test harness, which exercises the REST mock-server path.
  // env.HYPERDRIVE is always bound in production, so the REST branch
  // never executes outside tests.
  SUPABASE_WORKER_KEY?: string
  // ADR-1010 Phase 3 Sprint 3.1 — Hyperdrive binding for cs_worker
  // direct-Postgres reads + writes. Present in prod + future; absent in
  // the Miniflare harness where the legacy REST fallback runs.
  HYPERDRIVE?: HyperdriveBinding
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const { pathname } = url

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // Blocked-IP enforcement (ADR-0033 Sprint 2.3). Health + CORS above
    // are exempt — a blocked IP should still see a loopback probe if an
    // operator is diagnosing. Everything route-specific goes through
    // the check. Reads from the shared admin_config snapshot in KV.
    if (pathname !== '/v1/health') {
      const clientIp = getClientIp(request)
      const config = await getAdminConfig(env)
      if (isIpBlocked(clientIp, config.blocked_ips)) {
        return ipBlockedResponse()
      }
    }

    // Route dispatch
    if (pathname === '/v1/banner.js' && request.method === 'GET') {
      return handleBannerScript(request, env)
    }

    if (pathname === '/v1/events' && request.method === 'POST') {
      return handleConsentEvent(request, env, ctx)
    }

    if (pathname === '/v1/observations' && request.method === 'POST') {
      return handleObservation(request, env, ctx)
    }

    if (pathname === '/v1/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', ts: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
