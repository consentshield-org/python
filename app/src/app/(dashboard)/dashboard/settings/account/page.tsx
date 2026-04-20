import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { IndustryEditor } from './industry-editor'

export const dynamic = 'force-dynamic'

interface AppliedTemplate {
  code: string
  version: number
  applied_at?: string
}

const INDUSTRY_LABELS: Record<string, string> = {
  saas: 'SaaS / Technology',
  edtech: 'Edtech',
  healthcare: 'Healthcare / Clinic',
  ecommerce: 'E-commerce / D2C',
  hrtech: 'HR Tech',
  fintech: 'Fintech',
  bfsi: 'BFSI — NBFC / Banking / Broking',
  general: 'General (default)',
}

export default async function AccountSettingsPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (!membership) {
    return (
      <main className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold">Account settings</h1>
        <p className="mt-4 text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: org } = await supabase
    .from('organisations')
    .select('id, name, industry, settings, sdf_status, compliance_contact_email, updated_at')
    .eq('id', membership.org_id)
    .single()

  const { data: effRoleRes } = await supabase.rpc('effective_org_role', {
    p_org_id: membership.org_id,
  })
  const effRole = effRoleRes as string | null
  const canEdit = effRole === 'org_admin' || effRole === 'admin'

  const applied =
    (org?.settings as { sectoral_template?: AppliedTemplate } | null)?.sectoral_template ?? null

  const industry = (org?.industry as string | null) ?? 'general'

  return (
    <main className="p-8 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Account settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Organisation-level configuration for <strong>{org?.name}</strong>
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">Organisation details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm md:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Organisation name</dt>
            <dd className="mt-0.5">{org?.name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Compliance contact</dt>
            <dd className="mt-0.5">
              {org?.compliance_contact_email ?? (
                <span className="italic text-gray-400">not set</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">SDF status</dt>
            <dd className="mt-0.5 capitalize">
              {(org?.sdf_status as string)?.replace(/_/g, ' ')}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Last updated</dt>
            <dd className="mt-0.5 text-xs text-gray-500">
              {org?.updated_at ? new Date(org.updated_at as string).toLocaleString('en-IN') : '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Industry</h2>
          <p className="mt-1 text-xs text-gray-500">
            Determines which sector templates are offered in the{' '}
            <Link href="/dashboard/template" className="text-emerald-700 underline">
              Sector template picker
            </Link>
            . Switching industry surfaces new sector purposes; existing definitions are preserved.
          </p>
        </div>

        <IndustryEditor
          orgId={membership.org_id}
          currentIndustry={industry}
          industryLabels={INDUSTRY_LABELS}
          canEdit={canEdit}
        />
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Active sector template</h2>
          <Link
            href="/dashboard/template"
            className="rounded border border-gray-200 bg-white px-3 py-1 text-xs hover:bg-gray-50"
          >
            Manage templates →
          </Link>
        </div>
        {applied ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs text-emerald-800">
              {applied.code} · v{applied.version}
            </span>
            {applied.applied_at && (
              <span className="text-xs text-gray-400">
                applied {new Date(applied.applied_at).toLocaleDateString('en-IN')}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No sector template applied yet.{' '}
            <Link href="/dashboard/template" className="text-emerald-700 underline">
              Pick one
            </Link>{' '}
            to get a curated starting set of purposes for your industry.
          </p>
        )}
      </section>
    </main>
  )
}
