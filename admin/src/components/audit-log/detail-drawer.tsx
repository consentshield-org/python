'use client'

import { useEffect } from 'react'

export interface AuditDetailRow {
  id: number
  occurred_at: string
  admin_user_id: string
  display_name: string | null
  action: string
  target_table: string | null
  target_id: string | null
  target_pk: string | null
  org_id: string | null
  impersonation_session_id: string | null
  old_value: unknown
  new_value: unknown
  reason: string
  request_ip: string | null
  request_ua: string | null
  api_route: string | null
}

export function AuditDetailDrawer({
  row,
  onClose,
}: {
  row: AuditDetailRow | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-red-50 p-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-red-700">
              Audit entry #{row.id}
            </p>
            <h3 className="mt-1 text-base font-semibold">{row.action}</h3>
            <p className="text-xs text-zinc-600">
              {new Date(row.occurred_at).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'medium',
              })}{' '}
              · by{' '}
              <span className="font-medium">
                {row.display_name ?? row.admin_user_id.slice(0, 8)}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
          >
            Close (Esc)
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <Row label="Reason">{row.reason}</Row>
          <Row label="Target table">
            {row.target_table ? (
              <code className="font-mono text-xs">{row.target_table}</code>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </Row>
          <Row label="Target id">
            {row.target_id ? (
              <code className="font-mono text-xs">{row.target_id}</code>
            ) : row.target_pk ? (
              <code className="font-mono text-xs">{row.target_pk}</code>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </Row>
          <Row label="Org id">
            {row.org_id ? (
              <code className="font-mono text-xs">{row.org_id}</code>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </Row>
          <Row label="Impersonation session">
            {row.impersonation_session_id ? (
              <code className="font-mono text-xs">{row.impersonation_session_id}</code>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </Row>
          <Row label="API route / IP / UA">
            <div className="space-y-1 text-xs text-zinc-600">
              <div>route: {row.api_route ?? '—'}</div>
              <div>ip: {row.request_ip ?? '—'}</div>
              <div className="truncate">ua: {row.request_ua ?? '—'}</div>
            </div>
          </Row>

          <section>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              old_value
            </p>
            <JsonBlock value={row.old_value} />
          </section>

          <section>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
              new_value
            </p>
            <JsonBlock value={row.new_value} />
          </section>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 border-b border-zinc-100 pb-2">
      <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null)
    return <span className="text-xs text-zinc-400">null</span>
  return (
    <pre className="max-h-80 overflow-x-auto overflow-y-auto rounded bg-zinc-950 p-3 text-xs text-zinc-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
