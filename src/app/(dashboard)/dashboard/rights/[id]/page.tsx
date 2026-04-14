import { createServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { RightsRequestActions } from './actions'
import { DeletionPanel } from './deletion-panel'

export default async function RightsRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  if (!membership) notFound()

  const { data: req } = await supabase
    .from('rights_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (!req) notFound()

  const { data: events } = await supabase
    .from('rights_request_events')
    .select('id, event_type, notes, actor_id, created_at')
    .eq('request_id', id)
    .order('created_at', { ascending: true })

  const { data: receipts } = await supabase
    .from('deletion_receipts')
    .select('id, target_system, status, requested_at, confirmed_at, failure_reason')
    .eq('trigger_id', id)
    .order('created_at', { ascending: false })

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <div>
        <Link href="/dashboard/rights" className="text-xs text-gray-500 hover:underline">
          ← All rights requests
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {req.request_type} request from {req.requestor_name}
        </h1>
        <p className="text-sm text-gray-600">{req.requestor_email}</p>
      </div>

      <section className="rounded border border-gray-200 p-4 space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status" value={req.status} />
          <Field label="SLA deadline" value={new Date(req.sla_deadline).toLocaleDateString()} />
          <Field label="Submitted" value={new Date(req.created_at).toLocaleString()} />
          <Field
            label="Email verified"
            value={
              req.email_verified
                ? new Date(req.email_verified_at).toLocaleString()
                : 'Not verified'
            }
          />
          <Field
            label="Identity verified"
            value={
              req.identity_verified
                ? `${new Date(req.identity_verified_at).toLocaleString()} (${req.identity_method ?? '—'})`
                : 'Not verified'
            }
          />
          <Field label="Turnstile verified" value={req.turnstile_verified ? 'Yes' : 'No'} />
        </div>
        {req.requestor_message && (
          <div>
            <p className="font-medium text-xs text-gray-500 uppercase mt-4">Requestor message</p>
            <p className="mt-1 whitespace-pre-wrap">{req.requestor_message}</p>
          </div>
        )}
      </section>

      <RightsRequestActions
        orgId={membership.org_id}
        requestId={req.id}
        currentStatus={req.status}
        identityVerified={req.identity_verified}
      />

      {req.request_type === 'erasure' && (
        <DeletionPanel
          orgId={membership.org_id}
          requestId={req.id}
          canExecute={
            req.identity_verified && req.email_verified && req.status !== 'completed'
          }
          receipts={receipts ?? []}
        />
      )}

      <section className="rounded border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-medium">Audit Trail</h2>
        </div>
        {events && events.length > 0 ? (
          <ol className="divide-y divide-gray-200 text-sm">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.event_type}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.notes && <p className="mt-1 text-xs text-gray-600">{e.notes}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-4 py-4 text-center text-sm text-gray-500">No events yet.</p>
        )}
      </section>
    </main>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  )
}
