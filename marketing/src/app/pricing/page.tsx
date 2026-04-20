import type { Metadata } from 'next'
import Link from 'next/link'
import { PriceToggle } from '@/components/sections/price-toggle'
import { PriceTable } from '@/components/sections/price-table'
import { BfsiCallout } from '@/components/sections/bfsi-callout'
import { CtaBand } from '@/components/sections/cta-band'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Pricing · ConsentShield',
  description:
    'Every tier is a fraction of a law firm retainer. Starter, Growth, Pro, Enterprise — plus a BFSI specialist track and Healthcare bundle add-on.',
}

export default function PricingPage() {
  return (
    <main id="page-pricing">
      <section className="price-hero">
        <div className="price-hero-inner">
          <span className="eyebrow">Pricing</span>
          <h1 className="display-lg">
            Every tier is a fraction of a law firm retainer.
          </h1>
          <p className="lede">
            A single DPDP legal engagement runs ₹5–25 lakh and delivers a
            one-time document. ConsentShield is a continuous, living
            compliance system for a fraction of that — with a 20% discount on
            annual prepayment.
          </p>
          <PriceToggle />
        </div>
      </section>

      <PriceTable />

      <BfsiCallout />

      <div
        className="container"
        style={{ marginTop: 48, textAlign: 'center' }}
      >
        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-3)',
            maxWidth: 740,
            margin: '0 auto 8px',
          }}
        >
          Add-ons:{' '}
          <strong style={{ color: 'var(--navy)' }}>Healthcare bundle</strong>{' '}
          ₹4,999/mo (₹60,000–1,00,000/yr).{' '}
          <strong style={{ color: 'var(--navy)' }}>
            CA &amp; legal firm partners:
          </strong>{' '}
          30% revenue share on referred and managed accounts.{' '}
          <strong style={{ color: 'var(--navy)' }}>
            Startup accelerator programs
          </strong>{' '}
          (NASSCOM, T-Hub, iSPIRT): 40% off Growth for cohort members.
        </p>
      </div>

      <CtaBand
        eyebrow="Quick to try, quick to decide"
        title="14-day free trial on Starter and Growth."
        body="No credit card. Full platform access. If your site runs trackers without matching consent artefacts, you'll see it in the first dashboard load."
      >
        <Link href={ROUTES.contact.href} className="btn btn-primary">
          Start free trial
        </Link>
        <Link href={ROUTES.contact.href} className="btn btn-secondary">
          Book a demo
        </Link>
      </CtaBand>
    </main>
  )
}
