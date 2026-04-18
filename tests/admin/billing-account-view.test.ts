import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
} from './helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'

// ADR-0050 Sprint 1 — admin.billing_account_summary RPC.
//
// Covers:
//   · support + platform_operator can read
//   · missing account raises
//   · base plan history event always present (account creation)
//   · granting a comp adds a granted event
//   · revoking the comp adds a revoked event
//   · outstanding_balance_paise is 0 until Sprint 2

let support: AdminTestUser
let platformOp: AdminTestUser
let customer: TestOrg

beforeAll(async () => {
  support = await createAdminTestUser('support')
  platformOp = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('billsummary')
})

afterAll(async () => {
  if (support) await cleanupAdminTestUser(support)
  if (platformOp) await cleanupAdminTestUser(platformOp)
  if (customer) await cleanupTestOrg(customer)
})

describe('ADR-0050 Sprint 1 — admin.billing_account_summary', () => {
  it('support can read; envelope shape + base plan history event', async () => {
    const { data, error } = await support.client
      .schema('admin')
      .rpc('billing_account_summary', { p_account_id: customer.accountId })
    expect(error).toBeNull()
    const env = data as {
      subscription_state: {
        plan_code: string
        effective_plan_code: string
        status: string
      }
      plan_history: Array<{
        plan_code: string
        source: string
        action: string
      }>
      outstanding_balance_paise: number
    }
    expect(env.subscription_state.plan_code).toBe('trial_starter')
    expect(env.subscription_state.effective_plan_code).toBe('trial_starter')
    expect(env.outstanding_balance_paise).toBe(0)
    expect(env.plan_history.length).toBeGreaterThanOrEqual(1)
    const base = env.plan_history.find(
      (e) => e.source === 'base' && e.action === 'granted',
    )
    expect(base).toBeDefined()
    expect(base!.plan_code).toBe('trial_starter')
  })

  it('missing account raises', async () => {
    const { error } = await support.client
      .schema('admin')
      .rpc('billing_account_summary', {
        p_account_id: '00000000-0000-0000-0000-000000000000',
      })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/not found/i)
  })

  it('grant + revoke comp flows through plan_history', async () => {
    // Grant a comp via existing ADR-0034 RPC (platform_operator required).
    const grantRes = await platformOp.client
      .schema('admin')
      .rpc('billing_upsert_plan_adjustment', {
        p_account_id: customer.accountId,
        p_kind: 'comp',
        p_plan: 'growth',
        p_expires_at: null,
        p_reason: 'ADR-0050 Sprint 1 test — grant comp for plan history',
      })
    expect(grantRes.error).toBeNull()
    const adjustmentId = grantRes.data as string
    expect(adjustmentId).toBeDefined()

    const afterGrant = await support.client
      .schema('admin')
      .rpc('billing_account_summary', { p_account_id: customer.accountId })
    expect(afterGrant.error).toBeNull()
    const env1 = afterGrant.data as {
      subscription_state: { effective_plan_code: string }
      plan_history: Array<{
        source: string
        action: string
        adjustment_id: string | null
        plan_code: string
      }>
    }
    expect(env1.subscription_state.effective_plan_code).toBe('growth')
    const granted = env1.plan_history.find(
      (e) =>
        e.source === 'comp' &&
        e.action === 'granted' &&
        e.adjustment_id === adjustmentId,
    )
    expect(granted).toBeDefined()
    expect(granted!.plan_code).toBe('growth')

    // Revoke — revocation should surface as a separate event.
    const revokeRes = await platformOp.client
      .schema('admin')
      .rpc('billing_revoke_plan_adjustment', {
        p_adjustment_id: adjustmentId,
        p_reason: 'ADR-0050 Sprint 1 test — revoke to verify plan history',
      })
    expect(revokeRes.error).toBeNull()

    const afterRevoke = await support.client
      .schema('admin')
      .rpc('billing_account_summary', { p_account_id: customer.accountId })
    expect(afterRevoke.error).toBeNull()
    const env2 = afterRevoke.data as {
      subscription_state: { effective_plan_code: string }
      plan_history: Array<{
        source: string
        action: string
        adjustment_id: string | null
      }>
    }
    expect(env2.subscription_state.effective_plan_code).toBe('trial_starter')
    const revoked = env2.plan_history.find(
      (e) =>
        e.source === 'comp' &&
        e.action === 'revoked' &&
        e.adjustment_id === adjustmentId,
    )
    expect(revoked).toBeDefined()
  })
})
