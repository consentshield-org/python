import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import { PLANS, type PlanId } from '@/lib/billing/plans'

const HANDLED_EVENTS = [
  'subscription.activated',
  'subscription.charged',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'payment.failed',
]

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
        entity: { id: string; plan_id: string; status: string; notes?: Record<string, string> }
      }
      payment?: { entity: { id: string; status: string } }
    }
  }

  if (!HANDLED_EVENTS.includes(event.event)) {
    return NextResponse.json({ received: true, handled: false })
  }

  const subscription = event.payload.subscription?.entity
  if (!subscription) {
    return NextResponse.json({ received: true, handled: false })
  }

  const csPlanFromNotes = subscription.notes?.cs_plan as PlanId | undefined
  const csPlan = csPlanFromNotes && PLANS[csPlanFromNotes] ? csPlanFromNotes : null
  const orgIdHint = subscription.notes?.org_id ?? null

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

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
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const envelope = data as { ok: boolean; error?: string; org_id?: string }
  if (!envelope.ok) {
    // B-5: hard-fail on unresolved org. Razorpay retries on non-2xx.
    console.error('[razorpay] unresolved org for subscription', subscription.id)
    return NextResponse.json(
      {
        error: envelope.error ?? 'Failed to apply subscription event',
        subscription_id: subscription.id,
      },
      { status: 422 },
    )
  }

  return NextResponse.json({ received: true, handled: true, org_id: envelope.org_id })
}
