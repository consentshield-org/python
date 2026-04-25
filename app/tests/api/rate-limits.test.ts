// ADR-1014 Phase 4 Sprint 4.3 — unit coverage for app/src/lib/api/rate-limits.ts.
//
// `limitsForTier` is a single-line dictionary lookup with a fallback to
// the `starter` tier. Mutation testing surfaces two classes of risk here:
//   - dropped-or-flipped fallback (mutant: `?? TIER_LIMITS.<other>`)
//   - per-tier value swaps (mutant: any of `100/1000/10000/100000` becomes 0)
// Both classes get killed by enumerating every known tier + asserting the
// exact perHour/burst pair from the migration.

import { describe, it, expect } from 'vitest'
import { TIER_LIMITS, limitsForTier } from '@/lib/api/rate-limits'

describe('TIER_LIMITS shape', () => {
  it('exposes the canonical seven tiers', () => {
    expect(Object.keys(TIER_LIMITS).sort()).toEqual([
      'enterprise',
      'growth',
      'pro',
      'sandbox',
      'starter',
      'trial',
      'trial_starter',
    ])
  })

  it.each([
    ['starter',       100,    20],
    ['trial',         100,    20],
    ['trial_starter', 100,    20],
    ['sandbox',       100,    20],
    ['growth',        1000,   100],
    ['pro',           10000,  500],
    ['enterprise',    100000, 2000],
  ])('tier %s = perHour %d / burst %d (mirrors public.plans)', (tier, perHour, burst) => {
    expect(TIER_LIMITS[tier]).toEqual({ perHour, burst })
  })
})

describe('limitsForTier', () => {
  it.each([
    ['starter',       100,    20],
    ['trial',         100,    20],
    ['trial_starter', 100,    20],
    ['sandbox',       100,    20],
    ['growth',        1000,   100],
    ['pro',           10000,  500],
    ['enterprise',    100000, 2000],
  ])('returns %s = perHour %d / burst %d', (tier, perHour, burst) => {
    expect(limitsForTier(tier)).toEqual({ perHour, burst })
  })

  it('falls back to STARTER limits for an unknown tier string', () => {
    expect(limitsForTier('not-a-real-tier')).toEqual({ perHour: 100, burst: 20 })
  })

  it('falls back to STARTER limits for an empty string (no implicit growth)', () => {
    expect(limitsForTier('')).toEqual({ perHour: 100, burst: 20 })
  })

  it('does NOT fall back to enterprise for unknown tiers (defends against fallback-flip mutant)', () => {
    const r = limitsForTier('nonexistent')
    expect(r.perHour).not.toBe(100000)
    expect(r.burst).not.toBe(2000)
  })

  it('does NOT fall back to growth/pro for unknown tiers', () => {
    const r = limitsForTier('zzzz')
    expect(r.perHour).not.toBe(1000)
    expect(r.perHour).not.toBe(10000)
  })

  it('returns object reference equal to TIER_LIMITS entry for known tiers (no copy semantics promised)', () => {
    expect(limitsForTier('pro')).toBe(TIER_LIMITS.pro)
  })

  it('returns the starter object reference for the fallback path', () => {
    // Asserts that the `??` falls through to TIER_LIMITS.starter, not a
    // freshly-allocated literal. Defends against a mutant that replaces
    // the fallback expression.
    expect(limitsForTier('zzz')).toBe(TIER_LIMITS.starter)
  })
})
