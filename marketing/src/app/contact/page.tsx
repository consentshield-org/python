import type { Metadata } from 'next'
import { ContactForm } from '@/components/sections/contact-form'
import { DOWNLOAD_BRIEF } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Partners · ConsentShield',
  description:
    'Customer, partner, or curious — start the conversation. Book a demo, explore the CA firm program, download the Architecture Brief.',
}

export default function ContactPage() {
  return (
    <main id="page-contact">
      <section className="contact-hero">
        <div className="contact-hero-inner">
          <div className="contact-copy">
            <span className="eyebrow">Let&apos;s talk</span>
            <h1 className="display-lg">
              Customer, partner, or curious — this is where the conversation
              starts.
            </h1>
            <p className="lede">
              ConsentShield is a Hyderabad-based platform with an all-India
              go-to-market footprint. We&apos;re building the category-defining
              DPDP enforcement engine — and we&apos;re looking for customers,
              implementation partners, CA firms, and channel partners across
              Mumbai, Delhi NCR, Bengaluru, Hyderabad, Chennai, Pune, Kolkata,
              and Ahmedabad.
            </p>

            <div className="contact-options">
              <ContactOption
                icon={
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12l4 4L19 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
                title="Book a demo"
                desc="30-minute walkthrough with a live observation report on your current website. You'll see which trackers are firing and whether they match your banner configuration."
              />
              <ContactOption
                icon={
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                }
                title="Partner with us"
                desc="For go-to-market partners with all-India reach. The developer builds the platform; the partner runs the business. Revenue-sharing arrangement."
              />
              <ContactOption
                icon={
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect
                      x="4"
                      y="4"
                      width="16"
                      height="16"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M8 9h8M8 13h8M8 17h5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                }
                title="CA & legal firm program"
                desc="30% revenue share on referred and managed accounts. White-label multi-tenant dashboard for firms managing 10+ client compliance postures."
              />
              <ContactOption
                icon={
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 8v8M8 12h8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="9"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                }
                title="Technical walkthrough"
                desc="For engineering and compliance teams — 45-minute deep dive on the DEPA architecture, stateless oracle model, and schema. No slides."
              />

              <a
                className="contact-opt"
                href={DOWNLOAD_BRIEF.pdf}
                download
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  borderColor: 'var(--teal)',
                  background:
                    'linear-gradient(90deg, white 0%, rgba(224,244,241,.35) 100%)',
                }}
              >
                <div
                  className="contact-opt-icon"
                  style={{ background: 'var(--teal)', color: 'white' }}
                >
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M7 2h7l5 5v13a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M14 2v5h5M9 14l3 3 3-3M12 10v7"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    className="contact-opt-title"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    Architecture Brief · download{' '}
                    <span
                      className="mono"
                      style={{
                        fontSize: '9.5px',
                        letterSpacing: '.12em',
                        color: 'var(--teal)',
                        background: 'var(--teal-light)',
                        padding: '3px 8px',
                        borderRadius: 100,
                        textTransform: 'uppercase',
                        fontWeight: 600,
                      }}
                    >
                      PDF · 30 pages
                    </span>
                  </div>
                  <div className="contact-opt-desc">
                    Full technical, security, and compliance architecture.
                    Integration contracts, reference architectures, security
                    rules, and a due-diligence question bank. Standalone — no
                    supporting documents required.
                  </div>
                </div>
              </a>
            </div>
          </div>

          <ContactForm />
        </div>
      </section>
    </main>
  )
}

function ContactOption({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="contact-opt">
      <div className="contact-opt-icon">{icon}</div>
      <div>
        <div className="contact-opt-title">{title}</div>
        <div className="contact-opt-desc">{desc}</div>
      </div>
    </div>
  )
}
