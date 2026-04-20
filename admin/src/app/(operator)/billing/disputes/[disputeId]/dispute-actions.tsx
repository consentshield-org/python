'use client'

import { useState, useTransition } from 'react'
import { assembleEvidenceBundle, markDisputeState } from '../actions'

interface Props {
  disputeId: string
  currentStatus: string
  hasEvidence: boolean
}

const STATE_OPTIONS = [
  { value: 'under_review', label: 'Mark Under Review (submitted)' },
  { value: 'won', label: 'Mark Won' },
  { value: 'lost', label: 'Mark Lost' },
  { value: 'closed', label: 'Mark Closed' },
]

export function DisputeActions({ disputeId, currentStatus, hasEvidence }: Props) {
  const [isPending, startTransition] = useTransition()
  const [assembleResult, setAssembleResult] = useState<{
    presignedUrl?: string
    sha256?: string
    error?: string
  } | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [newStatus, setNewStatus] = useState(STATE_OPTIONS[0].value)

  const isResolved = ['won', 'lost', 'closed'].includes(currentStatus)

  function handleAssemble() {
    setAssembleResult(null)
    startTransition(async () => {
      const result = await assembleEvidenceBundle(disputeId)
      setAssembleResult(result as typeof assembleResult)
    })
  }

  function handleStateChange() {
    setStateError(null)
    if (!reason.trim()) {
      setStateError('Reason is required')
      return
    }
    startTransition(async () => {
      const result = await markDisputeState(disputeId, newStatus, reason)
      if ('error' in result) {
        setStateError(result.error)
      } else {
        window.location.reload()
      }
    })
  }

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700">Actions</h2>

      {/* Evidence bundle */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={handleAssemble}
            disabled={isPending}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isPending ? 'Assembling…' : hasEvidence ? 'Re-assemble Evidence Bundle' : 'Assemble Evidence Bundle'}
          </button>
          {hasEvidence && !assembleResult && (
            <span className="text-xs text-green-700">Bundle already assembled — re-assemble to refresh.</span>
          )}
        </div>
        {assembleResult && 'error' in assembleResult && assembleResult.error && (
          <p className="text-sm text-red-600">{assembleResult.error}</p>
        )}
        {assembleResult && 'presignedUrl' in assembleResult && assembleResult.presignedUrl && (
          <div className="text-sm space-y-1">
            <a
              href={assembleResult.presignedUrl}
              className="text-blue-600 hover:underline"
              download
            >
              Download evidence ZIP (valid 15 min)
            </a>
            <p className="text-xs text-gray-400 font-mono">SHA-256: {assembleResult.sha256}</p>
          </div>
        )}
      </div>

      {/* State transition */}
      {!isResolved && (
        <div className="space-y-2 border-t pt-4">
          <label className="block text-sm font-medium text-gray-700">Change status</label>
          <div className="flex items-center gap-3">
            <select
              value={newStatus}
              onChange={e => setNewStatus(e.target.value)}
              className="text-sm border rounded px-2 py-1.5"
            >
              {STATE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Reason (required)"
            rows={2}
            className="w-full text-sm border rounded px-3 py-2 resize-none"
          />
          {stateError && <p className="text-sm text-red-600">{stateError}</p>}
          <button
            onClick={handleStateChange}
            disabled={isPending}
            className="px-3 py-1.5 text-sm rounded-md bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Apply'}
          </button>
        </div>
      )}

      {isResolved && (
        <p className="text-sm text-gray-400">
          This dispute is {currentStatus} — no further state transitions available.
        </p>
      )}
    </section>
  )
}
