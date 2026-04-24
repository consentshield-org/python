// ADR-1025 Phase 3 Sprint 3.2 — customer-facing byok-migrate route tests.
//
// Drives POST() directly. Mocks auth, Turnstile, probe, and the
// csOrchestrator postgres client.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/lib/storage/verify', () => ({ runVerificationProbe: vi.fn() }))

// Mock the cs_orchestrator postgres client with a queue-based stub.
let pgQueue: Array<unknown[] | Error> = []
const pgCalls: Array<{ query: string; values: unknown[] }> = []
const pgStub = (strings: TemplateStringsArray, ...values: unknown[]) => {
  pgCalls.push({ query: strings.join('?'), values })
  if (!pgQueue.length) {
    throw new Error('pg stub: queue exhausted')
  }
  const next = pgQueue.shift()
  if (next instanceof Error) return Promise.reject(next)
  return Promise.resolve(next)
}
vi.mock('@/lib/api/cs-orchestrator-client', () => ({
  csOrchestrator: () => pgStub,
}))

import { OrgAccessDeniedError, requireOrgAccess } from '@/lib/auth/require-org-role'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { runVerificationProbe } from '@/lib/storage/verify'

const authMock = requireOrgAccess as unknown as ReturnType<typeof vi.fn>
const turnstileMock = verifyTurnstileToken as unknown as ReturnType<typeof vi.fn>
const probeMock = runVerificationProbe as unknown as ReturnType<typeof vi.fn>

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const VALID_BODY = {
  provider: 'customer_r2',
  bucket: 'my-bucket',
  region: 'auto',
  endpoint: 'https://abc.r2.cloudflarestorage.com',
  access_key_id: 'AKIA_TEST_KEY',
  secret_access_key: 'super-secret-value',
  mode: 'forward_only',
  turnstile_token: 'turnstile-ok',
}

function buildReq(body: unknown = VALID_BODY) {
  return new Request('https://x/api/orgs/X/storage/byok-migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function callRoute(body: unknown = VALID_BODY) {
  const { POST } = await import(
    '@/app/api/orgs/[orgId]/storage/byok-migrate/route'
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

beforeEach(() => {
  pgQueue = []
  pgCalls.length = 0
  authMock.mockReset()
  turnstileMock.mockReset()
  probeMock.mockReset()
  authMock.mockResolvedValue(defaultAuthCtx())
  turnstileMock.mockResolvedValue({ ok: true })
  probeMock.mockResolvedValue({
    ok: true,
    probeId: 'cs-verify-abc',
    durationMs: 500,
  })
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'master-for-tests-only-32-bytes')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// ═══════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════
describe('byok-migrate — happy path', () => {
  it('200 with migration_id; inserts storage_migrations row + encrypted creds', async () => {
    pgQueue = [
      [{ encryption_salt: 'salt-xyz' }], // salt lookup
      [{ encrypt_secret: Buffer.from('cipher-bytes') }], // encrypt
      [{ id: 'from-config-xyz' }], // source config id
      [{ id: 'migration-row-id' }], // insert returning id
    ]
    const res = await callRoute()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ migration_id: 'migration-row-id', mode: 'forward_only' })

    // probe ran against the target.
    expect(probeMock).toHaveBeenCalledOnce()
    const probeArg = probeMock.mock.calls[0][0]
    expect(probeArg.bucket).toBe('my-bucket')
    expect(probeArg.accessKeyId).toBe('AKIA_TEST_KEY')

    // response body does NOT echo the secret.
    const bodyStr = JSON.stringify(json)
    expect(bodyStr).not.toContain('super-secret-value')
    expect(bodyStr).not.toContain('AKIA_TEST_KEY')
  })
})

// ═══════════════════════════════════════════════════════════
// Auth rejection
// ═══════════════════════════════════════════════════════════
describe('byok-migrate — auth', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockRejectedValueOnce(new OrgAccessDeniedError('unauthenticated'))
    const res = await callRoute()
    expect(res.status).toBe(401)
  })
  it('403 when not a member', async () => {
    authMock.mockRejectedValueOnce(new OrgAccessDeniedError('not_a_member'))
    const res = await callRoute()
    expect(res.status).toBe(403)
  })
  it('403 when insufficient role', async () => {
    authMock.mockRejectedValueOnce(
      new OrgAccessDeniedError('insufficient_role'),
    )
    const res = await callRoute()
    expect(res.status).toBe(403)
  })
})

// ═══════════════════════════════════════════════════════════
// Body + Turnstile validation
// ═══════════════════════════════════════════════════════════
describe('byok-migrate — body validation', () => {
  const REQUIRED = [
    'provider',
    'bucket',
    'region',
    'endpoint',
    'access_key_id',
    'secret_access_key',
    'mode',
    'turnstile_token',
  ]
  for (const field of REQUIRED) {
    it(`400 when ${field} is missing`, async () => {
      const body: Record<string, unknown> = { ...VALID_BODY }
      delete body[field]
      const res = await callRoute(body)
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json).toEqual({ error: 'missing_field', field })
    })
  }

  it('400 on invalid provider', async () => {
    const res = await callRoute({ ...VALID_BODY, provider: 'cs_managed_r2' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_provider')
  })

  it('400 on invalid mode', async () => {
    const res = await callRoute({ ...VALID_BODY, mode: 'lol' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_mode')
  })

  it('400 when Turnstile rejects', async () => {
    turnstileMock.mockResolvedValueOnce({ ok: false, error: 'bad-token' })
    const res = await callRoute()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('turnstile_failed')
    // Probe never runs when turnstile fails.
    expect(probeMock).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════
// Probe failure
// ═══════════════════════════════════════════════════════════
describe('byok-migrate — probe failure', () => {
  it('400 probe_failed when the supplied creds cannot PUT', async () => {
    probeMock.mockResolvedValueOnce({
      ok: false,
      probeId: 'cs-verify-xyz',
      durationMs: 120,
      failedStep: 'put',
      error: 'HTTP 401',
    })
    const res = await callRoute()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({
      error: 'probe_failed',
      failed_step: 'put',
      message: 'HTTP 401',
    })
    // No DB writes happened.
    expect(pgCalls.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════
// Conflict (active migration already exists)
// ═══════════════════════════════════════════════════════════
describe('byok-migrate — active migration exclusion', () => {
  it('409 migration_already_active when the unique-exclusion constraint trips', async () => {
    pgQueue = [
      [{ encryption_salt: 'salt' }],
      [{ encrypt_secret: Buffer.from('cipher') }],
      [{ id: 'from-config-xyz' }],
      new Error(
        'duplicate key value violates exclusion constraint "storage_migrations_active_unique"',
      ),
    ]
    const res = await callRoute()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('migration_already_active')
  })
})
