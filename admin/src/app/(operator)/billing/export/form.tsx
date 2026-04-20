'use client'

import { useState, useTransition } from 'react'

import { previewExport, generateExportZip } from './actions'

interface IssuerOption {
  id: string
  legal_name: string
  gstin: string
  is_active: boolean
  retired_at: string | null
}

interface ManifestRow {
  id: string
  invoice_number: string
  fy_year: string
  issue_date: string
  total_paise: number
  status: string
  pdf_r2_key: string | null
  issuer_legal_name: string
  account_name: string
}

interface ManifestEnvelope {
  rows: ManifestRow[]
  summary: {
    count: number
    total_paise: number
    pdf_available: number
    pdf_missing: number
  }
  scope: {
    caller_role: string
    issuer_id: string | null
    all_issuers: boolean
  }
}

export function ExportForm({
  isOwner,
  selectableIssuers,
  activeIssuerId,
}: {
  isOwner: boolean
  selectableIssuers: IssuerOption[]
  activeIssuerId: string | null
}) {
  const [issuerId, setIssuerId] = useState(isOwner ? '' : activeIssuerId ?? '')
  const [fyYear, setFyYear] = useState('')
  const [accountId, setAccountId] = useState('')
  const [manifest, setManifest] = useState<ManifestEnvelope | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewPending, startPreview] = useTransition()
  const [downloadPending, startDownload] = useTransition()

  function currentParams() {
    return {
      issuerId: issuerId || null,
      fyYear: fyYear || null,
      accountId: accountId || null,
    }
  }

  async function onPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setManifest(null)
    startPreview(async () => {
      const res = await previewExport(currentParams())
      if ('error' in res) setError(res.error)
      else setManifest(res)
    })
  }

  async function onDownload() {
    setError(null)
    startDownload(async () => {
      const res = await generateExportZip(currentParams())
      if ('error' in res) {
        setError(res.error)
        return
      }
      const blob = new Blob([new Uint8Array(res.zipBytes)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
      <header className="border-b border-[color:var(--border)] px-4 py-2.5">
        <h2 className="text-sm font-semibold">Filters</h2>
      </header>
      <form onSubmit={onPreview} className="space-y-3 p-4">
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Issuer</span>
          <select
            value={issuerId}
            onChange={(e) => setIssuerId(e.target.value)}
            className="rounded border border-[color:var(--border-mid)] bg-white px-2 py-1 text-sm"
          >
            {isOwner ? <option value="">All issuers (owner)</option> : null}
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
            <span className="mb-1">FY year (optional)</span>
            <input
              value={fyYear}
              onChange={(e) => setFyYear(e.target.value)}
              placeholder="2026-27"
              className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm font-mono"
            />
          </label>
          <label className="flex flex-col text-[11px] text-text-3">
            <span className="mb-1">Account ID (optional)</span>
            <input
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="uuid"
              className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm font-mono"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={previewPending}
            className="rounded border border-[color:var(--border)] bg-white px-3 py-1.5 text-xs font-medium hover:bg-bg disabled:opacity-50"
          >
            {previewPending ? 'Loading…' : 'Preview manifest'}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloadPending || !manifest || manifest.summary.pdf_available === 0}
            className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark disabled:opacity-50"
            title={
              !manifest
                ? 'Preview the manifest first'
                : manifest.summary.pdf_available === 0
                  ? 'No PDFs available in this scope'
                  : 'Download ZIP'
            }
          >
            {downloadPending ? 'Building ZIP…' : 'Download ZIP'}
          </button>
        </div>

        {error ? (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        ) : null}
      </form>

      {manifest ? (
        <div className="border-t border-[color:var(--border)] px-4 py-4">
          <h3 className="text-sm font-semibold">Manifest</h3>
          <div className="mt-2 flex gap-6 text-xs text-text-2">
            <span>{manifest.summary.count} invoices</span>
            <span>{manifest.summary.pdf_available} with PDF</span>
            <span className={manifest.summary.pdf_missing > 0 ? 'text-amber-800' : ''}>
              {manifest.summary.pdf_missing} missing PDF
            </span>
            <span>
              ₹
              {(Number(manifest.summary.total_paise) / 100).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
              })}{' '}
              total
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-3 py-1.5">Number</th>
                  <th className="px-3 py-1.5">Issuer</th>
                  <th className="px-3 py-1.5">Account</th>
                  <th className="px-3 py-1.5">Issue date</th>
                  <th className="px-3 py-1.5 text-right">Total</th>
                  <th className="px-3 py-1.5">PDF</th>
                </tr>
              </thead>
              <tbody>
                {manifest.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[color:var(--border)] font-mono text-[11px]"
                  >
                    <td className="px-3 py-1.5">{r.invoice_number}</td>
                    <td className="px-3 py-1.5">{r.issuer_legal_name}</td>
                    <td className="px-3 py-1.5">{r.account_name}</td>
                    <td className="px-3 py-1.5">{r.issue_date}</td>
                    <td className="px-3 py-1.5 text-right">
                      ₹{(Number(r.total_paise) / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="px-3 py-1.5">{r.pdf_r2_key ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  )
}
