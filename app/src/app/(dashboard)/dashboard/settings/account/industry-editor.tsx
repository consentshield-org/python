'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { updateOrgIndustry } from './actions'

interface Props {
  orgId: string
  currentIndustry: string
  industryLabels: Record<string, string>
  canEdit: boolean
}

export function IndustryEditor({ orgId, currentIndustry, industryLabels, canEdit }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState(currentIndustry)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  function handleSave() {
    setError(null)
    if (!selected) {
      setError('Select an industry')
      return
    }
    startTransition(async () => {
      const result = await updateOrgIndustry(orgId, selected)
      if ('error' in result) {
        setError(result.error)
      } else {
        setEditing(false)
        setJustSaved(true)
        router.refresh()
      }
    })
  }

  function handleCancel() {
    setSelected(currentIndustry)
    setError(null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{industryLabels[currentIndustry] ?? currentIndustry}</div>
          <div className="mt-0.5 text-xs text-gray-500">Code: <code className="font-mono">{currentIndustry}</code></div>
          {justSaved && selected !== currentIndustry && (
            <div className="mt-3 rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
              Industry updated.{' '}
              <Link href="/dashboard/template" className="underline">
                Review your sector template picker
              </Link>{' '}
              — new sector-specific templates may now be available.
            </div>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            Change industry
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm md:w-1/2"
      >
        {Object.entries(industryLabels).map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Changing industry does NOT delete existing purposes or your applied template.
      </p>
    </div>
  )
}
