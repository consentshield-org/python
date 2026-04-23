'use client'

// ADR-1005 Phase 6 Sprint 6.4 — interactive notification-channels UI.
//
// One row per channel; per-row edit (config + alert_types + active),
// test-send button, delete. Add-channel buttons at the top, one per
// supported type, each opening an inline form.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createChannelAction,
  deleteChannelAction,
  testSendAction,
  updateChannelAction,
} from './actions'

export interface ChannelRow {
  id: string
  channel_type: string
  config: Record<string, unknown>
  alert_types: string[]
  is_active: boolean
}

export interface AlertTypeMeta {
  kind: string
  label: string
  description: string
}

export const SUPPORTED_TYPES = [
  { type: 'slack', label: 'Slack', help: 'Incoming webhook (Block Kit)' },
  { type: 'teams', label: 'Microsoft Teams', help: 'Workflows webhook (Adaptive Card)' },
  { type: 'discord', label: 'Discord', help: 'Channel webhook' },
  { type: 'pagerduty', label: 'PagerDuty', help: 'Events API v2 routing key' },
  { type: 'custom_webhook', label: 'Custom webhook', help: 'Your own endpoint, HMAC-SHA256 signed' },
] as const

export const ALERT_TYPES: AlertTypeMeta[] = [
  {
    kind: 'orphan_events_nonzero',
    label: 'Orphan consent events',
    description:
      'Events with empty artefact_ids 10+ minutes after capture (ADR-1004 Phase 3).',
  },
  {
    kind: 'deletion_sla_overdue',
    label: 'Deletion SLA overdue',
    description: 'Pending or failed deletion_receipts older than 24h.',
  },
  {
    kind: 'rights_request_sla',
    label: 'Rights request near SLA',
    description: 'DPDP §13 erasure / access requests within 7 days of deadline.',
  },
  {
    kind: 'security_scan_critical',
    label: 'Critical security scan finding',
    description: 'New `security_scans` row at severity=critical.',
  },
  {
    kind: 'daily_summary',
    label: 'Daily compliance summary',
    description: 'Once-per-day digest of activity + outstanding actions.',
  },
]

export function ChannelsManager({
  initialChannels,
}: {
  initialChannels: ChannelRow[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium">Add a channel</h2>
        </header>
        <div className="p-4 flex flex-wrap gap-2">
          {SUPPORTED_TYPES.map((t) => (
            <button
              key={t.type}
              onClick={() => setAdding(adding === t.type ? null : t.type)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                adding === t.type
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              + {t.label}
            </button>
          ))}
        </div>
        {adding && (
          <NewChannelForm
            channelType={adding}
            onCancel={() => setAdding(null)}
            onCreated={() => {
              setAdding(null)
              startTransition(() => router.refresh())
            }}
          />
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <header className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium">Configured channels ({initialChannels.length})</h2>
        </header>
        {initialChannels.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No notification channels configured yet. Add one above.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {initialChannels.map((c) => (
              <ChannelEditor key={c.id} channel={c} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function NewChannelForm({
  channelType,
  onCancel,
  onCreated,
}: {
  channelType: string
  onCancel: () => void
  onCreated: () => void
}) {
  const [config, setConfig] = useState<Record<string, string>>(() => emptyConfigFor(channelType))
  const [alertTypes, setAlertTypes] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await createChannelAction({
        channelType: channelType as 'slack',
        config,
        alertTypes,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onCreated()
    })
  }

  return (
    <div className="border-t border-gray-200 p-5 space-y-4 bg-gray-50">
      <div className="text-xs font-medium text-gray-700">
        New {channelType} channel
      </div>
      <ConfigEditor channelType={channelType} config={config} setConfig={setConfig} />
      <AlertTypesEditor alertTypes={alertTypes} setAlertTypes={setAlertTypes} />
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-black text-white px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add channel'}
        </button>
      </div>
    </div>
  )
}

function ChannelEditor({ channel }: { channel: ChannelRow }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [config, setConfig] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(channel.config ?? {}).map(([k, v]) => [k, String(v ?? '')]),
    ),
  )
  const [alertTypes, setAlertTypes] = useState<string[]>(channel.alert_types ?? [])
  const [pending, startTransition] = useTransition()
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const meta = SUPPORTED_TYPES.find((t) => t.type === channel.channel_type)

  const save = () => {
    setError(null)
    startTransition(async () => {
      const res = await updateChannelAction({
        channelId: channel.id,
        patch: { config, alert_types: alertTypes },
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEditing(false)
      router.refresh()
    })
  }

  const toggleActive = () => {
    startTransition(async () => {
      await updateChannelAction({
        channelId: channel.id,
        patch: { is_active: !channel.is_active },
      })
      router.refresh()
    })
  }

  const remove = () => {
    if (!confirm('Delete this channel? Subscribed alerts will stop firing here.')) return
    startTransition(async () => {
      await deleteChannelAction({ channelId: channel.id })
      router.refresh()
    })
  }

  const testSend = () => {
    setTestResult(null)
    startTransition(async () => {
      const res = await testSendAction({ channelId: channel.id })
      if (!res.ok) {
        setTestResult(`✗ ${res.error}`)
        return
      }
      const r = res.data
      setTestResult(
        r.ok
          ? `✓ delivered in ${r.total_latency_ms}ms (${r.attempts} attempt${r.attempts === 1 ? '' : 's'})`
          : `✗ ${r.error ?? 'unknown'} (${r.attempts} attempt${r.attempts === 1 ? '' : 's'})`,
      )
    })
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{meta?.label ?? channel.channel_type}</span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                channel.is_active
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-200 text-gray-600'
              }`}
            >
              {channel.is_active ? 'active' : 'paused'}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{meta?.help}</p>
          {channel.alert_types.length > 0 && (
            <p className="text-[11px] text-gray-600 mt-1">
              Subscribed: {channel.alert_types.join(', ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={testSend}
            disabled={pending || !channel.is_active}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs disabled:opacity-40"
          >
            Test send
          </button>
          <button
            onClick={toggleActive}
            disabled={pending}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs"
          >
            {channel.is_active ? 'Pause' : 'Activate'}
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={remove}
            className="rounded-md border border-red-200 bg-red-50 text-red-700 px-2.5 py-1 text-xs"
          >
            Delete
          </button>
        </div>
      </div>
      {testResult && (
        <p
          className={`mt-2 text-[11px] font-mono ${
            testResult.startsWith('✓') ? 'text-emerald-700' : 'text-red-600'
          }`}
        >
          {testResult}
        </p>
      )}
      {editing && (
        <div className="mt-4 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
          <ConfigEditor
            channelType={channel.channel_type}
            config={config}
            setConfig={setConfig}
          />
          <AlertTypesEditor alertTypes={alertTypes} setAlertTypes={setAlertTypes} />
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-md bg-black text-white px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function ConfigEditor({
  channelType,
  config,
  setConfig,
}: {
  channelType: string
  config: Record<string, string>
  setConfig: (c: Record<string, string>) => void
}) {
  const fields = configFieldsFor(channelType)
  return (
    <div className="space-y-2">
      {fields.map((f) => (
        <label key={f.key} className="block">
          <span className="block text-[11px] uppercase tracking-wide text-gray-600 mb-1">
            {f.label}
          </span>
          <input
            type={f.secret ? 'password' : 'text'}
            value={config[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-mono"
          />
          {f.help && <p className="mt-1 text-[10px] text-gray-500">{f.help}</p>}
        </label>
      ))}
    </div>
  )
}

function AlertTypesEditor({
  alertTypes,
  setAlertTypes,
}: {
  alertTypes: string[]
  setAlertTypes: (a: string[]) => void
}) {
  const toggle = (kind: string) => {
    const set = new Set(alertTypes)
    if (set.has(kind)) set.delete(kind)
    else set.add(kind)
    setAlertTypes(Array.from(set))
  }
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wide text-gray-600 mb-2">
        Alert types this channel receives
      </span>
      <div className="space-y-1.5">
        {ALERT_TYPES.map((t) => (
          <label
            key={t.kind}
            className="flex items-start gap-2 text-xs cursor-pointer"
          >
            <input
              type="checkbox"
              checked={alertTypes.includes(t.kind)}
              onChange={() => toggle(t.kind)}
              className="mt-0.5"
            />
            <span>
              <strong className="text-gray-800">{t.label}</strong>{' '}
              <code className="text-[10px] text-gray-500">({t.kind})</code>
              <br />
              <span className="text-gray-500">{t.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function configFieldsFor(channelType: string): Array<{
  key: string
  label: string
  placeholder: string
  secret?: boolean
  help?: string
}> {
  switch (channelType) {
    case 'slack':
    case 'teams':
    case 'discord':
      return [
        {
          key: 'webhook_url',
          label: 'Webhook URL',
          placeholder:
            channelType === 'slack'
              ? 'https://hooks.slack.com/services/T…/B…/secret'
              : channelType === 'teams'
                ? 'https://prod-XX.<region>.logic.azure.com:443/workflows/<guid>/triggers/…'
                : 'https://discord.com/api/webhooks/<id>/<token>',
          secret: true,
          help: 'Inbound webhook URL from your workspace settings.',
        },
      ]
    case 'pagerduty':
      return [
        {
          key: 'routing_key',
          label: 'Routing key (Events API v2 integration key)',
          placeholder: '32-char hex',
          secret: true,
          help: 'PagerDuty service → Integrations → Events API v2 → Integration Key.',
        },
      ]
    case 'custom_webhook':
      return [
        {
          key: 'webhook_url',
          label: 'Endpoint URL',
          placeholder: 'https://your-host/hooks/consentshield',
        },
        {
          key: 'signing_secret',
          label: 'Signing secret (≥32 chars)',
          placeholder: 'paste a high-entropy random string',
          secret: true,
          help:
            'We sign every payload with HMAC-SHA256 over `${occurred_at}.${body}` and '
            + 'send the hex digest in the X-ConsentShield-Signature header.',
        },
      ]
    default:
      return []
  }
}

function emptyConfigFor(channelType: string): Record<string, string> {
  return Object.fromEntries(configFieldsFor(channelType).map((f) => [f.key, '']))
}
