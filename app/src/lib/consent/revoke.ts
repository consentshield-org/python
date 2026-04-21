// ADR-1009 Phase 2 Sprint 2.3 — revoke helper over the cs_api pool.

import { csApi } from '../api/cs-api-client'

export interface RevokeEnvelope {
  artefact_id: string
  status: 'revoked'
  revocation_record_id: string
  idempotent_replay: boolean
}

export type RevokeError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'artefact_not_found' }
  | { kind: 'artefact_terminal_state'; detail: string }
  | { kind: 'reason_code_missing' }
  | { kind: 'unknown_actor_type'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function revokeArtefact(params: {
  keyId: string
  orgId: string
  artefactId: string
  reasonCode: string
  reasonNotes?: string
  actorType: 'user' | 'operator' | 'system'
  actorRef?: string
}): Promise<{ ok: true; data: RevokeEnvelope } | { ok: false; error: RevokeError }> {
  try {
    const sql = csApi()
    const notes = params.reasonNotes ?? null
    const ref = params.actorRef ?? null
    const rows = await sql<Array<{ result: RevokeEnvelope }>>`
      select rpc_artefact_revoke(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.artefactId}::text,
        ${params.reasonCode}::text,
        ${notes}::text,
        ${params.actorType}::text,
        ${ref}::text
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (err.code === '42501' || msg.includes('api_key_') || msg.includes('org_id_missing') || msg.includes('org_not_found')) {
      return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    }
    if (msg.includes('artefact_not_found'))      return { ok: false, error: { kind: 'artefact_not_found' } }
    if (msg.includes('artefact_terminal_state')) return { ok: false, error: { kind: 'artefact_terminal_state', detail: msg } }
    if (msg.includes('reason_code_missing'))     return { ok: false, error: { kind: 'reason_code_missing' } }
    if (msg.includes('unknown_actor_type'))      return { ok: false, error: { kind: 'unknown_actor_type', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}
