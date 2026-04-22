import { Miniflare } from 'miniflare'
import { build } from 'esbuild'
import path from 'path'

const WORKER_ENTRY = path.resolve(__dirname, '../../../worker/src/index.ts')

export interface PropertyConfig {
  id?: string
  allowed_origins: string[]
  event_signing_secret: string
}

export interface BannerConfig {
  id: string
  property_id: string
  version: number
  headline: string
  body_copy: string
  position: string
  purposes: Array<{ id: string; name: string; description: string; required: boolean; default: boolean }>
  monitoring_enabled?: boolean
  is_active?: boolean
}

export interface MockState {
  properties: Record<string, PropertyConfig>
  banners: Record<string, BannerConfig>
  trackerSignatures: unknown[]
  writes: Array<{ url: string; method: string; body: unknown }>
}

interface HarnessOptions {
  state: MockState
  kvSeed?: Record<string, { value: string; expirationTtl?: number }>
}

let bundledScript: string | null = null

async function bundleWorker(): Promise<string> {
  if (bundledScript) return bundledScript
  const res = await build({
    entryPoints: [WORKER_ENTRY],
    bundle: true,
    format: 'esm',
    target: 'esnext',
    platform: 'neutral',
    write: false,
    conditions: ['worker', 'browser'],
  })
  bundledScript = res.outputFiles[0].text
  return bundledScript
}

export async function createWorker(opts: HarnessOptions): Promise<{
  mf: Miniflare
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  dispose: () => Promise<void>
  kvGet: (key: string) => Promise<string | null>
  kvPut: (key: string, value: string, opts?: { expirationTtl?: number }) => Promise<void>
}> {
  const script = await bundleWorker()

  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'index.js', contents: script }],
    compatibilityDate: '2026-04-13',
    kvNamespaces: { BANNER_KV: 'banner-kv' },
    bindings: {
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_WORKER_KEY: 'mock-worker-key',
      // ADR-1010 Sprint 2.1 follow-up — test-harness opt-in for the
      // runtime role guard. Production wrangler secrets never carry this.
      ALLOW_SERVICE_ROLE_LOCAL: '1',
    },
    outboundService: (request: Request): Response | Promise<Response> =>
      handleMockSupabase(request, opts.state),
  })

  if (opts.kvSeed) {
    const kv = await mf.getKVNamespace('BANNER_KV')
    for (const [key, { value, expirationTtl }] of Object.entries(opts.kvSeed)) {
      await kv.put(key, value, expirationTtl ? { expirationTtl } : undefined)
    }
  }

  return {
    mf,
    fetch: async (url, init) => {
      const res = await mf.dispatchFetch(url, init)
      return res as unknown as Response
    },
    dispose: () => mf.dispose(),
    kvGet: async (key) => {
      const kv = await mf.getKVNamespace('BANNER_KV')
      return (await kv.get(key)) as string | null
    },
    kvPut: async (key, value, o) => {
      const kv = await mf.getKVNamespace('BANNER_KV')
      await kv.put(key, value, o)
    },
  }
}

async function handleMockSupabase(request: Request, state: MockState): Promise<Response> {
  const url = new URL(request.url)
  if (!url.hostname.endsWith('mock.supabase.co')) {
    return new Response('unexpected host', { status: 500 })
  }

  const path = url.pathname

  // GET /rest/v1/web_properties?id=eq.<id>&select=allowed_origins,event_signing_secret
  if (request.method === 'GET' && path === '/rest/v1/web_properties') {
    const id = url.searchParams.get('id')?.replace('eq.', '')
    if (!id) return jsonResponse([])
    const p = state.properties[id]
    if (!p) return jsonResponse([])
    return jsonResponse([{ allowed_origins: p.allowed_origins, event_signing_secret: p.event_signing_secret }])
  }

  // PATCH /rest/v1/web_properties?id=eq.<id> — snippet_last_seen_at update
  if (request.method === 'PATCH' && path === '/rest/v1/web_properties') {
    const body = await safeJson(request)
    state.writes.push({ url: request.url, method: 'PATCH', body })
    return new Response(null, { status: 204 })
  }

  // GET /rest/v1/consent_banners?property_id=eq.<id>&is_active=eq.true&select=*
  if (request.method === 'GET' && path === '/rest/v1/consent_banners') {
    const pid = url.searchParams.get('property_id')?.replace('eq.', '')
    if (!pid) return jsonResponse([])
    const b = state.banners[pid]
    if (!b || b.is_active === false) return jsonResponse([])
    return jsonResponse([b])
  }

  // GET /rest/v1/tracker_signatures?select=*
  if (request.method === 'GET' && path === '/rest/v1/tracker_signatures') {
    return jsonResponse(state.trackerSignatures)
  }

  // POST /rest/v1/consent_events
  if (request.method === 'POST' && path === '/rest/v1/consent_events') {
    const body = await safeJson(request)
    state.writes.push({ url: request.url, method: 'POST', body })
    return new Response(null, { status: 201 })
  }

  // POST /rest/v1/tracker_observations
  if (request.method === 'POST' && path === '/rest/v1/tracker_observations') {
    const body = await safeJson(request)
    state.writes.push({ url: request.url, method: 'POST', body })
    return new Response(null, { status: 201 })
  }

  // POST /rest/v1/worker_errors — N-S1 fallback observability path
  if (request.method === 'POST' && path === '/rest/v1/worker_errors') {
    const body = await safeJson(request)
    state.writes.push({ url: request.url, method: 'POST', body })
    return new Response(null, { status: 201 })
  }

  return new Response(`no mock for ${request.method} ${path}`, { status: 404 })
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function safeJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

// HMAC helper so tests can build signatures the same way the banner would
// if it ever signed — and the way the Next.js server-side caller does.
export async function signHmac(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function defaultState(): MockState {
  return {
    properties: {},
    banners: {},
    trackerSignatures: [],
    writes: [],
  }
}
