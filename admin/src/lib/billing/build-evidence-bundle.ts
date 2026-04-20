// ADR-0050 Sprint 3.2 — Pure evidence bundle assembly for dispute workspace.
//
// Extracted from the dispute server action so tests can verify ZIP contents
// without Next.js runtime or real R2. The action calls this with real fetchers;
// tests pass fakes.

import { createHash } from 'node:crypto'
import JSZip from 'jszip'

export interface DisputeInfo {
  id: string
  razorpay_dispute_id: string
  razorpay_payment_id: string
  amount_paise: number
  currency: string
  reason_code: string | null
  phase: string | null
  status: string
  deadline_at: string | null
  opened_at: string
}

export interface DisputeInvoice {
  invoice_number: string
  issue_date: string
  total_paise: number
  pdf_r2_key: string | null
}

export interface WebhookEventRow {
  event_id: string
  event_type: string
  received_at: string
  payload: Record<string, unknown>
}

export interface PlanHistoryRow {
  occurred_at: string
  action: string
  new_value: Record<string, unknown> | null
  reason: string | null
}

export interface AccountSnapshot {
  id: string
  name: string
  billing_email: string | null
  razorpay_customer_id: string | null
  razorpay_subscription_id: string | null
  plan: string | null
}

export interface EvidenceInput {
  dispute: DisputeInfo
  invoices: DisputeInvoice[]
  webhookEvents: WebhookEventRow[]
  planHistory: PlanHistoryRow[]
  account: AccountSnapshot
}

export interface EvidenceBundleResult {
  zipBuffer: Buffer
  sha256: string
  invoicePdfCount: number
  webhookEventCount: number
  planHistoryCount: number
}

export type PdfFetcher = (r2Key: string) => Promise<Buffer>

export async function buildEvidenceBundle(
  input: EvidenceInput,
  fetchPdf: PdfFetcher,
): Promise<EvidenceBundleResult> {
  const zip = new JSZip()

  // 1. Dispute summary JSON
  zip.file(
    'dispute.json',
    JSON.stringify(input.dispute, null, 2),
  )

  // 2. Account snapshot JSON
  zip.file(
    'account.json',
    JSON.stringify(input.account, null, 2),
  )

  // 3. Invoice PDFs
  let invoicePdfCount = 0
  const invoiceSummary: Array<{
    invoice_number: string
    issue_date: string
    total_inr: string
    pdf_in_zip: string
  }> = []

  for (const inv of input.invoices) {
    const row = {
      invoice_number: inv.invoice_number,
      issue_date: inv.issue_date,
      total_inr: (inv.total_paise / 100).toFixed(2),
      pdf_in_zip: 'no',
    }
    if (inv.pdf_r2_key) {
      try {
        const pdf = await fetchPdf(inv.pdf_r2_key)
        const safe = inv.invoice_number.replace(/[^A-Za-z0-9/_-]/g, '_')
        zip.file(`invoices/${safe}.pdf`, pdf)
        row.pdf_in_zip = 'yes'
        invoicePdfCount++
      } catch {
        row.pdf_in_zip = 'fetch_failed'
      }
    }
    invoiceSummary.push(row)
  }

  zip.file('invoices/index.json', JSON.stringify(invoiceSummary, null, 2))

  // 4. Webhook events NDJSON
  const ndjson = input.webhookEvents
    .map(e => JSON.stringify(e))
    .join('\n')
  zip.file('webhook-events.ndjson', ndjson)

  // 5. Plan history JSON
  zip.file('plan-history.json', JSON.stringify(input.planHistory, null, 2))

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const sha256 = createHash('sha256').update(zipBuffer).digest('hex')

  return {
    zipBuffer,
    sha256,
    invoicePdfCount,
    webhookEventCount: input.webhookEvents.length,
    planHistoryCount: input.planHistory.length,
  }
}
