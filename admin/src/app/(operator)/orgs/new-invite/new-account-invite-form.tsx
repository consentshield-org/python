'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field } from '@/components/common/modal-form'
import { InviteCreatedCard } from '@/components/orgs/invite-created-card'
import { createAccountInvite, type CreateInviteResult } from './actions'

export interface PlanOption {
  planCode: string
  displayName: string
  basePriceInr: number | null
  trialDays: number
}

export function NewAccountInviteForm({ plans }: { plans: PlanOption[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [planCode, setPlanCode] = useState(plans[0]?.planCode ?? 'growth')
  const [trialOverride, setTrialOverride] = useState<string>('')
  const [defaultOrgName, setDefaultOrgName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState(14)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<CreateInviteResult | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setResult(null)
    const r = await createAccountInvite({
      email,
      planCode,
      trialDaysOverride:
        trialOverride.trim() === '' ? null : Number.parseInt(trialOverride, 10),
      defaultOrgName: defaultOrgName.trim() || null,
      expiresInDays,
    })
    setPending(false)
    setResult(r)
  }

  const selectedPlan = plans.find((p) => p.planCode === planCode)

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
              setDefaultOrgName('')
              setTrialOverride('')
              setResult(null)
            }}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
          >
            Create another
          </button>
          <button
            type="button"
            onClick={() => router.push('/orgs')}
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-mid"
          >
            Back to organisations
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
            placeholder="founder@acme.in"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <p className="text-[11px] text-text-3">
          The invitee receives an OTP-gated <code>/signup</code> link. On accept they become the <strong>account_owner</strong>.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm md:grid-cols-2">
        <Field label="Plan">
          <select
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          >
            {plans.map((p) => (
              <option key={p.planCode} value={p.planCode}>
                {p.displayName}
                {p.basePriceInr !== null ? ` — ₹${p.basePriceInr}/mo` : ' — custom'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trial days (override)">
          <input
            type="number"
            min={0}
            max={90}
            value={trialOverride}
            onChange={(e) => setTrialOverride(e.target.value)}
            placeholder={String(selectedPlan?.trialDays ?? 0)}
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
      </section>

      <section className="rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm space-y-3">
        <Field label="Default organisation name">
          <input
            type="text"
            value={defaultOrgName}
            onChange={(e) => setDefaultOrgName(e.target.value)}
            placeholder="Acme Technologies Pvt Ltd"
            className="rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <p className="text-[11px] text-text-3">
          Optional. When set, an <code>organisations</code> row with this name is created at accept time. When blank, the invitee is prompted for an org name in signup.
        </p>
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
          onClick={() => router.push('/orgs')}
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
