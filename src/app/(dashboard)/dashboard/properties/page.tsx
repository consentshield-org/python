import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CreatePropertyForm } from './create-form'

export default async function PropertiesPage() {
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

  if (!membership) {
    return (
      <main className="p-8">
        <p className="text-sm text-gray-600">No organisation found.</p>
      </main>
    )
  }

  const { data: properties } = await supabase
    .from('web_properties')
    .select('id, name, url, allowed_origins, snippet_verified_at, snippet_last_seen_at')
    .order('created_at', { ascending: false })

  return (
    <main className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Web Properties</h1>
        <p className="text-sm text-gray-600">
          Each property gets its own consent banner and JS snippet.
        </p>
      </div>

      <CreatePropertyForm orgId={membership.org_id} />

      <div className="rounded border border-gray-200">
        {properties && properties.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">URL</th>
                <th className="px-4 py-2 font-medium">Allowed Origins</th>
                <th className="px-4 py-2 font-medium">Snippet Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="border-t border-gray-200">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 text-gray-600">{p.url}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {p.allowed_origins.length > 0
                      ? `${p.allowed_origins.length} configured`
                      : 'None'}
                  </td>
                  <td className="px-4 py-2">
                    {p.snippet_verified_at ? (
                      <span className="text-green-700">Verified</span>
                    ) : (
                      <span className="text-gray-500">Not installed</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/dashboard/properties/${p.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-gray-600">
            No web properties yet. Add one above to get started.
          </p>
        )}
      </div>
    </main>
  )
}
