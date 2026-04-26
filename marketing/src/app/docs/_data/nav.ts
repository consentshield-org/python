// ADR-1015 Phase 1 Sprint 1.1 — Sidebar taxonomy for /docs/*.
//
// Source of truth for the docs sidebar. Mirrors the taxonomy in
// docs/design/screen designs and ux/consentshield-developer-docs.html.
// Every entry here MUST have a matching MDX page (or a live page for
// playground / external references). Sprint 2.x authors the pages;
// Sprint 4.1 audits cross-linking so nothing here is a dead end.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface NavLink {
  label: string
  href: string
  /** HTTP method pill for API-reference entries; undefined elsewhere. */
  method?: HttpMethod
  /** Pin text (e.g. "Try") for highlighted entries in the wireframe. */
  pin?: string
  /** `external` links open in a new tab and render a small icon. */
  external?: boolean
  /** Nested entries render one level indented beneath a sub-heading. */
  nested?: boolean
  /** Optional sub-heading that introduces this link's group (e.g. "Consent"). */
  subheading?: string
}

export interface NavGroup {
  title: string
  links: NavLink[]
}

export const DOCS_NAV: NavGroup[] = [
  {
    title: 'Get started',
    links: [
      { label: 'Developer Hub', href: '/docs' },
      { label: 'Quickstart — 15 min', href: '/docs/quickstart' },
      { label: 'Authentication', href: '/docs/authentication' },
      { label: 'Rate limits & quotas', href: '/docs/rate-limits' },
      { label: 'SDK availability', href: '/docs/sdks' },
      { label: 'Node.js (@consentshield/node)', href: '/docs/sdks/node', nested: true, subheading: 'SDKs' },
      { label: 'Python (consentshield)', href: '/docs/sdks/python', nested: true },
      { label: 'Go (consentshield-go)', href: '/docs/sdks/go', nested: true },
      { label: 'Java (Spring Boot)', href: '/docs/sdks/java', nested: true },
      { label: '.NET (ASP.NET Core)', href: '/docs/sdks/dotnet', nested: true },
      { label: 'PHP (Laravel / Symfony)', href: '/docs/sdks/php', nested: true },
    ],
  },
  {
    title: 'Core concepts',
    links: [
      { label: 'DPDP Act in 3 minutes', href: '/docs/concepts/dpdp-in-3-minutes' },
      { label: 'Artefacts vs. events', href: '/docs/concepts/artefacts-vs-events' },
      { label: 'Purpose definitions', href: '/docs/concepts/purpose-definitions' },
      { label: 'Rights requests lifecycle', href: '/docs/concepts/rights-requests-lifecycle' },
      { label: 'Deletion connectors', href: '/docs/concepts/deletion-connectors' },
      { label: 'Key rotation & tombstones', href: '/docs/concepts/key-rotation-and-tombstones' },
    ],
  },
  {
    title: 'Cookbook',
    links: [
      { label: 'Record consent at checkout', href: '/docs/cookbook/record-consent-at-checkout' },
      { label: 'Build a preference center', href: '/docs/cookbook/build-a-preference-center' },
      { label: 'Handle a rights request end-to-end', href: '/docs/cookbook/handle-a-rights-request' },
      { label: 'Wire a deletion-connector webhook', href: '/docs/cookbook/wire-deletion-connector-webhook' },
      { label: 'Batch-verify consents server-side', href: '/docs/cookbook/batch-verify-consents' },
      { label: 'Rotate an API key safely', href: '/docs/cookbook/rotate-api-key-safely' },
      { label: 'Build a DPB audit export', href: '/docs/cookbook/build-dpb-audit-export' },
    ],
  },
  {
    title: 'API Reference',
    links: [
      { label: 'Interactive playground', href: '/docs/api', pin: 'Try' },

      { label: '_ping', href: '/docs/api/health/ping', method: 'GET', nested: true, subheading: 'Health' },

      { label: '/consent/verify', href: '/docs/api/consent/verify', method: 'GET', nested: true, subheading: 'Consent' },
      { label: '/consent/verify/batch', href: '/docs/api/consent/verify-batch', method: 'POST', nested: true },
      { label: '/consent/record', href: '/docs/api/consent/record', method: 'POST', nested: true },
      { label: '/consent/artefacts', href: '/docs/api/consent/artefacts/list', method: 'GET', nested: true },
      { label: '/consent/artefacts/{id}', href: '/docs/api/consent/artefacts/get', method: 'GET', nested: true },
      { label: '/consent/artefacts/{id}/revoke', href: '/docs/api/consent/artefacts/revoke', method: 'POST', nested: true },
      { label: '/consent/events', href: '/docs/api/consent/events', method: 'GET', nested: true },

      { label: '/deletion/trigger', href: '/docs/api/deletion/trigger', method: 'POST', nested: true, subheading: 'Deletion' },
      { label: '/deletion/receipts', href: '/docs/api/deletion/receipts', method: 'GET', nested: true },

      { label: '/keys/self', href: '/docs/api/account/keys-self', method: 'GET', nested: true, subheading: 'Account & plans' },
      { label: '/usage', href: '/docs/api/account/usage', method: 'GET', nested: true },
      { label: '/purposes', href: '/docs/api/account/purposes', method: 'GET', nested: true },
      { label: '/properties', href: '/docs/api/account/properties', method: 'GET', nested: true },
      { label: '/plans', href: '/docs/api/account/plans', method: 'GET', nested: true },
    ],
  },
  {
    title: 'Reference',
    links: [
      { label: 'Error codes', href: '/docs/errors' },
      { label: 'Webhook signatures', href: '/docs/webhook-signatures' },
      { label: 'OpenAPI spec (YAML)', href: '/openapi.yaml', external: true },
      { label: 'API changelog', href: '/docs/changelog' },
      { label: 'Reproduce our tests', href: '/docs/test-verification' },
      { label: 'Sacrificial controls', href: '/docs/test-verification/controls' },
      { label: 'Mutation testing', href: '/docs/test-verification/mutation-testing' },
      { label: 'Status & uptime', href: 'https://status.consentshield.in', external: true },
    ],
  },
]
