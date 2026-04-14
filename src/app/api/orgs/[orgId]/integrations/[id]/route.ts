import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const { orgId, id } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: membership } = await supabase
    .from('organisation_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership || membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only org admins can delete connectors' },
      { status: 403 },
    )
  }

  const { error } = await supabase
    .from('integration_connectors')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
