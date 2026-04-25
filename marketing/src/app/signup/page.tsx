import type { Metadata } from 'next'
import { SignupForm, type Plan } from '@/components/sections/signup-form'

// ADR-0058 Sprint 1.2 — marketing-site signup intake page.
//
// Reads `?plan=<starter|growth|pro>` to preselect the plan picker.
// Anything else falls back to growth (the most-chosen tier per
// pricing page). Enterprise is intentionally not self-serve — those
// CTAs route to /contact.

export const metadata: Metadata = {
  title: 'Sign up · ConsentShield',
  description:
    "Start your 30-day free trial. We'll email a setup link, then walk you through the 7-step onboarding (about 5 minutes).",
}

const VALID: ReadonlyArray<Plan> = ['starter', 'growth', 'pro']

interface PageProps {
  searchParams: Promise<{ plan?: string }>
}

function normalisePlan(raw: string | undefined): Plan {
  if (raw && (VALID as readonly string[]).includes(raw)) return raw as Plan
  return 'growth'
}

export default async function SignupPage({ searchParams }: PageProps) {
  const { plan } = await searchParams
  const defaultPlan = normalisePlan(plan)

  return (
    <main id="page-signup">
      <section className="contact-hero">
        <div className="contact-hero-inner">
          <div className="contact-copy">
            <span className="eyebrow">Start your trial</span>
            <h1 className="display-lg">
              Onboard in five minutes. Cancel any time.
            </h1>
            <p className="lede">
              Pick your plan, give us your work email, and we&apos;ll send a
              setup link. From the link, the 7-step wizard creates your
              account, picks your sectoral templates, deploys the banner
              snippet, and shows your first compliance score — usually
              under five minutes.
            </p>

            <div className="contact-options">
              <Bullet>
                <strong>30-day free trial</strong> on Starter / Growth / Pro.
                No credit card required.
              </Bullet>
              <Bullet>
                <strong>Need Enterprise or BFSI?</strong> Talk to us at{' '}
                <a
                  href="/contact"
                  style={{
                    color: 'var(--teal)',
                    borderBottom: '1px dashed var(--teal)',
                  }}
                >
                  /contact
                </a>{' '}
                — Enterprise has scope and contracting nuances we work
                through over a 30-minute call.
              </Bullet>
              <Bullet>
                <strong>Already have an account?</strong>{' '}
                <a
                  href="/contact"
                  style={{
                    color: 'var(--teal)',
                    borderBottom: '1px dashed var(--teal)',
                  }}
                >
                  Sign in
                </a>{' '}
                instead — your existing setup is preserved.
              </Bullet>
            </div>
          </div>

          <SignupForm defaultPlan={defaultPlan} />
        </div>
      </section>
    </main>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="contact-opt">
      <div
        className="contact-opt-icon"
        style={{ background: 'var(--teal-light)', color: 'var(--teal)' }}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12l4 4L19 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="contact-opt-desc" style={{ paddingTop: 6 }}>
        {children}
      </div>
    </div>
  )
}
