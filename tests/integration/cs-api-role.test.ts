// ADR-1009 Phase 2 Sprint 2.1 — cs_api direct-Postgres role smoke tests.
//
// Skips gracefully when SUPABASE_CS_API_DATABASE_URL is not set (pre-env
// setup). When set, validates:
//   1. cs_api can call rpc_api_key_verify on a seeded key and get context.
//   2. cs_api can call rpc_api_key_status and get the correct lifecycle state.
//   3. cs_api CANNOT select from any tenant table (api_keys, consent_events,
//      organisations) — permission denied. This is the minimum-privilege
//      guarantee the whole ADR rests on.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { createHash, randomBytes } from 'node:crypto'
import {
  createTestOrg,
  cleanupTestOrg,
  seedApiKey,
  getServiceClient,
  type TestOrg,
} from '../rls/helpers'

const CS_API_URL = process.env.SUPABASE_CS_API_DATABASE_URL

const describeIf = CS_API_URL ? describe : describe.skip

describeIf('cs_api direct-Postgres role — ADR-1009 Phase 2', () => {
  let org: TestOrg
  let plaintext: string
  let keyId: string
  let revokedKeyId: string
  let revokedPlaintext: string
  let sql: ReturnType<typeof postgres>

  beforeAll(async () => {
    sql = postgres(CS_API_URL!, {
      prepare:         false,
      max:             2,
      idle_timeout:    5,
      connect_timeout: 10,
      ssl:             'require',
    })

    org = await createTestOrg('csApi')
    const seeded = await seedApiKey(org)
    keyId = seeded.keyId

    // Insert a plaintext + hash pair directly so rpc_api_key_verify can resolve.
    plaintext = `cs_live_${randomBytes(24).toString('base64url')}`
    const hash = createHash('sha256').update(plaintext, 'utf8').digest('hex')
    const admin = getServiceClient()
    await admin.from('api_keys').update({ key_hash: hash }).eq('id', keyId)

    // Seed a second key, then revoke it, for the 'revoked' status branch.
    const revoked = await seedApiKey(org)
    revokedKeyId = revoked.keyId
    revokedPlaintext = `cs_live_${randomBytes(24).toString('base64url')}`
    const revokedHash = createHash('sha256').update(revokedPlaintext, 'utf8').digest('hex')
    await admin
      .from('api_keys')
      .update({ key_hash: revokedHash, revoked_at: new Date().toISOString() })
      .eq('id', revokedKeyId)
  }, 60_000)

  afterAll(async () => {
    await sql.end({ timeout: 5 })
    await cleanupTestOrg(org)
  }, 30_000)

  it('rpc_api_key_verify as cs_api returns the seeded context', async () => {
    const rows = await sql<Array<{ rpc_api_key_verify: Record<string, unknown> | null }>>`
      select rpc_api_key_verify(${plaintext}::text) as rpc_api_key_verify
    `
    expect(rows).toHaveLength(1)
    const envelope = rows[0].rpc_api_key_verify
    expect(envelope).not.toBeNull()
    expect(envelope!.id).toBe(keyId)
    expect(envelope!.account_id).toBe(org.accountId)
    expect(envelope!.org_id).toBe(org.orgId)
  })

  it('rpc_api_key_status returns active | revoked | not_found correctly', async () => {
    const active = await sql`select rpc_api_key_status(${plaintext}::text) as status`
    expect(active[0].status).toBe('active')

    const revoked = await sql`select rpc_api_key_status(${revokedPlaintext}::text) as status`
    expect(revoked[0].status).toBe('revoked')

    const missing = await sql`select rpc_api_key_status('cs_live_not_a_real_key'::text) as status`
    expect(missing[0].status).toBe('not_found')
  })

  it('cs_api has no direct table privileges — api_keys SELECT is denied', async () => {
    await expect(
      sql`select id from api_keys where id = ${keyId}`,
    ).rejects.toThrow(/permission denied/i)
  })

  it('cs_api cannot SELECT consent_events or organisations (min-privilege)', async () => {
    await expect(
      sql`select 1 from consent_events limit 1`,
    ).rejects.toThrow(/permission denied/i)
    await expect(
      sql`select 1 from organisations limit 1`,
    ).rejects.toThrow(/permission denied/i)
  })

  it('cs_api can execute v1 RPCs (past Sprint 2.2 grant flip)', async () => {
    // rpc_consent_verify should now be callable. The fence lets us through
    // (keyId is bound to org), and then property_not_found fires because the
    // property UUID is bogus — proving cs_api got past the grant check AND
    // the ADR-1009 fence check.
    await expect(
      sql`select rpc_consent_verify(
        ${keyId}::uuid, ${org.orgId}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'user@example.com', 'email', 'marketing'
      )`,
    ).rejects.toThrow(/property_not_found/i)
  })

  it('service_role is NO LONGER granted EXECUTE on v1 RPCs (ADR-1009 Sprint 2.4)', async () => {
    // Call rpc_consent_verify through the Supabase REST service-role client.
    // Before Sprint 2.4: succeeds (service_role had EXECUTE). After: permission
    // denied / 42501. This is the canary that proves the service-role fallback
    // is gone — any accidental reintroduction of SUPABASE_SERVICE_ROLE_KEY
    // into the v1 path fails loudly instead of silently.
    const admin = getServiceClient()
    const { error } = await admin.rpc('rpc_consent_verify', {
      p_key_id:          keyId,
      p_org_id:          org.orgId,
      p_property_id:     '00000000-0000-0000-0000-000000000000',
      p_identifier:      'svc@example.com',
      p_identifier_type: 'email',
      p_purpose_code:    'marketing',
    })
    expect(error).not.toBeNull()
    const msg = (error?.message ?? '') + (error?.code ?? '')
    expect(msg).toMatch(/permission denied|42501/i)
  })

  it('cs_api blocked on v1 RPC with wrong keyId — fence fires, not grant', async () => {
    // With a made-up key_id, assert_api_key_binding raises 'api_key_not_found'
    // (errcode 42501). Confirms the fence still bites even when the grant lets
    // us execute the outer function.
    await expect(
      sql`select rpc_consent_verify(
        '00000000-0000-0000-0000-000000000001'::uuid, ${org.orgId}::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'user@example.com', 'email', 'marketing'
      )`,
    ).rejects.toThrow(/api_key_not_found/i)
  })
})
