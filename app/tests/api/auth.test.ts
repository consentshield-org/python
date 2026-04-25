// ADR-1014 Phase 4 Sprint 4.3 — unit coverage for app/src/lib/api/auth.ts.
//
// Targets the pure synchronous branches of `verifyBearerToken` (header
// missing, regex parse failures) + the pure `problemJson` builder. The
// SQL-bound branches (valid key / revoked / invalid via rpc_api_key_status)
// run under the cs_api LOGIN role and are exercised by the Phase 3 E2E
// suites + the integration tests under tests/integration/. We don't unit-
// test those here — mocking the entire postgres.js client stack would
// produce mostly fixture-shape assertions, not behavioural ones.

import { describe, it, expect } from 'vitest'
import { problemJson, verifyBearerToken } from '@/lib/api/auth'

describe('verifyBearerToken — pre-SQL branches', () => {
  it('returns 401/missing for null header', async () => {
    const result = await verifyBearerToken(null)
    expect(result).toEqual({ ok: false, status: 401, reason: 'missing' })
  })

  it('returns 401/missing for empty string', async () => {
    const result = await verifyBearerToken('')
    expect(result).toEqual({ ok: false, status: 401, reason: 'missing' })
  })

  it('returns 401/malformed when scheme is not Bearer', async () => {
    const result = await verifyBearerToken('Basic cs_live_abc123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when scheme is lowercase bearer', async () => {
    // The regex anchors on capital "Bearer" — lowercase MUST NOT pass.
    const result = await verifyBearerToken('bearer cs_live_abc123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when token does not start with cs_live_', async () => {
    // Defends against a mutation that drops the prefix anchor — a valid-
    // looking opaque token MUST be rejected without ever touching the DB.
    const result = await verifyBearerToken('Bearer sk_live_abc123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when token uses cs_test_ prefix', async () => {
    // Only cs_live_ keys are honoured (no test-key class). Defends against
    // a mutation that broadens the prefix.
    const result = await verifyBearerToken('Bearer cs_test_abc123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when prefix is upper-cased', async () => {
    const result = await verifyBearerToken('Bearer CS_LIVE_abc123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when token is empty after the prefix', async () => {
    // /^Bearer (cs_live_\S+)$/ requires ≥1 non-whitespace char after the
    // prefix. Bare "Bearer cs_live_" has zero chars in the capture group.
    const result = await verifyBearerToken('Bearer cs_live_')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when there is a trailing space (regex is anchored)', async () => {
    const result = await verifyBearerToken('Bearer cs_live_abc ')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when there is whitespace inside the token', async () => {
    // \S+ refuses any whitespace. Any space-separated trailing data is
    // either trailing junk (above) or a multi-token payload — rejected.
    const result = await verifyBearerToken('Bearer cs_live_abc def')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when scheme has no separator before token', async () => {
    const result = await verifyBearerToken('Bearercs_live_abc')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed when there are multiple spaces between scheme and token', async () => {
    // Single-space separator only. A double-space form is not RFC 7235
    // compliant and the regex MUST refuse it.
    const result = await verifyBearerToken('Bearer  cs_live_abc')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('returns 401/malformed for a header that contains Bearer cs_live_X but does not START with it', async () => {
    // Defends against a regex mutant that drops the `^` anchor — without
    // it, "JunkBearer cs_live_abc" would substring-match the tail and
    // wrongly enter the SQL path. The leading anchor MUST be load-bearing.
    // The distinction matters: regex-reject returns 'malformed', whereas
    // a regex-pass that fails downstream returns 'invalid'.
    const result = await verifyBearerToken('JunkBearer cs_live_abc')
    expect(result).toEqual({ ok: false, status: 401, reason: 'malformed' })
  })

  it('a well-formed multi-char token reaches the SQL branch (returns invalid, not malformed)', async () => {
    // Defends against two regex mutants:
    //   - dropping the `+` quantifier on \S (capture would shrink to 1 char)
    //   - flipping \S → \s (capture would require whitespace, not text)
    // Both mutants make the regex REJECT a well-formed multi-char token,
    // returning 'malformed'. The original regex accepts it, hits the SQL
    // branch in the test env (where SUPABASE_CS_API_DATABASE_URL is unset
    // or unreachable), and the catch clause returns 'invalid'. The
    // distinct reason code is the kill signal.
    const result = await verifyBearerToken('Bearer cs_live_abcdef0123')
    expect(result).toEqual({ ok: false, status: 401, reason: 'invalid' })
  })
})

describe('problemJson — RFC 7807 body builder', () => {
  it('returns the four canonical fields', () => {
    const body = problemJson(403, 'Forbidden', 'No scope.')
    expect(body.status).toBe(403)
    expect(body.title).toBe('Forbidden')
    expect(body.detail).toBe('No scope.')
  })

  it('builds the type URL with lower-case + dashed title', () => {
    expect(problemJson(400, 'Bad Request', 'x').type).toBe(
      'https://consentshield.in/errors/bad-request',
    )
  })

  it('collapses multiple spaces in the title to single dashes', () => {
    // The `\s+` is repetition-aware; any whitespace run becomes one dash.
    expect(problemJson(400, 'A   B', 'x').type).toBe(
      'https://consentshield.in/errors/a-b',
    )
  })

  it('uses the consentshield.in errors namespace exactly', () => {
    // Defends against a host-substitution mutant.
    expect(problemJson(404, 'NotFound', 'x').type).toContain(
      'https://consentshield.in/errors/',
    )
  })

  it('honours the supplied status verbatim', () => {
    expect(problemJson(429, 'Too Many', 'x').status).toBe(429)
    expect(problemJson(503, 'Down', 'x').status).toBe(503)
  })

  it('spreads extras onto the result so well-known overrides take effect', () => {
    const body = problemJson(403, 'Forbidden', 'x', { 'cs-trace-id': 'abc', requiredScope: 'read' })
    expect(body['cs-trace-id']).toBe('abc')
    expect(body.requiredScope).toBe('read')
  })

  it('extras are spread AFTER the canonical fields (last-write-wins)', () => {
    // Defends against a mutant that flips the spread order — extras must
    // be able to override (used by callers that want a non-default `type`).
    const body = problemJson(400, 'Bad', 'x', { type: 'https://other.example/code' })
    expect(body.type).toBe('https://other.example/code')
  })

  it('omits an extras object cleanly when none provided', () => {
    const body = problemJson(400, 'Bad', 'x')
    expect(Object.keys(body).sort()).toEqual(['detail', 'status', 'title', 'type'])
  })
})
