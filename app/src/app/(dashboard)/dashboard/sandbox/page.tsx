import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProvisionSandboxForm } from './provision-form'

// ADR-1003 Sprint 5.1 — sandbox self-serve page.
//
// Lists the caller's existing sandbox orgs and surfaces a provision
// form. Provisioning routes through public.rpc_provision_sandbox_org
// which requires account_owner — non-owners see a read-only message.

export const dynamic = 'force-dynamic'

interface SandboxOrgRow {
  id: string
  name: string
  storage_mode: 'standard' | 'insulated' | 'zero_storage'
  created_at: string
  settings: { sectoral_template?: { code: string; version: number } } | null
}

export default async function SandboxPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Determine if the caller is account_owner (RPC also enforces this;
  // we mirror it for UI affordance).
  const { data: amRow } = await supabase
    .from('account_memberships')
    .select('account_id, role')
    .eq('user_id', user.id)
    .eq('role', 'account_owner')
    .eq('status', 'active')
    .maybeSingle()

  const isAccountOwner = !!amRow

  // Fetch the caller's sandbox orgs (RLS already scopes to memberships).
  // ADR-0044 Phase 0 surfaced sandbox=true; we filter on it here.
  const { data: orgs, error: orgErr } = await supabase
    .from('organisations')
    .select('id, name, storage_mode, created_at, settings, sandbox')
    .eq('sandbox', true)
    .order('created_at', { ascending: false })

  if (orgErr) {
    return (
      <main className="flex-1 p-8">
        <h1 className="text-xl font-semibold">Sandbox</h1>
        <p className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {orgErr.message}
        </p>
      </main>
    )
  }

  const sandboxOrgs = (orgs ?? []) as SandboxOrgRow[]

  return (
    <main className="flex-1 p-8">
      <header className="max-w-3xl">
        <h1 className="text-xl font-semibold">Sandbox</h1>
        <p className="mt-2 text-sm text-gray-600">
          Sandbox orgs let you exercise the API end-to-end without affecting your
          production data, plan limits, or billing. They issue{' '}
          <code className="rounded bg-gray-100 px-1 font-mono text-xs">cs_test_*</code>{' '}
          API keys (capped at the sandbox rate tier) and are excluded from cross-customer
          metrics. Sandbox orgs sit alongside your production orgs in the same
          account &mdash; switch between them like any other org.
        </p>
      </header>

      <section className="mt-6 max-w-3xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Provision a sandbox org
        </h2>
        {isAccountOwner ? (
          <ProvisionSandboxForm />
        ) : (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Only the account owner can provision sandbox orgs. Ask them to create one and
            invite you as a member.
          </p>
        )}
      </section>

      <section className="mt-8 max-w-3xl">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Your sandbox orgs ({sandboxOrgs.length})
        </h2>
        {sandboxOrgs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            No sandbox orgs yet. Provision one above to get started.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-200 rounded border border-gray-200 bg-white">
            {sandboxOrgs.map((o) => {
              const tpl = o.settings?.sectoral_template
              return (
                <li key={o.id} className="flex flex-col gap-1 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.name}</span>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                      sandbox
                    </span>
                  </div>
                  <p className="font-mono text-xs text-gray-500">{o.id}</p>
                  <p className="text-xs text-gray-600">
                    Storage mode: <span className="font-mono">{o.storage_mode}</span>
                    {tpl ? (
                      <>
                        {' '}
                        &middot; Template:{' '}
                        <span className="font-mono">
                          {tpl.code} v{tpl.version}
                        </span>
                      </>
                    ) : (
                      ' · No template applied'
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    Created {new Date(o.created_at).toLocaleString()}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-8 max-w-3xl text-xs text-gray-500">
        <p>
          To mint a <code className="font-mono">cs_test_*</code> API key, switch to a
          sandbox org and visit <strong>Settings → API keys</strong>.
        </p>
      </section>
    </main>
  )
}
