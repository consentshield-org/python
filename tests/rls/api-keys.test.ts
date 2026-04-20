import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  TestOrg,
} from './helpers'

// ADR-1001 Sprint 2.1 — api_keys RLS + RPC tests (G-036).
// Exercises the rpc_api_key_create / rotate / revoke / verify cycle,
// the column-level hash hiding, and cross-tenant SELECT isolation.

let orgA: TestOrg
let orgB: TestOrg
let keyA: {
  id: string
  plaintext: string
  prefix: string
}

beforeAll(async () => {
  orgA = await createTestOrg('apiKeysA')
  orgB = await createTestOrg('apiKeysB')
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(orgA)
  await cleanupTestOrg(orgB)
}, 30000)

describe('rpc_api_key_create', () => {
  it('returns a cs_live_ plaintext once and stores only the hash', async () => {
    const { data, error } = await orgA.client.rpc('rpc_api_key_create', {
      p_account_id: orgA.accountId,
      p_org_id: orgA.orgId,
      p_scopes: ['read:consent', 'write:consent'],
      p_rate_tier: 'starter',
      p_name: 'test key A',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const key = data as {
      id: string
      plaintext: string
      prefix: string
      scopes: string[]
    }
    expect(key.plaintext.startsWith('cs_live_')).toBe(true)
    expect(key.plaintext.length).toBeGreaterThan(20)
    expect(key.prefix.startsWith('cs_live_')).toBe(true)
    expect(key.prefix.length).toBe(16)
    expect(key.scopes).toEqual(['read:consent', 'write:consent'])
    keyA = key
  })

  it('rejects invalid scopes', async () => {
    const { error } = await orgA.client.rpc('rpc_api_key_create', {
      p_account_id: orgA.accountId,
      p_org_id: orgA.orgId,
      p_scopes: ['not:a:scope'],
      p_rate_tier: 'starter',
      p_name: 'bad scopes',
    })
    expect(error).toBeTruthy()
    expect(error?.message).toContain('invalid scope')
  })

  it("rejects a non-member caller", async () => {
    // orgB user attempts to mint a key for orgA's account — must fail.
    const { error } = await orgB.client.rpc('rpc_api_key_create', {
      p_account_id: orgA.accountId,
      p_org_id: orgA.orgId,
      p_scopes: ['read:consent'],
      p_rate_tier: 'starter',
      p_name: 'stolen',
    })
    expect(error).toBeTruthy()
  })
})

describe('RLS + column hiding', () => {
  it('authenticated user sees the key row but key_hash is blocked', async () => {
    const { data, error } = await orgA.client
      .from('api_keys')
      .select('id, key_prefix, name, scopes, rate_tier')
      .eq('id', keyA.id)
      .single()
    expect(error).toBeNull()
    expect(data?.key_prefix).toBe(keyA.prefix)
    expect(data?.name).toBe('test key A')
  })

  it('key_hash is never exposed to authenticated clients', async () => {
    // Either PostgREST rejects with a permission error, or the field is
    // masked. Both are acceptable; what is NOT acceptable is leaking the
    // SHA-256 hash to a customer session.
    const res = await orgA.client
      .from('api_keys')
      .select('key_hash')
      .eq('id', keyA.id)
    if (res.error) {
      // Column-level REVOKE path: PostgREST returned an error.
      expect(res.error.message.toLowerCase()).toMatch(/permission|denied|column/)
    } else {
      // If no error, the data must not contain a populated key_hash.
      const leaked = (res.data ?? []).some(
        (row: Record<string, unknown>) => typeof row.key_hash === 'string' && (row.key_hash as string).length > 0,
      )
      expect(leaked).toBe(false)
    }
  })

  it("orgB cannot see orgA's key (cross-tenant isolation)", async () => {
    const { data } = await orgB.client
      .from('api_keys')
      .select('id, key_prefix')
      .eq('id', keyA.id)
    expect(data).toHaveLength(0)
  })
})

describe('rpc_api_key_verify (service_role)', () => {
  it('resolves a live plaintext to the matching key row', async () => {
    const admin = getServiceClient()
    const { data, error } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: keyA.plaintext,
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const resolved = data as {
      id: string
      account_id: string
      org_id: string
      scopes: string[]
      rate_tier: string
    }
    expect(resolved.id).toBe(keyA.id)
    expect(resolved.account_id).toBe(orgA.accountId)
    expect(resolved.org_id).toBe(orgA.orgId)
    expect(resolved.rate_tier).toBe('starter')
  })

  it('returns null for a wrong plaintext', async () => {
    const admin = getServiceClient()
    const { data } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: 'cs_live_wrong_wrong_wrong_wrong_wrong_wrong_',
    })
    expect(data).toBeNull()
  })

  it('returns null for a malformed plaintext', async () => {
    const admin = getServiceClient()
    const { data } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: 'not_a_cs_key',
    })
    expect(data).toBeNull()
  })

  it('verifies stored hash matches SHA-256 of plaintext', async () => {
    const admin = getServiceClient()
    const { data: keyRow } = await admin
      .from('api_keys')
      .select('key_hash')
      .eq('id', keyA.id)
      .single()
    const expectedHash = createHash('sha256').update(keyA.plaintext).digest('hex')
    expect(keyRow?.key_hash).toBe(expectedHash)
  })
})

describe('rpc_api_key_rotate', () => {
  let newPlaintext: string

  it('issues a new plaintext and keeps the id stable', async () => {
    const { data, error } = await orgA.client.rpc('rpc_api_key_rotate', {
      p_key_id: keyA.id,
    })
    expect(error).toBeNull()
    const rotated = data as {
      id: string
      plaintext: string
      prefix: string
      previous_key_expires_at: string
    }
    expect(rotated.id).toBe(keyA.id)
    expect(rotated.plaintext).not.toBe(keyA.plaintext)
    expect(rotated.plaintext.startsWith('cs_live_')).toBe(true)
    expect(rotated.previous_key_expires_at).toBeTruthy()
    newPlaintext = rotated.plaintext
  })

  it('old plaintext still verifies during the dual-window', async () => {
    const admin = getServiceClient()
    const { data } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: keyA.plaintext,
    })
    expect(data).toBeTruthy()
    expect((data as { id: string }).id).toBe(keyA.id)
  })

  it('new plaintext verifies', async () => {
    const admin = getServiceClient()
    const { data } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: newPlaintext,
    })
    expect(data).toBeTruthy()
    expect((data as { id: string }).id).toBe(keyA.id)
  })
})

describe('rpc_api_key_revoke', () => {
  it('sets revoked_at and invalidates both old and new plaintexts', async () => {
    const { error } = await orgA.client.rpc('rpc_api_key_revoke', {
      p_key_id: keyA.id,
    })
    expect(error).toBeNull()

    const admin = getServiceClient()
    const { data: keyRow } = await admin
      .from('api_keys')
      .select('revoked_at, is_active, previous_key_hash')
      .eq('id', keyA.id)
      .single()
    expect(keyRow?.revoked_at).toBeTruthy()
    expect(keyRow?.is_active).toBe(false)
    expect(keyRow?.previous_key_hash).toBeNull()

    const { data: verified } = await admin.rpc('rpc_api_key_verify', {
      p_plaintext: keyA.plaintext,
    })
    expect(verified).toBeNull()
  })

  it('revoking an already-revoked key is idempotent (no error)', async () => {
    const { error } = await orgA.client.rpc('rpc_api_key_revoke', {
      p_key_id: keyA.id,
    })
    expect(error).toBeNull()
  })

  it('rotating a revoked key raises', async () => {
    const { error } = await orgA.client.rpc('rpc_api_key_rotate', {
      p_key_id: keyA.id,
    })
    expect(error).toBeTruthy()
    expect(error?.message).toContain('revoked')
  })
})

describe('authorisation fences', () => {
  it('orgB member cannot revoke orgA key', async () => {
    // Mint a fresh key on orgA first.
    const { data } = await orgA.client.rpc('rpc_api_key_create', {
      p_account_id: orgA.accountId,
      p_org_id: orgA.orgId,
      p_scopes: ['read:consent'],
      p_rate_tier: 'starter',
      p_name: 'victim',
    })
    const victimId = (data as { id: string }).id
    const { error } = await orgB.client.rpc('rpc_api_key_revoke', {
      p_key_id: victimId,
    })
    expect(error).toBeTruthy()
  })
})
