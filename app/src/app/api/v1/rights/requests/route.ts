import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import {
  readContext,
  respondV1,
  gateScopeOrProblem,
  requireOrgOrProblem,
} from '@/lib/api/v1-helpers'
import {
  createRightsRequest,
  listRightsRequests,
  type RightsCapturedVia,
  type RightsRequestStatus,
  type RightsRequestType,
} from '@/lib/api/rights'

// ADR-1005 Sprint 5.1
//
// POST /v1/rights/requests  (scope: write:rights)
//   Body: { type, requestor_name, requestor_email, request_details?,
//           identity_verified_by, captured_via? }
//   Bypasses the public portal's Turnstile + OTP gate — the API-key caller
//   attests identity via identity_verified_by (free text: 'internal_kyc',
//   'operator_id_42', 'existing_session', etc.). Creates a rights_requests
//   row with identity_verified=true + captured_via=api (or caller-supplied
//   operator channel) and appends a rights_request_events audit row of
//   type created_via_api marking the originating API key.
//
// GET /v1/rights/requests  (scope: read:rights)
//   Keyset-paginated list for the caller's org. Filters: status,
//   request_type, captured_via, created_after, created_before.

const ROUTE = '/api/v1/rights/requests'

const VALID_TYPES: RightsRequestType[] = ['erasure', 'access', 'correction', 'nomination']
const VALID_STATUSES: RightsRequestStatus[] = ['new', 'in_progress', 'completed', 'rejected']
const VALID_CAPTURED_VIA: RightsCapturedVia[] = [
  'portal',
  'api',
  'kiosk',
  'branch',
  'call_center',
  'mobile_app',
  'email',
  'other',
]

// ── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'write:rights')
  if (scopeGate) return respondV1(context, ROUTE, 'POST', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'POST', orgGate.status, orgGate.body, t0, true)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be valid JSON'), t0, true)
  }
  if (!body || typeof body !== 'object') {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be a JSON object'), t0, true)
  }

  const {
    type,
    requestor_name,
    requestor_email,
    request_details,
    identity_verified_by,
    captured_via,
  } = body as Record<string, unknown>

  const missing: string[] = []
  if (typeof type !== 'string' || !type)                                         missing.push('type')
  if (typeof requestor_name !== 'string' || !requestor_name.trim())              missing.push('requestor_name')
  if (typeof requestor_email !== 'string' || !requestor_email.trim())            missing.push('requestor_email')
  if (typeof identity_verified_by !== 'string' || !identity_verified_by.trim()) missing.push('identity_verified_by')

  if (missing.length > 0) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', `Missing or invalid fields: ${missing.join(', ')}`), t0, true)
  }

  if (!VALID_TYPES.includes(type as RightsRequestType)) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', `type must be one of: ${VALID_TYPES.join(', ')}`), t0, true)
  }

  if (captured_via !== undefined && captured_via !== null) {
    if (typeof captured_via !== 'string' || !VALID_CAPTURED_VIA.includes(captured_via as RightsCapturedVia)) {
      return respondV1(context, ROUTE, 'POST', 422,
        problemJson(422, 'Unprocessable Entity', `captured_via must be one of: ${VALID_CAPTURED_VIA.join(', ')}`), t0, true)
    }
  }

  if (request_details !== undefined && request_details !== null && typeof request_details !== 'string') {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'request_details must be a string when provided'), t0, true)
  }

  const result = await createRightsRequest({
    keyId:              context.key_id,
    orgId:              context.org_id!,
    type:               type as RightsRequestType,
    requestorName:      (requestor_name as string).trim(),
    requestorEmail:     (requestor_email as string).trim(),
    requestDetails:     request_details === undefined || request_details === null
                          ? null
                          : (request_details as string),
    identityVerifiedBy: (identity_verified_by as string).trim(),
    capturedVia:        captured_via as RightsCapturedVia | undefined,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'POST', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'invalid_request_type':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', `type must be one of: ${VALID_TYPES.join(', ')}`), t0, true)
      case 'invalid_requestor_email':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', 'requestor_email must be a valid email address'), t0, true)
      case 'requestor_name_missing':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', 'requestor_name is required'), t0, true)
      case 'identity_verified_by_missing':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', 'identity_verified_by is required'), t0, true)
      default:
        return respondV1(context, ROUTE, 'POST', 500,
          problemJson(500, 'Internal Server Error', 'Rights-request creation failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'POST', 201, result.data, t0)
}

// ── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'read:rights')
  if (scopeGate) return respondV1(context, ROUTE, 'GET', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, ROUTE)
  if (orgGate) return respondV1(context, ROUTE, 'GET', orgGate.status, orgGate.body, t0, true)

  const url = new URL(request.url)
  const status         = url.searchParams.get('status') ?? undefined
  const requestType    = url.searchParams.get('request_type') ?? undefined
  const capturedVia    = url.searchParams.get('captured_via') ?? undefined
  const createdAfter   = url.searchParams.get('created_after') ?? undefined
  const createdBefore  = url.searchParams.get('created_before') ?? undefined
  const cursor         = url.searchParams.get('cursor') ?? undefined
  const limitRaw       = url.searchParams.get('limit')

  if (status && !VALID_STATUSES.includes(status as RightsRequestStatus)) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', `status must be one of: ${VALID_STATUSES.join(', ')}`), t0, true)
  }
  if (requestType && !VALID_TYPES.includes(requestType as RightsRequestType)) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', `request_type must be one of: ${VALID_TYPES.join(', ')}`), t0, true)
  }
  if (capturedVia && !VALID_CAPTURED_VIA.includes(capturedVia as RightsCapturedVia)) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', `captured_via must be one of: ${VALID_CAPTURED_VIA.join(', ')}`), t0, true)
  }
  if (createdAfter && Number.isNaN(Date.parse(createdAfter))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'created_after must be a valid ISO 8601 timestamp'), t0, true)
  }
  if (createdBefore && Number.isNaN(Date.parse(createdBefore))) {
    return respondV1(context, ROUTE, 'GET', 422,
      problemJson(422, 'Unprocessable Entity', 'created_before must be a valid ISO 8601 timestamp'), t0, true)
  }

  let limit: number | undefined
  if (limitRaw !== null) {
    limit = parseInt(limitRaw, 10)
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      return respondV1(context, ROUTE, 'GET', 422,
        problemJson(422, 'Unprocessable Entity', 'limit must be an integer between 1 and 200'), t0, true)
    }
  }

  const result = await listRightsRequests({
    keyId:         context.key_id,
    orgId:         context.org_id!,
    status:        status       as RightsRequestStatus | undefined,
    requestType:   requestType  as RightsRequestType  | undefined,
    capturedVia:   capturedVia  as RightsCapturedVia  | undefined,
    createdAfter,
    createdBefore,
    cursor,
    limit,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'GET', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'bad_cursor':
        return respondV1(context, ROUTE, 'GET', 422,
          problemJson(422, 'Unprocessable Entity', 'cursor is malformed'), t0, true)
      default:
        return respondV1(context, ROUTE, 'GET', 500,
          problemJson(500, 'Internal Server Error', 'Rights-request listing failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'GET', 200, result.data, t0)
}
