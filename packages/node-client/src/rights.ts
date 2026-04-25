// ADR-1006 Phase 1 Sprint 1.3 — createRightsRequest + listRightsRequests.

import type { HttpClient } from './http'
import type {
  RightsCapturedVia,
  RightsRequestCreatedEnvelope,
  RightsRequestItem,
  RightsRequestListEnvelope,
  RightsRequestStatus,
  RightsRequestType,
} from './types'

const ALLOWED_TYPES: readonly RightsRequestType[] = ['erasure', 'access', 'correction', 'nomination']
const ALLOWED_STATUSES: readonly RightsRequestStatus[] = ['new', 'in_progress', 'completed', 'rejected']
const ALLOWED_CAPTURED_VIA: readonly RightsCapturedVia[] = [
  'portal', 'api', 'kiosk', 'branch', 'call_center', 'mobile_app', 'email', 'other',
]

export interface CreateRightsRequestInput {
  type: RightsRequestType
  requestorName: string
  requestorEmail: string
  requestDetails?: string | null
  /** Description of how the requestor's identity was confirmed (e.g. "in-branch ID check by branch-mgr-ABC"). Required. */
  identityVerifiedBy: string
  capturedVia?: RightsCapturedVia
  traceId?: string
  signal?: AbortSignal
}

export async function createRightsRequest(
  http: HttpClient,
  input: CreateRightsRequestInput,
): Promise<RightsRequestCreatedEnvelope> {
  if (!ALLOWED_TYPES.includes(input.type)) {
    throw new TypeError(
      `@consentshield/node: createRightsRequest input.type must be one of: ${ALLOWED_TYPES.join(', ')}`,
    )
  }
  validateRequired(input.requestorName, 'requestorName')
  validateRequired(input.requestorEmail, 'requestorEmail')
  validateRequired(input.identityVerifiedBy, 'identityVerifiedBy')
  if (input.capturedVia !== undefined && !ALLOWED_CAPTURED_VIA.includes(input.capturedVia)) {
    throw new TypeError(
      `@consentshield/node: createRightsRequest input.capturedVia must be one of: ${ALLOWED_CAPTURED_VIA.join(', ')}`,
    )
  }

  const body: Record<string, unknown> = {
    type: input.type,
    requestor_name: input.requestorName,
    requestor_email: input.requestorEmail,
    identity_verified_by: input.identityVerifiedBy,
  }
  if (input.requestDetails !== undefined && input.requestDetails !== null) {
    body.request_details = input.requestDetails
  }
  if (input.capturedVia !== undefined) body.captured_via = input.capturedVia

  const resp = await http.request<RightsRequestCreatedEnvelope>({
    method: 'POST',
    path: '/rights/requests',
    body,
    signal: input.signal,
    traceId: input.traceId,
  })
  return resp.body
}

export interface ListRightsRequestsInput {
  status?: RightsRequestStatus
  requestType?: RightsRequestType
  capturedVia?: RightsCapturedVia
  createdAfter?: string
  createdBefore?: string
  cursor?: string
  limit?: number
  traceId?: string
  signal?: AbortSignal
}

export async function listRightsRequests(
  http: HttpClient,
  input: ListRightsRequestsInput = {},
): Promise<RightsRequestListEnvelope> {
  if (input.status !== undefined && !ALLOWED_STATUSES.includes(input.status)) {
    throw new TypeError(
      `@consentshield/node: listRightsRequests input.status must be one of: ${ALLOWED_STATUSES.join(', ')}`,
    )
  }
  if (input.requestType !== undefined && !ALLOWED_TYPES.includes(input.requestType)) {
    throw new TypeError(
      `@consentshield/node: listRightsRequests input.requestType must be one of: ${ALLOWED_TYPES.join(', ')}`,
    )
  }
  if (input.capturedVia !== undefined && !ALLOWED_CAPTURED_VIA.includes(input.capturedVia)) {
    throw new TypeError(
      `@consentshield/node: listRightsRequests input.capturedVia must be one of: ${ALLOWED_CAPTURED_VIA.join(', ')}`,
    )
  }

  const resp = await http.request<RightsRequestListEnvelope>({
    method: 'GET',
    path: '/rights/requests',
    query: {
      status: input.status,
      request_type: input.requestType,
      captured_via: input.capturedVia,
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

export async function* iterateRightsRequests(
  http: HttpClient,
  input: ListRightsRequestsInput = {},
): AsyncIterableIterator<RightsRequestItem> {
  let cursor = input.cursor
  while (true) {
    const page: RightsRequestListEnvelope = await listRightsRequests(http, { ...input, cursor })
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
