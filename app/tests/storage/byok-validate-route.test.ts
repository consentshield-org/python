// ADR-1025 Phase 3 Sprint 3.1 + ADR-1003 Sprint 2.1 — byok-validate route
// unit tests.
//
// The route composes four collaborators: requireOrgAccess, verifyTurnstileToken,
// checkRateLimit, and runScopeDownProbe. (Sprint 2.1 swapped the previous
// runVerificationProbe for runScopeDownProbe.) This suite mocks all four and
// drives the route handler directly with hand-built Request objects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Module-level mocks ───────────────────────────────────────────────────
vi.mock('@/lib/auth/require-org-role', async () => {
  class OrgAccessDeniedError extends Error {
    constructor(
      public reason: 'unauthenticated' | 'not_a_member' | 'insufficient_role',
    ) {
      super(reason)
    }
  }
  return {
    OrgAccessDeniedError,
    requireOrgAccess: vi.fn(),
  }
})
vi.mock('@/lib/rights/turnstile', () => ({ verifyTurnstileToken: vi.fn() }))
vi.mock('@/lib/rights/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/storage/validate', () => ({ runScopeDownProbe: vi.fn() }))

// Typed access to the mocks
import { OrgAccessDeniedError, requireOrgAccess } from '@/lib/auth/require-org-role'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { runScopeDownProbe } from '@/lib/storage/validate'

const orgAccessMock = requireOrgAccess as unknown as ReturnType<typeof vi.fn>
const turnstileMock = verifyTurnstileToken as unknown as ReturnType<typeof vi.fn>
const rateLimitMock = checkRateLimit as unknown as ReturnType<typeof vi.fn>
const probeMock = runScopeDownProbe as unknown as ReturnType<typeof vi.fn>

// ── Fixtures ─────────────────────────────────────────────────────────────
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const VALID_BODY = {
  provider: 'customer_r2',
  bucket: 'my-bucket',
  region: 'auto',
  endpoint: 'https://abc.r2.cloudflarestorage.com',
  access_key_id: 'AKIA_TEST_KEY',
  secret_access_key: 'super-secret-value',
  turnstile_token: 'turnstile-ok',
}

function buildReq(body: unknown = VALID_BODY) {
  return new Request('https://x/api/orgs/test/storage/byok-validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callRoute(body: unknown = VALID_BODY) {
  const { POST } = await import(
    '@/app/api/orgs/[orgId]/storage/byok-validate/route'
  )
  return POST(buildReq(body), {
    params: Promise.resolve({ orgId: ORG_ID }),
  })
}

function defaultAuthCtx() {
  return {
    supabase: {} as never,
    user: { id: USER_ID } as never,
    orgId: ORG_ID,
    role: 'org_admin' as const,
  }
}

function happyChecks() {
  return {
    put: { expected: 'allow' as const, status: 200, outcome: 'expected' as const },
    head: { expected: 'deny' as const, status: 403, outcome: 'expected' as const },
    get: { expected: 'deny' as const, status: 403, outcome: 'expected' as const },
    list: { expected: 'deny' as const, status: 403, outcome: 'expected' as const },
    delete: {
      expected: 'deny' as const,
      status: 403,
      outcome: 'expected' as const,
    },
  }
}

// ── Setup / teardown ─────────────────────────────────────────────────────
beforeEach(() => {
  orgAccessMock.mockReset()
  turnstileMock.mockReset()
  rateLimitMock.mockReset()
  probeMock.mockReset()
  // Sensible defaults; individual tests override.
  orgAccessMock.mockResolvedValue(defaultAuthCtx())
  turnstileMock.mockResolvedValue({ ok: true })
  rateLimitMock.mockResolvedValue({ allowed: true, retryInSeconds: 0 })
  probeMock.mockResolvedValue({
    ok: true,
    probeId: 'cs-probe-abc',
    durationMs: 812,
    checks: happyChecks(),
    orphanObjectKey: 'cs-probe-abc.txt',
  })
})

afterEach(() => vi.resetModules())

// ═══════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════
describe('byok-validate — happy path', () => {
  it('200 with scope-down envelope; credentials never appear in response', async () => {
    const res = await callRoute()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.probe_id).toBe('cs-probe-abc')
    expect(json.duration_ms).toBe(812)
    expect(json.checks).toEqual(happyChecks())
    expect(json.orphan_object_key).toBe('cs-probe-abc.txt')
    expect(json.remediation).toBeUndefined()
    // Probe called with the supplied creds.
    expect(probeMock).toHaveBeenCalledOnce()
    const cfg = probeMock.mock.calls[0][0]
    expect(cfg.provider).toBe('customer_r2')
    expect(cfg.bucket).toBe('my-bucket')
    expect(cfg.accessKeyId).toBe('AKIA_TEST_KEY')
    expect(cfg.secretAccessKey).toBe('super-secret-value')
    // Response body does NOT echo the secret.
    const bodyStr = JSON.stringify(json)
    expect(bodyStr).not.toContain('super-secret-value')
    expect(bodyStr).not.toContain('AKIA_TEST_KEY')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Auth rejection branches
// ═══════════════════════════════════════════════════════════════════════
describe('byok-validate — auth', () => {
  it('401 when requireOrgAccess throws unauthenticated', async () => {
    orgAccessMock.mockRejectedValueOnce(
      new OrgAccessDeniedError('unauthenticated'),
    )
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it('403 when caller is not a member', async () => {
    orgAccessMock.mockRejectedValueOnce(new OrgAccessDeniedError('not_a_member'))
    const res = await callRoute()
    expect(res.status).toBe(403)
  })

  it('403 when caller is a member but not an org_admin', async () => {
    orgAccessMock.mockRejectedValueOnce(
      new OrgAccessDeniedError('insufficient_role'),
    )
    const res = await callRoute()
    expect(res.status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Turnstile + rate-limit
// ═══════════════════════════════════════════════════════════════════════
describe('byok-validate — Turnstile + rate-limit', () => {
  it('400 when Turnstile verification fails', async () => {
    turnstileMock.mockResolvedValueOnce({ ok: false, error: 'invalid-token' })
    const res = await callRoute()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('turnstile_failed')
    // Probe must NOT run when Turnstile rejects.
    expect(probeMock).not.toHaveBeenCalled()
  })

  it('429 when rate limit exhausted; includes Retry-After header', async () => {
    rateLimitMock.mockResolvedValueOnce({
      allowed: false,
      retryInSeconds: 1234,
    })
    const res = await callRoute()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1234')
    const json = await res.json()
    expect(json.retry_in_seconds).toBe(1234)
    // Probe must NOT run when rate limit hits.
    expect(probeMock).not.toHaveBeenCalled()
  })

  it('rate-limit key is scoped per-user (prevents org-swap DoS)', async () => {
    await callRoute()
    expect(rateLimitMock).toHaveBeenCalledWith(
      `byok-validate:${USER_ID}`,
      5,
      60,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Body validation
// ═══════════════════════════════════════════════════════════════════════
describe('byok-validate — body validation', () => {
  it('400 on invalid JSON', async () => {
    const badReq = new Request('https://x/api', {
      method: 'POST',
      body: 'not-json',
    })
    const { POST } = await import(
      '@/app/api/orgs/[orgId]/storage/byok-validate/route'
    )
    const res = await POST(badReq, {
      params: Promise.resolve({ orgId: ORG_ID }),
    })
    expect(res.status).toBe(400)
  })

  const REQUIRED = [
    'provider',
    'bucket',
    'region',
    'endpoint',
    'access_key_id',
    'secret_access_key',
    'turnstile_token',
  ]
  for (const field of REQUIRED) {
    it(`400 when ${field} is missing`, async () => {
      const body = { ...VALID_BODY, [field]: undefined }
      const res = await callRoute(body)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json).toEqual({ error: 'missing_field', field })
    })
  }

  it('400 when provider is not customer_r2/customer_s3', async () => {
    const res = await callRoute({ ...VALID_BODY, provider: 'cs_managed_r2' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('invalid_provider')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Probe-failure passthrough
// ═══════════════════════════════════════════════════════════════════════
describe('byok-validate — probe failure', () => {
  it('200 with ok=false + per-check breakdown + remediation when creds are over-scoped', async () => {
    const overScopedChecks = {
      ...happyChecks(),
      get: { expected: 'deny' as const, status: 200, outcome: 'over_scoped' as const },
    }
    probeMock.mockResolvedValueOnce({
      ok: false,
      probeId: 'cs-probe-xyz',
      durationMs: 430,
      checks: overScopedChecks,
      remediation:
        'Your credential is over-scoped. Remove s3:GetObject from the policy.',
      orphanObjectKey: 'cs-probe-xyz.txt',
    })
    const res = await callRoute()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.probe_id).toBe('cs-probe-xyz')
    expect(json.checks.get.outcome).toBe('over_scoped')
    expect(json.remediation).toContain('s3:GetObject')
    expect(json.orphan_object_key).toBe('cs-probe-xyz.txt')
  })

  it('credentials never surface in the failure response', async () => {
    probeMock.mockResolvedValueOnce({
      ok: false,
      probeId: 'cs-probe-xyz',
      durationMs: 430,
      checks: {
        ...happyChecks(),
        put: {
          expected: 'allow' as const,
          status: null,
          outcome: 'under_scoped' as const,
          error: 'HTTP 401',
        },
      },
      remediation:
        'Your credential cannot write to this bucket. Grant "s3:PutObject".',
    })
    const res = await callRoute()
    const bodyStr = JSON.stringify(await res.json())
    expect(bodyStr).not.toContain('super-secret-value')
    expect(bodyStr).not.toContain('AKIA_TEST_KEY')
  })
})
