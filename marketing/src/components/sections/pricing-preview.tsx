import Link from 'next/link'
import { ROUTES } from '@/lib/routes'

interface Tier {
  name: string
  tagline: string
  price: string
  period: string
  annual: string
  cta: string
  /** ADR-0058 Sprint 1.2: routing per tier. Starter / Growth / Pro
   * are self-serve via /signup?plan=<code>; Enterprise is contact-only. */
  ctaHref: string
  features: string[]
  featured?: boolean
}

const TIERS: Tier[] = [
  {
    name: 'Starter',
    tagline: 'Solo SaaS founders, early-stage startups',
    price: '2,999',
    period: '/mo',
    annual: 'or ₹24,000–50,000/yr',
    cta: 'Start free trial',
    ctaHref: '/signup?plan=starter',
    features: [
      'Consent banner + DEPA artefacts',
      'Purpose Definition Registry',
      'Tracker enforcement',
      'Privacy notice + data inventory',
    ],
  },
  {
    name: 'Growth',
    tagline: 'Series A–B SaaS, edtech, D2C',
    price: '5,999',
    period: '/mo',
    annual: 'or ₹50,000–1,00,000/yr',
    cta: 'Start free trial',
    ctaHref: '/signup?plan=growth',
    featured: true,
    features: [
      'Everything in Starter',
      'Rights management + 30-day SLA',
      'Artefact-scoped deletion (3 connectors)',
      'Withdrawal verification',
      'Security posture scans',
    ],
  },
  {
    name: 'Pro',
    tagline: 'Multi-vertical, GDPR exposure',
    price: '9,999',
    period: '/mo',
    annual: 'or ₹1,00,000–3,00,000/yr',
    cta: 'Start free trial',
    ctaHref: '/signup?plan=pro',
    features: [
      'Everything in Growth',
      'GDPR module',
      '13 deletion connectors',
      'Consent probe testing',
      'Compliance API + BFSI template',
    ],
  },
  {
    name: 'Enterprise',
    tagline: 'Large enterprise, CA firms, BFSI',
    price: '24,999',
    period: '+/mo',
    annual: 'or ₹3,00,000–5,00,000/yr',
    cta: 'Talk to us',
    ctaHref: '/contact',
    features: [
      'Everything in Pro',
      'White-label + custom domains',
      'Unlimited deletion connectors',
      'DPO matchmaking',
      'BFSI Regulatory Exemption Engine',
    ],
  },
]

export function PricingPreview() {
  return (
    <section className="price-preview">
      <div className="container">
        <div className="price-head">
          <span className="eyebrow">Pricing</span>
          <h2 className="display-md">
            Priced against a law firm retainer — not a SaaS tool.
          </h2>
          <p>
            A single DPDP legal engagement costs ₹5–25 lakh and delivers a
            document. Every ConsentShield tier is a fraction of that for a
            continuous, living compliance system.
          </p>
        </div>
        <div className="price-tiers">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`price-tier${t.featured ? ' featured' : ''}`}
            >
              <div className="price-name">{t.name}</div>
              <div className="price-tagline">{t.tagline}</div>
              <div className="price-amount">
                <span className="price-symbol">₹</span>
                <span className="price-num">{t.price}</span>
                <span className="price-period">{t.period}</span>
              </div>
              <div className="price-annual">{t.annual}</div>
              <Link href={t.ctaHref} className="price-cta">
                {t.cta}
              </Link>
              <ul className="price-features">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <Link href={ROUTES.pricing.href} className="btn btn-ghost">
            See full pricing comparison
          </Link>
        </div>
      </div>
    </section>
  )
}
