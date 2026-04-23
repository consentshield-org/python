// ADR-1025 Phase 1 Sprint 1.2 — unit tests for cf-provision.ts.
//
// No live CF API calls — `fetch` is mocked via vi.fn(). Runtime-green
// against a real bucket is deferred to Phase 1 Sprint 1.1 operator step
// (create CF account API token + env wiring).

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
const STUB_TOKEN = 'cf-api-token-' + 'a'.repeat(32)
const STUB_SALT = 'c2FsdC1iYXNlNjQtMjAyNi0wNC0yMw==' // base64("salt-base64-2026-04-23")

function setEnv() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', STUB_ACCOUNT)
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', STUB_TOKEN)
  vi.stubEnv('STORAGE_NAME_SALT', STUB_SALT)
}

function unsetEnv() {
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', '')
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
// createBucket
// ═══════════════════════════════════════════════════════════
describe('createBucket', () => {
  it('201 happy path → returns bucket metadata', async () => {
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
    // Bearer token is set on the Authorization header.
    const headers = (call[1] as RequestInit).headers as Headers
    expect(headers.get('Authorization')).toBe(`Bearer ${STUB_TOKEN}`)
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
// createBucketScopedToken
// ═══════════════════════════════════════════════════════════
describe('createBucketScopedToken', () => {
  it('returns access_key_id + secret_access_key + token_id', async () => {
    const fetchMock = makeFetchMock([
      {
        status: 200,
        body: {
          success: true,
          result: {
            id: 'token-id-123',
            credentials: {
              accessKeyId: 'AKIA_TEST_KEY',
              secretAccessKey: 'super-secret-never-log-me',
            },
          },
        },
      },
    ])
    const { createBucketScopedToken } = await load()
    const token = await createBucketScopedToken('cs-cust-test', {
      fetchFn: fetchMock,
      sleep: zeroSleep,
    })
    expect(token.token_id).toBe('token-id-123')
    expect(token.access_key_id).toBe('AKIA_TEST_KEY')
    expect(token.secret_access_key).toBe('super-secret-never-log-me')
    // Body included the bucket name + required permissions.
    const call = fetchMock.mock.calls[0]
    expect(call[1]?.body).toContain('cs-cust-test')
    expect(call[1]?.body).toContain('object_read')
    expect(call[1]?.body).toContain('object_write')
    expect(call[1]?.body).toContain('object_delete')
  })

  it('server returns 200 but no credentials → throws with code=server', async () => {
    const fetchMock = makeFetchMock([
      {
        status: 200,
        body: {
          success: true,
          result: { id: 'token-id-missing-creds' },
          // No credentials field — API regression.
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
})

// ═══════════════════════════════════════════════════════════
// revokeBucketToken
// ═══════════════════════════════════════════════════════════
describe('revokeBucketToken', () => {
  it('200 happy path returns void', async () => {
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
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
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
