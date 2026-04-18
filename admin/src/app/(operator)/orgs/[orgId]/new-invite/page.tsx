import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { OrgAdminInviteForm } from './org-admin-invite-form'

// ADR-0044 Phase 2.3 — org_admin promotion invite for an existing org.
// Route is org-scoped so the account_id + org_id are authoritative
// from the URL, not from form input.

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ orgId: string }>
}

export default async function OrgAdminInvitePage({ params }: PageProps) {
  const { orgId } = await params
  const supabase = await createServerClient()

  const { data: org } = await supabase
    .from('organisations')
    .select(
      'id, name, account_id, accounts(plan_code, status, trial_ends_at)',
    )
    .eq('id', orgId)
    .maybeSingle<{
      id: string
      name: string
      account_id: string
      accounts: {
        plan_code: string | null
        status: string | null
        trial_ends_at: string | null
      } | null
    }>()

  if (!org) notFound()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <div className="text-xs text-text-3">
          <Link href="/orgs" className="hover:text-text">
            All organisations
          </Link>
          {' › '}
          <Link href={`/orgs/${orgId}`} className="hover:text-text">
            {org.name}
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Invite org admin</h1>
        <p className="text-xs text-text-3">
          Adds a new <code className="font-mono">org_admin</code> to{' '}
          <strong>{org.name}</strong>. No new account is created — the invitee joins this
          organisation&apos;s existing account.
        </p>
      </header>

      <section className="rounded-md border-l-4 border-navy border-[color:var(--border)] bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="text-text-3">Target organisation</div>
            <div className="mt-0.5 font-semibold text-sm">{org.name}</div>
            <code className="font-mono text-[11px] text-text-3">{org.id}</code>
          </div>
          <div className="text-right">
            <div className="text-text-3">Account</div>
            <div className="mt-0.5 text-sm">
              {org.accounts?.plan_code ?? 'free'} plan · {org.accounts?.status ?? '—'}
            </div>
          </div>
        </div>
      </section>

      <OrgAdminInviteForm orgId={org.id} accountId={org.account_id} />
    </div>
  )
}
