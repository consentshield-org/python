'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Field,
  FormFooter,
  ModalShell,
  ReasonField,
} from '@/components/common/modal-form'
import {
  createRefund,
  revokePlanAdjustment,
  upsertPlanAdjustment,
} from './actions'
import { suspendAccountAction } from '../accounts/actions'

// ADR-0034 Sprint 2.1 — Billing tabs (client).

export interface BillingData {
  paymentFailures: Array<{
    account_id: string
    account_name: string
    plan_code: string | null
    effective_plan: string | null
    razorpay_subscription_id: string | null
    last_failed_at: string
    retries: number
    last_payment_id: string | null
  }>
  refunds: Array<{
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
  }>
  comps: Array<PlanAdjustment>
  overrides: Array<PlanAdjustment>
  plans: Array<{ plan_code: string; display_name: string }>
  accounts: Array<{ id: string; name: string; status: string }>
}

interface PlanAdjustment {
  id: string
  account_id: string
  account_name: string
  kind: 'comp' | 'override'
  plan: string
  starts_at: string
  expires_at: string | null
  reason: string
  granted_by: string
  created_at: string
}

type TabKey = 'fail' | 'refund' | 'comp' | 'override'
type Modal =
  | { kind: 'refund'; accountId: string; accountName: string; paymentId?: string | null }
  | { kind: 'adjustment'; kind2: 'comp' | 'override' }
  | { kind: 'revoke'; id: string; summary: string }
  | { kind: 'suspend'; accountId: string; accountName: string }

export function BillingTabs({
  data,
  canWriteRefunds,
  canWriteAdjustments,
}: {
  data: BillingData
  canWriteRefunds: boolean
  canWriteAdjustments: boolean
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('fail')
  const [modal, setModal] = useState<Modal | null>(null)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'fail', label: 'Payment failures', count: data.paymentFailures.length },
    { key: 'refund', label: 'Refunds', count: data.refunds.length },
    { key: 'comp', label: 'Comp accounts', count: data.comps.length },
    { key: 'override', label: 'Plan overrides', count: data.overrides.length },
  ]

  return (
    <div className="space-y-3">
      <div className="flex gap-0 rounded-md border border-[color:var(--border)] bg-white p-1 shadow-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              t.key === tab
                ? 'rounded bg-teal px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded px-3 py-1.5 text-xs text-text-2 hover:bg-bg'
            }
          >
            {t.label}
            {typeof t.count === 'number' ? (
              <span
                className={
                  t.key === tab
                    ? 'ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px]'
                    : 'ml-2 rounded bg-bg px-1.5 py-0.5 text-[10px] text-text-3'
                }
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'fail' ? (
        <PaymentFailuresTab
          rows={data.paymentFailures}
          canWriteRefunds={canWriteRefunds}
          canWriteAdjustments={canWriteAdjustments}
          onOpenRefund={(f) =>
            setModal({
              kind: 'refund',
              accountId: f.account_id,
              accountName: f.account_name,
              paymentId: f.last_payment_id,
            })
          }
          onOpenSuspend={(f) =>
            setModal({
              kind: 'suspend',
              accountId: f.account_id,
              accountName: f.account_name,
            })
          }
        />
      ) : null}
      {tab === 'refund' ? <RefundsTab rows={data.refunds} /> : null}
      {tab === 'comp' ? (
        <PlanAdjustmentsTab
          title="Comp accounts"
          subtitle="Time-bounded free grants for partners, pilots, and community. Plan replaces accounts.plan_code while active."
          rows={data.comps}
          canWrite={canWriteAdjustments}
          onAdd={() => setModal({ kind: 'adjustment', kind2: 'comp' })}
          onRevoke={(id, summary) => setModal({ kind: 'revoke', id, summary })}
        />
      ) : null}
      {tab === 'override' ? (
        <PlanAdjustmentsTab
          title="Plan overrides"
          subtitle="Temporary effective-plan grants (e.g., goodwill upgrade for a support incident). Overrides win over comps."
          rows={data.overrides}
          canWrite={canWriteAdjustments}
          onAdd={() => setModal({ kind: 'adjustment', kind2: 'override' })}
          onRevoke={(id, summary) => setModal({ kind: 'revoke', id, summary })}
        />
      ) : null}

      {modal?.kind === 'refund' ? (
        <RefundModal
          accountId={modal.accountId}
          accountName={modal.accountName}
          paymentIdHint={modal.paymentId ?? ''}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'adjustment' ? (
        <AdjustmentModal
          kind={modal.kind2}
          plans={data.plans}
          accounts={data.accounts}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'revoke' ? (
        <RevokeModal
          adjustmentId={modal.id}
          summary={modal.summary}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'suspend' ? (
        <SuspendAccountModal
          accountId={modal.accountId}
          accountName={modal.accountName}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  )
}

// ---------------- Cards / primitives ----------------

function Card({
  title,
  pill,
  action,
  children,
  footer,
}: {
  title: string
  pill?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {pill}
        </div>
        {action}
      </header>
      {children}
      {footer}
    </section>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red' | 'gray'
  children: React.ReactNode
}) {
  const classes =
    tone === 'green'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700'
      : tone === 'amber'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'
        : tone === 'red'
          ? 'rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700'
          : 'rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-3'
  return <span className={classes}>{children}</span>
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(iso).toLocaleString()
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

// ---------------- Tab bodies ----------------

function razorpaySubscriptionUrl(subId: string): string {
  return `https://dashboard.razorpay.com/app/subscriptions/${encodeURIComponent(subId)}`
}

function PaymentFailuresTab({
  rows,
  canWriteRefunds,
  canWriteAdjustments,
  onOpenRefund,
  onOpenSuspend,
}: {
  rows: BillingData['paymentFailures']
  canWriteRefunds: boolean
  canWriteAdjustments: boolean
  onOpenRefund: (row: BillingData['paymentFailures'][number]) => void
  onOpenSuspend: (row: BillingData['paymentFailures'][number]) => void
}) {
  const pill =
    rows.length === 0 ? (
      <Pill tone="green">0 in window</Pill>
    ) : (
      <Pill tone="amber">{rows.length} account(s)</Pill>
    )
  return (
    <Card title="Razorpay payment failures (last 7 days)" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">
          No <code>payment_failed</code> audit events in the last 7 days.
          Failures arrive via the Razorpay webhook; empty here means the
          pipeline is healthy.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Last failed</th>
                <th className="px-4 py-2">Retries</th>
                <th className="px-4 py-2">Subscription</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.account_id}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 text-xs">
                    <div className="font-medium">{r.account_name}</div>
                    <div className="font-mono text-[11px] text-text-3">
                      {r.account_id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.plan_code ?? '—'}
                    {r.effective_plan && r.effective_plan !== r.plan_code ? (
                      <span className="ml-2 text-[10px] text-text-3">
                        eff. {r.effective_plan}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {relative(r.last_failed_at)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <Pill tone={r.retries >= 4 ? 'red' : 'amber'}>
                      {r.retries}
                    </Pill>
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {r.razorpay_subscription_id ?? '—'}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      {r.razorpay_subscription_id ? (
                        <a
                          href={razorpaySubscriptionUrl(r.razorpay_subscription_id)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg"
                          title="Razorpay handles subscription-charge retries automatically; this opens the dashboard for manual inspection"
                        >
                          Retry at Razorpay ↗
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onOpenRefund(r)}
                        disabled={!canWriteRefunds || !r.last_payment_id}
                        title={
                          canWriteRefunds
                            ? r.last_payment_id
                              ? 'Open refund for the last failed payment id'
                              : 'No payment id on the last failure — refund not applicable'
                            : 'support or platform_operator required'
                        }
                        className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Refund
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSuspend(r)}
                        disabled={!canWriteAdjustments || r.retries < 3}
                        title={
                          canWriteAdjustments
                            ? r.retries >= 3
                              ? 'Suspend account and all child orgs (use when retries are exhausted)'
                              : 'Available after ≥3 retries'
                            : 'platform_operator required'
                        }
                        className="rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Suspend
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Subscription-charge retries run on Razorpay&apos;s own automatic
        retry policy — there is no first-class &ldquo;retry now&rdquo; API.
        The button above deep-links to the dashboard so operators can
        inspect state or manually trigger an invoice. Refunds use the
        real Razorpay REST API; the row flips pending → issued or failed
        based on the response.
      </footer>
    </Card>
  )
}

function RefundsTab({ rows }: { rows: BillingData['refunds'] }) {
  const active = rows.filter((r) => r.status === 'pending' || r.status === 'failed')
  const pill =
    active.length > 0 ? (
      <Pill tone="amber">{active.length} pending/failed</Pill>
    ) : (
      <Pill tone="green">clean</Pill>
    )
  return (
    <Card title="Refund ledger (newest 50)" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">
          No refunds recorded. Create one from the Payment failures tab or
          from the Razorpay dashboard — either lands a row here once Sprint
          2.2 wires the round-trip.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Refund</th>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {r.razorpay_refund_id ?? r.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.account_name}</td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {rupees(r.amount_paise)}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    {r.reason}
                  </td>
                  <td className="px-4 py-2">
                    <Pill
                      tone={
                        r.status === 'issued'
                          ? 'green'
                          : r.status === 'pending'
                            ? 'amber'
                            : r.status === 'failed'
                              ? 'red'
                              : 'gray'
                      }
                    >
                      {r.status}
                    </Pill>
                    {r.failure_reason ? (
                      <div className="mt-1 text-[10px] text-red-700">
                        {r.failure_reason}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function PlanAdjustmentsTab({
  title,
  subtitle,
  rows,
  canWrite,
  onAdd,
  onRevoke,
}: {
  title: string
  subtitle: string
  rows: PlanAdjustment[]
  canWrite: boolean
  onAdd: () => void
  onRevoke: (id: string, summary: string) => void
}) {
  return (
    <Card
      title={title}
      pill={<Pill tone="gray">{rows.length} active</Pill>}
      action={
        <button
          type="button"
          onClick={onAdd}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator role required'}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          + New
        </button>
      }
    >
      <p className="border-b border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        {subtitle}
      </p>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">No active {title.toLowerCase()}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Starts</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 text-xs">{r.account_name}</td>
                  <td className="px-4 py-2 text-xs font-mono">{r.plan}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.starts_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {r.expires_at
                      ? new Date(r.expires_at).toLocaleDateString()
                      : 'no expiry'}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-2">{r.reason}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        onRevoke(
                          r.id,
                          `${r.account_name} — ${r.kind} ${r.plan}`,
                        )
                      }
                      disabled={!canWrite}
                      className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ---------------- Modals ----------------

function RefundModal({
  accountId,
  accountName,
  paymentIdHint,
  onClose,
}: {
  accountId: string
  accountName: string
  paymentIdHint: string
  onClose: () => void
}) {
  const router = useRouter()
  const [paymentId, setPaymentId] = useState(paymentIdHint)
  const [amountRupees, setAmountRupees] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<
    | null
    | {
        status: 'issued' | 'failed' | 'pending'
        razorpayRefundId?: string
        failureReason?: string
        warning?: string
      }
  >(null)

  const amountPaise = Math.round(Number(amountRupees) * 100)
  const ok =
    reason.trim().length >= 10 &&
    Number.isFinite(amountPaise) &&
    amountPaise > 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await createRefund({
      accountId,
      razorpayPaymentId: paymentId,
      amountPaise,
      reason,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    // Keep the modal open long enough to show the round-trip outcome,
    // then refresh the underlying tables. Operator dismisses manually.
    setOutcome({
      status: r.data!.status,
      razorpayRefundId: r.data!.razorpayRefundId,
      failureReason: r.data!.failureReason,
      warning: r.data!.warning,
    })
    router.refresh()
  }

  if (outcome) {
    return (
      <ModalShell
        title={`Refund — ${accountName}`}
        subtitle="Round-trip complete."
        onClose={onClose}
      >
        <div className="space-y-3 p-4 text-sm">
          {outcome.status === 'issued' ? (
            <div className="rounded border border-green-200 bg-green-50 p-3 text-green-900">
              <p className="font-medium">Issued ✓</p>
              <p className="mt-1 text-xs">
                Razorpay refund id:{' '}
                <code className="font-mono">{outcome.razorpayRefundId}</code>
              </p>
            </div>
          ) : null}
          {outcome.status === 'failed' ? (
            <div className="rounded border border-red-200 bg-red-50 p-3 text-red-900">
              <p className="font-medium">Razorpay declined the refund</p>
              <p className="mt-1 text-xs">{outcome.failureReason}</p>
              <p className="mt-2 text-[11px] text-red-800/80">
                The ledger row is marked <code>failed</code>; investigate in
                the Razorpay dashboard or retry after fixing the input.
              </p>
            </div>
          ) : null}
          {outcome.status === 'pending' ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <p className="font-medium">Pending — not sent to Razorpay</p>
              <p className="mt-1 text-xs">{outcome.warning}</p>
            </div>
          ) : null}
          <FormFooter
            pending={false}
            onClose={onClose}
            submit="Close"
            disabled={false}
          />
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      title={`Refund — ${accountName}`}
      subtitle="Creates a pending refunds row, then calls Razorpay. On success the row flips to issued + records the razorpay_refund_id; on failure it flips to failed + stores the error."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Razorpay payment id">
          <input
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="pay_…"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
        </Field>
        <Field label="Amount (₹)">
          <input
            value={amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Issue refund"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function AdjustmentModal({
  kind,
  plans,
  accounts,
  onClose,
}: {
  kind: 'comp' | 'override'
  plans: BillingData['plans']
  accounts: BillingData['accounts']
  onClose: () => void
}) {
  const router = useRouter()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [planCode, setPlanCode] = useState(plans[0]?.plan_code ?? '')
  const [expiresAt, setExpiresAt] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ok = accountId.length > 0 && planCode.length > 0 && reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await upsertPlanAdjustment({
      accountId,
      kind,
      planCode,
      expiresAt,
      reason,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title={kind === 'comp' ? 'New comp grant' : 'New plan override'}
      subtitle={
        kind === 'comp'
          ? 'Grants the selected plan free of charge. Replaces any existing active comp for this account.'
          : 'Forces the selected plan regardless of billing. Wins over comps. Replaces any existing active override for this account.'
      }
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Account">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-sm"
          >
            {accounts.length === 0 ? (
              <option value="">(no accounts)</option>
            ) : null}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.status}
                {' · '}
                {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Plan">
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-sm"
          >
            {plans.map((p) => (
              <option key={p.plan_code} value={p.plan_code}>
                {p.display_name} ({p.plan_code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expires (optional)">
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit={kind === 'comp' ? 'Grant comp' : 'Set override'}
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function RevokeModal({
  adjustmentId,
  summary,
  onClose,
}: {
  adjustmentId: string
  summary: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await revokePlanAdjustment({ adjustmentId, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <ModalShell
      title={`Revoke — ${summary}`}
      subtitle="The grant is marked revoked; account_effective_plan falls back to the next tier (override → comp → accounts.plan_code)."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Revoke"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

// ADR-0048 Sprint 1.2 — Suspend-account flow surfaced on Payment Failures.

function SuspendAccountModal({
  accountId,
  accountName,
  onClose,
}: {
  accountId: string
  accountName: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<null | { flippedOrgCount: number }>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await suspendAccountAction({ accountId, reason })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setOutcome({ flippedOrgCount: r.data!.flippedOrgCount })
    router.refresh()
  }

  if (outcome) {
    return (
      <ModalShell title={`Suspended — ${accountName}`} onClose={onClose}>
        <div className="space-y-3 p-4 text-sm">
          <div className="rounded border border-red-200 bg-red-50 p-3 text-red-900">
            <p className="font-medium">Account suspended</p>
            <p className="mt-1 text-xs">
              {outcome.flippedOrgCount} child org(s) flipped to suspended. The
              Worker stops serving the account&rsquo;s banner on the next KV
              sync (~2 min). Restore from <code>/accounts/{accountId.slice(0, 8)}</code> when ready.
            </p>
          </div>
          <FormFooter
            pending={false}
            onClose={onClose}
            submit="Close"
            disabled={false}
          />
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell
      title={`Suspend — ${accountName}`}
      subtitle="Use this when Razorpay retries are exhausted and the account should stop serving until payment is restored. Fans out to every active child org."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Suspend account"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}
