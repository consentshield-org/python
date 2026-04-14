'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RightsRequestActions({
  orgId,
  requestId,
  currentStatus,
  identityVerified,
}: {
  orgId: string
  requestId: string
  currentStatus: string
  identityVerified: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function updateRequest(payload: Record<string, unknown>, eventType?: string, notes?: string) {
    setLoading(true)
    setError('')

    const patchRes = await fetch(`/api/orgs/${orgId}/rights-requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!patchRes.ok) {
      const body = await patchRes.json()
      setError(body.error || 'Update failed')
      setLoading(false)
      return
    }

    if (eventType) {
      await fetch(`/api/orgs/${orgId}/rights-requests/${requestId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, notes }),
      })
    }

    setLoading(false)
    router.refresh()
  }

  return (
    <section className="rounded border border-gray-200 p-4 space-y-3">
      <h2 className="font-medium">Workflow</h2>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {currentStatus === 'new' && (
          <button
            disabled={loading}
            onClick={() =>
              updateRequest({ status: 'in_progress' }, 'assigned', 'Request accepted for processing')
            }
            className="rounded bg-black px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Start Processing
          </button>
        )}

        {!identityVerified && currentStatus !== 'completed' && (
          <button
            disabled={loading}
            onClick={() =>
              updateRequest(
                { identity_verified: true, identity_method: 'otp' },
                'identity_verified',
                'Identity confirmed via email OTP',
              )
            }
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Mark identity verified (OTP)
          </button>
        )}

        {currentStatus === 'in_progress' && (
          <>
            <button
              disabled={loading}
              onClick={() =>
                updateRequest(
                  { status: 'completed' },
                  'closed',
                  'Request fulfilled and closed',
                )
              }
              className="rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              Mark Completed
            </button>
            <button
              disabled={loading}
              onClick={() =>
                updateRequest(
                  { status: 'rejected' },
                  'closed',
                  'Request rejected',
                )
              }
              className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </section>
  )
}
