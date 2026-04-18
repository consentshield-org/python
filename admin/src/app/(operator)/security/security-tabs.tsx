'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ModalShell,
  ReasonField,
  FormFooter,
  Field,
} from '@/components/common/modal-form'
import { blockIp, unblockIp } from './actions'

// ADR-0033 Sprint 2.2 — Security tabs (client).

export interface SecurityData {
  rateLimit: Array<{
    occurred_at: string
    endpoint: string
    ip: string
    org_id: string | null
    hit_count: number
  }>
  hmacFailures: Array<WorkerRow>
  originFailures: Array<WorkerRow>
  blockedIps: Array<{
    id: string
    ip_cidr: string
    reason: string
    blocked_by: string | null
    blocked_by_display_name: string | null
    blocked_at: string
    expires_at: string | null
  }>
  sentryEvents: Array<{
    id: string
    sentry_id: string
    project_slug: string
    level: 'fatal' | 'error' | 'warning' | 'info' | 'debug'
    title: string
    culprit: string | null
    event_url: string | null
    user_count: number
    received_at: string
  }>
}

interface WorkerRow {
  id: string
  occurred_at: string
  endpoint: string
  status_code: number | null
  upstream_error: string | null
  org_id: string
  org_name: string
}

type TabKey = 'rate' | 'hmac' | 'origin' | 'sentry' | 'blocked'

export function SecurityTabs({
  data,
  canWrite,
  sentryOrg,
}: {
  data: SecurityData
  canWrite: boolean
  sentryOrg: string
}) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('rate')
  const [modal, setModal] = useState<null | { kind: 'block' } | { kind: 'unblock'; id: string; cidr: string }>(null)

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000)
    return () => clearInterval(id)
  }, [router])

  const tabs: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'rate', label: 'Rate-limit triggers', count: data.rateLimit.length },
    { key: 'hmac', label: 'HMAC failures', count: data.hmacFailures.length },
    { key: 'origin', label: 'Origin failures', count: data.originFailures.length },
    { key: 'sentry', label: 'Sentry escalations', count: data.sentryEvents.length },
    { key: 'blocked', label: 'Blocked IPs', count: data.blockedIps.length },
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

      {tab === 'rate' ? <RateLimitTab rows={data.rateLimit} /> : null}
      {tab === 'hmac' ? (
        <WorkerReasonsTab
          title="Worker HMAC verification failures"
          rows={data.hmacFailures}
          emptyHelp="No HMAC failures in the last 24 hours. Note: the Worker currently returns 403 early on HMAC failure without writing to worker_errors — a follow-up sprint will wire that log path."
        />
      ) : null}
      {tab === 'origin' ? (
        <WorkerReasonsTab
          title="Worker origin validation failures"
          rows={data.originFailures}
          emptyHelp="No origin validation failures in the last 24 hours. Same logging caveat as HMAC — origin failures aren't written to worker_errors yet."
        />
      ) : null}
      {tab === 'sentry' ? (
        <SentryTab rows={data.sentryEvents} sentryOrg={sentryOrg} />
      ) : null}
      {tab === 'blocked' ? (
        <BlockedIpsTab
          rows={data.blockedIps}
          canWrite={canWrite}
          onBlock={() => setModal({ kind: 'block' })}
          onUnblock={(id, cidr) => setModal({ kind: 'unblock', id, cidr })}
        />
      ) : null}

      {modal?.kind === 'block' ? (
        <BlockIpModal onClose={() => setModal(null)} />
      ) : null}
      {modal?.kind === 'unblock' ? (
        <UnblockIpModal
          blockId={modal.id}
          cidr={modal.cidr}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  )
}

function Card({
  title,
  pill,
  children,
  action,
}: {
  title: string
  pill?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
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
    </section>
  )
}

function RateLimitTab({ rows }: { rows: SecurityData['rateLimit'] }) {
  const pill =
    rows.length === 0 ? (
      <Pill tone="green">0 in window</Pill>
    ) : (
      <Pill tone="amber">{rows.length} IP/endpoint pair(s)</Pill>
    )
  return (
    <Card title="Rate-limit triggers (last 24h)" pill={pill}>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">
          No rate-limit denials in the last 24 hours. Hits from the public
          rights-request routes populate here via <code>public.rate_limit_events</code>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Latest hit</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Total hits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {relative(r.occurred_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {r.endpoint}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">{r.ip}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.org_id?.slice(0, 8) ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.hit_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function WorkerReasonsTab({
  title,
  rows,
  emptyHelp,
}: {
  title: string
  rows: WorkerRow[]
  emptyHelp: string
}) {
  const pill =
    rows.length === 0 ? (
      <Pill tone="green">0 in window</Pill>
    ) : (
      <Pill tone="amber">{rows.length} events</Pill>
    )
  return (
    <Card title={title} pill={pill}>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">{emptyHelp}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Endpoint</th>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.occurred_at)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {r.endpoint}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.org_name}</td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    {r.upstream_error?.slice(0, 160) ?? '—'}
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

function SentryTab({
  rows,
  sentryOrg,
}: {
  rows: SecurityData['sentryEvents']
  sentryOrg: string
}) {
  const appUrl = sentryOrg
    ? `https://${sentryOrg}.sentry.io/issues/?project=consentshield-app&query=level%3Aerror+or+level%3Afatal`
    : null
  const adminUrl = sentryOrg
    ? `https://${sentryOrg}.sentry.io/issues/?project=consentshield-admin&query=level%3Aerror+or+level%3Afatal`
    : null

  const pill =
    rows.length === 0 ? (
      <Pill tone="green">0 in window</Pill>
    ) : (
      <Pill tone="amber">{rows.length} events</Pill>
    )

  return (
    <Card
      title="Sentry escalations (last 24h)"
      pill={pill}
      action={
        <div className="flex gap-2">
          {appUrl ? (
            <a
              href={appUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg"
            >
              app ↗
            </a>
          ) : null}
          {adminUrl ? (
            <a
              href={adminUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg"
            >
              admin ↗
            </a>
          ) : null}
        </div>
      }
    >
      {!sentryOrg ? (
        <p className="m-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Set <code>NEXT_PUBLIC_SENTRY_ORG</code> on the admin Vercel project
          to enable per-row deep-links.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-text-3">
          No Sentry events ≥ warning received in the last 24 hours. Events
          arrive via the internal-integration webhook — see{' '}
          <code>docs/ops/sentry-webhook-setup.md</code> if the integration
          isn&rsquo;t wired yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Received</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Users</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                    {relative(r.received_at)}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.project_slug}</td>
                  <td className="px-4 py-2">
                    <LevelPill level={r.level} />
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    <div className="font-medium text-text-1">{r.title}</div>
                    {r.culprit ? (
                      <div className="mt-0.5 font-mono text-[10px] text-text-3">
                        {r.culprit}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-xs">{r.user_count}</td>
                  <td className="px-4 py-2 text-right">
                    {r.event_url ? (
                      <a
                        href={r.event_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-xs text-red-700 hover:underline"
                      >
                        Open ↗
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
  )
}

function LevelPill({
  level,
}: {
  level: SecurityData['sentryEvents'][number]['level']
}) {
  // info/debug are filtered at the webhook route and never reach here;
  // the fallback amber matches warning.
  const tone: 'red' | 'amber' | 'green' =
    level === 'fatal' || level === 'error' ? 'red' : 'amber'
  return <Pill tone={tone}>{level}</Pill>
}

function BlockedIpsTab({
  rows,
  canWrite,
  onBlock,
  onUnblock,
}: {
  rows: SecurityData['blockedIps']
  canWrite: boolean
  onBlock: () => void
  onUnblock: (id: string, cidr: string) => void
}) {
  return (
    <Card
      title="Blocked IPs (global)"
      pill={<Pill tone="amber">{rows.length} active</Pill>}
      action={
        <button
          type="button"
          onClick={onBlock}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator role required'}
          className="rounded bg-admin-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Block IP
        </button>
      }
    >
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No active blocks.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">IP / range</th>
                <th className="px-4 py-2">Blocked since</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2">Blocked by</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-xs">{b.ip_cidr}</td>
                  <td className="px-4 py-2 text-xs">
                    {new Date(b.blocked_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {b.expires_at
                      ? new Date(b.expires_at).toLocaleString()
                      : 'permanent'}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-text-2">
                    {b.reason}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {b.blocked_by_display_name ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onUnblock(b.id, b.ip_cidr)}
                      disabled={!canWrite}
                      className="rounded border border-[color:var(--border-mid)] bg-white px-2.5 py-1 text-[11px] hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-text-3">
        Worker enforcement lands in Sprint 2.3 — blocks here populate the DB
        but don&apos;t yet filter Worker traffic.
      </footer>
    </Card>
  )
}

function BlockIpModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [cidr, setCidr] = useState('')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = cidr.trim().length > 0 && reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await blockIp({ ipCidr: cidr, reason, expiresAt })
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
      title="Block IP / CIDR"
      subtitle="Takes effect after Worker enforcement ships (Sprint 2.3). Until then, entries are tracked but not enforced."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="IP or CIDR">
          <input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            placeholder="49.36.12.0/24"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
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
          submit="Block"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function UnblockIpModal({
  blockId,
  cidr,
  onClose,
}: {
  blockId: string
  cidr: string
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
    const r = await unblockIp({ blockId, reason })
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
      title={`Unblock ${cidr}`}
      subtitle="Reason is audit-logged."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Unblock"
          disabled={!ok}
        />
      </form>
    </ModalShell>
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

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(iso).toLocaleString()
}
