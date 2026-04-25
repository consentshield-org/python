import Link from 'next/link'
import type { Metadata } from 'next'
import { Breadcrumb } from './_components/breadcrumb'
import { Callout } from './_components/callout'
import { FeedbackStrip } from './_components/feedback-strip'
import { ParamTable } from './_components/param-table'

// ADR-1015 Phase 2 Sprint 2.1 — Developer Hub landing.
// Wireframe: docs/design/screen designs and ux/consentshield-developer-docs.html §Page 1.

export const metadata: Metadata = {
  title: 'Developer Hub',
  description:
    'Build DPDP-compliant consent flows with the ConsentShield API — record, verify, revoke, and export consent artefacts the DPB treats as first-class evidence.',
}

export default function DocsHome() {
  return (
    <>
      <Breadcrumb trail={[{ label: 'Docs', href: '/docs' }, { label: 'Developer Hub' }]} />
      <h1 className="page-title">
        Build DPDP-compliant consent flows — without building a compliance engine.
      </h1>
      <p className="page-sub">
        The ConsentShield API lets you record, verify, revoke, and export
        consent artefacts that the DPDP Act treats as first-class evidence.
        This is the reference documentation for developers integrating the{' '}
        <code>/v1/*</code> surface. Pick a lane below.
      </p>

      <div className="card-grid">
        <Link href="/docs/quickstart" className="card">
          <div className="card-icon">⚡</div>
          <div className="card-title">Quickstart</div>
          <div className="card-sub">
            Record your first consent artefact in 15 minutes. From API key to
            verified receipt.
          </div>
          <div className="card-foot">GET STARTED →</div>
        </Link>
        <Link href="/docs/concepts/dpdp-in-3-minutes" className="card">
          <div className="card-icon">📖</div>
          <div className="card-title">Core concepts</div>
          <div className="card-sub">
            Artefacts, events, purposes, rights — the mental model behind the
            API. 10-minute read.
          </div>
          <div className="card-foot">READ →</div>
        </Link>
        <Link href="/docs/cookbook/record-consent-at-checkout" className="card">
          <div className="card-icon">🧑‍🍳</div>
          <div className="card-title">Cookbook</div>
          <div className="card-sub">
            Copy-paste recipes for the most common integrations — checkout,
            preference center, deletion.
          </div>
          <div className="card-foot">BROWSE →</div>
        </Link>
        <Link href="/docs/api" className="card">
          <div className="card-icon">⌘</div>
          <div className="card-title">API reference</div>
          <div className="card-sub">
            The full <code>/v1/*</code> reference — authentication,
            request/response schemas, errors, and an inline playground.
          </div>
          <div className="card-foot">EXPLORE →</div>
        </Link>
      </div>

      <h2 id="at-a-glance">At a glance</h2>
      <ParamTable
        params={[
          {
            name: 'Base URL',
            type: '',
            description: <code>https://api.consentshield.in/v1</code>,
          },
          {
            name: 'Authentication',
            type: '',
            description: (
              <>
                <code>Authorization: Bearer cs_live_&lt;api-key&gt;</code> —
                one key per organisation, rotatable without downtime. See{' '}
                <Link href="/docs/authentication">authentication</Link>.
              </>
            ),
          },
          {
            name: 'Endpoints',
            type: '',
            description: (
              <>
                REST endpoints across <code>health</code> ·{' '}
                <code>consent</code> · <code>deletion</code> ·{' '}
                <code>rights</code> · <code>security</code> ·{' '}
                <code>account</code>. Browse the{' '}
                <Link href="/docs/api">interactive reference</Link>.
              </>
            ),
          },
          {
            name: 'Rate limit',
            type: '',
            description: (
              <>
                Plan-scoped. <code>X-RateLimit-*</code> headers on every
                response. See <Link href="/docs/rate-limits">rate limits</Link>.
              </>
            ),
          },
          {
            name: 'SDKs',
            type: '',
            description:
              'cURL-first. Node.js + Python samples inline throughout the cookbook. Typed client libraries (Node / Python / Java / Go) ship in ADR-1006.',
          },
          {
            name: 'Data residency',
            type: '',
            description: (
              <>
                All processing in India. Buffer tables are ephemeral — see the{' '}
                <Link href="/docs/concepts/artefacts-vs-events">
                  stateless-oracle architecture
                </Link>
                .
              </>
            ),
          },
        ]}
      />

      <Callout tone="info" title="Not a developer?">
        The ConsentShield dashboard covers 90% of the product surface without
        writing code — banner configuration, rights-request console, DEPA
        artefacts, reports.{' '}
        <a href="https://consentshield.in/signup">Start a 30-day trial</a>.
      </Callout>

      <h2 id="stay-in-the-loop">Stay in the loop</h2>
      <p>
        The API is versioned and backwards-compatible. Subscribe to the{' '}
        <Link href="/docs/changelog">API changelog</Link> or follow status on{' '}
        <a
          href="https://status.consentshield.in"
          target="_blank"
          rel="noreferrer"
        >
          status.consentshield.in
        </a>
        .
      </p>

      <FeedbackStrip pagePath="marketing/src/app/docs/page.tsx" />
    </>
  )
}
