import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0050 Sprint 1 — per-account billing detail.
//
// Composes three RPCs:
//   · admin.account_detail              (ADR-0048; account + orgs + adj + audit)
//   · admin.billing_account_summary     (this ADR; plan history + stub balance)
//   · admin.billing_refunds_list        (ADR-0034; filtered to this account client-side)
//
// The invoice history + latest-invoice cards are intentional stubs until
// Sprint 2. Plan history is rendered as a chronological timeline off
// the summary envelope.

export const dynamic = 'force-dynamic'

interface AccountEnvelope {
  account: {
    id: string
    name: string
    plan_code: string
    status: string
    razorpay_customer_id: string | null
    razorpay_subscription_id: string | null
    trial_ends_at: string | null
    current_period_ends_at: string | null
    created_at: string
    updated_at: string
    effective_plan: string
  }
  organisations: Array<{ id: string; name: string; status: string; created_at: string }>
  active_adjustments: Array<{
    id: string
    kind: 'comp' | 'override'
    plan: string
    starts_at: string
    expires_at: string | null
    reason: string
    granted_by: string
    created_at: string
  }>
  audit_recent: Array<{
    action: string
    admin_user_id: string
    reason: string
    created_at: string
    new_value: Record<string, unknown> | null
  }>
}

interface BillingSummary {
  subscription_state: {
    plan_code: string
    effective_plan_code: string
    plan_display_name: string | null
    base_price_inr: number | null
    status: string
    current_period_ends_at: string | null
    trial_ends_at: string | null
    razorpay_customer_id: string | null
    razorpay_subscription_id: string | null
    next_charge_amount_paise: number | null
  }
  plan_history: Array<{
    effective_from: string
    plan_code: string
    source: 'base' | 'comp' | 'override'
    action: 'granted' | 'revoked'
    adjustment_id: string | null
    actor_user_id: string | null
    reason: string | null
  }>
  outstanding_balance_paise: number
}

interface RefundRow {
  id: string
  account_id: string
  account_name: string
  razorpay_payment_id: string | null
  razorpay_refund_id: string | null
  amount_paise: number
  reason: string
  status: 'pending' | 'issued' | 'failed' | 'cancelled'
  failure_reason: string | null
  requested_by: string
  issued_at: string | null
  created_at: string
}

interface PageProps {
  params: Promise<{ accountId: string }>
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function BillingAccountDetailPage({ params }: PageProps) {
  const { accountId } = await params
  if (!UUID_RE.test(accountId)) notFound()
  const supabase = await createServerClient()

  const [detailRes, summaryRes, refundsRes] = await Promise.all([
    supabase.schema('admin').rpc('account_detail', { p_account_id: accountId }),
    supabase.schema('admin').rpc('billing_account_summary', {
      p_account_id: accountId,
    }),
    supabase.schema('admin').rpc('billing_refunds_list', { p_limit: 200 }),
  ])

  if (detailRes.error) {
    if (detailRes.error.message?.toLowerCase().includes('not found')) notFound()
    return (
      <div className="mx-auto max-w-6xl p-6">
        <p className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {detailRes.error.message}
        </p>
      </div>
    )
  }

  const envelope = detailRes.data as AccountEnvelope
  const summary = summaryRes.data as BillingSummary | null
  const allRefunds = (refundsRes.data ?? []) as RefundRow[]
  const refunds = allRefunds.filter((r) => r.account_id === accountId)
  const { account, active_adjustments } = envelope

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-text-3">
            <Link href="/billing" className="hover:underline">
              Billing
            </Link>
            <span>/</span>
            <Link
              href={`/accounts/${account.id}`}
              className="hover:underline"
              title="Open the Accounts panel view — suspend/restore lives there"
            >
              Accounts view
            </Link>
          </div>
          <h1 className="text-xl font-semibold">{account.name}</h1>
          <p className="font-mono text-[11px] text-text-3">{account.id}</p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Subscription">
          <KV label="Plan">
            {summary?.subscription_state.plan_display_name
              ? `${summary.subscription_state.plan_display_name} (${account.plan_code})`
              : account.plan_code}
          </KV>
          <KV label="Effective plan">
            <span
              className={
                account.effective_plan !== account.plan_code
                  ? 'font-medium text-amber-800'
                  : undefined
              }
            >
              {account.effective_plan}
            </span>
          </KV>
          <KV label="Status">
            <StatusPill status={account.status} />
          </KV>
          <KV label="Trial ends">
            {account.trial_ends_at
              ? new Date(account.trial_ends_at).toLocaleDateString()
              : '—'}
          </KV>
          <KV label="Period ends">
            {account.current_period_ends_at
              ? new Date(account.current_period_ends_at).toLocaleDateString()
              : '—'}
          </KV>
          <KV label="Base price">
            {summary?.subscription_state.base_price_inr != null
              ? `₹${summary.subscription_state.base_price_inr.toLocaleString('en-IN')} / mo`
              : '—'}
          </KV>
        </Card>

        <Card title="Razorpay">
          <KV label="Customer">
            {account.razorpay_customer_id ? (
              <code className="font-mono text-xs">{account.razorpay_customer_id}</code>
            ) : (
              '—'
            )}
          </KV>
          <KV label="Subscription">
            {account.razorpay_subscription_id ? (
              <a
                href={`https://dashboard.razorpay.com/app/subscriptions/${encodeURIComponent(account.razorpay_subscription_id)}`}
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-xs text-teal hover:underline"
              >
                {account.razorpay_subscription_id} ↗
              </a>
            ) : (
              '—'
            )}
          </KV>
          <KV label="Next charge">
            {summary?.subscription_state.next_charge_amount_paise != null
              ? `₹${(summary.subscription_state.next_charge_amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
              : '—'}
          </KV>
        </Card>

        <Card title="Balance" pill="stub — Sprint 2">
          <KV label="Outstanding">
            {summary ? rupees(summary.outstanding_balance_paise) : '—'}
          </KV>
          <p className="pt-2 text-[11px] leading-relaxed text-text-3">
            Invoice pipeline ships in ADR-0050 Sprint 2. Until then the
            balance is always zero and the invoice list below is empty.
          </p>
        </Card>
      </section>

      <Card title="Latest invoice" pill="stub — Sprint 2">
        <p className="p-3 text-sm text-text-3">
          No invoice emitted yet. The first invoice will land once Sprint 2
          wires <code>admin.billing_issue_invoice</code> + R2 PDF storage.
        </p>
      </Card>

      <Card
        title="Plan history"
        pill={`${summary?.plan_history.length ?? 0} events`}
      >
        {!summary || summary.plan_history.length === 0 ? (
          <p className="p-6 text-sm text-text-3">No plan events recorded.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {summary.plan_history.map((e, i) => (
              <li
                key={`${e.adjustment_id ?? 'base'}-${e.action}-${i}`}
                className="flex items-start gap-3 px-4 py-2.5 text-xs"
              >
                <span className="w-[150px] shrink-0 font-mono text-[11px] text-text-3">
                  {new Date(e.effective_from).toLocaleString()}
                </span>
                <span className="w-[86px] shrink-0">
                  <SourcePill source={e.source} />
                </span>
                <span className="w-[72px] shrink-0 text-[11px] uppercase tracking-wider text-text-3">
                  {e.action}
                </span>
                <span className="w-[120px] shrink-0 font-mono text-xs">{e.plan_code}</span>
                <span className="flex-1 text-text-2">{e.reason ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Active plan adjustments"
        pill={`${active_adjustments.length}`}
      >
        {active_adjustments.length === 0 ? (
          <p className="p-6 text-sm text-text-3">
            No active comp or override. Operators can grant one from the
            Billing Operations panel.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Plan</th>
                  <th className="px-4 py-2">Expires</th>
                  <th className="px-4 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {active_adjustments.map((a) => (
                  <tr key={a.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2 text-xs">{a.kind}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.plan}</td>
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {a.expires_at
                        ? new Date(a.expires_at).toLocaleDateString()
                        : 'no expiry'}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-text-2">{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Refunds" pill={`${refunds.length}`}>
        {refunds.length === 0 ? (
          <p className="p-6 text-sm text-text-3">
            No refunds recorded for this account.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Refund</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Reason</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {r.razorpay_refund_id ?? r.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {rupees(r.amount_paise)}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-text-2">{r.reason}</td>
                    <td className="px-4 py-2">
                      <RefundStatusPill status={r.status} />
                      {r.failure_reason ? (
                        <div className="mt-1 text-[10px] text-red-700">
                          {r.failure_reason}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Card({
  title,
  pill,
  children,
}: {
  title: string
  pill?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {pill ? (
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
            {pill}
          </span>
        ) : null}
      </header>
      <div className="px-4 py-3 space-y-1.5">{children}</div>
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between text-sm">
      <span className="text-xs text-text-3">{label}</span>
      <span className="text-xs text-text-1">{children}</span>
    </div>
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

function SourcePill({ source }: { source: 'base' | 'comp' | 'override' }) {
  const tone =
    source === 'override'
      ? 'bg-purple-100 text-purple-800'
      : source === 'comp'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-bg text-text-3'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
      {source}
    </span>
  )
}

function RefundStatusPill({
  status,
}: {
  status: 'pending' | 'issued' | 'failed' | 'cancelled'
}) {
  const tone =
    status === 'issued'
      ? 'bg-green-100 text-green-700'
      : status === 'pending'
        ? 'bg-amber-100 text-amber-800'
        : status === 'failed'
          ? 'bg-red-100 text-red-700'
          : 'bg-bg text-text-3'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {status}
    </span>
  )
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}
