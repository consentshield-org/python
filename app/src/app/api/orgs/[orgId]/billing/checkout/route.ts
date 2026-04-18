import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { PLANS, type PlanId } from '@/lib/billing/plans'
import { createSubscription } from '@/lib/billing/razorpay'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { plan?: string }
  const planId = body.plan as PlanId
  if (!planId || !PLANS[planId] || planId === 'trial') {
    return NextResponse.json(
      { error: 'plan must be one of: starter, growth, pro, enterprise' },
      { status: 400 },
    )
  }

  const plan = PLANS[planId]
  if (!plan.razorpay_plan_id) {
    return NextResponse.json(
      {
        error: `Plan "${planId}" is not configured with a Razorpay plan ID. Add RAZORPAY_PLAN_${planId.toUpperCase()} env var.`,
      },
      { status: 500 },
    )
  }

  // Verify user is admin of this org
  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership || membership.role !== 'org_admin') {
    return NextResponse.json(
      { error: 'Only org admins can change the subscription' },
      { status: 403 },
    )
  }

  try {
    const subscription = await createSubscription({
      planId: plan.razorpay_plan_id,
      notes: { org_id: orgId, cs_plan: planId, user_id: user.id },
      customerNotify: true,
    })

    // ADR-0044 Phase 0 — subscription identity lives on accounts, not orgs.
    // Resolve the account via the org and stamp the subscription id there.
    const { data: org } = await supabase
      .from('organisations')
      .select('account_id')
      .eq('id', orgId)
      .single()

    if (org?.account_id) {
      await supabase
        .from('accounts')
        .update({ razorpay_subscription_id: subscription.id })
        .eq('id', org.account_id)
    }

    return NextResponse.json({
      subscription_id: subscription.id,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID,
      short_url: subscription.short_url,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Checkout failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
