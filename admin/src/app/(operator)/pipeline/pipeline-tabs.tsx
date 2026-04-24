'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

// ADR-0033 Sprint 1.2 — Pipeline tabs (client).
// ADR-1027 Sprint 2.1 — per-row account enrichment + group-by-account toggle.

export interface OrgAccountRow {
  account_id: string
  account_name: string
  plan_code: string
}

export type OrgAccountLookup = Record<string, OrgAccountRow>

export interface PipelineData {
  workerErrors: Array<{
    id: string
    occurred_at: string
    endpoint: string
    status_code: number | null
    upstream_error: string | null
    org_id: string
    org_name: string
    property_id: string | null
  }>
  stuckBuffers: Array<{
    buffer_table: string
    stuck_count: number
    oldest_created: string | null
    oldest_age_seconds: number | null
  }>
  expiryQueue: Array<{
    org_id: string
    org_name: string
    expiring_lt_7d: number
    expiring_lt_30d: number
    expired_awaiting_enforce: number
    last_expiry_alert_at: string | null
  }>
  deliveryHealth: Array<{
    org_id: string
    org_name: string
    median_latency_ms: number | null
    p95_latency_ms: number | null
    failure_count: number
    throughput: number
    success_rate: number | null
  }>
}

type TabKey = 'worker' | 'buffers' | 'expiry' | 'delivery'
type GroupBy = 'org' | 'account'

export function PipelineTabs({
  data,
  orgToAccount,
}: {
  data: PipelineData
  orgToAccount: OrgAccountLookup
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('worker')
  const [groupBy, setGroupBy] = useState<GroupBy>('org')

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'worker', label: 'Worker errors', count: data.workerErrors.length },
    {
      key: 'buffers',
      label: 'Stuck buffers',
      count: data.stuckBuffers.filter((b) => b.stuck_count > 0).length,
    },
    {
      key: 'expiry',
      label: 'DEPA expiry queue',
      count: data.expiryQueue.length,
    },
    {
      key: 'delivery',
      label: 'Delivery health',
      count: data.deliveryHealth.length,
    },
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

      {/* ADR-1027 Sprint 2.1 — group-by toggle. Affects tabs with org-grouped
          rows (Worker errors, DEPA expiry queue, Delivery health). Stuck
          buffers is table-grouped and is unaffected. */}
      {tab !== 'buffers' ? (
        <div className="flex items-center justify-end gap-2 text-xs text-text-3">
          <span>Group by:</span>
          <div className="flex rounded-md border border-[color:var(--border)] bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setGroupBy('org')}
              className={
                groupBy === 'org'
                  ? 'rounded bg-teal px-2.5 py-1 text-[11px] font-medium text-white'
                  : 'rounded px-2.5 py-1 text-[11px] text-text-2 hover:bg-bg'
              }
            >
              Orgs
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('account')}
              className={
                groupBy === 'account'
                  ? 'rounded bg-teal px-2.5 py-1 text-[11px] font-medium text-white'
                  : 'rounded px-2.5 py-1 text-[11px] text-text-2 hover:bg-bg'
              }
            >
              Accounts
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'worker' ? (
        <WorkerErrorsTab rows={data.workerErrors} groupBy={groupBy} orgToAccount={orgToAccount} />
      ) : null}
      {tab === 'buffers' ? <StuckBuffersTab rows={data.stuckBuffers} /> : null}
      {tab === 'expiry' ? (
        <ExpiryQueueTab rows={data.expiryQueue} groupBy={groupBy} orgToAccount={orgToAccount} />
      ) : null}
      {tab === 'delivery' ? (
        <DeliveryHealthTab rows={data.deliveryHealth} groupBy={groupBy} orgToAccount={orgToAccount} />
      ) : null}
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
        {pill}
      </header>
      {children}
    </section>
  )
}

function WorkerErrorsTab({
  rows,
  groupBy,
  orgToAccount,
}: {
  rows: PipelineData['workerErrors']
  groupBy: GroupBy
  orgToAccount: OrgAccountLookup
}) {
  const pill =
    rows.length === 0 ? (
      <Pill tone="green">healthy</Pill>
    ) : rows.length < 10 ? (
      <Pill tone="amber">{rows.length} events</Pill>
    ) : (
      <Pill tone="red">{rows.length} events</Pill>
    )

  // ADR-1027 Sprint 2.1 — when groupBy === 'account', aggregate events
  // into per-account rows. Orgs with no account mapping fall into a
  // synthetic '(no account)' bucket so they're visible, not dropped.
  const accountRollup = useMemo(() => {
    if (groupBy !== 'account') return null
    const buckets = new Map<
      string,
      {
        account_id: string
        account_name: string
        plan_code: string | null
        event_count: number
        endpoints: Set<string>
        orgs_touched: Set<string>
        most_recent: string
      }
    >()
    for (const r of rows) {
      const a = orgToAccount[r.org_id]
      const key = a?.account_id ?? 'unmapped'
      const b = buckets.get(key) ?? {
        account_id: a?.account_id ?? '',
        account_name: a?.account_name ?? '(no account)',
        plan_code: a?.plan_code ?? null,
        event_count: 0,
        endpoints: new Set<string>(),
        orgs_touched: new Set<string>(),
        most_recent: r.occurred_at,
      }
      b.event_count += 1
      b.endpoints.add(r.endpoint)
      b.orgs_touched.add(r.org_id)
      if (new Date(r.occurred_at) > new Date(b.most_recent)) {
        b.most_recent = r.occurred_at
      }
      buckets.set(key, b)
    }
    return Array.from(buckets.values()).sort(
      (x, y) => y.event_count - x.event_count,
    )
  }, [rows, groupBy, orgToAccount])

  return (
    <Card title="worker_errors — last 24h" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No Worker write failures in the last 24 hours. Either the pipeline is
          healthy or the Worker hasn&apos;t been exercised — check{' '}
          <span className="font-mono">/pipeline/delivery-health</span> for
          throughput.
        </p>
      ) : groupBy === 'account' && accountRollup ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Events</th>
                <th className="px-4 py-2">Orgs touched</th>
                <th className="px-4 py-2">Endpoints</th>
                <th className="px-4 py-2">Most recent</th>
              </tr>
            </thead>
            <tbody>
              {accountRollup.map((b) => (
                <tr
                  key={b.account_id || 'unmapped'}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 text-xs">
                    <strong>{b.account_name}</strong>
                  </td>
                  <td className="px-4 py-2 text-xs">{b.plan_code ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{b.event_count}</td>
                  <td className="px-4 py-2 text-xs">{b.orgs_touched.size}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-text-2">
                    {Array.from(b.endpoints).slice(0, 2).join(', ')}
                    {b.endpoints.size > 2 ? ` +${b.endpoints.size - 2}` : ''}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(b.most_recent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2">Account · Org</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Upstream error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.occurred_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{r.endpoint}</td>
                  <td className="px-4 py-2 text-xs">
                    <div>
                      {orgToAccount[r.org_id]?.account_name ?? '—'}
                    </div>
                    <div className="text-[11px] text-text-3">{r.org_name}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.status_code ?? '—'}</td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    {r.upstream_error?.slice(0, 120) ?? '—'}
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

function StuckBuffersTab({ rows }: { rows: PipelineData['stuckBuffers'] }) {
  const stuckTotal = rows.reduce((acc, r) => acc + (r.stuck_count ?? 0), 0)
  const pill =
    stuckTotal === 0 ? (
      <Pill tone="green">0 stuck (target: 0)</Pill>
    ) : (
      <Pill tone="red">{stuckTotal} stuck rows</Pill>
    )
  return (
    <Card title="Stuck buffer rows by table" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No buffer rows older than 1 hour.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2">Stuck count (&gt;1h)</th>
                <th className="px-4 py-2">Oldest age</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.buffer_table}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    {r.buffer_table}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.stuck_count}</td>
                  <td className="px-4 py-2 text-xs">
                    {formatAge(r.oldest_age_seconds)}
                  </td>
                  <td className="px-4 py-2">
                    <BufferStatus
                      count={r.stuck_count}
                      age={r.oldest_age_seconds}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Any row &gt; 1 hour is a pipeline failure; any row &gt; 24 hours is a P0.
        Amber fires at 30 minutes.
      </footer>
    </Card>
  )
}

function ExpiryQueueTab({
  rows,
  groupBy,
  orgToAccount,
}: {
  rows: PipelineData['expiryQueue']
  groupBy: GroupBy
  orgToAccount: OrgAccountLookup
}) {
  const expiredTotal = rows.reduce(
    (a, r) => a + (r.expired_awaiting_enforce ?? 0),
    0,
  )
  const pill =
    expiredTotal === 0 ? (
      <Pill tone="green">cron healthy</Pill>
    ) : (
      <Pill tone="amber">{expiredTotal} expired rows</Pill>
    )

  const accountRollup = useMemo(() => {
    if (groupBy !== 'account') return null
    const buckets = new Map<
      string,
      {
        account_id: string
        account_name: string
        plan_code: string | null
        orgs_touched: number
        expiring_lt_7d: number
        expiring_lt_30d: number
        expired_awaiting_enforce: number
        most_recent_alert: string | null
      }
    >()
    for (const r of rows) {
      const a = orgToAccount[r.org_id]
      const key = a?.account_id ?? 'unmapped'
      const b = buckets.get(key) ?? {
        account_id: a?.account_id ?? '',
        account_name: a?.account_name ?? '(no account)',
        plan_code: a?.plan_code ?? null,
        orgs_touched: 0,
        expiring_lt_7d: 0,
        expiring_lt_30d: 0,
        expired_awaiting_enforce: 0,
        most_recent_alert: null as string | null,
      }
      b.orgs_touched += 1
      b.expiring_lt_7d += r.expiring_lt_7d ?? 0
      b.expiring_lt_30d += r.expiring_lt_30d ?? 0
      b.expired_awaiting_enforce += r.expired_awaiting_enforce ?? 0
      if (r.last_expiry_alert_at) {
        if (
          !b.most_recent_alert ||
          new Date(r.last_expiry_alert_at) > new Date(b.most_recent_alert)
        ) {
          b.most_recent_alert = r.last_expiry_alert_at
        }
      }
      buckets.set(key, b)
    }
    return Array.from(buckets.values()).sort(
      (x, y) => y.expired_awaiting_enforce - x.expired_awaiting_enforce,
    )
  }, [rows, groupBy, orgToAccount])

  return (
    <Card title="DEPA artefact expiry pipeline" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No orgs with artefacts expiring in the next 30 days.
        </p>
      ) : groupBy === 'account' && accountRollup ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Orgs</th>
                <th className="px-4 py-2">&lt; 7 days</th>
                <th className="px-4 py-2">&lt; 30 days</th>
                <th className="px-4 py-2">Expired awaiting</th>
                <th className="px-4 py-2">Last alert</th>
              </tr>
            </thead>
            <tbody>
              {accountRollup.map((b) => (
                <tr
                  key={b.account_id || 'unmapped'}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2"><strong>{b.account_name}</strong></td>
                  <td className="px-4 py-2 text-xs">{b.plan_code ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{b.orgs_touched}</td>
                  <td className="px-4 py-2 text-xs">{b.expiring_lt_7d}</td>
                  <td className="px-4 py-2 text-xs">{b.expiring_lt_30d}</td>
                  <td className="px-4 py-2 text-xs">{b.expired_awaiting_enforce}</td>
                  <td className="px-4 py-2 text-[11px] text-text-3">
                    {b.most_recent_alert ? relative(b.most_recent_alert) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account · Org</th>
                <th className="px-4 py-2">&lt; 7 days</th>
                <th className="px-4 py-2">&lt; 30 days</th>
                <th className="px-4 py-2">Expired awaiting enforce</th>
                <th className="px-4 py-2">Last expiry alert</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.org_id}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 text-xs">
                    <div>{orgToAccount[r.org_id]?.account_name ?? '—'}</div>
                    <div className="text-[11px] text-text-3">
                      {r.org_name} ·{' '}
                      <span className="font-mono">{r.org_id.slice(0, 8)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">{r.expiring_lt_7d}</td>
                  <td className="px-4 py-2 text-xs">{r.expiring_lt_30d}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.expired_awaiting_enforce}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-3">
                    {r.last_expiry_alert_at
                      ? relative(r.last_expiry_alert_at)
                      : '—'}
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

function DeliveryHealthTab({
  rows,
  groupBy,
  orgToAccount,
}: {
  rows: PipelineData['deliveryHealth']
  groupBy: GroupBy
  orgToAccount: OrgAccountLookup
}) {
  const totalThroughput = rows.reduce((a, r) => a + (r.throughput ?? 0), 0)
  const totalFailures = rows.reduce((a, r) => a + (r.failure_count ?? 0), 0)

  const accountRollup = useMemo(() => {
    if (groupBy !== 'account') return null
    const buckets = new Map<
      string,
      {
        account_id: string
        account_name: string
        plan_code: string | null
        orgs_touched: number
        throughput: number
        failure_count: number
        // Latency is a median — summing across orgs is wrong. Use the
        // worst-case per account for the visualisation (operator cares
        // about the laggiest org in the account).
        worst_median_latency_ms: number | null
        worst_p95_latency_ms: number | null
      }
    >()
    for (const r of rows) {
      const a = orgToAccount[r.org_id]
      const key = a?.account_id ?? 'unmapped'
      const b = buckets.get(key) ?? {
        account_id: a?.account_id ?? '',
        account_name: a?.account_name ?? '(no account)',
        plan_code: a?.plan_code ?? null,
        orgs_touched: 0,
        throughput: 0,
        failure_count: 0,
        worst_median_latency_ms: null as number | null,
        worst_p95_latency_ms: null as number | null,
      }
      b.orgs_touched += 1
      b.throughput += r.throughput ?? 0
      b.failure_count += r.failure_count ?? 0
      if (r.median_latency_ms != null) {
        b.worst_median_latency_ms = Math.max(
          b.worst_median_latency_ms ?? 0,
          r.median_latency_ms,
        )
      }
      if (r.p95_latency_ms != null) {
        b.worst_p95_latency_ms = Math.max(
          b.worst_p95_latency_ms ?? 0,
          r.p95_latency_ms,
        )
      }
      buckets.set(key, b)
    }
    return Array.from(buckets.values()).sort(
      (x, y) => y.throughput - x.throughput,
    )
  }, [rows, groupBy, orgToAccount])

  return (
    <Card
      title="Delivery health (last 24h)"
      pill={
        totalFailures === 0 ? (
          <Pill tone="green">healthy</Pill>
        ) : (
          <Pill tone="amber">{totalFailures} failures</Pill>
        )
      }
    >
      <div className="grid grid-cols-3 gap-3 p-4">
        <MetricTile
          label="Total throughput"
          value={totalThroughput.toLocaleString()}
          delta="consent events delivered"
        />
        <MetricTile
          label="Total failures"
          value={totalFailures.toLocaleString()}
        />
        <MetricTile
          label={groupBy === 'account' ? 'Accounts with activity' : 'Orgs with activity'}
          value={
            groupBy === 'account' && accountRollup
              ? accountRollup.length.toString()
              : rows.length.toString()
          }
        />
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No delivery activity in the last 24 hours.
        </p>
      ) : groupBy === 'account' && accountRollup ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account</th>
                <th className="px-4 py-2">Plan</th>
                <th className="px-4 py-2">Orgs</th>
                <th className="px-4 py-2">Worst median</th>
                <th className="px-4 py-2">Worst p95</th>
                <th className="px-4 py-2">Failures (24h)</th>
                <th className="px-4 py-2">Throughput (24h)</th>
              </tr>
            </thead>
            <tbody>
              {accountRollup.map((b) => (
                <tr
                  key={b.account_id || 'unmapped'}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2"><strong>{b.account_name}</strong></td>
                  <td className="px-4 py-2 text-xs">{b.plan_code ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{b.orgs_touched}</td>
                  <td className="px-4 py-2 text-xs">
                    {b.worst_median_latency_ms != null
                      ? `${b.worst_median_latency_ms} ms`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {b.worst_p95_latency_ms != null
                      ? `${b.worst_p95_latency_ms} ms`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">{b.failure_count}</td>
                  <td className="px-4 py-2 text-xs">
                    {b.throughput.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Account · Org</th>
                <th className="px-4 py-2">Median latency</th>
                <th className="px-4 py-2">P95 latency</th>
                <th className="px-4 py-2">Failures (24h)</th>
                <th className="px-4 py-2">Throughput (24h)</th>
                <th className="px-4 py-2">Success</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.org_id}
                  className="border-t border-[color:var(--border)]"
                >
                  <td className="px-4 py-2 text-xs">
                    <div>{orgToAccount[r.org_id]?.account_name ?? '—'}</div>
                    <div className="text-[11px] text-text-3">{r.org_name}</div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.median_latency_ms != null
                      ? `${r.median_latency_ms} ms`
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.p95_latency_ms != null ? `${r.p95_latency_ms} ms` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.failure_count}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.throughput.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.success_rate != null ? `${r.success_rate}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Latency is read from <code>audit_log.payload.latency_ms</code> when
        present. Upstream writers populate it best-effort.
      </footer>
    </Card>
  )
}

function MetricTile({
  label,
  value,
  delta,
}: {
  label: string
  value: string
  delta?: string
}) {
  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-text">{value}</p>
      {delta ? <p className="text-[11px] text-text-3">{delta}</p> : null}
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red'
  children: React.ReactNode
}) {
  const classes =
    tone === 'green'
      ? 'rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700'
      : tone === 'amber'
        ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800'
        : 'rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700'
  return <span className={classes}>{children}</span>
}

function BufferStatus({
  count,
  age,
}: {
  count: number
  age: number | null
}) {
  if (count === 0) return <Pill tone="green">OK</Pill>
  const ageSec = age ?? 0
  if (ageSec > 86_400) return <Pill tone="red">P0 (&gt;24h)</Pill>
  if (ageSec > 3600) return <Pill tone="red">failure (&gt;1h)</Pill>
  if (ageSec > 1800) return <Pill tone="amber">warn (&gt;30m)</Pill>
  return <Pill tone="green">OK</Pill>
}

function formatAge(seconds: number | null) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(iso).toLocaleString()
}
