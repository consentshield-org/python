// ADR-1003 Sprint 1.2 — zero-storage bridge orchestrator unit tests.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { processZeroStorageEvent } from '@/lib/delivery/zero-storage-bridge'

type StubResponses = Array<unknown[] | Error>

interface StubFn {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>
  calls: Array<{ query: string; values: unknown[] }>
}

function makePgStub(responses: StubResponses) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      return Promise.reject(
        new Error(`pg stub: unexpected call #${i + 1} — queue exhausted`),
      )
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next as unknown[])
  }) as unknown as StubFn
  fn.calls = calls
  return fn
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CREDS = { access_key_id: 'AKIA', secret_access_key: 'secret' }
const ACCOUNT_ID = 'cf-acct'
const REQ = {
  kind: 'consent_event' as const,
  org_id: ORG_ID,
  event_fingerprint: 'fp-abc-12345678',
  timestamp: '2026-04-24T12:30:15.000Z',
  payload: { property_id: 'p1', event_type: 'consent_given' },
}

function cfgRow(overrides: Record<string, unknown> = {}) {
  return {
    bucket_name: 'cs-cust-acme',
    path_prefix: 'acme/',
    region: 'auto',
    storage_provider: 'cs_managed_r2',
    write_credential_enc: Buffer.from('enc'),
    is_verified: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-master-key')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', ACCOUNT_ID)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('processZeroStorageEvent', () => {
  it('refuses when the org is not zero_storage (KV-stale guard)', async () => {
    const pg = makePgStub([[{ mode: 'standard' }]])
    const put = vi.fn()
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('mode_not_zero_storage')
    expect(put).not.toHaveBeenCalled()
  })

  it('returns no_export_config when the config row is missing', async () => {
    const pg = makePgStub([[{ mode: 'zero_storage' }], []])
    const put = vi.fn()
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('no_export_config')
  })

  it('returns unverified_export_config when is_verified=false', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow({ is_verified: false })],
    ])
    const put = vi.fn()
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('unverified_export_config')
  })

  it('returns endpoint_failed for an unsupported provider', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow({ storage_provider: 'customer_r2' })],
    ])
    const put = vi.fn()
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('endpoint_failed')
  })

  it('returns decrypt_failed when decrypt_secret returns empty', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow()],
      [{ encryption_salt: 'salt-for-test' }], // deriveOrgKey
      [{ decrypt_secret: null }],             // decryptCredentials — empty
    ])
    const put = vi.fn()
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('decrypt_failed')
  })

  it('returns upload_failed when putObject throws', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow()],
      [{ encryption_salt: 'salt' }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
    ])
    const put = vi.fn().mockRejectedValue(new Error('R2 PUT failed: 403'))
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('upload_failed')
  })

  it('happy path — PUT to R2 with correct key + metadata, no DB writes', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow()],
      [{ encryption_salt: 'salt' }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"abc"' })
    const result = await processZeroStorageEvent(pg as never, REQ, { putObject: put })
    expect(result.outcome).toBe('uploaded')
    expect(result.objectKey).toBe(
      'acme/zero_storage/consent_event/2026/04/24/fp-abc-12345678.json',
    )
    expect(result.bucket).toBe('cs-cust-acme')

    const args = put.mock.calls[0]![0]
    expect(args.endpoint).toBe(`https://${ACCOUNT_ID}.r2.cloudflarestorage.com`)
    expect(args.accessKeyId).toBe(CREDS.access_key_id)
    expect(args.metadata).toMatchObject({
      'cs-org-id': ORG_ID,
      'cs-kind': 'consent_event',
      'cs-event-fingerprint': 'fp-abc-12345678',
      'cs-timestamp': '2026-04-24T12:30:15.000Z',
    })

    // Invariant: only READs hit the DB. No INSERT / UPDATE on any
    // buffer table — the cs_orchestrator stub queue only had SELECT
    // reads queued.
    const queries = pg.calls.map((c) => c.query.toLowerCase()).join(' ')
    expect(queries).not.toContain('insert')
    expect(queries).not.toContain('update')
    expect(queries).not.toContain('delete')
  })

  it('uses now() for the date partition when timestamp is unparseable', async () => {
    const pg = makePgStub([
      [{ mode: 'zero_storage' }],
      [cfgRow({ path_prefix: '' })],
      [{ encryption_salt: 'salt' }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: null })
    const result = await processZeroStorageEvent(
      pg as never,
      { ...REQ, timestamp: 'not-a-date' },
      { putObject: put },
    )
    expect(result.outcome).toBe('uploaded')
    // Shape check: key matches the expected layout (any YYYY/MM/DD).
    expect(result.objectKey).toMatch(
      /^zero_storage\/consent_event\/\d{4}\/\d{2}\/\d{2}\/fp-abc-12345678\.json$/,
    )
  })
})
