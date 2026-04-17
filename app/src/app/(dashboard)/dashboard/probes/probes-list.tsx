'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createProbe, deleteProbe, toggleProbeActive } from './actions'

interface Probe {
  id: string
  property_id: string
  probe_type: string
  consent_state: Record<string, boolean>
  schedule: string
  is_active: boolean
  last_run_at: string | null
  last_result: { overall_status?: string; violations?: number } | null
  next_run_at: string | null
}

interface Property {
  id: string
  name: string
  url: string
}

interface Props {
  isAdmin: boolean
  probes: Probe[]
  properties: Property[]
}

export function ProbesList({ isAdmin, probes, properties }: Props) {
  const [showCreate, setShowCreate] = useState(false)
  const propertyById = new Map(properties.map((p) => [p.id, p]))

  return (
    <div className="space-y-4">
      {isAdmin ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {probes.length} probe{probes.length === 1 ? '' : 's'} configured.
          </p>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            {showCreate ? 'Cancel' : '+ New probe'}
          </button>
        </div>
      ) : null}

      {showCreate && isAdmin ? (
        <CreateProbeForm
          properties={properties}
          onDone={() => setShowCreate(false)}
        />
      ) : null}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Property</th>
              <th className="px-3 py-2">Consent state</th>
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Last run</th>
              <th className="px-3 py-2">Last result</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {probes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  No probes yet.
                  {isAdmin ? ' Add one above.' : ''}
                </td>
              </tr>
            ) : (
              probes.map((p) => (
                <ProbeRow
                  key={p.id}
                  probe={p}
                  property={propertyById.get(p.property_id) ?? null}
                  isAdmin={isAdmin}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProbeRow({
  probe,
  property,
  isAdmin,
}: {
  probe: Probe
  property: Property | null
  isAdmin: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleToggle() {
    startTransition(async () => {
      const res = await toggleProbeActive(probe.id, !probe.is_active)
      if (res.error) alert(res.error)
      else router.refresh()
    })
  }
  function handleDelete() {
    if (!confirm('Delete this probe? Historical runs are preserved.')) return
    startTransition(async () => {
      const res = await deleteProbe(probe.id)
      if (res.error) alert(res.error)
      else router.refresh()
    })
  }

  return (
    <tr className={probe.is_active ? '' : 'bg-gray-50 text-gray-500'}>
      <td className="px-3 py-2">
        {property ? (
          <div>
            <div className="font-medium">{property.name}</div>
            <div className="text-xs text-gray-500 font-mono">{property.url}</div>
          </div>
        ) : (
          <span className="text-xs text-red-700">(property missing)</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {Object.entries(probe.consent_state).map(([k, v]) => (
            <span
              key={k}
              className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                v ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {k}:{v ? 'true' : 'false'}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-2 text-xs">{probe.schedule}</td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {probe.last_run_at
          ? new Date(probe.last_run_at).toLocaleString()
          : 'never'}
      </td>
      <td className="px-3 py-2 text-xs">
        {probe.last_result?.overall_status ? (
          <span
            className={`rounded px-2 py-0.5 ${
              probe.last_result.overall_status === 'ok'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {probe.last_result.overall_status}
            {typeof probe.last_result.violations === 'number'
              ? ` · ${probe.last_result.violations} violation${probe.last_result.violations === 1 ? '' : 's'}`
              : ''}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        {probe.is_active ? (
          <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">
            active
          </span>
        ) : (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            paused
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {isAdmin ? (
          <div className="flex justify-end gap-2 text-xs">
            <button
              onClick={handleToggle}
              disabled={isPending}
              className="text-gray-600 hover:text-black disabled:opacity-50"
            >
              {probe.is_active ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="text-red-700 hover:text-red-900 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function CreateProbeForm({
  properties,
  onDone,
}: {
  properties: Property[]
  onDone: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await createProbe(formData)
      if (res.error) setError(res.error)
      else {
        setError(null)
        onDone()
        router.refresh()
      }
    })
  }

  if (properties.length === 0) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        No web properties — add one under Web Properties before creating a probe.
      </div>
    )
  }

  return (
    <form
      action={handleSubmit}
      className="grid grid-cols-1 gap-3 rounded border border-gray-200 bg-gray-50 p-4 md:grid-cols-2"
    >
      <label className="text-sm">
        <span className="text-xs text-gray-600">Property</span>
        <select
          name="property_id"
          required
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.url}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-xs text-gray-600">Schedule</span>
        <select
          name="schedule"
          defaultValue="weekly"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="weekly">Weekly</option>
          <option value="daily">Daily</option>
          <option value="hourly">Hourly</option>
        </select>
      </label>
      <label className="text-sm md:col-span-2">
        <span className="text-xs text-gray-600">
          Consent state (comma-separated key:value pairs; true/false)
        </span>
        <input
          name="consent_state"
          required
          defaultValue="analytics: false, marketing: false, functional: true"
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 font-mono text-sm"
        />
      </label>
      <input type="hidden" name="probe_type" value="denied_state" />
      {error ? (
        <p className="md:col-span-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="md:col-span-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Create probe
        </button>
      </div>
    </form>
  )
}
