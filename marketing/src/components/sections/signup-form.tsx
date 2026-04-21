'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { APP_URL, TURNSTILE_SITE_KEY } from '@/lib/env'

// ADR-0058 Sprint 1.2 — marketing-site signup intake form.
//
// Posts cross-origin to the customer app's public endpoint
// (`${APP_URL}/api/public/signup-intake`). The endpoint is Turnstile-
// gated, rate-limited, and existence-leak hardened — every success
// branch returns the same `{ok:true}` payload, so this form shows the
// same "Check your inbox" success state regardless of whether the
// email is fresh or already a customer (the dispatched email
// differentiates the two).

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js'

export type Plan = 'starter' | 'growth' | 'pro'

const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Starter — ₹2,999/mo',
  growth: 'Growth — ₹5,999/mo',
  pro: 'Pro — ₹9,999/mo',
}

export function SignupForm({ defaultPlan = 'growth' }: { defaultPlan?: Plan }) {
  const [submitted, setSubmitted] = useState<{ email: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (submitted) return
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT}"]`,
    )
    if (existing) return

    const s = document.createElement('script')
    s.src = TURNSTILE_SCRIPT
    s.async = true
    s.defer = true
    document.body.appendChild(s)
  }, [submitted])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return

    const data = new FormData(e.currentTarget)
    const payload = {
      email: String(data.get('email') ?? ''),
      org_name: String(data.get('org_name') ?? ''),
      plan_code: String(data.get('plan_code') ?? defaultPlan),
      turnstile_token: String(data.get('cf-turnstile-response') ?? ''),
    }

    setPending(true)
    setError(null)
    try {
      const res = await fetch(`${APP_URL}/api/public/signup-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 202) {
        setSubmitted({ email: payload.email })
        return
      }
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null
      setError(
        body?.error ??
          'Submission could not be delivered. Please try again or email hello@consentshield.in.',
      )
    } catch {
      setError(
        'Network error. Please retry, or email hello@consentshield.in.',
      )
    } finally {
      setPending(false)
    }
  }

  function reset() {
    setSubmitted(null)
    setError(null)
  }

  if (submitted) {
    return (
      <form
        className="contact-form"
        onSubmit={(e) => e.preventDefault()}
        aria-live="polite"
        style={{ textAlign: 'center' }}
      >
        <h3
          style={{
            fontFamily: 'var(--display)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--navy)',
            letterSpacing: '-.02em',
            marginBottom: 12,
          }}
        >
          Check your inbox.
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          We&apos;ve emailed a setup link to{' '}
          <strong>{submitted.email}</strong>. Click the link to verify your
          email and start the 7-step onboarding (about 5 minutes). The link
          expires in 14 days.
        </p>
        <p
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            marginTop: 14,
            lineHeight: 1.5,
          }}
        >
          Didn&apos;t receive it? Check your spam folder, or
        </p>
        <button
          type="button"
          onClick={reset}
          className="btn btn-secondary"
          style={{ marginTop: 8 }}
        >
          Try a different email
        </button>
      </form>
    )
  }

  return (
    <form className="contact-form" onSubmit={onSubmit} ref={formRef}>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="signup-email">
            Work email
          </label>
          <input
            id="signup-email"
            name="email"
            className="form-input"
            type="email"
            placeholder="priya@company.in"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="signup-org">
            Company name
          </label>
          <input
            id="signup-org"
            name="org_name"
            className="form-input"
            type="text"
            placeholder="Acme Technologies Pvt Ltd"
            autoComplete="organization"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="signup-plan">
            Plan
          </label>
          <select
            id="signup-plan"
            name="plan_code"
            className="form-select"
            defaultValue={defaultPlan}
          >
            {(Object.keys(PLAN_LABELS) as Plan[]).map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 18, marginBottom: 6 }}>
        <div
          className="cf-turnstile"
          data-sitekey={TURNSTILE_SITE_KEY}
          data-theme="light"
          aria-label="Human-verification challenge"
        />
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            margin: '14px 0 4px',
            padding: '10px 14px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 7,
            color: '#B91C1C',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={pending}
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: 14,
          marginTop: 14,
          opacity: pending ? 0.7 : 1,
          cursor: pending ? 'wait' : 'pointer',
        }}
      >
        {pending ? 'Sending setup link…' : 'Email me the setup link'}
        {!pending ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 7h8m0 0L7.5 3.5M11 7L7.5 10.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>
      <p
        style={{
          fontSize: 12,
          color: 'var(--ink-3)',
          marginTop: 14,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        14-day free trial. No credit card. You can change your plan during
        onboarding.
      </p>
    </form>
  )
}
