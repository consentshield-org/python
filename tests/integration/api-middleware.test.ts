import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { verifyBearerToken } from '../../app/src/lib/api/auth'
import {
  createTestOrg,
  cleanupTestOrg,
  type TestOrg,
} from '../rls/helpers'

// ADR-1001 Sprint 2.2 — Bearer middleware unit tests.
// Exercises verifyBearerToken() against the live DB — same approach as
// tests/rls/api-keys.test.ts. The /api/v1/_ping HTTP integration test
// is a manual step (requires a running dev server) recorded in the ADR.

let org: TestOrg
let plaintext: string
let keyId: string

beforeAll(async () => {
  org = await createTestOrg('apiMw')

  const { data, error } = await org.client.rpc('rpc_api_key_create', {
    p_account_id: org.accountId,
    p_org_id: org.orgId,
    p_scopes: ['read:consent', 'write:consent'],
    p_rate_tier: 'starter',
    p_name: 'middleware test key',
  })
  if (error) throw new Error(`rpc_api_key_create failed: ${error.message}`)
  const key = data as { id: string; plaintext: string }
  plaintext = key.plaintext
  keyId = key.id
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(org)
}, 30000)

describe('verifyBearerToken', () => {
  it('returns ok=true with context for a valid key', async () => {
    const result = await verifyBearerToken(`Bearer ${plaintext}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.key_id).toBe(keyId)
    expect(result.context.org_id).toBe(org.orgId)
    expect(result.context.account_id).toBe(org.accountId)
    expect(result.context.scopes).toContain('read:consent')
    expect(result.context.scopes).toContain('write:consent')
    expect(result.context.rate_tier).toBe('starter')
  })

  it('returns 401/missing when Authorization header is absent', async () => {
    const result = await verifyBearerToken(null)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.reason).toBe('missing')
  })

  it('returns 401/malformed for a non-cs_live_ Bearer value', async () => {
    const result = await verifyBearerToken('Bearer not_a_real_token')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.reason).toBe('malformed')
  })

  it('returns 401/malformed when the scheme is missing', async () => {
    const result = await verifyBearerToken(plaintext)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.reason).toBe('malformed')
  })

  it('returns 401/invalid for a cs_live_ token that does not exist', async () => {
    const result = await verifyBearerToken('Bearer cs_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.reason).toBe('invalid')
  })

  it('returns 410/revoked after the key is revoked', async () => {
    // rpc_api_key_revoke requires current_uid() — must call as the key's owner.
    const { error } = await org.client.rpc('rpc_api_key_revoke', { p_key_id: keyId })
    expect(error).toBeNull()

    const result = await verifyBearerToken(`Bearer ${plaintext}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(410)
    expect(result.reason).toBe('revoked')
  })
})
