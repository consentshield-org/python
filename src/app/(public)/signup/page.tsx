'use client'

import { createBrowserClient } from '@/lib/supabase/browser'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [orgName, setOrgName] = useState('')
  const [industry, setIndustry] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const router = useRouter()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createBrowserClient()
    const callbackUrl = `${window.location.origin}/auth/callback`

    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { org_name: orgName, industry: industry || null },
        emailRedirectTo: callbackUrl,
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    if (!data.user) {
      setError('Signup failed — no user returned')
      setLoading(false)
      return
    }

    // Two Supabase flavours converge on /auth/callback:
    //   - "Confirm email" OFF: signUp returns a session; cookies are set;
    //     navigate to the callback which runs rpc_signup_bootstrap_org.
    //   - "Confirm email" ON: session is null. Show the pending panel;
    //     the user clicks the email link and lands on /auth/callback?code=…
    //     which does the exchange + bootstrap.
    if (data.session) {
      router.push('/auth/callback')
      router.refresh()
      return
    }

    setPending(true)
    setLoading(false)
  }

  if (pending) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-sm text-gray-600">
            We sent a confirmation link to <strong>{email}</strong>. Click it to finish
            creating <strong>{orgName}</strong>. You&rsquo;ll land on the dashboard once
            verified.
          </p>
          <p className="text-xs text-gray-500">
            If the email doesn&rsquo;t arrive in a minute, check your spam folder or{' '}
            <button
              type="button"
              onClick={() => {
                setPending(false)
              }}
              className="underline"
            >
              try again
            </button>
            .
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
          <p className="mt-1 text-sm text-gray-600">Start your DPDP compliance journey</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
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

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create account'}
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
