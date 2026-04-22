// ADR-1005 Sprint 5.1 — /v1/rights/requests helpers over the cs_api pool.
//
// Two operations:
//   createRightsRequest — POST /v1/rights/requests (write:rights)
//   listRightsRequests  — GET  /v1/rights/requests (read:rights)
//
// Both call SECURITY DEFINER RPCs that are fenced at the DB by
// assert_api_key_binding(p_key_id, p_org_id) — ADR-1009 Phase 1 pattern.

import { csApi } from './cs-api-client'

// ── types ────────────────────────────────────────────────────────────────────

export type RightsRequestType = 'erasure' | 'access' | 'correction' | 'nomination'
export type RightsRequestStatus = 'new' | 'in_progress' | 'completed' | 'rejected'
export type RightsCapturedVia =
  | 'portal'
  | 'api'
  | 'kiosk'
  | 'branch'
  | 'call_center'
  | 'mobile_app'
  | 'email'
  | 'other'

export interface RightsRequestCreateInput {
  keyId:              string
  orgId:              string
  type:               RightsRequestType
  requestorName:      string
  requestorEmail:     string
  requestDetails?:    string | null
  identityVerifiedBy: string
  capturedVia?:       RightsCapturedVia
}

export interface RightsRequestCreatedEnvelope {
  id:                   string
  status:               RightsRequestStatus
  request_type:         RightsRequestType
  captured_via:         RightsCapturedVia
  identity_verified:    boolean
  identity_verified_by: string
  sla_deadline:         string
  created_at:           string
}

export interface RightsRequestItem {
  id:                    string
  request_type:          RightsRequestType
  requestor_name:        string
  requestor_email:       string
  status:                RightsRequestStatus
  captured_via:          RightsCapturedVia
  identity_verified:     boolean
  identity_verified_at:  string | null
  identity_method:       string | null
  sla_deadline:          string
  response_sent_at:      string | null
  created_by_api_key_id: string | null
  created_at:            string
  updated_at:            string
}

export interface RightsRequestListEnvelope {
  items:       RightsRequestItem[]
  next_cursor: string | null
}

export interface RightsRequestListInput {
  keyId:          string
  orgId:          string
  status?:        RightsRequestStatus
  requestType?:   RightsRequestType
  createdAfter?:  string
  createdBefore?: string
  capturedVia?:   RightsCapturedVia
  cursor?:        string
  limit?:         number
}

// ── errors ───────────────────────────────────────────────────────────────────

export type RightsError =
  | { kind: 'api_key_binding';        detail: string }
  | { kind: 'invalid_request_type';   detail: string }
  | { kind: 'invalid_requestor_email'; detail: string }
  | { kind: 'requestor_name_missing'; detail: string }
  | { kind: 'identity_verified_by_missing'; detail: string }
  | { kind: 'invalid_status';         detail: string }
  | { kind: 'bad_cursor';             detail: string }
  | { kind: 'unknown';                detail: string }

function classify(err: { code?: string; message?: string }): RightsError {
  const code = err.code ?? ''
  const msg  = err.message ?? ''

  if (
    code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  ) {
    return { kind: 'api_key_binding', detail: msg }
  }

  if (msg.includes('invalid_request_type'))         return { kind: 'invalid_request_type',         detail: msg }
  if (msg.includes('invalid_requestor_email'))      return { kind: 'invalid_requestor_email',      detail: msg }
  if (msg.includes('requestor_name_missing'))       return { kind: 'requestor_name_missing',       detail: msg }
  if (msg.includes('identity_verified_by_missing')) return { kind: 'identity_verified_by_missing', detail: msg }
  if (msg.includes('invalid_status'))               return { kind: 'invalid_status',               detail: msg }
  if (msg.includes('bad_cursor'))                   return { kind: 'bad_cursor',                   detail: msg }

  return { kind: 'unknown', detail: msg }
}

// ── operations ───────────────────────────────────────────────────────────────

export async function createRightsRequest(
  input: RightsRequestCreateInput,
): Promise<
  | { ok: true;  data: RightsRequestCreatedEnvelope }
  | { ok: false; error: RightsError }
> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: RightsRequestCreatedEnvelope }>>`
      select rpc_rights_request_create_api(
        ${input.keyId}::uuid,
        ${input.orgId}::uuid,
        ${input.type}::text,
        ${input.requestorName}::text,
        ${input.requestorEmail}::text,
        ${input.requestDetails ?? null}::text,
        ${input.identityVerifiedBy}::text,
        ${input.capturedVia ?? 'api'}::text
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}

export async function listRightsRequests(
  input: RightsRequestListInput,
): Promise<
  | { ok: true;  data: RightsRequestListEnvelope }
  | { ok: false; error: RightsError }
> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: RightsRequestListEnvelope }>>`
      select rpc_rights_request_list(
        ${input.keyId}::uuid,
        ${input.orgId}::uuid,
        ${input.status ?? null}::text,
        ${input.requestType ?? null}::text,
        ${input.createdAfter ?? null}::timestamptz,
        ${input.createdBefore ?? null}::timestamptz,
        ${input.capturedVia ?? null}::text,
        ${input.cursor ?? null}::text,
        ${input.limit ?? 50}::int
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    return { ok: false, error: classify(e as { code?: string; message?: string }) }
  }
}
