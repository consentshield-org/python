import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { listEvents } from '@/lib/consent/read'

// ADR-1002 Sprint 3.1 — GET /v1/consent/events
//
// Paged summary (no payloads). Query: property_id, created_after, created_before,
// source (web|api|sdk), cursor, limit. Scope: read:consent.

const ROUTE = '/api/v1/consent/events'

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:consent')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const property_id    = url.searchParams.get('property_id')    || undefined
  const created_after  = url.searchParams.get('created_after')  || undefined
  const created_before = url.searchParams.get('created_before') || undefined
  const source         = url.searchParams.get('source')         || undefined
  const cursor         = url.searchParams.get('cursor')         || undefined

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

  for (const [name, v] of [['created_after', created_after], ['created_before', created_before]]) {
    if (v !== undefined && isNaN(new Date(v).getTime())) {
      return respondV1(
        context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', `${name} must be a valid ISO 8601 timestamp`),
        t0, true,
      )
    }
  }

  if (source !== undefined && !['web', 'api', 'sdk'].includes(source)) {
    return respondV1(
      context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'source must be one of: web, api, sdk'),
      t0, true,
    )
  }

  const result = await listEvents({
    orgId:         context.org_id!,
    propertyId:    property_id,
    createdAfter:  created_after,
    createdBefore: created_before,
    source,
    cursor,
    limit,
  })

  if (!result.ok) {
    if (result.error.kind === 'bad_cursor') {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
    }
    return respondV1(context, ROUTE, 'GET', 500,
      problemJson(500, 'Internal Server Error', 'List failed'), t0, true)
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
