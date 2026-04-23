import type { Env } from './index'
import { getDb, hasHyperdrive } from './db'

export interface PropertyConfig {
  allowed_origins: string[]
  event_signing_secret: string
}

export type OriginResult =
  | { status: 'valid'; origin: string }
  | { status: 'unverified' }
  | { status: 'rejected'; origin: string }

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export async function getPropertyConfig(
  propertyId: string,
  env: Env,
): Promise<PropertyConfig | null> {
  // Try KV cache (shared across both mechanisms).
  const cacheKey = `property:config:${propertyId}`
  const cached = await env.BANNER_KV.get(cacheKey, 'json')
  if (cached) return cached as PropertyConfig

  // ADR-1010 Phase 3 Sprint 3.1 — prefer Hyperdrive-backed SQL when
  // the binding is available (prod + future). Falls through to the
  // legacy REST path only in the Miniflare harness, which does not
  // configure a Hyperdrive binding. The fallback disappears at Phase 4
  // cutover.
  const config = hasHyperdrive(env)
    ? await getPropertyConfigSql(propertyId, env)
    : await getPropertyConfigRest(propertyId, env)

  if (config) {
    await env.BANNER_KV.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 })
  }
  return config
}

async function getPropertyConfigSql(
  propertyId: string,
  env: Env,
): Promise<PropertyConfig | null> {
  const sql = getDb(env)
  try {
    const rows = await sql<PropertyConfig[]>`
      select allowed_origins, event_signing_secret
        from public.web_properties
       where id = ${propertyId}
       limit 1
    `
    return rows[0] ?? null
  } catch {
    // Per CLAUDE.md — Worker failures must never break the customer's
    // site. Surface null so banner.ts returns the graceful 404 path.
    return null
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {})
  }
}

async function getPropertyConfigRest(
  propertyId: string,
  env: Env,
): Promise<PropertyConfig | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/web_properties?id=eq.${propertyId}&select=allowed_origins,event_signing_secret`,
    {
      headers: {
        apikey: env.SUPABASE_WORKER_KEY ?? '',
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      },
    },
  )
  if (!res.ok) return null
  const rows = (await res.json()) as PropertyConfig[]
  return rows[0] ?? null
}

export async function getPreviousSigningSecret(
  propertyId: string,
  env: Env,
): Promise<string | null> {
  return env.BANNER_KV.get(`signing_secret_prev:${propertyId}`)
}

export function validateOrigin(request: Request, allowedOrigins: string[]): OriginResult {
  const origin = request.headers.get('Origin') || request.headers.get('Referer')

  if (!origin) {
    return { status: 'unverified' }
  }

  let originHost: string
  try {
    const url = new URL(origin)
    originHost = url.origin
  } catch {
    originHost = origin
  }

  // Empty allowed_origins → treat as rejected. A property that has not
  // configured origins cannot authenticate browser events. This is the
  // authentication boundary now that the banner no longer ships a secret.
  if (allowedOrigins.length === 0) {
    return { status: 'rejected', origin: originHost }
  }

  for (const allowed of allowedOrigins) {
    try {
      const allowedUrl = new URL(allowed)
      if (allowedUrl.origin === originHost) {
        return { status: 'valid', origin: originHost }
      }
    } catch {
      if (allowed === originHost) {
        return { status: 'valid', origin: originHost }
      }
    }
  }

  return { status: 'rejected', origin: originHost }
}

export function rejectOrigin(origin: string): Response {
  return new Response(
    `Origin ${origin} is not in the allowed origins for this property`,
    { status: 403, headers: CORS_HEADERS },
  )
}
