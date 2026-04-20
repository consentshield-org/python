'use client'

import { useState, useTransition } from 'react'
import {
  assembleEvidenceBundle,
  markDisputeState,
  prepareContestPacket,
  markContestSubmitted,
  submitContestViaRazorpay,
} from '../actions'

interface Props {
  disputeId: string
  currentStatus: string
  hasEvidence: boolean
  contestSummary: string | null
  contestPacketPreparedAt: string | null
  contestSubmittedAt: string | null
}

const STATE_OPTIONS = [
  { value: 'under_review', label: 'Mark Under Review (submitted)' },
  { value: 'won', label: 'Mark Won' },
  { value: 'lost', label: 'Mark Lost' },
  { value: 'closed', label: 'Mark Closed' },
]

export function DisputeActions({
  disputeId,
  currentStatus,
  hasEvidence,
  contestSummary,
  contestPacketPreparedAt,
  contestSubmittedAt,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [assembleResult, setAssembleResult] = useState<{
    presignedUrl?: string
    sha256?: string
    error?: string
  } | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [newStatus, setNewStatus] = useState(STATE_OPTIONS[0].value)

  // Contest state
  const [showContestForm, setShowContestForm] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(contestSummary ?? '')
  const [contestError, setContestError] = useState<string | null>(null)
  const [contestSaved, setContestSaved] = useState(false)

  const isResolved = ['won', 'lost', 'closed'].includes(currentStatus)
  const packetPrepared = !!contestPacketPreparedAt
  const submittedToRazorpay = !!contestSubmittedAt

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

  function handlePrepareContest() {
    setContestError(null)
    setContestSaved(false)
    if (summaryDraft.trim().length < 20) {
      setContestError('Contest summary must be at least 20 characters.')
      return
    }
    startTransition(async () => {
      const result = await prepareContestPacket(disputeId, summaryDraft.trim())
      if ('error' in result) {
        setContestError(result.error)
      } else {
        setContestSaved(true)
        setShowContestForm(false)
        window.location.reload()
      }
    })
  }

  function handleMarkSubmitted() {
    setContestError(null)
    startTransition(async () => {
      const result = await markContestSubmitted(disputeId, null)
      if ('error' in result) {
        setContestError(result.error)
      } else {
        window.location.reload()
      }
    })
  }

  function handleAutoSubmit() {
    setContestError(null)
    startTransition(async () => {
      const result = await submitContestViaRazorpay(disputeId)
      if ('error' in result) {
        setContestError(result.error)
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

      {/* Contest preparation + submit (ADR-0052 Sprint 1.1) */}
      {!isResolved && (
        <div className="space-y-2 border-t pt-4">
          <label className="block text-sm font-medium text-gray-700">Razorpay contest</label>

          {packetPrepared && !showContestForm && (
            <div className="rounded border bg-amber-50 border-amber-200 px-3 py-2 text-xs space-y-1">
              <div className="font-medium text-amber-800">
                Contest packet prepared{' '}
                {new Date(contestPacketPreparedAt!).toLocaleString('en-IN')}
              </div>
              {contestSummary && (
                <div className="text-amber-900 whitespace-pre-line">{contestSummary}</div>
              )}
              {submittedToRazorpay ? (
                <div className="pt-1 text-green-700">
                  ✓ Submitted {new Date(contestSubmittedAt!).toLocaleString('en-IN')}
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleAutoSubmit}
                    disabled={isPending}
                    className="px-3 py-1 text-xs rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                    title="Uploads the bundle to Razorpay Documents API and posts to the dispute contest endpoint."
                  >
                    {isPending ? 'Submitting to Razorpay…' : 'Submit to Razorpay'}
                  </button>
                  <button
                    onClick={handleMarkSubmitted}
                    disabled={isPending}
                    className="px-3 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                    title="Record that submission happened via Razorpay dashboard / out-of-band."
                  >
                    Mark submitted manually
                  </button>
                </div>
              )}
            </div>
          )}

          {!showContestForm && !packetPrepared && (
            <button
              onClick={() => setShowContestForm(true)}
              disabled={!hasEvidence || isPending}
              className="px-3 py-1.5 text-sm rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
              title={!hasEvidence ? 'Assemble evidence bundle first' : undefined}
            >
              Prepare contest packet
            </button>
          )}

          {!showContestForm && packetPrepared && !submittedToRazorpay && (
            <button
              onClick={() => setShowContestForm(true)}
              disabled={isPending}
              className="px-3 py-1 text-xs rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              Re-edit summary
            </button>
          )}

          {showContestForm && (
            <div className="space-y-2">
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                placeholder="Contest summary — at least 20 chars. Reference bundle exhibits (subscription event, invoice email receipt, etc.). Rule 3: no customer PII in the summary."
                rows={4}
                className="w-full text-sm border rounded px-3 py-2 resize-y"
              />
              {contestError && <p className="text-sm text-red-600">{contestError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handlePrepareContest}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {isPending ? 'Saving…' : 'Save contest packet'}
                </button>
                <button
                  onClick={() => {
                    setShowContestForm(false)
                    setSummaryDraft(contestSummary ?? '')
                    setContestError(null)
                  }}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {contestSaved && (
            <p className="text-xs text-green-700">Contest packet saved.</p>
          )}
        </div>
      )}

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
