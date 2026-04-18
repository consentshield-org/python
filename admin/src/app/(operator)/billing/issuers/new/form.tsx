'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createIssuerAction } from '../actions'

// ADR-0050 Sprint 2.1 chunk 2 — New issuer form (client).

export function NewIssuerForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [legalName, setLegalName] = useState('')
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [state, setState] = useState('')
  const [address, setAddress] = useState('')
  const [prefix, setPrefix] = useState('')
  const [fyStart, setFyStart] = useState('4')
  const [signatory, setSignatory] = useState('')
  const [designation, setDesignation] = useState('')
  const [bankMasked, setBankMasked] = useState('')

  const ok =
    legalName.trim().length > 0 &&
    gstin.trim().length === 15 &&
    pan.trim().length === 10 &&
    state.trim().length >= 2 &&
    state.trim().length <= 4 &&
    address.trim().length > 0 &&
    prefix.trim().length >= 1 &&
    prefix.trim().length <= 10 &&
    Number(fyStart) >= 1 &&
    Number(fyStart) <= 12 &&
    signatory.trim().length > 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await createIssuerAction({
      legalName,
      gstin,
      pan,
      registeredStateCode: state,
      registeredAddress: address,
      invoicePrefix: prefix,
      fyStartMonth: Number(fyStart),
      signatoryName: signatory,
      signatoryDesignation: designation || null,
      bankAccountMasked: bankMasked || null,
      logoR2Key: null,
    })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    router.push(`/billing/issuers/${r.data!.issuerId}`)
    router.refresh()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm"
    >
      <Fieldset title="Identity — immutable once saved">
        <Field label="Legal name">
          <input
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            required
            maxLength={200}
            className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GSTIN (15 chars)">
            <input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              required
              minLength={15}
              maxLength={15}
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
            />
          </Field>
          <Field label="PAN (10 chars)">
            <input
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              required
              minLength={10}
              maxLength={10}
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
            />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="State code (2-digit GST)">
            <input
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              required
              minLength={2}
              maxLength={4}
              placeholder="29"
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
            />
          </Field>
          <Field label="Invoice prefix">
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              required
              minLength={1}
              maxLength={10}
              placeholder="CS"
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
            />
          </Field>
          <Field label="FY start month (1–12)">
            <input
              value={fyStart}
              onChange={(e) => setFyStart(e.target.value)}
              type="number"
              min={1}
              max={12}
              required
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
            />
          </Field>
        </div>
      </Fieldset>

      <Fieldset title="Operational — editable later">
        <Field label="Registered address">
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            rows={3}
            className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Signatory name">
            <input
              value={signatory}
              onChange={(e) => setSignatory(e.target.value)}
              required
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
            />
          </Field>
          <Field label="Signatory designation">
            <input
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="Director"
              className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm"
            />
          </Field>
        </div>
        <Field label="Bank account (masked — last 4)">
          <input
            value={bankMasked}
            onChange={(e) => setBankMasked(e.target.value)}
            placeholder="**** 1234"
            className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm"
          />
        </Field>
      </Fieldset>

      {error ? (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push('/billing/issuers')}
          disabled={pending}
          className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs hover:bg-bg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!ok || pending}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create issuer'}
        </button>
      </div>
    </form>
  )
}

function Fieldset({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 rounded-md border border-[color:var(--border)] bg-bg/30 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-text-3">{label}</span>
      {children}
    </label>
  )
}
