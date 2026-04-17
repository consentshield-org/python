'use client'

import { useState } from 'react'
import {
  addOrgNote,
  extendTrial,
  suspendOrg,
  restoreOrg,
} from '../../app/(operator)/orgs/[orgId]/actions'
import { StartImpersonationDrawer } from '../impersonation/start-drawer'
import {
  ModalShell,
  Field,
  ReasonField,
  FormFooter,
} from '../common/modal-form'

interface Props {
  orgId: string
  orgName: string
  status: string
  currentAdminRole: 'platform_operator' | 'support' | 'read_only'
}

type Modal = 'note' | 'trial' | 'suspend' | 'restore' | null

export function OrgActionBar({ orgId, orgName, status, currentAdminRole }: Props) {
  const [modal, setModal] = useState<Modal>(null)

  const isPlatformOperator = currentAdminRole === 'platform_operator'

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setModal('note')}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50"
        >
          Add note
        </button>
        <button
          type="button"
          onClick={() => setModal('trial')}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50"
        >
          Extend trial
        </button>
        {status === 'active' ? (
          <button
            type="button"
            onClick={() => setModal('suspend')}
            disabled={!isPlatformOperator}
            title={
              isPlatformOperator
                ? undefined
                : 'platform_operator role required'
            }
            className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
          >
            Suspend
          </button>
        ) : status === 'suspended' ? (
          <button
            type="button"
            onClick={() => setModal('restore')}
            disabled={!isPlatformOperator}
            title={
              isPlatformOperator
                ? undefined
                : 'platform_operator role required'
            }
            className="rounded border border-green-600 bg-white px-3 py-1.5 text-xs text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400"
          >
            Restore
          </button>
        ) : null}
        <StartImpersonationDrawer orgId={orgId} orgName={orgName} />
      </div>

      {modal === 'note' ? (
        <AddNoteModal
          orgId={orgId}
          orgName={orgName}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'trial' ? (
        <ExtendTrialModal
          orgId={orgId}
          orgName={orgName}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'suspend' ? (
        <SuspendModal
          orgId={orgId}
          orgName={orgName}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === 'restore' ? (
        <RestoreModal
          orgId={orgId}
          orgName={orgName}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  )
}

function AddNoteModal({
  orgId,
  orgName,
  onClose,
}: {
  orgId: string
  orgName: string
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await addOrgNote(orgId, body, pinned)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Add operator note"
      subtitle={`on ${orgName}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          placeholder="Note body — visible to all operators"
          rows={4}
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          Pin this note to the top of the Operator notes list
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter pending={pending} onClose={onClose} submit="Save note" />
      </form>
    </ModalShell>
  )
}

function ExtendTrialModal({
  orgId,
  orgName,
  onClose,
}: {
  orgId: string
  orgName: string
  onClose: () => void
}) {
  const defaultEnd = new Date()
  defaultEnd.setDate(defaultEnd.getDate() + 14)
  const [date, setDate] = useState(defaultEnd.toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonOk = reason.trim().length >= 10

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const r = await extendTrial(orgId, `${date}T23:59:59.999Z`, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Extend trial"
      subtitle={`on ${orgName}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="New trial end date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Extend trial"
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}

function SuspendModal({
  orgId,
  orgName,
  onClose,
}: {
  orgId: string
  orgName: string
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
    const r = await suspendOrg(orgId, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Suspend organisation"
      subtitle={`on ${orgName} — Worker serves no-op banner until restored`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          <strong>Privileged action.</strong> Suspension takes effect within 1
          minute (admin-config-to-kv cron). Customer dashboard displays a
          suspension banner; Worker serves the no-op JS.
        </div>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Suspend"
          submitDanger
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}

function RestoreModal({
  orgId,
  orgName,
  onClose,
}: {
  orgId: string
  orgName: string
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
    const r = await restoreOrg(orgId, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Restore organisation"
      subtitle={`on ${orgName} — Worker resumes banner delivery within 1 minute`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Restore"
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}

