// ADR-1005 Sprint 5.1 — /v1/rights/requests integration tests.
//
// Covers:
//   createRightsRequest — happy path, validation, cross-org fence,
//     audit event emission, identity_verified / captured_via semantics.
//   listRightsRequests  — happy path, filters (status, request_type,
//     captured_via), envelope shape, cross-org fence.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createRightsRequest,
  listRightsRequests,
} from '../../app/src/lib/api/rights'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

let org: TestOrg
let otherOrg: TestOrg
let keyId: string
let otherKeyId: string
let createdIds: string[] = []

beforeAll(async () => {
  org = await createTestOrg('rightsApi')
  otherOrg = await createTestOrg('rightsOther')
  keyId = (await seedApiKey(org)).keyId
  otherKeyId = (await seedApiKey(otherOrg)).keyId

  // Seed 3 requests — happy-path fixture for list tests.
  const makes = [
    { type: 'erasure' as const,    email: `alice-${Date.now()}@example.test` },
    { type: 'access' as const,     email: `bob-${Date.now()}@example.test` },
    { type: 'correction' as const, email: `carol-${Date.now()}@example.test` },
  ]
  for (const m of makes) {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: m.type,
      requestorName: 'Test User',
      requestorEmail: m.email,
      requestDetails: 'seeded fixture',
      identityVerifiedBy: 'test_attestation_seed',
    })
    if (!r.ok) throw new Error(`seed failed: ${r.error.kind} — ${r.error.detail}`)
    createdIds.push(r.data.id)
  }
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('createRightsRequest — POST /v1/rights/requests', () => {

  it('happy path: returns envelope with identity_verified + captured_via=api', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'Happy Path',
      requestorEmail: `happy-${Date.now()}@example.test`,
      requestDetails: 'please erase my account',
      identityVerifiedBy: 'internal_kyc_check',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.data.status).toBe('new')
    expect(r.data.request_type).toBe('erasure')
    expect(r.data.captured_via).toBe('api')
    expect(r.data.identity_verified).toBe(true)
    expect(r.data.identity_verified_by).toBe('internal_kyc_check')
    expect(typeof r.data.sla_deadline).toBe('string')
    expect(typeof r.data.created_at).toBe('string')
  })

  it('caller-supplied captured_via=branch is honoured (operator channel)', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'access',
      requestorName: 'Branch Walk-in',
      requestorEmail: `branch-${Date.now()}@example.test`,
      identityVerifiedBy: 'branch_officer_42',
      capturedVia: 'branch',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.captured_via).toBe('branch')
  })

  it('appends a created_via_api audit event to rights_request_events', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'Audit Check',
      requestorEmail: `audit-${Date.now()}@example.test`,
      identityVerifiedBy: 'internal_kyc_check',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const admin = getServiceClient()
    const { data, error } = await admin
      .from('rights_request_events')
      .select('event_type, metadata, org_id, request_id')
      .eq('request_id', r.data.id)
      .eq('event_type', 'created_via_api')
      .single()
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data!.org_id).toBe(org.orgId)
    expect(data!.metadata).toMatchObject({
      api_key_id: keyId,
      identity_verified_by: 'internal_kyc_check',
      captured_via: 'api',
    })
  })

  it('stamps created_by_api_key_id on the rights_requests row', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'Key Tag',
      requestorEmail: `keytag-${Date.now()}@example.test`,
      identityVerifiedBy: 'internal_kyc_check',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const admin = getServiceClient()
    const { data } = await admin
      .from('rights_requests')
      .select('created_by_api_key_id, captured_via')
      .eq('id', r.data.id)
      .single()
    expect(data!.created_by_api_key_id).toBe(keyId)
    expect(data!.captured_via).toBe('api')
  })

  it('invalid request_type → invalid_request_type', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      // @ts-expect-error — intentionally invalid type
      type: 'unknown',
      requestorName: 'X',
      requestorEmail: `bad-${Date.now()}@example.test`,
      identityVerifiedBy: 'x',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_request_type')
  })

  it('invalid email → invalid_requestor_email', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'X',
      requestorEmail: 'not-an-email',
      identityVerifiedBy: 'x',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_requestor_email')
  })

  it('missing identity_verified_by → identity_verified_by_missing', async () => {
    const r = await createRightsRequest({
      keyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'X',
      requestorEmail: `missing-${Date.now()}@example.test`,
      identityVerifiedBy: '   ',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('identity_verified_by_missing')
  })

  it('cross-org fence: key bound to otherOrg cannot create in org', async () => {
    const r = await createRightsRequest({
      keyId: otherKeyId,
      orgId: org.orgId,
      type: 'erasure',
      requestorName: 'Fence',
      requestorEmail: `fence-${Date.now()}@example.test`,
      identityVerifiedBy: 'internal_kyc_check',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

})

describe('listRightsRequests — GET /v1/rights/requests', () => {

  it('returns all requests for the caller org (3 seeded + tests above)', async () => {
    const r = await listRightsRequests({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 3 seeded in beforeAll + 4 created in POST describe-block (happy, branch,
    // audit, keytag). Items may include entries from other sibling describes
    // running in parallel mode — safer to assert >= 7.
    expect(r.data.items.length).toBeGreaterThanOrEqual(7)
    expect(r.data.next_cursor).toBeNull()
  })

  it('filter by status=new returns only new requests', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      status: 'new',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThan(0)
    for (const item of r.data.items) expect(item.status).toBe('new')
  })

  it('filter by request_type=access returns only access requests', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      requestType: 'access',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(2) // seeded 'access' + 'branch' walk-in
    for (const item of r.data.items) expect(item.request_type).toBe('access')
  })

  it('filter by captured_via=branch returns only the branch-channel request', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      capturedVia: 'branch',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items.length).toBeGreaterThanOrEqual(1)
    for (const item of r.data.items) expect(item.captured_via).toBe('branch')
  })

  it('envelope has full shape including identity + api_key attribution fields', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      limit: 1,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.data.items[0]
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.identity_verified).toBe(true)
    expect(first.captured_via).toMatch(/^(api|branch|portal|kiosk|call_center|mobile_app|email|other)$/)
    expect(first.created_by_api_key_id).toBe(keyId)
    expect(typeof first.created_at).toBe('string')
  })

  it('cross-org fence: otherOrg-bound key cannot list org requests', async () => {
    const r = await listRightsRequests({ keyId: otherKeyId, orgId: org.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('otherOrg (empty) returns empty items', async () => {
    const r = await listRightsRequests({ keyId: otherKeyId, orgId: otherOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toEqual([])
    expect(r.data.next_cursor).toBeNull()
  })

  it('invalid status filter → invalid_status', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      // @ts-expect-error — intentionally invalid
      status: 'bogus',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('invalid_status')
  })

  it('bad cursor → bad_cursor', async () => {
    const r = await listRightsRequests({
      keyId,
      orgId: org.orgId,
      cursor: 'not-base64-jsonb',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('bad_cursor')
  })

})
