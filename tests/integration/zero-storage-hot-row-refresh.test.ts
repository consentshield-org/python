// ADR-1003 Sprint 3.1 — hot-row TTL refresh integration test.
//
// Seeds three rows into consent_artefact_index:
//   1. Zero-storage org, active, last_verified_at 30 min ago,
//      expires_at 30 min from now → SHOULD be extended by refresh.
//   2. Zero-storage org, active, last_verified_at NULL (never
//      verified), expires_at 30 min from now → SHOULD NOT be
//      extended.
//   3. Standard org, active, last_verified_at 30 min ago,
//      expires_at 30 min from now → SHOULD NOT be extended (cron is
//      zero_storage-only).
//
// Calls `public.refresh_zero_storage_index_hot_rows()` directly via
// cs_orchestrator and asserts only row #1's expires_at advanced.
//
// Skip-on-missing-env: SUPABASE_CS_ORCHESTRATOR_DATABASE_URL.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const CS_ORCH_DSN = process.env.SUPABASE_CS_ORCHESTRATOR_DATABASE_URL
const ipostgres = async () => (await import('postgres')).default
const skipSuite = !CS_ORCH_DSN ? describe.skip : describe

let zeroOrg: TestOrg | undefined
let standardOrg: TestOrg | undefined
let zeroPropertyId: string
let standardPropertyId: string

async function seedPropertyFor(org: TestOrg, tag: string): Promise<string> {
  const admin = getServiceClient()
  const { data: prop, error } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: `hot-row ${tag}`,
      url: `https://hot-row-${tag}.test`,
      allowed_origins: [`https://hot-row-${tag}.test`],
      event_signing_secret: `secret-${tag}`,
    })
    .select('id')
    .single()
  if (error) throw new Error(`seed web_property ${tag}: ${error.message}`)
  return (prop as { id: string }).id
}

beforeAll(async () => {
  if (!CS_ORCH_DSN) return
  zeroOrg = await createTestOrg('hotrow-zero')
  standardOrg = await createTestOrg('hotrow-std')
  zeroPropertyId = await seedPropertyFor(zeroOrg, 'zero')
  standardPropertyId = await seedPropertyFor(standardOrg, 'std')

  // Flip the zero org's storage_mode directly — the gated RPC
  // requires export_configurations + platform_operator auth, both
  // out of scope for this integration test.
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
    await sql`update public.organisations set storage_mode = 'zero_storage' where id = ${zeroOrg.orgId}`
  } finally {
    await sql.end()
  }
}, 90_000)

afterAll(async () => {
  if (zeroOrg) await cleanupTestOrg(zeroOrg)
  if (standardOrg) await cleanupTestOrg(standardOrg)
}, 30_000)

skipSuite('ADR-1003 Sprint 3.1 — refresh_zero_storage_index_hot_rows', () => {
  it('extends expires_at for hot zero_storage rows; leaves cold + non-zero rows alone', async () => {
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
      // Seed the three rows. Deterministic artefact_ids + expires_at
      // windows so assertions don't flake under clock skew.
      await sql`
        insert into public.consent_artefact_index (
          org_id, property_id, artefact_id, identifier_hash, identifier_type,
          validity_state, framework, purpose_code, expires_at, last_verified_at
        ) values
        (
          ${zeroOrg!.orgId}::uuid, ${zeroPropertyId}::uuid,
          'zs-hot-row', null, null,
          'active', 'dpdp', 'analytics',
          now() + interval '30 minutes',
          now() - interval '30 minutes'
        ),
        (
          ${zeroOrg!.orgId}::uuid, ${zeroPropertyId}::uuid,
          'zs-cold-row', null, null,
          'active', 'dpdp', 'marketing',
          now() + interval '30 minutes',
          null
        ),
        (
          ${standardOrg!.orgId}::uuid, ${standardPropertyId}::uuid,
          'std-hot-row', null, null,
          'active', 'dpdp', 'analytics',
          now() + interval '30 minutes',
          now() - interval '30 minutes'
        )
      `

      // Capture baseline expires_at values so we can compare deltas.
      const before = (await sql`
        select artefact_id, expires_at
          from public.consent_artefact_index
         where artefact_id in ('zs-hot-row', 'zs-cold-row', 'std-hot-row')
      `) as unknown as Array<{ artefact_id: string; expires_at: Date }>
      const beforeMap = new Map(
        before.map((r) => [r.artefact_id, new Date(r.expires_at).getTime()]),
      )

      // Fire the cron function directly.
      const result = (await sql`
        select public.refresh_zero_storage_index_hot_rows() as envelope
      `) as unknown as Array<{ envelope: Record<string, unknown> }>
      const envelope = result[0].envelope as {
        ok: boolean
        refreshed_count: number
      }
      expect(envelope.ok).toBe(true)
      expect(envelope.refreshed_count).toBeGreaterThanOrEqual(1)

      const after = (await sql`
        select artefact_id, expires_at
          from public.consent_artefact_index
         where artefact_id in ('zs-hot-row', 'zs-cold-row', 'std-hot-row')
      `) as unknown as Array<{ artefact_id: string; expires_at: Date }>
      const afterMap = new Map(
        after.map((r) => [r.artefact_id, new Date(r.expires_at).getTime()]),
      )

      const zsHotBefore = beforeMap.get('zs-hot-row')!
      const zsHotAfter = afterMap.get('zs-hot-row')!
      // Hot row should be extended by ~24h minus the original 30min
      // → gain of roughly 23h 30min. Assert > 20h for robustness.
      expect(zsHotAfter - zsHotBefore).toBeGreaterThan(20 * 60 * 60 * 1000)

      // Cold row (last_verified_at null) — untouched.
      expect(afterMap.get('zs-cold-row')).toBe(beforeMap.get('zs-cold-row'))

      // Non-zero_storage org — untouched.
      expect(afterMap.get('std-hot-row')).toBe(beforeMap.get('std-hot-row'))
    } finally {
      await sql.end()
    }
  }, 60_000)

  it('is idempotent within a single hour — re-running does not double-extend', async () => {
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
      // The first test left zs-hot-row with expires_at ~24h out; its
      // last_verified_at is still 30 min ago, so it's still hot. But
      // the "expires_at < now() + 1h" guard means the cron skips it
      // on a second run because it no longer meets the "about to
      // expire" predicate.
      const before = (await sql`
        select expires_at from public.consent_artefact_index
         where artefact_id = 'zs-hot-row'
      `) as unknown as Array<{ expires_at: Date }>
      const beforeMs = new Date(before[0].expires_at).getTime()

      const result = (await sql`
        select public.refresh_zero_storage_index_hot_rows() as envelope
      `) as unknown as Array<{ envelope: { refreshed_count: number } }>
      // Row already has ~24h of life → should NOT be picked up
      // again. refreshed_count reflects only rows that crossed the
      // "< now() + 1h" guard on this invocation.
      const after = (await sql`
        select expires_at from public.consent_artefact_index
         where artefact_id = 'zs-hot-row'
      `) as unknown as Array<{ expires_at: Date }>
      const afterMs = new Date(after[0].expires_at).getTime()

      expect(afterMs).toBe(beforeMs)
      // refreshed_count on the second call is 0 with respect to this
      // specific row, but other zero_storage rows in the DB might
      // still be hot. Assert only that this row wasn't re-bumped.
      expect(result[0].envelope.refreshed_count).toBeGreaterThanOrEqual(0)
    } finally {
      await sql.end()
    }
  }, 30_000)
})
