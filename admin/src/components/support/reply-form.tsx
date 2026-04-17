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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setPending(true)
    setError(null)
    const r = await sendMessage(ticketId, body)
    setPending(false)
    if (!r.ok) {
      setError(r.error)
    } else {
      setBody('')
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
      className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <label className="block text-xs font-medium uppercase tracking-wider text-zinc-500">
        Reply to customer
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        required
        placeholder="Your reply will be visible to the customer. Audit-logged."
        className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Sending a reply also transitions status from open / awaiting_operator →
          awaiting_customer.
        </p>
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send reply'}
        </button>
      </div>
    </form>
  )
}
