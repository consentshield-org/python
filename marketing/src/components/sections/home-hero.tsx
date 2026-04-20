import Link from 'next/link'
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
          </Link>
          <Link href={ROUTES.product.href} className="btn btn-ghost">
            See the platform
          </Link>
        </div>
        <div className="hero-meta">
          <div className="hero-meta-item">
            <span className="hero-meta-label">Stack</span>
            <span className="hero-meta-value">
              DEPA-native · Stateless oracle
            </span>
          </div>
          <div className="hero-meta-item">
            <span className="hero-meta-label">Jurisdiction</span>
            <span className="hero-meta-value">India · DPDP Act 2023</span>
          </div>
          <div className="hero-meta-item">
            <span className="hero-meta-label">Status</span>
            <span className="hero-meta-value">
              Confidential preview — 2026
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
