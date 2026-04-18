import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0050 Sprint 1 — Billing landing (account-indexed).
//
// Primary operator entry point for anything billing-related. Reuses
// admin.accounts_list as the row source (the existing envelope has plan,
// status, effective_plan, subscription id, orgs, created). Invoice state
// + outstanding balance are stubs until Sprint 2 lands the invoice
// pipeline. A pill near the header links to /billing/operations when
// there are open Razorpay payment failures.

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

interface PaymentFailureRow {
  account_id: string
}

interface PageProps {
  searchParams: Promise<{ status?: string; plan?: string; q?: string }>
}

export default async function BillingLandingPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  const nullable = (s: string | undefined) => (s && s.length > 0 ? s : null)
  const [accountsRes, failuresRes] = await Promise.all([
    supabase.schema('admin').rpc('accounts_list', {
      p_status: nullable(params.status),
      p_plan_code: nullable(params.plan),
      p_q: nullable(params.q),
    }),
    supabase.schema('admin').rpc('billing_payment_failures_list', {
      p_window_days: 7,
    }),
  ])

  const rows = (accountsRes.data ?? []) as AccountRow[]
  const failures = (failuresRes.data ?? []) as PaymentFailureRow[]
  const failureAccountIds = new Set(failures.map((f) => f.account_id))
  const errors = [accountsRes.error?.message, failuresRes.error?.message].filter(
    (e): e is string => !!e,
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Billing</h1>
          <p className="text-sm text-text-2">
            Subscriptions, invoices, and refunds — grouped by account. ADR-0050.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {failures.length > 0 ? (
            <Link
              href="/billing/operations"
              className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
              title="Open Billing Operations — Razorpay payment failures in the last 7 days"
            >
              {failures.length} with payment failures
            </Link>
          ) : null}
          <Link
            href="/billing/operations"
            className="rounded-full border border-[color:var(--border)] bg-white px-3 py-1 text-[11px] text-text-3 hover:bg-bg"
          >
            Operations →
          </Link>
        </div>
      </header>

      {errors.length > 0 ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
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
                  <th className="px-4 py-2">Trial ends</th>
                  <th className="px-4 py-2">Last invoice</th>
                  <th className="px-4 py-2">Subscription</th>
                  <th className="px-4 py-2">Orgs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/billing/${r.id}`}
                        className="text-sm font-medium text-teal hover:underline"
                      >
                        {r.name}
                      </Link>
                      {failureAccountIds.has(r.id) ? (
                        <span
                          className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          title="Razorpay payment failed in the last 7 days"
                        >
                          !
                        </span>
                      ) : null}
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
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {r.trial_ends_at
                        ? new Date(r.trial_ends_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-text-3">
                      <span
                        title="Invoice pipeline ships in ADR-0050 Sprint 2"
                      >
                        —
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {r.razorpay_subscription_id ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">{Number(r.org_count)}</td>
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
        : status === 'suspended' || status === 'suspended_by_plan'
          ? 'bg-red-100 text-red-700'
          : 'bg-bg text-text-3'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  )
}
