import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { ServiceClientEnvError } from '@/lib/supabase/service'
import { inviteAdmin, LifecycleError } from '@/lib/admin/lifecycle'

// ADR-0045 Sprint 1.2 — POST /api/admin/users/invite
//
// Policy (CLAUDE.md Rule 5 carve-out): this handler uses service-role
// SOLELY for auth.admin.createUser inside inviteAdmin(). All non-auth
// reads (inviter display_name) go through the caller's JWT + cs_admin
// RLS policy on admin.admin_users.

export const runtime = 'nodejs'

interface InviteBody {
  email?: string
  displayName?: string
  adminRole?: 'platform_operator' | 'support' | 'read_only'
  reason?: string
}

export async function POST(request: Request) {
  let body: InviteBody
  try {
    body = (await request.json()) as InviteBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const displayName = body.displayName?.trim()
  const adminRole = body.adminRole
  const reason = body.reason?.trim()

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 })
  }
  if (!displayName || displayName.length < 1) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 })
  }
  if (adminRole !== 'platform_operator' && adminRole !== 'support' && adminRole !== 'read_only') {
    return NextResponse.json(
      { error: 'adminRole must be platform_operator, support, or read_only' },
      { status: 400 },
    )
  }
  if (!reason || reason.length < 10) {
    return NextResponse.json(
      { error: 'reason must be at least 10 characters' },
      { status: 400 },
    )
  }

  const authed = await createServerClient()
  const { data: callerRes } = await authed.auth.getUser()
  const callerId = callerRes.user?.id
  if (!callerId) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  }

  // Rule 5 carve-out: read the inviter's display_name via the caller's
  // JWT + cs_admin RLS (admin_users_admin_only). No service-role key
  // for this read — service-role is reserved for auth.admin.* calls
  // inside inviteAdmin() where no alternative exists.
  const { data: inviterRow } = await authed
    .schema('admin')
    .from('admin_users')
    .select('display_name')
    .eq('id', callerId)
    .maybeSingle()
  const inviterDisplayName = inviterRow?.display_name ?? 'A ConsentShield operator'

  try {
    const outcome = await inviteAdmin({
      authedClient: authed,
      email,
      displayName,
      adminRole,
      reason,
      inviterDisplayName,
    })
    return NextResponse.json(outcome, { status: 201 })
  } catch (e) {
    if (e instanceof LifecycleError) {
      const status = e.code === 'rpc_refused' ? 403 : 400
      return NextResponse.json({ error: e.message, code: e.code }, { status })
    }
    if (e instanceof ServiceClientEnvError) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
    throw e
  }
}
