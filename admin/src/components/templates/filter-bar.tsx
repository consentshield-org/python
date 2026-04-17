'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function TemplatesFilterBar({ sectors }: { sectors: string[] }) {
  const router = useRouter()
  const params = useSearchParams()
  const currentStatus = params.get('status') ?? ''
  const currentSector = params.get('sector') ?? ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    router.push(`/templates?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <label className="flex items-center gap-2 text-xs text-zinc-600">
        <span className="font-medium uppercase tracking-wider">Status</span>
        <select
          value={currentStatus}
          onChange={(e) => setParam('status', e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          <option value="">All</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs text-zinc-600">
        <span className="font-medium uppercase tracking-wider">Sector</span>
        <select
          value={currentSector}
          onChange={(e) => setParam('sector', e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          <option value="">All</option>
          {sectors.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {(currentStatus || currentSector) && (
        <button
          type="button"
          onClick={() => router.push('/templates')}
          className="text-xs text-zinc-500 hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}
