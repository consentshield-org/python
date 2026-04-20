import Link from 'next/link'
import { HowItWorksDemo } from './how-it-works-demo'
import { ROUTES } from '@/lib/routes'

export function HomeHero() {
  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-eyebrow-row">
          <span className="hero-pill">
            <span className="hero-pill-dot" />
            DEPA-native · Built in India · Confidential preview
          </span>
        </div>
        <h1 className="display-xl">
          India&apos;s DPDP compliance <em>enforcement engine</em>.
        </h1>
        <p className="hero-lede">
          Most compliance tools ask{' '}
          <em>
            &ldquo;Have you configured your consent banner?&rdquo;
          </em>{' '}
          and check a box.{' '}
          <strong>
            ConsentShield asks: &ldquo;Is your consent banner actually being
            respected by the third-party scripts on your website right
            now?&rdquo;
          </strong>{' '}
          — and shows you the answer in real time.
        </p>
        <div className="hero-ctas">
          <Link href={ROUTES.contact.href} className="btn btn-primary">
            Book a demo
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 7h8m0 0L7.5 3.5M11 7L7.5 10.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <HowItWorksDemo />
          <Link href={ROUTES.depa.href} className="btn btn-ghost">
            Why DEPA-native matters
          </Link>
        </div>
        <div className="hero-meta">
          <div className="hero-meta-item">
            <span className="hero-meta-label">Enforcement begins</span>
            <span className="hero-meta-value">13 May 2027</span>
          </div>
          <div className="hero-meta-item">
            <span className="hero-meta-label">Per-violation penalty</span>
            <span className="hero-meta-value">Up to ₹250 crore</span>
          </div>
          <div className="hero-meta-item">
            <span className="hero-meta-label">Indian businesses affected</span>
            <span className="hero-meta-value">4,00,000+</span>
          </div>
          <div className="hero-meta-item">
            <span className="hero-meta-label">Deploys in</span>
            <span className="hero-meta-value">48 hours</span>
          </div>
        </div>
      </div>
    </section>
  )
}
