'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field } from '@/components/common/modal-form'
import { InviteCreatedCard } from '@/components/orgs/invite-created-card'
import { createOrgAdminInvite, type CreateInviteResult } from './actions'

export function OrgAdminInviteForm({
  orgId,
  accountId,
}: {
  orgId: string
  accountId: string
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(14)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<CreateInviteResult | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setResult(null)
    const r = await createOrgAdminInvite({
      orgId,
      accountId,
      email,
      expiresInDays,
    })
    setPending(false)
    setResult(r)
  }

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <InviteCreatedCard
          acceptUrl={result.acceptUrl}
          invitationId={result.invitationId}
          expiresAt={result.expiresAt}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEmail('')
              setResult(null)
            }}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
          >
            Invite another
          </button>
          <button
            type="button"
            onClick={() => router.push(`/orgs/${orgId}`)}
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid"
          >
            Back to organisation
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm space-y-3">
        <Field label="Invitee email">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@acme.in"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <p className="text-[11px] text-text-3">
          If the invitee already has a ConsentShield login, accept skips OTP and only inserts the <code>org_memberships</code> row.
        </p>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-text-3">
          Role
        </div>
        <div className="flex items-center gap-2 rounded border border-[color:var(--border)] bg-bg px-3 py-2">
          <span className="rounded-full bg-navy px-2 py-0.5 text-[11px] font-medium text-white">
            org_admin
          </span>
          <span className="text-[11px] text-text-3">
            Fixed. <code>admin</code> and <code>viewer</code> invites are issued from the customer dashboard by the org admin.
          </span>
        </div>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <Field label="Invitation expires in (days)">
          <input
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number.parseInt(e.target.value, 10) || 14)}
            className="w-32 rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
      </section>

      {result?.ok === false ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {result.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push(`/orgs/${orgId}`)}
          className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs text-text-2 hover:bg-bg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create invite'}
        </button>
      </div>
    </form>
  )
}
