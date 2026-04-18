import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminAnonClient,
  getAdminServiceClient,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0034 Sprint 1.1 (post ADR-0044 Phase 0) — Billing RPCs on accounts.
//
// Phase 0 moved plan + Razorpay identity from organisations to accounts.
// The amendment migration 20260502000001 rewired refunds, plan_adjustments,
// and all admin.billing_* RPCs onto account_id. These tests exercise:
//
//   * each list RPC returns an array
//   * refund create+list+audit row against an account
//   * validators (reason ≥ 10 chars, amount > 0)
//   * upsert revokes prior active (account, kind) row
//   * account_effective_plan: override > comp > accounts.plan_code
//   * support role denied on platform_operator-gated RPCs
//   * unknown plan code rejected (plans.is_active = true only)
//   * non-admin authenticated user denied on every read
//
// TestOrg now carries `accountId` (ADR-0044 Phase 0 change to the RLS
// helper); fixtures use it directly.

let supportUser: AdminTestUser
let platformOp: AdminTestUser
let customer: TestOrg
const service = getAdminServiceClient()

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
  platformOp = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('billing')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (customer) await cleanupTestOrg(customer)
})

async function countAuditRows(action: string, adminUserId: string) {
  const { count } = await service
    .schema('admin')
    .from('admin_audit_log')
    .select('*', { count: 'exact', head: true })
    .eq('action', action)
    .eq('admin_user_id', adminUserId)
  return count ?? 0
}

describe('ADR-0034 Sprint 1.1 (post-0044) — admin billing_* RPCs + account_effective_plan', () => {
  describe('billing_payment_failures_list', () => {
    it('support admin can call; returns an array', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 7 })
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
    })

    it('rejects p_window_days outside [1, 90]', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 0 })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/p_window_days must be between/i)
    })

    it('non-admin authenticated user is denied', async () => {
      const anon = getAdminAnonClient()
      const { error } = await anon
        .schema('admin')
        .rpc('billing_payment_failures_list', { p_window_days: 7 })
      expect(error).not.toBeNull()
    })
  })

  describe('billing_refunds_list + billing_create_refund', () => {
    it('support admin can create a refund; writes refund row + audit row', async () => {
      const before = await countAuditRows('billing_create_refund', supportUser.userId)

      const { data: id, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_account_id: customer.accountId,
          p_razorpay_payment_id: 'pay_test_1a2b3c',
          p_amount_paise: 59900,
          p_reason: 'Cancellation within 7-day window',
        })
      expect(error).toBeNull()
      expect(typeof id).toBe('string')

      const { data: rows } = await service
        .from('refunds')
        .select('*')
        .eq('id', id as string)
      expect(rows).toHaveLength(1)
      expect(rows![0].status).toBe('pending')
      expect(rows![0].amount_paise).toBe(59900)
      expect(rows![0].account_id).toBe(customer.accountId)

      const after = await countAuditRows('billing_create_refund', supportUser.userId)
      expect(after).toBe(before + 1)
    })

    it('billing_refunds_list returns the just-created refund', async () => {
      const { data, error } = await supportUser.client
        .schema('admin')
        .rpc('billing_refunds_list', { p_limit: 20 })
      expect(error).toBeNull()
      expect(Array.isArray(data)).toBe(true)
      const match = (data as Array<{ account_id: string; status: string }>).find(
        (r) => r.account_id === customer.accountId,
      )
      expect(match).toBeDefined()
    })

    it('rejects reason < 10 chars', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_account_id: customer.accountId,
          p_razorpay_payment_id: 'pay_short',
          p_amount_paise: 100,
          p_reason: 'short',
        })
      expect(error).not.toBeNull()
    })

    it('rejects amount_paise <= 0', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_create_refund', {
          p_account_id: customer.accountId,
          p_razorpay_payment_id: 'pay_zero',
          p_amount_paise: 0,
          p_reason: 'zero-amount refund attempt test',
        })
      expect(error).not.toBeNull()
    })
  })

  describe('billing_upsert_plan_adjustment + list + revoke', () => {
    it('platform_operator can create a comp grant; list returns it', async () => {
      const { data: id, error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: customer.accountId,
          p_kind: 'comp',
          p_plan: 'pro',
          p_expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
          p_reason: 'ABDM pilot partner — 90 days',
        })
      expect(error).toBeNull()
      expect(typeof id).toBe('string')

      const { data: list } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'comp' })
      const match = (list as Array<{ id: string; account_id: string; plan: string }>).find(
        (r) => r.id === id,
      )
      expect(match?.plan).toBe('pro')
      expect(match?.account_id).toBe(customer.accountId)
    })

    it('upsert revokes the prior active (account, kind) row', async () => {
      const { data: newId, error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: customer.accountId,
          p_kind: 'comp',
          p_plan: 'enterprise',
          p_expires_at: null,
          p_reason: 'Upgrade comp grant to enterprise, no expiry',
        })
      expect(error).toBeNull()

      const { data: active } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'comp' })
      const forAccount = (active as Array<{ id: string; account_id: string; plan: string }>).filter(
        (r) => r.account_id === customer.accountId,
      )
      expect(forAccount).toHaveLength(1)
      expect(forAccount[0].id).toBe(newId)
      expect(forAccount[0].plan).toBe('enterprise')
    })

    it('account_effective_plan returns the active comp plan', async () => {
      const { data, error } = await service.rpc('account_effective_plan', {
        p_account_id: customer.accountId,
      })
      expect(error).toBeNull()
      expect(data).toBe('enterprise')
    })

    it('override stacks on comp and wins in account_effective_plan', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: customer.accountId,
          p_kind: 'override',
          p_plan: 'growth',
          p_expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
          p_reason: 'Temporary downshift for testing precedence',
        })
      expect(error).toBeNull()

      const { data: plan } = await service.rpc('account_effective_plan', {
        p_account_id: customer.accountId,
      })
      expect(plan).toBe('growth')
    })

    it('support role is denied on upsert', async () => {
      const { error } = await supportUser.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: customer.accountId,
          p_kind: 'comp',
          p_plan: 'pro',
          p_expires_at: null,
          p_reason: 'support should not be allowed to grant plans',
        })
      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/platform_operator/i)
    })

    it('revoke marks the row revoked and falls back to the next tier', async () => {
      const { data: active } = await platformOp.client
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'override' })
      const target = (active as Array<{ id: string; account_id: string }>).find(
        (r) => r.account_id === customer.accountId,
      )
      expect(target).toBeDefined()

      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_revoke_plan_adjustment', {
          p_adjustment_id: target!.id,
          p_reason: 'End of override test — revert to comp',
        })
      expect(error).toBeNull()

      const { data: plan } = await service.rpc('account_effective_plan', {
        p_account_id: customer.accountId,
      })
      // Comp is still enterprise from earlier.
      expect(plan).toBe('enterprise')
    })

    it('rejects an unknown / inactive plan code', async () => {
      const { error } = await platformOp.client
        .schema('admin')
        .rpc('billing_upsert_plan_adjustment', {
          p_account_id: customer.accountId,
          p_kind: 'comp',
          p_plan: 'platinum', // not in public.plans
          p_expires_at: null,
          p_reason: 'should fail — bogus plan code',
        })
      expect(error).not.toBeNull()
    })
  })

  describe('account_effective_plan fallback when no adjustments exist', () => {
    it('returns accounts.plan_code when no active adjustments', async () => {
      const fresh = await createTestOrg('billing-eff')
      try {
        const { data, error } = await service.rpc('account_effective_plan', {
          p_account_id: fresh.accountId,
        })
        expect(error).toBeNull()
        // createTestOrg seeds trial_starter; no adjustments → fallback
        // to accounts.plan_code.
        expect(data).toBe('trial_starter')
      } finally {
        await cleanupTestOrg(fresh)
      }
    })
  })
})
