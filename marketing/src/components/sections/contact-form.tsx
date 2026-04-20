'use client'

import { useState, type FormEvent } from 'react'

// Contact form. Phase 4 adds Turnstile + BotID + real submit route.
// Right now the form preventDefaults and flips a local "submitted" flag
// so the UI feedback is present without a backend handler.
export function ContactForm() {
  const [submitted, setSubmitted] = useState(false)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <form
        className="contact-form"
        onSubmit={onSubmit}
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
          Thanks — we&apos;ll be in touch.
        </h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          A ConsentShield operator will reply within one working day. In the
          meantime, the Architecture Brief covers most technical questions
          standalone.
        </p>
        <p
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            marginTop: 14,
            lineHeight: 1.5,
          }}
        >
          (Form submission wiring + Turnstile bot gate ship in ADR-0501 Phase
          4.)
        </p>
      </form>
    )
  }

  return (
    <form className="contact-form" onSubmit={onSubmit}>
      <div className="form-row">
        <div className="form-field">
          <label className="form-label" htmlFor="first-name">
            First name
          </label>
          <input
            id="first-name"
            className="form-input"
            type="text"
            placeholder="Priya"
            autoComplete="given-name"
            required
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="last-name">
            Last name
          </label>
          <input
            id="last-name"
            className="form-input"
            type="text"
            placeholder="Iyer"
            autoComplete="family-name"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="work-email">
            Work email
          </label>
          <input
            id="work-email"
            className="form-input"
            type="email"
            placeholder="priya@company.in"
            autoComplete="email"
            required
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field">
          <label className="form-label" htmlFor="company">
            Company
          </label>
          <input
            id="company"
            className="form-input"
            type="text"
            placeholder="Your company"
            autoComplete="organization"
            required
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="role">
            Role
          </label>
          <input
            id="role"
            className="form-input"
            type="text"
            placeholder="Head of Compliance"
            autoComplete="organization-title"
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="interest">
            I&apos;m interested in
          </label>
          <select id="interest" className="form-select" defaultValue="demo">
            <option value="demo">Booking a product demo</option>
            <option value="partner">Partnership conversation</option>
            <option value="ca">CA / legal firm program</option>
            <option value="technical">Technical architecture walkthrough</option>
            <option value="bfsi">BFSI specialist track</option>
            <option value="healthcare">Healthcare / ABDM bundle</option>
            <option value="other">Something else</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="form-field full">
          <label className="form-label" htmlFor="notes">
            Anything else we should know
          </label>
          <textarea
            id="notes"
            className="form-textarea"
            placeholder="Team size, current compliance setup, timeline, specific questions…"
          />
        </div>
      </div>
      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', justifyContent: 'center', padding: 14 }}
      >
        Send — we reply within one working day
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 7h8m0 0L7.5 3.5M11 7L7.5 10.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
        Confidential — for prospective customer and partner review only.
        <br />
        ConsentShield, Hyderabad, India.
      </p>
    </form>
  )
}
