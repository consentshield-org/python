// ADR-1014 Sprint 3.2 — trace-id derivation unit coverage.
//
// Targets the pure synchronous `deriveTraceId(request)` helper exported
// via `__testing` from worker/src/events.ts. The helper must:
//   - propagate an inbound `X-CS-Trace-Id` header verbatim (after
//     trim + 64-char clamp)
//   - generate a 16-char hex id when the header is absent or blank
//   - never throw
//
// The full request-pipeline behaviour (consent_events row write +
// response header echo) is exercised by tests/e2e/worker-consent-event*.

import { describe, it, expect } from 'vitest'
import { __testing } from '../src/events'

const { deriveTraceId, TRACE_ID_HEADER } = __testing

function reqWithHeader(value: string | null): Request {
  const headers = new Headers()
  if (value !== null) headers.set(TRACE_ID_HEADER, value)
  return new Request('https://worker.example/v1/events', { method: 'POST', headers })
}

describe('deriveTraceId — propagates inbound header', () => {
  it('returns the inbound trace id verbatim when a UUID is supplied', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    expect(deriveTraceId(reqWithHeader(id))).toBe(id)
  })

  it('returns the inbound trace id verbatim for ULID-style input', () => {
    const id = '01HX0J6DWR37XMF841KD0D183W'
    expect(deriveTraceId(reqWithHeader(id))).toBe(id)
  })

  it('trims surrounding whitespace before propagating', () => {
    expect(deriveTraceId(reqWithHeader('  abc-trace-123  '))).toBe('abc-trace-123')
  })

  it('clamps oversized inbound trace ids to 64 chars to keep junk out of the index', () => {
    const long = 'a'.repeat(200)
    const result = deriveTraceId(reqWithHeader(long))
    expect(result.length).toBe(64)
    expect(result).toBe('a'.repeat(64))
  })
})

describe('deriveTraceId — generates a 16-char hex when absent', () => {
  it('generates 16-char hex when the header is missing entirely', () => {
    const id = deriveTraceId(reqWithHeader(null))
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(id.length).toBe(16)
  })

  it('generates 16-char hex when the header is the empty string', () => {
    expect(deriveTraceId(reqWithHeader(''))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('generates 16-char hex when the header is whitespace only', () => {
    // After trim → empty → falls through to generated form.
    expect(deriveTraceId(reqWithHeader('   '))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('generates a fresh value on each invocation (no leaked state)', () => {
    const a = deriveTraceId(reqWithHeader(null))
    const b = deriveTraceId(reqWithHeader(null))
    // Birthday-paradox collision over a 64-bit space at 2 samples is
    // negligible; if this ever flakes we have a far worse problem.
    expect(a).not.toBe(b)
  })
})
