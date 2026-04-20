'use server'

import { createServerClient } from '@/lib/supabase/server'
import { fetchInvoicePdf } from '@/lib/billing/r2-invoices'
import {
  buildExportZip,
  type ManifestEnvelope,
  zipFilename,
} from '@/lib/billing/build-export-zip'

interface FilterInput {
  issuerId: string | null
  fyYear: string | null
  accountId: string | null
}

export async function previewExport(
  input: FilterInput,
): Promise<ManifestEnvelope | { error: string }> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_invoice_export_manifest', {
      p_issuer_id: input.issuerId,
      p_fy_year: input.fyYear,
      p_account_id: input.accountId,
    })
  if (error) return { error: error.message }
  if (!data) return { error: 'empty response' }
  return data as ManifestEnvelope
}

export async function generateExportZip(
  input: FilterInput,
): Promise<
  | { zipBytes: number[]; filename: string; rowCount: number; sha256: string }
  | { error: string }
> {
  const supabase = await createServerClient()

  const manifestRes = await supabase
    .schema('admin')
    .rpc('billing_invoice_export_manifest', {
      p_issuer_id: input.issuerId,
      p_fy_year: input.fyYear,
      p_account_id: input.accountId,
    })
  if (manifestRes.error) return { error: manifestRes.error.message }
  const envelope = manifestRes.data as ManifestEnvelope | null
  if (!envelope) return { error: 'empty manifest' }
  if (envelope.summary.pdf_available === 0) {
    return { error: 'no PDFs available for the selected scope' }
  }

  const { zipBuffer, sha256 } = await buildExportZip(envelope, fetchInvoicePdf)

  const auditRes = await supabase
    .schema('admin')
    .rpc('billing_invoice_export_audit', {
      p_issuer_id: input.issuerId,
      p_fy_year: input.fyYear,
      p_account_id: input.accountId,
      p_row_count: envelope.summary.count,
      p_zip_sha256: sha256,
    })
  if (auditRes.error) {
    return {
      error: `export succeeded but audit log failed: ${auditRes.error.message} (sha256 ${sha256.slice(0, 12)}…)`,
    }
  }

  return {
    zipBytes: Array.from(zipBuffer),
    filename: zipFilename(envelope),
    rowCount: envelope.summary.count,
    sha256,
  }
}
