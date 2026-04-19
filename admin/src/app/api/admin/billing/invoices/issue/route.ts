import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import {
  renderInvoicePdf,
  type IssuerForPdf,
  type AccountForPdf,
  type InvoiceForPdf,
  type InvoiceLineForPdf,
} from '@/lib/billing/render-invoice'
import { uploadInvoicePdf } from '@/lib/billing/r2-invoices'
import { sendInvoiceEmail } from '@/lib/billing/resend-invoice'

// ADR-0050 Sprint 2.2 — POST /api/admin/billing/invoices/issue
//
// Flow:
//   1. Caller auth enforced by admin proxy (is_admin + AAL2).
//   2. admin.billing_issue_invoice RPC reserves FY sequence + inserts draft.
//   3. Load issuer + account + invoice rows (authed cs_admin client).
//   4. Render PDF → upload to R2 → SHA-256.
//   5. admin.billing_finalize_invoice_pdf flips draft → issued.
//   6. Resend dispatch; admin.billing_stamp_invoice_email records id.
//
// On any failure AFTER step 2: the row stays at status='draft' and the
// operator can retry via the same endpoint (FY sequence is permanent —
// a failed draft never becomes a gap because step 2's sequence is the
// invoice's only number). Step 4+ re-tries on an existing draft are a
// Sprint 2.3 concern; today the operator just calls again for a new draft.

export const runtime = 'nodejs'

interface IssueInvoiceBody {
  account_id?: string
  period_start?: string
  period_end?: string
  due_date?: string | null
  line_items?: InvoiceLineForPdf[]
}

export async function POST(request: Request) {
  let body: IssueInvoiceBody
  try {
    body = (await request.json()) as IssueInvoiceBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const { account_id, period_start, period_end, line_items } = body
  const due_date = body.due_date ?? null

  if (!account_id) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 })
  }
  if (!period_start || !period_end) {
    return NextResponse.json({ error: 'period_start and period_end required' }, { status: 400 })
  }
  if (!Array.isArray(line_items) || line_items.length === 0) {
    return NextResponse.json({ error: 'line_items must be a non-empty array' }, { status: 400 })
  }
  for (const line of line_items) {
    if (
      typeof line.description !== 'string' ||
      line.description.length === 0 ||
      typeof line.hsn_sac !== 'string' ||
      line.hsn_sac.length === 0 ||
      typeof line.quantity !== 'number' ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      typeof line.rate_paise !== 'number' ||
      !Number.isInteger(line.rate_paise) ||
      line.rate_paise < 0 ||
      typeof line.amount_paise !== 'number' ||
      !Number.isInteger(line.amount_paise) ||
      line.amount_paise < 0
    ) {
      return NextResponse.json(
        {
          error:
            'each line item requires { description, hsn_sac, quantity>0, rate_paise>=0, amount_paise>=0 }',
        },
        { status: 400 },
      )
    }
  }

  const supabase = await createServerClient()
  const { data: callerRes } = await supabase.auth.getUser()
  if (!callerRes.user?.id) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }

  // Step 1 — reserve the FY sequence and create the draft row.
  const { data: invoiceId, error: issueErr } = await supabase
    .schema('admin')
    .rpc('billing_issue_invoice', {
      p_account_id: account_id,
      p_period_start: period_start,
      p_period_end: period_end,
      p_line_items: line_items,
      p_due_date: due_date,
    })

  if (issueErr) {
    return NextResponse.json({ error: issueErr.message }, { status: 400 })
  }
  if (typeof invoiceId !== 'string') {
    return NextResponse.json({ error: 'RPC returned no invoice id' }, { status: 500 })
  }

  // Step 3 — load rendering envelope in one RPC call (bypass of REST-layer
  // role grants; the public.invoices / billing.issuer_entities / accounts
  // billing_* reads are gated to cs_admin at the role level and must flow
  // through a SECURITY DEFINER admin RPC).
  const { data: envelope, error: envelopeErr } = await supabase
    .schema('admin')
    .rpc('billing_invoice_pdf_envelope', { p_invoice_id: invoiceId })

  if (envelopeErr || !envelope) {
    return NextResponse.json(
      { error: envelopeErr?.message ?? 'invoice envelope not readable', invoice_id: invoiceId },
      { status: 500 },
    )
  }

  const env = envelope as {
    invoice: {
      id: string
      invoice_number: string
      fy_year: string
      issue_date: string
      due_date: string
      period_start: string
      period_end: string
      currency: string
      line_items: InvoiceLineForPdf[]
      subtotal_paise: number
      cgst_paise: number
      sgst_paise: number
      igst_paise: number
      total_paise: number
      issuer_entity_id: string
    }
    issuer: {
      id: string
      legal_name: string
      gstin: string
      pan: string
      registered_state_code: string
      registered_address: string
      invoice_prefix: string
      signatory_name: string
      signatory_designation: string | null
      bank_account_masked: string | null
    }
    account: {
      billing_legal_name: string
      billing_gstin: string | null
      billing_state_code: string
      billing_address: string
      billing_email: string
    }
  }

  const issuer: IssuerForPdf = env.issuer
  const account: AccountForPdf = env.account
  const invoice: InvoiceForPdf = {
    invoice_number: env.invoice.invoice_number,
    fy_year: env.invoice.fy_year,
    issue_date: env.invoice.issue_date,
    due_date: env.invoice.due_date,
    period_start: env.invoice.period_start,
    period_end: env.invoice.period_end,
    currency: env.invoice.currency,
    line_items: env.invoice.line_items,
    subtotal_paise: Number(env.invoice.subtotal_paise),
    cgst_paise: Number(env.invoice.cgst_paise),
    sgst_paise: Number(env.invoice.sgst_paise),
    igst_paise: Number(env.invoice.igst_paise),
    total_paise: Number(env.invoice.total_paise),
  }

  const pdfBytes = await renderInvoicePdf({ issuer, account, invoice })
  const uploaded = await uploadInvoicePdf({
    issuerId: env.invoice.issuer_entity_id,
    fyYear: invoice.fy_year,
    invoiceNumber: invoice.invoice_number,
    pdfBytes,
  })

  const { error: finalizeErr } = await supabase
    .schema('admin')
    .rpc('billing_finalize_invoice_pdf', {
      p_invoice_id: invoiceId,
      p_pdf_r2_key: uploaded.r2Key,
      p_pdf_sha256: uploaded.sha256,
    })
  if (finalizeErr) {
    return NextResponse.json(
      { error: finalizeErr.message, invoice_id: invoiceId, pdf_r2_key: uploaded.r2Key },
      { status: 500 },
    )
  }

  let emailMessageId: string | null = null
  try {
    const sent = await sendInvoiceEmail({
      to: account.billing_email,
      accountName: account.billing_legal_name,
      invoiceNumber: invoice.invoice_number,
      totalPaise: invoice.total_paise,
      currency: invoice.currency,
      dueDate: invoice.due_date,
      pdfBytes,
      issuerLegalName: issuer.legal_name,
    })
    emailMessageId = sent.messageId

    await supabase
      .schema('admin')
      .rpc('billing_stamp_invoice_email', {
        p_invoice_id: invoiceId,
        p_email_message_id: sent.messageId,
      })
  } catch (err) {
    // Email failure does not roll back the invoice; operators can re-send
    // via a future action. Surface the email error in the response so the
    // operator sees it.
    return NextResponse.json(
      {
        invoice_id: invoiceId,
        invoice_number: invoice.invoice_number,
        pdf_r2_key: uploaded.r2Key,
        pdf_sha256: uploaded.sha256,
        email_error: err instanceof Error ? err.message : 'email dispatch failed',
      },
      { status: 200 },
    )
  }

  return NextResponse.json(
    {
      invoice_id: invoiceId,
      invoice_number: invoice.invoice_number,
      pdf_r2_key: uploaded.r2Key,
      pdf_sha256: uploaded.sha256,
      bytes: uploaded.bytes,
      email_message_id: emailMessageId,
    },
    { status: 201 },
  )
}
