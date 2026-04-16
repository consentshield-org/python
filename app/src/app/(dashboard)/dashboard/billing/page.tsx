import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PLANS, PLAN_ORDER, getPlan, formatInr, type PlanId } from '@/lib/billing/plans'
import { daysBetween } from '@consentshield/compliance'
import { UpgradeButton } from './upgrade-button'

export default async function BillingPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('plan, plan_started_at, trial_ends_at')
    .eq('id', membership.org_id)
    .single()

  const { count: propertyCount } = await supabase
    .from('web_properties')
    .select('id', { count: 'exact', head: true })

  const currentPlan = getPlan(org?.plan ?? 'trial')
  const isTrial = currentPlan.id === 'trial'
  const trialDaysLeft =
    isTrial && org?.trial_ends_at ? Math.max(0, daysBetween(org.trial_ends_at)) : 0

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Billing & Plans</h1>
        <p className="text-sm text-gray-600">Manage your ConsentShield subscription.</p>
      </div>

      {isTrial && (
        <div
          className={`rounded border p-4 text-sm ${
            trialDaysLeft <= 3
              ? 'border-red-200 bg-red-50'
              : trialDaysLeft <= 7
                ? 'border-amber-200 bg-amber-50'
                : 'border-blue-200 bg-blue-50'
          }`}
        >
          <strong>Trial:</strong> {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} remaining.
          Upgrade to any paid plan below to keep your banners active.
        </div>
      )}

      {/* Current plan card */}
      <section className="rounded border border-gray-200 p-6">
        <h2 className="text-sm font-medium text-gray-600">Current Plan</h2>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold">{currentPlan.name}</p>
            <p className="text-sm text-gray-600">
              {currentPlan.price_inr === 0
                ? 'Free during trial'
                : `${formatInr(currentPlan.price_inr)}/month`}
            </p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <p>Properties: <strong>{propertyCount ?? 0} / {currentPlan.limits.web_properties ?? '∞'}</strong></p>
            <p className="mt-1 text-xs">
              {org?.plan_started_at
                ? `Since ${new Date(org.plan_started_at).toLocaleDateString()}`
                : ''}
            </p>
          </div>
        </div>
      </section>

      {/* Plan comparison grid */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upgrade</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLAN_ORDER.filter((p) => p !== 'trial').map((planId) => {
            const plan = PLANS[planId]
            const isCurrent = plan.id === currentPlan.id
            const isDowngrade =
              PLAN_ORDER.indexOf(plan.id) < PLAN_ORDER.indexOf(currentPlan.id)
            return (
              <PlanCard
                key={plan.id}
                orgId={membership.org_id}
                plan={plan}
                isCurrent={isCurrent}
                isDowngrade={isDowngrade}
              />
            )
          })}
        </div>
      </section>

      <p className="text-xs text-gray-500">
        All plans billed in INR via Razorpay. Annual upfront saves 2 months. Cancel anytime.
      </p>
    </main>
  )
}

function PlanCard({
  orgId,
  plan,
  isCurrent,
  isDowngrade,
}: {
  orgId: string
  plan: (typeof PLANS)[PlanId]
  isCurrent: boolean
  isDowngrade: boolean
}) {
  const keyFeatures = [
    `${plan.limits.web_properties ?? 'Unlimited'} web ${
      plan.limits.web_properties === 1 ? 'property' : 'properties'
    }`,
    'Consent banner + monitoring',
    'Privacy notice',
    'Data inventory',
    ...(plan.features.rights_requests ? ['Rights request tracker'] : []),
    ...(plan.features.security_scanning ? ['Security scanning'] : []),
    ...(plan.features.compliance_api ? ['Compliance API'] : []),
    ...(plan.features.gdpr_module ? ['GDPR module'] : []),
    ...(plan.features.consent_probes ? ['Consent probes'] : []),
    ...(plan.features.white_label ? ['White-label'] : []),
    ...(plan.features.dpo_matching ? ['DPO matching'] : []),
  ]

  return (
    <div
      className={`rounded border p-4 flex flex-col ${
        isCurrent ? 'border-black ring-2 ring-black' : 'border-gray-200'
      }`}
    >
      <div>
        <h3 className="font-semibold">{plan.name}</h3>
        <p className="mt-1 text-2xl font-bold">{formatInr(plan.price_inr)}</p>
        <p className="text-xs text-gray-500">per month</p>
      </div>

      <ul className="mt-4 flex-1 space-y-1.5 text-xs text-gray-700">
        {keyFeatures.map((f, i) => (
          <li key={i}>✓ {f}</li>
        ))}
      </ul>

      <div className="mt-4">
        {isCurrent ? (
          <button
            disabled
            className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-medium text-gray-500"
          >
            Current Plan
          </button>
        ) : isDowngrade ? (
          <button
            disabled
            className="w-full rounded border border-gray-300 px-3 py-2 text-xs font-medium text-gray-400"
            title="Contact support to downgrade"
          >
            Contact support
          </button>
        ) : (
          <UpgradeButton orgId={orgId} planId={plan.id} planName={plan.name} />
        )}
      </div>
    </div>
  )
}
