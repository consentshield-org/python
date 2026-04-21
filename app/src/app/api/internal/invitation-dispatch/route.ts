import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  buildDispatchEmail,
  type InvitationRole,
} from '@/lib/invitations/dispatch-email'

// ADR-0044 Phase 2.5 — invitation email dispatcher.
//
// Called by:
//   * AFTER INSERT trigger on public.invitations (via pg_net / Vault URL)
//   * pg_cron safety-net `invitation-dispatch-retry`
//
// Auth: shared bearer token (INVITATION_DISPATCH_SECRET env + the
// cs_invitation_dispatch_secret Vault secret — the migration reads
// from Vault, the route reads from process.env, so both must be set
// to the same value).
//
// Semantics: idempotent. First successful Resend call stamps
// email_dispatched_at; subsequent calls are no-ops. Failed calls
// increment email_dispatch_attempts and record email_last_error so
// the operator can inspect stuck dispatches from the admin console.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ORCHESTRATOR_KEY = process.env.CS_ORCHESTRATOR_ROLE_KEY!
const DISPATCH_SECRET = process.env.INVITATION_DISPATCH_SECRET ?? ''
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ??
  'https://app.consentshield.in'
// ADR-0058 follow-up — email send happens via marketing's Resend
// relay, not directly from this workspace. RESEND_API_KEY lives only
// on marketing/.
const MARKETING_URL =
  process.env.NEXT_PUBLIC_MARKETING_URL ??
  (process.env.NODE_ENV === 'production'
    ? 'https://consentshield.in'
    : 'http://localhost:3002')

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
    return NextResponse.json({ error: 'invitation_id required' }, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, ORCHESTRATOR_KEY, {
    auth: { persistSession: false },
  })

  const { data: invite, error: readErr } = await supabase
    .from('invitations')
    .select(
      'id, token, role, invited_email, account_id, org_id, plan_code, default_org_name, origin, expires_at, accepted_at, revoked_at, email_dispatched_at, email_dispatch_attempts',
    )
    .eq('id', invitationId)
    .maybeSingle()

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }
  if (!invite) {
    return NextResponse.json({ error: 'invitation not found' }, { status: 404 })
  }
  if (invite.accepted_at) {
    return NextResponse.json({ status: 'already_accepted' })
  }
  if (invite.revoked_at) {
    return NextResponse.json({ status: 'revoked' })
  }
  if (invite.email_dispatched_at) {
    return NextResponse.json({ status: 'already_dispatched' })
  }

  // ADR-0058: intakes (marketing self-serve OR operator-issued for new
  // contracted customers) land on the 7-step wizard at /onboarding.
  // Existing operator-invites (member-add into existing org) keep the
  // original /signup?invite= URL since that flow is invite → OTP →
  // existing-account-attach, no wizard.
  const origin = (invite.origin as string | null) ?? 'operator_invite'
  const isIntake =
    origin === 'marketing_intake' || origin === 'operator_intake'
  const acceptUrl = isIntake
    ? `${APP_BASE_URL}/onboarding?token=${invite.token}`
    : `${APP_BASE_URL}/signup?invite=${invite.token}`

  const email = buildDispatchEmail({
    role: invite.role as InvitationRole,
    invitedEmail: invite.invited_email,
    acceptUrl,
    planCode: invite.plan_code,
    defaultOrgName: invite.default_org_name,
    expiresAt: invite.expires_at,
    hasExistingAccount: invite.account_id !== null,
    origin: origin as 'operator_invite' | 'operator_intake' | 'marketing_intake',
  })

  // Relay the rendered email to marketing's /api/internal/send-email.
  // Resend credentials live only on the marketing workspace; this
  // app/ surface never carries RESEND_API_KEY.
  const resp = await fetch(`${MARKETING_URL}/api/internal/send-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DISPATCH_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: [invite.invited_email],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    cache: 'no-store',
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    const errCode =
      resp.status === 503 ? 'relay_unconfigured' : `relay_${resp.status}`
    await supabase
      .from('invitations')
      .update({
        email_dispatch_attempts: (invite.email_dispatch_attempts ?? 0) + 1,
        email_last_error: `${errCode}: ${errBody.slice(0, 500)}`,
      })
      .eq('id', invitationId)
    // 503 is "Resend not configured on marketing" — propagate as-is so
    // the cron safety-net retries once the operator sets the key.
    return NextResponse.json(
      { error: errCode },
      { status: resp.status === 503 ? 503 : 502 },
    )
  }

  await supabase
    .from('invitations')
    .update({
      email_dispatched_at: new Date().toISOString(),
      email_dispatch_attempts: (invite.email_dispatch_attempts ?? 0) + 1,
      email_last_error: null,
    })
    .eq('id', invitationId)

  return NextResponse.json({ status: 'dispatched' })
}
