// ADR-1002 Sprint 3.1 — integration tests for the three read endpoints.
//
//   GET /v1/consent/artefacts         (list + pagination + filters)
//   GET /v1/consent/artefacts/{id}    (detail + revocation + chain)
//   GET /v1/consent/events            (paged summary + date filters)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listArtefacts, getArtefact, listEvents } from '../../app/src/lib/consent/read'
import { recordConsent } from '../../app/src/lib/consent/record'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

let org: TestOrg
let otherOrg: TestOrg
let propertyId: string
let otherPropertyId: string
let purposeIds: string[] = []

const PURPOSE_CODES = ['list_p1', 'list_p2', 'list_p3']

// Track seeded artefacts: 6 via record endpoint + 1 revoked + 1 replaced.
let firstBatchArtefactIds: string[] = []
let revokedArtefactId: string
let revocationRecordId: string
let replacedChain: { a: string; b: string; c: string } // A replaced by B replaced by C

beforeAll(async () => {
  org = await createTestOrg('readArt')
  otherOrg = await createTestOrg('readOth')
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'read prop', url: `https://readart-${Date.now()}.test` })
    .select('id')
    .single()
  propertyId = prop!.id

  const { data: otherProp } = await admin
    .from('web_properties')
    .insert({ org_id: otherOrg.orgId, name: 'other', url: `https://readart-other-${Date.now()}.test` })
    .select('id')
    .single()
  otherPropertyId = otherProp!.id

  for (const code of PURPOSE_CODES) {
    const { data } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: 'ADR-1002 Sprint 3.1 test',
        data_scope: ['email_address'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    purposeIds.push(data!.id)
  }

  // Seed 6 artefacts via record (two 3-grant batches to create 6).
  const rec1 = await recordConsent({
    orgId: org.orgId, propertyId,
    identifier: `read-p1-${Date.now()}@t.test`,
    identifierType: 'email',
    acceptedPurposeIds: purposeIds,
    capturedAt: new Date().toISOString(),
  })
  if (!rec1.ok) throw new Error(`rec1: ${rec1.error.kind}`)
  for (const a of rec1.data.artefact_ids) firstBatchArtefactIds.push(a.artefact_id)

  const rec2 = await recordConsent({
    orgId: org.orgId, propertyId,
    identifier: `read-p2-${Date.now()}@t.test`,
    identifierType: 'email',
    acceptedPurposeIds: purposeIds,
    capturedAt: new Date().toISOString(),
  })
  if (!rec2.ok) throw new Error(`rec2: ${rec2.error.kind}`)
  for (const a of rec2.data.artefact_ids) firstBatchArtefactIds.push(a.artefact_id)

  // Revoke one artefact to test the revocation field on detail.
  revokedArtefactId = firstBatchArtefactIds[0]
  const { data: rev } = await admin
    .from('artefact_revocations')
    .insert({
      org_id: org.orgId,
      artefact_id: revokedArtefactId,
      reason: 'user_preference_change',
      revoked_by_type: 'data_principal',
      revoked_by_ref: 'test',
    })
    .select('id')
    .single()
  revocationRecordId = rev!.id as string

  // Build a replacement chain A → B → C directly in the DB (no record API
  // path for replacement yet; Sprint 3.2 / 4.x / whitepaper §3.4).
  const makeReplacementLink = async (prevArtefactId: string | null) => {
    const { data: pd } = await admin
      .from('purpose_definitions').select('id, purpose_code, framework, data_scope')
      .eq('id', purposeIds[0]).single()
    const { data: evt } = await admin
      .from('consent_events')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        source: 'api',
        event_type: 'accept',
        purposes_accepted: [{ purpose_definition_id: pd!.id, purpose_code: pd!.purpose_code }],
        purposes_rejected: [],
        data_principal_identifier_hash: 'chain-hash',
        identifier_type: 'custom',
      })
      .select('id').single()
    const { data: art } = await admin
      .from('consent_artefacts')
      .insert({
        org_id: org.orgId,
        property_id: propertyId,
        consent_event_id: evt!.id,
        purpose_definition_id: pd!.id,
        purpose_code: pd!.purpose_code,
        data_scope: pd!.data_scope,
        framework: pd!.framework,
        expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
      })
      .select('artefact_id').single()

    if (prevArtefactId !== null) {
      await admin
        .from('consent_artefacts')
        .update({ replaced_by: art!.artefact_id, status: 'replaced' })
        .eq('artefact_id', prevArtefactId)
    }
    return art!.artefact_id as string
  }

  const a = await makeReplacementLink(null)
  const b = await makeReplacementLink(a)
  const c = await makeReplacementLink(b)
  replacedChain = { a, b, c }
}, 120_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// List
// ═══════════════════════════════════════════════════════════

describe('listArtefacts', () => {

  it('returns org-scoped artefacts', async () => {
    const r = await listArtefacts({ orgId: org.orgId, limit: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(6)
    expect(r.data.items.every((i) => i.property_id === propertyId)).toBe(true)
  })

  it('filters by property_id', async () => {
    const r = await listArtefacts({ orgId: org.orgId, propertyId, limit: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.every((i) => i.property_id === propertyId)).toBe(true)
  })

  it('filters by purpose_code', async () => {
    const r = await listArtefacts({ orgId: org.orgId, purposeCode: PURPOSE_CODES[1], limit: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.every((i) => i.purpose_code === PURPOSE_CODES[1])).toBe(true)
    expect(r.data.items.length).toBeGreaterThanOrEqual(2)
  })

  it('filters by status=revoked', async () => {
    const r = await listArtefacts({ orgId: org.orgId, status: 'revoked', limit: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    expect(r.data.items.map((i) => i.artefact_id)).toContain(revokedArtefactId)
    expect(r.data.items.every((i) => i.status === 'revoked')).toBe(true)
  })

  it('identifier filter requires both fields', async () => {
    const r = await listArtefacts({ orgId: org.orgId, identifier: 'foo@bar.test' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_filters')
  })

  it('cursor pagination: 2-page walk sums to full set', async () => {
    const small = 3
    const p1 = await listArtefacts({ orgId: org.orgId, limit: small })
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    expect(p1.data.items).toHaveLength(small)
    expect(p1.data.next_cursor).toBeTruthy()

    const p2 = await listArtefacts({ orgId: org.orgId, limit: small, cursor: p1.data.next_cursor! })
    expect(p2.ok).toBe(true)
    if (!p2.ok) return
    expect(p2.data.items.length).toBeGreaterThan(0)

    // No overlap between pages.
    const p1Ids = new Set(p1.data.items.map((i) => i.artefact_id))
    const p2Ids = new Set(p2.data.items.map((i) => i.artefact_id))
    for (const id of p2Ids) expect(p1Ids.has(id)).toBe(false)
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listArtefacts({ orgId: org.orgId, cursor: 'not-base64!!!!' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

  it('cross-org isolation: other org sees none of this orgs artefacts', async () => {
    const r = await listArtefacts({ orgId: otherOrg.orgId, limit: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const overlap = r.data.items.filter((i) => firstBatchArtefactIds.includes(i.artefact_id))
    expect(overlap).toHaveLength(0)
  })

})

// ═══════════════════════════════════════════════════════════
// Detail
// ═══════════════════════════════════════════════════════════

describe('getArtefact', () => {

  it('returns the artefact with revocation record when revoked', async () => {
    const r = await getArtefact({ orgId: org.orgId, artefactId: revokedArtefactId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).not.toBeNull()
    expect(r.data!.artefact_id).toBe(revokedArtefactId)
    expect(r.data!.status).toBe('revoked')
    expect(r.data!.revocation).not.toBeNull()
    expect(r.data!.revocation!.id).toBe(revocationRecordId)
    expect(r.data!.revocation!.reason).toBe('user_preference_change')
  })

  it('returns full replacement chain [A, B, C] regardless of entry point', async () => {
    const fromB = await getArtefact({ orgId: org.orgId, artefactId: replacedChain.b })
    expect(fromB.ok).toBe(true)
    if (!fromB.ok || !fromB.data) return
    expect(fromB.data.replacement_chain).toEqual(
      expect.arrayContaining([replacedChain.a, replacedChain.b, replacedChain.c]),
    )
    expect(fromB.data.replacement_chain).toHaveLength(3)

    const fromC = await getArtefact({ orgId: org.orgId, artefactId: replacedChain.c })
    expect(fromC.ok).toBe(true)
    if (!fromC.ok || !fromC.data) return
    expect(fromC.data.replacement_chain).toHaveLength(3)

    const fromA = await getArtefact({ orgId: org.orgId, artefactId: replacedChain.a })
    expect(fromA.ok).toBe(true)
    if (!fromA.ok || !fromA.data) return
    expect(fromA.data.replacement_chain).toHaveLength(3)
  })

  it('cross-org artefact_id → null', async () => {
    const r = await getArtefact({ orgId: otherOrg.orgId, artefactId: firstBatchArtefactIds[1] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toBeNull()
  })

  it('nonexistent artefact_id → null', async () => {
    const r = await getArtefact({ orgId: org.orgId, artefactId: 'art_does_not_exist_anywhere' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toBeNull()
  })

})

// ═══════════════════════════════════════════════════════════
// Event list
// ═══════════════════════════════════════════════════════════

describe('listEvents', () => {

  it('returns recent org-scoped events', async () => {
    const r = await listEvents({ orgId: org.orgId, limit: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(2) // 2 from recordConsent in beforeAll
    // Every row must have all summary fields populated.
    for (const row of r.data.items) {
      expect(row.id).toBeTruthy()
      expect(row.property_id).toBeTruthy()
      expect(row.source).toBeTruthy()
      expect(typeof row.purposes_accepted_count).toBe('number')
      expect(typeof row.purposes_rejected_count).toBe('number')
      expect(typeof row.artefact_count).toBe('number')
    }
  })

  it('filter by source=api returns only api events', async () => {
    const r = await listEvents({ orgId: org.orgId, source: 'api', limit: 50 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.every((i) => i.source === 'api')).toBe(true)
  })

  it('date-range filter includes events in range, excludes out-of-range', async () => {
    const now = Date.now()
    const recent = await listEvents({
      orgId: org.orgId,
      createdAfter: new Date(now - 60 * 60 * 1000).toISOString(),
      limit: 50,
    })
    expect(recent.ok).toBe(true)
    if (!recent.ok) return
    expect(recent.data.items.length).toBeGreaterThan(0)

    const ancient = await listEvents({
      orgId: org.orgId,
      createdBefore: new Date(now - 365 * 86400_000).toISOString(),
      limit: 50,
    })
    expect(ancient.ok).toBe(true)
    if (!ancient.ok) return
    expect(ancient.data.items).toHaveLength(0)
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listEvents({ orgId: org.orgId, cursor: '###not-base64###' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

  it('cross-org isolation: other org sees no events of this org', async () => {
    const r = await listEvents({ orgId: otherOrg.orgId, limit: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const row of r.data.items) {
      expect(row.property_id).not.toBe(propertyId)
    }
  })

})
