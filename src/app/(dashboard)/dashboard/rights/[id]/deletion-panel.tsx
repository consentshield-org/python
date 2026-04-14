'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Receipt {
  id: string
  target_system: string
  status: string
  requested_at: string | null
  confirmed_at: string | null
  failure_reason: string | null
}

export function DeletionPanel({
  orgId,
  requestId,
  canExecute,
  receipts,
}: {
  orgId: string
  requestId: string
  canExecute: boolean
  receipts: Receipt[]
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleExecute() {
    if (!confirm('Trigger deletion across all connected systems? This cannot be undone.')) return
    setLoading(true)
    setError('')

    const res = await fetch(`/api/orgs/${orgId}/rights-requests/${requestId}/execute-deletion`, {
      method: 'POST',
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error || 'Dispatch failed')
      setLoading(false)
      return
    }

    setLoading(false)
    router.refresh()
  }

  const alreadyDispatched = receipts.length > 0

  return (
    <section className="rounded border border-gray-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Deletion Orchestration</h2>
        {canExecute && (
          <button
            onClick={handleExecute}
            disabled={loading}
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading
              ? 'Dispatching...'
              : alreadyDispatched
                ? 'Re-dispatch'
                : 'Execute Deletion'}
          </button>
        )}
      </div>

      {!canExecute && !alreadyDispatched && (
        <p className="text-xs text-gray-500">
          Verify identity first, then dispatch deletion to connected systems.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {receipts.length > 0 && (
        <div className="rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">System</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Requested</th>
                <th className="px-4 py-2 font-medium">Confirmed</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-t border-gray-200">
                  <td className="px-4 py-2">{r.target_system}</td>
                  <td className="px-4 py-2">
                    <ReceiptStatus status={r.status} />
                    {r.failure_reason && (
                      <div className="text-xs text-red-600 mt-1">{r.failure_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {r.requested_at ? new Date(r.requested_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {r.confirmed_at ? new Date(r.confirmed_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ReceiptStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    awaiting_callback: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-green-100 text-green-700',
    completed: 'bg-green-100 text-green-700',
    partial: 'bg-amber-100 text-amber-700',
    failed: 'bg-red-100 text-red-700',
    dispatch_failed: 'bg-red-100 text-red-700',
  }
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-700'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}
