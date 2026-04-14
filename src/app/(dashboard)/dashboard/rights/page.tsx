import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { daysBetween, nowIso } from '@/lib/compliance/score'

export default async function RightsInboxPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: requests } = await supabase
    .from('rights_requests')
    .select(
      'id, request_type, requestor_name, requestor_email, status, sla_deadline, email_verified, created_at',
    )
    .eq('email_verified', true)
    .order('created_at', { ascending: false })

  const now = nowIso()
  const orgId = membership.org_id

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Rights Requests</h1>
        <p className="text-sm text-gray-600">
          Data Principal requests under DPDP Sections 11–14. Respond within 30 days.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Share your public rights portal:{' '}
          <code className="text-xs">/rights/{orgId}</code>
        </p>
      </div>

      <div className="rounded border border-gray-200">
        {requests && requests.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Requestor</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">SLA</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const daysLeft = daysBetween(r.sla_deadline)
                const overdue = daysLeft < 0 && r.status !== 'completed'
                const warning = daysLeft <= 7 && daysLeft >= 0 && r.status !== 'completed'
                return (
                  <tr key={r.id} className="border-t border-gray-200">
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.requestor_name}</div>
                      <div className="text-xs text-gray-500">{r.requestor_email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                        {r.request_type}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td
                      className={`px-4 py-2 text-sm ${
                        overdue
                          ? 'text-red-600 font-medium'
                          : warning
                            ? 'text-amber-600 font-medium'
                            : 'text-gray-600'
                      }`}
                    >
                      {overdue
                        ? `Overdue by ${-daysLeft}d`
                        : r.status === 'completed'
                          ? '—'
                          : `${daysLeft}d left`}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/dashboard/rights/${r.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No rights requests yet. Share your rights portal link with your users.
          </p>
        )}
      </div>
      <p className="text-xs text-gray-400 hidden">{now}</p>
    </main>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-amber-100 text-amber-700',
    completed: 'bg-green-100 text-green-700',
    rejected: 'bg-gray-100 text-gray-700',
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[status] ?? map.new}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
