// ADR-1012 Sprint 1.3 — /v1/plans integration tests.

import { describe, it, expect } from 'vitest'
import { listPlans } from '../../app/src/lib/api/plans'

describe('listPlans — /v1/plans', () => {

  it('returns active plans with the expected envelope shape', async () => {
    const r = await listPlans()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Array.isArray(r.data.items)).toBe(true)
    expect(r.data.items.length).toBeGreaterThan(0)

    for (const p of r.data.items) {
      expect(typeof p.plan_code).toBe('string')
      expect(typeof p.display_name).toBe('string')
      expect(typeof p.max_organisations).toBe('number')
      expect(typeof p.max_web_properties_per_org).toBe('number')
      // base_price_inr can be null (enterprise talk-to-us).
      expect(p.base_price_inr === null || typeof p.base_price_inr === 'number').toBe(true)
      expect(typeof p.trial_days).toBe('number')
      expect(typeof p.api_rate_limit_per_hour).toBe('number')
      expect(typeof p.api_burst).toBe('number')
    }
  })

  it('cheapest first, NULL-priced plans last (enterprise at the end)', async () => {
    const r = await listPlans()
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const prices = r.data.items.map((p) => p.base_price_inr)
    // Every non-null price must be ≥ every earlier non-null price.
    const priced = prices.filter((v): v is number => v !== null)
    for (let i = 1; i < priced.length; i++) {
      expect(priced[i]).toBeGreaterThanOrEqual(priced[i - 1])
    }
    // Null prices (if any) must all come after the priced ones.
    const firstNullIdx = prices.indexOf(null)
    if (firstNullIdx !== -1) {
      for (let i = firstNullIdx; i < prices.length; i++) {
        expect(prices[i]).toBeNull()
      }
    }
  })

  it('never leaks razorpay_plan_id (internal integration key)', async () => {
    const r = await listPlans()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    for (const p of r.data.items) {
      expect(Object.keys(p)).not.toContain('razorpay_plan_id')
    }
  })

  it('rate-tier values match the TS TIER_LIMITS mirror for every plan_code present in both', async () => {
    // Triangulates the drift check from rate-tier-drift.test.ts: both the
    // endpoint AND the TS mirror should agree with public.plans.
    const r = await listPlans()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { TIER_LIMITS } = await import('../../app/src/lib/api/rate-limits')
    for (const p of r.data.items) {
      const tsEntry = TIER_LIMITS[p.plan_code]
      if (tsEntry) {
        expect(tsEntry.perHour).toBe(p.api_rate_limit_per_hour)
        expect(tsEntry.burst).toBe(p.api_burst)
      }
    }
  })

})
