import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CreateBannerForm } from './create-form'

export default async function BannersPage() {
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

  const { data: properties } = await supabase
    .from('web_properties')
    .select('id, name')
    .order('name')

  const { data: banners } = await supabase
    .from('consent_banners')
    .select('id, property_id, version, is_active, headline, position, created_at')
    .order('created_at', { ascending: false })

  const propertyMap = new Map((properties ?? []).map((p) => [p.id, p.name]))

  return (
    <main className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Consent Banners</h1>
        <p className="text-sm text-gray-600">
          Each web property can have one active banner. Editing creates a new version.
        </p>
      </div>

      {properties && properties.length > 0 ? (
        <CreateBannerForm orgId={membership.org_id} properties={properties} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">
          You need at least one{' '}
          <Link href="/dashboard/properties" className="font-medium underline">
            web property
          </Link>{' '}
          before creating a banner.
        </div>
      )}

      <div className="rounded border border-gray-200">
        {banners && banners.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Property</th>
                <th className="px-4 py-2 font-medium">Version</th>
                <th className="px-4 py-2 font-medium">Headline</th>
                <th className="px-4 py-2 font-medium">Position</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {banners.map((b) => (
                <tr key={b.id} className="border-t border-gray-200">
                  <td className="px-4 py-2">{propertyMap.get(b.property_id) ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">v{b.version}</td>
                  <td className="px-4 py-2">{b.headline}</td>
                  <td className="px-4 py-2 text-gray-600">{b.position}</td>
                  <td className="px-4 py-2">
                    {b.is_active ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        Live
                      </span>
                    ) : (
                      <span className="text-gray-500">Draft</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/banners/${b.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No banners yet. Create one above.
          </p>
        )}
      </div>
    </main>
  )
}
