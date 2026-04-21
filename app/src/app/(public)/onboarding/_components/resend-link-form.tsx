'use client'

import { useState } from 'react'

// ADR-0058 Sprint 1.5 — resend recovery form.
//
// Rendered inside the `/onboarding` no-token + invalid-token shells.
// Always returns the same "check your inbox" UI regardless of whether
// the email matched a pending invite (endpoint-side existence-leak
// parity). Honest copy: "if there's a pending invitation for this
// email, we've sent it again" — doesn't claim the email landed
// somewhere it didn't.

export function ResendLinkForm() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    setPending(true)
    setError('')
    try {
      const res = await fetch('/api/public/resend-intake-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        setError(body?.error ?? 'Too many requests. Try again in a minute.')
        setPending(false)
        return
      }
      // Endpoint returns {ok:true} on every non-rate-limit path.
      setSent(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.')
    } finally {
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div className="mt-4 rounded border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
        <p>
          If a pending invitation exists for <strong>{sent}</strong>, we&apos;ve
          sent the setup link again. Check your inbox (and spam folder) in
          the next couple of minutes.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(null)
            setEmail('')
          }}
          className="mt-3 text-xs text-teal-800 underline hover:text-teal-900"
        >
          Try a different email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      <label
        htmlFor="resend-email"
        className="block text-xs font-medium uppercase tracking-wide text-gray-500"
      >
        Resend setup link
      </label>
      <div className="flex flex-wrap items-start gap-2">
        <input
          id="resend-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.in"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Resend'}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <p className="text-[11px] text-gray-500">
        If you never signed up, visit{' '}
        <a
          href="https://consentshield.in/signup"
          className="text-gray-700 underline hover:text-gray-900"
        >
          consentshield.in/signup
        </a>{' '}
        to start.
      </p>
    </form>
  )
}
