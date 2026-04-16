'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Connector {
  id: string
  connector_type: string
  display_name: string
  status: string
  last_health_check_at: string | null
  last_error: string | null
  created_at: string
}

type ConnectorType = 'webhook' | 'mailchimp' | 'hubspot'

export function IntegrationsTable({
  orgId,
  role,
  initialConnectors,
}: {
  orgId: string
  role: string
  initialConnectors: Connector[]
}) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      {role === 'admin' && (
        <>
          {open ? (
            <NewConnectorForm
              orgId={orgId}
              onCancel={() => setOpen(false)}
              onCreated={() => {
                setOpen(false)
                router.refresh()
              }}
            />
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              + Add Connector
            </button>
          )}
        </>
      )}

      <div className="rounded border border-gray-200">
        {initialConnectors.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Added</th>
                {role === 'admin' && <th className="px-4 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {initialConnectors.map((c) => (
                <ConnectorRow
                  key={c.id}
                  orgId={orgId}
                  role={role}
                  connector={c}
                  onDelete={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No connectors yet. Add one to start handling deletion requests.
          </p>
        )}
      </div>
    </>
  )
}

function ConnectorRow({
  orgId,
  role,
  connector,
  onDelete,
}: {
  orgId: string
  role: string
  connector: Connector
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`Delete connector "${connector.display_name}"?`)) return
    setDeleting(true)
    const res = await fetch(`/api/orgs/${orgId}/integrations/${connector.id}`, {
      method: 'DELETE',
    })
    if (res.ok) onDelete()
    else setDeleting(false)
  }

  return (
    <tr className="border-t border-gray-200">
      <td className="px-4 py-2 font-medium">{connector.display_name}</td>
      <td className="px-4 py-2 text-gray-600">{connector.connector_type}</td>
      <td className="px-4 py-2">
        {connector.status === 'active' ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Active
          </span>
        ) : (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            {connector.status}
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">
        {new Date(connector.created_at).toLocaleDateString()}
      </td>
      {role === 'admin' && (
        <td className="px-4 py-2 text-right">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </td>
      )}
    </tr>
  )
}

function NewConnectorForm({
  orgId,
  onCancel,
  onCreated,
}: {
  orgId: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [connectorType, setConnectorType] = useState<ConnectorType>('webhook')
  const [displayName, setDisplayName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [sharedSecret, setSharedSecret] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const body: Record<string, string> = {
      connector_type: connectorType,
      display_name: displayName,
    }
    if (connectorType === 'webhook') {
      body.webhook_url = webhookUrl
      body.shared_secret = sharedSecret
    } else if (connectorType === 'mailchimp') {
      body.api_key = apiKey
      body.audience_id = audienceId
    } else if (connectorType === 'hubspot') {
      body.api_key = apiKey
    }

    const res = await fetch(`/api/orgs/${orgId}/integrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const responseBody = await res.json()
      setError(responseBody.error || 'Failed to add connector')
      setLoading(false)
      return
    }

    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded border border-gray-200 p-4 space-y-4">
      <h2 className="font-medium">New Connector</h2>

      <div>
        <label htmlFor="type" className="block text-sm font-medium">Type</label>
        <select
          id="type"
          value={connectorType}
          onChange={(e) => setConnectorType(e.target.value as ConnectorType)}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="webhook">Generic webhook (you own the endpoint)</option>
          <option value="mailchimp">Mailchimp (direct API)</option>
          <option value="hubspot">HubSpot (direct API)</option>
        </select>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium">Name</label>
        <input
          id="name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          placeholder={connectorType === 'webhook' ? 'Production CRM' : connectorType === 'mailchimp' ? 'Main audience' : 'HubSpot contacts'}
          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      {connectorType === 'webhook' && (
        <>
          <div>
            <label htmlFor="url" className="block text-sm font-medium">Webhook URL</label>
            <input
              id="url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              required
              placeholder="https://api.example.com/deletion-webhook"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="secret" className="block text-sm font-medium">Shared secret (optional)</label>
            <input
              id="secret"
              type="password"
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
              placeholder="Used for HMAC signing of outgoing requests"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </div>
        </>
      )}

      {connectorType === 'mailchimp' && (
        <>
          <div>
            <label htmlFor="mc-key" className="block text-sm font-medium">Mailchimp API key</label>
            <input
              id="mc-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              placeholder="abc123def456-us21"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-xs text-gray-500">Account → Extras → API Keys. The key ends with a server prefix like <code>-us21</code>.</p>
          </div>
          <div>
            <label htmlFor="mc-list" className="block text-sm font-medium">Audience ID</label>
            <input
              id="mc-list"
              type="text"
              value={audienceId}
              onChange={(e) => setAudienceId(e.target.value)}
              required
              placeholder="e.g. 9f1d2a4b3c"
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-xs text-gray-500">Audience → Settings → Audience name and defaults → Unique ID.</p>
          </div>
        </>
      )}

      {connectorType === 'hubspot' && (
        <div>
          <label htmlFor="hs-key" className="block text-sm font-medium">HubSpot private app token</label>
          <input
            id="hs-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            placeholder="pat-na1-xxxxxxxx"
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-gray-500">Settings → Integrations → Private Apps. Scope needed: <code>crm.objects.contacts.write</code>.</p>
        </div>
      )}

      <p className="text-xs text-gray-500">
        All credentials stored encrypted with your org&apos;s derived key. OAuth-based flows (no pasted keys) land in a later sprint — see ADR-0018.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Adding...' : 'Add Connector'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
