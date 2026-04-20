import Link from 'next/link'

import { createServerClient } from '@/lib/supabase/server'
import { ExportForm } from './form'

// ADR-0050 Sprint 3.1 — owner-only (for retired issuers) invoice ZIP
// export + audit-logged manifest.
//
// Operators with platform_operator tier may export only the active
// issuer's invoices (manifest RPC enforces). platform_owner may pick
// any issuer or leave blank for all-issuers.

export const dynamic = 'force-dynamic'

interface IssuerRow {
  id: string
  legal_name: string
  gstin: string
  is_active: boolean
  retired_at: string | null
}

interface AdminUserRow {
  id: string
  admin_role: 'platform_owner' | 'platform_operator' | 'support' | 'read_only'
}

export default async function InvoiceExportPage() {
  const supabase = await createServerClient()

  const { data: callerRes } = await supabase.auth.getUser()
  const callerId = callerRes.user?.id ?? null

  const [issuersRes, meRes] = await Promise.all([
    supabase.schema('admin').rpc('billing_issuer_list'),
    callerId
      ? supabase
          .schema('admin')
          .from('admin_users')
          .select('id, admin_role')
          .eq('id', callerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const issuers = (issuersRes.data ?? []) as IssuerRow[]
  const me = (meRes.data ?? null) as AdminUserRow | null
  const isOwner = me?.admin_role === 'platform_owner'
  const activeIssuer = issuers.find((i) => i.is_active) ?? null

  const selectableIssuers = isOwner
    ? issuers
    : activeIssuer
      ? [activeIssuer]
      : []

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header>
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          <Link href="/billing" className="hover:underline">
            Billing
          </Link>
          <span>/</span>
          <span>Invoice export</span>
        </div>
        <h1 className="text-xl font-semibold">Invoice export</h1>
        <p className="text-sm text-text-2">
          Bundles invoice PDFs + <code>index.csv</code> into a ZIP. Every
          export is audit-logged with the caller role, filter params, row
          count, and ZIP SHA-256.
        </p>
      </header>

      {issuersRes.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {issuersRes.error.message}
        </div>
      ) : null}

      <ExportForm
        isOwner={isOwner}
        selectableIssuers={selectableIssuers}
        activeIssuerId={activeIssuer?.id ?? null}
      />
    </div>
  )
}
