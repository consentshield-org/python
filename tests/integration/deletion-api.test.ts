// ADR-1002 Sprint 4.1 — deletion trigger + receipts list integration tests.
//
// Trigger:
//   - reason=consent_revoked + purpose_codes → matching artefacts revoked
//   - reason=erasure_request → all active artefacts for principal swept
//   - purpose_codes missing for consent_revoked → 422
//   - retention_expired → retention_mode_not_yet_implemented (501)
//   - Unknown reason → unknown_reason
//   - Cross-org property → property_not_found
//   - Unknown identifier_type → invalid_identifier
//   - Idempotent-ish: re-triggering when no active artefacts left → 0 revoked
//
// Receipts list:
//   - Filter by artefact_id (seeded fixture, Edge Function cascade bypassed)
//   - Filter by status
//   - Cursor pagination
//   - Bad cursor → bad_cursor
//   - Cross-org isolation

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { triggerDeletion, listDeletionReceipts } from '../../app/src/lib/consent/deletion'
import { recordConsent } from '../../app/src/lib/consent/record'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

const PURPOSE_CODES = ['del_marketing', 'del_analytics', 'del_bureau']

let org: TestOrg
let otherOrg: TestOrg
let propertyId: string
let otherPropertyId: string
let purposeIds: string[] = []
let seededReceiptArtefactId: string
let seededConnectorId: string
let keyId: string
let otherKeyId: string

beforeAll(async () => {
  org = await createTestOrg('delA')
  otherOrg = await createTestOrg('delB')
  keyId = (await seedApiKey(org)).keyId
  otherKeyId = (await seedApiKey(otherOrg)).keyId
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'del prop', url: `https://del-${Date.now()}.test` })
    .select('id').single()
  propertyId = prop!.id

  const { data: otherProp } = await admin
    .from('web_properties')
    .insert({ org_id: otherOrg.orgId, name: 'other', url: `https://del-other-${Date.now()}.test` })
    .select('id').single()
  otherPropertyId = otherProp!.id

  for (const code of PURPOSE_CODES) {
    const { data } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: 'ADR-1002 Sprint 4.1 test',
        data_scope: ['email_address'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id').single()
    purposeIds.push(data!.id)
  }

  // Seed a connector + a deletion_receipts row for receipts-list tests.
  // Bypasses the Edge Function so the test doesn't depend on async cascade.
  const { data: connector } = await admin
    .from('integration_connectors')
    .insert({
      org_id: org.orgId,
      connector_type: 'test_echo',
      display_name: 'Test Echo',
      status: 'active',
      config: '\\x7b7d',
    })
    .select('id').single()
  seededConnectorId = connector!.id

  // Seed one artefact + a revocation + a receipt (so the list has something
  // to return regardless of Edge Function state).
  const rec = await recordConsent({
    keyId, orgId: org.orgId, propertyId,
    identifier: `seed-receipt-${Date.now()}@t.test`,
    identifierType: 'email',
    acceptedPurposeIds: [purposeIds[0]],
    capturedAt: new Date().toISOString(),
  })
  if (!rec.ok) throw new Error(`seed rec: ${rec.error.kind}`)
  seededReceiptArtefactId = rec.data.artefact_ids[0].artefact_id

  const { data: revRow } = await admin
    .from('artefact_revocations')
    .insert({
      org_id: org.orgId,
      artefact_id: seededReceiptArtefactId,
      reason: 'user_withdrawal',
      revoked_by_type: 'data_principal',
    })
    .select('id').single()

  await admin.from('deletion_receipts').insert({
    org_id: org.orgId,
    trigger_type: 'consent_revoked',
    trigger_id: revRow!.id,
    connector_id: seededConnectorId,
    target_system: 'test_echo',
    identifier_hash: 'x'.repeat(64),
    status: 'pending',
  })
}, 120_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Trigger — happy paths
// ═══════════════════════════════════════════════════════════

describe('triggerDeletion — consent_revoked', () => {

  it('revokes artefacts matching (property, identifier, purpose_codes)', async () => {
    const email = `del-consent-${Date.now()}@t.test`
    // Seed artefacts for all 3 purposes.
    const rec = await recordConsent({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      acceptedPurposeIds: purposeIds,
      capturedAt: new Date().toISOString(),
    })
    expect(rec.ok).toBe(true)
    if (!rec.ok) return

    // Trigger deletion for just 2 of the 3 purposes.
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      reason: 'consent_revoked',
      purposeCodes: [PURPOSE_CODES[0], PURPOSE_CODES[1]],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reason).toBe('consent_revoked')
    expect(r.data.revoked_artefact_ids).toHaveLength(2)

    const admin = getServiceClient()
    for (const artefactId of r.data.revoked_artefact_ids) {
      const { data: art } = await admin
        .from('consent_artefacts').select('status').eq('artefact_id', artefactId).single()
      expect(art?.status).toBe('revoked')
    }

    // The third (unrevoked) purpose stays active.
    const thirdPurposeCode = PURPOSE_CODES[2]
    const unrevokedIds = rec.data.artefact_ids
      .filter((a) => a.purpose_code === thirdPurposeCode)
      .map((a) => a.artefact_id)
    for (const artefactId of unrevokedIds) {
      const { data: art } = await admin
        .from('consent_artefacts').select('status').eq('artefact_id', artefactId).single()
      expect(art?.status).toBe('active')
    }
  })

  it('re-trigger with no active artefacts remaining → 0 revoked', async () => {
    const email = `del-retrigger-${Date.now()}@t.test`
    const rec = await recordConsent({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      acceptedPurposeIds: [purposeIds[0]],
      capturedAt: new Date().toISOString(),
    })
    expect(rec.ok).toBe(true)

    // First trigger → 1 revoked.
    const first = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      reason: 'consent_revoked', purposeCodes: [PURPOSE_CODES[0]],
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.revoked_artefact_ids).toHaveLength(1)

    // Second trigger → 0 (nothing active left).
    const second = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      reason: 'consent_revoked', purposeCodes: [PURPOSE_CODES[0]],
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.revoked_artefact_ids).toHaveLength(0)
  })

})

describe('triggerDeletion — erasure_request', () => {

  it('sweeps all active artefacts for the principal', async () => {
    const email = `del-erase-${Date.now()}@t.test`
    const rec = await recordConsent({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      acceptedPurposeIds: purposeIds, // all 3
      capturedAt: new Date().toISOString(),
    })
    expect(rec.ok).toBe(true)

    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: email, identifierType: 'email',
      reason: 'erasure_request',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reason).toBe('erasure_request')
    expect(r.data.revoked_artefact_ids).toHaveLength(3)

    const admin = getServiceClient()
    for (const artefactId of r.data.revoked_artefact_ids) {
      const { data: art } = await admin
        .from('consent_artefacts').select('status').eq('artefact_id', artefactId).single()
      expect(art?.status).toBe('revoked')
    }
  })

})

// ═══════════════════════════════════════════════════════════
// Trigger — validation errors
// ═══════════════════════════════════════════════════════════

describe('triggerDeletion — validation errors', () => {

  it('consent_revoked without purpose_codes → purpose_codes_required_for_consent_revoked', async () => {
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: `bad-${Date.now()}@t.test`, identifierType: 'email',
      reason: 'consent_revoked',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('purpose_codes_required_for_consent_revoked')
  })

  it('retention_expired → retention_mode_not_yet_implemented', async () => {
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: `ret-${Date.now()}@t.test`, identifierType: 'email',
      reason: 'retention_expired',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('retention_mode_not_yet_implemented')
  })

  it('unknown reason → unknown_reason', async () => {
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: `unk-${Date.now()}@t.test`, identifierType: 'email',
      reason: 'wat' as 'consent_revoked',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('unknown_reason')
  })

  it('cross-org property → property_not_found', async () => {
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId: otherPropertyId,
      identifier: `xorg-${Date.now()}@t.test`, identifierType: 'email',
      reason: 'erasure_request',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('property_not_found')
  })

  it('ADR-1009 fence: cross-org key → api_key_binding', async () => {
    const r = await triggerDeletion({
      keyId:      otherKeyId,     // otherOrg-bound key
      orgId:      org.orgId,      // pretends to act on org
      propertyId,
      identifier: `fence-${Date.now()}@t.test`, identifierType: 'email',
      reason: 'erasure_request',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('unknown identifier_type → invalid_identifier', async () => {
    const r = await triggerDeletion({
      keyId, orgId: org.orgId, propertyId,
      identifier: 'x', identifierType: 'passport',
      reason: 'erasure_request',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

})

// ═══════════════════════════════════════════════════════════
// Receipts list
// ═══════════════════════════════════════════════════════════

describe('listDeletionReceipts', () => {

  it('returns seeded receipt when filtered by artefact_id', async () => {
    const r = await listDeletionReceipts({
      orgId: org.orgId,
      artefactId: seededReceiptArtefactId,
      limit: 50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    expect(r.data.items[0].artefact_id).toBe(seededReceiptArtefactId)
  })

  it('filter by status=pending', async () => {
    const r = await listDeletionReceipts({
      orgId: org.orgId,
      status: 'pending',
      limit: 50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.every((i) => i.status === 'pending')).toBe(true)
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
  })

  it('filter by connector_id', async () => {
    const r = await listDeletionReceipts({
      orgId: org.orgId,
      connectorId: seededConnectorId,
      limit: 50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.every((i) => i.connector_id === seededConnectorId)).toBe(true)
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listDeletionReceipts({
      orgId: org.orgId,
      cursor: '####nope###',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

  it('cross-org isolation', async () => {
    const r = await listDeletionReceipts({
      orgId: otherOrg.orgId,
      limit: 100,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const overlap = r.data.items.filter((i) => i.artefact_id === seededReceiptArtefactId)
    expect(overlap).toHaveLength(0)
  })

  it('date range filter with ancient window returns empty', async () => {
    const r = await listDeletionReceipts({
      orgId: org.orgId,
      issuedBefore: new Date(Date.now() - 365 * 86400_000).toISOString(),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(0)
  })

})
