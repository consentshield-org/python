import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from './helpers'

// ADR-0045 Sprint 1.1 — admin user lifecycle RPCs.
//
// Covers the four admin.* RPCs:
//   admin_invite_create  (platform_operator only)
//   admin_change_role    (platform_operator; self-change + last-PO refused)
//   admin_disable        (platform_operator; self-disable + last-PO refused)
//   admin_list           (support+)
//
// Auth-side raw_app_meta_data sync is the Route Handler's job (Sprint
// 1.2); these tests validate postgres state + audit invariants only.

const service = getAdminServiceClient()

async function countAuditRows(action: string, adminUserId: string): Promise<number> {
  const { count } = await service
    .schema('admin')
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .eq('admin_user_id', adminUserId)
  return count ?? 0
}

let opA: AdminTestUser // platform_operator
let opB: AdminTestUser // platform_operator
let supportUser: AdminTestUser

beforeAll(async () => {
  opA = await createAdminTestUser('platform_operator')
  opB = await createAdminTestUser('platform_operator')
  supportUser = await createAdminTestUser('support')
})

afterAll(async () => {
  if (opA) await cleanupAdminTestUser(opA)
  if (opB) await cleanupAdminTestUser(opB)
  if (supportUser) await cleanupAdminTestUser(supportUser)
})

describe('ADR-0045 Sprint 1.1 — admin lifecycle RPCs', () => {
  describe('status constraint', () => {
    it("accepts 'invited' after the migration extends the check", async () => {
      const { data: authData, error: authErr } = await service.auth.admin.createUser({
        email: `invited-${Date.now()}@test.consentshield.in`,
        password: `InvitedPass!${Date.now()}`,
        email_confirm: true,
      })
      expect(authErr).toBeNull()
      try {
        const { error } = await service.schema('admin').from('admin_users').insert({
          id: authData.user.id,
          display_name: 'Invited constraint test',
          admin_role: 'support',
          status: 'invited',
        })
        expect(error).toBeNull()
      } finally {
        await service.auth.admin.deleteUser(authData.user.id)
      }
    })
  })

  describe('admin_invite_create', () => {
    it('platform_operator can invite; writes admin_users + audit row', async () => {
      const { data: authData } = await service.auth.admin.createUser({
        email: `adminv-${Date.now()}@test.consentshield.in`,
        password: `InvitePass!${Date.now()}`,
        email_confirm: true,
      })
      const targetId = authData.user.id
      try {
        const before = await countAuditRows('admin_invite_create', opA.userId)

        const { data, error } = await opA.client
          .schema('admin')
          .rpc('admin_invite_create', {
            p_user_id: targetId,
            p_display_name: 'Test Support Admin',
            p_admin_role: 'support',
            p_reason: 'Inviting support tier for Sprint 1.1 coverage',
          })
        expect(error).toBeNull()
        expect(data).toBe(targetId)

        const { data: row } = await service
          .schema('admin')
          .from('admin_users')
          .select('*')
          .eq('id', targetId)
          .maybeSingle()
        expect(row?.status).toBe('invited')
        expect(row?.admin_role).toBe('support')
        expect(row?.created_by).toBe(opA.userId)

        const after = await countAuditRows('admin_invite_create', opA.userId)
        expect(after).toBe(before + 1)
      } finally {
        await service.auth.admin.deleteUser(targetId)
      }
    })

    it('support role cannot invite', async () => {
      const { data: authData } = await service.auth.admin.createUser({
        email: `noadm-${Date.now()}@test.consentshield.in`,
        password: `NoPass!${Date.now()}`,
        email_confirm: true,
      })
      try {
        const { error } = await supportUser.client
          .schema('admin')
          .rpc('admin_invite_create', {
            p_user_id: authData.user.id,
            p_display_name: 'Should fail',
            p_admin_role: 'support',
            p_reason: 'support should not be able to invite',
          })
        expect(error).not.toBeNull()
      } finally {
        await service.auth.admin.deleteUser(authData.user.id)
      }
    })

    it('rejects reason < 10 chars', async () => {
      const { data: authData } = await service.auth.admin.createUser({
        email: `short-${Date.now()}@test.consentshield.in`,
        password: `ShortPass!${Date.now()}`,
        email_confirm: true,
      })
      try {
        const { error } = await opA.client
          .schema('admin')
          .rpc('admin_invite_create', {
            p_user_id: authData.user.id,
            p_display_name: 'Short',
            p_admin_role: 'support',
            p_reason: 'short',
          })
        expect(error).not.toBeNull()
      } finally {
        await service.auth.admin.deleteUser(authData.user.id)
      }
    })
  })

  describe('admin_change_role', () => {
    it('platform_operator can change another admins role; audit row written', async () => {
      const before = await countAuditRows('admin_change_role', opA.userId)
      const { error } = await opA.client.schema('admin').rpc('admin_change_role', {
        p_admin_id: supportUser.userId,
        p_new_role: 'read_only',
        p_reason: 'Testing role downgrade for Sprint 1.1',
      })
      expect(error).toBeNull()

      const { data: row } = await service
        .schema('admin')
        .from('admin_users')
        .select('admin_role')
        .eq('id', supportUser.userId)
        .maybeSingle()
      expect(row?.admin_role).toBe('read_only')

      const after = await countAuditRows('admin_change_role', opA.userId)
      expect(after).toBe(before + 1)

      // Restore for later tests.
      await opA.client.schema('admin').rpc('admin_change_role', {
        p_admin_id: supportUser.userId,
        p_new_role: 'support',
        p_reason: 'Restoring support role after change-role test',
      })
    })

    it('refuses self-change', async () => {
      const { error } = await opA.client.schema('admin').rpc('admin_change_role', {
        p_admin_id: opA.userId,
        p_new_role: 'support',
        p_reason: 'self-change attempt should be rejected',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/own role/i)
    })

    it('refuses demoting when caller is the last active platform_operator', async () => {
      // Guard fires when active/invited platform_operator count ≤ 1.
      // The shared dev DB may carry platform_operator rows from other
      // test runs or the bootstrap admin; suspend all active+invited
      // POs except opA (which we want to remain as the sole PO), then
      // attempt the demotion from opB (whose JWT still carries the PO
      // claim even though its status row is suspended).
      const { data: otherPOs } = await service
        .schema('admin')
        .from('admin_users')
        .select('id, status')
        .eq('admin_role', 'platform_operator')
        .in('status', ['active', 'invited'])
        .neq('id', opA.userId)
      const restoreList: Array<{ id: string; status: string }> = (otherPOs ?? []).map(
        (r) => ({ id: r.id, status: r.status }),
      )

      for (const po of restoreList) {
        await service
          .schema('admin')
          .from('admin_users')
          .update({ status: 'suspended' })
          .eq('id', po.id)
      }

      try {
        const { error } = await opB.client
          .schema('admin')
          .rpc('admin_change_role', {
            p_admin_id: opA.userId,
            p_new_role: 'support',
            p_reason: 'Attempting to demote last active platform_operator',
          })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/last active platform_operator/i)
      } finally {
        for (const po of restoreList) {
          await service
            .schema('admin')
            .from('admin_users')
            .update({ status: po.status })
            .eq('id', po.id)
        }
      }
    })
  })

  describe('admin_disable', () => {
    it('platform_operator can disable another admin; audit row written', async () => {
      const tmp = await createAdminTestUser('support')
      try {
        const before = await countAuditRows('admin_disable', opA.userId)
        const { error } = await opA.client.schema('admin').rpc('admin_disable', {
          p_admin_id: tmp.userId,
          p_reason: 'Disabling tmp admin for Sprint 1.1 test',
        })
        expect(error).toBeNull()

        const { data: row } = await service
          .schema('admin')
          .from('admin_users')
          .select('status,disabled_at,disabled_reason')
          .eq('id', tmp.userId)
          .maybeSingle()
        expect(row?.status).toBe('disabled')
        expect(row?.disabled_at).toBeTruthy()
        expect(row?.disabled_reason).toMatch(/sprint 1\.1/i)

        const after = await countAuditRows('admin_disable', opA.userId)
        expect(after).toBe(before + 1)
      } finally {
        await cleanupAdminTestUser(tmp)
      }
    })

    it('refuses self-disable', async () => {
      const { error } = await opA.client.schema('admin').rpc('admin_disable', {
        p_admin_id: opA.userId,
        p_reason: 'self-disable attempt should fail',
      })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/yourself/i)
    })

    it('refuses disabling the last active platform_operator', async () => {
      // Same shape as the change_role last-PO test: suspend every
      // active/invited platform_operator except opA, so opA is the
      // sole surviving PO. Then attempt the disable call from opB
      // whose JWT still carries the PO claim.
      const { data: otherPOs } = await service
        .schema('admin')
        .from('admin_users')
        .select('id, status')
        .eq('admin_role', 'platform_operator')
        .in('status', ['active', 'invited'])
        .neq('id', opA.userId)
      const restoreList: Array<{ id: string; status: string }> = (otherPOs ?? []).map(
        (r) => ({ id: r.id, status: r.status }),
      )

      for (const po of restoreList) {
        await service
          .schema('admin')
          .from('admin_users')
          .update({ status: 'suspended' })
          .eq('id', po.id)
      }

      try {
        const { error } = await opB.client.schema('admin').rpc('admin_disable', {
          p_admin_id: opA.userId,
          p_reason: 'Attempting to disable last active platform_operator',
        })
        expect(error).not.toBeNull()
        expect(error?.message).toMatch(/last active platform_operator/i)
      } finally {
        for (const po of restoreList) {
          await service
            .schema('admin')
            .from('admin_users')
            .update({ status: po.status })
            .eq('id', po.id)
        }
      }
    })
  })

  describe('admin_list', () => {
    it('support can call; returns an array including opA', async () => {
      const { data, error } = await supportUser.client.schema('admin').rpc('admin_list')
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      const match = (data as Array<{ id: string }>).find((r) => r.id === opA.userId)
      expect(match).toBeDefined()
    })
  })
})
