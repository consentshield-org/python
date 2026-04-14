import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const VALID_STATUSES = ['new', 'in_progress', 'completed', 'rejected']

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const { orgId, id } = await params
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }
    updates.status = body.status
    if (body.status === 'completed') {
      updates.response_sent_at = new Date().toISOString()
    }
  }
  if (body.assignee_id === null || typeof body.assignee_id === 'string') {
    updates.assignee_id = body.assignee_id
  }
  if (typeof body.identity_verified === 'boolean') {
    updates.identity_verified = body.identity_verified
    if (body.identity_verified) {
      updates.identity_verified_at = new Date().toISOString()
      updates.identity_verified_by = user.id
      if (typeof body.identity_method === 'string') {
        updates.identity_method = body.identity_method
      }
    }
  }
  if (typeof body.closure_notes === 'string') {
    updates.closure_notes = body.closure_notes
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('rights_requests')
    .update(updates)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ request: data })
}
