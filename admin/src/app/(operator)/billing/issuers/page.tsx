import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { type AdminRole } from '@/lib/admin/role-tiers'

// ADR-0050 Sprint 2.1 chunk 2 — Issuers list.
//
// platform_operator+ see the table. Only platform_owner sees the
// "+ New issuer" button enabled; non-owners see it disabled with a
// tooltip. Row actions (Activate, Retire, Edit, Delete) live on the
// detail page — the list is intentionally read-only to keep the
// destructive paths one extra click away.

export const dynamic = 'force-dynamic'

interface IssuerRow {
  id: string
  legal_name: string
  gstin: string
  pan: string
  registered_state_code: string
  invoice_prefix: string
  is_active: boolean
  retired_at: string | null
  created_at: string
}

export default async function IssuersListPage() {
  const supabase = await createServerClient()
  const [listRes, userRes] = await Promise.all([
    supabase.schema('admin').rpc('billing_issuer_list'),
    supabase.auth.getUser(),
  ])

  const rows = (listRes.data ?? []) as IssuerRow[]
  const err = listRes.error?.message ?? null
  const adminRole =
    (userRes.data.user?.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  const isOwner = adminRole === 'platform_owner'

  const activeRow = rows.find((r) => r.is_active)

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-text-3">
            <Link href="/billing" className="hover:underline">
              Billing
            </Link>
            <span>/</span>
            <span>Issuer entities</span>
          </div>
          <h1 className="text-xl font-semibold">Issuer entities</h1>
          <p className="text-sm text-text-2">
            Legal entities that issue invoices. Identity fields (legal
            name, GSTIN, PAN, state code, invoice prefix, FY start) are
            immutable — change them by retiring the current issuer and
            creating a new one. Invoice lineage is preserved either way.
          </p>
        </div>
        <Link
          href={isOwner ? '/billing/issuers/new' : '#'}
          aria-disabled={!isOwner}
          title={isOwner ? 'Create a new issuer entity' : 'platform_owner required'}
          className={
            isOwner
              ? 'rounded bg-teal px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-dark'
              : 'rounded border border-[color:var(--border)] bg-bg px-3 py-1.5 text-xs text-text-3 pointer-events-none'
          }
        >
          + New issuer
        </Link>
      </header>

      {err ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {err}
        </div>
      ) : null}

      {!activeRow ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">No active issuer entity</p>
          <p className="mt-1">
            Invoice issuance will refuse until an issuer entity is active.
            {isOwner
              ? ' Create one via “+ New issuer” and activate it from the detail page.'
              : ' Ask the platform owner to configure one.'}
          </p>
        </div>
      ) : null}

      <section className="rounded-md border border-[color:var(--border)] bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">All issuers</h2>
          <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-text-3">
            {rows.length}
          </span>
        </header>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3">
            No issuer entities configured yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-left text-xs uppercase tracking-wider text-text-3">
                <tr>
                  <th className="px-4 py-2">Legal name</th>
                  <th className="px-4 py-2">GSTIN</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">Prefix</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-[color:var(--border)]">
                    <td className="px-4 py-2">
                      <Link
                        href={`/billing/issuers/${r.id}`}
                        className="text-sm font-medium text-teal hover:underline"
                      >
                        {r.legal_name}
                      </Link>
                      <div className="font-mono text-[11px] text-text-3">
                        {r.id.slice(0, 8)}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-2">
                      {r.gstin}
                    </td>
                    <td className="px-4 py-2 text-xs">{r.registered_state_code}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.invoice_prefix}</td>
                    <td className="px-4 py-2">
                      <StatusPill row={r} />
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-text-3">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function StatusPill({ row }: { row: IssuerRow }) {
  if (row.retired_at) {
    return (
      <span
        className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-medium text-text-3"
        title={`Retired ${new Date(row.retired_at).toLocaleDateString()}`}
      >
        retired
      </span>
    )
  }
  if (row.is_active) {
    return (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
        active
      </span>
    )
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
      inactive
    </span>
  )
}
