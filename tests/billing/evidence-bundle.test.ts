import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'

import {
  buildEvidenceBundle,
  type EvidenceInput,
} from '../../admin/src/lib/billing/build-evidence-bundle'

// ADR-0050 Sprint 3.2 — buildEvidenceBundle unit tests.
//
// All tests use a fake PDF fetcher — no R2 or runtime needed.
// Verifies:
//   · ZIP contains required files (dispute.json, account.json, invoices/index.json,
//     webhook-events.ndjson, plan-history.json)
//   · Invoice PDFs are included when fetcher succeeds; tagged fetch_failed otherwise
//   · invoicePdfCount / webhookEventCount / planHistoryCount are accurate
//   · Bundle is deterministic (same sha256 for same input + fetcher output)

const FAKE_PDF = Buffer.from('PDF-content-for-test')

const fakeFetcher = async (_key: string) => FAKE_PDF
const failingFetcher = async (_key: string) => { throw new Error('R2 unavailable') }

const DISPUTE: EvidenceInput['dispute'] = {
  id: 'uuid-dispute-1',
  razorpay_dispute_id: 'disp_test123',
  razorpay_payment_id: 'pay_test123',
  amount_paise: 50000,
  currency: 'INR',
  reason_code: 'chargeback',
  phase: 'chargeback',
  status: 'open',
  deadline_at: '2026-05-15T10:00:00Z',
  opened_at: '2026-05-01T10:00:00Z',
}

const ACCOUNT: EvidenceInput['account'] = {
  id: 'uuid-account-1',
  name: 'Acme Corp',
  billing_email: 'billing@acme.test',
  razorpay_customer_id: 'cust_xxx',
  razorpay_subscription_id: 'sub_xxx',
  plan: 'growth',
}

const INVOICES: EvidenceInput['invoices'] = [
  { invoice_number: 'CS-25-26-001', issue_date: '2026-04-01', total_paise: 49000, pdf_r2_key: 'invoices/iss/2025-26/CS-25-26-001.pdf' },
  { invoice_number: 'CS-25-26-002', issue_date: '2026-05-01', total_paise: 49000, pdf_r2_key: null },
]

const WEBHOOK_EVENTS: EvidenceInput['webhookEvents'] = [
  { event_id: 'evt_001', event_type: 'subscription.charged', received_at: '2026-04-01T08:00:00Z', payload: { amount: 49000 } },
  { event_id: 'evt_002', event_type: 'dispute.created', received_at: '2026-05-01T10:00:00Z', payload: { dispute_id: 'disp_test123' } },
]

const PLAN_HISTORY: EvidenceInput['planHistory'] = [
  { occurred_at: '2025-12-01T00:00:00Z', action: 'billing_plan_change', new_value: { plan: 'growth' }, reason: 'upgrade' },
]

async function buildInput(overrides: Partial<EvidenceInput> = {}): Promise<EvidenceInput> {
  return { dispute: DISPUTE, invoices: INVOICES, webhookEvents: WEBHOOK_EVENTS, planHistory: PLAN_HISTORY, account: ACCOUNT, ...overrides }
}

describe('ADR-0050 Sprint 3.2 — buildEvidenceBundle', () => {
  it('ZIP contains all required files', async () => {
    const input = await buildInput()
    const { zipBuffer } = await buildEvidenceBundle(input, fakeFetcher)
    const zip = await JSZip.loadAsync(zipBuffer)
    const files = Object.keys(zip.files)
    expect(files).toContain('dispute.json')
    expect(files).toContain('account.json')
    expect(files).toContain('invoices/index.json')
    expect(files).toContain('webhook-events.ndjson')
    expect(files).toContain('plan-history.json')
  })

  it('invoice PDF included when fetcher succeeds', async () => {
    const input = await buildInput()
    const { zipBuffer, invoicePdfCount } = await buildEvidenceBundle(input, fakeFetcher)
    expect(invoicePdfCount).toBe(1) // only first invoice has pdf_r2_key

    const zip = await JSZip.loadAsync(zipBuffer)
    const pdfFile = zip.file('invoices/CS-25-26-001.pdf')
    expect(pdfFile).not.toBeNull()
    const content = await pdfFile!.async('nodebuffer')
    expect(content).toEqual(FAKE_PDF)
  })

  it('PDF tagged fetch_failed in index when fetcher throws', async () => {
    const input = await buildInput()
    const { zipBuffer, invoicePdfCount } = await buildEvidenceBundle(input, failingFetcher)
    expect(invoicePdfCount).toBe(0)

    const zip = await JSZip.loadAsync(zipBuffer)
    const indexRaw = await zip.file('invoices/index.json')!.async('string')
    const index = JSON.parse(indexRaw) as Array<{ invoice_number: string; pdf_in_zip: string }>
    const first = index.find(r => r.invoice_number === 'CS-25-26-001')
    expect(first?.pdf_in_zip).toBe('fetch_failed')
  })

  it('invoice without pdf_r2_key tagged no in index', async () => {
    const input = await buildInput()
    const { zipBuffer } = await buildEvidenceBundle(input, fakeFetcher)
    const zip = await JSZip.loadAsync(zipBuffer)
    const indexRaw = await zip.file('invoices/index.json')!.async('string')
    const index = JSON.parse(indexRaw) as Array<{ invoice_number: string; pdf_in_zip: string }>
    const second = index.find(r => r.invoice_number === 'CS-25-26-002')
    expect(second?.pdf_in_zip).toBe('no')
  })

  it('counts are correct', async () => {
    const input = await buildInput()
    const result = await buildEvidenceBundle(input, fakeFetcher)
    expect(result.invoicePdfCount).toBe(1)
    expect(result.webhookEventCount).toBe(2)
    expect(result.planHistoryCount).toBe(1)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('webhook-events.ndjson has one JSON object per line', async () => {
    const input = await buildInput()
    const { zipBuffer } = await buildEvidenceBundle(input, fakeFetcher)
    const zip = await JSZip.loadAsync(zipBuffer)
    const ndjson = await zip.file('webhook-events.ndjson')!.async('string')
    const lines = ndjson.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    lines.forEach(l => expect(() => JSON.parse(l)).not.toThrow())
  })

  it('sha256 is deterministic for same inputs', async () => {
    const input = await buildInput()
    const r1 = await buildEvidenceBundle(input, fakeFetcher)
    const r2 = await buildEvidenceBundle(input, fakeFetcher)
    expect(r1.sha256).toBe(r2.sha256)
  })

  it('zero invoices produces valid ZIP with empty index', async () => {
    const input = await buildInput({ invoices: [] })
    const { zipBuffer, invoicePdfCount } = await buildEvidenceBundle(input, fakeFetcher)
    expect(invoicePdfCount).toBe(0)
    const zip = await JSZip.loadAsync(zipBuffer)
    const indexRaw = await zip.file('invoices/index.json')!.async('string')
    expect(JSON.parse(indexRaw)).toEqual([])
  })
})
