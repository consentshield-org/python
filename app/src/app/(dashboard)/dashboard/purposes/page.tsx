import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PurposesView } from './purposes-view'

export default async function PurposesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: purposes } = await supabase
    .from('purpose_definitions')
    .select(
      'id, purpose_code, display_name, description, framework, data_scope, default_expiry_days, auto_delete_on_expiry, is_active, created_at',
    )
    .order('purpose_code')

  const { data: mappings } = await supabase
    .from('purpose_connector_mappings')
    .select('id, purpose_definition_id, connector_id, data_categories')
    .order('created_at', { ascending: false })

  const { data: connectors } = await supabase
    .from('integration_connectors')
    .select('id, display_name, connector_type, status')
    .order('display_name')

  const { data: org } = await supabase
    .from('organisations')
    .select('settings')
    .eq('id', membership.org_id)
    .single()

  const sectorTemplate = (org?.settings as Record<string, unknown> | null)
    ?.sectoral_template as { code?: string; version?: number } | undefined

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Purpose Definitions</h1>
        <p className="text-sm text-gray-600">
          Canonical purpose catalogue for this organisation. Every banner purpose must reference a
          purpose definition (DEPA).
          {sectorTemplate?.code ? (
            <>
              {' '}
              Active sector template:{' '}
              <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {sectorTemplate.code}
                {sectorTemplate.version ? ` v${sectorTemplate.version}` : ''}
              </span>
              .
            </>
          ) : null}
        </p>
      </div>

      <PurposesView
        initialTab={tab === 'connectors' ? 'connectors' : 'catalogue'}
        isAdmin={membership.role === 'org_admin'}
        purposes={purposes ?? []}
        mappings={mappings ?? []}
        connectors={connectors ?? []}
      />
    </main>
  )
}
