// ADR-1006 Phase 1 Sprint 1.3 — listArtefacts + getArtefact + cursor iterator.

import type { HttpClient } from './http'
import type { ArtefactDetail, ArtefactListEnvelope, ArtefactListItem } from './types'

export interface ListArtefactsInput {
  propertyId?: string
  purposeCode?: string
  status?: string
  identifierType?: string
  /** Opaque cursor returned by a previous call. Pass `null`/omit to start. */
  cursor?: string
  /** Page size 1..200. Server caps at 200; SDK forwards verbatim and lets the server enforce. */
  limit?: number
  traceId?: string
  signal?: AbortSignal
}

export async function listArtefacts(
  http: HttpClient,
  input: ListArtefactsInput = {},
): Promise<ArtefactListEnvelope> {
  const resp = await http.request<ArtefactListEnvelope>({
    method: 'GET',
    path: '/consent/artefacts',
    query: {
      property_id: input.propertyId,
      purpose_code: input.purposeCode,
      status: input.status,
      identifier_type: input.identifierType,
      cursor: input.cursor,
      limit: input.limit,
    },
    signal: input.signal,
    traceId: input.traceId,
  })
  return resp.body
}

/**
 * Async-iterator over every artefact matching the filter. Walks the cursor
 * automatically; stops when `next_cursor` is null.
 *
 * @example
 * ```ts
 * for await (const artefact of iterateArtefacts(http, { propertyId })) {
 *   console.log(artefact.artefact_id)
 * }
 * ```
 */
export async function* iterateArtefacts(
  http: HttpClient,
  input: ListArtefactsInput = {},
): AsyncIterableIterator<ArtefactListItem> {
  let cursor = input.cursor
  while (true) {
    const page: ArtefactListEnvelope = await listArtefacts(http, { ...input, cursor })
    for (const item of page.items) yield item
    if (!page.next_cursor) return
    cursor = page.next_cursor
  }
}

export async function getArtefact(
  http: HttpClient,
  artefactId: string,
  options: { traceId?: string; signal?: AbortSignal } = {},
): Promise<ArtefactDetail | null> {
  if (typeof artefactId !== 'string' || artefactId.length === 0) {
    throw new TypeError('@consentshield/node: getArtefact artefactId must be a non-empty string')
  }
  const resp = await http.request<ArtefactDetail | null>({
    method: 'GET',
    path: `/consent/artefacts/${encodeURIComponent(artefactId)}`,
    signal: options.signal,
    traceId: options.traceId,
  })
  return resp.body
}
