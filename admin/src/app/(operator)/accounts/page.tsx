import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0048 Sprint 1.2 — Accounts list.

export const dynamic = 'force-dynamic'

interface AccountRow {
  id: string
  name: string
  plan_code: string
  status: string
  razorpay_subscription_id: string | null
  trial_ends_at: string | null
  org_count: number
  effective_plan: string | null
  created_at: string
}

interface PageProps {
  searchParams: Promise<{ status?: string; plan?: string; q?: string }>
}

export default async function AccountsListPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  const { data, error } = await supabase.schema('admin').rpc('accounts_list', {
    p_status: params.status ?? null,
    p_plan_code: params.plan ?? null,
    p_q: params.q ?? null,
  })

  const rows = (data ?? []) as AccountRow[]

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-sm text-text-2">
            Billing + plan subject. One account → N organisations.
          </p>
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error.message}
        </div>
      ) : null}

      <FilterBar current={params} />

      <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">All accounts</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
            {rows.length}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3">
            No accounts match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Orgs</th>
                  <th className="px-4 py-2">Subscription</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/accounts/${r.id}`}
                        className="text-sm font-medium text-teal hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="font-mono text-[11px] text-text-3">
                        {r.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.plan_code}
                      {r.effective_plan && r.effective_plan !== r.plan_code ? (
                        <span className="ml-2 text-[10px] text-text-3">
                          eff. {r.effective_plan}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-4 py-2 text-xs">{Number(r.org_count)}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {r.razorpay_subscription_id ?? '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function FilterBar({
  current,
}: {
  current: { status?: string; plan?: string; q?: string }
}) {
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-md border border-[color:var(--border)] bg-white px-3 py-2 shadow-sm">
      <label className="flex flex-col text-[11px] text-text-3">
        <span className="mb-1">Status</span>
        <select
          name="status"
          defaultValue={current.status ?? ''}
          className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
        >
          <option value="">any</option>
          <option value="trial">trial</option>
          <option value="active">active</option>
          <option value="past_due">past_due</option>
          <option value="suspended">suspended</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      <label className="flex flex-col text-[11px] text-text-3">
        <span className="mb-1">Plan</span>
        <select
          name="plan"
          defaultValue={current.plan ?? ''}
          className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
        >
          <option value="">any</option>
          <option value="trial_starter">trial_starter</option>
          <option value="starter">starter</option>
          <option value="growth">growth</option>
          <option value="pro">pro</option>
          <option value="enterprise">enterprise</option>
        </select>
      </label>
      <label className="flex flex-1 flex-col text-[11px] text-text-3">
        <span className="mb-1">Search (name)</span>
        <input
          name="q"
          defaultValue={current.q ?? ''}
          placeholder="account name prefix"
          className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded bg-teal px-3 py-1 text-xs font-medium text-white hover:bg-teal-dark"
      >
        Apply
      </button>
    </form>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'active'
      ? 'bg-green-100 text-green-700'
      : status === 'trial'
        ? 'bg-amber-100 text-amber-800'
        : status === 'suspended'
          ? 'bg-red-100 text-red-700'
          : 'bg-bg text-text-3'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  )
}
