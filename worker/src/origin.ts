import type { Env } from './index'

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
  // Try KV cache
  const cacheKey = `property:config:${propertyId}`
  const cached = await env.BANNER_KV.get(cacheKey, 'json')
  if (cached) return cached as PropertyConfig

  // Fetch from Supabase via cs_worker role
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/web_properties?id=eq.${propertyId}&select=allowed_origins,event_signing_secret`,
    {
      headers: {
        apikey: env.SUPABASE_WORKER_KEY,
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      },
    },
  )

  if (!res.ok) return null

  const rows = (await res.json()) as PropertyConfig[]
  if (rows.length === 0) return null

  const config = rows[0]
  // Cache for 5 minutes
  await env.BANNER_KV.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 })
  return config
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
