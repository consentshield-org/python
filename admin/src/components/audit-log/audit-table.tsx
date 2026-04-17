'use client'

import { useState } from 'react'
import { AuditDetailDrawer, type AuditDetailRow } from './detail-drawer'

interface Row {
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

export function AuditTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<AuditDetailRow | null>(null)

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
        No audit entries match the current filters.
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Admin</th>
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">Org</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-t border-zinc-200 hover:bg-red-50"
                onClick={() => setSelected(row)}
              >
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">
                  {new Date(row.occurred_at).toLocaleString('en-IN', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </td>
                <td className="px-4 py-2">
                  <code className="font-mono text-xs text-red-700">{row.action}</code>
                  <div className="text-xs text-zinc-600" title={row.reason}>
                    {truncate(row.reason, 60)}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">
                  {row.display_name ?? row.admin_user_id.slice(0, 8)}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">
                  {row.target_table ?? '—'}
                  {row.target_pk ? ` · ${row.target_pk}` : ''}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-zinc-600">
                  {row.org_id ? row.org_id.slice(0, 8) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AuditDetailDrawer row={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}
