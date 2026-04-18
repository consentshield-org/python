import { createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { dispatchDeletion } from '@/lib/rights/deletion-dispatch'

export async function POST(
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
    .from('org_memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: req } = await supabase
    .from('rights_requests')
    .select('id, request_type, requestor_email, email_verified, identity_verified, status')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  if (!req) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (req.request_type !== 'erasure') {
    return NextResponse.json(
      { error: 'Deletion can only be executed for erasure requests' },
      { status: 400 },
    )
  }

  if (!req.email_verified) {
    return NextResponse.json(
      { error: 'Cannot execute deletion for an unverified request' },
      { status: 400 },
    )
  }

  if (!req.identity_verified) {
    return NextResponse.json(
      { error: 'Identity must be verified before executing deletion' },
      { status: 400 },
    )
  }

  try {
    const results = await dispatchDeletion({
      supabase,
      orgId,
      triggerType: 'erasure_request',
      triggerId: req.id,
      dataPrincipalEmail: req.requestor_email,
    })

    return NextResponse.json({ dispatched: results.length, results })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Dispatch failed' },
      { status: 500 },
    )
  }
}
