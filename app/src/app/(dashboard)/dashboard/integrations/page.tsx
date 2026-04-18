import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { IntegrationsTable } from './integrations-table'
import { OAuthBanner } from './oauth-banner'

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>
}) {
  const sp = await searchParams
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
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

      {sp.oauth_connected || sp.oauth_error ? (
        <OAuthBanner connected={sp.oauth_connected ?? null} error={sp.oauth_error ?? null} />
      ) : null}

      <section className="rounded border border-gray-200 p-4 space-y-3">
        <div>
          <h2 className="font-medium">Connect via OAuth</h2>
          <p className="text-xs text-gray-500">
            Preferred over pasted API keys — tokens refresh automatically. Requires the operator to
            register an OAuth app at each provider and set the corresponding env vars on the
            deployment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/api/integrations/oauth/mailchimp/connect"
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Connect Mailchimp
          </a>
          <a
            href="/api/integrations/oauth/hubspot/connect"
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Connect HubSpot
          </a>
        </div>
      </section>

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
