// ADR-1002 Sprint 1.3 — /v1/consent/verify/batch integration tests.
//
// Exercises verifyConsentBatch() end-to-end against the live DB:
//   - 4-state mixed fixture returns statuses in input order
//   - 10,001 identifiers → identifiers_too_large (mapped to 413 by route)
//   - 0 identifiers → identifiers_empty
//   - Cross-org property → property_not_found
//   - Unknown identifier_type → invalid_identifier
//   - Ordering preserved across a 25-element mix

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { verifyConsentBatch } from '../../app/src/lib/consent/verify'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const PURPOSE_CODE = 'batch_test_marketing'

interface SeededArtefact {
  artefactId: string
  revocationId?: string
}

let org: TestOrg
let otherOrg: TestOrg
let propertyId: string
let bannerId: string
let purposeDefinitionId: string
let grantedEmail: string
let revokedEmail: string
let expiredEmail: string
let never1Email: string
let never2Email: string
let grantedArtefactId: string
let revokedArtefactId: string
let revocationRecordId: string

async function seedArtefact(
  targetOrg: TestOrg,
  email: string,
  validityState: 'active' | 'revoked' | 'expired',
  expiresAtIso: string,
): Promise<SeededArtefact> {
  const admin = getServiceClient()

  const { data: hashData, error: hashErr } = await admin.rpc('hash_data_principal_identifier', {
    p_org_id:          targetOrg.orgId,
    p_identifier:      email,
    p_identifier_type: 'email',
  })
  if (hashErr) throw new Error(`hash: ${hashErr.message}`)
  const identifierHash = hashData as string

  const fp = `batch-${validityState}-${Date.now()}-${Math.random()}`
  const { data: event, error: eErr } = await admin
    .from('consent_events')
    .insert({
      org_id: targetOrg.orgId,
      property_id: propertyId,
      banner_id: bannerId,
      banner_version: 1,
      session_fingerprint: fp,
      event_type: 'accept',
      purposes_accepted: [{ purpose_definition_id: purposeDefinitionId, purpose_code: PURPOSE_CODE }],
      purposes_rejected: [],
    })
    .select('id')
    .single()
  if (eErr) throw new Error(`event: ${eErr.message}`)

  const { data: artefact, error: aErr } = await admin
    .from('consent_artefacts')
    .insert({
      org_id: targetOrg.orgId,
      property_id: propertyId,
      banner_id: bannerId,
      banner_version: 1,
      consent_event_id: event!.id,
      session_fingerprint: fp,
      purpose_definition_id: purposeDefinitionId,
      purpose_code: PURPOSE_CODE,
      data_scope: ['email_address'],
      framework: 'dpdp',
      expires_at: expiresAtIso,
    })
    .select('artefact_id')
    .single()
  if (aErr) throw new Error(`artefact: ${aErr.message}`)

  await admin.from('consent_artefact_index').insert({
    org_id:           targetOrg.orgId,
    property_id:      propertyId,
    artefact_id:      artefact!.artefact_id,
    consent_event_id: event!.id,
    identifier_hash:  identifierHash,
    identifier_type:  'email',
    validity_state:   validityState === 'revoked' ? 'active' : validityState,
    framework:        'dpdp',
    purpose_code:     PURPOSE_CODE,
    expires_at:       expiresAtIso,
  })

  let revocationId: string | undefined
  if (validityState === 'revoked') {
    const { data: revocation } = await admin
      .from('artefact_revocations')
      .insert({
        org_id: targetOrg.orgId,
        artefact_id: artefact!.artefact_id,
        reason: 'user_preference_change',
        revoked_by_type: 'data_principal',
        revoked_by_ref: email,
      })
      .select('id')
      .single()
    revocationId = revocation!.id as string
  }

  return { artefactId: artefact!.artefact_id, revocationId }
}

beforeAll(async () => {
  org = await createTestOrg('batchM')
  otherOrg = await createTestOrg('batchO')
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'batch prop', url: `https://batch-${Date.now()}.test` })
    .select('id')
    .single()
  propertyId = prop!.id

  const { data: banner } = await admin
    .from('consent_banners')
    .insert({
      org_id: org.orgId,
      property_id: propertyId,
      version: 1,
      headline: 'Test',
      body_copy: 'Body',
      purposes: [],
      is_active: true,
    })
    .select('id')
    .single()
  bannerId = banner!.id

  const { data: purpose } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: PURPOSE_CODE,
      display_name: 'Batch test',
      description: 'ADR-1002 Sprint 1.3 test',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id')
    .single()
  purposeDefinitionId = purpose!.id

  const stamp = Date.now()
  grantedEmail = `batch-granted-${stamp}@t.test`
  revokedEmail = `batch-revoked-${stamp}@t.test`
  expiredEmail = `batch-expired-${stamp}@t.test`
  never1Email  = `batch-never1-${stamp}@t.test`
  never2Email  = `batch-never2-${stamp}@t.test`

  const granted = await seedArtefact(
    org,
    grantedEmail,
    'active',
    new Date(Date.now() + 365 * 86400_000).toISOString(),
  )
  const revoked = await seedArtefact(
    org,
    revokedEmail,
    'revoked',
    new Date(Date.now() + 365 * 86400_000).toISOString(),
  )
  await seedArtefact(
    org,
    expiredEmail,
    'active',
    new Date(Date.now() - 86400_000).toISOString(),
  )
  grantedArtefactId = granted.artefactId
  revokedArtefactId = revoked.artefactId
  revocationRecordId = revoked.revocationId!
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('verifyConsentBatch — four-state fixture', () => {

  it('returns statuses in input order (5-element mix)', async () => {
    const input = [grantedEmail, revokedEmail, expiredEmail, never1Email, never2Email]
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    input,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.results).toHaveLength(5)

    // Ordering + identifier echo
    for (let i = 0; i < input.length; i++) {
      expect(r.data.results[i].identifier).toBe(input[i])
    }

    expect(r.data.results[0].status).toBe('granted')
    expect(r.data.results[0].active_artefact_id).toBe(grantedArtefactId)

    expect(r.data.results[1].status).toBe('revoked')
    expect(r.data.results[1].active_artefact_id).toBeNull()
    expect(r.data.results[1].revocation_record_id).toBe(revocationRecordId)

    expect(r.data.results[2].status).toBe('expired')
    expect(r.data.results[3].status).toBe('never_consented')
    expect(r.data.results[4].status).toBe('never_consented')

    // Envelope echoes request metadata.
    expect(r.data.property_id).toBe(propertyId)
    expect(r.data.identifier_type).toBe('email')
    expect(r.data.purpose_code).toBe(PURPOSE_CODE)
    // evaluated_at is server-side ISO.
    expect(new Date(r.data.evaluated_at).getTime()).toBeGreaterThan(Date.now() - 10_000)
  })

  it('preserves order across 25 identifiers (duplicates + interleaving)', async () => {
    // 25 elements: granted/revoked/expired/never rotated + a few repeats.
    const base = [grantedEmail, revokedEmail, expiredEmail, never1Email, never2Email]
    const input: string[] = []
    for (let i = 0; i < 25; i++) input.push(base[i % 5])

    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    input,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.results).toHaveLength(25)

    for (let i = 0; i < 25; i++) {
      expect(r.data.results[i].identifier).toBe(input[i])
    }

    // Spot-check: every repeat of grantedEmail gets the same status + artefact_id.
    const grantedRows = r.data.results.filter((row) => row.identifier === grantedEmail)
    expect(grantedRows.length).toBe(5)
    expect(grantedRows.every((row) => row.status === 'granted')).toBe(true)
    expect(grantedRows.every((row) => row.active_artefact_id === grantedArtefactId)).toBe(true)
  })

})

describe('verifyConsentBatch — error cases', () => {

  it('empty identifiers → identifiers_empty', async () => {
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    [],
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('identifiers_empty')
  })

  it('10001 identifiers → identifiers_too_large', async () => {
    const ids = Array.from({ length: 10001 }, (_, i) => `fake-${i}@t.test`)
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    ids,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('identifiers_too_large')
  })

  it('cross-org property → property_not_found', async () => {
    const admin = getServiceClient()
    const { data: otherProp } = await admin
      .from('web_properties')
      .insert({ org_id: otherOrg.orgId, name: 'other', url: `https://other-batch-${Date.now()}.test` })
      .select('id')
      .single()

    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId:     otherProp!.id,
      identifiers:    [grantedEmail],
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('property_not_found')
  })

  it('unknown identifier_type → invalid_identifier', async () => {
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    [grantedEmail],
      identifierType: 'passport',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

  it('one bad identifier in the batch fails the whole call (all-or-nothing)', async () => {
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    [grantedEmail, '', never1Email],
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_identifier')
  })

})

describe('verifyConsentBatch — performance smoke', () => {

  it('1000 never-consented identifiers completes in under 5 s', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `perf-never-${i}-${Date.now()}@t.test`)
    const t0 = Date.now()
    const r = await verifyConsentBatch({
      orgId:          org.orgId,
      propertyId,
      identifiers:    ids,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.results).toHaveLength(1000)
    expect(elapsed).toBeLessThan(5000)
    // Reference the envelope's identifier is echoed correctly for the first/last.
    expect(r.data.results[0].identifier).toBe(ids[0])
    expect(r.data.results[999].identifier).toBe(ids[999])
  }, 10_000)

})
