import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanupTestOrg, createTestOrg, getServiceClient, TestOrg } from './helpers'

// ADR-0057 Sprint 1.1 — public.update_org_industry.

let orgA: TestOrg
let orgB: TestOrg
const service = getServiceClient()

beforeAll(async () => {
  orgA = await createTestOrg('indA')
  orgB = await createTestOrg('indB')
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

describe('ADR-0057 Sprint 1.1 — update_org_industry', () => {
  it('org_admin (via account_owner) can change industry', async () => {
    const { error } = await orgA.client.rpc('update_org_industry', {
      p_org_id: orgA.orgId,
      p_industry: 'bfsi',
    })
    expect(error).toBeNull()

    const { data } = await service.from('organisations').select('industry').eq('id', orgA.orgId).single()
    expect(data!.industry).toBe('bfsi')
  })

  it('orgB cannot change orgA industry', async () => {
    const { error } = await orgB.client.rpc('update_org_industry', {
      p_org_id: orgA.orgId,
      p_industry: 'saas',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/access_denied/)

    // Confirm unchanged
    const { data } = await service.from('organisations').select('industry').eq('id', orgA.orgId).single()
    expect(data!.industry).toBe('bfsi')
  })

  it('invalid industry code raises', async () => {
    const { error } = await orgA.client.rpc('update_org_industry', {
      p_org_id: orgA.orgId,
      p_industry: 'not_a_real_sector',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_industry/)
  })

  it('null industry rejected', async () => {
    const { error } = await orgA.client.rpc('update_org_industry', {
      p_org_id: orgA.orgId,
      p_industry: null,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/invalid_industry/)
  })

  it('all whitelisted sectors accepted', async () => {
    const sectors = ['saas', 'edtech', 'healthcare', 'ecommerce', 'hrtech', 'fintech', 'bfsi', 'general']
    for (const s of sectors) {
      const { error } = await orgA.client.rpc('update_org_industry', {
        p_org_id: orgA.orgId,
        p_industry: s,
      })
      expect(error, `sector ${s} should be accepted`).toBeNull()
    }
  })
})
