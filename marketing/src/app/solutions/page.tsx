import type { Metadata } from 'next'
import Link from 'next/link'
import { SolutionsTabs } from '@/components/sections/solutions-tabs'
import { CtaBand } from '@/components/sections/cta-band'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Solutions · ConsentShield',
  description:
    'DPDP compliance by sector — SaaS & B2B, Edtech, D2C & e-commerce, Healthcare (ABDM), BFSI (NBFC + Broking). Each template pre-populates purpose definitions and inventory.',
}

export default function SolutionsPage() {
  return (
    <main id="page-solutions">
      <section className="sol-hero">
        <div className="sol-hero-inner">
          <span className="eyebrow">Solutions by vertical</span>
          <h1 className="display-lg">
            Pre-configured for the verticals that bought first.
          </h1>
          <p className="lede">
            Each sector template pre-populates Purpose Definitions, data
            inventory, privacy notice language, and the highest-risk data
            categories — so onboarding a new customer starts at 60%
            configured, not 0%.
          </p>
        </div>
        <SolutionsTabs />
      </section>

      <CtaBand
        eyebrow="Your vertical isn't listed?"
        title="Sector templates are extensible."
        body="If you're in HR tech, insurance, legaltech, or public sector — tell us. Sector templates are configuration, not code. New ones ship in days, not quarters."
      >
        <Link href={ROUTES.contact.href} className="btn btn-primary">
          Tell us about your vertical
        </Link>
      </CtaBand>
    </main>
  )
}
