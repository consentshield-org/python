import { redirect } from 'next/navigation'

// ADR-1015 Phase 1 Sprint 1.2 — per-endpoint deep-link shim.
//
// Sidebar links use structured URLs like /docs/api/consent/record
// (easier to share in cookbook recipes and client-library READMEs
// than raw anchor fragments). Scalar's client is anchor-driven
// (/docs/api#tag/consent/post/-v1-consent-record), so we redirect
// structured URLs onto Scalar's native anchor form.
//
// The anchor scheme mirrors Scalar's own — `tag/<group>/<method>/<path>`
// where <path> has `/` replaced by `-`. /docs/api (no catchall)
// continues to render the full interactive playground; only the
// structured deep links flow through here.

interface PageProps {
  params: Promise<{ path: string[] }>
}

// Every sidebar entry under API Reference in _data/nav.ts maps here.
// path[0] is the tag ("health" / "consent" / "deletion" / "account"),
// the rest segment identifies the endpoint. The mapping is authored
// inline rather than derived from the OpenAPI spec because we want
// the link format to stay stable even if the spec is restructured.

interface EndpointTarget {
  /** OpenAPI tag the endpoint belongs to (matches Scalar's sidebar grouping). */
  tag: string
  /** HTTP method, lowercase. */
  method: string
  /** Path template with leading slash. */
  path: string
}

const ENDPOINTS: Record<string, EndpointTarget> = {
  'health/ping':              { tag: 'Health',    method: 'get',  path: '/_ping' },
  'consent/verify':           { tag: 'Consent',   method: 'get',  path: '/consent/verify' },
  'consent/verify-batch':     { tag: 'Consent',   method: 'post', path: '/consent/verify/batch' },
  'consent/record':           { tag: 'Consent',   method: 'post', path: '/consent/record' },
  'consent/artefacts/list':   { tag: 'Consent',   method: 'get',  path: '/consent/artefacts' },
  'consent/artefacts/get':    { tag: 'Consent',   method: 'get',  path: '/consent/artefacts/{id}' },
  'consent/artefacts/revoke': { tag: 'Consent',   method: 'post', path: '/consent/artefacts/{id}/revoke' },
  'consent/events':           { tag: 'Consent',   method: 'get',  path: '/consent/events' },
  'deletion/trigger':         { tag: 'Deletion',  method: 'post', path: '/deletion/trigger' },
  'deletion/receipts':        { tag: 'Deletion',  method: 'get',  path: '/deletion/receipts' },
  'deletion/test-delete':     { tag: 'Deletion',  method: 'post', path: '/integrations/{connector_id}/test_delete' },
  'rights/requests':          { tag: 'Rights',    method: 'post', path: '/rights/requests' },
  'rights/requests-list':     { tag: 'Rights',    method: 'get',  path: '/rights/requests' },
  'audit/list':               { tag: 'Audit',     method: 'get',  path: '/audit' },
  'security/scans':           { tag: 'Security',  method: 'get',  path: '/security/scans' },
  'score':                    { tag: 'Score',     method: 'get',  path: '/score' },
  'account/keys-self':        { tag: 'Account',   method: 'get',  path: '/keys/self' },
  'account/usage':            { tag: 'Account',   method: 'get',  path: '/usage' },
  'account/purposes':         { tag: 'Account',   method: 'get',  path: '/purposes' },
  'account/properties':       { tag: 'Account',   method: 'get',  path: '/properties' },
  'account/plans':            { tag: 'Account',   method: 'get',  path: '/plans' },
}

export default async function ApiDeepLink({ params }: PageProps) {
  const { path } = await params
  const key = path.join('/')
  const target = ENDPOINTS[key]

  if (!target) {
    // Unknown deep link — fall back to the playground root.
    redirect('/docs/api')
  }

  // Scalar anchor format: tag/<tag>/<method>/<path-with-slashes-turned-to-dashes>
  // Path segments become dash-delimited; leading slash contributes a
  // leading dash; braces on `{id}` are replaced with `-`.
  const anchorPath = target.path
    .replace(/\//g, '-')
    .replace(/\{([^}]+)\}/g, '-$1-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
  const anchor = `tag/${target.tag.toLowerCase()}/${target.method}${anchorPath}`

  redirect(`/docs/api#${anchor}`)
}
