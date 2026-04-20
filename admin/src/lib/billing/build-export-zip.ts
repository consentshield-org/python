// ADR-0050 Sprint 3.1 — Pure ZIP+CSV assembly for invoice export.
//
// Extracted from the `/billing/export` server action so tests can exercise
// the CSV format + ZIP contents + SHA-256 determinism without Next.js
// runtime or real R2 credentials. The server action calls this with the
// real `fetchInvoicePdf` from `r2-invoices.ts`; tests pass a fake fetcher.

import { createHash } from 'node:crypto'
import JSZip from 'jszip'

export interface ManifestRow {
  id: string
  invoice_number: string
  fy_year: string
  fy_sequence: number
  issue_date: string
  total_paise: number
  status: string
  pdf_r2_key: string | null
  pdf_sha256: string | null
  issuer_id: string
  issuer_is_active: boolean
  issuer_legal_name: string
  account_id: string
  account_name: string
}

export interface ManifestEnvelope {
  rows: ManifestRow[]
  summary: {
    count: number
    total_paise: number
    pdf_available: number
    pdf_missing: number
  }
  scope: {
    caller_role: string
    issuer_id: string | null
    all_issuers: boolean
    fy_year: string | null
    account_id: string | null
  }
}

export interface ExportZipResult {
  zipBuffer: Buffer
  sha256: string
  csvRowCount: number
  pdfCount: number
  pdfFetchFailed: number
}

export type PdfFetcher = (r2Key: string) => Promise<Buffer>

const CSV_HEADER = [
  'Invoice Number',
  'FY',
  'Issue Date',
  'Issuer',
  'Account',
  'Total (INR)',
  'Status',
  'PDF in ZIP',
  'PDF SHA256',
]

export async function buildExportZip(
  envelope: ManifestEnvelope,
  fetchPdf: PdfFetcher,
): Promise<ExportZipResult> {
  const zip = new JSZip()
  const csvLines: string[] = [CSV_HEADER.map(csvField).join(',')]
  let pdfCount = 0
  let pdfFetchFailed = 0

  for (const r of envelope.rows) {
    if (!r.pdf_r2_key) {
      csvLines.push(csvRow(r, 'no', ''))
      continue
    }
    try {
      const pdf = await fetchPdf(r.pdf_r2_key)
      const safe = r.invoice_number.replace(/[^A-Za-z0-9/_-]/g, '_')
      zip.file(`${safe}.pdf`, pdf)
      const hash = createHash('sha256').update(pdf).digest('hex')
      csvLines.push(csvRow(r, 'yes', hash))
      pdfCount++
    } catch {
      pdfFetchFailed++
      csvLines.push(csvRow(r, 'fetch_failed', ''))
    }
  }

  zip.file(
    'index.csv',
    new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(csvLines.join('\r\n') + '\r\n'),
    ]),
  )

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const sha256 = createHash('sha256').update(zipBuffer).digest('hex')

  return {
    zipBuffer,
    sha256,
    csvRowCount: csvLines.length - 1,
    pdfCount,
    pdfFetchFailed,
  }
}

export function zipFilename(envelope: ManifestEnvelope): string {
  const tag = envelope.scope.all_issuers
    ? 'all-issuers'
    : envelope.scope.issuer_id?.slice(0, 8) ?? 'issuer'
  const fy = envelope.scope.fy_year ?? 'all-fys'
  return `invoices-${tag}-${fy}.zip`
}

function csvField(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvRow(r: ManifestRow, pdfInZip: string, sha256: string): string {
  return [
    r.invoice_number,
    r.fy_year,
    r.issue_date,
    r.issuer_legal_name,
    r.account_name,
    (r.total_paise / 100).toFixed(2),
    r.status,
    pdfInZip,
    sha256,
  ]
    .map(csvField)
    .join(',')
}
