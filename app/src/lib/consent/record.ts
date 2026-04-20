// ADR-1002 Sprint 2.1 — server-side helper for /v1/consent/record.
// Thin wrapper over rpc_consent_record via the service-role client.

import { createClient } from '@supabase/supabase-js'

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
  | { kind: 'property_not_found' }
  | { kind: 'captured_at_stale'; detail: string }
  | { kind: 'captured_at_missing' }
  | { kind: 'purposes_empty' }
  | { kind: 'invalid_purpose_ids'; detail: string }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function recordConsent(params: {
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  acceptedPurposeIds: string[]
  rejectedPurposeIds?: string[]
  capturedAt: string
  clientRequestId?: string
}): Promise<{ ok: true; data: RecordEnvelope } | { ok: false; error: RecordError }> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await client.rpc('rpc_consent_record', {
    p_org_id:                          params.orgId,
    p_property_id:                     params.propertyId,
    p_identifier:                      params.identifier,
    p_identifier_type:                 params.identifierType,
    p_purpose_definition_ids:          params.acceptedPurposeIds,
    p_rejected_purpose_definition_ids: params.rejectedPurposeIds ?? null,
    p_captured_at:                     params.capturedAt,
    p_client_request_id:               params.clientRequestId ?? null,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('property_not_found'))           return { ok: false, error: { kind: 'property_not_found' } }
    if (msg.includes('captured_at_missing'))          return { ok: false, error: { kind: 'captured_at_missing' } }
    if (msg.includes('captured_at_stale'))            return { ok: false, error: { kind: 'captured_at_stale', detail: msg } }
    if (msg.includes('purposes_empty'))               return { ok: false, error: { kind: 'purposes_empty' } }
    if (msg.includes('invalid_purpose_definition_ids') || msg.includes('invalid_rejected'))
      return { ok: false, error: { kind: 'invalid_purpose_ids', detail: msg } }
    if (error.code === '22023' || msg.includes('identifier'))
      return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }

  return { ok: true, data: data as RecordEnvelope }
}
