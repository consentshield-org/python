// ADR-1009 Phase 2 Sprint 2.3 — artefact + event read helpers over the
// cs_api pool.

import { csApi } from '../api/cs-api-client'

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
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'bad_cursor' }
  | { kind: 'bad_filters'; detail: string }
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

export async function listArtefacts(params: {
  keyId: string
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
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: ArtefactListEnvelope }>>`
      select rpc_artefact_list(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId ?? null}::uuid,
        ${params.identifier ?? null}::text,
        ${params.identifierType ?? null}::text,
        ${params.status ?? null}::text,
        ${params.purposeCode ?? null}::text,
        ${params.expiresBefore ?? null}::timestamptz,
        ${params.expiresAfter ?? null}::timestamptz,
        ${params.cursor ?? null}::text,
        ${params.limit ?? 50}::int
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('bad_cursor'))                        return { ok: false, error: { kind: 'bad_cursor' } }
    if (msg.includes('identifier_requires_both_fields'))   return { ok: false, error: { kind: 'bad_filters', detail: 'Both identifier and identifier_type must be supplied together' } }
    if (msg.includes('identifier') || err.code === '22023') return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
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
  keyId: string
  orgId: string
  artefactId: string
}): Promise<
  { ok: true; data: ArtefactDetail | null } |
  { ok: false; error: { kind: 'api_key_binding'; detail: string } | { kind: 'unknown'; detail: string } }
> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: ArtefactDetail | null }>>`
      select rpc_artefact_get(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.artefactId}::text
      ) as result
    `
    return { ok: true, data: rows[0]?.result ?? null }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
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
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'bad_cursor' }
  | { kind: 'unknown'; detail: string }

export async function listEvents(params: {
  keyId: string
  orgId: string
  propertyId?: string
  createdAfter?: string
  createdBefore?: string
  source?: string
  cursor?: string
  limit?: number
}): Promise<{ ok: true; data: EventListEnvelope } | { ok: false; error: EventListError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: EventListEnvelope }>>`
      select rpc_event_list(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId ?? null}::uuid,
        ${params.createdAfter ?? null}::timestamptz,
        ${params.createdBefore ?? null}::timestamptz,
        ${params.source ?? null}::text,
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
