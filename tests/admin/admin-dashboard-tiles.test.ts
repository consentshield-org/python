import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createAdminTestUser,
  cleanupAdminTestUser,
  AdminTestUser,
} from './helpers'

// ADR-1027 Sprint 1.2 — admin.admin_dashboard_tiles() envelope.
//
// The RPC returns a single jsonb payload covering both the org-tier
// platform_metrics_daily snapshot and the live account-tier metrics.
// These tests assert:
//   1. Support role can call the RPC; non-admin cannot.
//   2. The envelope carries the expected top-level keys.
//   3. account_tier carries accounts_total + accounts_by_plan (as an
//      array with {plan_code, display_name, count}) + accounts_by_status
//      + the three orgs-per-account percentile fields + the three
//      trial-to-paid fields (rate, numerator, denominator).
//   4. Every plan_code present in public.plans (active) appears in the
//      by_plan array, even with count 0 — so the histogram renders a
//      row per plan, not just the ones with members.
//   5. trial_to_paid_rate_30d is null when the denominator is zero
//      (avoids 0/0 NaN), otherwise a number in [0, 100].

let supportUser: AdminTestUser
let readOnlyUser: AdminTestUser

beforeAll(async () => {
  supportUser = await createAdminTestUser('support')
  readOnlyUser = await createAdminTestUser('read_only')
})

afterAll(async () => {
  if (supportUser) await cleanupAdminTestUser(supportUser)
  if (readOnlyUser) await cleanupAdminTestUser(readOnlyUser)
})

describe('ADR-1027 Sprint 1.2 — admin.admin_dashboard_tiles()', () => {
  it('support role can call the RPC and gets the expected envelope', async () => {
    const { data, error } = await supportUser.client
      .schema('admin')
      .rpc('admin_dashboard_tiles')

    expect(error).toBeNull()
    expect(data).not.toBeNull()

    const envelope = data as Record<string, unknown>
    expect(envelope).toHaveProperty('generated_at')
    expect(envelope).toHaveProperty('account_tier')
    // org_tier may be null on a fresh DB if refresh_platform_metrics has never run;
    // that's a valid state — the envelope exposes it as `null`, not absent.
    expect(Object.prototype.hasOwnProperty.call(envelope, 'org_tier')).toBe(true)
  })

  it('account_tier carries the seven expected fields with correct types', async () => {
    const { data } = await supportUser.client
      .schema('admin')
      .rpc('admin_dashboard_tiles')

    const accountTier = (data as { account_tier: Record<string, unknown> })
      .account_tier
    expect(accountTier).toBeDefined()

    expect(typeof accountTier.accounts_total).toBe('number')
    expect(Array.isArray(accountTier.accounts_by_plan)).toBe(true)
    expect(Array.isArray(accountTier.accounts_by_status)).toBe(true)
    expect(typeof accountTier.orgs_per_account_p50).toBe('number')
    expect(typeof accountTier.orgs_per_account_p90).toBe('number')
    expect(typeof accountTier.orgs_per_account_max).toBe('number')
    expect(typeof accountTier.trial_to_paid_numerator).toBe('number')
    expect(typeof accountTier.trial_to_paid_denominator).toBe('number')
    // Rate may be null (when denominator == 0) or a number.
    expect(
      accountTier.trial_to_paid_rate_30d === null ||
        typeof accountTier.trial_to_paid_rate_30d === 'number',
    ).toBe(true)
  })

  it('accounts_by_plan covers every active plan, including zero-count ones', async () => {
    const { data } = await supportUser.client
      .schema('admin')
      .rpc('admin_dashboard_tiles')

    const accountTier = (data as { account_tier: Record<string, unknown> })
      .account_tier
    const byPlan = accountTier.accounts_by_plan as Array<{
      plan_code: string
      display_name: string
      count: number
    }>

    // These are the plans seeded in 20260428000002_accounts_and_plans.sql.
    const expectedPlans = ['trial_starter', 'starter', 'growth', 'pro', 'enterprise']
    const planCodes = byPlan.map((r) => r.plan_code)
    for (const expected of expectedPlans) {
      expect(planCodes).toContain(expected)
    }

    for (const row of byPlan) {
      expect(typeof row.plan_code).toBe('string')
      expect(typeof row.display_name).toBe('string')
      expect(typeof row.count).toBe('number')
      expect(row.count).toBeGreaterThanOrEqual(0)
    }
  })

  it('trial_to_paid_rate_30d is null when denominator is zero, [0,100] otherwise', async () => {
    const { data } = await supportUser.client
      .schema('admin')
      .rpc('admin_dashboard_tiles')

    const t = (data as { account_tier: Record<string, unknown> }).account_tier
    if (t.trial_to_paid_denominator === 0) {
      expect(t.trial_to_paid_rate_30d).toBeNull()
    } else {
      expect(t.trial_to_paid_rate_30d).toBeGreaterThanOrEqual(0)
      expect(t.trial_to_paid_rate_30d).toBeLessThanOrEqual(100)
      // Sanity: rate = numer / denom * 100, rounded to 1dp.
      const recomputed = Math.round(
        ((t.trial_to_paid_numerator as number) /
          (t.trial_to_paid_denominator as number)) *
          100 *
          10,
      ) / 10
      expect(t.trial_to_paid_rate_30d).toBe(recomputed)
    }
  })

  it('read_only role cannot call the RPC (support-tier gated)', async () => {
    const { data, error } = await readOnlyUser.client
      .schema('admin')
      .rpc('admin_dashboard_tiles')

    // admin.require_admin('support') raises when the caller's admin_role
    // is lower than support; read_only is below support in the hierarchy.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
