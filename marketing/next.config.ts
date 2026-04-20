import type { NextConfig } from 'next'

// ADR-0501 Phase 4 Sprint 4.1 — security headers.
//
// CSP ships in *report-only* mode first. It will be flipped to enforce
// mode (header name `Content-Security-Policy`) in a follow-up sprint
// once the browser-reported violations (Next.js inline scripts, font
// preload behaviour) are catalogued. This gives us a zero-risk initial
// rollout: the browser only reports; nothing breaks.
//
// What the policy allows:
//   · self-origin for everything by default
//   · fontshare.com (Satoshi wordmark) — used by layout.tsx
//   · data: + https: for images (SVG icons + external social cards)
//   · inline scripts + eval (Next.js runtime) — to be tightened via nonce
//     when we move to enforce mode
//   · form posts only to self
//   · no framing (CSP + X-Frame-Options belt-and-suspenders)
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://cdn.fontshare.com",
  "img-src 'self' data: https:",
  "font-src 'self' https://cdn.fontshare.com data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ')

const SECURITY_HEADERS = [
  // HSTS — 2-year max-age + includeSubDomains + preload-ready.
  // Only emitted on production-like deployments; local dev http:// stays
  // un-upgraded. Next.js always sends the header regardless of scheme,
  // but browsers ignore it over http.
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
  {
    key: 'Content-Security-Policy-Report-Only',
    value: CSP_REPORT_ONLY,
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

export default nextConfig
