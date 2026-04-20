import Link from 'next/link'
import { listDisputes } from './actions'

function statusBadge(status: string) {
  const colours: Record<string, string> = {
    open: 'bg-red-100 text-red-800',
    under_review: 'bg-yellow-100 text-yellow-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-gray-100 text-gray-700',
    closed: 'bg-gray-100 text-gray-500',
  }
  return colours[status] ?? 'bg-gray-100 text-gray-600'
}

function isUrgent(deadlineAt: string | null): boolean {
  if (!deadlineAt) return false
  const hoursLeft = (new Date(deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60)
  return hoursLeft < 48
}

export default async function DisputesPage() {
  const result = await listDisputes()

  if ('error' in result) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">Error loading disputes: {result.error}</p>
      </div>
    )
  }

  const disputes = result
  const open = disputes.filter(d => d.status === 'open').length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Disputes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {disputes.length} total &middot; {open} open
          </p>
        </div>
      </div>

      {disputes.length === 0 ? (
        <p className="text-sm text-gray-500">No disputes on record.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Dispute ID</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Account</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Reason</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phase</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Deadline</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {disputes.map(d => {
                const urgent = d.status === 'open' && isUrgent(d.deadline_at)
                return (
                  <tr
                    key={d.id}
                    className={urgent ? 'bg-red-50' : 'bg-white hover:bg-gray-50'}
                  >
                    <td className="px-4 py-3 font-mono">
                      <Link
                        href={`/billing/disputes/${d.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {d.razorpay_dispute_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {d.account_name ?? (
                        <span className="text-gray-400 italic">unresolved</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {d.currency} {(d.amount_paise / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {d.reason_code ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 capitalize">
                      {d.phase?.replace(/_/g, ' ') ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadge(d.status)}`}
                      >
                        {d.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-xs ${urgent ? 'text-red-700 font-semibold' : 'text-gray-500'}`}>
                      {d.deadline_at
                        ? new Date(d.deadline_at).toLocaleDateString('en-IN')
                        : '—'}
                      {urgent && ' ⚠'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(d.opened_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
