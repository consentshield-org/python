import { forbidden, redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { type AdminRole } from '@/lib/admin/role-tiers'
import { NewIssuerForm } from './form'

// ADR-0050 Sprint 2.1 chunk 2 — New issuer form (platform_owner only).

export const dynamic = 'force-dynamic'

export default async function NewIssuerPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const adminRole = (user.app_metadata?.admin_role as AdminRole) ?? 'read_only'
  if (adminRole !== 'platform_owner') {
    // Next 16: forbidden() renders a 403 boundary. Fallback: plain component.
    if (typeof forbidden === 'function') forbidden()
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-semibold">Forbidden</h1>
        <p className="text-sm text-text-2">
          Only platform_owner can create issuer entities. Contact the
          founder to have one configured.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <div className="flex items-center gap-2 text-[11px] text-text-3">
          <Link href="/billing" className="hover:underline">
            Billing
          </Link>
          <span>/</span>
          <Link href="/billing/issuers" className="hover:underline">
            Issuer entities
          </Link>
          <span>/</span>
          <span>New</span>
        </div>
        <h1 className="text-xl font-semibold">New issuer entity</h1>
        <p className="text-sm text-text-2">
          Identity fields (legal name, GSTIN, PAN, state code, invoice
          prefix, FY start) are immutable once saved. Double-check
          before submitting.
        </p>
      </header>

      <NewIssuerForm />
    </div>
  )
}
