'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import {
  isRazorpayEnvReady,
  issueRefund,
  RazorpayApiError,
  RazorpayEnvError,
} from '@/lib/razorpay/client'

// ADR-0034 Sprint 2.2 — Billing Operations Server Actions.
//
// Wraps admin RPCs + the Razorpay REST client:
//
//   admin.billing_create_refund           — support+ (writes pending row)
//   admin.billing_mark_refund_issued      — support+ (flip pending→issued)
//   admin.billing_mark_refund_failed      — support+ (flip pending→failed)
//   admin.billing_upsert_plan_adjustment  — platform_operator
//   admin.billing_revoke_plan_adjustment  — platform_operator
//
// createRefund does the full round-trip:
//   1. Create a pending refunds row (audit-logged).
//   2. Call Razorpay POST /v1/payments/:id/refund.
//   3. Flip the row to issued (+ store razorpay_refund_id) or failed
//      (+ store the Razorpay error summary). Both transitions audit-log.
//
// When Razorpay env vars are missing (dev without keys provisioned), the
// action stops at step 1 and returns ok with a `status:'pending'` flag
// so the UI can show "Complete in Razorpay dashboard." Nothing silent.

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

interface RefundResult {
  refundId: string
  status: 'issued' | 'failed' | 'pending'
  razorpayRefundId?: string
  failureReason?: string
  warning?: string
}

export async function createRefund(input: {
  accountId: string
  razorpayPaymentId: string
  amountPaise: number
  reason: string
}): Promise<ActionResult<RefundResult>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    return { ok: false, error: 'Amount must be a positive whole number of paise.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const paymentId = input.razorpayPaymentId.trim() || null
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_create_refund', {
      p_account_id: input.accountId,
      p_razorpay_payment_id: paymentId,
      p_amount_paise: input.amountPaise,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  const refundId = data as string

  // Degrade-gracefully path: no Razorpay env + no payment id means the
  // pending row is all we can do. The operator completes the refund in
  // the Razorpay dashboard and either re-runs here once env is ready
  // or uses the mark-issued RPC directly.
  if (!isRazorpayEnvReady() || !paymentId) {
    revalidatePath('/billing', 'layout')
    return {
      ok: true,
      data: {
        refundId,
        status: 'pending',
        warning: !isRazorpayEnvReady()
          ? 'Razorpay keys not set on this environment — refund row created but not sent. Complete in the Razorpay dashboard and mark-issued manually.'
          : 'No Razorpay payment_id provided — refund row created but not sent. Complete in the Razorpay dashboard and mark-issued manually.',
      },
    }
  }

  // Round-trip to Razorpay, then flip the row to terminal state.
  try {
    const refund = await issueRefund({
      paymentId,
      amountPaise: input.amountPaise,
      notes: { cs_refund_id: refundId },
    })
    const { error: markError } = await supabase
      .schema('admin')
      .rpc('billing_mark_refund_issued', {
        p_refund_id: refundId,
        p_razorpay_refund_id: refund.id,
      })
    if (markError) {
      // Razorpay issued but we couldn't record the outcome — rare but
      // important to surface. The refund is real; the row is out of date.
      revalidatePath('/billing', 'layout')
      return {
        ok: false,
        error: `Razorpay issued refund ${refund.id} but updating the ledger row failed: ${markError.message}`,
      }
    }
    revalidatePath('/billing', 'layout')
    return {
      ok: true,
      data: { refundId, status: 'issued', razorpayRefundId: refund.id },
    }
  } catch (e) {
    let failureReason: string
    if (e instanceof RazorpayApiError) {
      failureReason = e.summary()
    } else if (e instanceof RazorpayEnvError) {
      failureReason = e.message
    } else if (e instanceof Error) {
      failureReason = e.message
    } else {
      failureReason = 'Unknown Razorpay client error'
    }
    await supabase
      .schema('admin')
      .rpc('billing_mark_refund_failed', {
        p_refund_id: refundId,
        p_failure_reason: failureReason.slice(0, 500),
      })
    revalidatePath('/billing', 'layout')
    return {
      ok: true,
      data: { refundId, status: 'failed', failureReason },
    }
  }
}

export async function upsertPlanAdjustment(input: {
  accountId: string
  kind: 'comp' | 'override'
  planCode: string
  expiresAt: string
  reason: string
}): Promise<ActionResult<{ adjustmentId: string }>> {
  if (!input.accountId) return { ok: false, error: 'Account id required.' }
  if (input.kind !== 'comp' && input.kind !== 'override') {
    return { ok: false, error: 'Kind must be comp or override.' }
  }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_upsert_plan_adjustment', {
      p_account_id: input.accountId,
      p_kind: input.kind,
      p_plan: input.planCode,
      p_expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/billing', 'layout')
  return { ok: true, data: { adjustmentId: data as string } }
}

export async function revokePlanAdjustment(input: {
  adjustmentId: string
  reason: string
}): Promise<ActionResult> {
  if (!input.adjustmentId) return { ok: false, error: 'Adjustment id required.' }
  if (input.reason.trim().length < 10) {
    return { ok: false, error: 'Reason must be at least 10 characters.' }
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .schema('admin')
    .rpc('billing_revoke_plan_adjustment', {
      p_adjustment_id: input.adjustmentId,
      p_reason: input.reason.trim(),
    })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/billing', 'layout')
  return { ok: true }
}
