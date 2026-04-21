// ADR-1001 Sprint 2.4 — rate tier limits.
// Mirrors public.plans.api_rate_limit_per_hour + api_burst (migration 20260601000001).
// Keep in sync with DB values when plan tiers change.

export interface TierLimits {
  perHour: number
  burst: number
}

export const TIER_LIMITS: Record<string, TierLimits> = {
  starter:       { perHour: 100,    burst: 20 },
  trial:         { perHour: 100,    burst: 20 },
  trial_starter: { perHour: 100,    burst: 20 },
  sandbox:       { perHour: 100,    burst: 20 },
  growth:        { perHour: 1000,   burst: 100 },
  pro:           { perHour: 10000,  burst: 500 },
  enterprise:    { perHour: 100000, burst: 2000 },
}

export function limitsForTier(rateTier: string): TierLimits {
  return TIER_LIMITS[rateTier] ?? TIER_LIMITS.starter
}
