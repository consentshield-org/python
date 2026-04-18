import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArtefactFilters } from './filters'

const PAGE_SIZE = 50

interface SearchParamsRaw {
  status?: string
  framework?: string
  purpose?: string
  expiring?: string
  page?: string
}

export default async function ArtefactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRaw>
}) {
  const raw = await searchParams
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  // KPI counts in parallel.
  const now = new Date()
  const in30Days = new Date(now.getTime() + 30 * 86_400_000).toISOString()
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()

  const [activeRes, expiringRes, revokedRes, replacedRes, purposesRes] = await Promise.all([
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .lt('expires_at', in30Days),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'revoked')
      .gte('updated_at', weekAgo),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'replaced')
      .gte('updated_at', weekAgo),
    supabase
      .from('purpose_definitions')
      .select('purpose_code, display_name')
      .eq('is_active', true)
      .order('purpose_code'),
  ])

  // Filtered list.
  const page = Math.max(1, Number(raw.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  let listQuery = supabase
    .from('consent_artefacts')
    .select(
      'id, artefact_id, purpose_code, framework, status, expires_at, created_at, data_scope',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (raw.status && ['active', 'replaced', 'revoked', 'expired'].includes(raw.status)) {
    listQuery = listQuery.eq('status', raw.status)
  }
  if (raw.framework && ['dpdp', 'abdm', 'gdpr'].includes(raw.framework)) {
    listQuery = listQuery.eq('framework', raw.framework)
  }
  if (raw.purpose) {
    listQuery = listQuery.eq('purpose_code', raw.purpose)
  }
  if (raw.expiring === '30') {
    listQuery = listQuery.lt('expires_at', in30Days).eq('status', 'active')
  }

  const { data: artefacts, count: totalCount } = await listQuery

  // ADR-0037 V2-D3 — CSV export link preserving current filters.
  const csvParams = new URLSearchParams()
  if (raw.status) csvParams.set('status', raw.status)
  if (raw.framework) csvParams.set('framework', raw.framework)
  if (raw.purpose) csvParams.set('purpose', raw.purpose)
  if (raw.expiring) csvParams.set('expiring', raw.expiring)
  const csvHref = `/api/orgs/${membership.org_id}/artefacts.csv${
    csvParams.toString() ? `?${csvParams.toString()}` : ''
  }`

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Consent Artefacts</h1>
          <p className="text-sm text-gray-600">
            Per-purpose consent records. Every consent event produces one artefact per accepted
            purpose; revocation and expiry flow through the ADR-0022/0023 pipelines.
          </p>
        </div>
        <a
          href={csvHref}
          className="shrink-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Export CSV
        </a>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Active" value={activeRes.count ?? 0} tone="green" />
        <KpiCard
          label="Expiring < 30 days"
          value={expiringRes.count ?? 0}
          tone="amber"
          href="/dashboard/artefacts?expiring=30"
        />
        <KpiCard
          label="Revoked this week"
          value={revokedRes.count ?? 0}
          tone="red"
          href="/dashboard/artefacts?status=revoked"
        />
        <KpiCard
          label="Replaced this week"
          value={replacedRes.count ?? 0}
          tone="gray"
          href="/dashboard/artefacts?status=replaced"
        />
      </div>

      <ArtefactFilters
        activeStatus={raw.status ?? ''}
        activeFramework={raw.framework ?? ''}
        activePurpose={raw.purpose ?? ''}
        expiring={raw.expiring ?? ''}
        purposes={purposesRes.data ?? []}
      />

      <section className="rounded border border-gray-200">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <div>
            Showing {artefacts?.length ?? 0} of {totalCount ?? 0}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(raw, page - 1)}
                className="text-gray-700 hover:underline"
              >
                ← Prev
              </Link>
            ) : null}
            {totalCount !== null && offset + PAGE_SIZE < (totalCount ?? 0) ? (
              <Link
                href={buildPageHref(raw, page + 1)}
                className="text-gray-700 hover:underline"
              >
                Next →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Artefact</th>
                <th className="px-3 py-2">Purpose</th>
                <th className="px-3 py-2">Framework</th>
                <th className="px-3 py-2">Data scope</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(artefacts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                    No artefacts match the filters.
                  </td>
                </tr>
              ) : (
                (artefacts ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {a.artefact_id.slice(0, 20)}…
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{a.purpose_code}</td>
                    <td className="px-3 py-2 uppercase text-xs">{a.framework}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {((a.data_scope as string[]) ?? []).map((d) => (
                          <span
                            key={d}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-xs">
                      {a.expires_at
                        ? new Date(a.expires_at).toLocaleDateString()
                        : '∞'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/dashboard/artefacts/${a.artefact_id}`}
                        className="text-xs text-gray-600 hover:text-black"
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function KpiCard({
  label,
  value,
  tone,
  href,
}: {
  label: string
  value: number
  tone: 'green' | 'amber' | 'red' | 'gray'
  href?: string
}) {
  const color =
    tone === 'green'
      ? 'text-green-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : tone === 'red'
          ? 'text-red-700'
          : 'text-gray-700'
  const content = (
    <div className="rounded border border-gray-200 p-4">
      <p className="text-xs text-gray-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  )
  return href ? (
    <Link href={href} className="block hover:bg-gray-50">
      {content}
    </Link>
  ) : (
    content
  )
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'active'
      ? 'bg-green-50 text-green-700'
      : status === 'revoked'
        ? 'bg-red-50 text-red-700'
        : status === 'expired'
          ? 'bg-gray-100 text-gray-700'
          : 'bg-amber-50 text-amber-700'
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${classes}`}>{status}</span>
  )
}

function buildPageHref(raw: SearchParamsRaw, page: number): string {
  const params = new URLSearchParams()
  if (raw.status) params.set('status', raw.status)
  if (raw.framework) params.set('framework', raw.framework)
  if (raw.purpose) params.set('purpose', raw.purpose)
  if (raw.expiring) params.set('expiring', raw.expiring)
  params.set('page', String(page))
  return `/dashboard/artefacts?${params.toString()}`
}
