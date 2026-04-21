// ADR-1001 V2 C-2 — rate-tier static map drift check.
//
// app/src/lib/api/rate-limits.ts is a static TS mirror of public.plans'
// api_rate_limit_per_hour + api_burst columns. Querying the DB per
// /v1/* request in middleware is too expensive; the TS map gives
// microsecond lookup. But a silent drift (DB value changes, TS map
// doesn't) means the proxy enforces stale limits.
//
// This test reads public.plans on every CI run and asserts every plan's
// limits match the TS map entry of the same plan_code. Extra map
// entries (e.g., sandbox, trial — which are not plans) are allowed; the
// direction of correctness is DB → TS.

import { describe, it, expect } from 'vitest'
import { TIER_LIMITS } from '../../app/src/lib/api/rate-limits'
import { getServiceClient } from '../rls/helpers'

describe('rate-tier drift — public.plans vs rate-limits.ts TIER_LIMITS', () => {
  it('every row in public.plans has a matching TIER_LIMITS entry', async () => {
    const admin = getServiceClient()
    const { data, error } = await admin
      .from('plans')
      .select('plan_code, api_rate_limit_per_hour, api_burst')
      .order('plan_code')

    expect(error).toBeNull()
    expect(data).toBeTruthy()
    const plans = data as Array<{
      plan_code: string
      api_rate_limit_per_hour: number
      api_burst: number
    }>
    expect(plans.length).toBeGreaterThan(0)

    const missing: string[] = []
    const mismatched: Array<{
      plan_code: string
      db: { perHour: number; burst: number }
      ts: { perHour: number; burst: number }
    }> = []

    for (const p of plans) {
      const tsEntry = TIER_LIMITS[p.plan_code]
      if (!tsEntry) {
        missing.push(p.plan_code)
        continue
      }
      if (tsEntry.perHour !== p.api_rate_limit_per_hour || tsEntry.burst !== p.api_burst) {
        mismatched.push({
          plan_code: p.plan_code,
          db: { perHour: p.api_rate_limit_per_hour, burst: p.api_burst },
          ts: tsEntry,
        })
      }
    }

    expect(
      missing,
      `TIER_LIMITS is missing entries for plan_codes: ${missing.join(', ')}. ` +
        `Every row in public.plans must have a matching map entry in ` +
        `app/src/lib/api/rate-limits.ts.`,
    ).toEqual([])

    expect(
      mismatched,
      `TIER_LIMITS values drift from public.plans: ${JSON.stringify(mismatched, null, 2)}. ` +
        `Update app/src/lib/api/rate-limits.ts to match the DB.`,
    ).toEqual([])
  })

  it('api_keys.rate_tier enum values all have TIER_LIMITS entries (defensive)', async () => {
    // Per migration 20260520000001, rate_tier CHECK is:
    //   ('starter','growth','pro','enterprise','sandbox')
    // Every allowed value must resolve to a TIER_LIMITS entry — otherwise
    // the proxy falls back to 'starter' silently (limitsForTier() default).
    const ALLOWED_RATE_TIERS = ['starter', 'growth', 'pro', 'enterprise', 'sandbox']
    const missing = ALLOWED_RATE_TIERS.filter((t) => !TIER_LIMITS[t])
    expect(
      missing,
      `TIER_LIMITS is missing entries for api_keys.rate_tier values: ${missing.join(', ')}.`,
    ).toEqual([])
  })
})
