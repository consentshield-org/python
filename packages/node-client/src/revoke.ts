// ADR-1006 Phase 1 Sprint 1.3 — revokeArtefact.

import type { HttpClient } from './http'
import type { RevokeEnvelope } from './types'

export type RevokeActorType = 'user' | 'operator' | 'system'
const ALLOWED_ACTOR_TYPES: readonly RevokeActorType[] = ['user', 'operator', 'system']

export interface RevokeArtefactInput {
  /** Free-form short code surfaced in the audit trail. Required. */
  reasonCode: string
  /** Optional longer-form notes. */
  reasonNotes?: string | null
  actorType: RevokeActorType
  /** Optional opaque ref identifying the actor (user id / operator email / system name). */
  actorRef?: string | null
  traceId?: string
  signal?: AbortSignal
}

export async function revokeArtefact(
  http: HttpClient,
  artefactId: string,
  input: RevokeArtefactInput,
): Promise<RevokeEnvelope> {
  if (typeof artefactId !== 'string' || artefactId.length === 0) {
    throw new TypeError('@consentshield/node: revokeArtefact artefactId must be a non-empty string')
  }
  if (typeof input.reasonCode !== 'string' || input.reasonCode.length === 0) {
    throw new TypeError('@consentshield/node: revokeArtefact input.reasonCode is required')
  }
  if (!ALLOWED_ACTOR_TYPES.includes(input.actorType)) {
    throw new TypeError(
      `@consentshield/node: revokeArtefact input.actorType must be one of: ${ALLOWED_ACTOR_TYPES.join(', ')}`,
    )
  }

  const body: Record<string, unknown> = {
    reason_code: input.reasonCode,
    actor_type: input.actorType,
  }
  if (input.reasonNotes !== undefined && input.reasonNotes !== null) body.reason_notes = input.reasonNotes
  if (input.actorRef !== undefined && input.actorRef !== null) body.actor_ref = input.actorRef

  const resp = await http.request<RevokeEnvelope>({
    method: 'POST',
    path: `/consent/artefacts/${encodeURIComponent(artefactId)}/revoke`,
    body,
    signal: input.signal,
    traceId: input.traceId,
  })
  return resp.body
}
