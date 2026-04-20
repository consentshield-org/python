import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { listArtefacts } from '@/lib/consent/read'

// ADR-1002 Sprint 3.1 — GET /v1/consent/artefacts
//
// Query params (all optional): property_id, data_principal_identifier + identifier_type
// (must be supplied together), status, purpose_code, expires_before, expires_after,
// cursor, limit (default 50, max 200). Scope: read:artefacts.

const ROUTE = '/api/v1/consent/artefacts'

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:artefacts')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const property_id     = url.searchParams.get('property_id')        || undefined
  const identifier      = url.searchParams.get('data_principal_identifier') || undefined
  const identifier_type = url.searchParams.get('identifier_type')    || undefined
  const status          = url.searchParams.get('status')             || undefined
  const purpose_code    = url.searchParams.get('purpose_code')       || undefined
  const expires_before  = url.searchParams.get('expires_before')     || undefined
  const expires_after   = url.searchParams.get('expires_after')      || undefined
  const cursor          = url.searchParams.get('cursor')             || undefined

  let limit: number | undefined
  const limitRaw = url.searchParams.get('limit')
  if (limitRaw !== null) {
    const n = parseInt(limitRaw, 10)
    if (isNaN(n) || n < 1 || n > 200) {
      return respondV1(
        context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'limit must be an integer between 1 and 200'),
        t0, true,
      )
    }
    limit = n
  }

  // Reject invalid date filters early — the DB will accept anything parseable.
  for (const [name, v] of [['expires_before', expires_before], ['expires_after', expires_after]]) {
    if (v !== undefined && isNaN(new Date(v).getTime())) {
      return respondV1(
        context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', `${name} must be a valid ISO 8601 timestamp`),
        t0, true,
      )
    }
  }

  const result = await listArtefacts({
    orgId:          context.org_id!,
    propertyId:     property_id,
    identifier,
    identifierType: identifier_type,
    status,
    purposeCode:    purpose_code,
    expiresBefore:  expires_before,
    expiresAfter:   expires_after,
    cursor,
    limit,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'bad_cursor':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
      case 'bad_filters':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      case 'invalid_identifier':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      default:
        return respondV1(context, ROUTE, 'GET', 500,
          problemJson(500, 'Internal Server Error', 'List failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
