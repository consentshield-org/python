import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

// ADR-0032 Sprint 1.1 — Support tickets list + metric tiles.
// ADR-1027 Sprint 2.2 — Account column + account filter.
//
// All admin roles can read. Writes (reply / status / priority / assign)
// require support or platform_operator — enforced at the RPC layer.

export const dynamic = 'force-dynamic'

const OPEN_STATUSES = ['open', 'awaiting_customer', 'awaiting_operator']

interface Ticket {
  id: string
  org_id: string | null
  account_id: string | null
  subject: string
  status: string
  priority: string
  reporter_email: string
  created_at: string
  assigned_admin_user_id: string | null
  org_name: string | null
  account_name: string | null
  assignee_name: string | null
}

interface PageProps {
  searchParams: Promise<{ account_id?: string }>
}

export default async function SupportPage({ searchParams }: PageProps) {
  const params = await searchParams
  const supabase = await createServerClient()

  const [ticketsRes, adminsRes, orgsRes, accountsRes] = await Promise.all([
    supabase
      .schema('admin')
      .from('support_tickets')
      .select(
        'id, org_id, subject, status, priority, reporter_email, created_at, assigned_admin_user_id',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.schema('admin').from('admin_users').select('id, display_name'),
    supabase
      .from('organisations')
      .select('id, name, account_id, accounts(name, plan_code)'),
    supabase.schema('admin').rpc('accounts_list', {
      p_status: null,
      p_plan_code: null,
      p_q: null,
    }),
  ])

  const adminById = new Map<string, string>()
  for (const a of adminsRes.data ?? []) adminById.set(a.id, a.display_name)

  type OrgRow = {
    id: string
    name: string
    account_id: string | null
    accounts: Array<{ name: string; plan_code: string }> | { name: string; plan_code: string } | null
  }
  const orgById = new Map<string, { name: string; account_id: string | null; account_name: string | null }>()
  for (const o of (orgsRes.data ?? []) as OrgRow[]) {
    const acct = Array.isArray(o.accounts) ? o.accounts[0] : o.accounts
    orgById.set(o.id, {
      name: o.name,
      account_id: o.account_id ?? null,
      account_name: acct?.name ?? null,
    })
  }

  const allAccounts = (accountsRes.data ?? []) as Array<{
    id: string
    name: string
    plan_code: string
    org_count: number
  }>

  const allTickets: Ticket[] = (ticketsRes.data ?? []).map((t) => {
    const orgInfo = t.org_id ? orgById.get(t.org_id) ?? null : null
    return {
      id: t.id,
      org_id: t.org_id,
      account_id: orgInfo?.account_id ?? null,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      reporter_email: t.reporter_email,
      created_at: t.created_at,
      assigned_admin_user_id: t.assigned_admin_user_id,
      org_name: orgInfo?.name ?? null,
      account_name: orgInfo?.account_name ?? null,
      assignee_name: t.assigned_admin_user_id
        ? adminById.get(t.assigned_admin_user_id) ?? null
        : null,
    }
  })

  const tickets: Ticket[] = params.account_id
    ? allTickets.filter((t) => t.account_id === params.account_id)
    : allTickets

  // Sort: priority desc (urgent → low), then status (open/awaiting first),
  // then most-recent first.
  const priorityRank: Record<string, number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  }
  const statusRank = (s: string) =>
    OPEN_STATUSES.includes(s) ? 0 : s === 'resolved' ? 1 : 2
  tickets.sort((a, b) => {
    const p = (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99)
    if (p !== 0) return p
    const s = statusRank(a.status) - statusRank(b.status)
    if (s !== 0) return s
    return b.created_at.localeCompare(a.created_at)
  })

  // Metric tiles.
  const open = tickets.filter((t) => OPEN_STATUSES.includes(t.status))
  const awaitingOperator = open.filter((t) => t.status === 'awaiting_operator')
  const urgentOpen = open.filter((t) => t.priority === 'urgent')

  const oneWeekAgo = new Date()
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
  const resolvedThisWeek = tickets.filter(
    (t) =>
      (t.status === 'resolved' || t.status === 'closed') &&
      new Date(t.created_at) >= oneWeekAgo,
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Support Tickets</h1>
        <p className="text-sm text-text-2">
          Customer support queue. Replies require the support or platform_operator role.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Open" value={open.length} delta={`${awaitingOperator.length} awaiting operator`} tone={awaitingOperator.length > 0 ? 'amber' : 'normal'} />
        <MetricTile label="Resolved (last 7 days)" value={resolvedThisWeek.length} delta={undefined} tone="normal" />
        <MetricTile label="Urgent open" value={urgentOpen.length} delta={urgentOpen[0]?.subject} tone={urgentOpen.length > 0 ? 'red' : 'normal'} />
        <MetricTile label="Median first response" value={'—'} delta="target: 1h · ships in V2" tone="normal" />
      </section>

      <div className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--border)] p-4">
          <h2 className="text-sm font-semibold">
            Tickets
            <span className="ml-2 text-xs font-normal text-text-3">
              {tickets.length} total
              {params.account_id
                ? ` · filtered to ${allAccounts.find((a) => a.id === params.account_id)?.name ?? 'account'}`
                : ' · showing latest 200'}
            </span>
          </h2>
          {/* ADR-1027 Sprint 2.2 — Account filter. Selecting an account
              narrows the list to every ticket whose org is in that account. */}
          <form method="GET" className="flex items-center gap-2 text-xs">
            <label htmlFor="ticket-account-filter" className="text-text-3">
              Account:
            </label>
            <select
              id="ticket-account-filter"
              name="account_id"
              defaultValue={params.account_id ?? ''}
              onChange={(e) => e.currentTarget.form?.submit()}
              className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-xs"
            >
              <option value="">All accounts</option>
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.plan_code} · {Number(a.org_count)}{' '}
                  {Number(a.org_count) === 1 ? 'org' : 'orgs'}
                </option>
              ))}
            </select>
            {params.account_id ? (
              <Link
                href="/support"
                className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-xs text-text-2 hover:bg-bg"
              >
                Reset
              </Link>
            ) : null}
          </form>
        </header>

        {tickets.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3">
            No tickets yet. Customer tickets appear here once the customer-side
            Contact Support surface ships in Sprint 2.1.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">Subject</th>
                  <th className="px-4 py-2">Account · Org</th>
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Assigned</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-[color:var(--border)] hover:bg-bg"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/support/${t.id}`}
                        className="font-mono text-xs text-red-700 hover:underline"
                      >
                        {t.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{t.subject}</td>
                    <td className="px-4 py-2 text-xs text-text-2">
                      <div>{t.account_name ?? '—'}</div>
                      <div className="text-[11px] text-text-3">
                        {t.org_name ?? (t.org_id ? t.org_id.slice(0, 8) : '—')}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <PriorityPill priority={t.priority} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusPill status={t.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-text-2">
                      {t.assignee_name ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-2">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  delta,
  tone,
}: {
  label: string
  value: number | string
  delta?: string
  tone: 'normal' | 'amber' | 'red'
}) {
  const valueColor =
    tone === 'red'
      ? 'text-red-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-text'
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {delta ? (
        <p className="mt-1 truncate text-xs text-text-2">{delta}</p>
      ) : null}
    </div>
  )
}

function PriorityPill({ priority }: { priority: string }) {
  const classes =
    priority === 'urgent'
      ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700'
      : priority === 'high'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
        : priority === 'normal'
          ? 'rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text-2'
          : 'rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-text-3'
  return <span className={classes}>{priority}</span>
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'open' || status === 'awaiting_operator'
      ? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
      : status === 'awaiting_customer'
        ? 'rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800'
        : status === 'resolved'
          ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
          : 'rounded-full bg-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-text-2'
  return <span className={classes}>{status.replace(/_/g, ' ')}</span>
}
