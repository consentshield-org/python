// ADR-1006 Phase 1 Sprint 1.3 — triggerDeletion + listDeletionReceipts.

import type { HttpClient } from './http'
import type {
  DeletionReason,
  DeletionReceiptRow,
  DeletionReceiptsEnvelope,
  DeletionTriggerEnvelope,
  IdentifierType,
} from './types'

const ALLOWED_REASONS: readonly DeletionReason[] = [
  'consent_revoked',
  'erasure_request',
  'retention_expired',
]

export type DeletionActorType = 'user' | 'operator' | 'system'

export interface TriggerDeletionInput {
  propertyId: string
  dataPrincipalIdentifier: string
  identifierType: IdentifierType | string
  reason: DeletionReason
  /** Required when reason === 'consent_revoked'; otherwise optional. */
  purposeCodes?: string[]
  /** Manual scope override — list of artefact ids to scope the delete to. */
  scopeOverride?: string[]
  actorType?: DeletionActorType
  actorRef?: string
  traceId?: string
  signal?: AbortSignal
}

export async function triggerDeletion(
  http: HttpClient,
  input: TriggerDeletionInput,
): Promise<DeletionTriggerEnvelope> {
  validateRequired(input.propertyId, 'propertyId')
  validateRequired(input.dataPrincipalIdentifier, 'dataPrincipalIdentifier')
  validateRequired(input.identifierType, 'identifierType')
  if (!ALLOWED_REASONS.includes(input.reason)) {
    throw new TypeError(
      `@consentshield/node: triggerDeletion input.reason must be one of: ${ALLOWED_REASONS.join(', ')}`,
    )
  }
  if (input.purposeCodes !== undefined) {
    if (!Array.isArray(input.purposeCodes)) {
      throw new TypeError('@consentshield/node: triggerDeletion input.purposeCodes must be an array')
    }
    for (let i = 0; i < input.purposeCodes.length; i++) {
      if (typeof input.purposeCodes[i] !== 'string' || input.purposeCodes[i].length === 0) {
        throw new TypeError(
          `@consentshield/node: triggerDeletion input.purposeCodes[${i}] must be a non-empty string`,
        )
      }
    }
  }
  if (input.reason === 'consent_revoked' && (!input.purposeCodes || input.purposeCodes.length === 0)) {
    throw new TypeError(
      "@consentshield/node: triggerDeletion input.purposeCodes is required when reason === 'consent_revoked'",
    )
  }
  if (input.scopeOverride !== undefined && !Array.isArray(input.scopeOverride)) {
    throw new TypeError('@consentshield/node: triggerDeletion input.scopeOverride must be an array')
  }
  if (input.actorType !== undefined && !['user', 'operator', 'system'].includes(input.actorType)) {
    throw new TypeError(
      "@consentshield/node: triggerDeletion input.actorType must be one of: user, operator, system",
    )
  }

  const body: Record<string, unknown> = {
    property_id: input.propertyId,
    data_principal_identifier: input.dataPrincipalIdentifier,
    identifier_type: input.identifierType,
    reason: input.reason,
  }
  if (input.purposeCodes !== undefined) body.purpose_codes = input.purposeCodes
  if (input.scopeOverride !== undefined) body.scope_override = input.scopeOverride
  if (input.actorType !== undefined) body.actor_type = input.actorType
  if (input.actorRef !== undefined) body.actor_ref = input.actorRef

  const resp = await http.request<DeletionTriggerEnvelope>({
    method: 'POST',
    path: '/deletion/trigger',
    body,
    signal: input.signal,
    traceId: input.traceId,
  })
  return resp.body
}

export interface ListDeletionReceiptsInput {
  triggerType?: string
  status?: string
  connectorId?: string
  createdAfter?: string
  createdBefore?: string
  cursor?: string
  limit?: number
  traceId?: string
  signal?: AbortSignal
}

export async function listDeletionReceipts(
  http: HttpClient,
  input: ListDeletionReceiptsInput = {},
): Promise<DeletionReceiptsEnvelope> {
  const resp = await http.request<DeletionReceiptsEnvelope>({
    method: 'GET',
    path: '/deletion/receipts',
    query: {
      trigger_type: input.triggerType,
      status: input.status,
      connector_id: input.connectorId,
      created_after: input.createdAfter,
      created_before: input.createdBefore,
      cursor: input.cursor,
      limit: input.limit,
    },
    signal: input.signal,
    traceId: input.traceId,
  })
  return resp.body
}

export async function* iterateDeletionReceipts(
  http: HttpClient,
  input: ListDeletionReceiptsInput = {},
): AsyncIterableIterator<DeletionReceiptRow> {
  let cursor = input.cursor
  while (true) {
    const page: DeletionReceiptsEnvelope = await listDeletionReceipts(http, { ...input, cursor })
    for (const item of page.items) yield item
    if (!page.next_cursor) return
    cursor = page.next_cursor
  }
}

function validateRequired(value: unknown, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`@consentshield/node: ${name} is required and must be a non-empty string`)
  }
}
