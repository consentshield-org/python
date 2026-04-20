// ADR-1002 Sprint 4.1 — deletion helpers.

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Trigger ──────────────────────────────────────────────────────────────────

export type DeletionReason = 'consent_revoked' | 'erasure_request' | 'retention_expired'

export interface DeletionTriggerEnvelope {
  reason: DeletionReason
  revoked_artefact_ids: string[]
  revoked_count: number | null
  initial_status: string
  note: string
}

export type DeletionTriggerError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'property_not_found' }
  | { kind: 'unknown_reason'; detail: string }
  | { kind: 'retention_mode_not_yet_implemented' }
  | { kind: 'purpose_codes_required_for_consent_revoked' }
  | { kind: 'unknown_actor_type'; detail: string }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function triggerDeletion(params: {
  keyId: string
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  reason: DeletionReason
  purposeCodes?: string[]
  scopeOverride?: string[]
  actorType?: 'user' | 'operator' | 'system'
  actorRef?: string
}): Promise<{ ok: true; data: DeletionTriggerEnvelope } | { ok: false; error: DeletionTriggerError }> {
  const { data, error } = await serviceClient().rpc('rpc_deletion_trigger', {
    p_key_id:          params.keyId,
    p_org_id:          params.orgId,
    p_property_id:     params.propertyId,
    p_identifier:      params.identifier,
    p_identifier_type: params.identifierType,
    p_reason:          params.reason,
    p_purpose_codes:   params.purposeCodes ?? null,
    p_scope_override:  params.scopeOverride ?? null,
    p_actor_type:      params.actorType ?? 'user',
    p_actor_ref:       params.actorRef ?? null,
  })

  if (error) {
    const msg = error.message ?? ''
    if (error.code === '42501' || msg.includes('api_key_') || msg.includes('org_id_missing') || msg.includes('org_not_found'))
      return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('property_not_found'))                       return { ok: false, error: { kind: 'property_not_found' } }
    if (msg.includes('unknown_reason'))                           return { ok: false, error: { kind: 'unknown_reason', detail: msg } }
    if (msg.includes('retention_mode_not_yet_implemented'))       return { ok: false, error: { kind: 'retention_mode_not_yet_implemented' } }
    if (msg.includes('purpose_codes_required_for_consent_revoked')) return { ok: false, error: { kind: 'purpose_codes_required_for_consent_revoked' } }
    if (msg.includes('unknown_actor_type'))                       return { ok: false, error: { kind: 'unknown_actor_type', detail: msg } }
    if (error.code === '22023' || msg.includes('identifier'))     return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }

  return { ok: true, data: data as DeletionTriggerEnvelope }
}

// ── Receipts list ────────────────────────────────────────────────────────────

export interface DeletionReceiptRow {
  id: string
  trigger_type: string
  trigger_id: string | null
  artefact_id: string | null
  connector_id: string | null
  target_system: string
  status: string
  retry_count: number
  failure_reason: string | null
  requested_at: string | null
  confirmed_at: string | null
  created_at: string
}

export interface DeletionReceiptsEnvelope {
  items: DeletionReceiptRow[]
  next_cursor: string | null
}

export type DeletionReceiptsError =
  | { kind: 'bad_cursor' }
  | { kind: 'unknown'; detail: string }

export async function listDeletionReceipts(params: {
  orgId: string
  status?: string
  connectorId?: string
  artefactId?: string
  issuedAfter?: string
  issuedBefore?: string
  cursor?: string
  limit?: number
}): Promise<{ ok: true; data: DeletionReceiptsEnvelope } | { ok: false; error: DeletionReceiptsError }> {
  const { data, error } = await serviceClient().rpc('rpc_deletion_receipts_list', {
    p_org_id:        params.orgId,
    p_status:        params.status ?? null,
    p_connector_id:  params.connectorId ?? null,
    p_artefact_id:   params.artefactId ?? null,
    p_issued_after:  params.issuedAfter ?? null,
    p_issued_before: params.issuedBefore ?? null,
    p_cursor:        params.cursor ?? null,
    p_limit:         params.limit ?? 50,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('bad_cursor')) return { ok: false, error: { kind: 'bad_cursor' } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
  return { ok: true, data: data as DeletionReceiptsEnvelope }
}
