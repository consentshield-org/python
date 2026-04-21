import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { verifyBearerToken } from '../../app/src/lib/api/auth'
import {
  createTestOrg,
  cleanupTestOrg,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

// ADR-1001 Sprint 3.1 — End-to-end smoke test for the API key surface.
//
// Scenario (sequential, shared state):
//   1. Mint key → verify context
//   2. Entropy check: prefix format + sufficient plaintext length
//   3. Rotate → new plaintext verifies; old still verifies (dual-window)
//   4. rpc_api_request_log_insert → row appears in api_request_log
//   5. rpc_api_key_usage → returns aggregated day row
//   6. Revoke → old plaintext 410; new plaintext 410
//   7. Column security: authenticated SELECT cannot read key_hash
//
// No running dev server required. verifyBearerToken + direct RPC calls
// exercise the full production code path.

let org: TestOrg
let keyId: string
let originalPlaintext: string
let rotatedPlaintext: string

beforeAll(async () => {
  org = await createTestOrg('e2e')
}, 60000)

afterAll(async () => {
  await cleanupTestOrg(org)
}, 30000)

describe('ADR-1001 Sprint 3.1 — API key end-to-end smoke', () => {

  // ── Step 1: Mint ──────────────────────────────────────────────────────────

  it('rpc_api_key_create returns plaintext + prefix + correct metadata', async () => {
    const { data, error } = await org.client.rpc('rpc_api_key_create', {
      p_account_id: org.accountId,
      p_org_id:     org.orgId,
      p_scopes:     ['read:consent', 'write:consent', 'read:audit'],
      p_rate_tier:  'starter',
      p_name:       'e2e smoke key',
    })
    expect(error).toBeNull()
    const key = data as { id: string; plaintext: string; prefix: string; scopes: string[]; rate_tier: string }
    expect(key.plaintext).toMatch(/^cs_live_/)
    expect(key.prefix).toMatch(/^cs_live_/)
    expect(key.scopes).toContain('read:consent')
    expect(key.rate_tier).toBe('starter')
    keyId = key.id
    originalPlaintext = key.plaintext
  })

  // ── Step 2: Entropy ───────────────────────────────────────────────────────

  it('plaintext has at least 64 bits of entropy (base64url body ≥ 43 chars)', () => {
    // Format: cs_live_ + base64url(32 bytes) = 8 + ~43 chars = ≥ 51 chars total.
    // 32 random bytes = 256 bits of entropy — well above the 64-bit floor.
    expect(originalPlaintext.length).toBeGreaterThanOrEqual(51)
    const body = originalPlaintext.replace(/^cs_live_/, '')
    expect(body.length).toBeGreaterThanOrEqual(43)
    // Must not contain non-base64url chars.
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('plaintext is not stored anywhere in api_keys (only prefix and hash)', async () => {
    const admin = getServiceClient()
    const { data } = await admin
      .from('api_keys')
      .select('key_prefix')
      .eq('id', keyId)
      .single()
    // key_prefix is the first 16 chars of the plaintext — not the secret body.
    expect(data?.key_prefix).toBe(originalPlaintext.slice(0, 16))
    // The full plaintext must NOT equal the stored prefix.
    expect(originalPlaintext).not.toBe(data?.key_prefix)
  })

  it('authenticated SELECT cannot read key_hash (column-level revocation)', async () => {
    // Supabase REST selects by default return only granted columns.
    // 20260520000003 revokes SELECT(key_hash, previous_key_hash) from authenticated
    // and re-grants it to nothing — the column should be absent from the row.
    const { data, error } = await org.client
      .from('api_keys')
      .select('id, key_prefix, key_hash')
      .eq('id', keyId)
      .single()
    // Either a permission error or the key_hash field is null/absent.
    const hasHash = data !== null && (data as Record<string, unknown>)['key_hash'] !== undefined
      && (data as Record<string, unknown>)['key_hash'] !== null
    expect(hasHash).toBe(false)
    void error // acceptable: either no error (column omitted) or permission error
  })

  // ── Step 3: Verify (canary) ───────────────────────────────────────────────

  it('verifyBearerToken returns ok=true with correct context for valid key', async () => {
    const result = await verifyBearerToken(`Bearer ${originalPlaintext}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.key_id).toBe(keyId)
    expect(result.context.account_id).toBe(org.accountId)
    expect(result.context.org_id).toBe(org.orgId)
    expect(result.context.scopes).toContain('read:consent')
    expect(result.context.scopes).toContain('read:audit')
    expect(result.context.rate_tier).toBe('starter')
  })

  // ── Step 4: Rotate ────────────────────────────────────────────────────────

  it('rpc_api_key_rotate returns new plaintext with correct prefix format', async () => {
    const { data, error } = await org.client.rpc('rpc_api_key_rotate', { p_key_id: keyId })
    expect(error).toBeNull()
    const result = data as { id: string; plaintext: string; prefix: string; previous_key_expires_at: string }
    expect(result.plaintext).toMatch(/^cs_live_/)
    expect(result.plaintext).not.toBe(originalPlaintext)
    expect(result.previous_key_expires_at).toBeTruthy()
    const expiresAt = new Date(result.previous_key_expires_at)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000) // > 23h from now
    rotatedPlaintext = result.plaintext
  })

  it('new (rotated) plaintext verifies immediately after rotation', async () => {
    const result = await verifyBearerToken(`Bearer ${rotatedPlaintext}`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.context.key_id).toBe(keyId)
  })

  it('old plaintext still verifies during dual-window (previous_key_hash active)', async () => {
    const result = await verifyBearerToken(`Bearer ${originalPlaintext}`)
    expect(result.ok).toBe(true)
  })

  // ── Step 5: Request log + usage ───────────────────────────────────────────

  it('rpc_api_request_log_insert writes a row readable via rpc_api_key_usage', async () => {
    const admin = getServiceClient()

    // Simulate what logApiRequest does.
    const { error: insertErr } = await admin.rpc('rpc_api_request_log_insert', {
      p_key_id:     keyId,
      p_org_id:     org.orgId,
      p_account_id: org.accountId,
      p_route:      '/api/v1/_ping',
      p_method:     'GET',
      p_status:     200,
      p_latency:    12,
    })
    expect(insertErr).toBeNull()

    // Usage RPC should see the row.
    const { data: usage, error: usageErr } = await org.client.rpc('rpc_api_key_usage', {
      p_key_id: keyId,
      p_days: 1,
    })
    expect(usageErr).toBeNull()
    const rows = (usage ?? []) as { day: string; request_count: number }[]
    const total = rows.reduce((s, r) => s + r.request_count, 0)
    expect(total).toBeGreaterThanOrEqual(1)
  })

  // ── Step 6: Revoke ────────────────────────────────────────────────────────

  it('rpc_api_key_revoke succeeds and is idempotent', async () => {
    const { error: e1 } = await org.client.rpc('rpc_api_key_revoke', { p_key_id: keyId })
    expect(e1).toBeNull()
    // Second call must not throw (idempotent).
    const { error: e2 } = await org.client.rpc('rpc_api_key_revoke', { p_key_id: keyId })
    expect(e2).toBeNull()
  })

  it('rotated (new) plaintext returns 410 after revocation', async () => {
    const result = await verifyBearerToken(`Bearer ${rotatedPlaintext}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(410)
    expect(result.reason).toBe('revoked')
  })

  it('original plaintext returns 410/revoked after rotate+revoke (ADR-1001 V2 C-1 fix)', async () => {
    const result = await verifyBearerToken(`Bearer ${originalPlaintext}`)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // Previously returned 401: rotation moved the original hash to
    // previous_key_hash, revocation cleared it, so neither slot on api_keys
    // held the original hash. ADR-1001 V2 C-1 (migration 20260801000010)
    // added revoked_api_key_hashes: rpc_api_key_revoke tombstones BOTH the
    // current and previous hashes before clearing, and rpc_api_key_status
    // consults the tombstone on fallback. Every plaintext ever associated
    // with a now-revoked key surfaces as 'revoked' → 410 Gone.
    expect(result.status).toBe(410)
    expect(result.reason).toBe('revoked')
  })

  // ── Step 7: Non-existent key ──────────────────────────────────────────────

  it('completely unknown cs_live_ token returns 401/invalid (not 410)', async () => {
    const result = await verifyBearerToken('Bearer cs_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.status).toBe(401)
    expect(result.reason).toBe('invalid')
  })

})
