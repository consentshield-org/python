import { createServerClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { PropertyEditor } from './editor'
import { SnippetBlock } from './snippet'

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string }>
}) {
  const { propertyId } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .single()

  if (!membership) notFound()

  const { data: property } = await supabase
    .from('web_properties')
    .select('*')
    .eq('id', propertyId)
    .single()

  if (!property) notFound()

  const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL || 'https://cdn.consentshield.in'

  return (
    <main className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">{property.name}</h1>
        <p className="text-sm text-gray-600">{property.url}</p>
      </div>

      <section className="rounded border border-gray-200 p-4 space-y-3">
        <h2 className="font-medium">Snippet Installation</h2>
        <p className="text-sm text-gray-600">
          Add this script tag to the <code>&lt;head&gt;</code> of every page you want to protect.
          The banner will load asynchronously and will not block page rendering.
        </p>
        <SnippetBlock cdnUrl={cdnUrl} orgId={membership.org_id} propertyId={property.id} />
        <div className="text-xs text-gray-600">
          {property.snippet_verified_at ? (
            <span className="text-green-700">
              ✓ Snippet verified at {new Date(property.snippet_verified_at).toLocaleString()}
            </span>
          ) : property.snippet_last_seen_at ? (
            <span>
              Last seen: {new Date(property.snippet_last_seen_at).toLocaleString()}
            </span>
          ) : (
            <span className="text-gray-500">Snippet not yet detected on your site.</span>
          )}
        </div>
      </section>

      <PropertyEditor
        orgId={membership.org_id}
        property={{
          id: property.id,
          name: property.name,
          url: property.url,
          allowed_origins: property.allowed_origins,
        }}
      />
    </main>
  )
}
