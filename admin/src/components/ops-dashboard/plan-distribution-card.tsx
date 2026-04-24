// ADR-1027 Sprint 1.2 — Accounts by plan histogram.
//
// Pure CSS-grid bar chart. No chart library — reuses the shadcn / tailwind
// building blocks the rest of the admin console already ships.
// Server Component.

interface PlanRow {
  plan_code: string
  display_name: string
  count: number
}

const TONE_BY_PLAN: Record<string, string> = {
  trial_starter: 'bg-text-3',
  starter: 'bg-navy',
  growth: 'bg-red-700',
  pro: 'bg-amber-500',
  enterprise: 'bg-green-600',
}

export function PlanDistributionCard({ rows }: { rows: PlanRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0)
  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Accounts by plan</h3>
        <span className="text-xs text-text-3">
          {total} {total === 1 ? 'account' : 'accounts'} total
        </span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-text-3">No accounts yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = Math.round((r.count / max) * 100)
            const share = total === 0 ? 0 : Math.round((r.count / total) * 100)
            const tone = TONE_BY_PLAN[r.plan_code] ?? 'bg-text-3'
            return (
              <div key={r.plan_code} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 text-text-2">
                  {r.display_name}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-bg">
                  <div
                    className={`absolute inset-y-0 left-0 ${tone}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-mono text-text">
                  {r.count}{' '}
                  <span className="text-text-3">· {share}%</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
