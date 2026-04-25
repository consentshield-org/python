// ADR-1006 Phase 1 Sprint 1.3 — listEvents (consent events).

import type { HttpClient } from './http'
import type { EventListEnvelope, EventListItem } from './types'

export interface ListEventsInput {
  propertyId?: string
  source?: string
  eventType?: string
  identifierType?: string
  createdAfter?: string
  createdBefore?: string
  cursor?: string
  limit?: number
  traceId?: string
  signal?: AbortSignal
}

export async function listEvents(
  http: HttpClient,
  input: ListEventsInput = {},
): Promise<EventListEnvelope> {
  const resp = await http.request<EventListEnvelope>({
    method: 'GET',
    path: '/consent/events',
    query: {
      property_id: input.propertyId,
      source: input.source,
      event_type: input.eventType,
      identifier_type: input.identifierType,
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

export async function* iterateEvents(
  http: HttpClient,
  input: ListEventsInput = {},
): AsyncIterableIterator<EventListItem> {
  let cursor = input.cursor
  while (true) {
    const page: EventListEnvelope = await listEvents(http, { ...input, cursor })
    for (const item of page.items) yield item
    if (!page.next_cursor) return
    cursor = page.next_cursor
  }
}
