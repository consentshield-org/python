import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ADR-0052 Sprint 1.2 — Razorpay client unit tests (mocked fetch).
//
// These tests exercise the client-layer shape of uploadDocument +
// contestDispute without hitting the Razorpay API. Integration testing
// against the sandbox is manual — see ADR-0052 "manual smoke" for the
// procedure once Razorpay credentials + a test dispute exist.

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_unit'
  process.env.RAZORPAY_KEY_SECRET = 'unit_secret'
})

afterEach(() => {
  process.env = { ...originalEnv }
  vi.restoreAllMocks()
})

describe('ADR-0052 Sprint 1.2 — uploadDocument', () => {
  it('POSTs multipart form-data to /v1/documents with the expected parts', async () => {
    const { uploadDocument } = await import('../../admin/src/lib/razorpay/client')

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'doc_unit_test',
          entity: 'document',
          purpose: 'dispute_evidence',
          name: 'evidence-123.zip',
          mime_type: 'application/zip',
          size: 42,
          created_at: 1_680_000_000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await uploadDocument({
      file: Buffer.from('PK\x03\x04fake-zip-content'),
      filename: 'evidence-123.zip',
      contentType: 'application/zip',
    })

    expect(result.id).toBe('doc_unit_test')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/documents')
    expect((init.headers as Record<string, string>)['Content-Type']).toMatch(/multipart\/form-data; boundary=/)
    const body = init.body as Buffer
    expect(body.toString('utf8')).toContain('name="file"')
    expect(body.toString('utf8')).toContain('name="purpose"')
    expect(body.toString('utf8')).toContain('dispute_evidence')
  })

  it('throws RazorpayApiError on 4xx response', async () => {
    const { uploadDocument } = await import('../../admin/src/lib/razorpay/client')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'invalid file' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(
      uploadDocument({
        file: Buffer.from('bad'),
        filename: 'bad.zip',
        contentType: 'application/zip',
      }),
    ).rejects.toThrow(/invalid file|BAD_REQUEST_ERROR/)
  })
})

describe('ADR-0052 Sprint 1.2 — contestDispute', () => {
  it('POSTs JSON to /v1/disputes/{id}/contest with evidence + action', async () => {
    const { contestDispute } = await import('../../admin/src/lib/razorpay/client')

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'disp_unit',
          entity: 'dispute',
          payment_id: 'pay_unit',
          amount: 100000,
          currency: 'INR',
          status: 'under_review',
          created_at: 1_680_000_000,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await contestDispute({
      razorpayDisputeId: 'disp_unit',
      evidence: {
        amount: 100000,
        summary:
          'Unit test contest summary — evidence bundle attached as uncategorized_file.',
        uncategorized_file: ['doc_unit_test'],
      },
      action: 'submit',
    })

    expect(res.status).toBe('under_review')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/v1/disputes/disp_unit/contest')
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('submit')
    expect(body.summary).toContain('Unit test contest summary')
    expect(body.uncategorized_file).toEqual(['doc_unit_test'])
  })

  it('rejects missing summary', async () => {
    const { contestDispute } = await import('../../admin/src/lib/razorpay/client')
    await expect(
      contestDispute({
        razorpayDisputeId: 'disp_unit',
        evidence: { amount: 100, summary: '', uncategorized_file: [] },
        action: 'submit',
      }),
    ).rejects.toThrow(/summary must be at least 20/)
  })

  it('rejects summary > 1000 chars', async () => {
    const { contestDispute } = await import('../../admin/src/lib/razorpay/client')
    await expect(
      contestDispute({
        razorpayDisputeId: 'disp_unit',
        evidence: { amount: 100, summary: 'x'.repeat(1001) },
        action: 'submit',
      }),
    ).rejects.toThrow(/1000 characters/)
  })

  it('rejects non-positive amount', async () => {
    const { contestDispute } = await import('../../admin/src/lib/razorpay/client')
    await expect(
      contestDispute({
        razorpayDisputeId: 'disp_unit',
        evidence: { amount: 0, summary: 'Valid summary text longer than twenty characters for the guard.' },
        action: 'submit',
      }),
    ).rejects.toThrow(/positive integer/)
  })
})
