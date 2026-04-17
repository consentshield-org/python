'use client'

import { useState } from 'react'
import { sendMessage } from '@/app/(operator)/support/actions'

export function ReplyForm({
  ticketId,
  canWrite,
}: {
  ticketId: string
  canWrite: boolean
}) {
  const [body, setBody] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPending(true)
    setError(null)
    const r = await sendMessage(ticketId, body, { isInternal })
    setPending(false)
    if (!r.ok) {
      setError(r.error)
    } else {
      setBody('')
      setIsInternal(false)
    }
  }

  if (!canWrite) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        Read-only role — reply form disabled.
      </div>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className={
        isInternal
          ? 'rounded-md border-2 border-amber-300 bg-amber-50 p-4 shadow-sm'
          : 'rounded-md border border-zinc-200 bg-white p-4 shadow-sm'
      }
    >
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
          {isInternal ? 'Internal note (operators only)' : 'Reply to customer'}
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={isInternal}
            onChange={(e) => setIsInternal(e.target.checked)}
          />
          Internal note
        </label>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        required
        placeholder={
          isInternal
            ? 'Private note to other operators — not visible to the customer. Audit-logged.'
            : 'Your reply will be visible to the customer. Audit-logged.'
        }
        className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          {isInternal
            ? 'Internal notes do not change ticket status.'
            : 'Sending a reply transitions status from open / awaiting_operator → awaiting_customer.'}
        </p>
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className={
            isInternal
              ? 'rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50'
              : 'rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50'
          }
        >
          {pending
            ? 'Saving…'
            : isInternal
              ? 'Save internal note'
              : 'Send reply'}
        </button>
      </div>
    </form>
  )
}
