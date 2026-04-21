// ADR-1002 Sprint 5.1 — Mrs. Sharma end-to-end scenario.
//
// Reproduces the §11 worked example (scaled down to 10k for CI; the full
// 12M-identifier batch is a staging perf run). Exercises every endpoint
// shipped in ADR-1002 Phases 1–4 in sequence:
//
//   1. POST /v1/consent/record           — 5-purpose banking consent
//   2. GET  /v1/consent/verify           — single-identifier check (granted)
//   3. POST /v1/consent/verify/batch     — 10,000 identifiers (1 hit, 9,999 never)
//   4. POST /v1/consent/artefacts/{id}/revoke — marketing withdrawn
//   5. GET  /v1/consent/verify           — marketing now `revoked`
//   6. GET  /v1/consent/artefacts        — 5 rows (4 active + 1 revoked)
//   7. GET  /v1/consent/artefacts/{id}   — detail envelope + revocation record
//   8. GET  /v1/consent/events           — record + implicit revoke events
//   9. POST /v1/deletion/trigger         — erasure_request → remaining 4 revoked
//  10. GET  /v1/deletion/receipts        — seeded receipt observable
//
// Purpose codes mirror the §11 BFSI archetype: marketing, analytics,
// bureau_reporting, repayment_history, credit_score_sharing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { recordConsent } from '../../app/src/lib/consent/record'
import { verifyConsent, verifyConsentBatch } from '../../app/src/lib/consent/verify'
import { revokeArtefact } from '../../app/src/lib/consent/revoke'
import { triggerDeletion, listDeletionReceipts } from '../../app/src/lib/consent/deletion'
import { listArtefacts, getArtefact, listEvents } from '../../app/src/lib/consent/read'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

const SHARMA_PURPOSES = [
  'sharma_marketing',
  'sharma_analytics',
  'sharma_bureau_reporting',
  'sharma_repayment_history',
  'sharma_credit_score_sharing',
]

let org: TestOrg
let propertyId: string
let purposeByCode: Record<string, string> = {}
let sharmaIdentifier: string
let artefactByPurpose: Record<string, string> = {}
let marketingArtefactId: string
let marketingRevocationId: string
let keyId: string

beforeAll(async () => {
  org = await createTestOrg('sharma')
  keyId = (await seedApiKey(org)).keyId
  const admin = getServiceClient()

  const { data: prop } = await admin
    .from('web_properties')
    .insert({
      org_id: org.orgId,
      name: 'Banking portal',
      url: `https://sharma-bank-${Date.now()}.test`,
    })
    .select('id').single()
  propertyId = prop!.id

  for (const code of SHARMA_PURPOSES) {
    const { data } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: 'BFSI worked example — Mrs. Sharma',
        data_scope: ['email_address', 'phone_number'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id').single()
    purposeByCode[code] = data!.id
  }

  sharmaIdentifier = `sharma-${Date.now()}@test.bank.in`
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
}, 30_000)

// ═══════════════════════════════════════════════════════════
// Scenario
// ═══════════════════════════════════════════════════════════

describe('Mrs. Sharma — §11 end-to-end', () => {

  it('1. records 5-purpose banking consent via Mode B', async () => {
    const r = await recordConsent({
      keyId,
      orgId:              org.orgId,
      propertyId,
      identifier:         sharmaIdentifier,
      identifierType:     'email',
      acceptedPurposeIds: Object.values(purposeByCode),
      capturedAt:         new Date().toISOString(),
      clientRequestId:    `sharma-onboard-${Date.now()}`,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.data.artefact_ids).toHaveLength(5)
    expect(r.data.idempotent_replay).toBe(false)

    for (const row of r.data.artefact_ids) {
      expect(row.status).toBe('active')
      artefactByPurpose[row.purpose_code] = row.artefact_id
    }
    marketingArtefactId = artefactByPurpose['sharma_marketing']
    expect(marketingArtefactId).toBeTruthy()
  })

  it('2. verify returns `granted` for marketing before a campaign', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId,
      identifier:     sharmaIdentifier,
      identifierType: 'email',
      purposeCode:    'sharma_marketing',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('granted')
    expect(r.data.active_artefact_id).toBe(marketingArtefactId)
  })

  it('3. batch verify 10,000 identifiers — Sharma `granted`, rest `never_consented`', async () => {
    // Place Sharma at an arbitrary index to verify ordering is preserved.
    const ids: string[] = []
    const targetIndex = 7_142
    for (let i = 0; i < 10_000; i++) {
      ids.push(i === targetIndex ? sharmaIdentifier : `nobody-${i}-${Date.now()}@bank.test`)
    }

    const t0 = Date.now()
    const r = await verifyConsentBatch({
      keyId,
      orgId:          org.orgId,
      propertyId,
      identifiers:    ids,
      identifierType: 'email',
      purposeCode:    'sharma_marketing',
    })
    const elapsed = Date.now() - t0
    expect(r.ok).toBe(true)
    if (!r.ok) return

    expect(r.data.results).toHaveLength(10_000)
    // Sharma at the target index.
    expect(r.data.results[targetIndex].identifier).toBe(sharmaIdentifier)
    expect(r.data.results[targetIndex].status).toBe('granted')
    expect(r.data.results[targetIndex].active_artefact_id).toBe(marketingArtefactId)

    // Other positions are never_consented.
    const grantedCount = r.data.results.filter((row) => row.status === 'granted').length
    expect(grantedCount).toBe(1)
    const neverCount = r.data.results.filter((row) => row.status === 'never_consented').length
    expect(neverCount).toBe(9_999)

    // Soft perf target: 10k identifiers in a realistic-bound time against
    // dev DB. Isolated runs return in ~6s; full-suite contention (13+ files
    // writing concurrently) can push it into the high teens. Relaxed vs
    // staging expectation — ADR-1008 owns the actual p99 < 2s SLO load test.
    expect(elapsed).toBeLessThan(25_000)
  }, 30_000)

  it('4. revokes marketing artefact with user_withdrawal reason', async () => {
    const r = await revokeArtefact({
      keyId,
      orgId:       org.orgId,
      artefactId:  marketingArtefactId,
      reasonCode:  'user_withdrawal',
      reasonNotes: 'Opted out via dashboard',
      actorType:   'user',
      actorRef:    sharmaIdentifier,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('revoked')
    expect(r.data.idempotent_replay).toBe(false)
    marketingRevocationId = r.data.revocation_record_id
  })

  it('5. verify returns `revoked` with revocation_record_id after revoke', async () => {
    const r = await verifyConsent({
      keyId,
      orgId:          org.orgId,
      propertyId,
      identifier:     sharmaIdentifier,
      identifierType: 'email',
      purposeCode:    'sharma_marketing',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('revoked')
    expect(r.data.revocation_record_id).toBe(marketingRevocationId)
    expect(r.data.active_artefact_id).toBeNull()
  })

  it('6. artefacts list shows 4 active + 1 revoked for this identity', async () => {
    const r = await listArtefacts({
      keyId,
      orgId:          org.orgId,
      propertyId,
      identifier:     sharmaIdentifier,
      identifierType: 'email',
      limit:          50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(5)

    const active = r.data.items.filter((i) => i.status === 'active')
    const revoked = r.data.items.filter((i) => i.status === 'revoked')
    expect(active).toHaveLength(4)
    expect(revoked).toHaveLength(1)
    expect(revoked[0].artefact_id).toBe(marketingArtefactId)
    expect(revoked[0].revocation_record_id).toBe(marketingRevocationId)
  })

  it('7. artefact detail returns envelope + revocation record', async () => {
    const r = await getArtefact({ keyId, orgId: org.orgId, artefactId: marketingArtefactId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).not.toBeNull()
    expect(r.data!.artefact_id).toBe(marketingArtefactId)
    expect(r.data!.status).toBe('revoked')
    expect(r.data!.revocation).not.toBeNull()
    expect(r.data!.revocation!.id).toBe(marketingRevocationId)
    expect(r.data!.revocation!.reason).toBe('user_withdrawal')
    expect(r.data!.revocation!.revoked_by_type).toBe('data_principal')
    expect(r.data!.revocation!.revoked_by_ref).toBe(sharmaIdentifier)
    // No replacement chain for a revoked-never-replaced artefact.
    expect(r.data!.replacement_chain).toEqual([marketingArtefactId])
  })

  it('8. events list surfaces the Mode B record event', async () => {
    const r = await listEvents({
      keyId,
      orgId:       org.orgId,
      propertyId,
      source:      'api',
      limit:       50,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)

    const ours = r.data.items.find((i) => i.source === 'api' && i.purposes_accepted_count === 5)
    expect(ours).toBeTruthy()
    expect(ours!.artefact_count).toBe(5)
    expect(ours!.identifier_type).toBe('email')
  })

  it('9. DPDP §13 erasure_request sweeps the remaining 4 active artefacts', async () => {
    const r = await triggerDeletion({
      keyId,
      orgId:          org.orgId,
      propertyId,
      identifier:     sharmaIdentifier,
      identifierType: 'email',
      reason:         'erasure_request',
      actorType:      'user',
      actorRef:       sharmaIdentifier,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.reason).toBe('erasure_request')
    expect(r.data.revoked_artefact_ids).toHaveLength(4)
    expect(r.data.revoked_artefact_ids).not.toContain(marketingArtefactId) // already revoked

    // All 5 artefacts now revoked.
    const admin = getServiceClient()
    for (const artefactId of Object.values(artefactByPurpose)) {
      const { data: art } = await admin
        .from('consent_artefacts').select('status').eq('artefact_id', artefactId).single()
      expect(art?.status).toBe('revoked')
    }
  })

  it('10. deletion receipts list seeded fixture observable (async fan-out)', async () => {
    // The Edge Function fan-out to deletion_receipts is asynchronous and
    // depends on connector mappings. We seed one receipt directly to prove
    // the listing endpoint sees rows scoped to an artefact, matching the
    // Sprint 4.1 integration pattern. Live fan-out is staging-verified.
    const admin = getServiceClient()
    const { data: conn } = await admin
      .from('integration_connectors')
      .insert({
        org_id: org.orgId,
        connector_type: 'test_echo',
        display_name: 'Mrs. Sharma echo',
        status: 'active',
        config: '\\x7b7d',
      })
      .select('id').single()

    // Fetch the erasure-request revocation for one of the artefacts.
    const analyticsArtefactId = artefactByPurpose['sharma_analytics']
    const { data: rev } = await admin
      .from('artefact_revocations')
      .select('id')
      .eq('artefact_id', analyticsArtefactId)
      .order('revoked_at', { ascending: false })
      .limit(1)
      .single()

    await admin.from('deletion_receipts').insert({
      org_id: org.orgId,
      trigger_type: 'erasure_request',
      trigger_id: rev!.id,
      connector_id: conn!.id,
      target_system: 'test_echo',
      identifier_hash: 'y'.repeat(64),
      status: 'pending',
    })

    const r = await listDeletionReceipts({
      keyId,
      orgId:      org.orgId,
      artefactId: analyticsArtefactId,
      limit:      10,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    expect(r.data.items[0].artefact_id).toBe(analyticsArtefactId)
    expect(r.data.items[0].target_system).toBe('test_echo')
    expect(r.data.items[0].status).toBe('pending')
  })

})
