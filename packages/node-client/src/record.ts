// ADR-1006 Phase 1 Sprint 1.3 — recordConsent.

import type { HttpClient, HttpRequest } from './http'
import type { IdentifierType, RecordEnvelope } from './types'

export interface RecordConsentInput {
  propertyId: string
  dataPrincipalIdentifier: string
  identifierType: IdentifierType | string
  /** Purpose definition ids the data principal accepted. MUST be non-empty. */
  purposeDefinitionIds: string[]
  /** Purpose definition ids the data principal explicitly rejected. May be empty. */
  rejectedPurposeDefinitionIds?: string[]
  /** ISO 8601 timestamp the consent was captured client-side. Server validates freshness. */
  capturedAt: string
  /** Idempotency key — same id within the org dedupes to the same event_id. */
  clientRequestId?: string
  traceId?: string
  signal?: AbortSignal
}

export async function recordConsent(
  http: HttpClient,
  input: RecordConsentInput,
): Promise<RecordEnvelope> {
  validateRequired(input.propertyId, 'propertyId')
  validateRequired(input.dataPrincipalIdentifier, 'dataPrincipalIdentifier')
  validateRequired(input.identifierType, 'identifierType')
  validateRequired(input.capturedAt, 'capturedAt')
  if (!Array.isArray(input.purposeDefinitionIds)) {
    throw new TypeError('@consentshield/node: recordConsent input.purposeDefinitionIds must be an array')
  }
  if (input.purposeDefinitionIds.length === 0) {
    throw new RangeError('@consentshield/node: recordConsent input.purposeDefinitionIds must be non-empty')
  }
  for (let i = 0; i < input.purposeDefinitionIds.length; i++) {
    const id = input.purposeDefinitionIds[i]
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError(
        `@consentshield/node: recordConsent input.purposeDefinitionIds[${i}] must be a non-empty string`,
      )
    }
  }
  if (input.rejectedPurposeDefinitionIds !== undefined) {
    if (!Array.isArray(input.rejectedPurposeDefinitionIds)) {
      throw new TypeError(
        '@consentshield/node: recordConsent input.rejectedPurposeDefinitionIds must be an array',
      )
    }
    for (let i = 0; i < input.rejectedPurposeDefinitionIds.length; i++) {
      if (typeof input.rejectedPurposeDefinitionIds[i] !== 'string') {
        throw new TypeError(
          `@consentshield/node: recordConsent input.rejectedPurposeDefinitionIds[${i}] must be a string`,
        )
      }
    }
  }

  const body: Record<string, unknown> = {
    property_id: input.propertyId,
    data_principal_identifier: input.dataPrincipalIdentifier,
    identifier_type: input.identifierType,
    purpose_definition_ids: input.purposeDefinitionIds,
    captured_at: input.capturedAt,
  }
  if (input.rejectedPurposeDefinitionIds !== undefined) {
    body.rejected_purpose_definition_ids = input.rejectedPurposeDefinitionIds
  }
  if (input.clientRequestId !== undefined) {
    body.client_request_id = input.clientRequestId
  }

  const req: HttpRequest = {
    method: 'POST',
    path: '/consent/record',
    body,
    signal: input.signal,
    traceId: input.traceId,
  }
  const resp = await http.request<RecordEnvelope>(req)
  return resp.body
}

function validateRequired(value: unknown, name: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`@consentshield/node: ${name} is required and must be a non-empty string`)
  }
}
