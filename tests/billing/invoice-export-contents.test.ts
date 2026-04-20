import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildExportZip,
  type ManifestEnvelope,
  type ManifestRow,
  type PdfFetcher,
} from '../../admin/src/lib/billing/build-export-zip'
import {
  AdminTestUser,
  cleanupAdminTestUser,
  createAdminTestUser,
  getAdminServiceClient,
} from '../admin/helpers'
import { cleanupTestOrg, createTestOrg, TestOrg } from '../rls/helpers'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'

// ADR-0050 Sprint 3.1 — invoice export CSV + ZIP contents + SHA-256
// round-trip vs the audit log.
//
// The scope rule (operator → active only; owner → all issuers) is covered
// by invoice-export-authz.test.ts. This file focuses on:
//   · operator export contains the 3 active-issuer invoices only
//   · owner export contains all 5 across both issuers
//   · CSV rows match manifest length + header + BOM + CRLF
//   · ZIP SHA-256 recorded by billing_invoice_export_audit == recomputed
//   · buildExportZip is deterministic given stable input (JSZip order)
//
// PDFs are faked via the PdfFetcher callback so the test runs without R2.

let owner: AdminTestUser
let operator: AdminTestUser
let customer: TestOrg
let retiredIssuerId: string
let activeIssuerId: string
const invoiceIds: string[] = []

const service = getAdminServiceClient()

let gstinSeed = Date.now() % 100_000
function nextGstin(): string {
  gstinSeed = (gstinSeed + 1) % 100_000
  return `29AAAAA${String(gstinSeed).padStart(5, '0').slice(-5)}B1Z`
}

async function populateBilling(accountId: string) {
  const { error } = await service
    .from('accounts')
    .update({
      billing_legal_name: 'Contents Test Customer',
      billing_gstin: null,
      billing_state_code: '29',
      billing_address: '1 Contents Rd, Bangalore',
      billing_email: 'contents@test.consentshield.in',
      billing_profile_updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
  if (error) throw new Error(error.message)
}

async function createIssuer(prefix: string): Promise<string> {
  const { data, error } = await owner.client
    .schema('admin')
    .rpc('billing_issuer_create', {
      p_legal_name: `Contents LLP ${prefix}`,
      p_gstin: nextGstin(),
      p_pan: 'AAAAA1234B',
      p_registered_state_code: '29',
      p_registered_address: '1 Test St, Bangalore',
      p_invoice_prefix: prefix,
      p_fy_start_month: 4,
      p_signatory_name: 'Test Signatory',
      p_signatory_designation: 'Director',
      p_bank_account_masked: '**** 0000',
      p_logo_r2_key: null,
    })
  if (error) throw new Error(error.message)
  return data as string
}

async function issueAndFinalize(periodStart: string, periodEnd: string): Promise<string> {
  const { data, error } = await operator.client
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: customer.accountId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_line_items: [
        {
          description: 'Contents test',
          hsn_sac: '9983',
          quantity: 1,
          rate_paise: 100_000,
          amount_paise: 100_000,
        },
      ],
      p_due_date: null,
    })
  if (error) throw new Error(error.message)
  const id = data as string
  const fin = await operator.client
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: id,
      p_pdf_r2_key: `test-bucket/invoices/contents/${id}.pdf`,
      p_pdf_sha256: 'c'.repeat(64),
    })
  if (fin.error) throw new Error(`finalize failed: ${fin.error.message}`)
  invoiceIds.push(id)
  return id
}

beforeAll(async () => {
  owner = await createAdminTestUser('platform_owner')
  operator = await createAdminTestUser('platform_operator')
  customer = await createTestOrg('expcontent')
  await populateBilling(customer.accountId)

  // 2 invoices under a retired issuer
  retiredIssuerId = await createIssuer('CTR')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: retiredIssuerId })
  await issueAndFinalize('2026-04-01', '2026-04-30')
  await issueAndFinalize('2026-05-01', '2026-05-31')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_retire', {
      p_id: retiredIssuerId,
      p_reason: 'rolling for export contents test',
    })

  // 3 invoices under the new active issuer
  activeIssuerId = await createIssuer('CTA')
  await owner.client
    .schema('admin')
    .rpc('billing_issuer_activate', { p_id: activeIssuerId })
  await issueAndFinalize('2026-06-01', '2026-06-30')
  await issueAndFinalize('2026-07-01', '2026-07-31')
  await issueAndFinalize('2026-08-01', '2026-08-31')
})

afterAll(async () => {
  if (invoiceIds.length > 0) {
    await service.from('invoices').delete().in('id', invoiceIds)
  }
  try {
    if (activeIssuerId) {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_retire', { p_id: activeIssuerId, p_reason: 'test cleanup' })
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: activeIssuerId })
    }
    if (retiredIssuerId) {
      await owner.client
        .schema('admin')
        .rpc('billing_issuer_hard_delete', { p_id: retiredIssuerId })
    }
  } catch {
    // best effort
  }
  if (customer) await cleanupTestOrg(customer)
  if (owner) await cleanupAdminTestUser(owner)
  if (operator) await cleanupAdminTestUser(operator)
})

function synthPdf(r2Key: string): Buffer {
  // Deterministic synthetic PDF bytes per key — so repeated calls return
  // the same content-hash.
  const body = `FAKE-PDF:${r2Key}`
  return Buffer.from(body, 'utf-8')
}

function makeFetcher(): PdfFetcher {
  return async (r2Key) => synthPdf(r2Key)
}

async function getManifestAs(user: AdminTestUser, issuerId: string | null) {
  const { data, error } = await user.client
    .schema('admin')
    .rpc('billing_invoice_export_manifest', {
      p_issuer_id: issuerId,
      p_fy_year: null,
      p_account_id: customer.accountId,
    })
  if (error) throw new Error(error.message)
  return data as ManifestEnvelope
}

describe('ADR-0050 Sprint 3.1 — invoice export contents', () => {
  it('operator scope: ZIP contains the 3 active-issuer PDFs only', async () => {
    const envelope = await getManifestAs(operator, null)
    expect(envelope.summary.count).toBe(3)
    envelope.rows.forEach((r: ManifestRow) => expect(r.issuer_is_active).toBe(true))

    const result = await buildExportZip(envelope, makeFetcher())
    expect(result.pdfCount).toBe(3)
    expect(result.pdfFetchFailed).toBe(0)
    expect(result.csvRowCount).toBe(3)

    const zip = await JSZip.loadAsync(result.zipBuffer)
    const pdfNames = Object.keys(zip.files)
      .filter((n) => n.endsWith('.pdf'))
      .sort()
    expect(pdfNames.length).toBe(3)
    expect(zip.files['index.csv']).toBeDefined()
  })

  it('owner scope: ZIP contains all 5 PDFs across both issuers', async () => {
    const envelope = await getManifestAs(owner, null)
    expect(envelope.summary.count).toBe(5)
    const result = await buildExportZip(envelope, makeFetcher())
    expect(result.pdfCount).toBe(5)
    expect(result.csvRowCount).toBe(5)

    const zip = await JSZip.loadAsync(result.zipBuffer)
    const pdfNames = Object.keys(zip.files).filter((n) => n.endsWith('.pdf'))
    expect(pdfNames.length).toBe(5)
  })

  it('CSV starts with UTF-8 BOM and has CRLF line endings', async () => {
    const envelope = await getManifestAs(owner, null)
    const result = await buildExportZip(envelope, makeFetcher())
    const zip = await JSZip.loadAsync(result.zipBuffer)
    const csvBytes = await zip.file('index.csv')!.async('uint8array')
    expect(csvBytes[0]).toBe(0xef)
    expect(csvBytes[1]).toBe(0xbb)
    expect(csvBytes[2]).toBe(0xbf)

    const csvText = new TextDecoder().decode(csvBytes.slice(3))
    expect(csvText).toContain('\r\n')
    const lines = csvText.split('\r\n').filter((l) => l.length > 0)
    expect(lines.length).toBe(1 + envelope.summary.count) // header + rows
    expect(lines[0]).toBe(
      'Invoice Number,FY,Issue Date,Issuer,Account,Total (INR),Status,PDF in ZIP,PDF SHA256',
    )
  })

  it('each CSV row SHA256 matches hash of the synthetic PDF bytes', async () => {
    const envelope = await getManifestAs(owner, null)
    const result = await buildExportZip(envelope, makeFetcher())
    const zip = await JSZip.loadAsync(result.zipBuffer)
    const csvBytes = await zip.file('index.csv')!.async('uint8array')
    const text = new TextDecoder().decode(csvBytes.slice(3))
    const rows = text
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1)
    for (const line of rows) {
      const cols = parseCsvLine(line)
      const invoiceNumber = cols[0]
      const sha256 = cols[8]
      const manifestRow = envelope.rows.find((r) => r.invoice_number === invoiceNumber)!
      const expected = createHash('sha256')
        .update(synthPdf(manifestRow.pdf_r2_key!))
        .digest('hex')
      expect(sha256).toBe(expected)
    }
  })

  it('ZIP SHA-256 stored via billing_invoice_export_audit == recompute', async () => {
    const envelope = await getManifestAs(owner, null)
    const result = await buildExportZip(envelope, makeFetcher())
    const recompute = createHash('sha256').update(result.zipBuffer).digest('hex')
    expect(recompute).toBe(result.sha256)

    const auditRes = await owner.client
      .schema('admin')
      .rpc('billing_invoice_export_audit', {
        p_issuer_id: null,
        p_fy_year: null,
        p_account_id: customer.accountId,
        p_row_count: envelope.summary.count,
        p_zip_sha256: result.sha256,
      })
    expect(auditRes.error).toBeNull()

    const { data: rows, error: readErr } = await service
      .schema('admin')
      .from('admin_audit_log')
      .select('new_value')
      .eq('action', 'billing_invoice_export')
      .eq('admin_user_id', owner.userId)
      .order('occurred_at', { ascending: false })
      .limit(1)
    expect(readErr).toBeNull()
    expect(rows?.length).toBe(1)
    const stored = rows![0].new_value as { zip_sha256: string; row_count: number }
    expect(stored.zip_sha256).toBe(result.sha256)
    expect(stored.row_count).toBe(envelope.summary.count)
  })

  it('buildExportZip is deterministic for identical inputs', async () => {
    const envelope = await getManifestAs(owner, null)
    const a = await buildExportZip(envelope, makeFetcher())
    const b = await buildExportZip(envelope, makeFetcher())
    // The CSV + PDF contents are byte-stable; JSZip's nodebuffer output
    // ordering matches insertion order which matches the manifest.
    expect(a.sha256).toBe(b.sha256)
  })

  it('missing PDF keys tagged "no" in CSV, fetch failures tagged "fetch_failed"', async () => {
    const envelope = await getManifestAs(owner, null)
    // Corrupt one row to simulate missing key, another to simulate fetch throw.
    const mutated: ManifestEnvelope = {
      ...envelope,
      rows: envelope.rows.map((r, i) => {
        if (i === 0) return { ...r, pdf_r2_key: null }
        return r
      }),
      summary: { ...envelope.summary, pdf_available: envelope.summary.pdf_available - 1 },
    }
    let callCount = 0
    const flakyFetcher: PdfFetcher = async (key) => {
      callCount++
      if (callCount === 1) throw new Error('simulated R2 404')
      return synthPdf(key)
    }
    const result = await buildExportZip(mutated, flakyFetcher)
    expect(result.pdfFetchFailed).toBe(1)
    expect(result.pdfCount).toBe(3) // 5 total → 1 missing → 1 fetch fail → 3 uploaded

    const zip = await JSZip.loadAsync(result.zipBuffer)
    const csvBytes = await zip.file('index.csv')!.async('uint8array')
    const text = new TextDecoder().decode(csvBytes.slice(3))
    const rows = text
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1)
    const pdfInZipCol = rows.map((line) => parseCsvLine(line)[7])
    expect(pdfInZipCol.filter((v) => v === 'no').length).toBe(1)
    expect(pdfInZipCol.filter((v) => v === 'fetch_failed').length).toBe(1)
    expect(pdfInZipCol.filter((v) => v === 'yes').length).toBe(3)
  })
})

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i += 2
        continue
      }
      if (c === '"') {
        inQuotes = false
        i++
        continue
      }
      cur += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    cur += c
    i++
  }
  out.push(cur)
  return out
}
