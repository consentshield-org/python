'use client'

import { useState, useTransition } from 'react'

import { generateGstStatement } from './actions'

interface IssuerOption {
  id: string
  legal_name: string
  gstin: string
  is_active: boolean
  retired_at: string | null
}

interface Summary {
  count: number
  subtotal_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
}

interface StatementEnvelope {
  summary: Summary
  csv: string
  filename: string
}

export function GstStatementForm({
  isOwner,
  selectableIssuers,
  activeIssuerId,
}: {
  isOwner: boolean
  selectableIssuers: IssuerOption[]
  activeIssuerId: string | null
}) {
  const defaultIssuer = isOwner ? '' : activeIssuerId ?? ''
  const todayFyStart = indianFyStart(new Date())
  const todayFyEnd = indianFyEnd(todayFyStart)

  const [issuerId, setIssuerId] = useState(defaultIssuer)
  const [fyStart, setFyStart] = useState(todayFyStart)
  const [fyEnd, setFyEnd] = useState(todayFyEnd)
  const [result, setResult] = useState<StatementEnvelope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await generateGstStatement({
        issuerId: issuerId || null,
        fyStart,
        fyEnd,
      })
      if ('error' in res) {
        setError(res.error)
      } else {
        setResult(res)
      }
    })
  }

  function onDownload() {
    if (!result) return
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), result.csv], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">Generate</h2>
      </header>
      <form onSubmit={onSubmit} className="space-y-3 p-4">
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Issuer</span>
          <select
            value={issuerId}
            onChange={(e) => setIssuerId(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
          >
            {isOwner ? (
              <option value="">All issuers (owner)</option>
            ) : null}
            {selectableIssuers.map((iss) => (
              <option key={iss.id} value={iss.id}>
                {iss.legal_name} — {iss.gstin}
                {iss.is_active ? ' (active)' : iss.retired_at ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col text-[11px] text-text-3">
            <span className="mb-1">FY start</span>
            <input
              type="date"
              value={fyStart}
              onChange={(e) => setFyStart(e.target.value)}
              className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
              required
            />
          </label>
          <label className="flex flex-col text-[11px] text-text-3">
            <span className="mb-1">FY end</span>
            <input
              type="date"
              value={fyEnd}
              onChange={(e) => setFyEnd(e.target.value)}
              className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
              required
            />
          </label>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || (!isOwner && !issuerId)}
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:opacity-50"
          >
            {pending ? 'Generating…' : 'Generate'}
          </button>
        </div>

        {error ? (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <div className="border-t border-[color:var(--border)] px-4 py-4">
          <h3 className="text-sm font-semibold">Summary</h3>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
            <Stat label="Invoices" value={result.summary.count} />
            <Stat label="Taxable" value={rupees(result.summary.subtotal_paise)} />
            <Stat label="Total" value={rupees(result.summary.total_paise)} />
            <Stat label="CGST" value={rupees(result.summary.cgst_paise)} />
            <Stat label="SGST" value={rupees(result.summary.sgst_paise)} />
            <Stat label="IGST" value={rupees(result.summary.igst_paise)} />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onDownload}
              className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs font-medium text-text-1 hover:bg-bg"
            >
              Download CSV ↓
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-text-3">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}

function rupees(paise: number | string) {
  const n = typeof paise === 'string' ? Number(paise) : paise
  return `₹${(n / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
}

function indianFyStart(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1 // 1-12
  const startYear = m >= 4 ? y : y - 1
  return `${startYear}-04-01`
}

function indianFyEnd(fyStartIso: string): string {
  const [y] = fyStartIso.split('-').map(Number)
  return `${y + 1}-03-31`
}
