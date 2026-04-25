import { withSentryConfig } from '@sentry/nextjs'
import createMDX from '@next/mdx'
import type { NextConfig } from 'next'

// ADR-0501 Phase 4 — security headers + Sentry wiring.
// ADR-1015 Phase 1 Sprint 1.1 — MDX pipeline for /docs/* developer docs.
//
// CSP (Sprint 4.1) ships in *report-only* mode first; enforce-mode
// cutover is a follow-up sprint once the browser-reported violations
// are catalogued.
//
// Allowed surfaces beyond 'self':
//   · fontshare.com (Satoshi wordmark, Sprint 2.1 layout)
//   · challenges.cloudflare.com (Turnstile widget, Sprint 4.2)
//   · *.ingest.sentry.io + *.sentry.io (Sentry events, Sprint 4.3)

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://cdn.fontshare.com",
  "img-src 'self' data: https:",
  "font-src 'self' https://cdn.fontshare.com data:",
  "connect-src 'self' https://*.ingest.sentry.io https://*.sentry.io https://app.consentshield.in http://localhost:3000",
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ')

const SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Confidential preview — server-side noindex / nofollow for any
  // crawler that ignored robots.ts and the document <meta name="robots">.
  // Includes an explicit `noai`/`noimageai` for AI-trainer compliance.
  {
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
  },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: CSP_REPORT_ONLY,
  },
]

const nextConfig: NextConfig = {
  // ADR-1015 Phase 1 Sprint 1.1 — MDX files are first-class page
  // extensions so /docs/concepts/foo.mdx auto-routes to /docs/concepts/foo.
  pageExtensions: ['ts', 'tsx', 'md', 'mdx'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

// ADR-1015 Phase 2 Sprint 2.1 — MDX plugin chain.
//   remark-gfm adds GitHub-flavoured markdown (tables, task-lists,
//     strikethrough, autolinks).
//   rehype-slug auto-generates id="slug" on every h1-h6 from the
//     heading text, so the ToC rail + in-page hash links work
//     without every page authoring explicit ids.
const withMDX = createMDX({
  options: {
    remarkPlugins: [['remark-gfm']],
    rehypePlugins: [['rehype-slug']],
  },
})

// Sentry wrapping — auto-loads sentry.{server,client,edge}.config.ts from
// project root. Source-map upload is a no-op in local dev; kicks in when
// SENTRY_AUTH_TOKEN is provided (Vercel env at deploy time).
export default withSentryConfig(withMDX(nextConfig), {
  org: 'consentshield',
  project: 'consentshield-marketing',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  disableLogger: true,
  automaticVercelMonitors: false,
})
