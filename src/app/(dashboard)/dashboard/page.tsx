import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single()

  let org = null
  if (membership) {
    const { data } = await supabase
      .from('organisations')
      .select('name, plan, storage_mode')
      .eq('id', membership.org_id)
      .single()
    org = data
  }

  return (
    <main className="flex-1 p-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      {org ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-gray-600">
            Organisation: <span className="font-medium text-black">{org.name}</span>
          </p>
          <p className="text-sm text-gray-600">
            Plan: <span className="font-medium text-black">{org.plan}</span>
          </p>
          <p className="text-sm text-gray-600">
            Role: <span className="font-medium text-black">{membership?.role}</span>
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-600">No organisation found. Complete signup.</p>
      )}
    </main>
  )
}
