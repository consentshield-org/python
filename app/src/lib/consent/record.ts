// ADR-1009 Phase 2 Sprint 2.3 — /v1/consent/record helper over the cs_api pool.

import { csApi } from '../api/cs-api-client'

export interface RecordedArtefact {
  purpose_definition_id: string
  purpose_code: string
  artefact_id: string
  status: string
}

export interface RecordEnvelope {
  event_id: string
  created_at: string
  artefact_ids: RecordedArtefact[]
  idempotent_replay: boolean
}

export type RecordError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'property_not_found' }
  | { kind: 'captured_at_stale'; detail: string }
  | { kind: 'captured_at_missing' }
  | { kind: 'purposes_empty' }
  | { kind: 'invalid_purpose_ids'; detail: string }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function recordConsent(params: {
  keyId: string
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  acceptedPurposeIds: string[]
  rejectedPurposeIds?: string[]
  capturedAt: string
  clientRequestId?: string
}): Promise<{ ok: true; data: RecordEnvelope } | { ok: false; error: RecordError }> {
  try {
    const sql = csApi()
    const rejected = params.rejectedPurposeIds ?? null
    const clientReqId = params.clientRequestId ?? null
    const rows = await sql<Array<{ result: RecordEnvelope }>>`
      select rpc_consent_record(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId}::uuid,
        ${params.identifier},
        ${params.identifierType},
        ${params.acceptedPurposeIds}::uuid[],
        ${rejected}::uuid[],
        ${params.capturedAt}::timestamptz,
        ${clientReqId}::text
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (err.code === '42501' || msg.includes('api_key_') || msg.includes('org_id_missing') || msg.includes('org_not_found')) {
      return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    }
    if (msg.includes('property_not_found'))  return { ok: false, error: { kind: 'property_not_found' } }
    if (msg.includes('captured_at_missing')) return { ok: false, error: { kind: 'captured_at_missing' } }
    if (msg.includes('captured_at_stale'))   return { ok: false, error: { kind: 'captured_at_stale', detail: msg } }
    if (msg.includes('purposes_empty'))      return { ok: false, error: { kind: 'purposes_empty' } }
    if (msg.includes('invalid_purpose_definition_ids') || msg.includes('invalid_rejected')) {
      return { ok: false, error: { kind: 'invalid_purpose_ids', detail: msg } }
    }
    if (err.code === '22023' || msg.includes('identifier')) {
      return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}
