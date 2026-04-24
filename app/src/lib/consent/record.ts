// ADR-1009 Phase 2 Sprint 2.3 + ADR-1003 Sprint 1.4 — /v1/consent/record helper.
//
// Two write paths, branched by the org's storage_mode:
//
//   Standard / Insulated  — rpc_consent_record via cs_api (writes to
//                           consent_events + consent_artefacts +
//                           consent_artefact_index). The existing path.
//
//   Zero-Storage          — rpc_consent_record_prepare_zero_storage via
//                           cs_api (validates + returns canonical
//                           envelope, writes nothing) → processZero-
//                           StorageEvent via cs_orchestrator (uploads
//                           canonicalised payload to customer R2,
//                           seeds consent_artefact_index with
//                           identifier_hash populated so /v1/consent/
//                           verify can answer for Mode B events).
//
// The branch point: a single get_storage_mode(p_org_id) lookup at the
// top of recordConsent. The RPC itself also fences zero_storage callers
// with errcode P0003 so a race between the mode check and the RPC call
// (mode just flipped) re-enters the zero-storage path via the catch.

import type postgres from 'postgres'
import { csApi } from '../api/cs-api-client'
import { csOrchestrator } from '../api/cs-orchestrator-client'
import {
  processZeroStorageEvent,
  type BridgeRequest,
} from '../delivery/zero-storage-bridge'

type Pg = ReturnType<typeof postgres>

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
  | { kind: 'zero_storage_bridge_failed'; detail: string }
  | { kind: 'unknown'; detail: string }

interface PrepareZeroStorageResult {
  event_fingerprint: string
  captured_at: string
  identifier_hash: string
  identifier_type: string
  property_id: string
  purposes_accepted: Array<{ purpose_definition_id: string; purpose_code: string }>
  purposes_rejected: Array<{ purpose_definition_id: string; purpose_code: string }>
  artefact_ids: RecordedArtefact[]
}

export interface RecordConsentParams {
  keyId: string
  orgId: string
  propertyId: string
  identifier: string
  identifierType: string
  acceptedPurposeIds: string[]
  rejectedPurposeIds?: string[]
  capturedAt: string
  clientRequestId?: string
}

export interface RecordConsentDeps {
  csApi?: () => Pg
  csOrchestrator?: () => Pg
  processZeroStorageEvent?: typeof processZeroStorageEvent
}

export async function recordConsent(
  params: RecordConsentParams,
  deps: RecordConsentDeps = {},
): Promise<{ ok: true; data: RecordEnvelope } | { ok: false; error: RecordError }> {
  const getApi = deps.csApi ?? csApi
  const getOrch = deps.csOrchestrator ?? csOrchestrator
  const bridgeFn = deps.processZeroStorageEvent ?? processZeroStorageEvent

  let mode: string
  try {
    const sql = getApi()
    const rows = await sql<Array<{ mode: string }>>`
      select public.get_storage_mode(${params.orgId}::uuid) as mode
    `
    mode = rows[0]?.mode ?? 'standard'
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return classify(err)
  }

  if (mode === 'zero_storage') {
    return recordConsentZeroStorage(params, getApi, getOrch, bridgeFn)
  }

  try {
    const sql = getApi()
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
    // Race: the mode flipped to zero_storage between the lookup and the
    // RPC call. The RPC fence caught it (errcode P0003). Retry through
    // the zero-storage path.
    if (err.code === 'P0003' && (err.message ?? '').includes('storage_mode_requires_bridge')) {
      return recordConsentZeroStorage(params, getApi, getOrch, bridgeFn)
    }
    return classify(err)
  }
}

async function recordConsentZeroStorage(
  params: RecordConsentParams,
  getApi: () => Pg,
  getOrch: () => Pg,
  bridgeFn: typeof processZeroStorageEvent,
): Promise<{ ok: true; data: RecordEnvelope } | { ok: false; error: RecordError }> {
  let prep: PrepareZeroStorageResult
  try {
    const sql = getApi()
    const rejected = params.rejectedPurposeIds ?? null
    const clientReqId = params.clientRequestId ?? null
    const rows = await sql<Array<{ result: PrepareZeroStorageResult }>>`
      select rpc_consent_record_prepare_zero_storage(
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
    prep = rows[0].result
  } catch (e) {
    const err = e as { code?: string; message?: string }
    return classify(err)
  }

  const bridgeReq: BridgeRequest = {
    kind: 'consent_event',
    org_id: params.orgId,
    event_fingerprint: prep.event_fingerprint,
    timestamp: prep.captured_at,
    payload: {
      property_id: prep.property_id,
      event_type: 'accept',
      source: 'api',
      identifier_hash: prep.identifier_hash,
      identifier_type: prep.identifier_type,
      purposes_accepted: prep.purposes_accepted.map((p) => p.purpose_code),
      purposes_rejected: prep.purposes_rejected.map((p) => p.purpose_code),
      client_request_id: params.clientRequestId ?? null,
    },
  }

  const result = await bridgeFn(getOrch(), bridgeReq)

  if (result.outcome !== 'uploaded') {
    return {
      ok: false,
      error: {
        kind: 'zero_storage_bridge_failed',
        detail: `${result.outcome}${result.error ? `: ${result.error}` : ''}`,
      },
    }
  }

  // Replay detection. `indexed === 0` with no indexError means every
  // ON CONFLICT DO NOTHING fired — i.e., the deterministic artefact_ids
  // already exist in the index from a previous call with the same
  // client_request_id (same fingerprint). Treat as idempotent replay.
  const idempotentReplay =
    prep.artefact_ids.length > 0
    && result.indexed === 0
    && result.indexError === undefined

  return {
    ok: true,
    data: {
      event_id: `zs-${prep.event_fingerprint}`,
      created_at: prep.captured_at,
      artefact_ids: prep.artefact_ids,
      idempotent_replay: idempotentReplay,
    },
  }
}

function classify(err: { code?: string; message?: string }): { ok: false; error: RecordError } {
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
