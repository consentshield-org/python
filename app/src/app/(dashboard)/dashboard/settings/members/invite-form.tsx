'use client'

import { useState } from 'react'
import { inviteMember, type InviteResult } from './actions'

type Role = 'account_owner' | 'account_viewer' | 'org_admin' | 'admin' | 'viewer'

export interface OrgOption {
  id: string
  name: string
}

export function InviteForm({
  accountId,
  orgs,
  allowedRoles,
  defaultOrgId,
}: {
  accountId: string
  orgs: OrgOption[]
  allowedRoles: Role[]
  defaultOrgId: string
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>(allowedRoles[0])
  const [orgId, setOrgId] = useState(defaultOrgId)
  const [expiresInDays, setExpiresInDays] = useState(14)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<InviteResult | null>(null)

  const isOrgScoped = role === 'org_admin' || role === 'admin' || role === 'viewer'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setResult(null)
    const r = await inviteMember({
      email,
      role,
      accountId,
      orgId: isOrgScoped ? orgId : null,
      expiresInDays,
    })
    setPending(false)
    setResult(r)
    if (r.ok) {
      setEmail('')
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded border border-gray-200 bg-gray-50 p-4 space-y-3"
    >
      <h3 className="text-sm font-semibold">Invite a new member</h3>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-gray-700">Email</span>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="newmember@acme.in"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-gray-700">Role</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          {allowedRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </label>

      {isOrgScoped ? (
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-gray-700">Organisation</span>
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-gray-700">Expires in (days)</span>
        <input
          type="number"
          min={1}
          max={90}
          value={expiresInDays}
          onChange={(e) =>
            setExpiresInDays(Number.parseInt(e.target.value, 10) || 14)
          }
          className="w-24 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
      </label>

      {result?.ok === false ? (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {result.error}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="rounded border border-green-300 bg-green-50 p-3 text-xs text-green-900 space-y-2">
          <div>Invite created. Send this URL to the invitee:</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-green-200 bg-white px-2 py-1 font-mono text-[11px]">
              {result.acceptUrl}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(result.acceptUrl)}
              className="rounded border border-green-300 bg-white px-2 py-1 text-[11px] hover:bg-green-100"
            >
              Copy
            </button>
          </div>
          <div className="text-[11px] text-green-700">
            Expires{' '}
            {new Date(result.expiresAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            . Email has been queued via Resend — if it doesn&apos;t arrive, share the URL above manually.
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create invite'}
        </button>
      </div>
    </form>
  )
}

function roleLabel(r: Role): string {
  switch (r) {
    case 'account_owner':
      return 'account_owner — full control of billing + all orgs'
    case 'account_viewer':
      return 'account_viewer — read-only, all orgs'
    case 'org_admin':
      return 'org_admin — full control of one org'
    case 'admin':
      return 'admin — write within one org'
    case 'viewer':
      return 'viewer — read within one org'
  }
}
