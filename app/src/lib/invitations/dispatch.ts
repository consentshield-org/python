import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildDispatchEmail,
  type InvitationRole,
} from '@/lib/invitations/dispatch-email'

// ADR-0058 follow-up — reusable invitation-email dispatch helper.
//
// Reads the invitation row, builds the email content, POSTs it to
// marketing's Resend relay, and stamps the watermark columns on the
// row. Called from:
//   * /api/public/signup-intake — synchronous dispatch after the
//     create_signup_intake RPC returns a fresh row.
//   * /api/internal/invitation-dispatch — manual-fire endpoint (bearer-
//     gated) kept for admin-side calls + ad-hoc retries.
//
// Idempotent — re-runs are no-ops once email_dispatched_at is stamped.

export type DispatchResult =
  | { status: 'dispatched' }
  | { status: 'already_dispatched' }
  | { status: 'already_accepted' }
  | { status: 'revoked' }
  | { status: 'not_found' }
  | { status: 'relay_unconfigured'; error: string }
  | { status: 'relay_failed'; error: string }
  | { status: 'read_failed'; error: string }

interface DispatchEnv {
  appBaseUrl: string
  marketingUrl: string
  dispatchSecret: string
}

export async function dispatchInvitationById(
  supabase: SupabaseClient,
  invitationId: string,
  env: DispatchEnv,
): Promise<DispatchResult> {
  if (!env.dispatchSecret) {
    return { status: 'relay_unconfigured', error: 'dispatch_secret_missing' }
  }

  const { data: invite, error: readErr } = await supabase
    .from('invitations')
    .select(
      'id, token, role, invited_email, account_id, org_id, plan_code, default_org_name, origin, expires_at, accepted_at, revoked_at, email_dispatched_at, email_dispatch_attempts',
    )
    .eq('id', invitationId)
    .maybeSingle()

  if (readErr) {
    return { status: 'read_failed', error: readErr.message }
  }
  if (!invite) return { status: 'not_found' }
  if (invite.accepted_at) return { status: 'already_accepted' }
  if (invite.revoked_at) return { status: 'revoked' }
  if (invite.email_dispatched_at) return { status: 'already_dispatched' }

  // ADR-0058: intakes land on the 7-step wizard; operator_invite rows
  // (member-add into an existing org) keep the /signup?invite= URL.
  const origin = (invite.origin as string | null) ?? 'operator_invite'
  const isIntake =
    origin === 'marketing_intake' || origin === 'operator_intake'
  const acceptUrl = isIntake
    ? `${env.appBaseUrl}/onboarding?token=${invite.token}`
    : `${env.appBaseUrl}/signup?invite=${invite.token}`

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

  const resp = await fetch(`${env.marketingUrl}/api/internal/send-email`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.dispatchSecret}`,
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

  const nextAttempts = (invite.email_dispatch_attempts ?? 0) + 1

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    const errCode =
      resp.status === 503 ? 'relay_unconfigured' : `relay_${resp.status}`
    await supabase
      .from('invitations')
      .update({
        email_dispatch_attempts: nextAttempts,
        email_last_error: `${errCode}: ${errBody.slice(0, 500)}`,
      })
      .eq('id', invitationId)
    if (resp.status === 503) {
      return { status: 'relay_unconfigured', error: errCode }
    }
    return { status: 'relay_failed', error: errCode }
  }

  await supabase
    .from('invitations')
    .update({
      email_dispatched_at: new Date().toISOString(),
      email_dispatch_attempts: nextAttempts,
      email_last_error: null,
    })
    .eq('id', invitationId)

  return { status: 'dispatched' }
}

// Convenience: resolve env vars with the same defaults the route file
// used to use. Centralised so callers don't duplicate the fallback
// table.
export function resolveDispatchEnv(): DispatchEnv {
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_CUSTOMER_APP_URL ??
    'https://app.consentshield.in'

  const marketingUrl =
    process.env.NEXT_PUBLIC_MARKETING_URL ??
    (process.env.NODE_ENV === 'production'
      ? 'https://consentshield.in'
      : 'http://localhost:3002')

  const dispatchSecret = process.env.INVITATION_DISPATCH_SECRET ?? ''

  return { appBaseUrl, marketingUrl, dispatchSecret }
}
