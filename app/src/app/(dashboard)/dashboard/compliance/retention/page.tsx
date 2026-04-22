import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { RetentionPanel } from './retention-panel'

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

export default async function RetentionPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const orgId = membership.org_id

  const [accountRoleRes, suppressionsRes, exemptionsRes] = await Promise.all([
    supabase.rpc('current_account_role'),
    supabase
      .from('retention_suppressions')
      .select(
        'id, artefact_id, statute, statute_code, suppressed_data_categories, source_citation, suppressed_at',
      )
      .order('suppressed_at', { ascending: false })
      .limit(100),
    supabase
      .from('regulatory_exemptions')
      .select(
        'id, org_id, sector, statute, statute_code, data_categories, retention_period, source_citation, precedence, applies_to_purposes, reviewed_at, reviewer_firm, is_active',
      )
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .order('precedence', { ascending: true })
      .order('statute_code', { ascending: true }),
  ])

  const accountRole = (accountRoleRes.data as string | null) ?? null
  const canEdit = accountRole === 'account_owner'
  const suppressions = (suppressionsRes.data ?? []) as SuppressionRow[]
  const exemptions = (exemptionsRes.data ?? []) as ExemptionRow[]

  return (
    <main className="p-8 space-y-8 max-w-6xl">
      <header>
        <h1 className="text-2xl font-bold">Retention & Exemptions</h1>
        <p className="text-sm text-gray-600 mt-1">
          Regulatory exemptions that block or reduce deletion of personal data under sector-specific
          statute (BFSI KYC, healthcare clinical records, etc.). Platform defaults apply to every
          org; overrides apply only to yours.
        </p>
      </header>

      <RetentionPanel
        orgId={orgId}
        canEdit={canEdit}
        accountRole={accountRole}
        suppressions={suppressions}
        exemptions={exemptions}
      />
    </main>
  )
}
