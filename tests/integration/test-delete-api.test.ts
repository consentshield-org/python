import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { triggerTestDelete } from '../../app/src/lib/consent/test-delete'
import {
  cleanupTestOrg,
  createTestOrg,
  getServiceClient,
  seedApiKey,
  type TestOrg,
} from '../rls/helpers'

// ADR-1005 Phase 2 Sprint 2.1 — test_delete integration tests.
//
// Covers:
//   * happy path: test receipt created with trigger_type='test_delete',
//     request_payload.is_test=true, artefact_id null.
//   * connector cross-org fence → connector_not_found.
//   * inactive connector → connector_inactive.
//   * rate limit — 11th call inside the 1-hour window → rate_limit_exceeded.
//   * unknown connector id → connector_not_found.
//   * api_key from a different org for the caller's connector → binding error.

const admin = getServiceClient()

let orgA: TestOrg
let orgB: TestOrg
let keyA: string
let keyB: string
let activeConnector: string
let inactiveConnector: string
let otherOrgConnector: string

async function seedConnector(orgId: string, opts: { active?: boolean; type?: string } = {}) {
  const { data, error } = await admin
    .from('integration_connectors')
    .insert({
      org_id:         orgId,
      connector_type: opts.type ?? 'test_echo',
      display_name:   `test_delete fixture ${Date.now()}`,
      status:         opts.active === false ? 'disabled' : 'active',
      config:         '\\x7b7d',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`seedConnector failed: ${error?.message}`)
  return data.id as string
}

beforeAll(async () => {
  orgA = await createTestOrg('tdA')
  orgB = await createTestOrg('tdB')
  keyA = (await seedApiKey(orgA)).keyId
  keyB = (await seedApiKey(orgB)).keyId
  activeConnector   = await seedConnector(orgA.orgId)
  inactiveConnector = await seedConnector(orgA.orgId, { active: false })
  otherOrgConnector = await seedConnector(orgB.orgId)
})

afterAll(async () => {
  await admin
    .from('deletion_receipts')
    .delete()
    .in('connector_id', [activeConnector, inactiveConnector, otherOrgConnector])
  if (orgA) await cleanupTestOrg(orgA)
  if (orgB) await cleanupTestOrg(orgB)
})

describe('ADR-1005 Phase 2 Sprint 2.1 — POST /v1/integrations/{connector_id}/test_delete', () => {
  it('creates a test deletion receipt with is_test=true + synthetic principal', async () => {
    const res = await triggerTestDelete({
      keyId:       keyA,
      orgId:       orgA.orgId,
      connectorId: activeConnector,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const env = res.data
    expect(env.reason).toBe('test')
    expect(env.status).toBe('pending')
    expect(env.connector_id).toBe(activeConnector)
    expect(env.data_principal_identifier).toMatch(/^cs_test_principal_[0-9a-f-]+$/)
    expect(env.receipt_id).toMatch(/^[0-9a-f-]{36}$/)

    // Verify the row landed with the expected shape.
    const { data: row } = await admin
      .from('deletion_receipts')
      .select('trigger_type, connector_id, request_payload, status, trigger_id, artefact_id')
      .eq('id', env.receipt_id)
      .single()
    expect(row).not.toBeNull()
    expect((row as { trigger_type: string }).trigger_type).toBe('test_delete')
    expect((row as { status: string }).status).toBe('pending')
    expect((row as { trigger_id: string | null }).trigger_id).toBeNull()
    expect((row as { artefact_id: string | null }).artefact_id).toBeNull()
    const payload = (row as { request_payload: Record<string, unknown> }).request_payload
    expect(payload.is_test).toBe(true)
    expect(payload.reason).toBe('test')
    expect(payload.data_principal_identifier).toBe(env.data_principal_identifier)
  })

  it('refuses a connector that belongs to another org (cross-org fence)', async () => {
    const res = await triggerTestDelete({
      keyId:       keyA,
      orgId:       orgA.orgId,
      connectorId: otherOrgConnector,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('connector_not_found')
  })

  it('refuses an inactive connector', async () => {
    const res = await triggerTestDelete({
      keyId:       keyA,
      orgId:       orgA.orgId,
      connectorId: inactiveConnector,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('connector_inactive')
  })

  it('refuses an unknown connector id', async () => {
    const res = await triggerTestDelete({
      keyId:       keyA,
      orgId:       orgA.orgId,
      connectorId: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('connector_not_found')
  })

  it('refuses a key that does not match org_id (binding fence)', async () => {
    const res = await triggerTestDelete({
      keyId:       keyB,
      orgId:       orgA.orgId,
      connectorId: activeConnector,
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('api_key_binding')
  })

  it('rate-limits to 10 per connector per hour; 11th returns rate_limit_exceeded', async () => {
    // We already issued 1 call in the happy-path test, so issue 9 more to
    // reach the cap. Use a dedicated connector so the cap is not polluted
    // by other tests.
    const cap = await seedConnector(orgA.orgId, { type: 'rate_limit_fixture' })
    for (let i = 0; i < 10; i++) {
      const ok = await triggerTestDelete({
        keyId:       keyA,
        orgId:       orgA.orgId,
        connectorId: cap,
      })
      expect(ok.ok).toBe(true)
    }
    const capped = await triggerTestDelete({
      keyId:       keyA,
      orgId:       orgA.orgId,
      connectorId: cap,
    })
    expect(capped.ok).toBe(false)
    if (capped.ok) return
    expect(capped.error.kind).toBe('rate_limit_exceeded')

    // Cleanup the 10 receipts for this connector.
    await admin.from('deletion_receipts').delete().eq('connector_id', cap)
    await admin.from('integration_connectors').delete().eq('id', cap)
  })
})
