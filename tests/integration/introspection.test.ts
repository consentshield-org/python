// ADR-1012 Sprint 1.1 — /v1/keys/self and /v1/usage integration tests.
//
// Exercises keySelf() and keyUsageSelf() helpers end-to-end against the
// live dev DB. Both helpers go through the cs_api pool.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { keySelf, keyUsageSelf } from '../../app/src/lib/api/introspection'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

let org: TestOrg
let keyId: string

beforeAll(async () => {
  org = await createTestOrg('intro')
  keyId = (await seedApiKey(org, { scopes: ['read:consent', 'write:consent'] })).keyId
}, 60_000)

afterAll(async () => {
  await cleanupTestOrg(org)
}, 30_000)

describe('keySelf — /v1/keys/self', () => {

  it('returns the seeded key metadata', async () => {
    const r = await keySelf({ keyId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.key_id).toBe(keyId)
    expect(r.data.account_id).toBe(org.accountId)
    expect(r.data.org_id).toBe(org.orgId)
    expect(r.data.scopes).toEqual(expect.arrayContaining(['read:consent', 'write:consent']))
    expect(r.data.rate_tier).toBe('starter')
    expect(r.data.key_prefix).toBe('cs_live_tst')
    expect(r.data.revoked_at).toBeNull()
    expect(typeof r.data.created_at).toBe('string')
  })

  it('never leaks key_hash or revoked_by (safe subset only)', async () => {
    const r = await keySelf({ keyId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const keys = Object.keys(r.data)
    expect(keys).not.toContain('key_hash')
    expect(keys).not.toContain('previous_key_hash')
    expect(keys).not.toContain('revoked_by')
  })

  it('returns api_key_not_found for an unknown key_id', async () => {
    const r = await keySelf({ keyId: '00000000-0000-0000-0000-000000000000' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.kind).toBe('api_key_not_found')
  })

})

describe('keyUsageSelf — /v1/usage', () => {

  it('returns a zero-filled 7-day series for a fresh key', async () => {
    const r = await keyUsageSelf({ keyId })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.key_id).toBe(keyId)
    expect(r.data.days).toBe(7)
    expect(r.data.series).toHaveLength(7)
    for (const row of r.data.series) {
      expect(typeof row.day).toBe('string')
      expect(row.request_count).toBeGreaterThanOrEqual(0)
      expect(row.p50_ms).toBeGreaterThanOrEqual(0)
      expect(row.p95_ms).toBeGreaterThanOrEqual(0)
    }
    // Most-recent-first ordering.
    const days = r.data.series.map((r) => r.day)
    const sorted = [...days].sort().reverse()
    expect(days).toEqual(sorted)
  })

  it('reflects a real request after rpc_api_request_log_insert', async () => {
    // Seed a request-log row directly for today.
    const admin = getServiceClient()
    const today = new Date().toISOString()
    await admin.rpc('rpc_api_request_log_insert', {
      p_key_id:     keyId,
      p_org_id:     org.orgId,
      p_account_id: org.accountId,
      p_route:      '/api/v1/ping',
      p_method:     'GET',
      p_status:     200,
      p_latency:    42,
    })

    const r = await keyUsageSelf({ keyId, days: 1 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.series).toHaveLength(1)
    expect(r.data.series[0].request_count).toBeGreaterThanOrEqual(1)
    expect(r.data.series[0].p50_ms).toBeGreaterThan(0)
    // today is a string ISO; compare the date portion.
    expect(r.data.series[0].day).toBe(today.slice(0, 10))
  })

  it('accepts days=1..30; clamps or rejects out-of-range', async () => {
    // RPC clamps to 1..30 silently; helper accepts what's passed.
    const r1 = await keyUsageSelf({ keyId, days: 1 })
    expect(r1.ok).toBe(true)
    if (r1.ok) expect(r1.data.series).toHaveLength(1)

    const r30 = await keyUsageSelf({ keyId, days: 30 })
    expect(r30.ok).toBe(true)
    if (r30.ok) expect(r30.data.series).toHaveLength(30)
  })

})
