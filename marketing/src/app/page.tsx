import type { Metadata } from 'next'
import Link from 'next/link'
import { HomeHero } from '@/components/sections/home-hero'
import { Contrast } from '@/components/sections/contrast'
import { Story } from '@/components/sections/story'
import { DepaMoat } from '@/components/sections/depa-moat'
import { Timeline } from '@/components/sections/timeline'
import { PricingPreview } from '@/components/sections/pricing-preview'
import { CtaBand } from '@/components/sections/cta-band'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: "ConsentShield — India's DPDP compliance enforcement engine",
  description:
    "ConsentShield is the DEPA-native compliance engine for India's DPDP Act. Collect consent as artefacts, enforce it in real time, prove it with an audit trail the DPB can read.",
}

export default function Home() {
  return (
    <main id="page-home">
      <HomeHero />
      <Contrast />
      <Story />
      <DepaMoat />
      <Timeline />
      <PricingPreview />
      <CtaBand
        eyebrow="Talk to ConsentShield"
        title="A 30-minute demo is the fastest way to see whether your banner is actually being respected."
        body="We'll run a live observation report on your current website during the call. You'll see — within seconds — which trackers are firing, which ones shouldn't be, and what an enforcement-grade compliance posture looks like."
      >
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
        <Link href={ROUTES.contact.href} className="btn btn-secondary">
          Partner with us
        </Link>
      </CtaBand>
    </main>
  )
}
