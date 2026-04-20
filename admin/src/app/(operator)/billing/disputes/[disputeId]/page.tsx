import { notFound } from 'next/navigation'
import { getDisputeDetail } from '../actions'
import { DisputeActions } from './dispute-actions'

function inr(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`
}

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ disputeId: string }>
}) {
  const { disputeId } = await params
  const result = await getDisputeDetail(disputeId)

  if ('error' in result) notFound()

  const { dispute, webhookEvents, planHistory, ledger } = result

  const deadlineHours = dispute.deadline_at
    ? (new Date(dispute.deadline_at).getTime() - Date.now()) / (1000 * 60 * 60)
    : null
  const urgent = dispute.status === 'open' && deadlineHours !== null && deadlineHours < 48

  return (
    <div className="space-y-6 p-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900 font-mono">
          {dispute.razorpay_dispute_id}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Opened {new Date(dispute.opened_at).toLocaleString('en-IN')}
        </p>
      </div>

      {urgent && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          Response deadline in {Math.round(deadlineHours!)} hours —{' '}
          {new Date(dispute.deadline_at!).toLocaleString('en-IN')}
        </div>
      )}

      {/* Dispute info */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Dispute Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-gray-500">Amount</dt>
            <dd className="font-medium">{inr(dispute.amount_paise)} {dispute.currency}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="capitalize font-medium">{dispute.status.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Phase</dt>
            <dd className="capitalize">{dispute.phase?.replace(/_/g, ' ') ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Reason code</dt>
            <dd>{dispute.reason_code ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Payment ID</dt>
            <dd className="font-mono text-xs">{dispute.razorpay_payment_id}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Account</dt>
            <dd>
              {dispute.account_id ? (
                <a
                  href={`/accounts/${dispute.account_id}`}
                  className="text-blue-600 hover:underline"
                >
                  {dispute.account_name ?? dispute.account_id}
                </a>
              ) : (
                <span className="text-gray-400 italic">unresolved</span>
              )}
            </dd>
          </div>
          {dispute.deadline_at && (
            <div>
              <dt className="text-gray-500">Deadline</dt>
              <dd className={urgent ? 'text-red-700 font-semibold' : ''}>
                {new Date(dispute.deadline_at).toLocaleString('en-IN')}
              </dd>
            </div>
          )}
          {dispute.evidence_assembled_at && (
            <div>
              <dt className="text-gray-500">Evidence assembled</dt>
              <dd className="text-green-700">
                {new Date(dispute.evidence_assembled_at).toLocaleString('en-IN')}
              </dd>
            </div>
          )}
          {dispute.resolved_at && (
            <div>
              <dt className="text-gray-500">Resolved</dt>
              <dd>{new Date(dispute.resolved_at).toLocaleString('en-IN')}</dd>
            </div>
          )}
          {dispute.resolved_reason && (
            <div className="col-span-2">
              <dt className="text-gray-500">Resolution reason</dt>
              <dd>{dispute.resolved_reason}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Actions */}
      <DisputeActions
        disputeId={dispute.id}
        currentStatus={dispute.status}
        hasEvidence={!!dispute.evidence_bundle_r2_key}
      />

      {/* Webhook event timeline */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Webhook Timeline ({webhookEvents.length})
        </h2>
        {webhookEvents.length === 0 ? (
          <p className="text-sm text-gray-400">No webhook events matched this payment.</p>
        ) : (
          <div className="space-y-2">
            {webhookEvents.map(e => (
              <div key={e.event_id} className="flex items-start gap-3 text-sm">
                <span className="text-gray-400 text-xs whitespace-nowrap mt-0.5">
                  {new Date(e.received_at).toLocaleString('en-IN')}
                </span>
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  {e.event_type}
                </span>
                <span className="text-gray-500 text-xs font-mono">{e.event_id}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Plan history */}
      <section className="rounded-lg border p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">
          Plan History ({planHistory.length})
        </h2>
        {planHistory.length === 0 ? (
          <p className="text-sm text-gray-400">No plan changes on record for this account.</p>
        ) : (
          <div className="space-y-2">
            {planHistory.map((h, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-gray-400 text-xs whitespace-nowrap mt-0.5">
                  {new Date(h.occurred_at).toLocaleString('en-IN')}
                </span>
                <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                  {h.action}
                </span>
                {h.reason && <span className="text-gray-500 text-xs">{h.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Evidence ledger (ADR-0051) — unified chargeback-defense timeline */}
      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            Evidence Ledger ({ledger.length})
          </h2>
          <span className="text-xs text-gray-400">
            Newest first · included in evidence ZIP as <code className="font-mono">evidence-ledger.ndjson</code>
          </span>
        </div>
        {ledger.length === 0 ? (
          <p className="text-sm text-gray-400">No chargeback-relevant events on record for this account.</p>
        ) : (
          <div className="overflow-hidden rounded border">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2 font-medium text-gray-600">When</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Event</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Source</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Reference</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ledger.slice(0, 50).map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                      {new Date(e.occurred_at).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono rounded bg-gray-100 px-1.5 py-0.5">
                        {e.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500">
                      {e.event_source.replace(/_trigger$/, '').replace(/_/g, ' ')}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-400">
                      {e.source_ref ? e.source_ref.slice(0, 8) : '—'}
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate text-gray-500" title={JSON.stringify(e.metadata)}>
                      {e.metadata
                        ? Object.entries(e.metadata).slice(0, 2).map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledger.length > 50 && (
              <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500">
                Showing first 50 of {ledger.length} events. Full set included in the evidence ZIP.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
