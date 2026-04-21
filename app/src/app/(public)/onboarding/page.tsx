import { createServerClient } from '@/lib/supabase/server'
import { OnboardingWizard } from './_components/onboarding-wizard'
import { ResendLinkForm } from './_components/resend-link-form'
import type { InvitePreview, ResumeContext } from './_components/wizard-types'

// ADR-0058 Sprint 1.3 — customer-app onboarding wizard entry.
//
// Pre-auth load (fresh click on the email link):
//   `invitation_preview(token)` is anon-callable; renders the wizard
//   at Step 1 with the preview as context.
//
// Post-Step-1 reload (same browser, session cookie still fresh):
//   Ignore the token preview's accepted_at state — instead, read the
//   authed user's `organisations.onboarding_step` and resume at that
//   step. This is the acceptance criterion "refreshing mid-wizard
//   restores at the last completed step".

export const dynamic = 'force-dynamic'

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const supabase = await createServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Resume path: the user is already authenticated in this browser and
  // they have an org that hasn't yet been handed off to the dashboard.
  if (user) {
    const { data: resume } = await supabase
      .from('organisations')
      .select('id, name, industry, onboarding_step, onboarded_at')
      .is('onboarded_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (resume) {
      const resumeCtx: ResumeContext = {
        orgId: resume.id as string,
        orgName: resume.name as string,
        industry: (resume.industry as string | null) ?? null,
        step: (resume.onboarding_step as number | null) ?? 1,
      }
      return <OnboardingWizard mode="resume" resume={resumeCtx} />
    }

    // Authed but nothing pending — they've already onboarded. Send them home.
    return <AlreadyOnboardedShell />
  }

  if (!token) {
    return <NoTokenShell />
  }

  const { data: previewRows, error: previewError } = await supabase.rpc(
    'invitation_preview',
    { p_token: token },
  )

  if (previewError || !previewRows || !previewRows[0]) {
    return <InvalidShell reason="not_found" />
  }

  const row = previewRows[0] as InvitePreview

  if (row.accepted_at) {
    return <InvalidShell reason="already_accepted" />
  }
  if (new Date(row.expires_at) <= new Date()) {
    return <InvalidShell reason="expired" />
  }

  return (
    <OnboardingWizard
      mode="fresh"
      preview={row}
      token={token}
    />
  )
}

function AlreadyOnboardedShell() {
  return (
    <Shell title="You're already onboarded">
      <p className="text-sm text-gray-700">
        Your ConsentShield account is set up. Continue to the dashboard.
      </p>
      <a
        href="/dashboard"
        className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Go to dashboard
      </a>
    </Shell>
  )
}

function NoTokenShell() {
  return (
    <Shell title="You need a sign-up link">
      <p className="text-sm text-gray-700">
        ConsentShield onboarding starts from the email link we sent when
        you signed up on{' '}
        <a
          href="https://consentshield.in/pricing"
          className="font-medium text-black underline"
        >
          consentshield.in/pricing
        </a>
        .
      </p>
      <ResendLinkForm />
    </Shell>
  )
}

function InvalidShell({
  reason,
}: {
  reason: 'not_found' | 'already_accepted' | 'expired'
}) {
  const message =
    reason === 'already_accepted'
      ? 'This invitation has already been used. If this was you, sign in to continue.'
      : reason === 'expired'
        ? 'This invitation link has expired. Sign-up links are valid for 14 days.'
        : "We couldn't find that invitation — it may have been revoked or the link is malformed."
  return (
    <Shell title="Link unavailable">
      <p className="text-sm text-gray-700">{message}</p>
      {reason === 'already_accepted' ? (
        <div className="mt-4">
          <a
            href="/login"
            className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Sign in
          </a>
        </div>
      ) : (
        <ResendLinkForm />
      )}
    </Shell>
  )
}

function Shell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-4">{children}</div>
    </div>
  )
}
