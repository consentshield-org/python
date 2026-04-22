import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

// ADR-1004 Phase 3 Sprint 3.1 — orphan consent-events metric.
//
// Covers:
//   * refresh_orphan_consent_events_metric() counts consent_events rows
//     with artefact_ids='{}' in the (now - 24h, now - 10min) window
//     and UPSERTs depa_compliance_metrics.orphan_count per org.
//   * Events younger than 10 minutes are NOT counted (dispatch still in
//     flight; the safety-net cron hasn't run yet).
//   * Events with non-empty artefact_ids are NOT counted.
//   * A freshly-orphaned row in another org does not leak into our count.
//   * Running the refresh a second time with the orphan resolved (artefact_ids
//     set) clears the count to 0.

const admin = getServiceClient()

let orgA: TestOrg
let orgB: TestOrg
let propertyA: string
let propertyB: string
let bannerA: string
let bannerB: string

async function seedProperty(orgId: string) {
  const { data: prop } = await admin
    .from('web_properties')
    .insert({
      org_id: orgId,
      name:   'orphan-metric-fixture',
      url:    `https://orphan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.test`,
    })
    .select('id')
    .single()
  const { data: banner, error: bannerErr } = await admin
    .from('consent_banners')
    .insert({
      org_id:      orgId,
      property_id: (prop as { id: string }).id,
      version:     1,
      is_active:   true,
      headline:    'test',
      body_copy:   'test',
      purposes:    [],
    })
    .select('id')
    .single()
  if (bannerErr) throw new Error(`seed banner: ${bannerErr.message}`)
  return {
    propertyId: (prop as { id: string }).id,
    bannerId:   (banner as { id: string }).id,
  }
}

async function insertConsentEvent(opts: {
  orgId:      string
  propertyId: string
  bannerId:   string
  createdAt:  Date
  artefactIds?: string[]
}) {
  const { data, error } = await admin
    .from('consent_events')
    .insert({
      org_id:              opts.orgId,
      property_id:         opts.propertyId,
      banner_id:           opts.bannerId,
      banner_version:      1,
      session_fingerprint: `orphan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      event_type:          'consent_recorded',
      artefact_ids:        opts.artefactIds ?? [],
      created_at:          opts.createdAt.toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`insert consent_event: ${error?.message}`)
  return (data as { id: string }).id
}

async function getMetric(orgId: string) {
  const { data } = await admin
    .from('depa_compliance_metrics')
    .select('orphan_count, orphan_computed_at, orphan_window_start, orphan_window_end')
    .eq('org_id', orgId)
    .maybeSingle()
  return data as {
    orphan_count: number
    orphan_computed_at: string | null
    orphan_window_start: string | null
    orphan_window_end: string | null
  } | null
}

beforeAll(async () => {
  orgA = await createTestOrg('orphA')
  orgB = await createTestOrg('orphB')
  const a = await seedProperty(orgA.orgId)
  const b = await seedProperty(orgB.orgId)
  propertyA = a.propertyId; bannerA = a.bannerId
  propertyB = b.propertyId; bannerB = b.bannerId
})

afterAll(async () => {
  // Cascade delete via cleanupTestOrg handles consent_events, properties,
  // banners, depa metrics.
  if (orgA) await cleanupTestOrg(orgA)
  if (orgB) await cleanupTestOrg(orgB)
})

describe('ADR-1004 P3 S3.1 — refresh_orphan_consent_events_metric', () => {
  it('counts orphans in the (10min, 24h) window; skips <10min and non-orphans', async () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60 * 1000)
    const fiveMinAgo   = new Date(Date.now() - 5  * 60 * 1000)

    // Two genuine orphans (12 min old, empty artefact_ids) — should count.
    await insertConsentEvent({ orgId: orgA.orgId, propertyId: propertyA, bannerId: bannerA, createdAt: twelveMinAgo })
    await insertConsentEvent({ orgId: orgA.orgId, propertyId: propertyA, bannerId: bannerA, createdAt: twelveMinAgo })
    // One orphan too-fresh to count (5 min old).
    await insertConsentEvent({ orgId: orgA.orgId, propertyId: propertyA, bannerId: bannerA, createdAt: fiveMinAgo })
    // One with artefact_ids populated — not an orphan.
    await insertConsentEvent({
      orgId: orgA.orgId, propertyId: propertyA, bannerId: bannerA,
      createdAt: twelveMinAgo, artefactIds: ['art_test_fake'],
    })
    // Cross-org orphan — must NOT leak into A's count.
    await insertConsentEvent({ orgId: orgB.orgId, propertyId: propertyB, bannerId: bannerB, createdAt: twelveMinAgo })

    const { data: refreshCount, error } = await admin.rpc('refresh_orphan_consent_events_metric')
    expect(error).toBeNull()
    expect(typeof refreshCount).toBe('number')

    const metricA = await getMetric(orgA.orgId)
    expect(metricA).not.toBeNull()
    expect(metricA!.orphan_count).toBe(2)
    expect(metricA!.orphan_computed_at).not.toBeNull()
    expect(metricA!.orphan_window_start).not.toBeNull()
    expect(metricA!.orphan_window_end).not.toBeNull()

    const metricB = await getMetric(orgB.orgId)
    expect(metricB).not.toBeNull()
    expect(metricB!.orphan_count).toBe(1)
  })

  it('clears the count to 0 once the orphans are resolved', async () => {
    // Resolve every orphan for orgA by backfilling artefact_ids.
    await admin
      .from('consent_events')
      .update({ artefact_ids: ['art_resolved_test'] })
      .eq('org_id', orgA.orgId)
      .eq('artefact_ids', '{}')

    const { error } = await admin.rpc('refresh_orphan_consent_events_metric')
    expect(error).toBeNull()

    const metricA = await getMetric(orgA.orgId)
    expect(metricA).not.toBeNull()
    expect(metricA!.orphan_count).toBe(0)
  })

  it('vw_orphan_consent_events is also queryable by service role', async () => {
    const { data, error } = await admin
      .from('vw_orphan_consent_events')
      .select('*')
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })
})
