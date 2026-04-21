import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rights/rate-limit'

// ADR-0058 follow-up — email-first signup lookup endpoint.
//
// Called from /signup when the visitor has no invite token in the URL.
// Per-IP 5/60s + per-email 10/hour rate limits mitigate enumeration
// risk; the RPC itself accepts the existence-leak trade-off by design
// (see migration comment on `lookup_pending_invitation_by_email`).
//
// The endpoint echoes only `found: boolean`, `token`, and `origin` —
// no other invitation detail. The client uses `origin` to route:
//   • `operator_invite`                    → `/signup?invite=<token>`
//   • `marketing_intake | operator_intake` → `/onboarding?token=<token>`

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!

interface LookupResponse {
  found: boolean
  token?: string
  origin?: 'operator_invite' | 'marketing_intake' | 'operator_intake'
}

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  const perIp = await checkRateLimit(`rl:lookup-invite:${ip}`, 5, 60)
  if (!perIp.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a minute.' },
      {
        status: 429,
        headers: { 'Retry-After': String(perIp.retryInSeconds) },
      },
    )
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: string }
    | null

  if (!body || typeof body.email !== 'string') {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const perEmail = await checkRateLimit(
    `rl:lookup-invite-email:${email}`,
    10,
    60 * 60,
  )
  if (!perEmail.allowed) {
    // Generic "not found" when rate-limited on email — same shape so
    // the client can't distinguish an aggressive probe from a miss.
    const response: LookupResponse = { found: false }
    return NextResponse.json(response, { status: 200 })
  }

  const orchestrator = createClient(SUPABASE_URL, ORCHESTRATOR_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await orchestrator.rpc(
    'lookup_pending_invitation_by_email',
    { p_email: email },
  )
  if (error) {
    return NextResponse.json(
      { error: 'Lookup temporarily unavailable.' },
      { status: 503 },
    )
  }

  const row = Array.isArray(data) ? data[0] : null
  if (!row) {
    const response: LookupResponse = { found: false }
    return NextResponse.json(response)
  }

  const response: LookupResponse = {
    found: true,
    token: row.token as string,
    origin: row.origin as LookupResponse['origin'],
  }
  return NextResponse.json(response)
}
