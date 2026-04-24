import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-1027 Sprint 2.1 — Account-context sidebar card.
//
// Server Component. Calls admin.account_detail(p_account_id) and renders
// the canonical operator envelope (plan + status + child orgs + active
// adjustments + last 3 audit rows). Swappable between `full` (default;
// sidebar placement) and `compact` (inline-banner placement) modes.

type Mode = 'full' | 'compact'

interface Props {
  accountId: string
  /** When true, only render the header strip (no audit/orgs blocks). */
  mode?: Mode
  /** Optional link label — defaults to "Open account →". */
  linkLabel?: string
}

interface AccountEnvelope {
  account: {
    id: string
    name: string
    plan_code: string
    status: string
    trial_ends_at: string | null
    current_period_ends_at: string | null
    razorpay_subscription_id: string | null
    created_at: string
    effective_plan: unknown
  }
  organisations: Array<{
    id: string
    name: string
    status: string
    created_at: string
  }>
  active_adjustments: Array<{
    id: string
    kind: string
    plan: string | null
    starts_at: string
    expires_at: string | null
    reason: string
    created_at: string
  }>
  audit_recent: Array<{
    action: string
    admin_user_id: string
    reason: string
    created_at: string
  }>
}

const STATUS_TONE: Record<string, string> = {
  active: 'text-green-700 bg-green-50 border-green-200',
  trial: 'text-navy bg-navy/5 border-navy/20',
  past_due: 'text-amber-700 bg-amber-50 border-amber-200',
  suspended: 'text-red-700 bg-red-50 border-red-200',
  cancelled: 'text-text-3 bg-bg border-[color:var(--border)]',
}

export async function AccountContextCard({
  accountId,
  mode = 'full',
  linkLabel = 'Open account →',
}: Props) {
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('account_detail', { p_account_id: accountId })

  if (error || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
        Could not load parent account ({accountId.slice(0, 8)}):{' '}
        {error?.message ?? 'no data'}
      </div>
    )
  }

  const env = data as AccountEnvelope
  const statusTone = STATUS_TONE[env.account.status] ?? STATUS_TONE.cancelled
  const orgCount = env.organisations.length

  if (mode === 'compact') {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[color:var(--border)] bg-white px-3 py-2 text-xs shadow-sm">
        <div className="flex-1">
          <div className="font-semibold text-text">{env.account.name}</div>
          <div className="text-text-3">
            {env.account.plan_code} · {orgCount}{' '}
            {orgCount === 1 ? 'org' : 'orgs'} · since{' '}
            {new Date(env.account.created_at).toLocaleDateString('en-IN')}
          </div>
        </div>
        <span className={`rounded border px-2 py-0.5 ${statusTone}`}>
          {env.account.status}
        </span>
        <Link
          href={`/accounts/${accountId}`}
          className="text-red-700 hover:underline"
        >
          {linkLabel}
        </Link>
      </div>
    )
  }

  return (
    <aside className="sticky top-4 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-text-3">
          Parent account
        </div>
        <Link
          href={`/accounts/${accountId}`}
          className="text-xs text-red-700 hover:underline"
        >
          {linkLabel}
        </Link>
      </div>

      <h3 className="text-base font-semibold text-text">{env.account.name}</h3>
      <div className="mt-1 flex items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-[11px] ${statusTone}`}>
          {env.account.status}
        </span>
        <span className="text-xs text-text-2">{env.account.plan_code}</span>
        {env.account.razorpay_subscription_id ? (
          <span className="text-[11px] text-text-3">· Razorpay linked</span>
        ) : null}
      </div>

      {env.account.trial_ends_at ? (
        <p className="mt-2 text-[11px] text-text-3">
          Trial ends{' '}
          {new Date(env.account.trial_ends_at).toLocaleDateString('en-IN', {
            dateStyle: 'medium',
          })}
        </p>
      ) : null}

      <div className="mt-3 space-y-1 text-xs">
        <KV label={orgCount === 1 ? 'Organisation' : 'Organisations'}>
          {orgCount}
        </KV>
        <KV label="Since">
          {new Date(env.account.created_at).toLocaleDateString('en-IN')}
        </KV>
      </div>

      {env.active_adjustments.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Active adjustments
          </div>
          <ul className="mt-1 space-y-1 text-xs">
            {env.active_adjustments.map((adj) => (
              <li key={adj.id} className="text-text-2">
                <span className="font-medium">{adj.kind}</span>
                {adj.plan ? ` · ${adj.plan}` : ''}
                {adj.expires_at
                  ? ` · until ${new Date(adj.expires_at).toLocaleDateString('en-IN')}`
                  : ''}
                <div className="truncate text-[11px] text-text-3" title={adj.reason}>
                  {adj.reason}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {env.audit_recent.length > 0 ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Recent admin actions
          </div>
          <ul className="mt-1 space-y-1 text-xs text-text-2">
            {env.audit_recent.slice(0, 3).map((row, i) => (
              <li key={i} className="truncate" title={row.reason}>
                <span className="font-mono text-red-700">{row.action}</span>{' '}
                <span className="text-text-3">
                  · {new Date(row.created_at).toLocaleDateString('en-IN')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-3">{label}</span>
      <span className="font-medium text-text">{children}</span>
    </div>
  )
}
