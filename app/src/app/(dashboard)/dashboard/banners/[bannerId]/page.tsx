import { createServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { BannerEditor } from './editor'

export default async function BannerDetailPage({
  params,
}: {
  params: Promise<{ bannerId: string }>
}) {
  const { bannerId } = await params
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

  if (!membership) notFound()

  const { data: banner } = await supabase
    .from('consent_banners')
    .select('*')
    .eq('id', bannerId)
    .single()

  if (!banner) notFound()

  const { data: property } = await supabase
    .from('web_properties')
    .select('id, name')
    .eq('id', banner.property_id)
    .single()

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Edit Banner</h1>
        <p className="text-sm text-gray-600">
          {property?.name} · v{banner.version} ·{' '}
          {banner.is_active ? (
            <span className="text-green-700 font-medium">Live</span>
          ) : (
            <span className="text-gray-500">Draft</span>
          )}
        </p>
      </div>

      <BannerEditor orgId={membership.org_id} banner={banner} />
    </main>
  )
}
