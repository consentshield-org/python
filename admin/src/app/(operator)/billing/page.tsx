import { createServerClient } from '@/lib/supabase/server'
import { BillingTabs, type BillingData } from './billing-tabs'

// ADR-0034 Sprint 2.1 — Billing Operations panel.
//
// Four tabs:
//   · Payment failures — audit_log events of event_type='payment_failed'
//     rolled up per account
//   · Refunds — public.refunds ledger (create-row today; Razorpay round-
//     trip in Sprint 2.2)
//   · Comp accounts — plan_adjustments where kind='comp'
//   · Plan overrides — plan_adjustments where kind='override'
//
// All four RPCs are account-scoped after ADR-0044 Phase 0; the refund
// and plan-adjustment modals take an account_id directly. Active plans
// come from public.plans (is_active = true).

export const dynamic = 'force-dynamic'

export default async function BillingPage() {
  const supabase = await createServerClient()

  const [failures, refunds, comps, overrides, plans, accounts, user] =
    await Promise.all([
      supabase.schema('admin').rpc('billing_payment_failures_list', {
        p_window_days: 7,
      }),
      supabase.schema('admin').rpc('billing_refunds_list', { p_limit: 50 }),
      supabase
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'comp' }),
      supabase
        .schema('admin')
        .rpc('billing_plan_adjustments_list', { p_kind: 'override' }),
      supabase
        .from('plans')
        .select('plan_code, display_name')
        .eq('is_active', true)
        .order('base_price_inr', { ascending: true, nullsFirst: true }),
      // ADR-0048 Sprint 1.2 — feed the Adjustment modal's account picker.
      supabase.schema('admin').rpc('accounts_list'),
      supabase.auth.getUser(),
    ])

  const errors = [
    failures.error?.message,
    refunds.error?.message,
    comps.error?.message,
    overrides.error?.message,
    plans.error?.message,
    accounts.error?.message,
  ].filter((e): e is string => !!e)

  const adminRole =
    (user.data.user?.app_metadata?.admin_role as
      | 'platform_operator'
      | 'support'
      | 'read_only'
      | undefined) ?? 'read_only'
  const canWriteRefunds = adminRole === 'support' || adminRole === 'platform_operator'
  const canWriteAdjustments = adminRole === 'platform_operator'

  const data: BillingData = {
    paymentFailures: (failures.data ?? []) as BillingData['paymentFailures'],
    refunds: (refunds.data ?? []) as BillingData['refunds'],
    comps: (comps.data ?? []) as BillingData['comps'],
    overrides: (overrides.data ?? []) as BillingData['overrides'],
    plans: (plans.data ?? []) as BillingData['plans'],
    accounts: ((accounts.data ?? []) as Array<{
      id: string
      name: string
      status: string
    }>).map((a) => ({ id: a.id, name: a.name, status: a.status })),
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Billing Operations</h1>
          <p className="text-sm text-text-2">
            Razorpay failures, refund ledger, comp grants, and plan overrides.
            Account-scoped after ADR-0044 Phase 0.
          </p>
        </div>
        <span className="rounded-full border border-[color:var(--border)] bg-bg px-3 py-1 text-[11px] text-text-3">
          Razorpay round-trip — ADR-0034 Sprint 2.2
        </span>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      <BillingTabs
        data={data}
        canWriteRefunds={canWriteRefunds}
        canWriteAdjustments={canWriteAdjustments}
      />
    </div>
  )
}
