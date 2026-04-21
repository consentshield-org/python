'use client'

import { createBrowserClient } from '@/lib/supabase/browser'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { OtpBoxes } from '@/components/otp-boxes'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

type Stage = 'form' | 'code'

function LoginForm() {
  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/dashboard'
  const urlError = searchParams.get('error')

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

  if (stage === 'code') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Enter your code</h1>
            <p className="mt-1 text-sm text-gray-600">
              We sent a verification code to <strong>{email}</strong>.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <OtpBoxes value={code} onChange={setCode} autoFocus />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600">
            <button
              type="button"
              onClick={() => {
                setCode('')
                setError('')
                setStage('form')
              }}
              className="font-medium text-black hover:underline"
            >
              Use a different email
            </button>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Sign in to ConsentShield</h1>
          <p className="mt-1 text-sm text-gray-600">
            Use the email on your ConsentShield account — we&rsquo;ll send
            a one-time code.
          </p>
        </div>

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
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {(error || urlError) && (
            <p className="text-sm text-red-600">{error || urlError}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Sending code...' : 'Send code'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          No account?{' '}
          <a href="/signup" className="font-medium text-black hover:underline">
            Sign up
          </a>
        </p>
      </div>
    </main>
  )
}
