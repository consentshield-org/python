// ADR-1002 Sprint 3.2 — revoke endpoint integration tests.
//
// Covers:
//   - Revoke active artefact → cascade fires (consent_artefacts.status,
//     consent_artefact_index.validity_state + revoked_at + revocation_record_id)
//   - Idempotent replay → 200 with same revocation_record_id
//   - Revoke already-expired → 409 artefact_terminal_state
//   - Revoke already-replaced → 409 artefact_terminal_state
//   - Revoke nonexistent → artefact_not_found
//   - Reason code required
//   - Unknown actor_type rejected
//   - Cross-org artefact → artefact_not_found (not leaked as terminal)
//   - Post-revoke verify returns status=revoked with pointer

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { revokeArtefact } from '../../app/src/lib/consent/revoke'
import { verifyConsent } from '../../app/src/lib/consent/verify'
import { recordConsent } from '../../app/src/lib/consent/record'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const PURPOSE_CODE = 'revoke_test'
let org: TestOrg
let otherOrg: TestOrg
let propertyId: string
let purposeId: string

interface Seeded {
  artefactId: string
  identifier: string
}

async function seedActiveArtefact(identifierPrefix: string): Promise<Seeded> {
  const email = `${identifierPrefix}-${Date.now()}-${Math.random()}@t.test`
  const r = await recordConsent({
    orgId:              org.orgId,
    propertyId,
    identifier:         email,
    identifierType:     'email',
    acceptedPurposeIds: [purposeId],
    capturedAt:         new Date().toISOString(),
  })
  if (!r.ok) throw new Error(`seed artefact: ${r.error.kind}`)
  return { artefactId: r.data.artefact_ids[0].artefact_id, identifier: email }
}

async function forceStatus(artefactId: string, status: 'expired' | 'replaced'): Promise<void> {
  const admin = getServiceClient()
  await admin
    .from('consent_artefacts')
    .update({ status })
    .eq('artefact_id', artefactId)
}

beforeAll(async () => {
  org = await createTestOrg('revK')
  otherOrg = await createTestOrg('revO')
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({ org_id: org.orgId, name: 'revoke prop', url: `https://rev-${Date.now()}.test` })
    .select('id').single()
  propertyId = prop!.id

  const { data: purpose } = await admin
    .from('purpose_definitions')
    .insert({
      org_id: org.orgId,
      purpose_code: PURPOSE_CODE,
      display_name: 'Revoke test',
      description: 'ADR-1002 Sprint 3.2 test',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })
    .select('id').single()
  purposeId = purpose!.id
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('revokeArtefact — happy path', () => {

  it('revoke active → status=revoked + cascade fires on index', async () => {
    const { artefactId, identifier } = await seedActiveArtefact('rev-active')

    const r = await revokeArtefact({
      orgId:       org.orgId,
      artefactId,
      reasonCode:  'user_withdrawal',
      reasonNotes: 'test revocation',
      actorType:   'user',
      actorRef:    identifier,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('revoked')
    expect(r.data.idempotent_replay).toBe(false)
    expect(r.data.revocation_record_id).toMatch(/^[0-9a-f-]{36}$/)

    // consent_artefacts.status flipped.
    const admin = getServiceClient()
    const { data: art } = await admin
      .from('consent_artefacts').select('status').eq('artefact_id', artefactId).single()
    expect(art?.status).toBe('revoked')

    // consent_artefact_index preserved (Sprint 1.1 fix) with validity_state=revoked.
    const { data: idx } = await admin
      .from('consent_artefact_index')
      .select('validity_state, revoked_at, revocation_record_id')
      .eq('artefact_id', artefactId).single()
    expect(idx?.validity_state).toBe('revoked')
    expect(idx?.revoked_at).toBeTruthy()
    expect(idx?.revocation_record_id).toBe(r.data.revocation_record_id)
  })

  it('post-revoke verify returns status=revoked with revocation_record_id pointer', async () => {
    const { artefactId, identifier } = await seedActiveArtefact('rev-then-verify')

    const rev = await revokeArtefact({
      orgId:       org.orgId,
      artefactId,
      reasonCode:  'user_preference_change',
      actorType:   'user',
    })
    expect(rev.ok).toBe(true)
    if (!rev.ok) return

    const v = await verifyConsent({
      orgId:          org.orgId,
      propertyId,
      identifier,
      identifierType: 'email',
      purposeCode:    PURPOSE_CODE,
    })
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.data.status).toBe('revoked')
    expect(v.data.revocation_record_id).toBe(rev.data.revocation_record_id)
  })

  it('operator actor → maps to data_principal/organisation/system correctly', async () => {
    const { artefactId } = await seedActiveArtefact('rev-operator')

    const r = await revokeArtefact({
      orgId:       org.orgId,
      artefactId,
      reasonCode:  'business_withdrawal',
      actorType:   'operator',
      actorRef:    'ops-agent-42',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const admin = getServiceClient()
    const { data: rev } = await admin
      .from('artefact_revocations')
      .select('revoked_by_type, revoked_by_ref, reason, notes')
      .eq('id', r.data.revocation_record_id).single()
    expect(rev?.revoked_by_type).toBe('organisation')
    expect(rev?.revoked_by_ref).toBe('ops-agent-42')
    expect(rev?.reason).toBe('business_withdrawal')
  })

})

describe('revokeArtefact — idempotency', () => {

  it('second revoke returns same revocation_record_id + idempotent_replay=true', async () => {
    const { artefactId } = await seedActiveArtefact('rev-idem')

    const first = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: 'user_withdrawal', actorType: 'user',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.idempotent_replay).toBe(false)

    const second = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: 'user_withdrawal', actorType: 'user',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.idempotent_replay).toBe(true)
    expect(second.data.revocation_record_id).toBe(first.data.revocation_record_id)
  })

})

describe('revokeArtefact — terminal states', () => {

  it('revoke already-expired artefact → artefact_terminal_state', async () => {
    const { artefactId } = await seedActiveArtefact('rev-expired')
    await forceStatus(artefactId, 'expired')

    const r = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: 'user_withdrawal', actorType: 'user',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('artefact_terminal_state')
    if (r.error.kind === 'artefact_terminal_state') {
      expect(r.error.detail).toContain('expired')
    }
  })

  it('revoke already-replaced artefact → artefact_terminal_state', async () => {
    const { artefactId } = await seedActiveArtefact('rev-replaced')
    await forceStatus(artefactId, 'replaced')

    const r = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: 'user_withdrawal', actorType: 'user',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('artefact_terminal_state')
    if (r.error.kind === 'artefact_terminal_state') {
      expect(r.error.detail).toContain('replaced')
    }
  })

})

describe('revokeArtefact — validation errors', () => {

  it('nonexistent artefact_id → artefact_not_found', async () => {
    const r = await revokeArtefact({
      orgId: org.orgId, artefactId: 'art_definitely_not_there',
      reasonCode: 'user_withdrawal', actorType: 'user',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('artefact_not_found')
  })

  it('cross-org artefact → artefact_not_found (not leaked)', async () => {
    const { artefactId } = await seedActiveArtefact('rev-xorg')

    const r = await revokeArtefact({
      orgId:      otherOrg.orgId,   // different org
      artefactId,
      reasonCode: 'user_withdrawal',
      actorType:  'user',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('artefact_not_found')
  })

  it('empty reason_code → reason_code_missing', async () => {
    const { artefactId } = await seedActiveArtefact('rev-noreason')
    const r = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: '   ', actorType: 'user',
    })
    // The TS helper passes through — the RPC catches this.
    // However the route handler rejects empty-after-trim client-side (422);
    // this test exercises the RPC layer directly.
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind === 'reason_code_missing' || r.error.kind === 'unknown').toBe(true)
  })

  it('unknown actor_type → unknown_actor_type', async () => {
    const { artefactId } = await seedActiveArtefact('rev-badactor')
    // Cast to bypass TS type-check — we're testing runtime validation.
    const r = await revokeArtefact({
      orgId: org.orgId, artefactId, reasonCode: 'user_withdrawal',
      actorType: 'regulator' as 'user',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('unknown_actor_type')
  })

})
