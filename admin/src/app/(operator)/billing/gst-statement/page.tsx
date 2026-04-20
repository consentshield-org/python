import Link from 'next/link'

import { createServerClient } from '@/lib/supabase/server'
import { GstStatementForm } from './form'

// ADR-0050 Sprint 3.1 — GST statement generator.
//
// Operator selects an issuer + FY range; the form's server action calls
// admin.billing_gst_statement, renders a summary, and lets them download
// a GSTR-1-friendly CSV (UTF-8 BOM for Excel).
//
// Scope rule (enforced by the RPC, visible in the UI):
//   · platform_operator — issuer dropdown locked to the active issuer
//   · platform_owner    — issuer dropdown includes retired issuers

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

export default async function GstStatementPage() {
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

  const errorBanner =
    issuersRes.error?.message ??
    (activeIssuer === null && !isOwner
      ? 'No active issuer. Create and activate a billing.issuer_entities row before generating a statement.'
      : null)

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-text-3">
            <Link href="/billing" className="hover:underline">
              Billing
            </Link>
            <span>/</span>
            <span>GST statement</span>
          </div>
          <h1 className="text-xl font-semibold">GST statement</h1>
          <p className="text-sm text-text-2">
            GSTR-1-friendly per-invoice breakdown for an issuer and financial-year range.
            Every statement generation is audit-logged.
          </p>
        </div>
      </header>

      {errorBanner ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {errorBanner}
        </div>
      ) : null}

      <GstStatementForm
        isOwner={isOwner}
        selectableIssuers={selectableIssuers}
        activeIssuerId={activeIssuer?.id ?? null}
      />
    </div>
  )
}
