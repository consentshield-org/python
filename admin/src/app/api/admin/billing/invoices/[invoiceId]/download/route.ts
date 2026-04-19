import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import { presignInvoicePdfUrl } from '@/lib/billing/r2-invoices'

// ADR-0050 Sprint 2.3 — GET /api/admin/billing/invoices/:invoiceId/download
//
// Presigns the R2 object for a short TTL and 307-redirects the operator
// to the signed URL. Authorisation layers:
//   · admin proxy enforces is_admin + AAL2 before the handler runs.
//   · admin.billing_invoice_detail enforces the tier + issuer-scope rule
//     and raises if the caller shouldn't see the invoice. We never call
//     presignInvoicePdfUrl on a row we couldn't read.

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ invoiceId: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { invoiceId } = await context.params
  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId required' }, { status: 400 })
  }

  const supabase = await createServerClient()
  const { data: callerRes } = await supabase.auth.getUser()
  if (!callerRes.user?.id) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }

  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_invoice_detail', { p_invoice_id: invoiceId })

  if (error) {
    const code = error.code === '42501' ? 403 : 400
    return NextResponse.json({ error: error.message }, { status: code })
  }

  const envelope = data as {
    invoice: { id: string; pdf_r2_key: string | null; status: string }
  } | null

  if (!envelope) {
    return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  }

  if (!envelope.invoice.pdf_r2_key) {
    return NextResponse.json(
      { error: `invoice ${envelope.invoice.id} has no PDF yet (status=${envelope.invoice.status})` },
      { status: 409 },
    )
  }

  try {
    const url = presignInvoicePdfUrl(envelope.invoice.pdf_r2_key, 300)
    return NextResponse.redirect(url, 307)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'presign failed' },
      { status: 500 },
    )
  }
}
