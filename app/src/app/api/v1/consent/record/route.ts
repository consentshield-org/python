import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { API_HDR } from '@/lib/api/context'
import { problemJson } from '@/lib/api/auth'
import { logApiRequest } from '@/lib/api/log-request'
import { recordConsent } from '@/lib/consent/record'
import type { ApiKeyContext } from '@/lib/api/auth'

// ADR-1002 Sprint 2.1 — POST /v1/consent/record
//
// Mode B server-to-server consent capture. Body:
//   {
//     "property_id": "uuid",
//     "data_principal_identifier": "user@example.com",
//     "identifier_type": "email",
//     "purpose_definition_ids": ["uuid1", "uuid2"],         // granted
//     "rejected_purpose_definition_ids": ["uuid3"],         // optional, audit-only
//     "captured_at": "2026-04-20T10:00:00Z",                // ±15 min of server
//     "client_request_id": "opaque-dedup-key"               // optional; if reused, returns existing envelope
//   }
//
// Scope: write:consent. Creates one artefact per accepted purpose; no
// artefact is created for rejected purposes (they're recorded on the
// consent_events audit row only).

const PROBLEM = { 'Content-Type': 'application/problem+json' }
const ROUTE = '/api/v1/consent/record'

function respond(
  context: ApiKeyContext,
  status: number,
  body: unknown,
  t0: number,
  isProblem = false,
): NextResponse {
  const latency = t0 ? Date.now() - t0 : 0
  logApiRequest(context, ROUTE, 'POST', status, latency)
  return NextResponse.json(body, { status, headers: isProblem ? PROBLEM : {} })
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

  if (!context.scopes.includes('write:consent')) {
    return respond(
      context, 403,
      problemJson(403, 'Forbidden', 'This key does not have the required scope: write:consent'),
      t0, true,
    )
  }

  if (!context.org_id) {
    return respond(
      context, 400,
      problemJson(400, 'Bad Request', 'API key is account-scoped — /v1/consent/record requires an org-scoped key'),
      t0, true,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return respond(context, 422, problemJson(422, 'Unprocessable Entity', 'Request body must be valid JSON'), t0, true)
  }
  if (!body || typeof body !== 'object') {
    return respond(context, 422, problemJson(422, 'Unprocessable Entity', 'Request body must be a JSON object'), t0, true)
  }

  const {
    property_id,
    data_principal_identifier,
    identifier_type,
    purpose_definition_ids,
    rejected_purpose_definition_ids,
    captured_at,
    client_request_id,
  } = body as Record<string, unknown>

  const missing: string[] = []
  if (typeof property_id !== 'string' || !property_id)                 missing.push('property_id')
  if (typeof data_principal_identifier !== 'string' || !data_principal_identifier) missing.push('data_principal_identifier')
  if (typeof identifier_type !== 'string' || !identifier_type)         missing.push('identifier_type')
  if (!Array.isArray(purpose_definition_ids))                           missing.push('purpose_definition_ids')
  if (typeof captured_at !== 'string' || !captured_at)                  missing.push('captured_at')

  if (missing.length > 0) {
    return respond(
      context, 422,
      problemJson(422, 'Unprocessable Entity', `Missing or invalid fields: ${missing.join(', ')}`),
      t0, true,
    )
  }

  const acceptedIds = purpose_definition_ids as unknown[]
  if (acceptedIds.length === 0) {
    return respond(
      context, 422,
      problemJson(422, 'Unprocessable Entity', 'purpose_definition_ids must contain at least one id'),
      t0, true,
    )
  }
  for (let i = 0; i < acceptedIds.length; i++) {
    if (typeof acceptedIds[i] !== 'string' || !acceptedIds[i]) {
      return respond(
        context, 422,
        problemJson(422, 'Unprocessable Entity', `purpose_definition_ids[${i}] must be a non-empty string`),
        t0, true,
      )
    }
  }

  let rejectedIds: string[] | undefined
  if (rejected_purpose_definition_ids !== undefined && rejected_purpose_definition_ids !== null) {
    if (!Array.isArray(rejected_purpose_definition_ids)) {
      return respond(
        context, 422,
        problemJson(422, 'Unprocessable Entity', 'rejected_purpose_definition_ids must be an array'),
        t0, true,
      )
    }
    rejectedIds = []
    for (let i = 0; i < rejected_purpose_definition_ids.length; i++) {
      const v = rejected_purpose_definition_ids[i]
      if (typeof v !== 'string' || !v) {
        return respond(
          context, 422,
          problemJson(422, 'Unprocessable Entity', `rejected_purpose_definition_ids[${i}] must be a non-empty string`),
          t0, true,
        )
      }
      rejectedIds.push(v)
    }
  }

  // captured_at format + range sanity
  const capturedDate = new Date(captured_at as string)
  if (isNaN(capturedDate.getTime())) {
    return respond(
      context, 422,
      problemJson(422, 'Unprocessable Entity', 'captured_at must be a valid ISO 8601 timestamp'),
      t0, true,
    )
  }

  if (client_request_id !== undefined && client_request_id !== null && typeof client_request_id !== 'string') {
    return respond(
      context, 422,
      problemJson(422, 'Unprocessable Entity', 'client_request_id must be a string'),
      t0, true,
    )
  }

  const result = await recordConsent({
    keyId:              context.key_id,
    orgId:              context.org_id,
    propertyId:         property_id as string,
    identifier:         data_principal_identifier as string,
    identifierType:     identifier_type as string,
    acceptedPurposeIds: acceptedIds as string[],
    rejectedPurposeIds: rejectedIds,
    capturedAt:         captured_at as string,
    clientRequestId:    (client_request_id as string | undefined) ?? undefined,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respond(context, 403, problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'property_not_found':
        return respond(context, 404, problemJson(404, 'Not Found', 'property_id does not belong to your org'), t0, true)
      case 'captured_at_missing':
      case 'captured_at_stale':
      case 'purposes_empty':
      case 'invalid_purpose_ids':
      case 'invalid_identifier':
        return respond(
          context, 422,
          problemJson(422, 'Unprocessable Entity',
            result.error.kind === 'captured_at_missing' ? 'captured_at is required'
              : 'detail' in result.error ? result.error.detail : result.error.kind,
          ),
          t0, true,
        )
      default:
        return respond(
          context, 500,
          problemJson(500, 'Internal Server Error', 'Consent record failed'),
          t0, true,
        )
    }
  }

  return respond(context, result.data.idempotent_replay ? 200 : 201, result.data, t0)
}
