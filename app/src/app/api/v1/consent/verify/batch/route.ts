import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { API_HDR } from '@/lib/api/context'
import { problemJson } from '@/lib/api/auth'
import { logApiRequest } from '@/lib/api/log-request'
import { verifyConsentBatch } from '@/lib/consent/verify'
import type { ApiKeyContext } from '@/lib/api/auth'

// ADR-1002 Sprint 1.3 — POST /v1/consent/verify/batch
//
// Request body:
//   {
//     "property_id": "uuid",
//     "identifier_type": "email" | "phone" | "pan" | "aadhaar" | "custom",
//     "purpose_code": "marketing",
//     "identifiers": ["user1@x.com", "user2@x.com", ...]   // ≤ 10000
//   }
//
// Response (200):
//   {
//     "property_id", "identifier_type", "purpose_code", "evaluated_at",
//     "results": [ { identifier, status, active_artefact_id?, ... }, ... ]  // input order preserved
//   }
//
// Error responses (problem+json):
//   400 — account-scoped key (org required)
//   403 — scope missing
//   404 — property_not_found
//   413 — identifiers > 10000
//   422 — missing field / empty identifiers / bad identifier_type / bad JSON

const PROBLEM = { 'Content-Type': 'application/problem+json' }
const ROUTE = '/api/v1/consent/verify/batch'
const MAX_IDENTIFIERS = 10000

function respond(
  context: ApiKeyContext,
  status: number,
  body: unknown,
  t0: number,
  isProblem = false,
): NextResponse {
  const latency = t0 ? Date.now() - t0 : 0
  logApiRequest(context, ROUTE, 'POST', status, latency)
  return NextResponse.json(body, {
    status,
    headers: isProblem ? PROBLEM : {},
  })
}

export async function POST(request: NextRequest) {
  const hdrs = await headers()
  const t0 = parseInt(hdrs.get(API_HDR.requestStart) ?? '0', 10)

  const context: ApiKeyContext = {
    key_id:     hdrs.get(API_HDR.keyId) ?? '',
    account_id: hdrs.get(API_HDR.accountId) ?? '',
    org_id:     hdrs.get(API_HDR.orgId) || null,
    scopes:     (hdrs.get(API_HDR.scopes) ?? '').split(',').filter(Boolean),
    rate_tier:  hdrs.get(API_HDR.rateTier) ?? '',
  }

  if (!context.scopes.includes('read:consent')) {
    return respond(
      context,
      403,
      problemJson(403, 'Forbidden', 'This key does not have the required scope: read:consent'),
      t0,
      true,
    )
  }

  if (!context.org_id) {
    return respond(
      context,
      400,
      problemJson(
        400,
        'Bad Request',
        'API key is account-scoped — /v1/consent/verify/batch requires an org-scoped key',
      ),
      t0,
      true,
    )
  }

  // Body parse
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return respond(
      context,
      422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be valid JSON'),
      t0,
      true,
    )
  }

  if (!body || typeof body !== 'object') {
    return respond(
      context,
      422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be a JSON object'),
      t0,
      true,
    )
  }

  const { property_id, identifier_type, purpose_code, identifiers } = body as Record<string, unknown>

  const missing: string[] = []
  if (!property_id || typeof property_id !== 'string')         missing.push('property_id')
  if (!identifier_type || typeof identifier_type !== 'string') missing.push('identifier_type')
  if (!purpose_code || typeof purpose_code !== 'string')       missing.push('purpose_code')
  if (!Array.isArray(identifiers))                              missing.push('identifiers')

  if (missing.length > 0) {
    return respond(
      context,
      422,
      problemJson(
        422,
        'Unprocessable Entity',
        `Missing or invalid fields: ${missing.join(', ')}`,
      ),
      t0,
      true,
    )
  }

  const ids = identifiers as unknown[]

  if (ids.length === 0) {
    return respond(
      context,
      422,
      problemJson(422, 'Unprocessable Entity', 'identifiers array must not be empty'),
      t0,
      true,
    )
  }

  if (ids.length > MAX_IDENTIFIERS) {
    return respond(
      context,
      413,
      problemJson(
        413,
        'Payload Too Large',
        `identifiers length ${ids.length} exceeds limit ${MAX_IDENTIFIERS}`,
      ),
      t0,
      true,
    )
  }

  // Every element must be a string.
  for (let i = 0; i < ids.length; i++) {
    if (typeof ids[i] !== 'string' || !ids[i]) {
      return respond(
        context,
        422,
        problemJson(
          422,
          'Unprocessable Entity',
          `identifiers[${i}] must be a non-empty string`,
        ),
        t0,
        true,
      )
    }
  }

  const result = await verifyConsentBatch({
    orgId:          context.org_id,
    propertyId:     property_id as string,
    identifiers:    ids as string[],
    identifierType: identifier_type as string,
    purposeCode:    purpose_code as string,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'property_not_found':
        return respond(
          context,
          404,
          problemJson(404, 'Not Found', 'property_id does not belong to your org'),
          t0,
          true,
        )
      case 'identifiers_empty':
        return respond(
          context,
          422,
          problemJson(422, 'Unprocessable Entity', 'identifiers array must not be empty'),
          t0,
          true,
        )
      case 'identifiers_too_large':
        return respond(context, 413, problemJson(413, 'Payload Too Large', result.error.detail), t0, true)
      case 'invalid_identifier':
        return respond(context, 422, problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      default:
        return respond(
          context,
          500,
          problemJson(500, 'Internal Server Error', 'Verification failed'),
          t0,
          true,
        )
    }
  }

  return respond(context, 200, result.data, t0)
}
