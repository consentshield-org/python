import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { InventoryTable } from './inventory-table'

export default async function InventoryPage() {
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

  const { data: items } = await supabase
    .from('data_inventory')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <main className="p-8 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold">Data Inventory</h1>
        <p className="text-sm text-gray-600">
          Map every category of personal data you process. Required for the privacy notice and
          DPB-facing audit packages.
        </p>
      </div>

      <InventoryTable orgId={membership.org_id} initialItems={items ?? []} />
    </main>
  )
}
