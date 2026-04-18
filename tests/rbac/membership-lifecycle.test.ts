import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0047 Sprint 1.1 — change_membership_role + remove_membership.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

interface SecondaryUser {
  userId: string
  email: string
  client: SupabaseClient
}

async function createUser(suffix: string): Promise<SecondaryUser> {
  const email = `adr0047-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.consentshield.in`
  const password = `TestPass!${Date.now()}`
  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createUser failed: ${error.message}`)
  const userId = data.user.id

  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`)
  await client.auth.refreshSession()
  return { userId, email, client }
}

async function cleanupUser(userId: string) {
  await serviceClient().auth.admin.deleteUser(userId)
}

async function seedAccountMembership(
  accountId: string,
  userId: string,
  role: 'account_owner' | 'account_viewer',
) {
  const { error } = await serviceClient()
    .from('account_memberships')
    .insert({ account_id: accountId, user_id: userId, role, accepted_at: new Date().toISOString() })
  if (error) throw new Error(`seedAccountMembership failed: ${error.message}`)
}

async function seedOrgMembership(
  orgId: string,
  userId: string,
  role: 'org_admin' | 'admin' | 'viewer',
) {
  const { error } = await serviceClient()
    .from('org_memberships')
    .insert({ org_id: orgId, user_id: userId, role })
  if (error) throw new Error(`seedOrgMembership failed: ${error.message}`)
}

describe('ADR-0047 Sprint 1.1 — change_membership_role', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('adr47-change')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  it('account_owner can change account_viewer → account_owner; audit row written', async () => {
    const target = await createUser('c1')
    try {
      await seedAccountMembership(owner.accountId, target.userId, 'account_viewer')

      const { error } = await owner.client.rpc('change_membership_role', {
        p_user_id: target.userId,
        p_scope: 'account',
        p_org_id: null,
        p_new_role: 'account_owner',
        p_reason: 'promote to co-owner',
      })
      expect(error).toBeNull()

      const { data } = await serviceClient()
        .from('account_memberships')
        .select('role')
        .eq('account_id', owner.accountId)
        .eq('user_id', target.userId)
        .single()
      expect(data?.role).toBe('account_owner')

      const { data: audit } = await serviceClient()
        .from('membership_audit_log')
        .select('action, old_value, new_value, reason')
        .eq('target_user_id', target.userId)
        .eq('action', 'membership_role_change')
        .limit(1)
        .single()
      expect(audit?.old_value).toMatchObject({ scope: 'account', role: 'account_viewer' })
      expect(audit?.new_value).toMatchObject({ scope: 'account', role: 'account_owner' })
      expect(audit?.reason).toBe('promote to co-owner')
    } finally {
      await cleanupUser(target.userId)
    }
  })

  it('org_admin can change an admin-tier member within their org', async () => {
    const target = await createUser('c2')
    try {
      await seedOrgMembership(owner.orgId, target.userId, 'admin')
      // owner.client is an account_owner; they already pass the gate.
      const { error } = await owner.client.rpc('change_membership_role', {
        p_user_id: target.userId,
        p_scope: 'org',
        p_org_id: owner.orgId,
        p_new_role: 'viewer',
        p_reason: 'downgrade per request',
      })
      expect(error).toBeNull()
      const { data } = await serviceClient()
        .from('org_memberships')
        .select('role')
        .eq('org_id', owner.orgId)
        .eq('user_id', target.userId)
        .single()
      expect(data?.role).toBe('viewer')
    } finally {
      await cleanupUser(target.userId)
    }
  })

  it('account_owner cannot change own role', async () => {
    const { error } = await owner.client.rpc('change_membership_role', {
      p_user_id: owner.userId,
      p_scope: 'account',
      p_org_id: null,
      p_new_role: 'account_viewer',
      p_reason: 'trying to self-demote for test',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/own role/i)
  })

  it('demoting last account_owner is refused', async () => {
    // Needs admin-JWT to bypass the self-check (owner would fail
    // on "cannot change own role" before reaching the last-owner guard).
    const adminPw = 'AdminPass!1234'
    const { data: admin, error: adminErr } = await serviceClient().auth.admin.createUser({
      email: `adr47-change-lastpo-${Date.now()}@test.consentshield.in`,
      password: adminPw,
      email_confirm: true,
      app_metadata: { is_admin: true, admin_role: 'platform_operator' },
    })
    if (adminErr) throw adminErr
    const adminClient = createClient(SUPABASE_URL, ANON_KEY)
    await adminClient.auth.signInWithPassword({ email: admin.user.email!, password: adminPw })
    await adminClient.auth.refreshSession()
    try {
      const { error } = await adminClient.rpc('change_membership_role', {
        p_user_id: owner.userId,
        p_scope: 'account',
        p_org_id: null,
        p_new_role: 'account_viewer',
        p_reason: 'attempt to demote last owner',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/last account_owner/i)
    } finally {
      await serviceClient().auth.admin.deleteUser(admin.user.id)
    }
  })

  it('account_viewer cannot call change_membership_role', async () => {
    const viewer = await createUser('c4')
    const target = await createUser('c4t')
    try {
      await seedAccountMembership(owner.accountId, viewer.userId, 'account_viewer')
      await seedAccountMembership(owner.accountId, target.userId, 'account_viewer')
      const { error } = await viewer.client.rpc('change_membership_role', {
        p_user_id: target.userId,
        p_scope: 'account',
        p_org_id: null,
        p_new_role: 'account_owner',
        p_reason: 'viewer trying to promote',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/account_owner role required/i)
    } finally {
      await cleanupUser(viewer.userId)
      await cleanupUser(target.userId)
    }
  })

  it('idempotent role-change (same role) returns silently', async () => {
    const target = await createUser('c5')
    try {
      await seedAccountMembership(owner.accountId, target.userId, 'account_viewer')
      const { error } = await owner.client.rpc('change_membership_role', {
        p_user_id: target.userId,
        p_scope: 'account',
        p_org_id: null,
        p_new_role: 'account_viewer',
        p_reason: 'idempotent same-role call',
      })
      expect(error).toBeNull()
      // No audit row for no-op
      const { data: audit } = await serviceClient()
        .from('membership_audit_log')
        .select('id')
        .eq('target_user_id', target.userId)
      expect(audit ?? []).toEqual([])
    } finally {
      await cleanupUser(target.userId)
    }
  })
})

describe('ADR-0047 Sprint 1.1 — remove_membership', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('adr47-remove')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  it('account_owner removes a member; cascades org memberships under the account; audit row', async () => {
    const target = await createUser('r1')
    try {
      await seedAccountMembership(owner.accountId, target.userId, 'account_viewer')
      await seedOrgMembership(owner.orgId, target.userId, 'viewer')

      const { error } = await owner.client.rpc('remove_membership', {
        p_user_id: target.userId,
        p_scope: 'account',
        p_org_id: null,
        p_reason: 'offboarding user per request',
      })
      expect(error).toBeNull()

      const { count: acctCount } = await serviceClient()
        .from('account_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', owner.accountId)
        .eq('user_id', target.userId)
      expect(acctCount).toBe(0)

      const { count: orgCount } = await serviceClient()
        .from('org_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', owner.orgId)
        .eq('user_id', target.userId)
      expect(orgCount).toBe(0)

      const { data: audit } = await serviceClient()
        .from('membership_audit_log')
        .select('action, old_value, new_value')
        .eq('target_user_id', target.userId)
        .eq('action', 'membership_remove')
        .limit(1)
        .single()
      expect(audit?.new_value).toBeNull()
      expect(audit?.old_value).toMatchObject({ scope: 'account', role: 'account_viewer' })
    } finally {
      await cleanupUser(target.userId)
    }
  })

  it('remove refuses self', async () => {
    const { error } = await owner.client.rpc('remove_membership', {
      p_user_id: owner.userId,
      p_scope: 'account',
      p_org_id: null,
      p_reason: 'self-removal attempt for test',
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/yourself/i)
  })

  it('remove refuses last account_owner', async () => {
    const adminPw = 'AdminPass!1234'
    const { data: admin, error: adminErr } = await serviceClient().auth.admin.createUser({
      email: `adr47-remove-lastpo-${Date.now()}@test.consentshield.in`,
      password: adminPw,
      email_confirm: true,
      app_metadata: { is_admin: true, admin_role: 'platform_operator' },
    })
    if (adminErr) throw adminErr
    const adminClient = createClient(SUPABASE_URL, ANON_KEY)
    await adminClient.auth.signInWithPassword({ email: admin.user.email!, password: adminPw })
    await adminClient.auth.refreshSession()
    try {
      const { error } = await adminClient.rpc('remove_membership', {
        p_user_id: owner.userId,
        p_scope: 'account',
        p_org_id: null,
        p_reason: 'attempt to remove last owner',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/last account_owner/i)
    } finally {
      await serviceClient().auth.admin.deleteUser(admin.user.id)
    }
  })

  it('admin-JWT bypasses every gate', async () => {
    const target = await createUser('r4')
    try {
      await seedAccountMembership(owner.accountId, target.userId, 'account_owner')

      // service-role client has no JWT app_metadata at all, but it also
      // doesn't call current_uid(), so it should still pass via the
      // admin-JWT bypass branch since SUPABASE_SERVICE_ROLE_KEY carries
      // is_admin implicitly in the schema('public') context? It does
      // not — service role bypasses RLS but has no JWT. For this test
      // we instead create a proper admin user with is_admin in
      // app_metadata and sign in with them.
      const { data: adminCreated, error: adminCreateErr } = await serviceClient().auth.admin.createUser({
        email: `adr47-admjwt-${Date.now()}@test.consentshield.in`,
        password: 'AdminPass!1234',
        email_confirm: true,
        app_metadata: { is_admin: true, admin_role: 'platform_operator' },
      })
      if (adminCreateErr) throw adminCreateErr
      const adminClient = createClient(SUPABASE_URL, ANON_KEY)
      const { error: siErr } = await adminClient.auth.signInWithPassword({
        email: adminCreated.user.email!,
        password: 'AdminPass!1234',
      })
      if (siErr) throw siErr
      await adminClient.auth.refreshSession()

      try {
        // Two account_owners now — admin-JWT caller removes one of them,
        // not the last. owner is still an account_owner.
        const { error } = await adminClient.rpc('remove_membership', {
          p_user_id: target.userId,
          p_scope: 'account',
          p_org_id: null,
          p_reason: 'admin JWT bypass removal test',
        })
        expect(error).toBeNull()
      } finally {
        await serviceClient().auth.admin.deleteUser(adminCreated.user.id)
      }
    } finally {
      await cleanupUser(target.userId)
    }
  })
})
