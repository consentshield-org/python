// ADR-1009 Phase 2 Sprint 2.3 — deletion helpers over the cs_api pool.

import { csApi } from '../api/cs-api-client'

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

function classifyKeyBinding(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? ''
  return (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  )
}

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
  try {
    const sql = csApi()
    const purposes = params.purposeCodes ?? null
    const scope = params.scopeOverride ?? null
    const actor = params.actorType ?? 'user'
    const ref = params.actorRef ?? null
    const rows = await sql<Array<{ result: DeletionTriggerEnvelope }>>`
      select rpc_deletion_trigger(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId}::uuid,
        ${params.identifier}::text,
        ${params.identifierType}::text,
        ${params.reason}::text,
        ${purposes}::text[],
        ${scope}::text[],
        ${actor}::text,
        ${ref}::text
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('property_not_found'))                         return { ok: false, error: { kind: 'property_not_found' } }
    if (msg.includes('unknown_reason'))                             return { ok: false, error: { kind: 'unknown_reason', detail: msg } }
    if (msg.includes('retention_mode_not_yet_implemented'))         return { ok: false, error: { kind: 'retention_mode_not_yet_implemented' } }
    if (msg.includes('purpose_codes_required_for_consent_revoked')) return { ok: false, error: { kind: 'purpose_codes_required_for_consent_revoked' } }
    if (msg.includes('unknown_actor_type'))                         return { ok: false, error: { kind: 'unknown_actor_type', detail: msg } }
    if (err.code === '22023' || msg.includes('identifier'))          return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
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
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'bad_cursor' }
  | { kind: 'unknown'; detail: string }

export async function listDeletionReceipts(params: {
  keyId: string
  orgId: string
  status?: string
  connectorId?: string
  artefactId?: string
  issuedAfter?: string
  issuedBefore?: string
  cursor?: string
  limit?: number
}): Promise<{ ok: true; data: DeletionReceiptsEnvelope } | { ok: false; error: DeletionReceiptsError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: DeletionReceiptsEnvelope }>>`
      select rpc_deletion_receipts_list(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.status ?? null}::text,
        ${params.connectorId ?? null}::uuid,
        ${params.artefactId ?? null}::text,
        ${params.issuedAfter ?? null}::timestamptz,
        ${params.issuedBefore ?? null}::timestamptz,
        ${params.cursor ?? null}::text,
        ${params.limit ?? 50}::int
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('bad_cursor')) return { ok: false, error: { kind: 'bad_cursor' } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}
