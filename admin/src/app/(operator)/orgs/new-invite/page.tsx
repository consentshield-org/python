import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { NewAccountInviteForm, type PlanOption } from './new-account-invite-form'

// ADR-0044 Phase 2.3 — operator-side form for account-creating invites.
// The create_invitation RPC enforces is_admin on the JWT; the admin
// proxy.ts Rule 21 gate ensures no non-admin ever reaches this page.

export const dynamic = 'force-dynamic'

export default async function NewAccountInvitePage() {
  const supabase = await createServerClient()

  const { data: plans } = await supabase
    .from('plans')
    .select('plan_code, display_name, base_price_inr, trial_days, is_active')
    .eq('is_active', true)
    .order('base_price_inr', { ascending: true, nullsFirst: true })

  const planOptions: PlanOption[] = (plans ?? []).map((p) => ({
    planCode: p.plan_code,
    displayName: p.display_name,
    basePriceInr: p.base_price_inr,
    trialDays: p.trial_days,
  }))

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href="/orgs" className="text-xs text-text-3 hover:text-text">
          ← All organisations
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">New account invite</h1>
        <p className="text-xs text-text-3">
          Invite a new customer account. The invitee becomes the{' '}
          <code className="font-mono">account_owner</code>, and an{' '}
          <code className="font-mono">accounts</code> +{' '}
          <code className="font-mono">organisations</code> +{' '}
          <code className="font-mono">account_memberships</code> trio is created on accept.
        </p>
      </header>

      {planOptions.length === 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          No active plans available. Seed <code>public.plans</code> before issuing invites.
        </div>
      ) : (
        <NewAccountInviteForm plans={planOptions} />
      )}
    </div>
  )
}
