'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ModalShell,
  FormFooter,
  ReasonField,
} from '@/components/common/modal-form'
import {
  activateIssuerAction,
  hardDeleteIssuerAction,
  retireIssuerAction,
  updateIssuerAction,
  type UpdateIssuerPatch,
} from '../actions'

// ADR-0050 Sprint 2.1 chunk 2 — Issuer detail client side.
// Owns the editable operational-field form + activate/retire/delete
// action buttons and their modals. Owner-only for every write.

interface Issuer {
  id: string
  legal_name: string
  registered_address: string
  logo_r2_key: string | null
  signatory_name: string
  signatory_designation: string | null
  bank_account_masked: string | null
  is_active: boolean
  retired_at: string | null
}

export function IssuerDetailClient({
  issuer,
  invoiceCount,
  isOwner,
}: {
  issuer: Issuer
  invoiceCount: number
  isOwner: boolean
}) {
  const [modal, setModal] = useState<'retire' | 'delete' | null>(null)

  const canActivate = isOwner && !issuer.is_active && !issuer.retired_at
  const canRetire = isOwner && !issuer.retired_at
  const canDelete = isOwner && invoiceCount === 0

  return (
    <>
      <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">Operational — editable</h2>
          {!isOwner ? (
            <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] text-text-3">
              platform_owner required
            </span>
          ) : null}
        </header>
        <div className="p-4">
          <EditForm issuer={issuer} disabled={!isOwner} />
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border)] bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Lifecycle actions</h2>
          <p className="text-[11px] text-text-3">
            Only <code className="font-mono">platform_owner</code> can
            activate / retire / hard-delete. Hard delete is refused once
            any invoice references this issuer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActivateButton
            issuerId={issuer.id}
            disabled={!canActivate}
            disabledReason={
              !isOwner
                ? 'platform_owner required'
                : issuer.retired_at
                  ? 'cannot activate a retired issuer'
                  : issuer.is_active
                    ? 'already active'
                    : ''
            }
          />
          <button
            type="button"
            onClick={() => setModal('retire')}
            disabled={!canRetire}
            title={
              canRetire
                ? 'Retire — sets retired_at and deactivates'
                : !isOwner
                  ? 'platform_owner required'
                  : 'already retired'
            }
            className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retire
          </button>
          <button
            type="button"
            onClick={() => setModal('delete')}
            disabled={!canDelete}
            title={
              canDelete
                ? 'Hard delete — removes the row entirely'
                : invoiceCount > 0
                  ? 'cannot delete — invoices reference this issuer'
                  : 'platform_owner required'
            }
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Hard delete
          </button>
        </div>
      </section>

      {modal === 'retire' ? (
        <RetireModal issuerId={issuer.id} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'delete' ? (
        <DeleteModal issuerId={issuer.id} onClose={() => setModal(null)} />
      ) : null}
    </>
  )
}

function EditForm({ issuer, disabled }: { issuer: Issuer; disabled: boolean }) {
  const router = useRouter()
  const [address, setAddress] = useState(issuer.registered_address)
  const [signatory, setSignatory] = useState(issuer.signatory_name)
  const [designation, setDesignation] = useState(issuer.signatory_designation ?? '')
  const [bank, setBank] = useState(issuer.bank_account_masked ?? '')
  const [logo, setLogo] = useState(issuer.logo_r2_key ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty =
    address !== issuer.registered_address ||
    signatory !== issuer.signatory_name ||
    designation !== (issuer.signatory_designation ?? '') ||
    bank !== (issuer.bank_account_masked ?? '') ||
    logo !== (issuer.logo_r2_key ?? '')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    setSaved(false)
    const patch: UpdateIssuerPatch = {}
    if (address !== issuer.registered_address) patch.registeredAddress = address
    if (signatory !== issuer.signatory_name) patch.signatoryName = signatory
    if (designation !== (issuer.signatory_designation ?? ''))
      patch.signatoryDesignation = designation || null
    if (bank !== (issuer.bank_account_masked ?? ''))
      patch.bankAccountMasked = bank || null
    if (logo !== (issuer.logo_r2_key ?? ''))
      patch.logoR2Key = logo || null

    const r = await updateIssuerAction(issuer.id, patch)
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[11px] text-text-3">Registered address</span>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={disabled}
          rows={3}
          className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-text-3">Signatory name</span>
          <input
            value={signatory}
            onChange={(e) => setSignatory(e.target.value)}
            disabled={disabled}
            className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-text-3">Designation</span>
          <input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            disabled={disabled}
            className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 text-sm disabled:bg-bg"
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-[11px] text-text-3">Bank (masked)</span>
        <input
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          disabled={disabled}
          className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm disabled:bg-bg"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] text-text-3">Logo R2 key</span>
        <input
          value={logo}
          onChange={(e) => setLogo(e.target.value)}
          disabled={disabled}
          placeholder="e.g. issuers/<id>/logo.png"
          className="w-full rounded border border-[color:var(--border-mid)] px-3 py-1.5 font-mono text-sm disabled:bg-bg"
        />
      </label>
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : saved ? (
        <p className="text-xs text-green-700">Saved.</p>
      ) : null}
      {!disabled ? (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || !dirty}
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : null}
    </form>
  )
}

function ActivateButton({
  issuerId,
  disabled,
  disabledReason,
}: {
  issuerId: string
  disabled: boolean
  disabledReason: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setPending(true)
    setError(null)
    const r = await activateIssuerAction(issuerId)
    setPending(false)
    if (!r.ok) setError(r.error)
    else router.refresh()
  }
  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={disabled || pending}
        title={disabled ? disabledReason : 'Activate this issuer'}
        className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Activating…' : 'Activate'}
      </button>
      {error ? <span className="text-[11px] text-red-700">{error}</span> : null}
    </>
  )
}

function RetireModal({
  issuerId,
  onClose,
}: {
  issuerId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await retireIssuerAction(issuerId, reason)
    setPending(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onClose()
    router.refresh()
  }
  return (
    <ModalShell
      title="Retire issuer"
      subtitle="Sets retired_at and deactivates. Invoices referencing this issuer keep their lineage."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Retire"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function DeleteModal({
  issuerId,
  onClose,
}: {
  issuerId: string
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await hardDeleteIssuerAction(issuerId)
    setPending(false)
    // hardDeleteIssuerAction redirects on success; if we're still here,
    // the RPC raised (likely invoice FK).
    if (r && !r.ok) setError(r.error)
  }
  return (
    <ModalShell
      title="Hard delete issuer"
      subtitle="Removes the row entirely. Refused if any invoice references this issuer."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <p className="text-sm text-red-800">
          This cannot be undone. Continue only for dev-state cleanup.
        </p>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Hard delete"
          submitDanger
          disabled={false}
        />
      </form>
    </ModalShell>
  )
}
