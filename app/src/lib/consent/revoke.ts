// ADR-1002 Sprint 3.2 — revoke helper.

import { createClient } from '@supabase/supabase-js'

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
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await client.rpc('rpc_artefact_revoke', {
    p_key_id:       params.keyId,
    p_org_id:       params.orgId,
    p_artefact_id:  params.artefactId,
    p_reason_code:  params.reasonCode,
    p_reason_notes: params.reasonNotes ?? null,
    p_actor_type:   params.actorType,
    p_actor_ref:    params.actorRef ?? null,
  })

  if (error) {
    const msg = error.message ?? ''
    if (error.code === '42501' || msg.includes('api_key_') || msg.includes('org_id_missing') || msg.includes('org_not_found'))
      return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('artefact_not_found'))           return { ok: false, error: { kind: 'artefact_not_found' } }
    if (msg.includes('artefact_terminal_state'))      return { ok: false, error: { kind: 'artefact_terminal_state', detail: msg } }
    if (msg.includes('reason_code_missing'))          return { ok: false, error: { kind: 'reason_code_missing' } }
    if (msg.includes('unknown_actor_type'))           return { ok: false, error: { kind: 'unknown_actor_type', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }

  return { ok: true, data: data as RevokeEnvelope }
}
