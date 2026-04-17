// ADR-0041 Sprint 1.5 — pure tracker-signature matching module.
//
// Shared between the ADR-0041 Vercel Sandbox orchestrator and the
// deprecated ADR-0016 static-HTML runner. Takes a list of URLs (script
// srcs, iframe srcs, network requests, etc.) and a list of tracker
// signatures. Returns detected trackers deduplicated by (service_slug,
// matched_pattern).
//
// No DB access, no side effects — easy to unit-test.

export interface Signature {
  service_slug: string
  category: string
  is_functional: boolean
  detection_rules: Array<{ type: string; pattern: string; confidence?: number }>
}

export interface Detection {
  slug: string
  category: string
  functional: boolean
  url: string
  matched_pattern: string
}

export interface Violation {
  slug: string
  category: string
  reason: 'loaded_without_consent' | 'loaded_against_denied_state'
}

export function matchSignatures(urls: string[], sigs: Signature[]): Detection[] {
  const seen = new Set<string>()
  const out: Detection[] = []

  for (const url of urls) {
    for (const sig of sigs) {
      for (const rule of sig.detection_rules) {
        if (rule.type !== 'script_src' && rule.type !== 'resource_url') continue
        if (url.includes(rule.pattern)) {
          const key = `${sig.service_slug}:${rule.pattern}`
          if (seen.has(key)) continue
          seen.add(key)
          out.push({
            slug: sig.service_slug,
            category: sig.category,
            functional: sig.is_functional,
            url,
            matched_pattern: rule.pattern,
          })
        }
      }
    }
  }

  return out
}

// Given detected trackers + the probe's declared consent_state, compute
// which detections count as violations. A non-functional tracker loaded
// when its category is not in the consent_state (or is false) is a
// violation. Functional trackers are exempt.
export function computeViolations(
  detections: Detection[],
  consentState: Record<string, boolean>,
): Violation[] {
  const out: Violation[] = []
  for (const d of detections) {
    if (d.functional) continue
    const consented = Boolean(consentState[d.category])
    if (!consented) {
      out.push({
        slug: d.slug,
        category: d.category,
        reason: d.category in consentState
          ? 'loaded_against_denied_state'
          : 'loaded_without_consent',
      })
    }
  }
  return out
}

export function overallStatus(violations: Violation[]): 'ok' | 'violations' {
  return violations.length > 0 ? 'violations' : 'ok'
}
