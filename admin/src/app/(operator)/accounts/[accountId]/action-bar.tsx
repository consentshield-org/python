'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FormFooter,
  ModalShell,
  ReasonField,
} from '@/components/common/modal-form'
import { restoreAccountAction, suspendAccountAction } from '../actions'

// ADR-0048 Sprint 1.2 — Account detail action bar.

export function AccountActionBar({
  accountId,
  status,
  canWrite,
}: {
  accountId: string
  status: string
  canWrite: boolean
}) {
  const [modal, setModal] = useState<null | 'suspend' | 'restore'>(null)
  const isSuspended = status === 'suspended'

  return (
    <div className="flex gap-2">
      {isSuspended ? (
        <button
          type="button"
          onClick={() => setModal('restore')}
          disabled={!canWrite}
          title={canWrite ? 'Restore account + child orgs' : 'platform_operator required'}
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Restore
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setModal('suspend')}
          disabled={!canWrite}
          title={canWrite ? 'Suspend account + fan out to child orgs' : 'platform_operator required'}
          className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Suspend
        </button>
      )}

      {modal === 'suspend' ? (
        <SuspendModal accountId={accountId} onClose={() => setModal(null)} />
      ) : null}
      {modal === 'restore' ? (
        <RestoreModal accountId={accountId} onClose={() => setModal(null)} />
      ) : null}
    </div>
  )
}

function SuspendModal({
  accountId,
  onClose,
}: {
  accountId: string
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
    const r = await suspendAccountAction({ accountId, reason })
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
      title="Suspend account"
      subtitle="Sets accounts.status=suspended and flips every currently-active child org to suspended. Worker stops serving the account's banner on the next KV sync (~2 min). Restore reverses the fan-out set captured at suspend time."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Suspend"
          submitDanger
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}

function RestoreModal({
  accountId,
  onClose,
}: {
  accountId: string
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
    const r = await restoreAccountAction({ accountId, reason })
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
      title="Restore account"
      subtitle="Sets accounts.status=active and restores only the orgs captured in the most recent suspend audit row. Orgs suspended separately (e.g., operator-disabled individually) stay suspended."
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Restore"
          disabled={!ok}
        />
      </form>
    </ModalShell>
  )
}
