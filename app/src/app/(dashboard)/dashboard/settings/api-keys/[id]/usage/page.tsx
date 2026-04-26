import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface UsageRow {
  day: string
  request_count: number
  p50_ms: number | null
  p95_ms: number | null
}

function BarChart({ rows, maxCount }: { rows: UsageRow[]; maxCount: number }) {
  const BAR_H = 120
  return (
    <div className="flex items-end gap-2">
      {rows.map((r) => {
        const pct = maxCount > 0 ? r.request_count / maxCount : 0
        const barH = Math.max(2, Math.round(pct * BAR_H))
        const label = new Date(r.day).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
        return (
          <div key={r.day} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-700">{r.request_count}</span>
            <div
              className="w-full rounded-t bg-blue-500"
              style={{ height: barH }}
              title={`${r.request_count} requests`}
            />
            <span className="text-[10px] text-gray-400 whitespace-nowrap">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

export default async function ApiKeyUsagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch key metadata
  const { data: key } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, is_active, rate_tier, account_id')
    .eq('id', id)
    .maybeSingle()

  if (!key) notFound()

  // Verify caller is account_owner
  const { data: accountRole } = await supabase.rpc('current_account_role')
  if (accountRole !== 'account_owner') redirect('/dashboard/settings/api-keys')

  // Fetch 7-day usage
  const { data: usageRaw } = await supabase.rpc('rpc_api_key_usage', {
    p_key_id: id,
    p_days: 7,
  })

  const usage: UsageRow[] = (usageRaw ?? []) as UsageRow[]
  const maxCount = Math.max(1, ...usage.map((r) => r.request_count))
  const total7d = usage.reduce((s, r) => s + r.request_count, 0)
  const lastP50 = usage.length > 0 ? usage[usage.length - 1].p50_ms : null
  const lastP95 = usage.length > 0 ? usage[usage.length - 1].p95_ms : null

  return (
    <main className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link
          href="/dashboard/settings/api-keys"
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          ← API keys
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-2xl font-bold">{key.name}</h1>
        <div className="mt-1 flex items-center gap-3">
          <span className="font-mono text-xs text-gray-500">{key.key_prefix}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              key.is_active
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {key.is_active ? 'Active' : 'Revoked'}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
            {key.rate_tier}
          </span>
        </div>
      </header>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-1 text-xs font-medium text-gray-500">Requests (7d)</div>
          <div className="text-2xl font-semibold">{total7d.toLocaleString('en-IN')}</div>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-1 text-xs font-medium text-gray-500">p50 latency (today)</div>
          <div className="text-2xl font-semibold">
            {lastP50 != null ? `${lastP50} ms` : '—'}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="mb-1 text-xs font-medium text-gray-500">p95 latency (today)</div>
          <div className="text-2xl font-semibold">
            {lastP95 != null ? `${lastP95} ms` : '—'}
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="mb-6 rounded-lg border border-gray-200 p-5">
        <div className="mb-4 text-sm font-medium">Daily requests — last 7 days</div>
        {usage.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No requests recorded yet. Call{' '}
            <code className="rounded bg-gray-100 px-1 font-mono text-xs">GET /v1/_ping</code>{' '}
            with this key to see usage here.
          </p>
        ) : (
          <div className="pt-2">
            <BarChart rows={usage} maxCount={maxCount} />
          </div>
        )}
      </div>

      {/* Day-by-day table */}
      {usage.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-100 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Day</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">Requests</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">p50 ms</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500">p95 ms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 bg-white">
              {usage.map((r) => (
                <tr key={r.day}>
                  <td className="px-4 py-2.5 text-xs text-gray-700">
                    {new Date(r.day).toLocaleDateString('en-IN', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium">
                    {r.request_count.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                    {r.p50_ms != null ? r.p50_ms : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                    {r.p95_ms != null ? r.p95_ms : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
