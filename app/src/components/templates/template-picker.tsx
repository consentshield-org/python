'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { applyTemplate } from '@/app/(dashboard)/dashboard/template/actions'

interface Option {
  code: string
  displayName: string
  description: string
  version: number
  purposeCount: number
  isActive: boolean
}

export function TemplatePicker({
  templates,
  sector,
}: {
  templates: Option[]
  sector: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onApply(code: string) {
    setPending(code)
    setError(null)
    const r = await applyTemplate(code)
    setPending(null)
    if (!r.ok) {
      setError(r.error)
      return
    }
    router.refresh()
  }

  if (templates.length === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
        No published templates available for sector <code>{sector}</code> or
        the <code>general</code> fallback. An operator can publish one in the
        admin console.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <div
            key={`${t.code}-${t.version}`}
            className={
              t.isActive
                ? 'rounded border-2 border-teal-500 bg-teal-50 p-4'
                : 'rounded border border-gray-200 bg-white p-4 hover:border-gray-400'
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {t.displayName}
                </p>
                <p className="mt-0.5 font-mono text-xs text-gray-500">
                  {t.code} · v{t.version} · {t.purposeCount} purposes
                </p>
              </div>
              {t.isActive ? (
                <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">
                  Active
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-gray-700">{t.description}</p>
            <div className="mt-3 flex justify-end">
              {t.isActive ? (
                <span className="text-xs text-teal-700">
                  Applied to your organisation
                </span>
              ) : (
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => onApply(t.code)}
                  className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  {pending === t.code ? 'Applying…' : 'Apply this template'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
