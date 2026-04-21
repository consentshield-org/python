import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  dispatchInvitationById,
  resolveDispatchEnv,
} from '@/lib/invitations/dispatch'

// ADR-0058 follow-up — manual-fire invitation dispatcher.
//
// The legacy AFTER INSERT trigger that called this route via
// pg_net / Vault is gone (migration 20260803000007). Callers now:
//   * /api/public/signup-intake          → synchronous in-process
//   * admin createOperatorIntakeAction   → POST here with the id
//   * manual operator retry              → POST here with the id
//
// Auth: the same shared bearer (INVITATION_DISPATCH_SECRET).

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!
const DISPATCH_SECRET = process.env.INVITATION_DISPATCH_SECRET ?? ''

export async function POST(request: Request) {
  if (!DISPATCH_SECRET) {
    return NextResponse.json(
      { error: 'dispatch secret not configured' },
      { status: 500 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = auth.slice('Bearer '.length).trim()
  if (token !== DISPATCH_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { invitation_id?: string }
  try {
    body = (await request.json()) as { invitation_id?: string }
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const invitationId = body.invitation_id
  if (!invitationId || typeof invitationId !== 'string') {
    return NextResponse.json(
      { error: 'invitation_id required' },
      { status: 400 },
    )
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY, {
    auth: { persistSession: false },
  })

  const env = resolveDispatchEnv()
  const result = await dispatchInvitationById(supabase, invitationId, env)

  switch (result.status) {
    case 'dispatched':
    case 'already_dispatched':
    case 'already_accepted':
    case 'revoked':
      return NextResponse.json({ status: result.status })
    case 'not_found':
      return NextResponse.json(
        { error: 'invitation not found' },
        { status: 404 },
      )
    case 'read_failed':
      return NextResponse.json({ error: result.error }, { status: 500 })
    case 'relay_unconfigured':
      return NextResponse.json(
        { error: result.error },
        { status: 503 },
      )
    case 'relay_failed':
      return NextResponse.json(
        { error: result.error },
        { status: 502 },
      )
  }
}
