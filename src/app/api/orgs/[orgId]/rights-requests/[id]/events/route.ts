import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const { orgId, id } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user belongs to the org
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const { event_type, notes, metadata } = body

  if (!event_type) {
    return NextResponse.json({ error: 'event_type is required' }, { status: 400 })
  }

  // rights_request_events is a buffer table — revoked INSERT from authenticated.
  // Use service role for the insert (as cs_orchestrator would in an Edge Function).
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await admin
    .from('rights_request_events')
    .insert({
      request_id: id,
      org_id: orgId,
      actor_id: user.id,
      event_type,
      notes,
      metadata,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ event: data }, { status: 201 })
}
