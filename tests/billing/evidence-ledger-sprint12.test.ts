import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0051 Sprint 1.2 — additional capture-point triggers:
//   · public.accounts INSERT → customer_signup
//   · public.rights_requests UPDATE (email_verified null→ts) → rights_request_filed
//   · public.consent_banners UPDATE (is_active false→true) → banner_published

let operator: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

beforeAll(async () => {
  operator = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('evidSprint12')
}, 60000)

afterAll(async () => {
  await service.from('evidence_ledger').delete().eq('account_id', customer.accountId)
  await cleanupTestOrg(customer)
  await cleanupAdminTestUser(operator)
}, 30000)

async function readLedgerViaRpc() {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_evidence_ledger_for_account', {
      p_account_id: customer.accountId,
      p_from: null,
      p_to: null,
      p_limit: 500,
    })
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{
    event_type: string
    event_source: string
    source_ref: string | null
    metadata: Record<string, unknown>
  }>
}

describe('ADR-0051 Sprint 1.2 — customer_signup trigger', () => {
  it('account creation writes a customer_signup ledger row', async () => {
    const rows = await readLedgerViaRpc()
    const signupRow = rows.find(
      r => r.event_type === 'customer_signup' && r.source_ref === customer.accountId,
    )
    expect(signupRow).toBeTruthy()
    expect(signupRow!.event_source).toBe('account_trigger')
    expect(signupRow!.metadata.plan_code).toBeDefined()
  })
})

describe('ADR-0051 Sprint 1.2 — rights_request_filed trigger', () => {
  it('email_verified_at null→ts writes a rights_request_filed ledger row', async () => {
    // Insert a rights request directly via service (bypasses Turnstile + OTP).
    const { data: rr } = await service
      .from('rights_requests')
      .insert({
        org_id: customer.orgId,
        request_type: 'erasure',
        requestor_name: 'Test Requestor',
        requestor_email: 'requestor@test.example',
        turnstile_verified: true,
      })
      .select('id')
      .single()
    const requestId = rr!.id as string

    // Not yet verified — no ledger row yet
    let rows = await readLedgerViaRpc()
    expect(rows.find(r => r.source_ref === requestId)).toBeUndefined()

    // Flip email_verified_at
    await service
      .from('rights_requests')
      .update({ email_verified_at: new Date().toISOString(), email_verified: true })
      .eq('id', requestId)

    rows = await readLedgerViaRpc()
    const row = rows.find(
      r => r.event_type === 'rights_request_filed' && r.source_ref === requestId,
    )
    expect(row).toBeTruthy()
    expect(row!.event_source).toBe('rights_request_trigger')
    expect(row!.metadata.request_type).toBe('erasure')
    // Rule 3 check: requestor email is NOT in the metadata
    const md = row!.metadata as Record<string, unknown>
    expect(md.requestor_email).toBeUndefined()
    expect(md.requestor_name).toBeUndefined()

    // Cleanup
    await service.from('rights_requests').delete().eq('id', requestId)
  })
})

describe('ADR-0051 Sprint 1.2 — banner_published trigger', () => {
  it('consent_banners is_active false→true writes a banner_published ledger row', async () => {
    // Seed a web property + banner as inactive, then flip is_active=true
    const { data: prop } = await service
      .from('web_properties')
      .insert({ org_id: customer.orgId, name: 'Sprint 1.2 test property A', url: 'https://evid-sprint12-testA.example' })
      .select('id')
      .single()
    const propertyId = prop!.id as string

    const { data: banner } = await service
      .from('consent_banners')
      .insert({
        org_id: customer.orgId,
        property_id: propertyId,
        version: 1,
        is_active: false,
        headline: 'We use cookies',
        body_copy: 'Test body',
        position: 'bottom-bar',
      })
      .select('id')
      .single()
    const bannerId = banner!.id as string

    // No row yet
    let rows = await readLedgerViaRpc()
    expect(rows.find(r => r.source_ref === bannerId)).toBeUndefined()

    // Flip is_active
    await service.from('consent_banners').update({ is_active: true }).eq('id', bannerId)

    rows = await readLedgerViaRpc()
    const row = rows.find(
      r => r.event_type === 'banner_published' && r.source_ref === bannerId,
    )
    expect(row).toBeTruthy()
    expect(row!.event_source).toBe('banner_trigger')
    expect(row!.metadata.version).toBe(1)

    // Cleanup
    await service.from('consent_banners').delete().eq('id', bannerId)
    await service.from('web_properties').delete().eq('id', propertyId)
  })

  it('does not fire when is_active stays true (e.g. unrelated field update)', async () => {
    const { data: prop } = await service
      .from('web_properties')
      .insert({ org_id: customer.orgId, name: 'Sprint 1.2 test property B', url: 'https://evid-sprint12-testB.example' })
      .select('id')
      .single()
    const propertyId = prop!.id as string

    const { data: banner } = await service
      .from('consent_banners')
      .insert({
        org_id: customer.orgId,
        property_id: propertyId,
        version: 1,
        is_active: true,
        headline: 'Already live',
        body_copy: 'Test body',
        position: 'bottom-bar',
      })
      .select('id')
      .single()
    const bannerId = banner!.id as string

    // Unrelated UPDATE (no is_active transition)
    await service.from('consent_banners').update({ headline: 'Edited headline' }).eq('id', bannerId)

    const rows = await readLedgerViaRpc()
    expect(rows.find(r => r.source_ref === bannerId)).toBeUndefined()

    await service.from('consent_banners').delete().eq('id', bannerId)
    await service.from('web_properties').delete().eq('id', propertyId)
  })
})
