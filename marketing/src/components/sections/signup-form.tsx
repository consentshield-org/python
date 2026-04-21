'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { APP_URL, TURNSTILE_SITE_KEY } from '@/lib/env'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          theme?: 'light' | 'dark' | 'auto'
          callback?: (token: string) => void
          'error-callback'?: () => void
          'expired-callback'?: () => void
          'timeout-callback'?: () => void
        },
      ) => string
      remove: (widgetId: string) => void
      reset: (widgetId: string) => void
    }
  }
}

// ADR-0058 Sprint 1.2 — marketing-site signup intake form.
//
// Posts cross-origin to the customer app's public endpoint
// (`${APP_URL}/api/public/signup-intake`). The endpoint is Turnstile-
// gated, rate-limited, and — per product decision 2026-04-21 — now
// returns an explicit branch so this form can render distinct UX for
// "already a customer" / "already invited" / "created". Turnstile +
// rate-limits remain the enumeration ceiling.

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js'

export type Plan = 'starter' | 'growth' | 'pro'

const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Starter — ₹2,999/mo',
  growth: 'Growth — ₹5,999/mo',
  pro: 'Pro — ₹9,999/mo',
}

type Outcome =
  | { kind: 'created'; email: string }
  | { kind: 'already_invited'; email: string }
  | { kind: 'existing_customer'; email: string }

export function SignupForm({ defaultPlan = 'growth' }: { defaultPlan?: Plan }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const widgetHostRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // Explicit Turnstile render — avoids the wedged-widget state the
  // auto-scan gets into after site-key changes / dev hot-reloads.
  useEffect(() => {
    if (outcome) return
    let cancelled = false

    function renderWidget() {
      if (cancelled) return
      if (!widgetHostRef.current) return
      const ts = window.turnstile
      if (!ts) return
      // Tear down any prior render (StrictMode double-mount, key swap).
      if (widgetIdRef.current) {
        try {
          ts.remove(widgetIdRef.current)
        } catch {
          /* idempotent */
        }
        widgetIdRef.current = null
      }
      widgetIdRef.current = ts.render(widgetHostRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'light',
        callback: (token) => setTurnstileToken(token),
        'error-callback': () => setTurnstileToken(null),
        'expired-callback': () => setTurnstileToken(null),
        'timeout-callback': () => setTurnstileToken(null),
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src^="${TURNSTILE_SCRIPT}"]`,
      )
      if (!existing) {
        const s = document.createElement('script')
        s.src = TURNSTILE_SCRIPT
        s.async = true
        s.defer = true
        s.addEventListener('load', renderWidget)
        document.body.appendChild(s)
      } else {
        existing.addEventListener('load', renderWidget)
      }
    }

    return () => {
      cancelled = true
      const ts = window.turnstile
      if (ts && widgetIdRef.current) {
        try {
          ts.remove(widgetIdRef.current)
        } catch {
          /* noop */
        }
        widgetIdRef.current = null
      }
    }
  }, [outcome])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return

    const data = new FormData(e.currentTarget)
    const token =
      turnstileToken ?? String(data.get('cf-turnstile-response') ?? '')
    if (!token) {
      setError(
        'Security challenge hasn\u2019t loaded yet. Wait a moment and try again.',
      )
      return
    }
    const payload = {
      email: String(data.get('email') ?? ''),
      org_name: String(data.get('org_name') ?? ''),
      plan_code: String(data.get('plan_code') ?? defaultPlan),
      turnstile_token: token,
    }

    setPending(true)
    setError(null)
    try {
      const res = await fetch(`${APP_URL}/api/public/signup-intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json().catch(() => null)) as
        | { status?: string; error?: string }
        | null

      if (body?.status === 'created') {
        setOutcome({ kind: 'created', email: payload.email })
        return
      }
      if (body?.status === 'already_invited') {
        setOutcome({ kind: 'already_invited', email: payload.email })
        return
      }
      if (body?.status === 'existing_customer') {
        setOutcome({ kind: 'existing_customer', email: payload.email })
        return
      }
      if (body?.status === 'admin_identity') {
        setError(
          'That email is registered as a ConsentShield operator. Please use a different email for a customer account.',
        )
        return
      }
      if (body?.status === 'invalid_email') {
        setError("That email doesn't look right. Double-check and try again.")
        return
      }
      if (body?.status === 'invalid_plan') {
        setError(
          'That plan is no longer available. Pick a plan from the pricing page.',
        )
        return
      }
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
    setOutcome(null)
    setError(null)
  }

  if (outcome) {
    return (
      <form
        className="contact-form"
        onSubmit={(e) => e.preventDefault()}
        aria-live="polite"
        style={{ textAlign: 'center' }}
      >
        {outcome.kind === 'created' ? (
          <>
            <h3 style={{
              fontFamily: 'var(--display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--navy)',
              letterSpacing: '-.02em',
              marginBottom: 12,
            }}>Check your inbox.</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              We&apos;ve emailed a setup link to{' '}
              <strong>{outcome.email}</strong>. Click the link to start the
              7-step onboarding (about 5 minutes). The link expires in 14
              days.
            </p>
            <p style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              marginTop: 14,
              lineHeight: 1.5,
            }}>
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
          </>
        ) : outcome.kind === 'already_invited' ? (
          <>
            <h3 style={{
              fontFamily: 'var(--display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--navy)',
              letterSpacing: '-.02em',
              marginBottom: 12,
            }}>We&apos;ve sent this before.</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              A setup link is already in the inbox for{' '}
              <strong>{outcome.email}</strong>. Check your spam folder, or
              ask us to resend if the original expired.
            </p>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                gap: 10,
                justifyContent: 'center',
              }}
            >
              <button
                type="button"
                onClick={reset}
                className="btn btn-secondary"
              >
                Try a different email
              </button>
              <a
                href="mailto:hello@consentshield.in?subject=Resend%20ConsentShield%20setup%20link"
                className="btn btn-secondary"
              >
                Ask for a resend
              </a>
            </div>
          </>
        ) : (
          <>
            <h3 style={{
              fontFamily: 'var(--display)',
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--navy)',
              letterSpacing: '-.02em',
              marginBottom: 12,
            }}>You already have an account.</h3>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              <strong>{outcome.email}</strong> is already registered with
              ConsentShield. Sign in to continue — no new setup needed.
            </p>
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                gap: 10,
                justifyContent: 'center',
              }}
            >
              <a
                href={`${APP_URL}/login`}
                className="btn btn-primary"
              >
                Sign in
              </a>
              <button
                type="button"
                onClick={reset}
                className="btn btn-secondary"
              >
                Use a different email
              </button>
            </div>
          </>
        )}
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
          ref={widgetHostRef}
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
