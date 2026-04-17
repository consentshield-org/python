'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/browser'
import { OtpBoxes } from '@/components/otp-boxes'
import { FullLogo } from '@/components/brand/logo'

// ADR-0028 Sprint 1.1 — real admin sign-in.
// OTP email flow (no password, no signup link — admin bootstrap is not
// self-serve; operators are provisioned via scripts/bootstrap-admin.ts
// or by a platform_operator). Mirrors the customer /login pattern but
// with the red admin accent and no signup CTA.

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginForm />
    </Suspense>
  )
}

type Stage = 'form' | 'code'

function AdminLoginForm() {
  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'
  const reason = searchParams.get('reason')

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
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
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: 'email',
    })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    router.push(redirect)
    router.refresh()
  }

  const reasonBanner =
    reason === 'mfa_required' ? (
      <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        Hardware-key second factor required. Enrol a passkey first, then
        sign in here.
      </p>
    ) : reason ? (
      <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        {reason}
      </p>
    ) : null

  if (stage === 'code') {
    return (
      <Shell>
        <header className="space-y-4">
          <FullLogo iconSize={44} textSize={24} tagline="COMPLIANCE ENGINE" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-text">Enter your code</h1>
            <p className="text-sm text-text-2">
              We sent a verification code to <strong>{email}</strong>.
            </p>
          </div>
        </header>

        <form onSubmit={handleVerify} className="space-y-4">
          <OtpBoxes value={code} onChange={setCode} autoFocus />

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-mid disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-text-2">
          <button
            type="button"
            onClick={() => {
              setCode('')
              setError('')
              setStage('form')
            }}
            className="font-medium text-red-700 hover:underline"
          >
            Use a different email
          </button>
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <header className="space-y-4">
        <FullLogo iconSize={44} textSize={24} tagline="COMPLIANCE ENGINE" />
        <div className="space-y-1">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-admin-accent">
            Operator Console
          </p>
          <h1 className="text-xl font-semibold text-text">Sign in</h1>
          <p className="text-sm text-text-2">
            No password. We&rsquo;ll email you a one-time code. Operator
            access only.
          </p>
        </div>
      </header>

      {reasonBanner}

      <form onSubmit={handleRequestCode} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            className="mt-1 block w-full rounded border border-[color:var(--border-mid)] px-3 py-2 text-sm focus:border-red-700 focus:outline-none focus:ring-1 focus:ring-red-700"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-teal px-4 py-2 text-sm font-medium text-white hover:bg-teal-mid disabled:opacity-50"
        >
          {loading ? 'Sending code…' : 'Send code'}
        </button>
      </form>

      <p className="text-center text-xs text-text-3">
        Not an operator? You are in the wrong place.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-[color:var(--border)] bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  )
}
