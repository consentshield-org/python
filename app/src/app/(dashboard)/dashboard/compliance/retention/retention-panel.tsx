'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface SuppressionRow {
  id: string
  artefact_id: string
  statute: string
  statute_code: string
  suppressed_data_categories: string[]
  source_citation: string | null
  suppressed_at: string
}

interface ExemptionRow {
  id: string
  org_id: string | null
  sector: string
  statute: string
  statute_code: string
  data_categories: string[]
  retention_period: string | null
  source_citation: string | null
  precedence: number
  applies_to_purposes: string[] | null
  reviewed_at: string | null
  reviewer_firm: string | null
  is_active: boolean
}

interface Props {
  orgId: string
  canEdit: boolean
  accountRole: string | null
  suppressions: SuppressionRow[]
  exemptions: ExemptionRow[]
}

const SECTORS = [
  'saas',
  'edtech',
  'healthcare',
  'ecommerce',
  'hrtech',
  'fintech',
  'bfsi',
  'general',
  'all',
]

export function RetentionPanel({
  orgId,
  canEdit,
  accountRole,
  suppressions,
  exemptions,
}: Props) {
  const router = useRouter()
  const [statuteFilter, setStatuteFilter] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const uniqueStatutes = useMemo(() => {
    const set = new Set<string>()
    for (const s of suppressions) set.add(s.statute_code)
    return Array.from(set).sort()
  }, [suppressions])

  const filteredSuppressions = useMemo(() => {
    if (!statuteFilter) return suppressions
    return suppressions.filter((s) => s.statute_code === statuteFilter)
  }, [statuteFilter, suppressions])

  const platform = exemptions.filter((e) => e.org_id === null)
  const overrides = exemptions.filter((e) => e.org_id === orgId)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFormError(null)

    const form = event.currentTarget
    const fd = new FormData(form)
    const payload = {
      sector: String(fd.get('sector') ?? ''),
      statute: String(fd.get('statute') ?? ''),
      statute_code: String(fd.get('statute_code') ?? ''),
      data_categories: String(fd.get('data_categories') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      retention_period: String(fd.get('retention_period') ?? '').trim() || null,
      source_citation: String(fd.get('source_citation') ?? '').trim() || null,
      precedence: Number(fd.get('precedence') ?? 50),
      applies_to_purposes: String(fd.get('applies_to_purposes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      legal_review_notes: String(fd.get('legal_review_notes') ?? '').trim() || null,
    }

    const res = await fetch(`/api/orgs/${orgId}/regulatory-exemptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSubmitting(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      setFormError(body.error ?? `HTTP ${res.status}`)
      return
    }

    setShowForm(false)
    form.reset()
    router.refresh()
  }

  return (
    <div className="space-y-8">
      {/* Suppressions */}
      <section>
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <h2 className="text-lg font-semibold">Recent retention suppressions</h2>
            <p className="text-sm text-gray-600">
              Deletion events that were reduced or blocked by an active exemption. Shows the latest
              100 events; audit export carries the full history.
            </p>
          </div>
          {uniqueStatutes.length > 0 && (
            <label className="text-sm">
              <span className="text-gray-600 mr-2">Filter by statute:</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={statuteFilter}
                onChange={(e) => setStatuteFilter(e.target.value)}
              >
                <option value="">All</option>
                {uniqueStatutes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {filteredSuppressions.length === 0 ? (
          <p className="rounded border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
            No suppressions recorded yet. Suppressions are written by the deletion orchestrator when
            an active exemption overlaps a revoked artefact&apos;s data scope.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2">Suppressed at</th>
                  <th className="px-3 py-2">Statute</th>
                  <th className="px-3 py-2">Artefact</th>
                  <th className="px-3 py-2">Data categories retained</th>
                  <th className="px-3 py-2">Citation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSuppressions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {new Date(s.suppressed_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.statute_code}</div>
                      <div className="text-xs text-gray-500">{s.statute}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{s.artefact_id}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.suppressed_data_categories.join(', ')}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {s.source_citation ?? <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Exemptions */}
      <section>
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <h2 className="text-lg font-semibold">Applicable exemptions</h2>
            <p className="text-sm text-gray-600">
              Platform defaults apply automatically to your sector. Overrides are specific to your
              org — lower precedence values win when multiple rules apply.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="rounded bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
            >
              {showForm ? 'Cancel' : 'Add override'}
            </button>
          )}
        </div>

        {!canEdit && accountRole !== 'account_owner' && (
          <p className="mb-3 text-xs text-gray-500">
            Only account owners can add overrides (current role: {accountRole ?? 'none'}).
          </p>
        )}

        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="mb-6 space-y-3 rounded border border-gray-200 bg-gray-50 p-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="block text-gray-700 mb-1">Sector</span>
                <select
                  name="sector"
                  required
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  defaultValue="bfsi"
                >
                  {SECTORS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="block text-gray-700 mb-1">Precedence (lower wins)</span>
                <input
                  name="precedence"
                  type="number"
                  min={0}
                  defaultValue={50}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-gray-700 mb-1">Statute name</span>
                <input
                  name="statute"
                  required
                  placeholder="e.g. Reserve Bank of India (KYC) Master Direction, 2016"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="block text-gray-700 mb-1">Statute code</span>
                <input
                  name="statute_code"
                  required
                  placeholder="e.g. RBI_KYC_CORP_OVERRIDE"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="block text-gray-700 mb-1">Retention period</span>
                <input
                  name="retention_period"
                  placeholder="e.g. 10 years"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-gray-700 mb-1">
                  Data categories (comma-separated)
                </span>
                <input
                  name="data_categories"
                  required
                  placeholder="pan, name, address, account_number"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-gray-700 mb-1">
                  Applies to purposes (comma-separated, empty = all)
                </span>
                <input
                  name="applies_to_purposes"
                  placeholder="kyc_verification, bureau_reporting"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-gray-700 mb-1">Source citation</span>
                <input
                  name="source_citation"
                  placeholder="https://rbi.org.in/..."
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="block text-gray-700 mb-1">Legal review notes</span>
                <textarea
                  name="legal_review_notes"
                  rows={2}
                  placeholder="Counsel name + date — leaving blank ships as PENDING_LEGAL_REVIEW."
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save override'}
              </button>
            </div>
          </form>
        )}

        <div className="space-y-6">
          <ExemptionList title="Your overrides" rows={overrides} highlight />
          <ExemptionList title="Platform defaults" rows={platform} />
        </div>
      </section>
    </div>
  )
}

function ExemptionList({
  title,
  rows,
  highlight,
}: {
  title: string
  rows: ExemptionRow[]
  highlight?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
        <p className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          {title === 'Your overrides'
            ? 'No overrides yet. Add one to extend or tighten the platform defaults for your sector.'
            : 'No platform defaults loaded for your sector.'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-2">{title}</h3>
      <div
        className={`overflow-x-auto rounded border ${
          highlight ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
        }`}
      >
        <table className="w-full text-sm">
          <thead className="bg-white/80 text-left text-xs uppercase text-gray-600">
            <tr>
              <th className="px-3 py-2">Statute</th>
              <th className="px-3 py-2">Sector / Purposes</th>
              <th className="px-3 py-2">Data categories</th>
              <th className="px-3 py-2">Retention</th>
              <th className="px-3 py-2">Precedence</th>
              <th className="px-3 py-2">Legal review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((e) => (
              <tr key={e.id} className={e.is_active ? '' : 'opacity-60'}>
                <td className="px-3 py-2">
                  <div className="font-medium">{e.statute_code}</div>
                  <div className="text-xs text-gray-500">{e.statute}</div>
                </td>
                <td className="px-3 py-2 text-xs text-gray-700">
                  <div>{e.sector}</div>
                  <div className="text-gray-500">
                    {e.applies_to_purposes?.length ? e.applies_to_purposes.join(', ') : 'all purposes'}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-700">{e.data_categories.join(', ')}</td>
                <td className="px-3 py-2 text-gray-700">
                  {e.retention_period ?? <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-700">{e.precedence}</td>
                <td className="px-3 py-2">
                  {e.reviewed_at ? (
                    <span className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">
                      Reviewed {e.reviewer_firm ? `· ${e.reviewer_firm}` : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Pending legal review
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
