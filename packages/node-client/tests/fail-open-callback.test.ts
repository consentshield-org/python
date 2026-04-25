// ADR-1006 Phase 1 Sprint 1.3 — onFailOpen callback wiring.
//
// The compliance-critical Sprint 1.2 deferred deliverable: when verify
// returns an OpenFailureEnvelope, an audit-trail callback must fire so
// the override is recorded deliberately rather than silently. Default
// implementation is a structured console.warn; production callers wire
// to Sentry / a structured logger / a /v1/audit POST.

import { describe, it, expect, vi } from 'vitest'
import { ConsentShieldClient, isOpenFailure } from '../src/index'
import type { FetchImpl, OpenFailureEnvelope } from '../src/index'

const VALID_KEY = 'cs_live_abc'

const VERIFY_INPUT = {
  propertyId: '11111111-1111-1111-1111-111111111111',
  dataPrincipalIdentifier: 'user@example.com',
  identifierType: 'email' as const,
  purposeCode: 'marketing',
}

function problemResponse(status: number): Response {
  return new Response(
    JSON.stringify({ type: 't', title: 'down', status, detail: 'eek' }),
    { status, headers: { 'content-type': 'application/problem+json', 'x-cs-trace-id': 'trace-fo' } },
  )
}

describe('onFailOpen callback', () => {
  it('fires once on verify fail-open with method ctx + envelope', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const onFailOpen = vi.fn<
      (env: OpenFailureEnvelope, ctx: { method: 'verify' | 'verifyBatch' }) => void
    >()
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })

    const result = await client.verify(VERIFY_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    expect(onFailOpen).toHaveBeenCalledTimes(1)
    const [env, ctx] = onFailOpen.mock.calls[0]!
    expect(env.status).toBe('open_failure')
    expect(env.cause).toBe('server_error')
    expect(env.traceId).toBe('trace-fo')
    expect(ctx.method).toBe('verify')
  })

  it('fires once on verifyBatch fail-open with method=verifyBatch ctx', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const onFailOpen = vi.fn<
      (env: OpenFailureEnvelope, ctx: { method: 'verify' | 'verifyBatch' }) => void
    >()
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })

    await client.verifyBatch({
      propertyId: VERIFY_INPUT.propertyId,
      identifierType: 'email',
      purposeCode: 'marketing',
      identifiers: ['a@x.com'],
    })
    expect(onFailOpen).toHaveBeenCalledTimes(1)
    expect(onFailOpen.mock.calls[0]![1].method).toBe('verifyBatch')
  })

  it('does NOT fire when verify succeeds', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      new Response(
        JSON.stringify({
          property_id: VERIFY_INPUT.propertyId,
          identifier_type: 'email',
          purpose_code: 'marketing',
          status: 'granted',
          active_artefact_id: 'a1',
          revoked_at: null,
          revocation_record_id: null,
          expires_at: null,
          evaluated_at: '2026-04-25T10:00:00Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const onFailOpen = vi.fn()
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })
    await client.verify(VERIFY_INPUT)
    expect(onFailOpen).not.toHaveBeenCalled()
  })

  it('does NOT fire when failOpen=false (the default — verify throws instead)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const onFailOpen = vi.fn()
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: false,
      onFailOpen,
    })
    await expect(client.verify(VERIFY_INPUT)).rejects.toThrow()
    expect(onFailOpen).not.toHaveBeenCalled()
  })

  it('does NOT fire when verify hits a 4xx (4xx-always-throws — no fail-open envelope)', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(403))
    const onFailOpen = vi.fn()
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })
    await expect(client.verify(VERIFY_INPUT)).rejects.toThrow()
    expect(onFailOpen).not.toHaveBeenCalled()
  })

  it('does not crash the verify call site when the callback throws synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onFailOpen = vi.fn(() => {
      throw new Error('audit sink down')
    })
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })
    const result = await client.verify(VERIFY_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('does not block the call site when the callback returns a rejected promise', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onFailOpen = vi.fn(async () => {
      throw new Error('async audit failure')
    })
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
      onFailOpen,
    })
    const result = await client.verify(VERIFY_INPUT)
    expect(isOpenFailure(result)).toBe(true)
    // Allow the rejected microtask + console.error scheduling to run.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('default callback (no onFailOpen supplied) emits a structured console.warn', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => problemResponse(503))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = new ConsentShieldClient({
      apiKey: VALID_KEY,
      baseUrl: 'https://api.example.com',
      fetchImpl: fetchMock,
      sleepImpl: async () => {},
      maxRetries: 0,
      failOpen: true,
    })
    await client.verify(VERIFY_INPUT)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [msg, payload] = warnSpy.mock.calls[0]!
    expect(String(msg)).toContain('@consentshield/node')
    expect((payload as { method: string }).method).toBe('verify')
    expect((payload as { cause: string }).cause).toBe('server_error')
    warnSpy.mockRestore()
  })
})
