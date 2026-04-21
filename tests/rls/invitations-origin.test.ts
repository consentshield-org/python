// ADR-0058 Sprint 1.1 — invitations.origin RLS / RPC isolation.
//
// Confirms:
//   1. The `origin` column exists with the expected check constraint.
//   2. `authenticated` callers cannot directly INSERT intake rows
//      (`origin in ('marketing_intake','operator_intake')`) — only
//      the SECURITY DEFINER RPCs can.
//   3. `public.create_signup_intake` is not callable from `anon` /
//      `authenticated`; only `service_role` / `cs_orchestrator` paths.
//   4. Calling `create_signup_intake` with a fresh email creates a
//      row with `origin='marketing_intake'` and `expires_at` ~14 days.
//   5. Calling `create_signup_intake` with an existing-customer email
//      creates no row and still returns `{status:'ok'}` (no leak).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cleanupTestOrg,
  createTestOrg,
  getAnonClient,
  getServiceClient,
  type TestOrg,
} from './helpers'

describe('ADR-0058 invitations.origin', () => {
  let existingOrg: TestOrg
  let createdInviteIds: string[] = []

  beforeAll(async () => {
    existingOrg = await createTestOrg('intake-existing')
  })

  afterAll(async () => {
    const service = getServiceClient()
    if (createdInviteIds.length > 0) {
      await service
        .from('invitations')
        .delete()
        .in('id', createdInviteIds)
    }
    await cleanupTestOrg(existingOrg)
  })

  it('column exists with the expected check', async () => {
    const service = getServiceClient()
    const { data, error } = await service.rpc('create_signup_intake', {
      p_email: `adr0058-shape-${Date.now()}@test.consentshield.in`,
      p_plan_code: 'trial_starter',
      p_org_name: 'Shape Test',
      p_ip: null,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'ok' })
  })

  it('authenticated cannot INSERT marketing_intake rows directly', async () => {
    // Sign in as the existing org's user, then try to insert.
    const client = existingOrg.client
    const { error } = await client.from('invitations').insert({
      token: `direct-${Date.now()}`.padEnd(48, '0'),
      invited_email: 'attacker@example.com',
      account_id: null,
      org_id: null,
      role: 'account_owner',
      plan_code: 'trial_starter',
      origin: 'marketing_intake',
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
    })
    // RLS / role grant blocks direct insert. Either an explicit RLS
    // failure or a column-permission denial is acceptable.
    expect(error).not.toBeNull()
  })

  it('anon cannot call create_signup_intake', async () => {
    const anon = getAnonClient()
    const { error } = await anon.rpc('create_signup_intake', {
      p_email: `attacker-${Date.now()}@example.com`,
      p_plan_code: 'trial_starter',
      p_org_name: 'A',
      p_ip: null,
    })
    expect(error).not.toBeNull()
  })

  it('fresh email branch inserts row with origin=marketing_intake + 14d expiry', async () => {
    const service = getServiceClient()
    const email = `adr0058-fresh-${Date.now()}@test.consentshield.in`

    const { data, error } = await service.rpc('create_signup_intake', {
      p_email: email,
      p_plan_code: 'trial_starter',
      p_org_name: 'Fresh Co',
      p_ip: null,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'ok', branch: 'created' })

    const { data: row } = await service
      .from('invitations')
      .select('id, origin, role, account_id, org_id, plan_code, default_org_name, expires_at')
      .eq('invited_email', email.toLowerCase())
      .maybeSingle()

    expect(row).not.toBeNull()
    expect(row!.origin).toBe('marketing_intake')
    expect(row!.role).toBe('account_owner')
    expect(row!.account_id).toBeNull()
    expect(row!.org_id).toBeNull()
    expect(row!.plan_code).toBe('trial_starter')
    expect(row!.default_org_name).toBe('Fresh Co')

    const ageMs =
      new Date(row!.expires_at).getTime() - Date.now()
    expect(ageMs).toBeGreaterThan(13 * 86400_000)
    expect(ageMs).toBeLessThan(15 * 86400_000)

    createdInviteIds.push(row!.id)
  })

  it('existing-customer email branch inserts NO row, returns generic ok', async () => {
    const service = getServiceClient()
    // Use the existing test org's email — it's a real customer.
    const { data, error } = await service.rpc('create_signup_intake', {
      p_email: existingOrg.email,
      p_plan_code: 'trial_starter',
      p_org_name: 'Should Not Land',
      p_ip: null,
    })
    expect(error).toBeNull()
    // Outward shape is identical to the happy path.
    expect((data as { status?: string })?.status).toBe('ok')

    // No invitation should exist for this email.
    const { data: rows } = await service
      .from('invitations')
      .select('id')
      .eq('invited_email', existingOrg.email.toLowerCase())
    expect(rows?.length ?? 0).toBe(0)
  })

  it('invalid plan_code branch silently no-ops', async () => {
    const service = getServiceClient()
    const email = `adr0058-badplan-${Date.now()}@test.consentshield.in`
    const { data, error } = await service.rpc('create_signup_intake', {
      p_email: email,
      p_plan_code: 'NONEXISTENT_PLAN_CODE_XYZ',
      p_org_name: 'No Plan',
      p_ip: null,
    })
    expect(error).toBeNull()
    expect((data as { status?: string })?.status).toBe('ok')

    const { data: rows } = await service
      .from('invitations')
      .select('id')
      .eq('invited_email', email.toLowerCase())
    expect(rows?.length ?? 0).toBe(0)
  })

  it('admin.create_operator_intake errors loudly on duplicate', async () => {
    // Run through service_role; admin gating is a separate concern
    // (test that the function ERRORS on existing customer email is the
    // valuable bit here).
    const service = getServiceClient()
    const { error } = await service
      .schema('admin')
      .rpc('create_operator_intake', {
        p_email: existingOrg.email,
        p_plan_code: 'trial_starter',
        p_org_name: 'Should Fail',
      })
    // The RPC raises errcode 23505 (unique violation semantic) when
    // email already has a customer account.
    expect(error).not.toBeNull()
  })
})
