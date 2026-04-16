import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestOrg, cleanupTestOrg, getServiceClient, TestOrg, bufferTables } from '../rls/helpers'

// Migration 011 (20260413000011) revokes UPDATE and DELETE on all buffer
// tables from the `authenticated` role. This suite asserts the REVOKEs
// are still in effect after all subsequent migrations — a regression here
// would let a signed-in user mutate buffer rows, violating rule #2
// (append-only for authenticated).

let org: TestOrg
let seededIds: Record<string, string> = {}

beforeAll(async () => {
  org = await createTestOrg('buffer-lifecycle')
  const admin = getServiceClient()

  // Seed one row per buffer table via service role.
  // Only tables with minimal FK requirements are seeded; tables with
  // complex FKs (consent_events → web_properties → consent_banners)
  // are tested in a separate block below.

  const seeds: Array<{ table: string; row: Record<string, unknown> }> = [
    { table: 'audit_log', row: { org_id: org.orgId, event_type: 'lifecycle_test' } },
    { table: 'processing_log', row: {
      org_id: org.orgId,
      activity_name: 'lifecycle_test',
      data_categories: ['email'],
      purpose: 'testing',
      legal_basis: 'consent',
    } },
  ]
  for (const { table, row } of seeds) {
    const { data, error } = await admin
      .from(table)
      .insert(row)
      .select('id')
      .single()
    if (error) throw new Error(`seed ${table}: ${error.message}`)
    seededIds[table] = (data as { id: string }).id
  }
}, 60000)

afterAll(async () => {
  const admin = getServiceClient()
  for (const [table, id] of Object.entries(seededIds)) {
    await admin.from(table).delete().eq('id', id)
  }
  await cleanupTestOrg(org)
}, 30000)

describe('Buffer-table REVOKE enforcement (migration 011)', () => {
  for (const table of ['audit_log', 'processing_log'] as const) {
    it(`authenticated UPDATE on ${table} fails with permission denied`, async () => {
      const updateCol = table === 'audit_log' ? { event_type: 'tampered' } : { activity_name: 'tampered' }
      const { error } = await org.client
        .from(table)
        .update(updateCol)
        .eq('id', seededIds[table])
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied|new row violates|denied/i)
    })

    it(`authenticated DELETE on ${table} fails with permission denied`, async () => {
      const { error } = await org.client
        .from(table)
        .delete()
        .eq('id', seededIds[table])
      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/permission denied|denied/i)
    })
  }

  it('authenticated INSERT on consent_events is revoked', async () => {
    const { error } = await org.client.from('consent_events').insert({
      org_id: org.orgId,
      property_id: '00000000-0000-0000-0000-000000000000',
      banner_id: '00000000-0000-0000-0000-000000000000',
      banner_version: 1,
      session_fingerprint: 'test',
      event_type: 'consent_given',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/permission denied|denied/i)
  })

  it('authenticated INSERT on tracker_observations is revoked', async () => {
    const { error } = await org.client.from('tracker_observations').insert({
      org_id: org.orgId,
      property_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/permission denied|denied/i)
  })
})
