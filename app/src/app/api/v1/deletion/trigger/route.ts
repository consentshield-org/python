import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { triggerDeletion } from '@/lib/consent/deletion'

// ADR-1002 Sprint 4.1 — POST /v1/deletion/trigger
//
// Body:
//   {
//     "property_id": "uuid",
//     "data_principal_identifier": "user@x.com",
//     "identifier_type": "email",
//     "reason": "consent_revoked" | "erasure_request" | "retention_expired",
//     "purpose_codes": ["marketing"],    // required when reason=consent_revoked
//     "scope_override": ["email_addr"],  // optional for retention_expired (deferred)
//     "actor_type": "user" | "operator" | "system" (default user),
//     "actor_ref": "optional id"
//   }
//
// Scope: write:deletion.

const ROUTE = '/api/v1/deletion/trigger'
const VALID_REASONS = ['consent_revoked', 'erasure_request', 'retention_expired'] as const

export async function POST(request: NextRequest) {
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'write:deletion')
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
    property_id,
    data_principal_identifier,
    identifier_type,
    reason,
    purpose_codes,
    scope_override,
    actor_type,
    actor_ref,
  } = body as Record<string, unknown>

  const missing: string[] = []
  if (typeof property_id !== 'string' || !property_id)                            missing.push('property_id')
  if (typeof data_principal_identifier !== 'string' || !data_principal_identifier) missing.push('data_principal_identifier')
  if (typeof identifier_type !== 'string' || !identifier_type)                    missing.push('identifier_type')
  if (typeof reason !== 'string' || !reason)                                       missing.push('reason')

  if (missing.length > 0) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', `Missing or invalid fields: ${missing.join(', ')}`),
      t0, true)
  }

  if (!(VALID_REASONS as readonly string[]).includes(reason as string)) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity',
        `reason must be one of: ${VALID_REASONS.join(', ')}`),
      t0, true)
  }

  let purposeCodes: string[] | undefined
  if (purpose_codes !== undefined && purpose_codes !== null) {
    if (!Array.isArray(purpose_codes)) {
      return respondV1(context, ROUTE, 'POST', 422,
        problemJson(422, 'Unprocessable Entity', 'purpose_codes must be an array of strings'),
        t0, true)
    }
    for (let i = 0; i < purpose_codes.length; i++) {
      if (typeof purpose_codes[i] !== 'string' || !purpose_codes[i]) {
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', `purpose_codes[${i}] must be a non-empty string`),
          t0, true)
      }
    }
    purposeCodes = purpose_codes as string[]
  }

  let scopeOverride: string[] | undefined
  if (scope_override !== undefined && scope_override !== null) {
    if (!Array.isArray(scope_override)) {
      return respondV1(context, ROUTE, 'POST', 422,
        problemJson(422, 'Unprocessable Entity', 'scope_override must be an array of strings'),
        t0, true)
    }
    scopeOverride = scope_override as string[]
  }

  if (actor_type !== undefined && actor_type !== null &&
      (typeof actor_type !== 'string' || !['user', 'operator', 'system'].includes(actor_type))) {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'actor_type must be one of: user, operator, system'),
      t0, true)
  }

  if (actor_ref !== undefined && actor_ref !== null && typeof actor_ref !== 'string') {
    return respondV1(context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'actor_ref must be a string'),
      t0, true)
  }

  const result = await triggerDeletion({
    keyId:          context.key_id,
    orgId:          context.org_id!,
    propertyId:     property_id as string,
    identifier:     data_principal_identifier as string,
    identifierType: identifier_type as string,
    reason:         reason as 'consent_revoked' | 'erasure_request' | 'retention_expired',
    purposeCodes,
    scopeOverride,
    actorType:      (actor_type as 'user' | 'operator' | 'system' | undefined) ?? 'user',
    actorRef:       (actor_ref as string | undefined) ?? undefined,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'api_key_binding':
        return respondV1(context, ROUTE, 'POST', 403,
          problemJson(403, 'Forbidden', 'API key does not authorise access to this organisation'), t0, true)
      case 'property_not_found':
        return respondV1(context, ROUTE, 'POST', 404,
          problemJson(404, 'Not Found', 'property_id does not belong to your org'), t0, true)
      case 'retention_mode_not_yet_implemented':
        return respondV1(context, ROUTE, 'POST', 501,
          problemJson(501, 'Not Implemented', 'retention_expired mode is not yet implemented'), t0, true)
      case 'purpose_codes_required_for_consent_revoked':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', 'purpose_codes is required when reason=consent_revoked'), t0, true)
      case 'unknown_reason':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      case 'unknown_actor_type':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      case 'invalid_identifier':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity', result.error.detail), t0, true)
      default:
        return respondV1(context, ROUTE, 'POST', 500,
          problemJson(500, 'Internal Server Error', 'Deletion trigger failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'POST', 202, result.data, t0)
}
