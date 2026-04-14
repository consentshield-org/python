import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { IntegrationsTable } from './integrations-table'

export default async function IntegrationsPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: connectors } = await supabase
    .from('integration_connectors')
    .select('id, connector_type, display_name, status, last_health_check_at, last_error, created_at')
    .order('created_at', { ascending: false })

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Deletion Connectors</h1>
        <p className="text-sm text-gray-600">
          Webhook endpoints ConsentShield calls when an erasure request is approved. Each
          connector receives a signed payload; confirm completion via the signed callback URL.
        </p>
      </div>

      <IntegrationsTable
        orgId={membership.org_id}
        role={membership.role}
        initialConnectors={connectors ?? []}
      />

      <section className="rounded border border-gray-200 p-4 text-sm space-y-2">
        <h2 className="font-medium">Webhook protocol</h2>
        <p className="text-gray-600">
          When an erasure request is approved, ConsentShield POSTs this payload to your webhook URL:
        </p>
        <pre className="rounded bg-gray-900 p-3 text-xs text-gray-100 overflow-x-auto">{`{
  "event": "deletion_request",
  "request_id": "<uuid>",
  "data_principal": {
    "identifier": "<email>",
    "identifier_type": "email"
  },
  "reason": "erasure_request",
  "callback_url": "https://app.consentshield.in/api/v1/deletion-receipts/<uuid>?sig=<HMAC>",
  "deadline": "<ISO timestamp>"
}`}</pre>
        <p className="text-gray-600">Confirm completion by POSTing back to the callback URL:</p>
        <pre className="rounded bg-gray-900 p-3 text-xs text-gray-100 overflow-x-auto">{`POST callback_url
{
  "request_id": "<uuid>",
  "status": "completed",
  "records_deleted": 47,
  "completed_at": "<ISO timestamp>"
}`}</pre>
      </section>
    </main>
  )
}
