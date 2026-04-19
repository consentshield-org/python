// ADR-0050 Sprint 2.2 — R2 invoice-upload wrapper.
//
// Uploads an invoice PDF to Cloudflare R2 under
//   invoices/{issuer_id}/{fy_year}/{invoice_number}.pdf
// and returns the content SHA-256. Reuses the admin-side sigv4 helper.

import { createHash } from 'node:crypto'

import { putObject, presignGet } from '@/lib/storage/sigv4'

const BUCKET_ENV = 'R2_INVOICES_BUCKET'

interface R2Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

function loadR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env[BUCKET_ENV]
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      `R2 credentials missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, ${BUCKET_ENV}`,
    )
  }
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    bucket,
    accessKeyId,
    secretAccessKey,
  }
}

export interface UploadInvoicePdfInput {
  issuerId: string
  fyYear: string
  invoiceNumber: string
  pdfBytes: Uint8Array
}

export interface UploadInvoicePdfResult {
  r2Key: string
  sha256: string
  bytes: number
}

export async function uploadInvoicePdf(
  input: UploadInvoicePdfInput,
): Promise<UploadInvoicePdfResult> {
  const cfg = loadR2Config()
  const key = invoiceR2Key(input.issuerId, input.fyYear, input.invoiceNumber)
  const body = Buffer.from(input.pdfBytes)

  const sha256 = createHash('sha256').update(body).digest('hex')

  await putObject({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    body,
    contentType: 'application/pdf',
  })

  return {
    r2Key: `${cfg.bucket}/${key}`,
    sha256,
    bytes: body.length,
  }
}

export function presignInvoicePdfUrl(r2Key: string, expiresIn = 900): string {
  const cfg = loadR2Config()
  const prefix = `${cfg.bucket}/`
  const key = r2Key.startsWith(prefix) ? r2Key.slice(prefix.length) : r2Key
  return presignGet({
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    key,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    expiresIn,
  })
}

export function invoiceR2Key(issuerId: string, fyYear: string, invoiceNumber: string): string {
  const safeNumber = invoiceNumber.replace(/[^A-Za-z0-9/_-]/g, '_')
  return `invoices/${issuerId}/${fyYear}/${safeNumber}.pdf`
}
