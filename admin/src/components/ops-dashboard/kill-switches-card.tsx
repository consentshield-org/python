import Link from 'next/link'

interface KillSwitch {
  switch_key: string
  display_name: string
  description: string
  enabled: boolean
  reason: string | null
  set_at: string | null
}

export function KillSwitchesCard({ switches }: { switches: KillSwitch[] }) {
  const engaged = switches.filter((s) => s.enabled)
  const allNormal = engaged.length === 0

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-zinc-200 p-4">
        <h3 className="text-sm font-semibold">Kill switches</h3>
        {allNormal ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            All normal
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {engaged.length} engaged
          </span>
        )}
      </header>
      <div className="flex flex-col gap-2 p-4">
        {switches.map((sw) => (
          <div
            key={sw.switch_key}
            className="flex items-center justify-between rounded border border-zinc-200 p-2"
          >
            <div>
              <div className="font-mono text-sm">{sw.switch_key}</div>
              <div className="text-xs text-zinc-500">{sw.description}</div>
              {sw.enabled && sw.reason ? (
                <div className="mt-1 text-xs text-red-700">
                  Reason: {sw.reason}
                </div>
              ) : null}
            </div>
            <div
              className={
                sw.enabled
                  ? 'text-xs font-medium text-red-700'
                  : 'text-xs font-medium text-green-700'
              }
            >
              {sw.enabled ? '● Engaged' : '● Normal'}
            </div>
          </div>
        ))}
        <Link
          href="/flags?tab=kill-switches"
          className="mt-2 block rounded border border-zinc-300 bg-white px-3 py-2 text-center text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Manage in Feature Flags &amp; Kill Switches →
        </Link>
      </div>
    </section>
  )
}
