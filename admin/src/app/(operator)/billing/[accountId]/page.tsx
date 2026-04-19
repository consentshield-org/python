import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0050 Sprint 2.3 — per-account billing detail.
//
// Composes four RPCs:
//   · admin.account_detail              (ADR-0048; account + orgs + adj + audit)
//   · admin.billing_account_summary     (this ADR; plan history + latest_invoice + outstanding_balance_paise)
//   · admin.billing_invoice_list        (this ADR; scope-gated invoice history)
//   · admin.billing_refunds_list        (ADR-0034; filtered to this account client-side)
//
// Sprint 2.3 replaced the Sprint 1 stubs for latest-invoice and balance
// with real data. Invoice PDFs are served through
// /api/admin/billing/invoices/[invoiceId]/download, which presigns an
// R2 URL behind the admin proxy.

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
  latest_invoice: LatestInvoiceStub | null
  outstanding_balance_paise: number
}

interface LatestInvoiceStub {
  id: string
  invoice_number: string
  issue_date: string
  due_date: string
  status: InvoiceStatus
  total_paise: number
  issuer_entity_id: string
}

type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'void'
  | 'refunded'

interface InvoiceListRow {
  id: string
  invoice_number: string
  fy_year: string
  fy_sequence: number
  issue_date: string
  due_date: string
  period_start: string
  period_end: string
  currency: string
  subtotal_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
  status: InvoiceStatus
  issuer_entity_id: string
  issuer_is_active: boolean
  pdf_r2_key: string | null
  pdf_sha256: string | null
  issued_at: string | null
  paid_at: string | null
  email_message_id: string | null
  email_delivered_at: string | null
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

  const [detailRes, summaryRes, invoicesRes, refundsRes] = await Promise.all([
    supabase.schema('admin').rpc('account_detail', { p_account_id: accountId }),
    supabase.schema('admin').rpc('billing_account_summary', {
      p_account_id: accountId,
    }),
    supabase.schema('admin').rpc('billing_invoice_list', {
      p_account_id: accountId,
      p_limit: 50,
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
  const invoices = (invoicesRes.data ?? []) as InvoiceListRow[]
  const latest = invoices[0] ?? null
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

        <Card title="Balance">
          <KV label="Outstanding">
            {summary ? rupees(summary.outstanding_balance_paise) : '—'}
          </KV>
          <p className="pt-2 text-[11px] leading-relaxed text-text-3">
            Sum of total_paise across invoices in status issued,
            partially_paid, or overdue.
          </p>
        </Card>
      </section>

      <Card
        title="Latest invoice"
        pill={latest ? <InvoiceStatusPill status={latest.status} /> : 'no invoices'}
      >
        {!latest ? (
          <p className="p-3 text-sm text-text-3">
            No invoice issued for this account yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 p-1 md:grid-cols-2">
            <div className="space-y-1.5">
              <KV label="Number">
                <code className="font-mono text-xs">{latest.invoice_number}</code>
              </KV>
              <KV label="FY">
                <span className="font-mono text-xs">{latest.fy_year}</span>
              </KV>
              <KV label="Issue date">
                {new Date(latest.issue_date).toLocaleDateString()}
              </KV>
              <KV label="Due date">
                {new Date(latest.due_date).toLocaleDateString()}
              </KV>
            </div>
            <div className="space-y-1.5">
              <KV label="Subtotal">{rupees(latest.subtotal_paise)}</KV>
              {latest.cgst_paise > 0 || latest.sgst_paise > 0 ? (
                <>
                  <KV label="CGST">{rupees(latest.cgst_paise)}</KV>
                  <KV label="SGST">{rupees(latest.sgst_paise)}</KV>
                </>
              ) : (
                <KV label="IGST">{rupees(latest.igst_paise)}</KV>
              )}
              <KV label="Total">
                <strong>{rupees(latest.total_paise)}</strong>
              </KV>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-xs text-text-3">PDF</span>
                {latest.pdf_r2_key ? (
                  <a
                    href={`/api/admin/billing/invoices/${latest.id}/download`}
                    className="text-xs text-teal hover:underline"
                  >
                    Download ↓
                  </a>
                ) : (
                  <span className="text-xs text-text-3">
                    pending (draft — issue to finalise)
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Invoice history"
        pill={`${invoices.length}${invoices.length === 50 ? '+' : ''}`}
      >
        {invoices.length === 0 ? (
          <p className="p-6 text-sm text-text-3">
            No invoices on file for this account.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Number</th>
                  <th className="px-4 py-2">Issued</th>
                  <th className="px-4 py-2">Period</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-t border-[color:var(--border)]"
                  >
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {inv.invoice_number}
                      {!inv.issuer_is_active ? (
                        <span
                          className="ml-2 rounded-full bg-bg px-2 py-0.5 text-[10px] text-text-3"
                          title="Issued under a retired issuer"
                        >
                          retired
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {new Date(inv.issue_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {inv.period_start} → {inv.period_end}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {rupees(inv.total_paise)}
                    </td>
                    <td className="px-4 py-2">
                      <InvoiceStatusPill status={inv.status} />
                    </td>
                    <td className="px-4 py-2">
                      {inv.pdf_r2_key ? (
                        <a
                          href={`/api/admin/billing/invoices/${inv.id}/download`}
                          className="text-xs text-teal hover:underline"
                        >
                          Download ↓
                        </a>
                      ) : (
                        <span className="text-[11px] text-text-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const tone =
    status === 'paid'
      ? 'bg-green-100 text-green-700'
      : status === 'issued'
        ? 'bg-amber-100 text-amber-800'
        : status === 'overdue'
          ? 'bg-red-100 text-red-700'
          : status === 'partially_paid'
            ? 'bg-amber-100 text-amber-800'
            : status === 'void' || status === 'refunded'
              ? 'bg-bg text-text-3'
              : 'bg-slate-100 text-slate-700'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {status}
    </span>
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
