// ADR-1006 Phase 1 Sprint 1.3 — record/revoke/artefacts/events/deletion/
// rights/audit method coverage. One pooled file because each method's
// shape is small + the pattern is identical (camelCase → snake_case
// boundary, 4xx surfaces ConsentShieldApiError, query strings skip
// undefined values). Method-specific edge cases get their own block.

import { describe, it, expect, vi } from 'vitest'
import { ConsentShieldClient, ConsentShieldApiError } from '../src/index'
import type {
  ArtefactDetail,
  ArtefactListEnvelope,
  AuditLogEnvelope,
  DeletionReceiptsEnvelope,
  DeletionTriggerEnvelope,
  EventListEnvelope,
  FetchImpl,
  RecordEnvelope,
  RevokeEnvelope,
  RightsRequestCreatedEnvelope,
  RightsRequestListEnvelope,
} from '../src/index'

const VALID_KEY = 'cs_live_abc'

function jsonResponse(body: unknown, status = 200, traceId?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (traceId) headers['x-cs-trace-id'] = traceId
  return new Response(JSON.stringify(body), { status, headers })
}

function problemResponse(status: number, title: string, detail: string): Response {
  return new Response(
    JSON.stringify({ type: 't', title, status, detail }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  )
}

function makeClient(fetchImpl: FetchImpl) {
  return new ConsentShieldClient({
    apiKey: VALID_KEY,
    baseUrl: 'https://api.example.com',
    fetchImpl,
    sleepImpl: async () => {},
    maxRetries: 0,
  })
}

// ─────────────────────────────────────────────────────────────────────
// recordConsent
// ─────────────────────────────────────────────────────────────────────

describe('recordConsent', () => {
  const SAMPLE: RecordEnvelope = {
    event_id: 'evt-1',
    created_at: '2026-04-25T10:00:00Z',
    artefact_ids: [
      { purpose_definition_id: 'pd-1', purpose_code: 'marketing', artefact_id: 'art-1', status: 'active' },
    ],
    idempotent_replay: false,
  }

  it('POSTs the snake_case body and returns the envelope', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE, 201))
    const client = makeClient(fetchMock)
    const result = await client.recordConsent({
      propertyId: 'prop-1',
      dataPrincipalIdentifier: 'user@x.com',
      identifierType: 'email',
      purposeDefinitionIds: ['pd-1'],
      capturedAt: '2026-04-25T10:00:00Z',
      clientRequestId: 'req-abc',
    })
    expect(result).toEqual(SAMPLE)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/consent/record')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      property_id: 'prop-1',
      data_principal_identifier: 'user@x.com',
      identifier_type: 'email',
      purpose_definition_ids: ['pd-1'],
      captured_at: '2026-04-25T10:00:00Z',
      client_request_id: 'req-abc',
    })
  })

  it('omits client_request_id + rejected_purpose_definition_ids when not supplied', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE, 201))
    const client = makeClient(fetchMock)
    await client.recordConsent({
      propertyId: 'prop-1',
      dataPrincipalIdentifier: 'user@x.com',
      identifierType: 'email',
      purposeDefinitionIds: ['pd-1'],
      capturedAt: '2026-04-25T10:00:00Z',
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual([
      'captured_at', 'data_principal_identifier', 'identifier_type', 'property_id', 'purpose_definition_ids',
    ])
  })

  it('throws RangeError synchronously on empty purposeDefinitionIds', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await expect(
      client.recordConsent({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        purposeDefinitionIds: [], capturedAt: 'c',
      }),
    ).rejects.toBeInstanceOf(RangeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────
// revokeArtefact
// ─────────────────────────────────────────────────────────────────────

describe('revokeArtefact', () => {
  const SAMPLE: RevokeEnvelope = {
    artefact_id: 'art-1',
    status: 'revoked',
    revocation_record_id: 'rev-1',
    idempotent_replay: false,
  }

  it('POSTs to /v1/consent/artefacts/{id}/revoke with snake_case body', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    const result = await client.revokeArtefact('art-1', {
      reasonCode: 'user_request',
      reasonNotes: 'ticket #42',
      actorType: 'operator',
      actorRef: 'ops@example.com',
    })
    expect(result).toEqual(SAMPLE)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.example.com/v1/consent/artefacts/art-1/revoke')
    const body = JSON.parse(init?.body as string)
    expect(body).toEqual({
      reason_code: 'user_request',
      actor_type: 'operator',
      reason_notes: 'ticket #42',
      actor_ref: 'ops@example.com',
    })
  })

  it('URL-encodes the artefact id', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await client.revokeArtefact('with/slashes#and&special', {
      reasonCode: 'x', actorType: 'user',
    })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example.com/v1/consent/artefacts/with%2Fslashes%23and%26special/revoke',
    )
  })

  it('throws TypeError on invalid actorType', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await expect(
      client.revokeArtefact('art-1', { reasonCode: 'x', actorType: 'admin' as unknown as 'user' }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces 409 Conflict as ConsentShieldApiError on terminal-state artefact', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () =>
      problemResponse(409, 'Conflict', 'artefact already revoked + replaced'),
    )
    const client = makeClient(fetchMock)
    await expect(
      client.revokeArtefact('art-1', { reasonCode: 'x', actorType: 'user' }),
    ).rejects.toMatchObject({ name: 'ConsentShieldApiError', status: 409 })
  })
})

// ─────────────────────────────────────────────────────────────────────
// listArtefacts + getArtefact + iterateArtefacts
// ─────────────────────────────────────────────────────────────────────

describe('listArtefacts + getArtefact + iterateArtefacts', () => {
  const PAGE_1: ArtefactListEnvelope = {
    items: [
      { artefact_id: 'a1', property_id: 'p', purpose_code: 'm', purpose_definition_id: 'pd-m', data_scope: ['email'], framework: 'dpdp', status: 'active', expires_at: null, revoked_at: null, revocation_record_id: null, replaced_by: null, identifier_type: 'email', created_at: '2026-04-25T10:00:00Z' },
      { artefact_id: 'a2', property_id: 'p', purpose_code: 'm', purpose_definition_id: 'pd-m', data_scope: ['email'], framework: 'dpdp', status: 'active', expires_at: null, revoked_at: null, revocation_record_id: null, replaced_by: null, identifier_type: 'email', created_at: '2026-04-25T09:00:00Z' },
    ],
    next_cursor: 'cursor-2',
  }
  const PAGE_2: ArtefactListEnvelope = {
    items: [
      { artefact_id: 'a3', property_id: 'p', purpose_code: 'm', purpose_definition_id: 'pd-m', data_scope: ['email'], framework: 'dpdp', status: 'active', expires_at: null, revoked_at: null, revocation_record_id: null, replaced_by: null, identifier_type: 'email', created_at: '2026-04-25T08:00:00Z' },
    ],
    next_cursor: null,
  }

  it('GETs with snake_case query, skips undefined fields', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(PAGE_1))
    const client = makeClient(fetchMock)
    await client.listArtefacts({ propertyId: 'p', purposeCode: 'm', status: 'active', limit: 50 })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/v1/consent/artefacts')
    expect(url.searchParams.get('property_id')).toBe('p')
    expect(url.searchParams.get('purpose_code')).toBe('m')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('identifier_type')).toBeNull()
    expect(url.searchParams.get('cursor')).toBeNull()
  })

  it('iterateArtefacts walks pages until next_cursor is null', async () => {
    const fetchMock = vi.fn<FetchImpl>(async (input) => {
      const u = new URL(String(input))
      if (u.searchParams.get('cursor') === 'cursor-2') return jsonResponse(PAGE_2)
      return jsonResponse(PAGE_1)
    })
    const client = makeClient(fetchMock)

    const seen: string[] = []
    for await (const artefact of client.iterateArtefacts({ propertyId: 'p' })) {
      seen.push(artefact.artefact_id)
    }
    expect(seen).toEqual(['a1', 'a2', 'a3'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getArtefact returns the detail body verbatim (including null-detail body)', async () => {
    const detail: ArtefactDetail = {
      ...PAGE_1.items[0]!,
      revocation: null,
      replacement_chain: [],
    }
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(detail))
    const client = makeClient(fetchMock)
    expect(await client.getArtefact('art-1')).toEqual(detail)
  })

  it('getArtefact returns null when the server emits a JSON null body for an unknown id', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(null))
    const client = makeClient(fetchMock)
    expect(await client.getArtefact('art-missing')).toBeNull()
  })

  it('getArtefact URL-encodes the id', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(null))
    const client = makeClient(fetchMock)
    await client.getArtefact('id with/special?')
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example.com/v1/consent/artefacts/id%20with%2Fspecial%3F',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────
// listEvents
// ─────────────────────────────────────────────────────────────────────

describe('listEvents', () => {
  it('GETs with snake_case query', async () => {
    const env: EventListEnvelope = { items: [], next_cursor: null }
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(env))
    const client = makeClient(fetchMock)
    await client.listEvents({
      propertyId: 'p', source: 'banner', eventType: 'consent_given',
      createdAfter: '2026-04-01', createdBefore: '2026-05-01',
    })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/v1/consent/events')
    expect(url.searchParams.get('property_id')).toBe('p')
    expect(url.searchParams.get('source')).toBe('banner')
    expect(url.searchParams.get('event_type')).toBe('consent_given')
    expect(url.searchParams.get('created_after')).toBe('2026-04-01')
    expect(url.searchParams.get('created_before')).toBe('2026-05-01')
  })
})

// ─────────────────────────────────────────────────────────────────────
// triggerDeletion
// ─────────────────────────────────────────────────────────────────────

describe('triggerDeletion', () => {
  const SAMPLE: DeletionTriggerEnvelope = {
    reason: 'consent_revoked',
    revoked_artefact_ids: ['a1'],
    revoked_count: 1,
    initial_status: 'pending',
    note: 'queued',
  }

  it('POSTs the snake_case body', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await client.triggerDeletion({
      propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
      reason: 'consent_revoked', purposeCodes: ['marketing'], actorType: 'user',
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)
    expect(body).toEqual({
      property_id: 'p',
      data_principal_identifier: 'd',
      identifier_type: 'email',
      reason: 'consent_revoked',
      purpose_codes: ['marketing'],
      actor_type: 'user',
    })
  })

  it('throws TypeError synchronously when reason=consent_revoked + purposeCodes missing', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'consent_revoked',
      }),
    ).rejects.toThrow(/purposeCodes is required/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows reason=erasure_request without purposeCodes', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await client.triggerDeletion({
      propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
      reason: 'erasure_request',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws TypeError on invalid reason synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(SAMPLE))
    const client = makeClient(fetchMock)
    await expect(
      client.triggerDeletion({
        propertyId: 'p', dataPrincipalIdentifier: 'd', identifierType: 'email',
        reason: 'misc' as unknown as 'consent_revoked',
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────
// listDeletionReceipts
// ─────────────────────────────────────────────────────────────────────

describe('listDeletionReceipts', () => {
  it('GETs with snake_case query + cursor', async () => {
    const env: DeletionReceiptsEnvelope = { items: [], next_cursor: null }
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(env))
    const client = makeClient(fetchMock)
    await client.listDeletionReceipts({
      triggerType: 'rights_request', status: 'confirmed', connectorId: 'conn-1',
      createdAfter: '2026-04-01', cursor: 'next', limit: 25,
    })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.searchParams.get('trigger_type')).toBe('rights_request')
    expect(url.searchParams.get('status')).toBe('confirmed')
    expect(url.searchParams.get('connector_id')).toBe('conn-1')
    expect(url.searchParams.get('created_after')).toBe('2026-04-01')
    expect(url.searchParams.get('cursor')).toBe('next')
    expect(url.searchParams.get('limit')).toBe('25')
  })
})

// ─────────────────────────────────────────────────────────────────────
// createRightsRequest + listRightsRequests
// ─────────────────────────────────────────────────────────────────────

describe('createRightsRequest + listRightsRequests', () => {
  const CREATED: RightsRequestCreatedEnvelope = {
    id: 'rr-1',
    status: 'new',
    request_type: 'erasure',
    captured_via: 'api',
    identity_verified: true,
    identity_verified_by: 'in-branch ID check',
    sla_deadline: '2026-05-25T10:00:00Z',
    created_at: '2026-04-25T10:00:00Z',
  }

  it('POSTs the snake_case body for create', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(CREATED, 201))
    const client = makeClient(fetchMock)
    await client.createRightsRequest({
      type: 'erasure',
      requestorName: 'Alice',
      requestorEmail: 'alice@x.com',
      requestDetails: 'delete my marketing data',
      identityVerifiedBy: 'OTP',
      capturedVia: 'api',
    })
    const body = JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)
    expect(body).toEqual({
      type: 'erasure',
      requestor_name: 'Alice',
      requestor_email: 'alice@x.com',
      identity_verified_by: 'OTP',
      request_details: 'delete my marketing data',
      captured_via: 'api',
    })
  })

  it('rejects invalid type synchronously', async () => {
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(CREATED))
    const client = makeClient(fetchMock)
    await expect(
      client.createRightsRequest({
        type: 'lookup' as unknown as 'erasure',
        requestorName: 'Alice', requestorEmail: 'alice@x.com', identityVerifiedBy: 'OTP',
      }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('listRightsRequests rejects invalid status synchronously', async () => {
    const env: RightsRequestListEnvelope = { items: [], next_cursor: null }
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(env))
    const client = makeClient(fetchMock)
    await expect(
      client.listRightsRequests({ status: 'pending' as unknown as 'new' }),
    ).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────
// listAuditLog
// ─────────────────────────────────────────────────────────────────────

describe('listAuditLog', () => {
  it('GETs with snake_case query', async () => {
    const env: AuditLogEnvelope = { items: [], next_cursor: null }
    const fetchMock = vi.fn<FetchImpl>(async () => jsonResponse(env))
    const client = makeClient(fetchMock)
    await client.listAuditLog({
      eventType: 'consent_recorded', entityType: 'artefact',
      createdAfter: '2026-04-01', limit: 100,
    })
    const url = new URL(fetchMock.mock.calls[0]![0] as string)
    expect(url.pathname).toBe('/v1/audit')
    expect(url.searchParams.get('event_type')).toBe('consent_recorded')
    expect(url.searchParams.get('entity_type')).toBe('artefact')
    expect(url.searchParams.get('created_after')).toBe('2026-04-01')
    expect(url.searchParams.get('limit')).toBe('100')
  })
})
