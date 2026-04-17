'use client'

import { useState } from 'react'
import {
  ModalShell,
  Field,
  ReasonField,
  FormFooter,
} from '@/components/common/modal-form'
import {
  changeStatus,
  changePriority,
  assignTicket,
} from '@/app/(operator)/support/actions'

const STATUSES = [
  'open',
  'awaiting_customer',
  'awaiting_operator',
  'resolved',
  'closed',
] as const

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

type Modal =
  | { kind: 'status'; next: string }
  | { kind: 'priority'; next: string }
  | { kind: 'assign' }
  | null

export function TicketControls({
  ticketId,
  currentStatus,
  currentPriority,
  currentAssignee,
  admins,
  canWrite,
}: {
  ticketId: string
  currentStatus: string
  currentPriority: string
  currentAssignee: string | null
  admins: Array<{ id: string; display_name: string }>
  canWrite: boolean
}) {
  const [modal, setModal] = useState<Modal>(null)

  const currentAssigneeName =
    admins.find((a) => a.id === currentAssignee)?.display_name ?? null

  return (
    <>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ControlCard label="Status">
          <select
            value={currentStatus}
            disabled={!canWrite}
            onChange={(e) => setModal({ kind: 'status', next: e.target.value })}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </ControlCard>

        <ControlCard label="Priority">
          <select
            value={currentPriority}
            disabled={!canWrite}
            onChange={(e) =>
              setModal({ kind: 'priority', next: e.target.value })
            }
            className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </ControlCard>

        <ControlCard label="Assignee">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-zinc-800">
              {currentAssigneeName ?? <span className="text-zinc-400">—</span>}
            </span>
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => setModal({ kind: 'assign' })}
              className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change
            </button>
          </div>
        </ControlCard>
      </section>

      {modal?.kind === 'status' ? (
        <StatusModal
          ticketId={ticketId}
          from={currentStatus}
          to={modal.next}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'priority' ? (
        <PriorityModal
          ticketId={ticketId}
          from={currentPriority}
          to={modal.next}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal?.kind === 'assign' ? (
        <AssignModal
          ticketId={ticketId}
          currentAssignee={currentAssignee}
          admins={admins}
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  )
}

function ControlCard({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function StatusModal({
  ticketId,
  from,
  to,
  onClose,
}: {
  ticketId: string
  from: string
  to: string
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
    const r = await changeStatus(ticketId, to, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Change status"
      subtitle={`${from.replace(/_/g, ' ')} → ${to.replace(/_/g, ' ')}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Change status"
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}

function PriorityModal({
  ticketId,
  from,
  to,
  onClose,
}: {
  ticketId: string
  from: string
  to: string
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
    const r = await changePriority(ticketId, to, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Change priority"
      subtitle={`${from} → ${to}`}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Change priority"
          disabled={!reasonOk}
        />
      </form>
    </ModalShell>
  )
}

function AssignModal({
  ticketId,
  currentAssignee,
  admins,
  onClose,
}: {
  ticketId: string
  currentAssignee: string | null
  admins: Array<{ id: string; display_name: string }>
  onClose: () => void
}) {
  const [assignee, setAssignee] = useState<string>(currentAssignee ?? '')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 10
  const changed = assignee !== (currentAssignee ?? '')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!assignee) {
      setError('Pick an assignee.')
      return
    }
    setPending(true)
    setError(null)
    const r = await assignTicket(ticketId, assignee, reason)
    setPending(false)
    if (!r.ok) setError(r.error)
    else onClose()
  }

  return (
    <ModalShell
      title="Assign ticket"
      subtitle="Audit-logged"
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-4 p-4">
        <Field label="Assignee">
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            required
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">— pick —</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
        </Field>
        <ReasonField reason={reason} onChange={setReason} />
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <FormFooter
          pending={pending}
          onClose={onClose}
          submit="Assign"
          disabled={!reasonOk || !changed || !assignee}
        />
      </form>
    </ModalShell>
  )
}
