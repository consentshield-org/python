'use client'

import { createBrowserClient } from '@/lib/supabase/browser'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { OtpBoxes } from '@/components/otp-boxes'

// ADR-0044 Phase 2.2 — invite-gated signup.
//
// Walk-up signup is disabled. The only path to this page with a
// functioning form is `/signup?invite=<token>`. The token points to
// a row in public.invitations; we preview it, force the email
// field to the invited_email, send an OTP, and on verify we call
// public.accept_invitation(token) to create the account/org/
// membership rows per the invite shape.

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}

type Stage = 'loading' | 'no_invite' | 'invalid' | 'form' | 'code' | 'accepting'

interface InvitePreview {
  invited_email: string
  role: 'account_owner' | 'account_viewer' | 'org_admin' | 'admin' | 'viewer'
  account_id: string | null
  org_id: string | null
  plan_code: string | null
  default_org_name: string | null
  expires_at: string
  accepted_at: string | null
}

function SignupForm() {
  const params = useSearchParams()
  const token = params.get('invite') ?? ''
  const router = useRouter()

  const [stage, setStage] = useState<Stage>(token ? 'loading' : 'no_invite')
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    const supabase = createBrowserClient()
    supabase
      .rpc('invitation_preview', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data || !data[0]) {
          setStage('invalid')
          return
        }
        const row = data[0] as InvitePreview
        if (row.accepted_at) {
          setError('This invitation has already been accepted.')
          setStage('invalid')
          return
        }
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          setError('This invitation has expired.')
          setStage('invalid')
          return
        }
        setInvite(row)
        setStage('form')
      })
  }, [token])

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: invite.invited_email,
      options: { shouldCreateUser: true, data: { invite_token: token } },
    })
    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }
    setStage('code')
    setLoading(false)
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: invite.invited_email,
      token: code.trim(),
      type: 'email',
    })
    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    setStage('accepting')

    const { error: acceptError } = await supabase.rpc('accept_invitation', {
      p_token: token,
    })
    if (acceptError) {
      setError(acceptError.message)
      setLoading(false)
      setStage('form')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  if (stage === 'loading') {
    return <LoadingShell />
  }

  if (stage === 'no_invite') {
    return (
      <Shell title="An invitation is required">
        <p className="text-sm text-gray-700">
          ConsentShield is invitation-only during our beta.
        </p>
        <p className="mt-3 text-sm text-gray-700">
          If you expected to sign up here, check the invite email for the
          link, or contact us at{' '}
          <a
            href="mailto:hello@consentshield.in"
            className="font-medium text-black underline"
          >
            hello@consentshield.in
          </a>
          .
        </p>
      </Shell>
    )
  }

  if (stage === 'invalid') {
    return (
      <Shell title="Invitation link unavailable">
        <p className="text-sm text-gray-700">
          {error ||
            "We couldn't find that invitation. It may have been revoked, already used, or linked to a different account."}
        </p>
        <p className="mt-3 text-sm text-gray-700">
          Contact{' '}
          <a
            href="mailto:hello@consentshield.in"
            className="font-medium text-black underline"
          >
            hello@consentshield.in
          </a>{' '}
          if you need a new invite.
        </p>
      </Shell>
    )
  }

  if (stage === 'code' || stage === 'accepting') {
    return (
      <Shell title="Enter your code">
        <p className="text-sm text-gray-600">
          We sent a verification code to{' '}
          <strong>{invite!.invited_email}</strong>. It expires in 1 hour.
        </p>
        <form onSubmit={handleVerify} className="mt-4 space-y-4">
          <OtpBoxes value={code} onChange={setCode} autoFocus />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || stage === 'accepting'}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {stage === 'accepting'
              ? 'Accepting invite…'
              : loading
                ? 'Verifying…'
                : 'Verify and continue'}
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell title="Accept your invitation">
      <InviteSummary invite={invite!} />
      <form onSubmit={handleRequestCode} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Email</label>
          <input
            type="email"
            value={invite!.invited_email}
            disabled
            className="mt-1 block w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? 'Sending code…' : 'Send verification code'}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-gray-500">
        Already have an account?{' '}
        <a href="/login" className="font-medium text-black hover:underline">
          Sign in
        </a>
      </p>
    </Shell>
  )
}

function InviteSummary({ invite }: { invite: InvitePreview }) {
  const role = invite.role
  const kind =
    role === 'account_owner' && !invite.account_id
      ? 'creating a new ConsentShield account'
      : role === 'account_owner'
        ? 'joining as an account owner'
        : role === 'account_viewer'
          ? 'joining as a read-only account viewer'
          : role === 'org_admin'
            ? 'joining as an organisation admin'
            : role === 'admin'
              ? 'joining as an admin'
              : 'joining as a viewer'
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
      <p>
        You were invited to ConsentShield for <strong>{invite.invited_email}</strong>. You&apos;ll be{' '}
        <strong>{kind}</strong>.
      </p>
      {invite.plan_code ? (
        <p className="mt-1">
          Plan: <code className="font-mono">{invite.plan_code}</code>
          {invite.default_org_name
            ? `  ·  Default org: ${invite.default_org_name}`
            : ''}
        </p>
      ) : null}
    </div>
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
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </main>
  )
}

function LoadingShell() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p className="text-sm text-gray-500">Checking your invitation…</p>
    </main>
  )
}
