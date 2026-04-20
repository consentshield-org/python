'use server'

import { createServerClient } from '@/lib/supabase/server'

interface StatementRow {
  invoice_number: string
  invoice_date: string
  customer_legal_name: string
  customer_gstin: string | null
  customer_state_code: string
  place_of_supply: string
  hsn_sac: string
  taxable_value_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
  status: string
  issuer_gstin: string
  issuer_state_code: string
}

interface Summary {
  count: number
  subtotal_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
}

interface StatementEnvelope {
  rows: StatementRow[]
  summary: Summary
  scope: {
    caller_role: string
    issuer_id: string | null
    all_issuers: boolean
    fy_start: string
    fy_end: string
  }
}

export async function generateGstStatement(input: {
  issuerId: string | null
  fyStart: string
  fyEnd: string
}): Promise<
  | { summary: Summary; csv: string; filename: string }
  | { error: string }
> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_gst_statement', {
      p_issuer_id: input.issuerId,
      p_fy_start: input.fyStart,
      p_fy_end: input.fyEnd,
    })

  if (error) return { error: error.message }
  if (!data) return { error: 'empty response' }

  const env = data as StatementEnvelope
  const csv = renderCsv(env)
  const filename = csvFilename(env)
  return { summary: env.summary, csv, filename }
}

function renderCsv(env: StatementEnvelope): string {
  const headers = [
    'Invoice Number',
    'Invoice Date',
    'Customer Legal Name',
    'Customer GSTIN',
    'Place of Supply',
    'HSN/SAC',
    'Taxable Value (INR)',
    'CGST (INR)',
    'SGST (INR)',
    'IGST (INR)',
    'Total (INR)',
    'Status',
    'Issuer GSTIN',
    'Issuer State',
  ]
  const lines: string[] = []
  lines.push(headers.map(csvField).join(','))
  for (const r of env.rows) {
    lines.push(
      [
        r.invoice_number,
        r.invoice_date,
        r.customer_legal_name,
        r.customer_gstin ?? 'Unregistered',
        r.place_of_supply,
        r.hsn_sac,
        paiseToRupees(r.taxable_value_paise),
        paiseToRupees(r.cgst_paise),
        paiseToRupees(r.sgst_paise),
        paiseToRupees(r.igst_paise),
        paiseToRupees(r.total_paise),
        r.status,
        r.issuer_gstin,
        r.issuer_state_code,
      ]
        .map(csvField)
        .join(','),
    )
  }
  // Totals row
  const s = env.summary
  lines.push(
    [
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      paiseToRupees(s.subtotal_paise),
      paiseToRupees(s.cgst_paise),
      paiseToRupees(s.sgst_paise),
      paiseToRupees(s.igst_paise),
      paiseToRupees(s.total_paise),
      `count=${s.count}`,
      '',
      '',
    ]
      .map(csvField)
      .join(','),
  )
  return lines.join('\r\n') + '\r\n'
}

function csvField(v: unknown): string {
  const s = v == null ? '' : String(v)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function paiseToRupees(p: number | string): string {
  const n = typeof p === 'string' ? Number(p) : p
  return (n / 100).toFixed(2)
}

function csvFilename(env: StatementEnvelope): string {
  const tag = env.scope.all_issuers
    ? 'all-issuers'
    : env.scope.issuer_id?.slice(0, 8) ?? 'issuer'
  return `gst-statement-${tag}-${env.scope.fy_start}-to-${env.scope.fy_end}.csv`
}
