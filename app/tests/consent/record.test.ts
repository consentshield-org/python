// ADR-1009 Phase 2 + ADR-1003 Sprint 1.4 — recordConsent helper unit tests.
//
// Focus: the storage_mode branch at the top of recordConsent. Standard
// orgs take the existing rpc_consent_record path; zero_storage orgs call
// rpc_consent_record_prepare_zero_storage + the bridge. A race where the
// mode flips between the lookup and the RPC call is surfaced by errcode
// P0003 on rpc_consent_record and must re-enter the zero-storage branch.

import { describe, it, expect, vi } from 'vitest'
import { recordConsent } from '@/lib/consent/record'
import type { BridgeResult } from '@/lib/delivery/zero-storage-bridge'

interface PgCall { query: string; values: unknown[] }

function makePgStub(responses: Array<unknown[] | Error>) {
  const calls: PgCall[] = []
  let i = 0
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    if (i >= responses.length) {
      return Promise.reject(new Error(`pg stub: unexpected call #${i + 1}`))
    }
    const next = responses[i++]
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next as unknown[])
  }) as unknown as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & { calls: PgCall[] }
  fn.calls = calls
  return fn
}

const BASE_PARAMS = {
  keyId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  propertyId: '33333333-3333-4333-8333-333333333333',
  identifier: 'jane@example.com',
  identifierType: 'email',
  acceptedPurposeIds: [
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ],
  capturedAt: '2026-04-24T12:00:00.000Z',
  clientRequestId: 'cli-req-abc',
}

describe('recordConsent — standard path', () => {
  it('calls rpc_consent_record when get_storage_mode returns standard', async () => {
    const envelope = {
      event_id: 'e1',
      created_at: BASE_PARAMS.capturedAt,
      artefact_ids: [
        {
          purpose_definition_id: BASE_PARAMS.acceptedPurposeIds[0],
          purpose_code: 'analytics',
          artefact_id: 'art-1',
          status: 'active',
        },
      ],
      idempotent_replay: false,
    }
    const api = makePgStub([
      [{ mode: 'standard' }],
      [{ result: envelope }],
    ])
    const orch = makePgStub([])
    const bridge = vi.fn()

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => orch as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(true)
    expect(res).toEqual({ ok: true, data: envelope })
    // Two cs_api queries: get_storage_mode + rpc_consent_record.
    expect(api.calls).toHaveLength(2)
    expect(api.calls[0]!.query).toContain('get_storage_mode')
    expect(api.calls[1]!.query).toContain('rpc_consent_record')
    expect(api.calls[1]!.query).not.toContain('prepare_zero_storage')
    expect(bridge).not.toHaveBeenCalled()
  })

  it('classifies api_key_binding errors (errcode 42501)', async () => {
    const api = makePgStub([
      [{ mode: 'standard' }],
      Object.assign(new Error('api_key_binding_failed: org_not_found'), { code: '42501' }),
    ])
    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => makePgStub([]) as never,
      processZeroStorageEvent: vi.fn() as never,
    })
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error')
    expect(res.error.kind).toBe('api_key_binding')
  })
})

describe('recordConsent — zero-storage path', () => {
  const PREP_RESULT = {
    event_fingerprint: 'fp-deadbeef-12345678',
    captured_at: BASE_PARAMS.capturedAt,
    identifier_hash: 'hash-of-jane',
    identifier_type: 'email',
    property_id: BASE_PARAMS.propertyId,
    purposes_accepted: [
      { purpose_definition_id: BASE_PARAMS.acceptedPurposeIds[0], purpose_code: 'analytics' },
      { purpose_definition_id: BASE_PARAMS.acceptedPurposeIds[1], purpose_code: 'marketing' },
    ],
    purposes_rejected: [],
    artefact_ids: [
      {
        purpose_definition_id: BASE_PARAMS.acceptedPurposeIds[0],
        purpose_code: 'analytics',
        artefact_id: 'zs-fp-deadbeef-12345678-analytics',
        status: 'active',
      },
      {
        purpose_definition_id: BASE_PARAMS.acceptedPurposeIds[1],
        purpose_code: 'marketing',
        artefact_id: 'zs-fp-deadbeef-12345678-marketing',
        status: 'active',
      },
    ],
  }

  it('calls prepare RPC + bridge when get_storage_mode returns zero_storage', async () => {
    const api = makePgStub([
      [{ mode: 'zero_storage' }],
      [{ result: PREP_RESULT }],
    ])
    const orch = makePgStub([])
    const bridge = vi.fn().mockResolvedValue({
      outcome: 'uploaded',
      orgId: BASE_PARAMS.orgId,
      durationMs: 42,
      indexed: 2,
    } satisfies BridgeResult)

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => orch as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.event_id).toBe('zs-fp-deadbeef-12345678')
    expect(res.data.artefact_ids).toEqual(PREP_RESULT.artefact_ids)
    expect(res.data.idempotent_replay).toBe(false)

    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]!.query).toContain('rpc_consent_record_prepare_zero_storage')

    expect(bridge).toHaveBeenCalledTimes(1)
    const bridgeReq = bridge.mock.calls[0]![1]
    expect(bridgeReq.kind).toBe('consent_event')
    expect(bridgeReq.org_id).toBe(BASE_PARAMS.orgId)
    expect(bridgeReq.event_fingerprint).toBe(PREP_RESULT.event_fingerprint)
    expect(bridgeReq.payload.identifier_hash).toBe(PREP_RESULT.identifier_hash)
    expect(bridgeReq.payload.identifier_type).toBe('email')
    expect(bridgeReq.payload.purposes_accepted).toEqual(['analytics', 'marketing'])
    expect(bridgeReq.payload.client_request_id).toBe(BASE_PARAMS.clientRequestId)
  })

  it('marks idempotent_replay when bridge indexes 0 rows on a second call', async () => {
    const api = makePgStub([
      [{ mode: 'zero_storage' }],
      [{ result: PREP_RESULT }],
    ])
    const bridge = vi.fn().mockResolvedValue({
      outcome: 'uploaded',
      orgId: BASE_PARAMS.orgId,
      durationMs: 5,
      indexed: 0,
    } satisfies BridgeResult)

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => makePgStub([]) as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.idempotent_replay).toBe(true)
  })

  it('does NOT mark replay when indexed=0 but indexError is set', async () => {
    const api = makePgStub([
      [{ mode: 'zero_storage' }],
      [{ result: PREP_RESULT }],
    ])
    const bridge = vi.fn().mockResolvedValue({
      outcome: 'uploaded',
      orgId: BASE_PARAMS.orgId,
      durationMs: 5,
      indexed: 0,
      indexError: 'FK violation',
    } satisfies BridgeResult)

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => makePgStub([]) as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.idempotent_replay).toBe(false)
  })

  it('returns zero_storage_bridge_failed when the bridge cannot upload', async () => {
    const api = makePgStub([
      [{ mode: 'zero_storage' }],
      [{ result: PREP_RESULT }],
    ])
    const bridge = vi.fn().mockResolvedValue({
      outcome: 'upload_failed',
      orgId: BASE_PARAMS.orgId,
      durationMs: 200,
      error: 'R2 PUT failed: 403',
    } satisfies BridgeResult)

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => makePgStub([]) as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('expected error')
    expect(res.error.kind).toBe('zero_storage_bridge_failed')
    if (res.error.kind !== 'zero_storage_bridge_failed') throw new Error('narrow')
    expect(res.error.detail).toContain('upload_failed')
    expect(res.error.detail).toContain('R2 PUT failed')
  })

  it('race: mode returns standard but RPC raises P0003 → retries via zero-storage branch', async () => {
    const api = makePgStub([
      [{ mode: 'standard' }],
      Object.assign(new Error('storage_mode_requires_bridge: org is in zero_storage mode'), { code: 'P0003' }),
      [{ result: PREP_RESULT }],
    ])
    const bridge = vi.fn().mockResolvedValue({
      outcome: 'uploaded',
      orgId: BASE_PARAMS.orgId,
      durationMs: 10,
      indexed: 2,
    } satisfies BridgeResult)

    const res = await recordConsent(BASE_PARAMS, {
      csApi: () => api as never,
      csOrchestrator: () => makePgStub([]) as never,
      processZeroStorageEvent: bridge as never,
    })

    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data.event_id).toBe('zs-fp-deadbeef-12345678')
    expect(bridge).toHaveBeenCalledTimes(1)
    // 3 cs_api queries: get_storage_mode, rpc_consent_record (raises),
    // rpc_consent_record_prepare_zero_storage (retry).
    expect(api.calls).toHaveLength(3)
    expect(api.calls[2]!.query).toContain('rpc_consent_record_prepare_zero_storage')
  })
})
