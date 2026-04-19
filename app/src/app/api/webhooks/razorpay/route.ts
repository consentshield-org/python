import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import { PLANS, type PlanId } from '@/lib/billing/plans'

// ADR-0050 Sprint 2.1 chunk 3 — verbatim Razorpay webhook preservation.
//
// Every signature-verified Razorpay webhook is persisted into
// billing.razorpay_webhook_events BEFORE any state-mutation work runs,
// and stamped with processed_at + processed_outcome AFTER. This gives
// us a tamper-evident event log for chargeback defense (ADR-0052) and
// a clean reconciliation source for invoice state transitions.
//
// Existing ADR-0034 subscription-state handling is preserved verbatim
// for HANDLED_EVENTS; unhandled event types still get persisted (with
// outcome 'not_handled') so dispute.* and invoice.* events are captured
// ahead of the chunks that act on them.

const HANDLED_EVENTS = [
  'subscription.activated',
  'subscription.charged',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'payment.failed',
]

const INVOICE_PAID_EVENT = 'invoice.paid'

export async function POST(request: Request) {
  const raw = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const eventId = request.headers.get('x-razorpay-event-id') ?? ''

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const event = JSON.parse(raw) as {
    event: string
    payload: {
      subscription?: {
        entity: {
          id: string
          plan_id: string
          status: string
          notes?: Record<string, string>
        }
      }
      payment?: { entity: { id: string; status: string } }
      invoice?: {
        entity: {
          id: string
          order_id?: string | null
          status?: string
          paid_at?: number | null
        }
      }
    }
  }

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  // Verbatim-insert first. Razorpay always sends x-razorpay-event-id on
  // webhooks; if missing, fall back to a synthetic id so signed events
  // don't get dropped, but the outcome records the synthetic fallback.
  const effectiveEventId =
    eventId.length > 0 ? eventId : `no-header-${Date.now()}`
  const verbatim = await anon.rpc('rpc_razorpay_webhook_insert_verbatim', {
    p_event_id: effectiveEventId,
    p_event_type: event.event,
    p_signature: signature,
    p_payload: event as unknown as Record<string, unknown>,
  })
  if (verbatim.error) {
    console.error('[razorpay] verbatim insert failed', verbatim.error)
    // Don't 500 on logging failure — continue with existing flow.
  }

  const stamp = async (outcome: string) => {
    const r = await anon.rpc('rpc_razorpay_webhook_stamp_processed', {
      p_event_id: effectiveEventId,
      p_outcome: outcome,
    })
    if (r.error) console.error('[razorpay] stamp processed failed', r.error)
  }

  // ADR-0050 Sprint 2.3 — invoice.paid reconciliation. Verbatim row is
  // already stored above; reconcile updates public.invoices.status → paid
  // and records the outcome. Orphans are non-errors.
  if (event.event === INVOICE_PAID_EVENT) {
    const invoice = event.payload.invoice?.entity
    const paidAtIso = invoice?.paid_at
      ? new Date(invoice.paid_at * 1000).toISOString()
      : null
    const reconcile = await anon.rpc('rpc_razorpay_reconcile_invoice_paid', {
      p_razorpay_invoice_id: invoice?.id ?? null,
      p_razorpay_order_id: invoice?.order_id ?? null,
      p_paid_at: paidAtIso,
    })
    if (reconcile.error) {
      console.error('[razorpay] invoice.paid reconcile failed', reconcile.error)
      await stamp(`reconcile_error: ${reconcile.error.message}`.slice(0, 250))
      return NextResponse.json({ error: reconcile.error.message }, { status: 500 })
    }
    const envelope = reconcile.data as {
      matched: boolean
      invoice_id: string | null
      invoice_number: string | null
      previous_status: string | null
      new_status: string | null
      reason: string
    }
    const outcome = envelope.matched
      ? `reconciled:${envelope.previous_status ?? 'unknown'}→${envelope.new_status ?? 'paid'}`
      : `reconcile_orphan:${envelope.reason}`
    await stamp(outcome.slice(0, 250))
    return NextResponse.json({
      received: true,
      handled: true,
      reconciled: envelope,
    })
  }

  if (!HANDLED_EVENTS.includes(event.event)) {
    await stamp('not_handled')
    return NextResponse.json({ received: true, handled: false })
  }

  const subscription = event.payload.subscription?.entity
  if (!subscription) {
    await stamp('no_subscription_entity')
    return NextResponse.json({ received: true, handled: false })
  }

  const csPlanFromNotes = subscription.notes?.cs_plan as PlanId | undefined
  const csPlan = csPlanFromNotes && PLANS[csPlanFromNotes] ? csPlanFromNotes : null
  const orgIdHint = subscription.notes?.org_id ?? null

  // S-3: drop duplicate Razorpay retries of the same event ID.
  if (eventId) {
    const dedup = await anon.rpc('rpc_webhook_mark_processed', {
      p_source: 'razorpay',
      p_event_id: eventId,
      p_org_id: null,
    })
    if (dedup.error) {
      console.error('[razorpay] dedup check failed', dedup.error)
    } else if (dedup.data === false) {
      await stamp('duplicate_dropped')
      return NextResponse.json({ received: true, duplicate: true })
    }
  }

  const { data, error } = await anon.rpc('rpc_razorpay_apply_subscription', {
    p_event: event.event,
    p_subscription_id: subscription.id,
    p_cs_plan: csPlan,
    p_org_id_hint: orgIdHint,
    p_payment_id: event.payload.payment?.entity.id ?? null,
  })

  if (error) {
    console.error('[razorpay] rpc error', error)
    await stamp(`rpc_error: ${error.message}`.slice(0, 250))
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as { ok: boolean; error?: string; org_id?: string }
  if (!envelope.ok) {
    // B-5: hard-fail on unresolved org. Razorpay retries on non-2xx.
    console.error('[razorpay] unresolved org for subscription', subscription.id)
    await stamp(
      `unresolved_org: ${envelope.error ?? 'unknown'}`.slice(0, 250),
    )
    return NextResponse.json(
      {
        error: envelope.error ?? 'Failed to apply subscription event',
        subscription_id: subscription.id,
      },
      { status: 422 },
    )
  }

  await stamp('ok')
  return NextResponse.json({
    received: true,
    handled: true,
    org_id: envelope.org_id,
  })
}
