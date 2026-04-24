// ADR-1003 Sprint 1.2 + 1.3 — zero-storage bridge orchestrator unit tests.

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

    // Invariant: with purposes_accepted absent, the bridge does
    // ZERO writes. With purposes present (Sprint 1.3) it INSERTs
    // into consent_artefact_index — but the four buffer tables
    // (consent_events / consent_artefacts / delivery_buffer /
    // audit_log) STILL receive zero rows. That stronger invariant
    // is asserted by the integration test
    // (tests/integration/zero-storage-invariant.test.ts).
    const queries = pg.calls.map((c) => c.query.toLowerCase()).join(' ')
    expect(queries).not.toContain('insert')
    expect(queries).not.toContain('update')
    expect(queries).not.toContain('delete')
    expect(result.indexed).toBe(0)
  })

  // ────────────────────────────────────────────────────────────
  // Sprint 1.3 — consent_artefact_index seeding (best-effort).
  // ────────────────────────────────────────────────────────────

  const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'

  function uploadStubs() {
    return [
      [{ mode: 'zero_storage' }],
      [cfgRow()],
      [{ encryption_salt: 'salt' }],
      [{ decrypt_secret: JSON.stringify(CREDS) }],
    ] as StubResponses
  }

  it('Sprint 1.3 — INSERTs one consent_artefact_index row per accepted purpose with deterministic artefact_id', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [
        { purpose_code: 'analytics', framework: 'dpdp' },
        { purpose_code: 'marketing', framework: 'dpdp' },
      ],
      [{ artefact_id: 'zs-fp-abc-12345678-analytics' }],
      [{ artefact_id: 'zs-fp-abc-12345678-marketing' }],
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'consent_given',
        purposes_accepted: ['analytics', 'marketing'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(2)
    expect(result.indexError).toBeUndefined()

    const inserts = pg.calls.filter((c) =>
      c.query.toLowerCase().includes('insert into public.consent_artefact_index'),
    )
    expect(inserts).toHaveLength(2)
    // Deterministic artefact_id (stable for Worker retries).
    const allValues = inserts.flatMap((c) => c.values)
    expect(allValues).toContain('zs-fp-abc-12345678-analytics')
    expect(allValues).toContain('zs-fp-abc-12345678-marketing')
    // Property + framework + purpose_code propagated.
    expect(allValues).toContain(PROPERTY_ID)
    expect(allValues).toContain('analytics')
    expect(allValues).toContain('marketing')
    expect(allValues).toContain('dpdp')
  })

  it('Sprint 1.3 — does NOT INSERT for tracker_observation kind', async () => {
    const pg = makePgStub(uploadStubs())
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      kind: 'tracker_observation' as const,
      payload: { property_id: PROPERTY_ID, purposes_accepted: ['analytics'] },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(0)
    const queries = pg.calls.map((c) => c.query.toLowerCase()).join(' ')
    expect(queries).not.toContain('purpose_definitions')
    expect(queries).not.toContain('consent_artefact_index')
  })

  it('Sprint 1.3 — does NOT INSERT when purposes_accepted is empty', async () => {
    const pg = makePgStub(uploadStubs())
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'banner_dismissed',
        purposes_accepted: [],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(0)
    const queries = pg.calls.map((c) => c.query.toLowerCase()).join(' ')
    expect(queries).not.toContain('purpose_definitions')
  })

  it('Sprint 1.3 — does NOT INSERT when property_id is missing', async () => {
    const pg = makePgStub(uploadStubs())
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: { event_type: 'consent_given', purposes_accepted: ['x'] },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(0)
  })

  it('Sprint 1.3 — does NOT INSERT when no purpose_definitions match the codes', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [], // purpose_definitions returns nothing
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'consent_given',
        purposes_accepted: ['unknown_code'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(0)
    expect(result.indexError).toBeUndefined()
  })

  it('Sprint 1.3 — counts ON CONFLICT (returning empty) as not inserted', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [{ purpose_code: 'analytics', framework: 'dpdp' }],
      [], // ON CONFLICT DO NOTHING — RETURNING yields zero rows
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'consent_given',
        purposes_accepted: ['analytics'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(0)
    expect(result.indexError).toBeUndefined()
  })

  it('Sprint 1.3 — INSERT failure is swallowed; outcome stays uploaded with indexError set', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [{ purpose_code: 'analytics', framework: 'dpdp' }],
      new Error('FK violation: property_id'),
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'consent_given',
        purposes_accepted: ['analytics'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    // R2 upload succeeded → outcome stays 'uploaded'.
    expect(result.outcome).toBe('uploaded')
    expect(result.indexError).toContain('FK violation')
    expect(result.indexed).toBe(0)
  })

  // ────────────────────────────────────────────────────────────
  // Sprint 1.4 — Mode B payloads carry identifier_hash +
  // identifier_type; bridge writes them into consent_artefact_index
  // so /v1/consent/verify can match by identifier.
  // ────────────────────────────────────────────────────────────

  it('Sprint 1.4 — propagates identifier_hash + identifier_type from payload into INSERT', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [{ purpose_code: 'analytics', framework: 'dpdp' }],
      [{ artefact_id: 'zs-fp-abc-12345678-analytics' }],
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const identifierHash = 'deadbeef'.repeat(8)
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'accept',
        identifier_hash: identifierHash,
        identifier_type: 'email',
        purposes_accepted: ['analytics'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(1)

    const insert = pg.calls.find((c) =>
      c.query.toLowerCase().includes('insert into public.consent_artefact_index'),
    )
    expect(insert).toBeDefined()
    expect(insert!.values).toContain(identifierHash)
    expect(insert!.values).toContain('email')
  })

  it('Sprint 1.4 — Worker-path payload (no identifier fields) writes NULL identifier_hash', async () => {
    const pg = makePgStub([
      ...uploadStubs(),
      [{ purpose_code: 'analytics', framework: 'dpdp' }],
      [{ artefact_id: 'zs-fp-abc-12345678-analytics' }],
    ])
    const put = vi.fn().mockResolvedValue({ status: 200, etag: '"e"' })
    const req = {
      ...REQ,
      payload: {
        property_id: PROPERTY_ID,
        event_type: 'consent_given',
        purposes_accepted: ['analytics'],
      },
    }
    const result = await processZeroStorageEvent(pg as never, req, {
      putObject: put,
    })
    expect(result.outcome).toBe('uploaded')
    expect(result.indexed).toBe(1)

    const insert = pg.calls.find((c) =>
      c.query.toLowerCase().includes('insert into public.consent_artefact_index'),
    )
    expect(insert).toBeDefined()
    // First two parametrised positions after the explicit ${} inserts
    // in the INSERT template: org_id, property_id, artefact_id,
    // <null consent_event_id literal>, identifier_hash, identifier_type,
    // <literal 'active'>, framework, purpose_code, ttl interval. The
    // identifier_hash + identifier_type values (positions 4, 5 of the
    // parameter array — after org_id, property_id, artefactId) are the
    // Worker-path nulls.
    expect(insert!.values).toContain(null)
    // Sanity: no stray email/phone-shaped identifier_type string.
    expect(insert!.values).not.toContain('email')
    expect(insert!.values).not.toContain('phone')
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
