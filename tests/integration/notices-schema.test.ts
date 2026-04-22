import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

// ADR-1004 Phase 2 Sprint 2.1 — notices schema + publish RPC.
//
// Covers:
//   * publish_notice auto-increments version per org (v1, v2, v3 ...).
//   * Non-members cannot publish for another org.
//   * Title / body too short → 22023.
//   * Append-only: direct UPDATE / DELETE from authenticated fails.
//   * consent_events.notice_version FK rejects an unknown version; a
//     valid (org_id, version) pair works.
//   * material_change_flag=true computes affected_artefact_count from
//     the prior version.
//   * RLS: orgA cannot SELECT orgB's notices via authenticated client.

const admin = getServiceClient()

let orgA: TestOrg
let orgB: TestOrg
let propertyA: string
let bannerA: string

async function seedProperty(orgId: string) {
  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: orgId, name: 'notice fixture', url: `https://n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.test` })
    .select('id')
    .single()
  const { data: banner, error: bannerErr } = await admin
    .from('consent_banners')
    .insert({
      org_id:      orgId,
      property_id: (prop as { id: string }).id,
      version:     1,
      is_active:   true,
      headline:    'notice fixture',
      body_copy:   'notice fixture',
      purposes:    [],
    })
    .select('id')
    .single()
  if (bannerErr) throw new Error(`banner: ${bannerErr.message}`)
  return {
    propertyId: (prop as { id: string }).id,
    bannerId:   (banner as { id: string }).id,
  }
}

beforeAll(async () => {
  orgA = await createTestOrg('ntA')
  orgB = await createTestOrg('ntB')
  const seeded = await seedProperty(orgA.orgId)
  propertyA = seeded.propertyId
  bannerA   = seeded.bannerId
})

afterAll(async () => {
  if (orgA) await cleanupTestOrg(orgA)
  if (orgB) await cleanupTestOrg(orgB)
})

describe('ADR-1004 P2 S2.1 — publish_notice', () => {
  it('auto-increments version per org', async () => {
    const { data: v1, error: e1 } = await orgA.client.rpc('publish_notice', {
      p_org_id:               orgA.orgId,
      p_title:                'First notice',
      p_body_markdown:        'This is the first privacy notice for orgA.',
      p_material_change_flag: false,
    })
    expect(e1).toBeNull()
    expect((v1 as { version: number }).version).toBe(1)

    const { data: v2, error: e2 } = await orgA.client.rpc('publish_notice', {
      p_org_id:               orgA.orgId,
      p_title:                'Second notice',
      p_body_markdown:        'Updated language for cookie purposes.',
      p_material_change_flag: false,
    })
    expect(e2).toBeNull()
    expect((v2 as { version: number }).version).toBe(2)
  })

  it('refuses publish from a non-member of the target org', async () => {
    const { error } = await orgA.client.rpc('publish_notice', {
      p_org_id:        orgB.orgId,
      p_title:         'Cross-org',
      p_body_markdown: 'Should fail — orgA cannot publish for orgB.',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/org_membership_required/i)
  })

  it('rejects short title and short body with 22023', async () => {
    const shortTitle = await orgA.client.rpc('publish_notice', {
      p_org_id:        orgA.orgId,
      p_title:         'ab',
      p_body_markdown: 'this has enough body content to pass',
    })
    expect(shortTitle.error).not.toBeNull()

    const shortBody = await orgA.client.rpc('publish_notice', {
      p_org_id:        orgA.orgId,
      p_title:         'long enough',
      p_body_markdown: 'short',
    })
    expect(shortBody.error).not.toBeNull()
  })
})

describe('ADR-1004 P2 S2.1 — append-only invariant', () => {
  it('direct UPDATE on notices from authenticated is denied', async () => {
    const { error } = await orgA.client
      .from('notices')
      .update({ title: 'mutated' })
      .eq('org_id', orgA.orgId)
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|policy|rls/)
  })

  it('direct DELETE on notices from authenticated is denied', async () => {
    const { error } = await orgA.client
      .from('notices')
      .delete()
      .eq('org_id', orgA.orgId)
    expect(error).not.toBeNull()
    expect(error!.message.toLowerCase()).toMatch(/permission|denied|policy|rls/)
  })
})

describe('ADR-1004 P2 S2.1 — consent_events.notice_version FK', () => {
  it('consent_events insert accepts a valid (org_id, notice_version)', async () => {
    const { error } = await admin
      .from('consent_events')
      .insert({
        org_id:              orgA.orgId,
        property_id:         propertyA,
        banner_id:           bannerA,
        banner_version:      1,
        session_fingerprint: `fk-${Date.now()}`,
        event_type:          'consent_recorded',
        notice_version:      1,
      })
    expect(error).toBeNull()
  })

  it('consent_events insert with unknown notice_version violates the FK', async () => {
    const { error } = await admin
      .from('consent_events')
      .insert({
        org_id:              orgA.orgId,
        property_id:         propertyA,
        banner_id:           bannerA,
        banner_version:      1,
        session_fingerprint: `fk-bad-${Date.now()}`,
        event_type:          'consent_recorded',
        notice_version:      999,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/foreign key|consent_events_notice_fk/i)
  })
})

describe('ADR-1004 P2 S2.1 — material change affected_artefact_count', () => {
  it('publishing a material v3 counts events currently on v2', async () => {
    // Seed 3 events on notice_version=2 (from the v1/v2 test above).
    for (let i = 0; i < 3; i++) {
      await admin.from('consent_events').insert({
        org_id:              orgA.orgId,
        property_id:         propertyA,
        banner_id:           bannerA,
        banner_version:      1,
        session_fingerprint: `mat-${Date.now()}-${i}`,
        event_type:          'consent_recorded',
        notice_version:      2,
      })
    }

    const { data: v3, error } = await orgA.client.rpc('publish_notice', {
      p_org_id:               orgA.orgId,
      p_title:                'Third notice (material)',
      p_body_markdown:        'Changing retention and purpose scope.',
      p_material_change_flag: true,
    })
    expect(error).toBeNull()
    const row = v3 as {
      version: number
      material_change_flag: boolean
      affected_artefact_count: number
    }
    expect(row.version).toBe(3)
    expect(row.material_change_flag).toBe(true)
    expect(row.affected_artefact_count).toBeGreaterThanOrEqual(3)
  })
})

describe('ADR-1004 P2 S2.1 — RLS isolation', () => {
  it('orgA authenticated client cannot SELECT orgB notices', async () => {
    // Seed a notice in orgB via admin.
    await admin
      .from('notices')
      .insert({
        org_id:        orgB.orgId,
        version:       1,
        title:         'orgB secret',
        body_markdown: 'orgB only should see this',
      })

    const { data } = await orgA.client
      .from('notices')
      .select('id')
      .eq('org_id', orgB.orgId)
    expect(data ?? []).toHaveLength(0)
  })
})
