import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createTestOrg, cleanupTestOrg, type TestOrg } from '../rls/helpers'

// ADR-0044 Phase 2.1 — Invitation RPC coverage.
//
// Exercises each invite shape end-to-end: create → preview → accept.
// Also asserts the role gates on create_invitation (account_owner can
// invite; admin-of-org cannot invite org_admin; etc.).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
}

async function createSecondaryUser(suffix: string) {
  const email = `rbac-inv-${suffix}-${Date.now()}@test.consentshield.in`
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
  const admin = serviceClient()
  await admin.auth.admin.deleteUser(userId)
}

describe('ADR-0044 Phase 2.1 — invitations', () => {
  let owner: TestOrg

  beforeAll(async () => {
    owner = await createTestOrg('inv-owner')
  }, 60000)

  afterAll(async () => {
    await cleanupTestOrg(owner)
  }, 60000)

  describe('create_invitation — role gates', () => {
    it('account_owner can invite an org_admin of their org', async () => {
      const { data, error } = await owner.client.rpc('create_invitation', {
        p_email: `invitee-${Date.now()}@test.consentshield.in`,
        p_role: 'org_admin',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      expect(error).toBeNull()
      expect(data?.[0]?.token).toMatch(/^[0-9a-f]{48}$/)
    })

    it('account_owner can invite a viewer', async () => {
      const { data, error } = await owner.client.rpc('create_invitation', {
        p_email: `viewer-${Date.now()}@test.consentshield.in`,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      expect(error).toBeNull()
      expect(data?.[0]?.token).toBeTruthy()
    })

    it('account_owner cannot invite account_owner for a brand-new account (admin-JWT-only path)', async () => {
      const { error } = await owner.client.rpc('create_invitation', {
        p_email: `newacct-${Date.now()}@test.consentshield.in`,
        p_role: 'account_owner',
        p_plan_code: 'trial_starter',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/operator-only/i)
    })

    it('admin-of-org cannot invite org_admin (account_owner role required)', async () => {
      // Create an admin-tier user of owner's org and try inviting an org_admin.
      const second = await createSecondaryUser('admin-tier')
      try {
        await serviceClient()
          .from('org_memberships')
          .insert({ org_id: owner.orgId, user_id: second.userId, role: 'admin' })

        const { error } = await second.client.rpc('create_invitation', {
          p_email: `who-${Date.now()}@test.consentshield.in`,
          p_role: 'org_admin',
          p_account_id: owner.accountId,
          p_org_id: owner.orgId,
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/account_owner role required/i)
      } finally {
        await cleanupUser(second.userId)
      }
    })

    it('viewer cannot invite anyone', async () => {
      const second = await createSecondaryUser('viewer-tier')
      try {
        await serviceClient()
          .from('org_memberships')
          .insert({ org_id: owner.orgId, user_id: second.userId, role: 'viewer' })

        const { error } = await second.client.rpc('create_invitation', {
          p_email: `nope-${Date.now()}@test.consentshield.in`,
          p_role: 'viewer',
          p_account_id: owner.accountId,
          p_org_id: owner.orgId,
        })
        expect(error).not.toBeNull()
      } finally {
        await cleanupUser(second.userId)
      }
    })

    it('shape check — org-level invite requires org_id', async () => {
      const { error } = await owner.client.rpc('create_invitation', {
        p_email: `bad-${Date.now()}@test.consentshield.in`,
        p_role: 'admin',
        p_account_id: owner.accountId,
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/org_id/i)
    })
  })

  describe('accept_invitation — happy paths', () => {
    it('viewer accept adds org_memberships row', async () => {
      const email = `viewer-accept-${Date.now()}@test.consentshield.in`

      // Owner issues the invite.
      const createRes = await owner.client.rpc('create_invitation', {
        p_email: email,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      expect(createRes.error).toBeNull()
      const token = createRes.data?.[0]?.token as string
      expect(token).toBeTruthy()

      // Invitee signs up.
      const admin = serviceClient()
      const password = `TestPass!${Date.now()}`
      const { data: u, error: uErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      expect(uErr).toBeNull()
      const invitee = createClient(SUPABASE_URL, ANON_KEY)
      await invitee.auth.signInWithPassword({ email, password })
      await invitee.auth.refreshSession()

      try {
        const { data: preview, error: prevErr } = await invitee.rpc('invitation_preview', {
          p_token: token,
        })
        expect(prevErr).toBeNull()
        expect(preview?.[0]?.role).toBe('viewer')
        expect(preview?.[0]?.invited_email).toBe(email)

        const { data: accepted, error: accErr } = await invitee.rpc('accept_invitation', {
          p_token: token,
        })
        expect(accErr).toBeNull()
        expect(accepted).toMatchObject({ ok: true, role: 'viewer', org_id: owner.orgId })

        const { data: member } = await admin
          .from('org_memberships')
          .select('role')
          .eq('org_id', owner.orgId)
          .eq('user_id', u!.user.id)
          .single()
        expect(member?.role).toBe('viewer')
      } finally {
        await cleanupUser(u!.user.id)
      }
    })

    it('email mismatch raises', async () => {
      const invitedEmail = `intended-${Date.now()}@test.consentshield.in`

      const createRes = await owner.client.rpc('create_invitation', {
        p_email: invitedEmail,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      expect(createRes.error).toBeNull()
      const token = createRes.data?.[0]?.token as string

      const impostor = await createSecondaryUser('impostor')
      try {
        const { error } = await impostor.client.rpc('accept_invitation', {
          p_token: token,
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/email does not match/i)
      } finally {
        await cleanupUser(impostor.userId)
      }
    })

    it('double-accept raises', async () => {
      const email = `once-${Date.now()}@test.consentshield.in`
      const createRes = await owner.client.rpc('create_invitation', {
        p_email: email,
        p_role: 'viewer',
        p_account_id: owner.accountId,
        p_org_id: owner.orgId,
      })
      const token = createRes.data?.[0]?.token as string

      const admin = serviceClient()
      const password = `TestPass!${Date.now()}`
      const { data: u } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      const invitee = createClient(SUPABASE_URL, ANON_KEY)
      await invitee.auth.signInWithPassword({ email, password })
      await invitee.auth.refreshSession()

      try {
        const first = await invitee.rpc('accept_invitation', { p_token: token })
        expect(first.error).toBeNull()

        const second = await invitee.rpc('accept_invitation', { p_token: token })
        expect(second.error).not.toBeNull()
        expect(second.error?.message).toMatch(/already accepted/i)
      } finally {
        await cleanupUser(u!.user.id)
      }
    })
  })
})
