// ADR-1009 Phase 2 Sprint 2.3 — /v1/consent/verify + /v1/consent/verify/batch
// helpers over the cs_api pool. Replaces the service-role Supabase client.

import { csApi } from '../api/cs-api-client'

export type VerifyStatus = 'granted' | 'revoked' | 'expired' | 'never_consented'

export interface VerifyEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
  evaluated_at: string
}

export type VerifyError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'property_not_found' }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'unknown'; detail: string }

export interface VerifyBatchResultRow {
  identifier: string
  status: VerifyStatus
  active_artefact_id: string | null
  revoked_at: string | null
  revocation_record_id: string | null
  expires_at: string | null
}

export interface VerifyBatchEnvelope {
  property_id: string
  identifier_type: string
  purpose_code: string
  evaluated_at: string
  results: VerifyBatchResultRow[]
}

export type VerifyBatchError =
  | { kind: 'api_key_binding'; detail: string }
  | { kind: 'property_not_found' }
  | { kind: 'invalid_identifier'; detail: string }
  | { kind: 'identifiers_empty' }
  | { kind: 'identifiers_too_large'; detail: string }
  | { kind: 'unknown'; detail: string }

// postgres.js throws a PostgresError on any DB-side exception. We key
// error branches off code + message (both are exposed on the instance).
function classifyKeyBinding(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? ''
  return (
    err.code === '42501' ||
    msg.includes('api_key_') ||
    msg.includes('org_id_missing') ||
    msg.includes('org_not_found')
  )
}

export async function verifyConsent(params: {
  keyId: string
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  purposeCode: string
}): Promise<{ ok: true; data: VerifyEnvelope } | { ok: false; error: VerifyError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: VerifyEnvelope }>>`
      select rpc_consent_verify(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId}::uuid,
        ${params.identifier},
        ${params.identifierType},
        ${params.purposeCode}
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('property_not_found')) return { ok: false, error: { kind: 'property_not_found' } }
    if (err.code === '22023' || msg.includes('identifier') || msg.includes('unknown identifier_type')) {
      return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}

export async function verifyConsentBatch(params: {
  keyId: string
  orgId: string
  propertyId: string
  identifiers: string[]
  identifierType: string
  purposeCode: string
}): Promise<{ ok: true; data: VerifyBatchEnvelope } | { ok: false; error: VerifyBatchError }> {
  try {
    const sql = csApi()
    const rows = await sql<Array<{ result: VerifyBatchEnvelope }>>`
      select rpc_consent_verify_batch(
        ${params.keyId}::uuid,
        ${params.orgId}::uuid,
        ${params.propertyId}::uuid,
        ${params.identifierType},
        ${params.purposeCode},
        ${params.identifiers}::text[]
      ) as result
    `
    return { ok: true, data: rows[0].result }
  } catch (e) {
    const err = e as { code?: string; message?: string }
    const msg = err.message ?? ''
    if (classifyKeyBinding(err)) return { ok: false, error: { kind: 'api_key_binding', detail: msg } }
    if (msg.includes('property_not_found')) return { ok: false, error: { kind: 'property_not_found' } }
    if (msg.includes('identifiers_empty')) return { ok: false, error: { kind: 'identifiers_empty' } }
    if (msg.includes('identifiers_too_large')) return { ok: false, error: { kind: 'identifiers_too_large', detail: msg } }
    if (err.code === '22023' || msg.includes('identifier') || msg.includes('unknown identifier_type')) {
      return { ok: false, error: { kind: 'invalid_identifier', detail: msg } }
    }
    return { ok: false, error: { kind: 'unknown', detail: msg } }
  }
}
