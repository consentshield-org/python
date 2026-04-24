// ADR-1015 Phase 1 Sprint 1.3 — Search-palette index.
//
// Flat list of searchable entries. Bootstrapped from DOCS_NAV so every
// sidebar entry is findable on day one. As Sprint 2.x authors MDX
// pages with headings, a future sprint extends this to walk the MDX
// AST at build time and append each `<h2>` / `<h3>` as a nested entry.
//
// v1 is author-maintained. Keep entries in the same order you'd rank
// them: most-visited first within each group.

import { DOCS_NAV } from './nav'

export interface SearchEntry {
  id: string
  label: string
  /** Group label (appears as a muted header in the palette). */
  group: string
  href: string
  /** Optional one-line description surfaced under the label. */
  description?: string
  /** Optional keywords for fuzzy match (author-curated). */
  keywords?: string[]
}

// Authored overrides: pages where the sidebar label is too terse for
// search. Descriptions show under the label in the palette.
const DESCRIPTIONS: Record<string, { description?: string; keywords?: string[] }> = {
  '/docs': { description: 'Developer Hub — pick a lane', keywords: ['hub', 'home', 'landing'] },
  '/docs/quickstart': { description: '15-minute path: issue a key, record a consent, verify it', keywords: ['getting started', 'setup', 'hello world'] },
  '/docs/authentication': { description: 'Bearer scheme, key prefixes, rotation', keywords: ['auth', 'bearer', 'keys', 'rotation'] },
  '/docs/rate-limits': { description: 'Plan-scoped limits + X-RateLimit headers + 429 handling', keywords: ['429', 'quota', 'throttle'] },
  '/docs/sdks': { description: 'Node / Python / Java / Go client libraries', keywords: ['libraries', 'client', 'package', 'npm', 'pypi'] },
  '/docs/concepts/dpdp-in-3-minutes': { description: 'DPDP Act summary', keywords: ['dpdp', 'law', 'act', 'privacy'] },
  '/docs/concepts/artefacts-vs-events': { description: 'When to record which', keywords: ['artefact', 'event', 'depa'] },
  '/docs/concepts/purpose-definitions': { description: 'Anatomy of a purpose row', keywords: ['purpose', 'legal basis'] },
  '/docs/concepts/rights-requests-lifecycle': { description: 'From submission to resolution', keywords: ['rights', 'dsar', 'access', 'erasure'] },
  '/docs/concepts/deletion-connectors': { description: 'Pre-built + custom fan-out', keywords: ['connector', 'webhook', 'erase'] },
  '/docs/concepts/key-rotation-and-tombstones': { description: '410 Gone after rotation', keywords: ['410', 'rotation', 'tombstone', 'revoke'] },
  '/docs/cookbook/record-consent-at-checkout': { description: 'Capture at purchase time without blocking', keywords: ['checkout', 'record', 'marketing'] },
  '/docs/cookbook/build-a-preference-center': { description: 'Customer self-service preference center', keywords: ['preference', 'center', 'settings'] },
  '/docs/cookbook/handle-a-rights-request': { description: 'End-to-end DPDP §13/§14 rights fulfilment', keywords: ['rights', 'dsar'] },
  '/docs/cookbook/wire-deletion-connector-webhook': { description: 'Own-endpoint webhook signed with HMAC', keywords: ['webhook', 'hmac', 'delete'] },
  '/docs/cookbook/batch-verify-consents': { description: 'Server-side batch verification', keywords: ['batch', 'verify'] },
  '/docs/cookbook/rotate-api-key-safely': { description: 'Zero-downtime rotation', keywords: ['rotation', 'keys', '410'] },
  '/docs/cookbook/build-dpb-audit-export': { description: 'Data Protection Board export package', keywords: ['audit', 'export', 'dpb', 'compliance'] },
  '/docs/api': { description: 'Interactive Scalar playground for every endpoint', keywords: ['playground', 'try', 'scalar'] },
  '/docs/errors': { description: 'Every error.code the /v1/* surface can return', keywords: ['error', 'code', '4xx', '5xx'] },
  '/docs/webhook-signatures': { description: 'HMAC-SHA256 scheme + replay defence', keywords: ['hmac', 'signature', 'webhook'] },
  '/docs/changelog': { description: 'API-specific changelog (distinct from product changelog)', keywords: ['changelog', 'versions', 'releases'] },
  '/openapi.yaml': { description: 'Full OpenAPI 3.1 spec', keywords: ['openapi', 'yaml', 'spec'] },
  'https://status.consentshield.in': { description: 'Status page + uptime', keywords: ['status', 'uptime', 'outage'] },
}

export function buildSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = []
  for (const group of DOCS_NAV) {
    for (const link of group.links) {
      const extra = DESCRIPTIONS[link.href] ?? {}
      entries.push({
        id: `${group.title}::${link.href}`,
        label: link.label,
        group: group.title,
        href: link.href,
        description: extra.description,
        keywords: extra.keywords,
      })
    }
  }
  return entries
}

export const SEARCH_INDEX: SearchEntry[] = buildSearchIndex()

/**
 * Simple subsequence-match fuzzy scorer. Not perfect (doesn't weight
 * proximity or recent-use), but good enough for ~40 entries without
 * pulling a library (Rule 15).
 *
 * Returns a score in [0, 1]; 0 = no match. Higher = better.
 */
export function scoreEntry(entry: SearchEntry, query: string): number {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const hay = [
    entry.label,
    entry.description ?? '',
    ...(entry.keywords ?? []),
    entry.group,
    entry.href,
  ]
    .join(' ')
    .toLowerCase()

  // Exact substring in label — highest priority.
  if (entry.label.toLowerCase().includes(q)) return 1

  // Exact substring in any field.
  if (hay.includes(q)) return 0.75

  // Subsequence match on label.
  let qi = 0
  for (let i = 0; i < entry.label.length && qi < q.length; i++) {
    if (entry.label[i]?.toLowerCase() === q[qi]) qi++
  }
  if (qi === q.length) return 0.5

  // Subsequence match across all fields.
  qi = 0
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) qi++
  }
  if (qi === q.length) return 0.25

  return 0
}

export function searchEntries(query: string, limit = 10): SearchEntry[] {
  if (query.trim().length === 0) {
    // Empty query → return a curated top list.
    return SEARCH_INDEX.filter((e) =>
      [
        '/docs',
        '/docs/quickstart',
        '/docs/api',
        '/docs/authentication',
        '/docs/errors',
        '/docs/cookbook/record-consent-at-checkout',
      ].includes(e.href),
    ).slice(0, limit)
  }
  return SEARCH_INDEX.map((e) => ({ entry: e, score: scoreEntry(e, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.entry)
}
