import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { listProperties } from '@/lib/api/discovery'

// ADR-1012 Sprint 1.2 — GET /v1/properties
//
// Lists web_properties for the caller's org. Required for any /v1/consent/*
// call: property_id / valid allowed_origins come from here. The HMAC
// event_signing_secret is deliberately NOT returned (server-only HMAC key;
// enforced by the rpc_property_list RPC at the DB layer).
//
// Scope: read:consent. Account-scoped keys → 400.
//
// 200 — PropertyListEnvelope
// 400 — account-scoped key
// 403 — missing scope or api_key_binding
// 401/410/429 — middleware

const ROUTE = '/api/v1/properties'

export async function GET() {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:consent')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const result = await listProperties({ keyId: context.key_id, orgId: context.org_id! })

  if (!result.ok) {
    if (result.error.kind === 'api_key_binding') {
      return respondV1(context, ROUTE, 'GET', 403,
        problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'),
        t0, true)
    }
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'Property listing failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
