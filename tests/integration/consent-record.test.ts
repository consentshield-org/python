// ADR-1002 Sprint 2.1 — /v1/consent/record integration tests.
//
// Exercises recordConsent() end-to-end against the live DB:
//   - 5-grant fixture: 5 artefacts created, 5 artefact_ids returned
//   - 5-grant + 2-rejected: 5 artefacts created, rejected IDs land in consent_events
//   - Idempotency: replay with same client_request_id returns the same envelope
//   - captured_at > 15 min stale → 422
//   - captured_at > 15 min in the future → 422
//   - Invalid purpose_definition_id (different org) → 422 with id echoed
//   - Cross-org property → 404
//   - Post-record verify: the identifier used at record-time returns `granted`
//     from rpc_consent_verify (closes the read/write loop)

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { recordConsent } from '../../app/src/lib/consent/record'
import { verifyConsent } from '../../app/src/lib/consent/verify'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

let org: TestOrg
let otherOrg: TestOrg
let propertyId: string
let otherPropertyId: string
let purposeIds: string[] = []
let otherOrgPurposeId: string
let keyId: string

const PURPOSE_CODES = [
  'rec_marketing',
  'rec_analytics',
  'rec_bureau',
  'rec_profile',
  'rec_notifications',
]

beforeAll(async () => {
  org = await createTestOrg('recMain')
  otherOrg = await createTestOrg('recOther')
  keyId = (await seedApiKey(org)).keyId
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'rec prop', url: `https://rec-${Date.now()}.test` })
    .select('id')
    .single()
  propertyId = prop!.id

  const { data: otherProp } = await admin
    .from('web_properties')
    .insert({ org_id: otherOrg.orgId, name: 'other', url: `https://rec-other-${Date.now()}.test` })
    .select('id')
    .single()
  otherPropertyId = otherProp!.id

  // 5 purposes in org.
  for (const code of PURPOSE_CODES) {
    const { data } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: 'ADR-1002 Sprint 2.1 test purpose',
        data_scope: ['email_address'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    purposeIds.push(data!.id)
  }

  // 1 purpose in otherOrg (for cross-org validation test).
  const { data: otherPurpose } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: otherOrg.orgId,
      purpose_code: 'rec_other_org',
      display_name: 'Other',
      description: 'ADR-1002 Sprint 2.1 cross-org test',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  otherOrgPurposeId = otherPurpose!.id
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════

describe('recordConsent — happy path', () => {

  it('5-grant fixture creates 5 artefacts in one transaction', async () => {
    const email = `rec-5grant-${Date.now()}@t.test`
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         email,
      identifierType:     'email',
      acceptedPurposeIds: purposeIds,
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.artefact_ids).toHaveLength(5)
    expect(r.data.idempotent_replay).toBe(false)

    // Every returned artefact_id must be present in consent_artefacts.
    const admin = getServiceClient()
    for (const row of r.data.artefact_ids) {
      expect(row.status).toBe('active')
      expect(PURPOSE_CODES).toContain(row.purpose_code)
      expect(row.artefact_id).toMatch(/./)
      const { data: art } = await admin
        .from('consent_artefacts')
        .select('artefact_id, consent_event_id, status')
        .eq('artefact_id', row.artefact_id)
        .single()
      expect(art?.consent_event_id).toBe(r.data.event_id)
      expect(art?.status).toBe('active')
    }

    // consent_events row carries source='api' + identifier_hash + identifier_type
    const { data: ev } = await admin
      .from('consent_events')
      .select('source, identifier_type, data_principal_identifier_hash, purposes_accepted, purposes_rejected')
      .eq('id', r.data.event_id)
      .single()
    expect(ev?.source).toBe('api')
    expect(ev?.identifier_type).toBe('email')
    expect(ev?.data_principal_identifier_hash).toMatch(/^[a-f0-9]{64}$/)
    // purposes_accepted has 5 entries
    expect((ev?.purposes_accepted as unknown[]).length).toBe(5)
    expect((ev?.purposes_rejected as unknown[]).length).toBe(0)
  })

  it('5-grant + 2-rejected: 5 artefacts, rejected land in consent_events only', async () => {
    const email = `rec-mixed-${Date.now()}@t.test`
    const accepted = purposeIds.slice(0, 3) // 3 granted
    const rejected = purposeIds.slice(3, 5) // 2 rejected

    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         email,
      identifierType:     'email',
      acceptedPurposeIds: accepted,
      rejectedPurposeIds: rejected,
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.artefact_ids).toHaveLength(3)

    const admin = getServiceClient()
    const { data: ev } = await admin
      .from('consent_events')
      .select('purposes_accepted, purposes_rejected')
      .eq('id', r.data.event_id)
      .single()
    expect((ev?.purposes_accepted as unknown[]).length).toBe(3)
    expect((ev?.purposes_rejected as unknown[]).length).toBe(2)
  })

  it('verify after record: identifier returns `granted` for the recorded purpose', async () => {
    const email = `rec-verify-${Date.now()}@t.test`
    const purposeId = purposeIds[0]
    const rec = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         email,
      identifierType:     'email',
      acceptedPurposeIds: [purposeId],
      capturedAt:         new Date().toISOString(),
    })
    expect(rec.ok).toBe(true)
    if (!rec.ok) return

    const v = await verifyConsent({
      orgId:          org.orgId,
      propertyId,
      identifier:     email,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODES[0],
    })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.data.status).toBe('granted')
    expect(v.data.active_artefact_id).toBe(rec.data.artefact_ids[0].artefact_id)
  })

})

// ═══════════════════════════════════════════════════════════
// Idempotency
// ═══════════════════════════════════════════════════════════

describe('recordConsent — idempotency', () => {

  it('replay with same client_request_id returns the same envelope', async () => {
    const email = `rec-idem-${Date.now()}@t.test`
    const key = `req-${Date.now()}-${Math.random()}`

    const first = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         email,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0], purposeIds[1]],
      capturedAt:         new Date().toISOString(),
      clientRequestId:    key,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.idempotent_replay).toBe(false)
    const firstIds = first.data.artefact_ids.map((a) => a.artefact_id).sort()

    // Second call with the same key.
    const second = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         email,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0], purposeIds[1]],
      capturedAt:         new Date().toISOString(),
      clientRequestId:    key,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.idempotent_replay).toBe(true)
    expect(second.data.event_id).toBe(first.data.event_id)
    const secondIds = second.data.artefact_ids.map((a) => a.artefact_id).sort()
    expect(secondIds).toEqual(firstIds)
  })

})

// ═══════════════════════════════════════════════════════════
// Validation errors
// ═══════════════════════════════════════════════════════════

describe('recordConsent — validation errors', () => {

  it('captured_at > 15 min stale → captured_at_stale', async () => {
    const staleMs = Date.now() - 16 * 60 * 1000
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         `rec-stale-${Date.now()}@t.test`,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0]],
      capturedAt:         new Date(staleMs).toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('captured_at_stale')
  })

  it('captured_at > 15 min in the future → captured_at_stale', async () => {
    const futureMs = Date.now() + 16 * 60 * 1000
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         `rec-future-${Date.now()}@t.test`,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0]],
      capturedAt:         new Date(futureMs).toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('captured_at_stale')
  })

  it('invalid purpose_definition_id (belongs to different org) → invalid_purpose_ids', async () => {
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         `rec-badpurpose-${Date.now()}@t.test`,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0], otherOrgPurposeId],
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_purpose_ids')
    if (r.error.kind !== 'invalid_purpose_ids') return
    expect(r.error.detail).toContain(otherOrgPurposeId)
  })

  it('empty accepted purposes → purposes_empty', async () => {
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         `rec-noempty-${Date.now()}@t.test`,
      identifierType:     'email',
      acceptedPurposeIds: [],
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('purposes_empty')
  })

  it('cross-org property → property_not_found', async () => {
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId:         otherPropertyId,
      identifier:         `rec-xorg-${Date.now()}@t.test`,
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0]],
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('property_not_found')
  })

  it('empty identifier → invalid_identifier', async () => {
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         '',
      identifierType:     'email',
      acceptedPurposeIds: [purposeIds[0]],
      capturedAt:         new Date().toISOString(),
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

})
