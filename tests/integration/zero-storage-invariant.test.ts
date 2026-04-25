// ADR-1003 Sprint 1.3 — zero-storage end-to-end invariant.
//
// The bridge (app/src/lib/delivery/zero-storage-bridge.ts) is the
// only writeable code path for a `zero_storage` org. It MUST:
//   1. Refuse to land any row in the five buffer tables that
//      Standard / Insulated orgs use as a transient pipeline:
//      consent_events, consent_artefacts, delivery_buffer,
//      artefact_revocations, audit_log.
//   2. Seed consent_artefact_index with TTL-bounded validity rows
//      for every accepted purpose so /v1/consent/verify can answer
//      from cache.
//
// The counter-test on a Standard org demonstrates that the absence
// of buffer-table rows is a property of the bridge code path, not
// of the underlying schema — direct INSERT against the same tables
// works fine.
//
// PUT-to-R2 is stubbed; we do NOT test sigv4 here. We DO test the
// real DB path through cs_orchestrator (mode resolver, export-config
// fetch, decrypt, index INSERT).
//
// Skip-on-missing-env: needs SUPABASE_CS_ORCHESTRATOR_DATABASE_URL
// and MASTER_ENCRYPTION_KEY.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  encryptCredentials,
  type StorageCredentials,
} from '../../app/src/lib/storage/org-crypto'
import {
  processZeroStorageEvent,
  type BridgeRequest,
} from '../../app/src/lib/delivery/zero-storage-bridge'
import { recordConsent } from '../../app/src/lib/consent/record'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

const CS_ORCH_DSN = process.env.SUPABASE_CS_ORCHESTRATOR_DATABASE_URL
const CS_API_DSN = process.env.SUPABASE_CS_API_DATABASE_URL
const MASTER_KEY = process.env.MASTER_ENCRYPTION_KEY
const ipostgres = async () => (await import('postgres')).default
const skipSuite = !CS_ORCH_DSN || !MASTER_KEY ? describe.skip : describe
// Sprint 1.4 Mode B case additionally needs the cs_api pool.
const skipModeB = !CS_ORCH_DSN || !MASTER_KEY || !CS_API_DSN ? describe.skip : describe

const FAKE_CREDS: StorageCredentials = {
  access_key_id: 'AKIA-TEST',
  secret_access_key: 'super-secret-test',
}

const PURPOSE_CODES = ['marketing', 'analytics']

let zeroOrg: TestOrg | undefined
let standardOrg: TestOrg | undefined
let zeroPropertyId: string
let standardPropertyId: string
let zeroBannerId: string
let standardBannerId: string
let zeroKeyId: string
let zeroPurposeIds: Record<string, string> = {}

interface SeededOrg {
  org: TestOrg
  propertyId: string
  bannerId: string
  purposeIds: Record<string, string>
}

async function seedOrg(suffix: string): Promise<SeededOrg> {
  const admin = getServiceClient()
  const org = await createTestOrg(suffix)

  // Two purpose_definitions matching PURPOSE_CODES. Track the IDs so
  // tests that need UUID-form arguments (e.g., rpc_consent_record via
  // recordConsent) can reference them.
  const purposeIds: Record<string, string> = {}
  for (const code of PURPOSE_CODES) {
    const { data, error } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: `${code} purpose`,
        data_scope: ['session_identifier'],
        default_expiry_days: 180,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    if (error) throw new Error(`seed purpose ${code}: ${error.message}`)
    purposeIds[code] = (data as { id: string }).id
  }

  const { data: prop, error: pErr } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: `zsi ${suffix}`,
      url: `https://zsi-${suffix}.test`,
      allowed_origins: [`https://zsi-${suffix}.test`],
      event_signing_secret: `secret-${suffix}`,
    })
    .select('id')
    .single()
  if (pErr) throw new Error(`seed web_property ${suffix}: ${pErr.message}`)

  const { data: banner, error: bErr } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: (prop as { id: string }).id,
      version: 1,
      is_active: true,
      headline: 'zsi',
      body_copy: 'zsi',
      purposes: [],
    })
    .select('id')
    .single()
  if (bErr) throw new Error(`seed consent_banner ${suffix}: ${bErr.message}`)

  return {
    org,
    propertyId: (prop as { id: string }).id,
    bannerId: (banner as { id: string }).id,
    purposeIds,
  }
}

beforeAll(async () => {
  if (!CS_ORCH_DSN || !MASTER_KEY) return

  const seededZero = await seedOrg('zsi-zero')
  zeroOrg = seededZero.org
  zeroPropertyId = seededZero.propertyId
  zeroBannerId = seededZero.bannerId
  zeroPurposeIds = seededZero.purposeIds

  // Sprint 1.4 — Mode B case exercises recordConsent through
  // rpc_consent_record_prepare_zero_storage, which asserts
  // api_key_binding. Seed an org-scoped key with write:consent scope.
  zeroKeyId = (await seedApiKey(zeroOrg, { scopes: ['write:consent'] })).keyId

  const seededStandard = await seedOrg('zsi-std')
  standardOrg = seededStandard.org
  standardPropertyId = seededStandard.propertyId
  standardBannerId = seededStandard.bannerId

  // Seed export_configurations + flip storage_mode for the zero org.
  // The encrypted-credential round-trip goes through the cs_orchestrator
  // pool so it exercises the same pgcrypto helper the bridge uses.
  // The storage_mode flip goes through the service client (not raw SQL)
  // because ADR-1003 Sprint 1.1 revoked direct UPDATE on
  // public.organisations.storage_mode from cs_orchestrator — the single
  // write surface is admin.set_organisation_storage_mode, which requires
  // platform_operator auth. The gate has its own tests; here we set up
  // state via service-role bypass.
  const postgres = await ipostgres()
  const sql = postgres(CS_ORCH_DSN!, {
    prepare: false,
    max: 2,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: 'require',
    transform: { undefined: null },
  })
  try {
    const { createHmac } = await import('node:crypto')
    const saltRows = (await sql`
      select encryption_salt from public.organisations where id = ${zeroOrg.orgId}
    `) as unknown as Array<{ encryption_salt: string }>
    const orgKey = createHmac('sha256', MASTER_KEY!)
      .update(`${zeroOrg.orgId}${saltRows[0].encryption_salt}`)
      .digest('hex')
    const enc = await encryptCredentials(sql, FAKE_CREDS, orgKey)

    const admin = getServiceClient()
    const { error: cfgErr } = await admin.from('export_configurations').insert({
      org_id: zeroOrg.orgId,
      storage_provider: 'cs_managed_r2',
      bucket_name: 'cs-cust-zsi',
      path_prefix: 'zsi/',
      region: 'auto',
      write_credential_enc: `\\x${enc.toString('hex')}`,
      is_verified: true,
    })
    if (cfgErr) {
      throw new Error(`seed export_configurations: ${cfgErr.message}`)
    }

    const { error: modeErr } = await admin
      .from('organisations')
      .update({ storage_mode: 'zero_storage' })
      .eq('id', zeroOrg.orgId)
    if (modeErr) throw new Error(`flip storage_mode: ${modeErr.message}`)
  } finally {
    await sql.end()
  }
}, 90_000)

afterAll(async () => {
  if (zeroOrg) await cleanupTestOrg(zeroOrg)
  if (standardOrg) await cleanupTestOrg(standardOrg)
}, 30_000)

const BUFFER_TABLES_FOR_INVARIANT = [
  'consent_events',
  'consent_artefacts',
  'delivery_buffer',
  'artefact_revocations',
  'audit_log',
] as const

skipSuite('ADR-1003 Sprint 1.3 — zero-storage invariant', () => {
  it('zero_storage org: 10 bridge events leave 0 rows in 5 buffer tables; 20 rows in consent_artefact_index', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_ORCH_DSN!, {
      prepare: false,
      max: 4,
      idle_timeout: 5,
      connect_timeout: 10,
      ssl: 'require',
      transform: { undefined: null },
    })
    try {
      const stubPut = vi.fn().mockResolvedValue({ status: 200, etag: '"x"' })

      for (let i = 0; i < 10; i++) {
        const req: BridgeRequest = {
          kind: 'consent_event',
          org_id: zeroOrg!.orgId,
          event_fingerprint: `zsi-fp-${i}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          payload: {
            property_id: zeroPropertyId,
            banner_id: zeroBannerId,
            event_type: 'consent_given',
            purposes_accepted: PURPOSE_CODES,
          },
        }
        const result = await processZeroStorageEvent(sql, req, {
          putObject: stubPut,
        })
        expect(result.outcome).toBe('uploaded')
        expect(result.indexError).toBeUndefined()
        expect(result.indexed).toBe(2)
      }

      const admin = getServiceClient()
      for (const table of BUFFER_TABLES_FOR_INVARIANT) {
        const { count, error } = await admin
          .from(table)
          .select('*', { count: 'exact', head: true })
          .eq('org_id', zeroOrg!.orgId)
        expect(error).toBeNull()
        expect(count).toBe(0)
      }

      const { count: indexCount, error: idxErr } = await admin
        .from('consent_artefact_index')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', zeroOrg!.orgId)
      expect(idxErr).toBeNull()
      expect(indexCount).toBe(20) // 10 events * 2 purposes

      // Spot-check one row's shape: deterministic artefact_id +
      // 24h TTL + active validity_state + null identifier_hash.
      const { data: sample, error: sampleErr } = await admin
        .from('consent_artefact_index')
        .select(
          'artefact_id, validity_state, expires_at, identifier_hash, framework, purpose_code',
        )
        .eq('org_id', zeroOrg!.orgId)
        .limit(1)
        .single()
      expect(sampleErr).toBeNull()
      expect(sample!.validity_state).toBe('active')
      expect(sample!.identifier_hash).toBeNull()
      expect(sample!.framework).toBe('dpdp')
      expect(PURPOSE_CODES).toContain(sample!.purpose_code)
      expect((sample!.artefact_id as string).startsWith('zs-')).toBe(true)
      const expiresMs = new Date(sample!.expires_at as string).getTime()
      const horizonMs = Date.now() + 24 * 60 * 60 * 1000
      expect(expiresMs).toBeGreaterThan(horizonMs - 60_000)
      expect(expiresMs).toBeLessThan(horizonMs + 60_000)
    } finally {
      await sql.end()
    }
  }, 60_000)

  it('zero_storage org: replaying the same fingerprint is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_ORCH_DSN!, {
      prepare: false,
      max: 2,
      idle_timeout: 5,
      connect_timeout: 10,
      ssl: 'require',
      transform: { undefined: null },
    })
    try {
      const stubPut = vi.fn().mockResolvedValue({ status: 200, etag: '"x"' })
      const fingerprint = `zsi-replay-${Date.now()}`
      const req: BridgeRequest = {
        kind: 'consent_event',
        org_id: zeroOrg!.orgId,
        event_fingerprint: fingerprint,
        timestamp: new Date().toISOString(),
        payload: {
          property_id: zeroPropertyId,
          banner_id: zeroBannerId,
          event_type: 'consent_given',
          purposes_accepted: PURPOSE_CODES,
        },
      }
      const first = await processZeroStorageEvent(sql, req, { putObject: stubPut })
      expect(first.indexed).toBe(2)
      const second = await processZeroStorageEvent(sql, req, { putObject: stubPut })
      // ON CONFLICT DO NOTHING — rows already there → 0 inserts.
      expect(second.outcome).toBe('uploaded')
      expect(second.indexed).toBe(0)
      expect(second.indexError).toBeUndefined()
    } finally {
      await sql.end()
    }
  }, 30_000)

  it('standard org: bridge refuses with mode_not_zero_storage; direct INSERT into consent_events succeeds', async () => {
    const postgres = await ipostgres()
    const sql = postgres(CS_ORCH_DSN!, {
      prepare: false,
      max: 2,
      idle_timeout: 5,
      connect_timeout: 10,
      ssl: 'require',
      transform: { undefined: null },
    })
    try {
      const stubPut = vi.fn()
      const req: BridgeRequest = {
        kind: 'consent_event',
        org_id: standardOrg!.orgId,
        event_fingerprint: `zsi-std-${Date.now()}`,
        timestamp: new Date().toISOString(),
        payload: {
          property_id: standardPropertyId,
          banner_id: standardBannerId,
          event_type: 'consent_given',
          purposes_accepted: PURPOSE_CODES,
        },
      }
      const result = await processZeroStorageEvent(sql, req, { putObject: stubPut })
      expect(result.outcome).toBe('mode_not_zero_storage')
      expect(stubPut).not.toHaveBeenCalled()

      // Counter-test the schema half: a direct INSERT into
      // consent_events for the Standard org succeeds. Demonstrates
      // that the absence of buffer rows for the zero org is a
      // bridge-code property, not a schema lock-out.
      const admin = getServiceClient()
      const fingerprint = `zsi-std-direct-${Date.now()}`
      const { error: insErr } = await admin.from('consent_events').insert({
        org_id: standardOrg!.orgId,
        property_id: standardPropertyId,
        banner_id: standardBannerId,
        banner_version: 1,
        session_fingerprint: fingerprint,
        event_type: 'consent_given',
        purposes_accepted: PURPOSE_CODES,
        purposes_rejected: [],
        ip_truncated: '203.0.113.0',
        user_agent_hash: 'hash',
        origin_verified: 'origin-only',
      })
      expect(insErr).toBeNull()

      const { count, error: cntErr } = await admin
        .from('consent_events')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', standardOrg!.orgId)
      expect(cntErr).toBeNull()
      expect(count).toBeGreaterThanOrEqual(1)
    } finally {
      await sql.end()
    }
  }, 30_000)
})

// ═══════════════════════════════════════════════════════════
// Sprint 1.4 — Mode B (POST /v1/consent/record) invariant.
// ═══════════════════════════════════════════════════════════
//
// Exercises recordConsent() — which branches on storage_mode —
// against a live zero_storage org seeded with the same export_
// configurations row. R2 PUT is stubbed via the bridge deps; all
// SQL round-trips (cs_api prepare RPC + cs_orchestrator bridge
// DB reads + index INSERTs) are real.

skipModeB('ADR-1003 Sprint 1.4 — Mode B zero-storage invariant', () => {
  it('recordConsent on zero_storage org: 0 buffer rows; index rows carry identifier_hash', async () => {
    const stubPut = vi.fn().mockResolvedValue({ status: 200, etag: '"x"' })
    const wrappedBridge: typeof processZeroStorageEvent = (pg, req, deps) =>
      processZeroStorageEvent(pg, req, { ...deps, putObject: stubPut })

    const purposeIds = [
      zeroPurposeIds[PURPOSE_CODES[0]!]!,
      zeroPurposeIds[PURPOSE_CODES[1]!]!,
    ]

    const res = await recordConsent(
      {
        keyId: zeroKeyId,
        orgId: zeroOrg!.orgId,
        propertyId: zeroPropertyId,
        identifier: 'mode-b-jane@example.test',
        identifierType: 'email',
        acceptedPurposeIds: purposeIds,
        capturedAt: new Date().toISOString(),
        clientRequestId: `zsi-mode-b-${Date.now()}`,
      },
      { processZeroStorageEvent: wrappedBridge },
    )

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(`recordConsent failed: ${JSON.stringify(res.error)}`)
    expect(res.data.event_id.startsWith('zs-')).toBe(true)
    expect(res.data.idempotent_replay).toBe(false)
    expect(res.data.artefact_ids).toHaveLength(2)
    expect(stubPut).toHaveBeenCalledTimes(1)

    // Invariant: the five buffer tables hold 0 rows for this org.
    const admin = getServiceClient()
    for (const table of BUFFER_TABLES_FOR_INVARIANT) {
      const { count, error } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('org_id', zeroOrg!.orgId)
      expect(error).toBeNull()
      expect(count).toBe(0)
    }

    // consent_artefact_index holds two rows with identifier_hash set
    // (distinguishing Mode B from the Mode A NULL case). Filter by
    // identifier_hash IS NOT NULL so we don't see Sprint 1.3's bulk
    // bridge-event rows (which use Mode A NULL identifier_hash) on the
    // same org.
    const { data: idxRows, error: idxErr } = await admin
      .from('consent_artefact_index')
      .select('artefact_id, identifier_hash, identifier_type, purpose_code')
      .eq('org_id', zeroOrg!.orgId)
      .in('purpose_code', PURPOSE_CODES as unknown as string[])
      .not('identifier_hash', 'is', null)
    expect(idxErr).toBeNull()
    expect(idxRows).toHaveLength(2)
    for (const row of idxRows!) {
      expect((row as { identifier_hash: string | null }).identifier_hash)
        .toMatch(/^[0-9a-f]{64}$/) // salted sha256 hex
      expect((row as { identifier_type: string | null }).identifier_type).toBe('email')
      expect((row as { artefact_id: string }).artefact_id.startsWith('zs-')).toBe(true)
    }
  }, 60_000)

  it('recordConsent on zero_storage org: second call with same client_request_id returns idempotent_replay=true', async () => {
    const stubPut = vi.fn().mockResolvedValue({ status: 200, etag: '"x"' })
    const wrappedBridge: typeof processZeroStorageEvent = (pg, req, deps) =>
      processZeroStorageEvent(pg, req, { ...deps, putObject: stubPut })

    const purposeIds = [zeroPurposeIds[PURPOSE_CODES[0]!]!]
    const clientRequestId = `zsi-mode-b-replay-${Date.now()}`
    const capturedAt = new Date().toISOString()

    const shared = {
      keyId: zeroKeyId,
      orgId: zeroOrg!.orgId,
      propertyId: zeroPropertyId,
      identifier: 'replay-jane@example.test',
      identifierType: 'email',
      acceptedPurposeIds: purposeIds,
      capturedAt,
      clientRequestId,
    }

    const first = await recordConsent(shared, { processZeroStorageEvent: wrappedBridge })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('first call failed')
    expect(first.data.idempotent_replay).toBe(false)

    const second = await recordConsent(shared, { processZeroStorageEvent: wrappedBridge })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('second call failed')
    expect(second.data.idempotent_replay).toBe(true)
    // Same deterministic artefact_ids as the first response.
    expect(second.data.artefact_ids.map((a) => a.artefact_id)).toEqual(
      first.data.artefact_ids.map((a) => a.artefact_id),
    )
    expect(second.data.event_id).toBe(first.data.event_id)

    // Still no rows in the five buffer tables (the replay must not
    // have written consent_events on the second pass).
    const admin = getServiceClient()
    for (const table of BUFFER_TABLES_FOR_INVARIANT) {
      const { count } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('org_id', zeroOrg!.orgId)
      expect(count).toBe(0)
    }
  }, 60_000)
})
