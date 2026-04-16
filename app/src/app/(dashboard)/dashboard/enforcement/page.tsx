import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isoSinceHours } from '@consentshield/compliance'

interface Violation {
  slug: string
  category: string
  required_purpose: string
  url: string
}

interface TrackerDetection {
  slug: string
  category: string
  functional: boolean
  url: string
}

interface ObservationRow {
  id: string
  property_id: string
  consent_state: Record<string, boolean>
  trackers_detected: TrackerDetection[]
  violations: Violation[]
  page_url_hash: string | null
  observed_at: string
}

export default async function EnforcementPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
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

  const since7d = isoSinceHours(24 * 7)
  const since24h = isoSinceHours(24)

  const [observationsRes, violations7dRes, properties, scansRes, probesRes, probeRunsRes] = await Promise.all([
    supabase
      .from('tracker_observations')
      .select('id, property_id, consent_state, trackers_detected, violations, page_url_hash, observed_at')
      .gte('observed_at', since24h)
      .order('observed_at', { ascending: false })
      .limit(50),
    supabase
      .from('tracker_observations')
      .select('violations, observed_at')
      .gte('observed_at', since7d),
    supabase.from('web_properties').select('id, name, url'),
    supabase
      .from('security_scans')
      .select('property_id, scan_type, severity, signal_key, details, remediation, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(500),
    supabase
      .from('consent_probes')
      .select('id, property_id, probe_type, consent_state, schedule, is_active, last_run_at, last_result')
      .eq('is_active', true),
    supabase
      .from('consent_probe_runs')
      .select('probe_id, status, trackers_detected, violations, run_at')
      .order('run_at', { ascending: false })
      .limit(200),
  ])

  const observations = (observationsRes.data ?? []) as ObservationRow[]
  const allViolationsWindow = (violations7dRes.data ?? []) as {
    violations: Violation[]
    observed_at: string
  }[]

  const propertyRows = (properties.data ?? []) as Array<{ id: string; name: string; url: string }>
  const propertyMap = new Map(propertyRows.map((p) => [p.id, p.name]))

  interface ScanRow {
    property_id: string
    scan_type: string
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical'
    signal_key: string
    details: Record<string, unknown> | null
    remediation: string | null
    scanned_at: string
  }
  interface ProbeRow {
    id: string
    property_id: string
    probe_type: string
    consent_state: Record<string, boolean>
    schedule: string
    is_active: boolean
    last_run_at: string | null
    last_result: { status?: string; trackers?: number; violations?: number; url?: string } | null
  }
  interface ProbeRunRow {
    probe_id: string
    status: string
    trackers_detected: unknown[]
    violations: unknown[]
    run_at: string
  }
  const probes = (probesRes.data ?? []) as ProbeRow[]
  const probeRuns = (probeRunsRes.data ?? []) as ProbeRunRow[]
  const latestRunByProbe = new Map<string, ProbeRunRow>()
  for (const run of probeRuns) {
    if (!latestRunByProbe.has(run.probe_id)) latestRunByProbe.set(run.probe_id, run)
  }

  const scans = (scansRes.data ?? []) as ScanRow[]
  const latestScanAt = scans.length > 0 ? scans[0].scanned_at : null
  // Most-recent scan batch per property (group by scanned_at bucket per property).
  const latestScansByProperty = new Map<string, ScanRow[]>()
  for (const scan of scans) {
    if (!latestScansByProperty.has(scan.property_id)) {
      latestScansByProperty.set(scan.property_id, [scan])
    } else {
      const existing = latestScansByProperty.get(scan.property_id)!
      if (existing[0].scanned_at === scan.scanned_at) existing.push(scan)
    }
  }

  // Aggregate violations by slug
  const byTracker = new Map<string, { slug: string; count: number; category: string }>()
  for (const o of observations) {
    for (const v of o.violations) {
      const existing = byTracker.get(v.slug)
      if (existing) existing.count++
      else byTracker.set(v.slug, { slug: v.slug, count: 1, category: v.category })
    }
  }
  const violationAgg = Array.from(byTracker.values()).sort((a, b) => b.count - a.count)

  // Aggregate cross-border: count trackers by detected domain
  const detectedByCategory: Record<string, number> = { a: 0, m: 0, p: 0, f: 0 }
  for (const o of observations) {
    for (const t of o.trackers_detected) {
      detectedByCategory[t.category] = (detectedByCategory[t.category] ?? 0) + 1
    }
  }

  const totalViolationsLast24h = observations.reduce((sum, o) => sum + o.violations.length, 0)
  const totalViolationsLast7d = allViolationsWindow.reduce(
    (sum, o) => sum + (o.violations?.length ?? 0),
    0,
  )

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Enforcement Monitor</h1>
        <p className="text-sm text-gray-600">
          What actually loads on your customers&rsquo; browsers after consent — compared against their
          decisions.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Violations (24h)" value={totalViolationsLast24h} highlight={totalViolationsLast24h > 0 ? 'red' : undefined} />
        <Stat label="Violations (7d)" value={totalViolationsLast7d} />
        <Stat label="Observations (24h)" value={observations.length} />
        <Stat label="Unique trackers" value={new Set(observations.flatMap(o => o.trackers_detected.map(t => t.slug))).size} />
      </div>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Top Violations (last 24h)</h2>
          <p className="text-xs text-gray-500">
            Trackers that loaded without matching consent. Functional services are never flagged.
          </p>
        </div>
        {violationAgg.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Tracker</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {violationAgg.map((v) => (
                <tr key={v.slug} className="border-t border-gray-200">
                  <td className="px-4 py-2 font-mono text-xs">{v.slug}</td>
                  <td className="px-4 py-2">
                    <CategoryBadge code={v.category} />
                  </td>
                  <td className="px-4 py-2 font-medium">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-green-700">
            ✓ No violations in the last 24 hours.
          </p>
        )}
      </section>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Recent Observations</h2>
          <p className="text-xs text-gray-500">Last 50 observations from your banner monitoring.</p>
        </div>
        {observations.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Trackers</th>
                <th className="px-4 py-2 font-medium">Violations</th>
                <th className="px-4 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={o.id} className="border-t border-gray-200">
                  <td className="px-4 py-2">{propertyMap.get(o.property_id) ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{o.trackers_detected.length}</td>
                  <td className="px-4 py-2">
                    {o.violations.length > 0 ? (
                      <span className="text-red-600 font-medium">{o.violations.length}</span>
                    ) : (
                      <span className="text-green-700">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {new Date(o.observed_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No observations yet. Make sure tracker monitoring is enabled on your active banner and
            your site has received some traffic.
          </p>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <CategoryStat label="Analytics" count={detectedByCategory.a ?? 0} />
        <CategoryStat label="Marketing" count={detectedByCategory.m ?? 0} />
        <CategoryStat label="Personalisation" count={detectedByCategory.p ?? 0} />
        <CategoryStat label="Functional" count={detectedByCategory.f ?? 0} />
      </section>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 flex items-baseline justify-between">
          <div>
            <h2 className="font-medium">Security Posture</h2>
            <p className="text-xs text-gray-500">
              Nightly header + TLS scan per property. See ADR-0015.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            {latestScanAt ? `Last scan: ${new Date(latestScanAt).toLocaleString()}` : 'No scan yet'}
          </p>
        </div>
        {propertyRows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Highest Severity</th>
                <th className="px-4 py-2 font-medium">Findings</th>
                <th className="px-4 py-2 font-medium">Worst Signal</th>
              </tr>
            </thead>
            <tbody>
              {propertyRows.map((p) => {
                const propScans = latestScansByProperty.get(p.id) ?? []
                const nonInfo = propScans.filter((s) => s.severity !== 'info')
                const worst = pickWorst(propScans)
                return (
                  <tr key={p.id} className="border-t border-gray-200">
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-4 py-2"><SeverityBadge level={worst?.severity ?? 'unscanned'} /></td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {propScans.length > 0 ? `${nonInfo.length} issues / ${propScans.length} checks` : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">
                      {worst?.signal_key ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            Add a web property to enable security scans.
          </p>
        )}
      </section>

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Consent Probes</h2>
          <p className="text-xs text-gray-500">
            Synthetic compliance tests per property. v1 is static HTML analysis — see ADR-0016.
          </p>
        </div>
        {probes.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Probe</th>
                <th className="px-4 py-2 font-medium">Schedule</th>
                <th className="px-4 py-2 font-medium">Last Run</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {probes.map((probe) => {
                const run = latestRunByProbe.get(probe.id)
                const violations = run ? (run.violations as unknown[]).length : 0
                return (
                  <tr key={probe.id} className="border-t border-gray-200">
                    <td className="px-4 py-2">{propertyMap.get(probe.property_id) ?? '—'}</td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-700">{probe.probe_type}</td>
                    <td className="px-4 py-2 text-xs text-gray-600">{probe.schedule}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {run ? new Date(run.run_at).toLocaleString() : probe.last_run_at ? new Date(probe.last_run_at).toLocaleString() : 'never'}
                    </td>
                    <td className="px-4 py-2">
                      {run ? <ProbeStatusBadge violations={violations} status={run.status} /> : <span className="text-xs text-gray-500">pending first run</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No active probes. Seed one via SQL; CRUD UI is a future sprint.
          </p>
        )}
      </section>
    </main>
  )
}

const severityRank: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1, unscanned: 0,
}

function pickWorst<T extends { severity: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null
  return rows.reduce((a, b) => (severityRank[b.severity] > severityRank[a.severity] ? b : a))
}

function ProbeStatusBadge({ violations, status }: { violations: number; status: string }) {
  if (status !== 'completed') {
    return <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">failed</span>
  }
  if (violations > 0) {
    return <span className="rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700">{violations} violations</span>
  }
  return <span className="rounded px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700">clean</span>
}

function SeverityBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    critical: 'bg-red-200 text-red-900',
    high:     'bg-red-100 text-red-700',
    medium:   'bg-amber-100 text-amber-800',
    low:      'bg-yellow-100 text-yellow-800',
    info:     'bg-green-100 text-green-700',
    unscanned:'bg-gray-100 text-gray-500',
  }
  const cls = map[level] ?? 'bg-gray-100 text-gray-700'
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{level}</span>
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

function CategoryBadge({ code }: { code: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    a: { label: 'analytics', cls: 'bg-blue-100 text-blue-700' },
    m: { label: 'marketing', cls: 'bg-red-100 text-red-700' },
    p: { label: 'personalisation', cls: 'bg-purple-100 text-purple-700' },
    f: { label: 'functional', cls: 'bg-green-100 text-green-700' },
  }
  const cat = map[code] ?? { label: code, cls: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cat.cls}`}>{cat.label}</span>
  )
}

function CategoryStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded border border-gray-200 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{count}</p>
    </div>
  )
}
