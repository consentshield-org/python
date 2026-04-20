import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupTestOrg, createTestOrg, getServiceClient, TestOrg } from '../rls/helpers'

// ADR-0046 Phase 2 Sprint 2.1 — DPIA records schema + RPCs.
//
// Scope rules tested:
//   · org_admin / account_owner (effective org_admin) can create / publish / supersede
//   · Cross-org: orgA member cannot create a DPIA for orgB
//   · Cross-org: orgA member cannot read orgB DPIA rows
//   · Lifecycle: draft → published (via publish_dpia_record); cannot double-publish
//   · Supersession: replacement must belong to same org; old status flips to superseded

let orgA: TestOrg
let orgB: TestOrg
const service = getServiceClient()
let dpiaDraftId: string
let dpiaPublishedId: string

beforeAll(async () => {
  orgA = await createTestOrg('dpiaA')
  orgB = await createTestOrg('dpiaB')
}, 60000)

afterAll(async () => {
  await service.from('dpia_records').delete().in('org_id', [orgA.orgId, orgB.orgId])
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

async function createDpia(
  client: TestOrg['client'],
  orgId: string,
  title = 'Customer Data DPIA',
) {
  return client.rpc('create_dpia_record', {
    p_org_id: orgId,
    p_title: title,
    p_processing_description:
      'Processing customer contact details for marketing purposes under legitimate interest',
    p_data_categories: ['contact.email', 'contact.phone'],
    p_risk_level: 'medium',
    p_mitigations: { encryption: 'at_rest_and_in_transit', retention_days: 90 },
    p_auditor_attestation_ref: null,
    p_auditor_name: null,
    p_conducted_at: '2026-04-01',
    p_next_review_at: '2027-04-01',
  })
}

describe('ADR-0046 Phase 2 Sprint 2.1 — create_dpia_record', () => {
  it('org_admin (via account_owner inheritance) can create a DPIA', async () => {
    const { data, error } = await createDpia(orgA.client, orgA.orgId)
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    dpiaDraftId = data as string
  })

  it('creates with status=draft', async () => {
    const { data } = await orgA.client
      .from('dpia_records')
      .select('status, title, risk_level')
      .eq('id', dpiaDraftId)
      .single()
    expect(data!.status).toBe('draft')
    expect(data!.risk_level).toBe('medium')
  })

  it('orgB member cannot create a DPIA for orgA', async () => {
    const { error } = await createDpia(orgB.client, orgA.orgId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/access_denied/)
  })

  it('next_review_at before conducted_at raises', async () => {
    const { error } = await orgA.client.rpc('create_dpia_record', {
      p_org_id: orgA.orgId,
      p_title: 'Bad review date',
      p_processing_description: 'a'.repeat(20),
      p_data_categories: [],
      p_risk_level: 'low',
      p_mitigations: {},
      p_auditor_attestation_ref: null,
      p_auditor_name: null,
      p_conducted_at: '2026-06-01',
      p_next_review_at: '2026-03-01',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/next_review_at/)
  })
})

describe('ADR-0046 Phase 2 Sprint 2.1 — RLS read isolation', () => {
  it('orgA member sees only orgA DPIAs (not orgB)', async () => {
    // Seed orgB DPIA via orgB's client
    const bRes = await createDpia(orgB.client, orgB.orgId, 'OrgB DPIA')
    const orgBDpiaId = bRes.data as string

    const { data: aRows } = await orgA.client.from('dpia_records').select('id, org_id')
    const ids = (aRows ?? []).map((r: { id: string }) => r.id)
    expect(ids).toContain(dpiaDraftId)
    expect(ids).not.toContain(orgBDpiaId)

    // Also confirm each row's org_id == orgA
    ;(aRows ?? []).forEach((r: { org_id: string }) => expect(r.org_id).toBe(orgA.orgId))
  })
})

describe('ADR-0046 Phase 2 Sprint 2.1 — publish_dpia_record', () => {
  it('draft can be published', async () => {
    const { error } = await orgA.client.rpc('publish_dpia_record', { p_dpia_id: dpiaDraftId })
    expect(error).toBeNull()

    const { data } = await orgA.client
      .from('dpia_records')
      .select('status, published_at')
      .eq('id', dpiaDraftId)
      .single()
    expect(data!.status).toBe('published')
    expect(data!.published_at).not.toBeNull()
    dpiaPublishedId = dpiaDraftId
  })

  it('already-published cannot be re-published', async () => {
    const { error } = await orgA.client.rpc('publish_dpia_record', { p_dpia_id: dpiaPublishedId })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/cannot_publish_from_status/)
  })

  it('orgB cannot publish an orgA DPIA', async () => {
    // Create fresh draft in orgA
    const draftRes = await createDpia(orgA.client, orgA.orgId, 'Another draft')
    const draftId = draftRes.data as string

    const { error } = await orgB.client.rpc('publish_dpia_record', { p_dpia_id: draftId })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/access_denied/)
  })
})

describe('ADR-0046 Phase 2 Sprint 2.1 — supersede_dpia_record', () => {
  it('supersedes an old DPIA with a replacement; old status=superseded, new=published', async () => {
    // Create replacement draft in orgA
    const replRes = await createDpia(orgA.client, orgA.orgId, 'DPIA v2 (replacement)')
    const replacementId = replRes.data as string

    const { error } = await orgA.client.rpc('supersede_dpia_record', {
      p_old_id: dpiaPublishedId,
      p_replacement_id: replacementId,
    })
    expect(error).toBeNull()

    const { data: oldRow } = await orgA.client
      .from('dpia_records')
      .select('status, superseded_at, superseded_by')
      .eq('id', dpiaPublishedId)
      .single()
    expect(oldRow!.status).toBe('superseded')
    expect(oldRow!.superseded_at).not.toBeNull()
    expect(oldRow!.superseded_by).toBe(replacementId)

    const { data: newRow } = await orgA.client
      .from('dpia_records')
      .select('status')
      .eq('id', replacementId)
      .single()
    expect(newRow!.status).toBe('published')
  })

  it('replacement must belong to same org', async () => {
    const newDraftRes = await createDpia(orgA.client, orgA.orgId, 'Fresh orgA draft')
    const newDraftId = newDraftRes.data as string

    const bDraftRes = await createDpia(orgB.client, orgB.orgId, 'OrgB cross-org draft')
    const bDraftId = bDraftRes.data as string

    // Publish the orgA draft first so it can be superseded
    await orgA.client.rpc('publish_dpia_record', { p_dpia_id: newDraftId })

    const { error } = await orgA.client.rpc('supersede_dpia_record', {
      p_old_id: newDraftId,
      p_replacement_id: bDraftId,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/same org|replacement|access_denied/)
  })
})
