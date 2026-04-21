// ADR-1012 Sprint 1.2 — /v1/purposes and /v1/properties integration tests.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listPurposes, listProperties } from '../../app/src/lib/api/discovery'
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
let purposeIds: string[] = []
let propertyIds: string[] = []

beforeAll(async () => {
  org = await createTestOrg('discMain')
  otherOrg = await createTestOrg('discOther')
  keyId = (await seedApiKey(org, { scopes: ['read:consent'] })).keyId
  otherKeyId = (await seedApiKey(otherOrg, { scopes: ['read:consent'] })).keyId

  const admin = getServiceClient()

  // Seed 3 purposes in the main org, 1 in otherOrg (to verify isolation).
  for (const code of ['disc_marketing', 'disc_analytics', 'disc_bureau']) {
    const { data } = await admin
      .from('purpose_definitions')
      .insert({
        org_id: org.orgId,
        purpose_code: code,
        display_name: code,
        description: 'ADR-1012 Sprint 1.2 test purpose',
        data_scope: ['email_address'],
        default_expiry_days: 365,
        framework: 'dpdp',
      })
      .select('id')
      .single()
    purposeIds.push(data!.id)
  }
  await admin
    .from('purpose_definitions')
    .insert({
      org_id: otherOrg.orgId,
      purpose_code: 'disc_other_org',
      display_name: 'Other',
      description: 'Cross-org isolation fixture',
      data_scope: ['email_address'],
      default_expiry_days: 365,
      framework: 'dpdp',
    })

  // Seed 2 properties in main, 1 in otherOrg.
  for (let i = 0; i < 2; i++) {
    const { data } = await admin
      .from('web_properties')
      .insert({
        org_id: org.orgId,
        name:   `disc prop ${i + 1}`,
        url:    `https://disc-${i}-${Date.now()}.test`,
        allowed_origins: [`https://disc-${i}.test`],
      })
      .select('id').single()
    propertyIds.push(data!.id)
  }
  await admin
    .from('web_properties')
    .insert({
      org_id: otherOrg.orgId,
      name:   'other prop',
      url:    `https://disc-other-${Date.now()}.test`,
      allowed_origins: ['https://disc-other.test'],
    })
}, 90_000)

afterAll(async () => {
  await cleanupTestOrg(org)
  await cleanupTestOrg(otherOrg)
}, 30_000)

describe('listPurposes — /v1/purposes', () => {

  it('returns the caller org\'s 3 purposes, ordered by purpose_code', async () => {
    const r = await listPurposes({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(3)
    const codes = r.data.items.map((p) => p.purpose_code)
    expect(codes).toEqual(['disc_analytics', 'disc_bureau', 'disc_marketing'])
  })

  it('each item carries the full envelope', async () => {
    const r = await listPurposes({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.data.items[0]
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.display_name).toBe('disc_analytics')
    expect(first.data_scope).toEqual(['email_address'])
    expect(first.default_expiry_days).toBe(365)
    expect(first.framework).toBe('dpdp')
    expect(typeof first.is_required).toBe('boolean')
    expect(typeof first.auto_delete_on_expiry).toBe('boolean')
    expect(typeof first.is_active).toBe('boolean')
  })

  it('cross-org attempt with otherOrg-bound key → api_key_binding (fence)', async () => {
    const r = await listPurposes({ keyId: otherKeyId, orgId: org.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

  it('otherOrg with its own key returns only its own 1 purpose', async () => {
    const r = await listPurposes({ keyId: otherKeyId, orgId: otherOrg.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(1)
    expect(r.data.items[0].purpose_code).toBe('disc_other_org')
  })

  it('org with no purposes returns an empty items array', async () => {
    const empty = await createTestOrg('discEmpty')
    const emptyKey = (await seedApiKey(empty, { scopes: ['read:consent'] })).keyId
    try {
      const r = await listPurposes({ keyId: emptyKey, orgId: empty.orgId })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.data.items).toEqual([])
    } finally {
      await cleanupTestOrg(empty)
    }
  }, 60_000)

})

describe('listProperties — /v1/properties', () => {

  it('returns the caller org\'s 2 properties, ordered by created_at asc', async () => {
    const r = await listProperties({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.items).toHaveLength(2)
    // Assert asc order by created_at.
    const t0 = new Date(r.data.items[0].created_at).getTime()
    const t1 = new Date(r.data.items[1].created_at).getTime()
    expect(t0).toBeLessThanOrEqual(t1)
  })

  it('never leaks event_signing_secret', async () => {
    const r = await listProperties({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const item of r.data.items) {
      const keys = Object.keys(item)
      expect(keys).not.toContain('event_signing_secret')
      expect(keys).not.toContain('event_signing_secret_rotated_at')
    }
  })

  it('envelope has expected shape', async () => {
    const r = await listProperties({ keyId, orgId: org.orgId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const first = r.data.items[0]
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.name).toMatch(/^disc prop/)
    expect(first.url).toMatch(/^https:\/\//)
    expect(Array.isArray(first.allowed_origins)).toBe(true)
    expect(typeof first.created_at).toBe('string')
  })

  it('cross-org attempt with otherOrg-bound key → api_key_binding (fence)', async () => {
    const r = await listProperties({ keyId: otherKeyId, orgId: org.orgId })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_binding')
  })

})
