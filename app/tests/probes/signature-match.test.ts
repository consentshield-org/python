// ADR-0041 Sprint 1.5 — signature-match unit tests.

import { describe, it, expect } from 'vitest'
import {
  matchSignatures,
  computeViolations,
  overallStatus,
  type Signature,
} from '@/lib/probes/signature-match'

const sigs: Signature[] = [
  {
    service_slug: 'google_analytics_4',
    category: 'analytics',
    is_functional: false,
    detection_rules: [
      { type: 'script_src', pattern: 'googletagmanager.com/gtag/js' },
      { type: 'resource_url', pattern: 'google-analytics.com/collect' },
    ],
  },
  {
    service_slug: 'meta_pixel',
    category: 'marketing',
    is_functional: false,
    detection_rules: [{ type: 'script_src', pattern: 'connect.facebook.net/en_US/fbevents.js' }],
  },
  {
    service_slug: 'cloudflare_functional',
    category: 'functional',
    is_functional: true,
    detection_rules: [{ type: 'script_src', pattern: 'challenges.cloudflare.com/turnstile' }],
  },
]

describe('ADR-0041 matchSignatures', () => {
  it('detects a GA4 script URL', () => {
    const urls = ['https://www.googletagmanager.com/gtag/js?id=G-ABC']
    const out = matchSignatures(urls, sigs)
    expect(out).toEqual([
      {
        slug: 'google_analytics_4',
        category: 'analytics',
        functional: false,
        url: 'https://www.googletagmanager.com/gtag/js?id=G-ABC',
        matched_pattern: 'googletagmanager.com/gtag/js',
      },
    ])
  })

  it('deduplicates multiple URLs matching the same signature pattern', () => {
    const urls = [
      'https://www.googletagmanager.com/gtag/js?id=G-ONE',
      'https://www.googletagmanager.com/gtag/js?id=G-TWO',
    ]
    const out = matchSignatures(urls, sigs)
    expect(out.length).toBe(1)
  })

  it('detects multiple distinct services in one URL list', () => {
    const urls = [
      'https://www.googletagmanager.com/gtag/js?id=G-ONE',
      'https://connect.facebook.net/en_US/fbevents.js',
    ]
    const out = matchSignatures(urls, sigs)
    expect(out.map((d) => d.slug).sort()).toEqual(['google_analytics_4', 'meta_pixel'])
  })

  it('ignores unknown URLs', () => {
    expect(matchSignatures(['https://example.com/unrelated.js'], sigs)).toEqual([])
  })
})

describe('ADR-0041 computeViolations', () => {
  it('flags non-functional tracker loaded against denied state', () => {
    const detections = matchSignatures(
      ['https://www.googletagmanager.com/gtag/js?id=G-ABC'],
      sigs,
    )
    const violations = computeViolations(detections, { analytics: false, marketing: false })
    expect(violations).toEqual([
      {
        slug: 'google_analytics_4',
        category: 'analytics',
        reason: 'loaded_against_denied_state',
      },
    ])
  })

  it('does not flag functional tracker even if category is missing', () => {
    const detections = matchSignatures(
      ['https://challenges.cloudflare.com/turnstile/v0/api.js'],
      sigs,
    )
    const violations = computeViolations(detections, {})
    expect(violations).toEqual([])
  })

  it('does not flag when the category is consented', () => {
    const detections = matchSignatures(
      ['https://www.googletagmanager.com/gtag/js'],
      sigs,
    )
    const violations = computeViolations(detections, { analytics: true })
    expect(violations).toEqual([])
  })

  it('flags loaded_without_consent when the category is absent from the state', () => {
    const detections = matchSignatures(
      ['https://connect.facebook.net/en_US/fbevents.js'],
      sigs,
    )
    const violations = computeViolations(detections, { analytics: true })
    expect(violations).toEqual([
      {
        slug: 'meta_pixel',
        category: 'marketing',
        reason: 'loaded_without_consent',
      },
    ])
  })
})

describe('ADR-0041 overallStatus', () => {
  it("returns 'ok' when no violations", () => {
    expect(overallStatus([])).toBe('ok')
  })
  it("returns 'violations' when any present", () => {
    expect(
      overallStatus([
        { slug: 'x', category: 'analytics', reason: 'loaded_without_consent' },
      ]),
    ).toBe('violations')
  })
})
