'use server'

import { createServerClient } from '@/lib/supabase/server'
import { fetchInvoicePdf } from '@/lib/billing/r2-invoices'
import { uploadEvidenceBundle } from '@/lib/billing/r2-disputes'
import {
  buildEvidenceBundle,
  type EvidenceInput,
  type DisputeInfo,
  type DisputeInvoice,
  type WebhookEventRow,
  type PlanHistoryRow,
  type AccountSnapshot,
} from '@/lib/billing/build-evidence-bundle'

export interface DisputeRow {
  id: string
  razorpay_dispute_id: string
  razorpay_payment_id: string
  account_id: string | null
  account_name: string | null
  invoice_id: string | null
  status: string
  amount_paise: number
  currency: string
  reason_code: string | null
  phase: string | null
  deadline_at: string | null
  evidence_bundle_r2_key: string | null
  evidence_assembled_at: string | null
  submitted_at: string | null
  resolved_at: string | null
  resolved_reason: string | null
  opened_at: string
  updated_at: string
  // ADR-0052 contest fields
  contest_summary: string | null
  contest_packet_r2_key: string | null
  contest_packet_prepared_at: string | null
  contest_razorpay_response: Record<string, unknown> | null
}

export async function listDisputes(): Promise<
  DisputeRow[] | { error: string }
> {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('disputes')
    .select(
      `id, razorpay_dispute_id, razorpay_payment_id, account_id,
       invoice_id, status, amount_paise, currency, reason_code, phase,
       deadline_at, evidence_bundle_r2_key, evidence_assembled_at,
       submitted_at, resolved_at, resolved_reason, opened_at, updated_at,
       contest_summary, contest_packet_r2_key, contest_packet_prepared_at,
       contest_razorpay_response, accounts(name)`,
    )
    .order('opened_at', { ascending: false })

  if (error) return { error: error.message }
  return (data ?? []).map(r => ({
    ...(r as Omit<typeof r, 'accounts'>),
    account_name: (r as { accounts?: { name?: string } }).accounts?.name ?? null,
  })) as DisputeRow[]
}

export interface LedgerEventRow {
  id: string
  event_type: string
  event_source: string
  occurred_at: string
  source_ref: string | null
  metadata: Record<string, unknown> | null
}

export async function getDisputeDetail(disputeId: string): Promise<
  | {
      dispute: DisputeRow
      webhookEvents: WebhookEventRow[]
      planHistory: PlanHistoryRow[]
      ledger: LedgerEventRow[]
    }
  | { error: string }
> {
  const supabase = await createServerClient()

  const { data: d, error: de } = await supabase
    .from('disputes')
    .select(
      `id, razorpay_dispute_id, razorpay_payment_id, account_id,
       invoice_id, status, amount_paise, currency, reason_code, phase,
       deadline_at, evidence_bundle_r2_key, evidence_assembled_at,
       submitted_at, resolved_at, resolved_reason, opened_at, updated_at,
       contest_summary, contest_packet_r2_key, contest_packet_prepared_at,
       contest_razorpay_response, accounts(name)`,
    )
    .eq('id', disputeId)
    .single()

  if (de || !d) return { error: de?.message ?? 'dispute not found' }
  const dispute = {
    ...(d as Omit<typeof d, 'accounts'>),
    account_name: (d as { accounts?: { name?: string } }).accounts?.name ?? null,
  } as DisputeRow

  // Webhook events linked to the dispute's payment_id
  const { data: events } = await supabase
    .schema('billing')
    .from('razorpay_webhook_events')
    .select('event_id, event_type, received_at, payload')
    .or(
      `payload->>'payload'->>'payment'->>'entity'->>'id'.eq.${dispute.razorpay_payment_id},` +
        `event_id.like.%${dispute.razorpay_dispute_id}%`,
    )
    .order('received_at', { ascending: true })

  // Plan history from admin audit log for this account
  const { data: history } = dispute.account_id
    ? await supabase
        .schema('admin')
        .from('admin_audit_log')
        .select('occurred_at, action, new_value, reason')
        .eq('target_id', dispute.account_id)
        .in('action', ['billing_plan_change', 'billing_subscription_change'])
        .order('occurred_at', { ascending: false })
        .limit(50)
    : { data: null }

  // Evidence ledger — unified chargeback-defense timeline (ADR-0051).
  const { data: ledgerRows } = dispute.account_id
    ? await supabase
        .schema('admin')
        .rpc('billing_evidence_ledger_for_account', {
          p_account_id: dispute.account_id,
          p_from: null,
          p_to: null,
          p_limit: 500,
        })
    : { data: null }

  return {
    dispute,
    webhookEvents: (events ?? []) as WebhookEventRow[],
    planHistory: (history ?? []) as PlanHistoryRow[],
    ledger: (ledgerRows ?? []) as LedgerEventRow[],
  }
}

export async function assembleEvidenceBundle(
  disputeId: string,
): Promise<{ presignedUrl: string; sha256: string } | { error: string }> {
  const supabase = await createServerClient()

  // 1. Load dispute + related data (includes evidence ledger per ADR-0051)
  const detail = await getDisputeDetail(disputeId)
  if ('error' in detail) return { error: detail.error }
  const { dispute, webhookEvents, planHistory, ledger } = detail

  // 2. Load invoices linked to the account for cross-reference
  const { data: invoiceRows } = dispute.account_id
    ? await supabase
        .from('invoices')
        .select('invoice_number, issue_date, total_paise, pdf_r2_key')
        .eq('account_id', dispute.account_id)
        .order('issue_date', { ascending: false })
        .limit(12)
    : { data: null }

  // 3. Load account snapshot
  const { data: accountRow } = dispute.account_id
    ? await supabase
        .from('accounts')
        .select(
          'id, name, billing_email, razorpay_customer_id, razorpay_subscription_id, plan',
        )
        .eq('id', dispute.account_id)
        .single()
    : { data: null }

  // Evidence ledger already loaded by getDisputeDetail() above.

  const disputeInfo: DisputeInfo = {
    id: dispute.id,
    razorpay_dispute_id: dispute.razorpay_dispute_id,
    razorpay_payment_id: dispute.razorpay_payment_id,
    amount_paise: dispute.amount_paise,
    currency: dispute.currency,
    reason_code: dispute.reason_code,
    phase: dispute.phase,
    status: dispute.status,
    deadline_at: dispute.deadline_at,
    opened_at: dispute.opened_at,
  }

  const invoices: DisputeInvoice[] = (invoiceRows ?? []).map(r => ({
    invoice_number: (r as { invoice_number: string }).invoice_number,
    issue_date: (r as { issue_date: string }).issue_date,
    total_paise: (r as { total_paise: number }).total_paise,
    pdf_r2_key: (r as { pdf_r2_key: string | null }).pdf_r2_key,
  }))

  const account: AccountSnapshot = accountRow
    ? {
        id: (accountRow as { id: string }).id,
        name: (accountRow as { name: string }).name,
        billing_email: (accountRow as { billing_email: string | null }).billing_email,
        razorpay_customer_id: (accountRow as { razorpay_customer_id: string | null }).razorpay_customer_id,
        razorpay_subscription_id: (accountRow as { razorpay_subscription_id: string | null }).razorpay_subscription_id,
        plan: (accountRow as { plan: string | null }).plan,
      }
    : {
        id: dispute.account_id ?? '',
        name: dispute.account_name ?? 'Unknown',
        billing_email: null,
        razorpay_customer_id: null,
        razorpay_subscription_id: null,
        plan: null,
      }

  const evidenceInput: EvidenceInput = {
    dispute: disputeInfo,
    invoices,
    webhookEvents,
    planHistory,
    account,
    ledger,
  }

  // 4. Build ZIP
  const bundle = await buildEvidenceBundle(evidenceInput, fetchInvoicePdf)

  // 5. Upload to R2
  const upload = await uploadEvidenceBundle(disputeId, bundle.zipBuffer)

  // 6. Record r2 key in DB + audit log
  const { error: evidenceError } = await supabase
    .schema('admin')
    .rpc('billing_dispute_set_evidence', {
      p_dispute_id: disputeId,
      p_r2_key: upload.r2Key,
    })

  if (evidenceError) return { error: evidenceError.message }

  return {
    presignedUrl: upload.presignedUrl,
    sha256: upload.sha256,
  }
}

// ADR-0052 Sprint 1.1 — contest preparation + manual submit tracking.
// Sprint 1.2 — live Razorpay API integration (uploadDocument + contestDispute).
export async function prepareContestPacket(
  disputeId: string,
  summary: string,
  packetR2Key: string | null = null,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_dispute_prepare_contest', {
      p_dispute_id: disputeId,
      p_summary: summary,
      p_packet_r2_key: packetR2Key,
    })
  if (error) return { error: error.message }
  return { ok: true }
}

export async function markContestSubmitted(
  disputeId: string,
  response: Record<string, unknown> | null = null,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_dispute_mark_contest_submitted', {
      p_dispute_id: disputeId,
      p_response: response,
    })
  if (error) return { error: error.message }
  return { ok: true }
}

/**
 * ADR-0052 Sprint 1.2 — live Razorpay submit.
 *
 * Flow:
 *   1. Load dispute + validate packet prepared + evidence bundle present.
 *   2. Fetch the evidence bundle ZIP from R2.
 *   3. Upload the ZIP to Razorpay Documents API → get document_id.
 *   4. Call Razorpay contest API with the summary + document_id.
 *   5. Persist the Razorpay response via billing_dispute_mark_contest_submitted.
 *
 * Returns the Razorpay dispute response or an error object. Audit-logged
 * via the existing admin.admin_audit_log trigger chain (which also feeds
 * the evidence ledger in ADR-0051).
 */
export async function submitContestViaRazorpay(
  disputeId: string,
): Promise<
  | { ok: true; razorpay_dispute_id: string; razorpay_document_id: string }
  | { error: string }
> {
  const { contestDispute, uploadDocument, isRazorpayEnvReady } = await import(
    '@/lib/razorpay/client'
  )
  const { fetchEvidenceBundle } = await import('@/lib/billing/r2-disputes')

  if (!isRazorpayEnvReady()) {
    return {
      error:
        'Razorpay credentials not configured on the admin server. Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET.',
    }
  }

  const supabase = await createServerClient()

  // 1. Load the dispute record with everything we need for the contest
  const { data: d, error: dErr } = await supabase
    .from('disputes')
    .select(
      `razorpay_dispute_id, amount_paise, contest_summary,
       contest_packet_prepared_at, contest_packet_r2_key,
       evidence_bundle_r2_key, status`,
    )
    .eq('id', disputeId)
    .single()

  if (dErr || !d) {
    return { error: dErr?.message ?? 'dispute not found' }
  }
  if (!d.contest_packet_prepared_at) {
    return {
      error:
        'Contest packet not prepared yet. Prepare summary + packet first, then submit.',
    }
  }
  if (!d.contest_summary) {
    return { error: 'contest_summary missing; re-prepare the packet.' }
  }
  const bundleKey = (d.contest_packet_r2_key ?? d.evidence_bundle_r2_key) as string | null
  if (!bundleKey) {
    return {
      error:
        'No evidence bundle attached. Run "Assemble Evidence Bundle" before submitting.',
    }
  }
  if (d.status !== 'open') {
    return { error: `Cannot submit from status '${d.status}'; only 'open' is submittable.` }
  }

  // 2. Fetch the bundle ZIP
  let zipBuffer: Buffer
  try {
    zipBuffer = await fetchEvidenceBundle(bundleKey)
  } catch (e) {
    return { error: `Failed to fetch evidence bundle from R2: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 3. Upload to Razorpay Documents API
  let documentId: string
  try {
    const doc = await uploadDocument({
      file: zipBuffer,
      filename: `evidence-${disputeId}.zip`,
      contentType: 'application/zip',
      purpose: 'dispute_evidence',
    })
    documentId = doc.id
  } catch (e) {
    return {
      error: `Razorpay document upload failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // 4. Contest via Razorpay contest API
  let contestResponse: Awaited<ReturnType<typeof contestDispute>>
  try {
    contestResponse = await contestDispute({
      razorpayDisputeId: d.razorpay_dispute_id as string,
      evidence: {
        amount: d.amount_paise as number,
        summary: d.contest_summary as string,
        uncategorized_file: [documentId],
      },
      action: 'submit',
    })
  } catch (e) {
    return {
      error: `Razorpay contest submission failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // 5. Persist the response
  const markResult = await markContestSubmitted(
    disputeId,
    contestResponse as unknown as Record<string, unknown>,
  )
  if ('error' in markResult) {
    // Razorpay succeeded but our record-keeping failed — surface loudly.
    return {
      error: `Razorpay submit OK (dispute ${contestResponse.id}) but record failed: ${markResult.error}`,
    }
  }

  return {
    ok: true,
    razorpay_dispute_id: contestResponse.id,
    razorpay_document_id: documentId,
  }
}

export async function markDisputeState(
  disputeId: string,
  newStatus: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_dispute_mark_state', {
      p_dispute_id: disputeId,
      p_new_status: newStatus,
      p_reason: reason,
    })
  if (error) return { error: error.message }
  return { ok: true }
}
