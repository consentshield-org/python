// ADR-1010 Sprint 2.1 follow-up — Rule-5 runtime role guard unit tests.
//
// Direct import of worker/src/role-guard.ts — no Miniflare, since the guard
// is a pure function. Covers:
//   - missing key → reject
//   - JWT claiming role=cs_worker + no exp → accept
//   - JWT claiming role=cs_worker + future exp → accept
//   - JWT claiming role=cs_worker + past exp → reject with expiry message
//   - JWT claiming role=service_role → reject with role-mismatch message
//   - JWT with no role claim → reject
//   - malformed JWT (not 3 segments) → reject
//   - sb_secret_* without ALLOW_SERVICE_ROLE_LOCAL → reject
//   - sb_secret_* with ALLOW_SERVICE_ROLE_LOCAL=1 → accept
//   - mock junk key with ALLOW_SERVICE_ROLE_LOCAL=1 → accept (harness parity)

import { describe, it, expect } from 'vitest'
import {
  assertWorkerKeyRole,
  WorkerRoleGuardError,
} from '../../../worker/src/role-guard'

function mintJwt(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  return `${b64url(header)}.${b64url(payload)}.signature-placeholder`
}

describe('assertWorkerKeyRole — Rule 5 runtime enforcement', () => {

  it('accepts a JWT claiming role=cs_worker (no exp)', () => {
    const jwt = mintJwt({ role: 'cs_worker', iss: 'supabase' })
    expect(() => assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })).not.toThrow()
  })

  it('accepts a JWT claiming role=cs_worker with a future exp', () => {
    const jwt = mintJwt({
      role: 'cs_worker',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
    expect(() => assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })).not.toThrow()
  })

  it('rejects an expired cs_worker JWT with an expiry message', () => {
    const jwt = mintJwt({
      role: 'cs_worker',
      exp: Math.floor(Date.now() / 1000) - 60,
    })
    expect(() => assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })).toThrowError(
      /expired/i,
    )
  })

  it('rejects a JWT claiming role=service_role', () => {
    const jwt = mintJwt({ role: 'service_role' })
    try {
      assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkerRoleGuardError)
      expect((e as Error).message).toMatch(/service_role/)
      expect((e as Error).message).toMatch(/cs_worker/)
    }
  })

  it('rejects a JWT claiming role=authenticated', () => {
    const jwt = mintJwt({ role: 'authenticated' })
    expect(() => assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })).toThrowError(
      /authenticated/,
    )
  })

  it('rejects a JWT with no role claim', () => {
    const jwt = mintJwt({ iss: 'supabase' })
    expect(() => assertWorkerKeyRole({ SUPABASE_WORKER_KEY: jwt })).toThrowError(
      /role=/,
    )
  })

  it('rejects a malformed (non-JWT) string', () => {
    expect(() =>
      assertWorkerKeyRole({ SUPABASE_WORKER_KEY: 'not-a-jwt' }),
    ).toThrowError(/not a valid JWT/)
  })

  it('rejects an sb_secret_* opaque key without ALLOW_SERVICE_ROLE_LOCAL', () => {
    expect(() =>
      assertWorkerKeyRole({
        SUPABASE_WORKER_KEY: 'sb_secret_abcdef0123456789',
      }),
    ).toThrowError(/sb_secret_/)
  })

  it('accepts an sb_secret_* opaque key when ALLOW_SERVICE_ROLE_LOCAL=1', () => {
    expect(() =>
      assertWorkerKeyRole({
        SUPABASE_WORKER_KEY: 'sb_secret_abcdef0123456789',
        ALLOW_SERVICE_ROLE_LOCAL: '1',
      }),
    ).not.toThrow()
  })

  it('accepts an sb_publishable_* key when ALLOW_SERVICE_ROLE_LOCAL=true', () => {
    expect(() =>
      assertWorkerKeyRole({
        SUPABASE_WORKER_KEY: 'sb_publishable_xyz',
        ALLOW_SERVICE_ROLE_LOCAL: 'true',
      }),
    ).not.toThrow()
  })

  it('accepts a mock junk key with ALLOW_SERVICE_ROLE_LOCAL=1 (test-harness parity)', () => {
    expect(() =>
      assertWorkerKeyRole({
        SUPABASE_WORKER_KEY: 'mock-worker-key',
        ALLOW_SERVICE_ROLE_LOCAL: '1',
      }),
    ).not.toThrow()
  })

  it('rejects a missing SUPABASE_WORKER_KEY even with ALLOW_SERVICE_ROLE_LOCAL=1', () => {
    // The local-dev flag cannot rescue an empty key — the Worker literally
    // can't call Supabase without one.
    expect(() =>
      assertWorkerKeyRole({
        SUPABASE_WORKER_KEY: '',
        ALLOW_SERVICE_ROLE_LOCAL: '1',
      }),
    ).toThrowError(/not set/)
  })

  it('rejects an empty-string key in production', () => {
    expect(() =>
      assertWorkerKeyRole({ SUPABASE_WORKER_KEY: '' }),
    ).toThrowError(/not set/)
  })

})
