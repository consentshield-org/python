// ADR-1003 Sprint 1.2 — Worker-side zero-storage bridge unit tests.
//
// Exercises postToBridge() + isBridgeConfigured() directly. The
// end-to-end Worker branch (Worker → mock KV → fetch interception) is
// covered separately in the Miniflare harness suites — here we keep
// the unit scope small and fast.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isBridgeConfigured,
  postToBridge,
} from '../../../worker/src/zero-storage-bridge'

function makeEnv(overrides: Record<string, unknown> = {}): unknown {
  return {
    BANNER_KV: { get: async () => null },
    SUPABASE_URL: 'https://stub.supabase.co',
    ZERO_STORAGE_BRIDGE_URL: 'https://app.example/api/internal/zero-storage-event',
    WORKER_BRIDGE_SECRET: 'test-bridge-secret',
    ...overrides,
  }
}

const PARAMS = {
  kind: 'consent_event' as const,
  org_id: '11111111-1111-4111-8111-111111111111',
  event_fingerprint: 'fp-abc-123',
  timestamp: '2026-04-24T12:00:00.000Z',
  payload: { property_id: 'p1', banner_id: 'b1' },
}

describe('isBridgeConfigured', () => {
  it('true when both env vars are set', () => {
    expect(isBridgeConfigured(makeEnv() as never)).toBe(true)
  })
  it('false when URL is missing', () => {
    expect(
      isBridgeConfigured(makeEnv({ ZERO_STORAGE_BRIDGE_URL: undefined }) as never),
    ).toBe(false)
  })
  it('false when secret is missing', () => {
    expect(
      isBridgeConfigured(makeEnv({ WORKER_BRIDGE_SECRET: undefined }) as never),
    ).toBe(false)
  })
  it('false when URL is empty string', () => {
    expect(
      isBridgeConfigured(makeEnv({ ZERO_STORAGE_BRIDGE_URL: '' }) as never),
    ).toBe(false)
  })
})

describe('postToBridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns not_configured when bridge env is absent', async () => {
    const env = makeEnv({ ZERO_STORAGE_BRIDGE_URL: undefined })
    const result = await postToBridge(env as never, PARAMS)
    expect(result).toEqual({ sent: false, reason: 'not_configured' })
  })

  it('POSTs with Bearer auth + JSON body on happy path', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    const env = makeEnv()
    const result = await postToBridge(env as never, PARAMS)
    expect(result).toEqual({ sent: true, status: 202 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(url).toBe('https://app.example/api/internal/zero-storage-event')
    const headers = (init!.headers as Record<string, string>)
    expect(headers.Authorization).toBe('Bearer test-bridge-secret')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init!.body as string)).toMatchObject({
      kind: 'consent_event',
      org_id: PARAMS.org_id,
    })
  })

  it('returns non_2xx + status + clipped detail on 4xx/5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('boom: ' + 'x'.repeat(1000), { status: 502 }),
    )
    const env = makeEnv()
    const result = await postToBridge(env as never, PARAMS)
    expect(result.sent).toBe(false)
    if (!result.sent) {
      expect(result.reason).toBe('non_2xx')
      expect(result.status).toBe(502)
      expect(result.detail?.length).toBeLessThanOrEqual(400)
    }
  })

  it('returns network_error on fetch throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('dns_failure'))
    const env = makeEnv()
    const result = await postToBridge(env as never, PARAMS)
    expect(result.sent).toBe(false)
    if (!result.sent) {
      expect(result.reason).toBe('network_error')
      expect(result.detail).toContain('dns_failure')
    }
  })
})
