// ADR-1025 Phase 1 Sprint 1.2 — unit tests for cf-provision.ts.
//
// No live CF API calls — `fetch` is mocked via vi.fn(). Live end-to-end is
// covered by scripts/verify-adr-1025-sprint-11.ts against a real CF account.

import { createHash } from 'node:crypto'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// ═══════════════════════════════════════════════════════════
// Fixtures + helpers
// ═══════════════════════════════════════════════════════════
const STUB_ACCOUNT = 'test-account-id-0001'
const STUB_ACCOUNT_TOKEN = 'cfat-' + 'a'.repeat(40)
const STUB_USER_TOKEN = 'cfut-' + 'b'.repeat(40)
const STUB_SALT = 'c2FsdC1iYXNlNjQtMjAyNi0wNC0yMw==' // base64("salt-base64-2026-04-23")

function setEnv() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', STUB_ACCOUNT)
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', STUB_ACCOUNT_TOKEN)
  vi.stubEnv('CLOUDFLARE_API_TOKEN', STUB_USER_TOKEN)
  vi.stubEnv('STORAGE_NAME_SALT', STUB_SALT)
}

function unsetEnv() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', '')
  vi.stubEnv('CLOUDFLARE_API_TOKEN', '')
  vi.stubEnv('STORAGE_NAME_SALT', '')
}

interface FakeResp {
  status?: number
  body?: Record<string, unknown>
  throws?: Error
}

function makeFetchMock(queue: FakeResp[]): ReturnType<typeof vi.fn> {
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('fetch mock: queue exhausted')
    if (next.throws) throw next.throws
    const status = next.status ?? 200
    const body = JSON.stringify(next.body ?? { success: true, result: {} })
    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// Inject a zero-delay sleep so tests don't actually wait for backoff.
const zeroSleep = () => Promise.resolve()

beforeEach(() => {
  vi.resetModules()
  setEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function load() {
  return (await import('@/lib/storage/cf-provision')) as typeof import('@/lib/storage/cf-provision')
}

// ═══════════════════════════════════════════════════════════
// deriveBucketName
// ═══════════════════════════════════════════════════════════
describe('deriveBucketName', () => {
  it('returns a deterministic cs-cust-<20-hex> name', async () => {
    const { deriveBucketName } = await load()
    const orgA = '11111111-1111-1111-1111-111111111111'
    const name = deriveBucketName(orgA)
    expect(name).toMatch(/^cs-cust-[0-9a-f]{20}$/)
    // Idempotency: same org → same name.
    expect(deriveBucketName(orgA)).toBe(name)
  })

  it('different orgs produce different names', async () => {
    const { deriveBucketName } = await load()
    const a = deriveBucketName('org-a-uuid')
    const b = deriveBucketName('org-b-uuid')
    expect(a).not.toBe(b)
  })

  it('salt changes the output — prevents rainbow-table reversal', async () => {
    const { deriveBucketName } = await load()
    const orgId = 'org-shared-uuid'
    const originalName = deriveBucketName(orgId)

    vi.stubEnv('STORAGE_NAME_SALT', 'different-salt-value-base64')
    vi.resetModules()
    const { deriveBucketName: deriveAgain } = await load()
    expect(deriveAgain(orgId)).not.toBe(originalName)
  })

  it('throws CfProvisionError with code=config when salt missing', async () => {
    unsetEnv()
    const { deriveBucketName, CfProvisionError } = await load()
    expect(() => deriveBucketName('any-org')).toThrow(CfProvisionError)
  })
})

// ═══════════════════════════════════════════════════════════
// createBucket (uses account-level auth)
// ═══════════════════════════════════════════════════════════
describe('createBucket', () => {
  it('201 happy path → returns bucket metadata + uses account token', async () => {
    const fetchMock = makeFetchMock([
      {
        status: 200,
        body: {
          success: true,
          result: { name: 'cs-cust-abc', location: 'apac', creation_date: '2026-04-23' },
        },
      },
    ])
    const { createBucket } = await load()
    const bucket = await createBucket('cs-cust-abc', 'apac', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(bucket.name).toBe('cs-cust-abc')
    expect(bucket.location).toBe('apac')
    expect(fetchMock).toHaveBeenCalledOnce()
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toContain('/accounts/' + STUB_ACCOUNT + '/r2/buckets')
    const headers = (call[1] as RequestInit).headers as Headers
    // Account-scope operation: must present the account token.
    expect(headers.get('Authorization')).toBe(`Bearer ${STUB_ACCOUNT_TOKEN}`)
    // Body carries the name + location.
    expect(call[1]?.body).toContain('cs-cust-abc')
    expect(call[1]?.body).toContain('apac')
  })

  it('409 conflict → falls back to GET on the existing bucket (idempotent)', async () => {
    const fetchMock = makeFetchMock([
      // First call: POST returns 409 conflict.
      { status: 409, body: { success: false, errors: [{ code: 10004 }] } },
      // Second call: GET returns the existing bucket.
      {
        status: 200,
        body: {
          success: true,
          result: { name: 'cs-cust-xyz', location: 'apac', creation_date: '2026-04-20' },
        },
      },
    ])
    const { createBucket } = await load()
    const bucket = await createBucket('cs-cust-xyz', 'apac', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(bucket.name).toBe('cs-cust-xyz')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Second call was a GET.
    expect(fetchMock.mock.calls[1][1]?.method).toBe('GET')
  })

  it('429 rate-limit → retries with backoff and eventually succeeds', async () => {
    const fetchMock = makeFetchMock([
      { status: 429, body: { success: false, errors: [{ code: 20003 }] } },
      { status: 429, body: { success: false, errors: [{ code: 20003 }] } },
      {
        status: 200,
        body: {
          success: true,
          result: { name: 'cs-cust-retry', location: 'apac', creation_date: '2026-04-23' },
        },
      },
    ])
    const { createBucket } = await load()
    const bucket = await createBucket('cs-cust-retry', 'apac', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(bucket.name).toBe('cs-cust-retry')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('5xx → retries + eventually succeeds', async () => {
    const fetchMock = makeFetchMock([
      { status: 503, body: { success: false } },
      {
        status: 200,
        body: {
          success: true,
          result: { name: 'cs-cust-5xx', location: 'apac', creation_date: '2026-04-23' },
        },
      },
    ])
    const { createBucket } = await load()
    const bucket = await createBucket('cs-cust-5xx', 'apac', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(bucket.name).toBe('cs-cust-5xx')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exhausted retries on 5xx → throws with code=server', async () => {
    const fetchMock = makeFetchMock([
      { status: 500, body: { success: false } },
      { status: 500, body: { success: false } },
      { status: 500, body: { success: false } },
    ])
    const { createBucket, CfProvisionError } = await load()
    await expect(
      createBucket('cs-cust-fail', 'apac', { fetchFn: fetchMock, sleep: zeroSleep }),
    ).rejects.toBeInstanceOf(CfProvisionError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('401 auth → throws immediately (no retry) with code=auth', async () => {
    const fetchMock = makeFetchMock([
      { status: 401, body: { success: false, errors: [{ code: 10000 }] } },
    ])
    const { createBucket, CfProvisionError } = await load()
    try {
      await createBucket('cs-cust-auth', 'apac', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CfProvisionError)
      expect((err as InstanceType<typeof CfProvisionError>).code).toBe('auth')
    }
    // Exactly one attempt — no retry.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('network error → retries + eventually throws with code=network', async () => {
    const fetchMock = makeFetchMock([
      { throws: new TypeError('fetch failed') },
      { throws: new TypeError('fetch failed') },
      { throws: new TypeError('fetch failed') },
    ])
    const { createBucket, CfProvisionError } = await load()
    try {
      await createBucket('cs-cust-net', 'apac', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CfProvisionError)
      expect((err as InstanceType<typeof CfProvisionError>).code).toBe('network')
    }
  })
})

// ═══════════════════════════════════════════════════════════
// createBucketScopedToken (uses user-level auth; /user/tokens endpoint)
// ═══════════════════════════════════════════════════════════
describe('createBucketScopedToken', () => {
  it('returns {token_id, access_key_id, secret_access_key} derived from CF response', async () => {
    const STUB_TOKEN_VALUE = 'cfut_stub_token_value_' + 'z'.repeat(40)
    const STUB_TOKEN_ID = 'c0ffee1234567890abcdef1234567890'
    const expectedSecret = createHash('sha256').update(STUB_TOKEN_VALUE).digest('hex')

    const fetchMock = makeFetchMock([
      {
        status: 200,
        body: {
          success: true,
          result: {
            id: STUB_TOKEN_ID,
            value: STUB_TOKEN_VALUE,
            status: 'active',
          },
        },
      },
    ])
    const { createBucketScopedToken } = await load()
    const token = await createBucketScopedToken('cs-cust-test', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(token.token_id).toBe(STUB_TOKEN_ID)
    expect(token.access_key_id).toBe(STUB_TOKEN_ID)
    // Secret is derived from the raw value, never returned directly.
    expect(token.secret_access_key).toBe(expectedSecret)
    expect(token.secret_access_key).not.toBe(STUB_TOKEN_VALUE)

    const call = fetchMock.mock.calls[0]
    // User-scope endpoint — NOT /accounts/{id}/tokens.
    expect(call[0]).toContain('/user/tokens')
    expect(call[0]).not.toContain('/accounts/')
    // Must present the user-level bearer.
    const headers = (call[1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe(`Bearer ${STUB_USER_TOKEN}`)
    // Body shape: name + policies[{effect, resources, permission_groups}].
    const body = JSON.parse(String(call[1]?.body))
    expect(body.name).toBe('cs-bucket-cs-cust-test')
    expect(body.policies).toHaveLength(1)
    expect(body.policies[0].effect).toBe('allow')
    // Resource key is account+default-jurisdiction+bucket scoped.
    const resourceKeys = Object.keys(body.policies[0].resources)
    expect(resourceKeys).toHaveLength(1)
    expect(resourceKeys[0]).toBe(
      `com.cloudflare.edge.r2.bucket.${STUB_ACCOUNT}_default_cs-cust-test`,
    )
    expect(body.policies[0].resources[resourceKeys[0]]).toBe('*')
    // Permission group UUID = "Workers R2 Storage Bucket Item Write".
    expect(body.policies[0].permission_groups).toEqual([
      { id: '2efd5506f9c8494dacb1fa10a3e7d5b6' },
    ])
  })

  it('server returns 200 but no value → throws with code=server', async () => {
    const fetchMock = makeFetchMock([
      {
        status: 200,
        body: {
          success: true,
          result: { id: 'token-id-missing-value' /* value intentionally absent */ },
        },
      },
    ])
    const { createBucketScopedToken, CfProvisionError } = await load()
    await expect(
      createBucketScopedToken('cs-cust-x', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      }),
    ).rejects.toBeInstanceOf(CfProvisionError)
  })

  it('401 auth from /user/tokens → CfProvisionError with code=auth', async () => {
    const fetchMock = makeFetchMock([
      { status: 401, body: { success: false, errors: [{ code: 9109 }] } },
    ])
    const { createBucketScopedToken, CfProvisionError } = await load()
    try {
      await createBucketScopedToken('cs-cust-auth', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CfProvisionError)
      expect((err as InstanceType<typeof CfProvisionError>).code).toBe('auth')
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ═══════════════════════════════════════════════════════════
// revokeBucketToken (uses user-level auth)
// ═══════════════════════════════════════════════════════════
describe('revokeBucketToken', () => {
  it('200 happy path returns void + hits /user/tokens/{id} with user bearer', async () => {
    const fetchMock = makeFetchMock([
      { status: 200, body: { success: true, result: {} } },
    ])
    const { revokeBucketToken } = await load()
    await expect(
      revokeBucketToken('token-id-to-revoke', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      }),
    ).resolves.toBeUndefined()
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toContain('/user/tokens/token-id-to-revoke')
    expect(call[1]?.method).toBe('DELETE')
    const headers = (call[1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe(`Bearer ${STUB_USER_TOKEN}`)
  })

  it('404 not-found → swallowed (idempotent)', async () => {
    const fetchMock = makeFetchMock([
      { status: 404, body: { success: false, errors: [{ code: 404 }] } },
    ])
    const { revokeBucketToken } = await load()
    await expect(
      revokeBucketToken('already-gone-token', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      }),
    ).resolves.toBeUndefined()
  })

  it('401 auth surfaces — never swallowed', async () => {
    const fetchMock = makeFetchMock([
      { status: 401, body: { success: false } },
    ])
    const { revokeBucketToken, CfProvisionError } = await load()
    await expect(
      revokeBucketToken('some-token', {
        fetchFn: fetchMock,
        sleep: zeroSleep,
      }),
    ).rejects.toBeInstanceOf(CfProvisionError)
  })
})

// ═══════════════════════════════════════════════════════════
// r2Endpoint
// ═══════════════════════════════════════════════════════════
describe('r2Endpoint', () => {
  it('returns the account-scoped S3-compat endpoint', async () => {
    const { r2Endpoint } = await load()
    expect(r2Endpoint()).toBe(
      `https://${STUB_ACCOUNT}.r2.cloudflarestorage.com`,
    )
  })

  it('throws if CLOUDFLARE_ACCOUNT_ID is missing', async () => {
    unsetEnv()
    const { r2Endpoint, CfProvisionError } = await load()
    expect(() => r2Endpoint()).toThrow(CfProvisionError)
  })
})

// ═══════════════════════════════════════════════════════════
// requireEnv — config errors for the second (user) token
// ═══════════════════════════════════════════════════════════
describe('requireEnv — separate tokens for account vs user auth', () => {
  it('createBucketScopedToken with CLOUDFLARE_API_TOKEN missing → config error', async () => {
    vi.stubEnv('CLOUDFLARE_API_TOKEN', '')
    const { createBucketScopedToken, CfProvisionError } = await load()
    try {
      await createBucketScopedToken('cs-cust-no-usertoken', {
        fetchFn: vi.fn(),
        sleep: zeroSleep,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CfProvisionError)
      expect((err as InstanceType<typeof CfProvisionError>).code).toBe('config')
      expect((err as Error).message).toContain('CLOUDFLARE_API_TOKEN')
    }
  })

  it('createBucket with CLOUDFLARE_ACCOUNT_API_TOKEN missing → config error', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', '')
    const { createBucket, CfProvisionError } = await load()
    try {
      await createBucket('cs-cust-no-accttoken', 'apac', {
        fetchFn: vi.fn(),
        sleep: zeroSleep,
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(CfProvisionError)
      expect((err as InstanceType<typeof CfProvisionError>).code).toBe('config')
      expect((err as Error).message).toContain('CLOUDFLARE_ACCOUNT_API_TOKEN')
    }
  })
})
