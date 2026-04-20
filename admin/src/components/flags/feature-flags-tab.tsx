'use client'

import { useState } from 'react'
import {
  ModalShell,
  Field,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import { setFeatureFlag, deleteFeatureFlag } from '@/app/(operator)/flags/actions'
import { canOperate, type AdminRole } from '@/lib/admin/role-tiers'

export interface FeatureFlag {
  id: string
  flag_key: string
  scope: 'global' | 'account' | 'org'
  org_id: string | null
  account_id: string | null
  value: unknown
  description: string
  set_by: string
  set_at: string
  expires_at: string | null
  set_by_name: string | null
  org_name: string | null
  account_name: string | null
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
  accounts,
  adminRole,
}: {
  flags: FeatureFlag[]
  orgs: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; name: string }>
  adminRole: AdminRole
}) {
  const [modal, setModal] = useState<Modal>(null)
  const canWrite = canOperate(adminRole)

  return (
    <div className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-[color:var(--border)] p-4">
        <h3 className="text-sm font-semibold">Feature flags</h3>
        <button
          type="button"
          onClick={() => setModal({ kind: 'create' })}
          disabled={!canWrite}
          title={canWrite ? undefined : 'platform_operator role required'}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid disabled:cursor-not-allowed disabled:opacity-50"
        >
          + New flag
        </button>
      </header>

      {flags.length === 0 ? (
        <p className="p-8 text-center text-sm text-text-3">
          No feature flags yet. Create one with the button above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
              <tr>
                <th className="px-4 py-2">Flag key</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Target</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Set by</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} className="border-t border-[color:var(--border)]">
                  <td className="px-4 py-2 font-mono text-xs">{f.flag_key}</td>
                  <td className="px-4 py-2">
                    <ScopePill scope={f.scope} />
                  </td>
                  <td className="px-4 py-2 text-xs text-text-2">
                    {f.scope === 'global'
                      ? '—'
                      : f.scope === 'account'
                        ? f.account_name ?? f.account_id
                        : f.org_name ?? f.org_id}
                  </td>
                  <td className="px-4 py-2">
                    <ValuePill value={f.value} />
                  </td>
                  <td className="px-4 py-2 text-xs text-text-2">{f.description}</td>
                  <td className="px-4 py-2 text-xs text-text-2">
                    {f.set_by_name ?? f.set_by.slice(0, 8)} ·{' '}
                    {new Date(f.set_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setModal({ kind: 'edit', flag: f })}
                        disabled={!canWrite}
                        className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-xs text-text-2 hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
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
          accounts={accounts}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'edit' ? (
        <FlagFormModal
          mode="edit"
          flag={modal.flag}
          orgs={orgs}
          accounts={accounts}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'delete' ? (
        <DeleteFlagModal flag={modal.flag} onClose={() => setModal(null)} />
      ) : null}
    </div>
  )
}

function ScopePill({ scope }: { scope: 'global' | 'account' | 'org' }) {
  const cls =
    scope === 'global'
      ? 'bg-[color:var(--border)] text-text-2'
      : scope === 'account'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-sky-100 text-sky-800'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {scope}
    </span>
  )
}

function ValuePill({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return (
      <span
        className={
          value
            ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
            : 'rounded-full bg-[color:var(--border)] px-2 py-0.5 text-xs font-medium text-text-2'
        }
      >
        {value ? 'true' : 'false'}
      </span>
    )
  }
  return (
    <code className="rounded bg-bg px-2 py-0.5 text-xs">
      {JSON.stringify(value)}
    </code>
  )
}

function FlagFormModal({
  mode,
  flag,
  orgs,
  accounts,
  onClose,
}: {
  mode: 'create' | 'edit'
  flag?: FeatureFlag
  orgs: Array<{ id: string; name: string }>
  accounts: Array<{ id: string; name: string }>
  onClose: () => void
}) {
  const initialType: ValueType =
    flag && typeof flag.value === 'boolean'
      ? 'boolean'
      : flag && typeof flag.value === 'number'
        ? 'number'
        : 'string'

  const [flagKey, setFlagKey] = useState(flag?.flag_key ?? '')
  const [scope, setScope] = useState<'global' | 'account' | 'org'>(
    flag?.scope ?? 'global',
  )
  const [orgId, setOrgId] = useState<string>(flag?.org_id ?? '')
  const [accountId, setAccountId] = useState<string>(flag?.account_id ?? '')
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
  const scopeOk =
    scope === 'global'
      ? true
      : scope === 'org'
        ? orgId !== ''
        : accountId !== ''

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
      orgId: scope === 'org' ? orgId : null,
      accountId: scope === 'account' ? accountId : null,
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
            className="rounded border border-[color:var(--border-mid)] px-3 py-2 font-mono text-sm disabled:bg-bg disabled:text-text-3"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Scope">
            <select
              value={scope}
              onChange={(e) => {
                const next = e.target.value as 'global' | 'account' | 'org'
                setScope(next)
                if (next !== 'org') setOrgId('')
                if (next !== 'account') setAccountId('')
              }}
              disabled={mode === 'edit'}
              className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm disabled:bg-bg disabled:text-text-3"
            >
              <option value="global">global</option>
              <option value="account">account</option>
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
                className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm disabled:bg-bg disabled:text-text-3"
              >
                <option value="">— pick —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : scope === 'account' ? (
            <Field label="Account">
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={mode === 'edit'}
                required
                className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm disabled:bg-bg disabled:text-text-3"
              >
                <option value="">— pick —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
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
                    : 'rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text-2 hover:bg-bg'
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
              className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
            />
          </Field>
        ) : (
          <Field label="Value">
            <input
              type="number"
              value={numberValue}
              onChange={(e) => setNumberValue(e.target.value)}
              required
              className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
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
            className="rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm"
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
      accountId: flag.account_id,
      reason,
    })
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title={`Delete flag ${flag.flag_key}`}
      subtitle={`${flag.scope}${
        flag.scope === 'org' && flag.org_name
          ? ` · ${flag.org_name}`
          : flag.scope === 'account' && flag.account_name
            ? ` · ${flag.account_name}`
            : ''
      }`}
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
