// ADR-1002 Sprint 3.1 — server-side helpers for artefact + event read endpoints.

import { createClient } from '@supabase/supabase-js'

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ── Artefact list ────────────────────────────────────────────────────────────

export interface ArtefactListItem {
  artefact_id: string
  property_id: string
  purpose_code: string
  purpose_definition_id: string
  data_scope: string[]
  framework: string
  status: string
  expires_at: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  replaced_by: string | null
  identifier_type: string | null
  created_at: string
}

export interface ArtefactListEnvelope {
  items: ArtefactListItem[]
  next_cursor: string | null
}

export type ArtefactListError =
  | { kind: 'bad_cursor' }
  | { kind: 'bad_filters'; detail: string }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export async function listArtefacts(params: {
  orgId: string
  propertyId?: string
  identifier?: string
  identifierType?: string
  status?: string
  purposeCode?: string
  expiresBefore?: string
  expiresAfter?: string
  cursor?: string
  limit?: number
}): Promise<{ ok: true; data: ArtefactListEnvelope } | { ok: false; error: ArtefactListError }> {
  const { data, error } = await serviceClient().rpc('rpc_artefact_list', {
    p_org_id:          params.orgId,
    p_property_id:     params.propertyId ?? null,
    p_identifier:      params.identifier ?? null,
    p_identifier_type: params.identifierType ?? null,
    p_status:          params.status ?? null,
    p_purpose_code:    params.purposeCode ?? null,
    p_expires_before:  params.expiresBefore ?? null,
    p_expires_after:   params.expiresAfter ?? null,
    p_cursor:          params.cursor ?? null,
    p_limit:           params.limit ?? 50,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('bad_cursor'))                       return { ok: false, error: { kind: 'bad_cursor' } }
    if (msg.includes('identifier_requires_both_fields'))  return { ok: false, error: { kind: 'bad_filters', detail: 'Both identifier and identifier_type must be supplied together' } }
    if (msg.includes('identifier') || error.code === '22023') return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
  return { ok: true, data: data as ArtefactListEnvelope }
}

// ── Artefact get ─────────────────────────────────────────────────────────────

export interface ArtefactRevocation {
  id: string
  reason: string | null
  revoked_by_type: string
  revoked_by_ref: string | null
  created_at: string
}

export interface ArtefactDetail extends ArtefactListItem {
  revocation: ArtefactRevocation | null
  replacement_chain: string[]
}

export async function getArtefact(params: {
  orgId: string
  artefactId: string
}): Promise<{ ok: true; data: ArtefactDetail | null } | { ok: false; error: { kind: 'unknown'; detail: string } }> {
  const { data, error } = await serviceClient().rpc('rpc_artefact_get', {
    p_org_id:      params.orgId,
    p_artefact_id: params.artefactId,
  })
  if (error) return { ok: false, error: { kind: 'unknown', detail: error.message ?? '' } }
  return { ok: true, data: data as ArtefactDetail | null }
}

// ── Event list ───────────────────────────────────────────────────────────────

export interface EventListItem {
  id: string
  property_id: string
  source: string
  event_type: string
  purposes_accepted_count: number
  purposes_rejected_count: number
  identifier_type: string | null
  artefact_count: number
  created_at: string
}

export interface EventListEnvelope {
  items: EventListItem[]
  next_cursor: string | null
}

export type EventListError =
  | { kind: 'bad_cursor' }
  | { kind: 'unknown'; detail: string }

export async function listEvents(params: {
  orgId: string
  propertyId?: string
  createdAfter?: string
  createdBefore?: string
  source?: string
  cursor?: string
  limit?: number
}): Promise<{ ok: true; data: EventListEnvelope } | { ok: false; error: EventListError }> {
  const { data, error } = await serviceClient().rpc('rpc_event_list', {
    p_org_id:         params.orgId,
    p_property_id:    params.propertyId ?? null,
    p_created_after:  params.createdAfter ?? null,
    p_created_before: params.createdBefore ?? null,
    p_source:         params.source ?? null,
    p_cursor:         params.cursor ?? null,
    p_limit:          params.limit ?? 50,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('bad_cursor')) return { ok: false, error: { kind: 'bad_cursor' } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
  return { ok: true, data: data as EventListEnvelope }
}
