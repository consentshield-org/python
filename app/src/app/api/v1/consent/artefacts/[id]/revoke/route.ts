import { NextRequest } from 'next/server'
import { problemJson } from '@/lib/api/auth'
import { readContext, respondV1, gateScopeOrProblem, requireOrgOrProblem } from '@/lib/api/v1-helpers'
import { revokeArtefact } from '@/lib/consent/revoke'

// ADR-1002 Sprint 3.2 — POST /v1/consent/artefacts/{id}/revoke
//
// Body:
//   {
//     "reason_code": "user_withdrawal" | "business_withdrawal" | ...,
//     "reason_notes": "optional free text",
//     "actor_type":  "user" | "operator" | "system",
//     "actor_ref":   "optional caller-supplied identifier (user_id, operator_email, ...)"
//   }
//
// Scope: write:artefacts. Idempotent on already-revoked (200 with existing
// revocation_record_id). 409 on terminal states (expired / replaced).

const ROUTE = '/api/v1/consent/artefacts/[id]/revoke'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const { context, t0 } = await readContext()

  const scopeGate = gateScopeOrProblem(context, 'write:artefacts')
  if (scopeGate) return respondV1(context, ROUTE, 'POST', scopeGate.status, scopeGate.body, t0, true)

  const orgGate = requireOrgOrProblem(context, '/api/v1/consent/artefacts/{id}/revoke')
  if (orgGate) return respondV1(context, ROUTE, 'POST', orgGate.status, orgGate.body, t0, true)

  if (!id) {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'artefact id path parameter is required'),
      t0, true,
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be valid JSON'),
      t0, true,
    )
  }
  if (!body || typeof body !== 'object') {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'Request body must be a JSON object'),
      t0, true,
    )
  }

  const { reason_code, reason_notes, actor_type, actor_ref } = body as Record<string, unknown>

  if (typeof reason_code !== 'string' || !reason_code.trim()) {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'reason_code is required'),
      t0, true,
    )
  }
  if (typeof actor_type !== 'string' || !['user', 'operator', 'system'].includes(actor_type)) {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'actor_type must be one of: user, operator, system'),
      t0, true,
    )
  }
  if (reason_notes !== undefined && reason_notes !== null && typeof reason_notes !== 'string') {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'reason_notes must be a string'),
      t0, true,
    )
  }
  if (actor_ref !== undefined && actor_ref !== null && typeof actor_ref !== 'string') {
    return respondV1(
      context, ROUTE, 'POST', 422,
      problemJson(422, 'Unprocessable Entity', 'actor_ref must be a string'),
      t0, true,
    )
  }

  const result = await revokeArtefact({
    orgId:       context.org_id!,
    artefactId:  id,
    reasonCode:  reason_code,
    reasonNotes: (reason_notes as string | undefined) ?? undefined,
    actorType:   actor_type as 'user' | 'operator' | 'system',
    actorRef:    (actor_ref as string | undefined) ?? undefined,
  })

  if (!result.ok) {
    switch (result.error.kind) {
      case 'artefact_not_found':
        return respondV1(context, ROUTE, 'POST', 404,
          problemJson(404, 'Not Found', 'No artefact with that id belongs to your org'), t0, true)
      case 'artefact_terminal_state':
        return respondV1(context, ROUTE, 'POST', 409,
          problemJson(409, 'Conflict', result.error.detail), t0, true)
      case 'reason_code_missing':
      case 'unknown_actor_type':
        return respondV1(context, ROUTE, 'POST', 422,
          problemJson(422, 'Unprocessable Entity',
            result.error.kind === 'reason_code_missing' ? 'reason_code is required' : result.error.detail),
          t0, true)
      default:
        return respondV1(context, ROUTE, 'POST', 500,
          problemJson(500, 'Internal Server Error', 'Revocation failed'), t0, true)
    }
  }

  return respondV1(context, ROUTE, 'POST', 200, result.data, t0)
}
