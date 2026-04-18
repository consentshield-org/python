'use client'

import { useState } from 'react'

// Rendered after a successful create_invitation RPC call. Shows the
// accept URL (the only copy the operator ever sees — the token is not
// persisted anywhere else in plaintext after this page is dismissed)
// plus the invitation id and expiry. Email dispatch lands in Phase 2.5.

export function InviteCreatedCard({
  acceptUrl,
  invitationId,
  expiresAt,
}: {
  acceptUrl: string
  invitationId: string
  expiresAt: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(acceptUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked — fall through; the URL is already visible.
    }
  }

  return (
    <div className="rounded-md border-l-4 border-teal border-[color:var(--border)] bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-text">Invite created</h3>
      <p className="mt-1 text-xs text-text-3">
        Send this URL to the invitee. The token is single-use and expires on{' '}
        <strong>{new Date(expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>.
      </p>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-3">
          Accept URL
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded border border-[color:var(--border)] bg-bg p-2 font-mono text-xs">
            {acceptUrl}
          </code>
          <button
            type="button"
            onClick={copy}
            className="rounded border border-[color:var(--border-mid)] bg-white px-3 py-1.5 text-xs text-text hover:bg-bg"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-text-3">
        <span>
          Invitation id: <code className="font-mono">{invitationId.slice(0, 8)}…</code>
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
          email dispatch pending — Phase 2.5
        </span>
      </div>
    </div>
  )
}
