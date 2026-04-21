import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { logRateLimitHit } from '@/lib/rights/rate-limit-log'
import {
  dispatchInvitationById,
  resolveDispatchEnv,
} from '@/lib/invitations/dispatch'

// ADR-0058 Sprint 1.1 — public marketing-site signup intake.
//
// POSTed to from `consentshield.in/signup` (cross-origin). Turnstile-
// gated, rate-limited per IP, and existence-leak hardened: every
// success path returns the same `{ok:true}` shape regardless of
// whether the email is fresh, already a customer, or attached to
// an admin identity. The Postgres RPC `public.create_signup_intake`
// implements the branching internally and logs server-side.
//
// CORS: explicit allow-list for marketing origins only. The OPTIONS
// preflight handler mirrors the same allow-list. Allow-list is
// hard-coded (not env-driven) per ADR-0043 lesson.

const ORIGIN_ALLOW_LIST = new Set([
  'https://consentshield.in',
  'https://www.consentshield.in',
  'http://localhost:3002',
])

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!

const VALID_PLANS = new Set([
  'trial_starter',
  'starter',
  'growth',
  'pro',
  'enterprise',
])

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = origin && ORIGIN_ALLOW_LIST.has(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin')
  return new NextResponse(null, {
    status: 204,
    headers: corsHeadersFor(origin),
  })
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const cors = corsHeadersFor(origin)

  // Reject cross-origin POSTs that don't match the allow-list. Same-
  // origin POSTs (no Origin header set, or matching app origin) pass.
  if (origin && !ORIGIN_ALLOW_LIST.has(origin)) {
    return NextResponse.json(
      { error: 'origin not permitted' },
      { status: 403, headers: cors },
    )
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'

  // Per-IP rate limit. Tighter than rights-request (5/60s) — intake is
  // genuinely once-per-visitor, retry burst is rare. Same window keeps
  // tooling consistent.
  const rateKey = `rl:signup-intake:${ip}`
  const limit = await checkRateLimit(rateKey, 5, 60)
  if (!limit.allowed) {
    logRateLimitHit({
      endpoint: '/api/public/signup-intake',
      key: rateKey,
      ipAddress: ip,
      hitCount: 5,
      windowSeconds: 60,
    })
    return NextResponse.json(
      {
        error: 'Too many requests. Try again in a minute.',
        retry_in_seconds: limit.retryInSeconds,
      },
      {
        status: 429,
        headers: { ...cors, 'Retry-After': String(limit.retryInSeconds) },
      },
    )
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string
    plan_code?: string
    org_name?: string
    turnstile_token?: string
  } | null

  if (!body) {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400, headers: cors },
    )
  }

  const { email, plan_code, org_name, turnstile_token } = body

  if (!email || !plan_code) {
    return NextResponse.json(
      { error: 'email and plan_code are required' },
      { status: 400, headers: cors },
    )
  }

  if (!VALID_PLANS.has(plan_code)) {
    // Surface this one before Turnstile so a typo'd plan doesn't burn
    // a Turnstile redemption.
    return NextResponse.json(
      { error: 'Unknown plan' },
      { status: 400, headers: cors },
    )
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Invalid email format' },
      { status: 400, headers: cors },
    )
  }

  const turnstile = await verifyTurnstileToken(turnstile_token ?? '', ip)
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: turnstile.error },
      { status: 403, headers: cors },
    )
  }

  // Per-email bucket — prevents enumeration / inbox flooding by
  // spreading retries across IPs (the IP bucket above doesn't catch
  // an attacker rotating IPs but hammering one email).
  const emailKey = `rl:signup-intake-email:${email.toLowerCase()}`
  const emailLimit = await checkRateLimit(emailKey, 3, 60 * 60)
  if (!emailLimit.allowed) {
    logRateLimitHit({
      endpoint: '/api/public/signup-intake',
      key: emailKey,
      ipAddress: ip,
      hitCount: 3,
      windowSeconds: 60 * 60,
    })
    // Generic success — same shape as the happy path. No leak.
    return NextResponse.json({ ok: true }, { status: 202, headers: cors })
  }

  const orchestrator = createClient(SUPABASE_URL, ORCHESTRATOR_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await orchestrator.rpc('create_signup_intake', {
    p_email: email,
    p_plan_code: plan_code,
    p_org_name: org_name ?? null,
    p_ip: ip,
  })

  if (error) {
    // RPC errors are infrastructure problems (DB unavailable, schema
    // drift) — log + generic message. Do NOT echo the raw error to
    // the client.
    console.error('signup-intake.rpc.failed', error.message)
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503, headers: cors },
    )
  }

  // Product decision (2026-04-21): break existence-leak parity. The
  // RPC returns an explicit branch; we surface it so marketing/
  // signup can render "already a customer" / "already invited"
  // messages. Turnstile + rate-limit stay on; those are the real
  // enumeration ceiling.
  const rpcResult = (data ?? {}) as {
    branch?:
      | 'created'
      | 'already_invited'
      | 'existing_customer'
      | 'admin_identity'
      | 'invalid_email'
      | 'invalid_plan'
    id?: string
    token?: string
  }
  const branch = rpcResult.branch ?? 'invalid_email'
  console.log('signup-intake.branch', branch)

  if (branch === 'created') {
    // Fire the email dispatch synchronously. The DB trigger that used
    // to do this is gone (migration 20260803000007); every caller now
    // owns its dispatch. Failure here is telemetry, not a UX blocker
    // — the row is already persisted and the `email_last_error`
    // column records what went wrong for operator retry.
    if (rpcResult.id) {
      try {
        const result = await dispatchInvitationById(
          orchestrator,
          rpcResult.id,
          resolveDispatchEnv(),
        )
        if (
          result.status !== 'dispatched' &&
          result.status !== 'already_dispatched'
        ) {
          console.warn('signup-intake.dispatch.nonfatal', result)
        }
      } catch (err) {
        console.error(
          'signup-intake.dispatch.threw',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    return NextResponse.json(
      { ok: true, status: 'created' },
      { status: 202, headers: cors },
    )
  }
  if (branch === 'already_invited') {
    return NextResponse.json(
      { ok: true, status: 'already_invited' },
      { status: 200, headers: cors },
    )
  }
  if (branch === 'existing_customer') {
    return NextResponse.json(
      { ok: false, status: 'existing_customer' },
      { status: 409, headers: cors },
    )
  }
  if (branch === 'admin_identity') {
    return NextResponse.json(
      { ok: false, status: 'admin_identity' },
      { status: 409, headers: cors },
    )
  }
  if (branch === 'invalid_email') {
    return NextResponse.json(
      { ok: false, status: 'invalid_email' },
      { status: 400, headers: cors },
    )
  }
  if (branch === 'invalid_plan') {
    return NextResponse.json(
      { ok: false, status: 'invalid_plan' },
      { status: 400, headers: cors },
    )
  }
  return NextResponse.json(
    { ok: false, status: 'unknown' },
    { status: 500, headers: cors },
  )
}
