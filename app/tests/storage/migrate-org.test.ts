// ADR-1025 Phase 3 Sprint 3.2 — migrate-org.ts unit tests.
//
// Mocks the pg client with a queue-stub that understands pg.begin
// (transactions pass the same stub callable to the callback).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── pg stub with pg.begin support ────────────────────────────────────────
type StubResponses = Array<unknown[] | Error>
function makePgStub(responses: StubResponses) {
  const calls: Array<{ query: string; values: unknown[] }> = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      throw new Error(`pg stub: unexpected call #${i + 1} — queue exhausted`)
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }) as unknown as (Parameters<
    typeof import('@/lib/storage/migrate-org').processMigrationChunk
  >[0]) & { begin: (cb: (tx: unknown) => Promise<void>) => Promise<void> }
  // Transactions pass the stub itself to the callback. Each `tx\`...\``
  // records into the same `calls` array.
  fn.begin = async (cb: (tx: unknown) => Promise<void>) => {
    await cb(fn)
  }
  ;(fn as unknown as { calls: Array<{ query: string; values: unknown[] }> }).calls = calls
  return fn
}

// ── Fixtures ─────────────────────────────────────────────────────────────
const ORG_ID = '11111111-1111-4111-8111-111111111111'
const MIG_ID = '22222222-2222-4222-8222-222222222222'
const FROM_CFG_ID = '33333333-3333-4333-8333-333333333333'
const SALT = 'salt-for-tests'
const CREDS = {
  access_key_id: 'AKIA_TGT',
  secret_access_key: 'secret-target',
}
const CREDS_JSON = JSON.stringify(CREDS)
const SRC_CREDS = {
  access_key_id: 'AKIA_SRC',
  secret_access_key: 'secret-source',
}
const SRC_CREDS_JSON = JSON.stringify(SRC_CREDS)

function migrationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: MIG_ID,
    org_id: ORG_ID,
    from_config_id: FROM_CFG_ID,
    from_config_snapshot: {
      provider: 'cs_managed_r2',
      bucket: 'cs-cust-oldbucket',
      region: 'auto',
    },
    to_config: {
      provider: 'customer_r2',
      bucket: 'cust-bucket',
      region: 'auto',
      endpoint: 'https://cust.r2.cloudflarestorage.com',
    },
    to_credential_enc: Buffer.from('enc-target'),
    mode: 'forward_only',
    state: 'queued',
    objects_total: null,
    objects_copied: 0,
    last_copied_key: null,
    retention_until: null,
    started_at: new Date('2026-04-24T00:00:00Z'),
    last_activity_at: new Date('2026-04-24T00:00:00Z'),
    ...overrides,
  }
}

function mkDeps(
  overrides: Partial<
    import('@/lib/storage/migrate-org').ProcessMigrationDeps
  > = {},
) {
  return {
    runVerificationProbe: vi.fn(async () => ({
      ok: true as const,
      probeId: 'cs-verify-xyz',
      durationMs: 120,
    })),
    putObject: vi.fn(async () => ({ status: 200, etag: 'abc' })),
    presignGet: vi.fn(() => 'https://signed'),
    fetchFn: vi.fn(async () => new Response('body-bytes', { status: 200 })),
    now: vi.fn(() => 1_000_000),
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('MASTER_ENCRYPTION_KEY', 'master-for-tests-only-32-bytes')
  // CLOUDFLARE_ACCOUNT_ID is needed by r2Endpoint() if the orchestrator
  // walks the source endpoint. We stub a placeholder.
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'test-account-id-0001')
  vi.stubEnv('CLOUDFLARE_ACCOUNT_API_TOKEN', 'cfat-test')
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cfut-test')
  vi.stubEnv('STORAGE_NAME_SALT', 'salt-base64')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.restoreAllMocks()
})

async function load() {
  return await import('@/lib/storage/migrate-org')
}

// ═══════════════════════════════════════════════════════════════════════
// Idempotency + terminal states
// ═══════════════════════════════════════════════════════════════════════
describe('processMigrationChunk — lifecycle guards', () => {
  it('not_found when migration id does not exist', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([[]])
    const result = await processMigrationChunk(pg, MIG_ID, mkDeps())
    expect(result.status).toBe('not_found')
  })

  it('terminal short-circuit when state=completed', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([[migrationRow({ state: 'completed' })]])
    const result = await processMigrationChunk(pg, MIG_ID, mkDeps())
    expect(result.status).toBe('terminal')
  })

  it('terminal short-circuit when state=failed', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([[migrationRow({ state: 'failed' })]])
    const result = await processMigrationChunk(pg, MIG_ID, mkDeps())
    expect(result.status).toBe('terminal')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// forward_only mode
// ═══════════════════════════════════════════════════════════════════════
describe('processMigrationChunk — forward_only', () => {
  it('probes target then atomically swaps + marks completed', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([
      [migrationRow()],                      // load
      [],                                    // queued→copying update
      [{ encryption_salt: SALT }],           // deriveOrgKey
      [{ decrypt_secret: CREDS_JSON }],      // decrypt target creds
      [],                                    // atomic tx: update export_configurations
      [],                                    // atomic tx: update storage_migrations
    ])
    const deps = mkDeps()
    const result = await processMigrationChunk(pg, MIG_ID, deps)
    expect(result.status).toBe('completed')
    expect(result.mode).toBe('forward_only')
    expect(deps.runVerificationProbe).toHaveBeenCalledOnce()
    const probeArg = deps.runVerificationProbe.mock.calls[0][0]
    expect(probeArg.bucket).toBe('cust-bucket')
    expect(probeArg.accessKeyId).toBe(CREDS.access_key_id)
  })

  it('fails gracefully when probe rejects the target', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([
      [migrationRow()],
      [],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: CREDS_JSON }],
      // markFailed update
      [],
    ])
    const deps = mkDeps({
      runVerificationProbe: vi.fn(async () => ({
        ok: false as const,
        probeId: 'p',
        durationMs: 50,
        failedStep: 'put' as const,
        error: '401',
      })),
    })
    const result = await processMigrationChunk(pg, MIG_ID, deps)
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/verification failed at put/)
  })

  it('already-copying row: skips the queued→copying transition', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([
      [migrationRow({ state: 'copying' })],  // load — already copying
      [{ encryption_salt: SALT }],           // deriveOrgKey
      [{ decrypt_secret: CREDS_JSON }],      // decrypt
      [],                                    // atomic tx: update cfg
      [],                                    // atomic tx: update mig
    ])
    const result = await processMigrationChunk(pg, MIG_ID, mkDeps())
    expect(result.status).toBe('completed')
  })
})

// ═══════════════════════════════════════════════════════════════════════
// copy_existing mode
// ═══════════════════════════════════════════════════════════════════════
describe('processMigrationChunk — copy_existing', () => {
  function buildCopyExistingQueue(keys: string[], isTruncated = false) {
    const xml =
      '<?xml version="1.0"?><ListBucketResult>' +
      keys.map((k) => `<Key>${k}</Key>`).join('') +
      (isTruncated ? '<IsTruncated>true</IsTruncated>' : '<IsTruncated>false</IsTruncated>') +
      '</ListBucketResult>'
    return { xml }
  }

  it('copies all objects + marks completed when ListObjects returns empty on first call', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([
      [migrationRow({ mode: 'copy_existing' })],           // load
      [],                                                   // queued→copying
      [{ encryption_salt: SALT }],                         // deriveOrgKey (target)
      [{ decrypt_secret: CREDS_JSON }],                    // decrypt target
      [{ write_credential_enc: Buffer.from('enc-src') }],  // loadSourceCreds → fetch row
      [{ decrypt_secret: SRC_CREDS_JSON }],                // decrypt source
      // Atomic cutover: 2 tx writes (export_cfg + mig)
      [],
      [],
    ])
    const { xml } = buildCopyExistingQueue([], false)
    const listResp = new Response(xml, { status: 200 })
    const deps = mkDeps({
      fetchFn: vi.fn(async () => listResp),
    })
    const result = await processMigrationChunk(pg, MIG_ID, deps)
    expect(result.status).toBe('completed')
    expect(result.mode).toBe('copy_existing')
    expect(result.objects_copied).toBe(0)
    // Probe ran on first chunk.
    expect(deps.runVerificationProbe).toHaveBeenCalledOnce()
  })

  it('in_flight when more work remains (truncated list)', async () => {
    const { processMigrationChunk } = await load()
    const { xml } = buildCopyExistingQueue(Array.from({ length: 5 }, (_, i) => `key-${i}`), true)
    const listResp = new Response(xml, { status: 200 })
    const objectResp = () => new Response('body', { status: 200 })

    const pg = makePgStub([
      [migrationRow({ mode: 'copy_existing' })],
      [],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: CREDS_JSON }],
      [{ write_credential_enc: Buffer.from('enc-src') }],
      [{ decrypt_secret: SRC_CREDS_JSON }],
      // Budget/limit forces exit before `allDone`. No final cutover tx.
      // Only the progress flush (remainder commit) runs.
      [],
    ])

    // Simulate running out of time immediately after ~5 objects copied.
    let callCount = 0
    const now = vi.fn(() => {
      callCount++
      // First few calls (during setup + first loop iterations) stay
      // within budget; later calls (after 5 objects) exceed it.
      return 1_000_000 + (callCount > 10 ? 300_000 : 0)
    })

    const fetchFn = vi.fn(async (url: URL | RequestInfo) => {
      const u = typeof url === 'string' ? url : url.toString()
      if (u.includes('list-type')) return listResp.clone()
      return objectResp()
    })

    const deps = mkDeps({ fetchFn, now })
    const result = await processMigrationChunk(pg, MIG_ID, deps)
    expect(result.status).toBe('in_flight')
    expect(result.mode).toBe('copy_existing')
  })

  it('resumes from last_copied_key on re-entry (no probe on re-entry)', async () => {
    const { processMigrationChunk } = await load()
    const { xml } = buildCopyExistingQueue([], false)
    const listResp = new Response(xml, { status: 200 })

    const pg = makePgStub([
      [migrationRow({
        mode: 'copy_existing',
        state: 'copying',
        objects_copied: 200,
        last_copied_key: 'last-copied-key-xyz',
      })],
      [{ encryption_salt: SALT }],
      [{ decrypt_secret: CREDS_JSON }],
      [{ write_credential_enc: Buffer.from('enc-src') }],
      [{ decrypt_secret: SRC_CREDS_JSON }],
      [],
      [],
    ])

    const deps = mkDeps({ fetchFn: vi.fn(async () => listResp.clone()) })
    const result = await processMigrationChunk(pg, MIG_ID, deps)
    expect(result.status).toBe('completed')
    // IMPORTANT: no probe on re-entry — only runs on first chunk.
    expect(deps.runVerificationProbe).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Credential sanity — null guard
// ═══════════════════════════════════════════════════════════════════════
describe('processMigrationChunk — credential guards', () => {
  it('fails if to_credential_enc is null (already wiped)', async () => {
    const { processMigrationChunk } = await load()
    const pg = makePgStub([
      [migrationRow({ to_credential_enc: null })],
      [],  // queued→copying
      [],  // markFailed
    ])
    const result = await processMigrationChunk(pg, MIG_ID, mkDeps())
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/to_credential_enc is null/)
  })
})
