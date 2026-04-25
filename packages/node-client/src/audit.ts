// ADR-1006 Phase 1 Sprint 1.3 — listAuditLog + cursor iterator.

import type { HttpClient } from './http'
import type { AuditLogEnvelope, AuditLogItem } from './types'

export interface ListAuditLogInput {
  eventType?: string
  entityType?: string
  createdAfter?: string
  createdBefore?: string
  cursor?: string
  limit?: number
  traceId?: string
  signal?: AbortSignal
}

export async function listAuditLog(
  http: HttpClient,
  input: ListAuditLogInput = {},
): Promise<AuditLogEnvelope> {
  const resp = await http.request<AuditLogEnvelope>({
    method: 'GET',
    path: '/audit',
    query: {
      event_type: input.eventType,
      entity_type: input.entityType,
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

export async function* iterateAuditLog(
  http: HttpClient,
  input: ListAuditLogInput = {},
): AsyncIterableIterator<AuditLogItem> {
  let cursor = input.cursor
  while (true) {
    const page: AuditLogEnvelope = await listAuditLog(http, { ...input, cursor })
    for (const item of page.items) yield item
    if (!page.next_cursor) return
    cursor = page.next_cursor
  }
}
