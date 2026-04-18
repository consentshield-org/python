import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0047 Sprint 1.1 — single-account-per-identity invariant.
// Enforced at three points:
//   * public.create_invitation
//   * public.create_invitation_from_marketing
//   * public.accept_invitation

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function service(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY)
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  await c.auth.refreshSession()
  return c
}

async function createUser(suffix: string, password = 'TestPass!1234'): Promise<{ userId: string; email: string }> {
  const email = `adr0047-inv-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.consentshield.in`
  const { data, error } = await service().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  return { userId: data.user.id, email }
}

describe('ADR-0047 Sprint 1.1 — single-account-per-identity invariant', () => {
  let acctA: TestOrg
  let acctB: TestOrg

  beforeAll(async () => {
    acctA = await createTestOrg('adr47-inv-A')
    acctB = await createTestOrg('adr47-inv-B')
  }, 120000)

  afterAll(async () => {
    await cleanupTestOrg(acctA)
    await cleanupTestOrg(acctB)
  }, 60000)

  it('create_invitation refuses if email already has account_memberships elsewhere', async () => {
    const joe = await createUser('joe')
    try {
      // Seed joe as a member of account A.
      await service()
        .from('account_memberships')
        .insert({ account_id: acctA.accountId, user_id: joe.userId, role: 'account_viewer', accepted_at: new Date().toISOString() })

      // Account B tries to invite joe as account_viewer — must be refused.
      const { error } = await acctB.client.rpc('create_invitation', {
        p_email: joe.email,
        p_role: 'account_viewer',
        p_account_id: acctB.accountId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/single-account-per-identity/i)
      expect(error?.message).toContain(acctA.accountId)
    } finally {
      await service().auth.admin.deleteUser(joe.userId)
    }
  })

  it('create_invitation_from_marketing refuses if email already has account_memberships', async () => {
    const jane = await createUser('jane')
    try {
      await service()
        .from('account_memberships')
        .insert({ account_id: acctA.accountId, user_id: jane.userId, role: 'account_viewer', accepted_at: new Date().toISOString() })

      const { error } = await service().rpc('create_invitation_from_marketing', {
        p_email: jane.email,
        p_plan_code: 'trial_starter',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/single-account-per-identity/i)
    } finally {
      await service().auth.admin.deleteUser(jane.userId)
    }
  })

  it('accept_invitation detects accept-time conflict even if create_invitation passed', async () => {
    // 1. Sign up user X, invite them to acct B (legit).
    const password = 'RacePass!1234'
    const x = await createUser('race', password)
    try {
      const { data: inv, error: createErr } = await acctB.client.rpc('create_invitation', {
        p_email: x.email,
        p_role: 'account_viewer',
        p_account_id: acctB.accountId,
      })
      expect(createErr).toBeNull()
      const token = (inv as Array<{ token: string }>)[0].token

      // 2. Meanwhile, admin-side adds X to acct A (simulating a race).
      await service()
        .from('account_memberships')
        .insert({ account_id: acctA.accountId, user_id: x.userId, role: 'account_viewer', accepted_at: new Date().toISOString() })

      // 3. X signs in and tries to accept — must be refused.
      const xClient = await signInAs(x.email, password)
      const { error: acceptErr } = await xClient.rpc('accept_invitation', { p_token: token })
      expect(acceptErr).not.toBeNull()
      expect(acceptErr?.message).toMatch(/single-account-per-identity/i)
    } finally {
      await service().auth.admin.deleteUser(x.userId)
    }
  })

  it('org-tier invite into account B for an email already in account A is refused', async () => {
    const mia = await createUser('mia')
    try {
      await service()
        .from('account_memberships')
        .insert({ account_id: acctA.accountId, user_id: mia.userId, role: 'account_viewer', accepted_at: new Date().toISOString() })

      const { error } = await acctB.client.rpc('create_invitation', {
        p_email: mia.email,
        p_role: 'viewer',
        p_account_id: acctB.accountId,
        p_org_id: acctB.orgId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/single-account-per-identity/i)
    } finally {
      await service().auth.admin.deleteUser(mia.userId)
    }
  })

  it('after remove_membership on account A, re-invite to account B is accepted', async () => {
    const password = 'RePass!1234'
    const ted = await createUser('ted', password)
    try {
      // Seed ted on account A.
      await service()
        .from('account_memberships')
        .insert({ account_id: acctA.accountId, user_id: ted.userId, role: 'account_viewer', accepted_at: new Date().toISOString() })

      // Remove via acctA's account_owner.
      const { error: removeErr } = await acctA.client.rpc('remove_membership', {
        p_user_id: ted.userId,
        p_scope: 'account',
        p_org_id: null,
        p_reason: 'offboarding for re-invite test',
      })
      expect(removeErr).toBeNull()

      // Now account B can invite him.
      const { data: inv, error: createErr } = await acctB.client.rpc('create_invitation', {
        p_email: ted.email,
        p_role: 'account_viewer',
        p_account_id: acctB.accountId,
      })
      expect(createErr).toBeNull()
      const token = (inv as Array<{ token: string }>)[0].token

      // And he can accept.
      const tedClient = await signInAs(ted.email, password)
      const { error: acceptErr } = await tedClient.rpc('accept_invitation', { p_token: token })
      expect(acceptErr).toBeNull()

      const { data: memb } = await service()
        .from('account_memberships')
        .select('account_id, role')
        .eq('user_id', ted.userId)
      expect(memb ?? []).toEqual([
        expect.objectContaining({ account_id: acctB.accountId, role: 'account_viewer' }),
      ])
    } finally {
      await service().auth.admin.deleteUser(ted.userId)
    }
  })
})
