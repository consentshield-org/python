import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  computeComplianceScore,
  daysUntilEnforcement,
  isoSinceHours,
  nowIso,
} from '@consentshield/compliance'
import { ScoreGauge } from './score-gauge'

export default async function DashboardPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="flex-1 p-8">
        <p className="text-sm text-gray-600">No organisation found. Complete signup.</p>
      </main>
    )
  }

  // ADR-0044 Phase 0 — plan lives on accounts, joined via organisations.account_id.
  const { data: orgRaw } = await supabase
    .from('organisations')
    .select('name, storage_mode, accounts(plan_code)')
    .eq('id', membership.org_id)
    .single()
  const org = orgRaw as
    | { name: string; storage_mode: string; accounts: { plan_code: string } | null }
    | null

  // Parallel data fetches
  const since = isoSinceHours(24)
  const [
    propertiesRes,
    activeBannersRes,
    consentEventsRes,
    inventoryRes,
    rightsRes,
    overdueRightsRes,
    trackerViolationsRes,
    recentEventsRes,
    depaCachedRes,
    activeArtefactsRes,
    expiringArtefactsRes,
    revokedArtefactsRes,
  ] = await Promise.all([
    supabase
      .from('web_properties')
      .select('id, snippet_verified_at', { count: 'exact', head: false }),
    supabase
      .from('consent_banners')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('consent_events')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since),
    supabase.from('data_inventory').select('id', { count: 'exact', head: true }),
    supabase
      .from('rights_requests')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'in_progress']),
    supabase
      .from('rights_requests')
      .select('id', { count: 'exact', head: true })
      .lt('sla_deadline', nowIso())
      .neq('status', 'completed'),
    supabase
      .from('tracker_observations')
      .select('id', { count: 'exact', head: true })
      .neq('violations', '[]')
      .gte('created_at', since),
    supabase
      .from('consent_events')
      .select('event_type, purposes_accepted, purposes_rejected, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('depa_compliance_metrics')
      .select('total_score, coverage_score, expiry_score, freshness_score, revocation_score, computed_at')
      .eq('org_id', membership.org_id)
      .maybeSingle(),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      // eslint-disable-next-line react-hooks/purity -- Server Component: Date.now() is intentional.
      .lt('expires_at', new Date(Date.now() + 30 * 86_400_000).toISOString()),
    supabase
      .from('consent_artefacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'revoked')
      .gte('updated_at', isoSinceHours(168)),
  ])

  const properties = propertiesRes.data ?? []
  const verifiedProperties = properties.filter((p) => p.snippet_verified_at).length
  const activeProperties = properties.length

  const score = computeComplianceScore({
    hasActiveBanner: (activeBannersRes.count ?? 0) > 0,
    hasVerifiedSnippet: verifiedProperties > 0,
    consentEventsLast24h: consentEventsRes.count ?? 0,
    hasDataInventory: (inventoryRes.count ?? 0) > 0,
    pendingRightsRequests: rightsRes.count ?? 0,
    overdueRightsRequests: overdueRightsRes.count ?? 0,
    trackerViolationsLast24h: trackerViolationsRes.count ?? 0,
  })

  const enforcementDays = daysUntilEnforcement()
  const recentEvents = recentEventsRes.data ?? []

  // DEPA score (ADR-0025) — prefer cached row; fall back to a fresh compute
  // if the nightly refresh hasn't run yet for this org.
  interface DepaScore {
    total: number
    coverage_score: number
    expiry_score: number
    freshness_score: number
    revocation_score: number
    computed_at: string | null
    stale: boolean
  }
  let depa: DepaScore
  if (depaCachedRes.data) {
    const d = depaCachedRes.data
    // eslint-disable-next-line react-hooks/purity -- Server Component: Date.now() is intentional.
    const ageHours = (Date.now() - new Date(d.computed_at).getTime()) / 3_600_000
    depa = {
      total: Number(d.total_score),
      coverage_score: Number(d.coverage_score),
      expiry_score: Number(d.expiry_score),
      freshness_score: Number(d.freshness_score),
      revocation_score: Number(d.revocation_score),
      computed_at: d.computed_at,
      stale: ageHours > 25,
    }
  } else {
    const { data: fresh } = await supabase.rpc('compute_depa_score', {
      p_org_id: membership.org_id,
    })
    const f = (fresh ?? {}) as Record<string, unknown>
    depa = {
      total: Number(f.total ?? 0),
      coverage_score: Number(f.coverage_score ?? 0),
      expiry_score: Number(f.expiry_score ?? 0),
      freshness_score: Number(f.freshness_score ?? 0),
      revocation_score: Number(f.revocation_score ?? 0),
      computed_at: null,
      stale: true,
    }
  }
  const depaPercent = Math.round((depa.total / 20) * 100)
  const depaLevel: 'red' | 'amber' | 'green' =
    depa.total >= 15 ? 'green' : depa.total >= 10 ? 'amber' : 'red'

  return (
    <main className="flex-1 p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">{org?.name ?? 'Dashboard'}</h1>
        <p className="text-sm text-gray-600">
          {org?.accounts?.plan_code ?? 'trial'} plan · {membership.role} · storage: {org?.storage_mode}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compliance scores */}
        <section className="lg:col-span-2 rounded border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-600 mb-4">Compliance Scores</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* DPDP */}
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <ScoreGauge score={score.total} level={score.level} />
                <p className="mt-2 text-xs font-medium text-gray-700">DPDP</p>
              </div>
              <div className="flex-1 space-y-1.5 text-sm">
                <ScoreRow label="Consent infrastructure" value={score.components.consent_infrastructure} max={20} />
                <ScoreRow label="Consent enforcement" value={score.components.consent_enforcement} max={30} />
                <ScoreRow label="Rights workflow" value={score.components.rights} max={15} />
                <ScoreRow label="Data lifecycle" value={score.components.data_lifecycle} max={15} />
                <ScoreRow label="Security posture" value={score.components.security} max={10} />
                <ScoreRow label="Audit readiness" value={score.components.audit_readiness} max={10} />
              </div>
            </div>

            {/* DEPA (ADR-0025) */}
            <div className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <ScoreGauge score={depaPercent} level={depaLevel} />
                <p className="mt-2 text-xs font-medium text-gray-700">DEPA</p>
              </div>
              <div className="flex-1 space-y-1.5 text-sm">
                <ScoreRow label="Coverage" value={depa.coverage_score} max={5} />
                <ScoreRow label="Expiry" value={depa.expiry_score} max={5} />
                <ScoreRow label="Freshness" value={depa.freshness_score} max={5} />
                <ScoreRow label="Revocation" value={depa.revocation_score} max={5} />
                <p className="pt-1 text-[10px] text-gray-500">
                  {depa.computed_at
                    ? `Refreshed ${new Date(depa.computed_at).toLocaleDateString()}${depa.stale ? ' · stale' : ''}`
                    : 'Computed on demand · nightly refresh pending'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Enforcement clock */}
        <section className="rounded border border-gray-200 p-6 bg-gradient-to-br from-amber-50 to-orange-50">
          <h2 className="text-sm font-medium text-gray-600">DPDP Enforcement</h2>
          <p className="mt-2 text-4xl font-bold">{enforcementDays}</p>
          <p className="text-sm text-gray-600">days until full enforcement</p>
          <p className="mt-3 text-xs text-gray-500">13 May 2027 · ₹250 crore per violation</p>
        </section>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat label="Active properties" value={activeProperties} />
        <Stat label="Snippets verified" value={verifiedProperties} />
        <Stat
          label="Consents (24h)"
          value={consentEventsRes.count ?? 0}
        />
        <Stat
          label="Pending rights"
          value={rightsRes.count ?? 0}
          highlight={(overdueRightsRes.count ?? 0) > 0 ? 'red' : undefined}
        />
        <Link
          href="/dashboard/artefacts"
          className="rounded border border-gray-200 p-4 hover:bg-gray-50"
        >
          <p className="text-xs text-gray-600">
            Consent Artefacts{' '}
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
              DEPA
            </span>
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-green-700">
            {activeArtefactsRes.count ?? 0}
          </p>
          <p className="text-[10px] text-gray-500">
            {expiringArtefactsRes.count ?? 0} expiring 30d · {revokedArtefactsRes.count ?? 0} revoked 7d
          </p>
        </Link>
      </div>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Recent Consent Events</h2>
          <p className="text-xs text-gray-500">Last 10 events from your buffer</p>
        </div>
        {recentEvents.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Accepted</th>
                <th className="px-4 py-2 font-medium">Rejected</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((e, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="px-4 py-2">
                    <EventBadge type={e.event_type} />
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {(e.purposes_accepted as string[]).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600">
                    {(e.purposes_rejected as string[]).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No consent events yet. Deploy a banner to start collecting.
          </p>
        )}
      </section>
    </main>
  )
}

function ScoreRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100
  return (
    <div className="flex items-center gap-3">
      <span className="w-44 text-gray-600">{label}</span>
      <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
        <div
          className="h-full bg-black"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-16 text-right tabular-nums">
        {value} / {max}
      </span>
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number
  highlight?: 'red' | 'amber'
}) {
  const color =
    highlight === 'red'
      ? 'text-red-600'
      : highlight === 'amber'
        ? 'text-amber-600'
        : 'text-black'
  return (
    <div className="rounded border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

function EventBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    consent_given: 'bg-green-100 text-green-700',
    consent_withdrawn: 'bg-red-100 text-red-700',
    purpose_updated: 'bg-blue-100 text-blue-700',
    banner_dismissed: 'bg-gray-100 text-gray-700',
  }
  const cls = styles[type] || 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{type}</span>
  )
}
