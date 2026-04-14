import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'
import { PLANS, type PlanId } from '@/lib/billing/plans'

// Razorpay webhook events we handle
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
    // Ack unhandled events
    return NextResponse.json({ received: true, handled: false })
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const subscription = event.payload.subscription?.entity
  if (!subscription) {
    return NextResponse.json({ received: true, handled: false })
  }

  // Find which cs plan this corresponds to
  const csPlanFromNotes = subscription.notes?.cs_plan as PlanId | undefined
  const csPlan = csPlanFromNotes && PLANS[csPlanFromNotes] ? csPlanFromNotes : null

  const orgIdFromNotes = subscription.notes?.org_id
  if (!orgIdFromNotes) {
    // Fall back to lookup by razorpay_subscription_id
    const { data: org } = await admin
      .from('organisations')
      .select('id')
      .eq('razorpay_subscription_id', subscription.id)
      .single()

    if (!org) {
      return NextResponse.json({ received: true, error: 'Org not found' })
    }
  }

  const orgId = orgIdFromNotes || (await lookupOrgBySubscription(admin, subscription.id))
  if (!orgId) return NextResponse.json({ received: true, error: 'Org not found' })

  switch (event.event) {
    case 'subscription.activated':
    case 'subscription.charged':
    case 'subscription.resumed': {
      if (csPlan) {
        await admin
          .from('organisations')
          .update({
            plan: csPlan,
            plan_started_at: new Date().toISOString(),
            razorpay_subscription_id: subscription.id,
          })
          .eq('id', orgId)
      }
      await writeAudit(admin, orgId, 'plan_activated', { plan: csPlan, subscription_id: subscription.id })
      break
    }
    case 'subscription.cancelled':
    case 'subscription.paused': {
      await admin
        .from('organisations')
        .update({ plan: 'trial' })
        .eq('id', orgId)
      await writeAudit(admin, orgId, 'plan_downgraded', {
        reason: event.event,
        subscription_id: subscription.id,
      })
      break
    }
    case 'payment.failed': {
      await writeAudit(admin, orgId, 'payment_failed', {
        subscription_id: subscription.id,
        payment_id: event.payload.payment?.entity.id,
      })
      break
    }
  }

  return NextResponse.json({ received: true, handled: true })
}

async function lookupOrgBySubscription(
  admin: SupabaseClient,
  subId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('organisations')
    .select('id')
    .eq('razorpay_subscription_id', subId)
    .single()
  return (data as { id: string } | null)?.id ?? null
}

async function writeAudit(
  admin: SupabaseClient,
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await admin.from('audit_log').insert({
    org_id: orgId,
    event_type: eventType,
    entity_type: 'organisation',
    entity_id: orgId,
    payload,
  })
}
