import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import {
  dispatchInvitationById,
  resolveDispatchEnv,
} from '@/lib/invitations/dispatch'

// ADR-0058 Sprint 1.5 — resend an intake invitation link by email.
//
// Called from `/onboarding` no-token + invalid-token recovery shells.
// Looks up the caller-supplied email's most-recent pending intake,
// resets `email_dispatched_at` so the idempotent dispatcher will re-
// fire, then calls `dispatchInvitationById` inline to send.
//
// Existence-leak parity: every path returns the same `{ ok: true }`
// shape regardless of whether the email had a pending intake, was
// never signed up, rate-limited on the email bucket, or any other
// miss. The UX cost is "no distinct error" for typos; the security
// win is no enumeration vector. The /signup email-first lookup
// already broke this parity by product decision — resend stays
// hardened because the caller here is a recovery flow (lower-
// intent) and doesn't need the fine-grained feedback.
//
// Rate-limits mirror /api/public/signup-intake (5/60s per IP,
// 3/hour per email). Dev bypass same as signup-intake.

export const dynamic = 'force-dynamic'

const DEV_BYPASS =
  process.env.NODE_ENV !== 'production' ||
  process.env.RATE_LIMIT_BYPASS === '1'

export async function POST(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  if (!DEV_BYPASS) {
    const perIp = await checkRateLimit(`rl:resend-intake:${ip}`, 5, 60)
    if (!perIp.allowed) {
      return NextResponse.json(
        {
          error: 'Too many requests. Try again in a minute.',
          retry_in_seconds: perIp.retryInSeconds,
        },
        {
          status: 429,
          headers: { 'Retry-After': String(perIp.retryInSeconds) },
        },
      )
    }
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

  if (!DEV_BYPASS) {
    const perEmail = await checkRateLimit(
      `rl:resend-intake-email:${email}`,
      3,
      60 * 60,
    )
    if (!perEmail.allowed) {
      // Same generic shape on rate-limit as on miss — no probe
      // signal.
      return NextResponse.json({ ok: true }, { status: 200 })
    }
  }

  const sql = csOrchestrator()

  let rows: Array<{ id: string }>
  try {
    rows = await sql<Array<{ id: string }>>`
      select i.id
        from public.invitations i
       where i.invited_email = ${email}
         and i.accepted_at is null
         and i.revoked_at is null
         and i.expires_at > now()
         and i.origin in ('marketing_intake', 'operator_intake')
       order by i.created_at desc
       limit 1
    `
  } catch (err) {
    console.error(
      'resend-intake.lookup.failed',
      err instanceof Error ? err.message : String(err),
    )
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const row = rows[0]
  if (!row) {
    // No pending intake for this email — respond generically.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  // Reset dispatch state so the idempotent helper will re-fire. We
  // don't clear `email_dispatch_attempts` — that column is a
  // monotonically-increasing audit counter.
  try {
    await sql`
      update public.invitations
         set email_dispatched_at = null,
             email_last_error = null
       where id = ${row.id}
    `
  } catch (err) {
    console.error(
      'resend-intake.reset.failed',
      err instanceof Error ? err.message : String(err),
    )
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    const result = await dispatchInvitationById(
      sql,
      row.id,
      resolveDispatchEnv(),
    )
    if (
      result.status !== 'dispatched' &&
      result.status !== 'already_dispatched'
    ) {
      console.warn('resend-intake.dispatch.nonfatal', result)
    }
  } catch (err) {
    console.error(
      'resend-intake.dispatch.threw',
      err instanceof Error ? err.message : String(err),
    )
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
