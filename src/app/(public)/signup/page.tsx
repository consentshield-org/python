'use client'

import { createBrowserClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { OtpBoxes } from '@/components/otp-boxes'

type Stage = 'form' | 'code'

export default function SignupPage() {
  const [stage, setStage] = useState<Stage>('form')
  const [email, setEmail] = useState('')
  const [orgName, setOrgName] = useState('')
  const [industry, setIndustry] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        data: { org_name: orgName, industry: industry || null },
        shouldCreateUser: true,
      },
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

    // /auth/callback reads the freshly-set session cookie, runs
    // rpc_signup_bootstrap_org if this is a first-time user, then
    // redirects to /dashboard.
    router.push('/auth/callback')
    router.refresh()
  }

  if (stage === 'code') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Enter your code</h1>
            <p className="mt-1 text-sm text-gray-600">
              We sent a verification code to <strong>{email}</strong>. It expires in 1 hour.
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
              {loading ? 'Verifying...' : 'Verify and continue'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-600">
            Didn&rsquo;t get it?{' '}
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
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="mt-1 text-sm text-gray-600">
            No password. We&rsquo;ll email you a one-time code.
          </p>
        </div>

        <form onSubmit={handleRequestCode} className="space-y-4">
          <div>
            <label htmlFor="orgName" className="block text-sm font-medium">
              Organisation name
            </label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="industry" className="block text-sm font-medium">
              Industry
            </label>
            <select
              id="industry"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select...</option>
              <option value="saas">SaaS</option>
              <option value="edtech">Edtech</option>
              <option value="ecommerce">E-commerce</option>
              <option value="healthcare">Healthcare</option>
              <option value="fintech">Fintech</option>
              <option value="hrtech">HR Tech</option>
            </select>
          </div>

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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Sending code...' : 'Send code'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <a href="/login" className="font-medium text-black hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  )
}
