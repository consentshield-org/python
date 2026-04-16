import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const TRIGGER_ID = '22222222-2222-4222-8222-222222222222'
const EMAIL = 'Erasure.Target@Example.com'

// Captures fetch arguments and returns scripted responses.
function mockFetch(status: number, body: string | null = null) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    // Response disallows a body on 204/205/304. Use null there.
    const safeBody = status === 204 || status === 205 || status === 304 ? null : body
    return new Response(safeBody, { status }) as unknown as Response
  })
}

// Minimal Supabase stub: the dispatcher only uses .from(...).insert/select/update
// and .rpc (via decryptForOrg). We intercept the calls that matter.
interface StubState {
  connectorConfig: Record<string, unknown>
  connectorType: string
  updates: Array<{ table: string; update: Record<string, unknown> }>
  receiptId: string
}

function supabaseStub(state: StubState) {
  const fakeConnector = {
    id: 'conn-id',
    connector_type: state.connectorType,
    display_name: `${state.connectorType} test`,
    config: '\\x' + Buffer.from('ciphertext-ignored').toString('hex'),
  }
  const fakeReceipt = { id: state.receiptId }
  const fakeOrg = { encryption_salt: 'salt' }

  const from = (table: string) => ({
    select: (_cols?: string) => ({
      eq: (_c?: string, _v?: unknown) => ({
        eq: () => ({ data: [fakeConnector], error: null }),
        single: () => ({ data: fakeOrg, error: null }),
      }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => ({ data: fakeReceipt, error: null }),
      }),
      // audit_log insert call returns void
      then: (onOk: (r: { data: null; error: null }) => unknown) => Promise.resolve(onOk({ data: null, error: null })),
    }),
    update: (update: Record<string, unknown>) => ({
      eq: () => {
        state.updates.push({ table, update })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  })

  return {
    from,
    rpc: async (name: string) => {
      if (name === 'decrypt_secret') {
        return { data: JSON.stringify(state.connectorConfig), error: null }
      }
      return { data: null, error: null }
    },
  }
}

describe('dispatchDeletion — Mailchimp', () => {
  let state: StubState
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key')
    state = {
      connectorType: 'mailchimp',
      connectorConfig: { api_key: 'abc123def-us21', audience_id: 'list42' },
      updates: [],
      receiptId: 'receipt-mc',
    }
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  it('DELETEs against the audience member URL with HTTP Basic auth', async () => {
    const spy = mockFetch(204)
    globalThis.fetch = spy as unknown as typeof globalThis.fetch
    const { dispatchDeletion } = await import('@/lib/rights/deletion-dispatch')

    const results = await dispatchDeletion({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabaseStub(state) as any,
      orgId: ORG_ID,
      triggerType: 'erasure_request',
      triggerId: TRIGGER_ID,
      dataPrincipalEmail: EMAIL,
    })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('confirmed')

    const call = spy.mock.calls[0]
    const url = String(call[0])
    const expectedHash = createHash('md5').update(EMAIL.toLowerCase()).digest('hex')
    expect(url).toBe(`https://us21.api.mailchimp.com/3.0/lists/list42/members/${expectedHash}`)
    expect((call[1] as RequestInit).method).toBe('DELETE')
    const auth = (call[1] as RequestInit).headers as Record<string, string>
    expect(auth.Authorization).toMatch(/^Basic /)
  })

  it('marks confirmed on 404 (already absent)', async () => {
    globalThis.fetch = mockFetch(404, 'Not Found') as unknown as typeof globalThis.fetch
    const { dispatchDeletion } = await import('@/lib/rights/deletion-dispatch')
    const [result] = await dispatchDeletion({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabaseStub(state) as any,
      orgId: ORG_ID, triggerType: 'erasure_request', triggerId: TRIGGER_ID, dataPrincipalEmail: EMAIL,
    })
    expect(result.status).toBe('confirmed')
  })

  it('marks dispatch_failed on 5xx with body in failure_reason', async () => {
    globalThis.fetch = mockFetch(500, '{"detail":"boom"}') as unknown as typeof globalThis.fetch
    const { dispatchDeletion } = await import('@/lib/rights/deletion-dispatch')
    const [result] = await dispatchDeletion({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabaseStub(state) as any,
      orgId: ORG_ID, triggerType: 'erasure_request', triggerId: TRIGGER_ID, dataPrincipalEmail: EMAIL,
    })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('Mailchimp HTTP 500')
    expect(result.error).toContain('boom')
  })
})

describe('dispatchDeletion — HubSpot', () => {
  let state: StubState
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key')
    state = {
      connectorType: 'hubspot',
      connectorConfig: { api_key: 'pat-na1-xyz' },
      updates: [],
      receiptId: 'receipt-hs',
    }
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.unstubAllEnvs()
  })

  it('DELETEs against the contacts email-idProperty URL with Bearer token', async () => {
    const spy = mockFetch(204)
    globalThis.fetch = spy as unknown as typeof globalThis.fetch
    const { dispatchDeletion } = await import('@/lib/rights/deletion-dispatch')
    const [result] = await dispatchDeletion({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabaseStub(state) as any,
      orgId: ORG_ID, triggerType: 'erasure_request', triggerId: TRIGGER_ID, dataPrincipalEmail: EMAIL,
    })
    expect(result.status).toBe('confirmed')

    const url = String(spy.mock.calls[0][0])
    expect(url).toBe(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(EMAIL)}?idProperty=email`,
    )
    const headers = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer pat-na1-xyz')
  })

  it('marks dispatch_failed when api_key is missing from config', async () => {
    state.connectorConfig = {}
    globalThis.fetch = mockFetch(200) as unknown as typeof globalThis.fetch
    const { dispatchDeletion } = await import('@/lib/rights/deletion-dispatch')
    const [result] = await dispatchDeletion({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabaseStub(state) as any,
      orgId: ORG_ID, triggerType: 'erasure_request', triggerId: TRIGGER_ID, dataPrincipalEmail: EMAIL,
    })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('api_key')
  })
})
