'use client'

import { useState } from 'react'
import {
  ModalShell,
  Field,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import { setFeatureFlag, deleteFeatureFlag } from '@/app/(operator)/flags/actions'

export interface FeatureFlag {
  id: string
  flag_key: string
  scope: 'global' | 'org'
  org_id: string | null
  value: unknown
  description: string
  set_by: string
  set_at: string
  expires_at: string | null
  set_by_name: string | null
  org_name: string | null
}

type ValueType = 'boolean' | 'string' | 'number'

type Modal =
  | { kind: 'create' }
  | { kind: 'edit'; flag: FeatureFlag }
  | { kind: 'delete'; flag: FeatureFlag }
  | null

export function FeatureFlagsTab({
  flags,
  orgs,
  adminRole,
}: {
  flags: FeatureFlag[]
  orgs: Array<{ id: string; name: string }>
  adminRole: 'platform_operator' | 'support' | 'read_only'
}) {
  const [modal, setModal] = useState<Modal>(null)
  const canWrite = adminRole === 'platform_operator'

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-zinc-200 p-4">
        <h3 className="text-sm font-semibold">Feature flags</h3>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator role required'}
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + New flag
        </button>
      </header>

      {flags.length === 0 ? (
        <p className="p-8 text-center text-sm text-zinc-500">
          No feature flags yet. Create one with the button above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-2">Flag key</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Org</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Set by</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} className="border-t border-zinc-200">
                  <td className="px-4 py-2 font-mono text-xs">{f.flag_key}</td>
                  <td className="px-4 py-2">{f.scope}</td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    {f.scope === 'global' ? '—' : f.org_name ?? f.org_id}
                  </td>
                  <td className="px-4 py-2">
                    <ValuePill value={f.value} />
                  </td>
                  <td className="px-4 py-2 text-xs text-zinc-600">{f.description}</td>
                  <td className="px-4 py-2 text-xs text-zinc-600">
                    {f.set_by_name ?? f.set_by.slice(0, 8)} ·{' '}
                    {new Date(f.set_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'edit', flag: f })}
                        disabled={!canWrite}
                        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'delete', flag: f })}
                        disabled={!canWrite}
                        className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'create' ? (
        <FlagFormModal
          mode="create"
          orgs={orgs}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'edit' ? (
        <FlagFormModal
          mode="edit"
          flag={modal.flag}
          orgs={orgs}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'delete' ? (
        <DeleteFlagModal flag={modal.flag} onClose={() => setModal(null)} />
      ) : null}
    </div>
  )
}

function ValuePill({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return (
      <span
        className={
          value
            ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
            : 'rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700'
        }
      >
        {value ? 'true' : 'false'}
      </span>
    )
  }
  return (
    <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs">
      {JSON.stringify(value)}
    </code>
  )
}

function FlagFormModal({
  mode,
  flag,
  orgs,
  onClose,
}: {
  mode: 'create' | 'edit'
  flag?: FeatureFlag
  orgs: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const initialType: ValueType =
    flag && typeof flag.value === 'boolean'
      ? 'boolean'
      : flag && typeof flag.value === 'number'
        ? 'number'
        : 'string'

  const [flagKey, setFlagKey] = useState(flag?.flag_key ?? '')
  const [scope, setScope] = useState<'global' | 'org'>(flag?.scope ?? 'global')
  const [orgId, setOrgId] = useState<string>(flag?.org_id ?? '')
  const [valueType, setValueType] = useState<ValueType>(initialType)
  const [boolValue, setBoolValue] = useState<boolean>(
    typeof flag?.value === 'boolean' ? flag.value : true,
  )
  const [stringValue, setStringValue] = useState<string>(
    typeof flag?.value === 'string' ? flag.value : '',
  )
  const [numberValue, setNumberValue] = useState<string>(
    typeof flag?.value === 'number' ? String(flag.value) : '',
  )
  const [description, setDescription] = useState(flag?.description ?? '')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonOk = reason.trim().length >= 10
  const keyOk = /^[a-z0-9_]+$/.test(flagKey.trim())
  const scopeOk = scope === 'global' || orgId !== ''

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    let value: Parameters<typeof setFeatureFlag>[0]['value']
    if (valueType === 'boolean') {
      value = { type: 'boolean', value: boolValue }
    } else if (valueType === 'string') {
      value = { type: 'string', value: stringValue }
    } else {
      const n = Number(numberValue)
      if (Number.isNaN(n)) {
        setPending(false)
        setError('Number value is not valid.')
        return
      }
      value = { type: 'number', value: n }
    }

    const r = await setFeatureFlag({
      flagKey: flagKey.trim(),
      scope,
      orgId: scope === 'global' ? null : orgId,
      value,
      description,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title={mode === 'create' ? 'New feature flag' : `Edit ${flag?.flag_key}`}
      subtitle="Audit-logged with reason"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Flag key (snake_case)">
          <input
            value={flagKey}
            onChange={(e) => setFlagKey(e.target.value)}
            disabled={mode === 'edit'}
            required
            placeholder="depa_dashboard_enabled"
            className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope">
            <select
              value={scope}
              onChange={(e) => {
                const next = e.target.value as 'global' | 'org'
                setScope(next)
                if (next === 'global') setOrgId('')
              }}
              disabled={mode === 'edit'}
              className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
            >
              <option value="global">global</option>
              <option value="org">org</option>
            </select>
          </Field>

          {scope === 'org' ? (
            <Field label="Organisation">
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                disabled={mode === 'edit'}
                required
                className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
              >
                <option value="">— pick —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div />
          )}
        </div>

        <Field label="Value type">
          <div className="flex gap-2">
            {(['boolean', 'string', 'number'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setValueType(t)}
                className={
                  valueType === t
                    ? 'rounded border-2 border-red-700 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800'
                    : 'rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50'
                }
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {valueType === 'boolean' ? (
          <Field label="Value">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={boolValue === true}
                  onChange={() => setBoolValue(true)}
                />
                true
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={boolValue === false}
                  onChange={() => setBoolValue(false)}
                />
                false
              </label>
            </div>
          </Field>
        ) : valueType === 'string' ? (
          <Field label="Value">
            <input
              value={stringValue}
              onChange={(e) => setStringValue(e.target.value)}
              required
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </Field>
        ) : (
          <Field label="Value">
            <input
              type="number"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
              required
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          </Field>
        )}

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            required
            placeholder="What does this flag control?"
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>

        <ReasonField reason={reason} onChange={setReason} />

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <FormFooter
          pending={pending}
          onClose={onClose}
          submit={mode === 'create' ? 'Create flag' : 'Save changes'}
          disabled={!keyOk || !scopeOk || !reasonOk || !description.trim()}
        />
      </form>
    </ModalShell>
  )
}

function DeleteFlagModal({
  flag,
  onClose,
}: {
  flag: FeatureFlag
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await deleteFeatureFlag({
      flagKey: flag.flag_key,
      scope: flag.scope,
      orgId: flag.org_id,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title={`Delete flag ${flag.flag_key}`}
      subtitle={`${flag.scope}${flag.org_name ? ` · ${flag.org_name}` : ''}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <strong>This removes the flag row.</strong> Any customer code reading
          this flag via <code>public.get_feature_flag</code> will fall through
          to the default branch.
        </div>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Delete flag"
          submitDanger
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}
