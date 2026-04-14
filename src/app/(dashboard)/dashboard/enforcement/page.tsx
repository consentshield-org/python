import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isoSinceHours } from '@/lib/compliance/score'

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

  const [observationsRes, violations7dRes, properties] = await Promise.all([
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
    supabase.from('web_properties').select('id, name'),
  ])

  const observations = (observationsRes.data ?? []) as ObservationRow[]
  const allViolationsWindow = (violations7dRes.data ?? []) as {
    violations: Violation[]
    observed_at: string
  }[]

  const propertyMap = new Map((properties.data ?? []).map((p) => [p.id, p.name]))

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
    </main>
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
