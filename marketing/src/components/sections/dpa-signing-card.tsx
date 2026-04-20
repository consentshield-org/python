'use client'

import { useState, type FormEvent } from 'react'

// Digital-signature execution card on the DPA page. In the HTML spec the
// button fires alert('…In production, this records the digital signature…').
// Phase 4 wires the real signature record (signatory + IP + timestamp + DPA
// version) into admin/billing. For now the card collects inputs, blocks
// submit, and shows an acknowledgement.
export function DpaSigningCard() {
  const [signed, setSigned] = useState(false)

  function onSign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSigned(true)
  }

  return (
    <div className="dpa-signing">
      <div className="dpa-signing-card">
        <div className="dpa-signing-head">
          <h3>Execute digitally</h3>
          <p>
            By accepting below, you execute the DPA and — where applicable to
            your Processing — the EU Data Protection Addendum. The acceptance
            record is preserved with a cryptographic timestamp and forms a
            legally binding signature.
          </p>
        </div>

        {signed ? (
          <div
            role="status"
            style={{
              padding: '22px 24px',
              background: 'var(--teal-light)',
              border: '1px solid var(--teal)',
              borderRadius: 'var(--r-md)',
              color: 'var(--navy)',
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            <strong>Signature received (preview mode).</strong> In production
            this step records signatory identity, work email, IP, timestamp,
            and DPA version against the Customer&apos;s subscription. Phase 4
            wires this into billing.
          </div>
        ) : (
          <form onSubmit={onSign}>
            <div className="dpa-signing-fields">
              <div className="dpa-signing-field">
                <label className="form-label" htmlFor="sign-customer">
                  Customer legal name
                </label>
                <input
                  id="sign-customer"
                  className="form-input"
                  type="text"
                  placeholder="Your registered business name"
                  required
                />
              </div>
              <div className="dpa-signing-field">
                <label className="form-label" htmlFor="sign-signatory">
                  Authorised signatory
                </label>
                <input
                  id="sign-signatory"
                  className="form-input"
                  type="text"
                  placeholder="Full name of the person accepting"
                  required
                />
              </div>
              <div className="dpa-signing-field">
                <label className="form-label" htmlFor="sign-title">
                  Title / role
                </label>
                <input
                  id="sign-title"
                  className="form-input"
                  type="text"
                  placeholder="e.g. CTO, Head of Compliance, DPO"
                  required
                />
              </div>
              <div className="dpa-signing-field">
                <label className="form-label" htmlFor="sign-email">
                  Work email
                </label>
                <input
                  id="sign-email"
                  className="form-input"
                  type="email"
                  placeholder="signatory@company.in"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="dpa-signing-field full">
                <label className="dpa-signing-checkbox">
                  <input type="checkbox" required />
                  <span>
                    I confirm I have authority to bind my organisation to the
                    DPA and, where EU / UK / Swiss data is Processed, the EU
                    Data Protection Addendum. I have read both, and I accept
                    them in their current versions.
                  </span>
                </label>
              </div>
            </div>
            <div className="dpa-signing-row">
              <button type="submit" className="btn btn-primary">
                Accept &amp; sign
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                >
                  <path
                    d="M3 7l3 3 5-6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <a href="/contact" className="btn btn-secondary">
                Route to our legal team
              </a>
            </div>
          </form>
        )}

        <div className="dpa-signing-meta">
          <div className="dpa-signing-meta-item">
            <div className="dpa-signing-meta-label">Recorded at signing</div>
            <div className="dpa-signing-meta-value">
              Signatory · Timestamp · IP · DPA version
            </div>
          </div>
          <div className="dpa-signing-meta-item">
            <div className="dpa-signing-meta-label">Countersignature</div>
            <div className="dpa-signing-meta-value">
              Auto-applied on ConsentShield side
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
