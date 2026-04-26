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
  '/docs/sdks': { description: 'Six SDKs across two tiers — Node/Python/Go (hand-rolled) + Java/.NET/PHP (OpenAPI-generated)', keywords: ['libraries', 'client', 'package', 'npm', 'pypi', 'go module', 'maven', 'nuget', 'packagist'] },
  '/docs/sdks/node': { description: '@consentshield/node — TypeScript-first SDK with sync + async surface (npm install)', keywords: ['node', 'typescript', 'npm', '@consentshield/node', 'express', 'nextjs', 'fail-open', 'fail-closed'] },
  '/docs/sdks/python': { description: 'consentshield (PyPI) — sync + async clients with httpx (pip install)', keywords: ['python', 'pypi', 'pip', 'consentshield', 'django', 'flask', 'fastapi', 'asyncio', 'httpx'] },
  '/docs/sdks/go': { description: 'github.com/SAnegondhi/consentshield-go — context.Context-first idiomatic Go (go get)', keywords: ['go', 'golang', 'go module', 'gin', 'chi', 'net/http', 'context', 'paginator'] },
  '/docs/sdks/java': { description: 'consentshield-java-spring-boot-starter — Spring Boot 3 auto-config + raw Maven Central artefact (JDK 11+)', keywords: ['java', 'maven', 'maven central', 'spring boot', 'spring', 'okhttp', 'consentshield-java'] },
  '/docs/sdks/dotnet': { description: 'ConsentShield.Client.AspNetCore — IServiceCollection.AddConsentShield + IHttpClientFactory + DelegatingHandler (NuGet)', keywords: ['dotnet', '.net', 'nuget', 'aspnetcore', 'asp.net core', 'csharp', 'c#', 'ihttpclientfactory'] },
  '/docs/sdks/php': { description: 'consentshield/sdk — Guzzle 7 PSR-18 client + Laravel 11 + Symfony 7 examples (Packagist, PHP 8.1+)', keywords: ['php', 'packagist', 'composer', 'laravel', 'symfony', 'guzzle', 'psr-18'] },
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
  '/docs/errors': { description: 'Every /v1/* error — RFC 7807 problem+json, retry guidance, remediation', keywords: ['error', 'code', '4xx', '5xx', 'problem', 'rfc7807', '401', '403', '410', '422', '429'] },
  '/docs/webhook-signatures': { description: 'HMAC-SHA256 scheme + replay defence + raw-body gotcha', keywords: ['hmac', 'signature', 'webhook', 'verify', 'sha256', 'signing secret'] },
  '/docs/changelog': { description: 'API-specific changelog (distinct from product changelog)', keywords: ['changelog', 'versions', 'releases', 'deprecation', 'sunset'] },
  '/docs/status': { description: 'Platform health + uptime targets + incident notifications', keywords: ['status', 'uptime', 'incident', 'sla', 'downtime'] },
  '/docs/test-verification': { description: 'Partner reproduction — clone, bootstrap, run E2E against your own Supabase, verify sealed evidence', keywords: ['reproduce', 'partner', 'audit', 'e2e', 'evidence', 'reproducibility', 'sealed', 'manifest', 'bootstrap'] },
  '/docs/test-verification/controls': { description: 'Sacrificial controls — 8 intentionally-broken tests that prove the harness is honest', keywords: ['sacrificial', 'controls', 'test.fail', 'inversion', 'harness', 'discipline', 'gate', 'ci', 'canary'] },
  '/docs/test-verification/mutation-testing': { description: 'Stryker mutation testing — flips operators in production code and re-runs the suite; survivors expose weak assertions', keywords: ['stryker', 'mutation', 'mutant', 'kill', 'survived', 'equivalent', 'threshold', 'gate', 'assertion'] },
  '/openapi.yaml': { description: 'Full OpenAPI 3.1 spec', keywords: ['openapi', 'yaml', 'spec'] },
  'https://status.consentshield.in': { description: 'Status page + uptime', keywords: ['status', 'uptime', 'outage'] },
}

// Pages that don't have a matching DOCS_NAV entry but should still be
// findable via Cmd-K. The sidebar's "Status & uptime" goes direct to
// the external status page; /docs/status is a pointer landing surface
// for bookmarks + cross-page references.
const STANDALONE_ENTRIES: SearchEntry[] = [
  {
    id: 'Reference::/docs/status',
    label: 'Status & uptime (page)',
    group: 'Reference',
    href: '/docs/status',
    description: DESCRIPTIONS['/docs/status']?.description,
    keywords: DESCRIPTIONS['/docs/status']?.keywords,
  },
]

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
  entries.push(...STANDALONE_ENTRIES)
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
