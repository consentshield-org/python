import Link from 'next/link'

import { createServerClient } from '@/lib/supabase/server'

// ADR-0050 Sprint 3.1 — invoice search.
//
// Search by invoice_number prefix + account_id + date range. Scope rule
// is enforced by admin.billing_invoice_search: operators see invoices
// under the active issuer only; owners see all issuers. Paging via
// limit + offset search params.

export const dynamic = 'force-dynamic'

interface SearchRow {
  id: string
  invoice_number: string
  fy_year: string
  issue_date: string
  total_paise: number
  status: string
  account_id: string
  account_name: string
  issuer_entity_id: string
  issuer_is_active: boolean
  pdf_r2_key: string | null
}

interface SearchEnvelope {
  rows: SearchRow[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 25

interface PageProps {
  searchParams: Promise<{
    q?: string
    account_id?: string
    from?: string
    to?: string
    page?: string
  }>
}

export default async function InvoiceSearchPage({ searchParams }: PageProps) {
  const p = await searchParams
  const page = Math.max(1, Number(p.page ?? '1') || 1)
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .schema('admin')
    .rpc('billing_invoice_search', {
      p_q: p.q ? p.q.trim() : null,
      p_account_id: isUuid(p.account_id) ? p.account_id : null,
      p_date_from: p.from || null,
      p_date_to: p.to || null,
      p_limit: PAGE_SIZE,
      p_offset: offset,
    })

  const env = (data ?? null) as SearchEnvelope | null
  const rows = env?.rows ?? []
  const total = env?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          <Link href="/billing" className="hover:underline">
            Billing
          </Link>
          <span>/</span>
          <span>Invoice search</span>
        </div>
        <h1 className="text-xl font-semibold">Invoice search</h1>
        <p className="text-sm text-text-2">
          Scope-gated: operators see invoices under the active issuer;
          platform_owner sees all issuers.
        </p>
      </header>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error.message}
        </div>
      ) : null}

      <form className="flex flex-wrap items-end gap-2 rounded-md border border-[color:var(--border)] bg-white px-3 py-2 shadow-sm">
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Invoice number (prefix)</span>
          <input
            name="q"
            defaultValue={p.q ?? ''}
            placeholder="e.g. CSTEST/2026-27"
            className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">Account ID</span>
          <input
            name="account_id"
            defaultValue={p.account_id ?? ''}
            placeholder="uuid"
            className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm font-mono"
          />
        </label>
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">From</span>
          <input
            type="date"
            name="from"
            defaultValue={p.from ?? ''}
            className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-[11px] text-text-3">
          <span className="mb-1">To</span>
          <input
            type="date"
            name="to"
            defaultValue={p.to ?? ''}
            className="rounded border border-[color:var(--border-mid)] px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark"
        >
          Search
        </button>
        <Link
          href="/billing/search"
          className="text-[11px] text-text-3 hover:underline"
        >
          clear
        </Link>
      </form>

      <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">Results</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
            {total} {total === 1 ? 'match' : 'matches'}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-text-3">
            No invoices match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Number</th>
                  <th className="px-4 py-2">Account</th>
                  <th className="px-4 py-2">Issued</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[color:var(--border)]"
                  >
                    <td className="px-4 py-2 font-mono text-[11px]">
                      <Link
                        href={`/billing/${r.account_id}`}
                        className="text-teal hover:underline"
                      >
                        {r.invoice_number}
                      </Link>
                      {!r.issuer_is_active ? (
                        <span className="ml-2 rounded-full bg-bg px-2 py-0.5 text-[10px] text-text-3">
                          retired
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/billing/${r.account_id}`}
                        className="hover:underline"
                      >
                        {r.account_name}
                      </Link>
                      <div className="font-mono text-[10px] text-text-3">
                        {r.account_id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px]">
                      {r.issue_date}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      ₹
                      {(Number(r.total_paise) / 100).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px]">{r.status}</td>
                    <td className="px-4 py-2">
                      {r.pdf_r2_key ? (
                        <a
                          href={`/api/admin/billing/invoices/${r.id}/download`}
                          className="text-xs text-teal hover:underline"
                        >
                          Download ↓
                        </a>
                      ) : (
                        <span className="text-[11px] text-text-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <footer className="flex items-center justify-between border-t border-[color:var(--border)] px-4 py-2 text-xs text-text-3">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <PageLink params={p} page={page - 1} label="← Prev" />
              ) : null}
              {page < totalPages ? (
                <PageLink params={p} page={page + 1} label="Next →" />
              ) : null}
            </div>
          </footer>
        ) : null}
      </section>
    </div>
  )
}

function PageLink({
  params,
  page,
  label,
}: {
  params: Record<string, string | undefined>
  page: number
  label: string
}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== 'page') sp.set(k, v)
  }
  sp.set('page', String(page))
  return (
    <Link
      href={`/billing/search?${sp.toString()}`}
      className="rounded border border-[color:var(--border)] bg-white px-2 py-0.5 hover:bg-bg"
    >
      {label}
    </Link>
  )
}

function isUuid(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  )
}
