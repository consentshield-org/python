import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CapabilityLayer,
  type Feature,
} from '@/components/sections/capability-layer'
import { ArchPromo } from '@/components/sections/arch-promo'
import { CtaBand } from '@/components/sections/cta-band'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Product · ConsentShield',
  description:
    'Four capability layers. One DEPA-native spine. Compliance foundation, enforcement depth, multi-framework ecosystem, healthcare + enterprise.',
}

const LAYER_1: Feature[] = [
  {
    name: 'DEPA-native consent system',
    desc: 'No-code banner builder producing CDN-hosted JS. Consent is structured as a DEPA artefact per purpose — each with defined data scope, expiry, and revocation chain.',
  },
  {
    name: 'Purpose Definition Registry',
    desc: 'The foundation of the whole platform. Each purpose defines what data it covers, how long consent lasts, and whether expiry triggers automatic deletion.',
  },
  {
    name: 'Tracker Detection Engine',
    desc: 'Embedded intelligence classifying third-party scripts — GA, Meta Pixel, Hotjar, CleverTap, MoEngage, Razorpay, and others common on Indian sites — against consent artefacts.',
  },
  {
    name: 'Privacy Notice Generator',
    desc: 'Guided wizard producing a plain-language, legally structured privacy notice. Each processing purpose links to a Purpose Definition. Hosted page + downloadable PDF.',
  },
  {
    name: 'Data Inventory',
    desc: 'Auto-seeded from tracker detection. Customer supplements with non-web data flows. Inventory maps directly to Purpose Definitions and artefact data scopes.',
  },
  {
    name: '72-hour breach workflow',
    desc: 'Guided end-to-end: detect → log → categorise → assess → draft → approve → notify → remediate. Surfaces which active artefacts are affected. Every step timestamped.',
  },
]

const LAYER_2: Feature[] = [
  {
    name: 'Rights management + SLA',
    desc: 'Full lifecycle for erasure, access, correction, and nomination requests. When an erasure arrives, surfaces all active artefacts for that principal. 30-day SLA timers.',
  },
  {
    name: 'Artefact-scoped deletion',
    desc: 'Deletion commands scoped to the categories the artefact covered. Pre-built connectors: Mailchimp, HubSpot, Zoho CRM, Freshdesk, Intercom, CleverTap, Shopify, Razorpay, others.',
  },
  {
    name: 'Withdrawal verification',
    desc: 'On withdrawal, ConsentShield revokes the artefact, removes it from the validity cache, and schedules automated scans to confirm the right trackers stopped firing.',
  },
  {
    name: 'Consent expiry management',
    desc: 'A new surface with no equivalent in India. Shows artefacts approaching expiry, those lapsed, whether deletion triggered. 30-day ahead alerts for re-consent campaigns.',
  },
  {
    name: 'Security posture scans',
    desc: 'Nightly external scans: SSL validity, security headers (HSTS, CSP, X-Frame-Options), vulnerable JS libraries, mixed content, cookie security flags.',
  },
  {
    name: 'Audit export package',
    desc: 'One-click DPB-formatted evidence: artefact register, consent logs, tracker observations, violation history, rights request history, breach notifications, data inventory.',
  },
]

const LAYER_3: Feature[] = [
  {
    name: 'GDPR module',
    desc: 'Dual-framework coverage. Banner detects visitor location and applies the right framework. Adds legal basis documentation, DPIA templates, SCC tracking, EU representative.',
  },
  {
    name: 'Consent probe testing',
    desc: 'Automated synthetic compliance testing. ConsentShield simulates users with specific consent states and verifies trackers behave correctly for the artefact state they govern.',
  },
  {
    name: 'DPO-as-a-Service marketplace',
    desc: 'Curated marketplace of empanelled Data Protection Officers with auditor-level dashboard access. DPO carries legal liability; ConsentShield carries software liability.',
  },
  {
    name: 'Sector templates',
    desc: 'Pre-configured kits for six verticals: SaaS, edtech, fintech/BFSI (NBFC + broking), e-commerce, healthcare. Each pre-populates inventory, Purpose Definitions, and notice.',
  },
  {
    name: 'Compliance API',
    desc: 'Programmatic access to the artefact register, deletion orchestration, and rights workflow — so engineering teams can embed compliance into their own workflows.',
  },
  {
    name: 'Stateless oracle architecture',
    desc: (
      <>
        ConsentShield is a Data Processor, not a Fiduciary. Your artefact
        register lives in <strong>your</strong> R2 or S3 bucket. If
        ConsentShield disappears tomorrow, your compliance record is intact.
      </>
    ),
  },
]

const LAYER_4: Feature[] = [
  {
    name: 'ABDM healthcare bundle',
    desc: 'Unified DPDP + ABDM platform. ABHA lookup, ABDM consent artefacts, health record retrieval, prescription writing with drug interaction checks, digital prescription upload.',
  },
  {
    name: 'Zero-storage mode',
    desc: 'Mandatory for health data. FHIR records flow through ConsentShield in memory only — never persisted. Clinical content never touches ConsentShield\u2019s databases.',
  },
  {
    name: 'Enterprise white-label',
    desc: 'Custom branding, custom domains, SSO, multi-team roles, customer-held encryption keys for export storage, custom SLAs. Built for CA firms managing multiple clients.',
  },
  {
    name: 'BFSI regulatory overlay',
    desc: 'Regulatory Exemption Engine for SEBI retention-vs-erasure conflicts. Third-party consent flows for nominees and guarantors. Dual breach notification timelines.',
  },
  {
    name: 'BYOS bring-your-own-storage',
    desc: 'Enterprise customers can hold the canonical compliance record in their own R2 or S3 bucket. ConsentShield writes; never reads, never lists, never deletes.',
  },
  {
    name: 'Multi-property management',
    desc: 'CA firms and multi-brand enterprises manage consent posture across all client or brand web properties from a single dashboard, with roles scoped per property.',
  },
]

export default function ProductPage() {
  return (
    <main id="page-product">
      <section className="product-hero">
        <div className="product-hero-inner">
          <span className="eyebrow">Product</span>
          <h1 className="display-lg">
            Four capability layers. One DEPA-native spine.
          </h1>
          <p className="lede">
            Every feature is a product of the same foundational consent
            artefact model. Nothing is stitched together. Each layer builds on
            the one beneath.
          </p>
        </div>
      </section>

      <CapabilityLayer
        tag="Layer 01"
        title={
          <>
            Compliance
            <br />
            Foundation
          </>
        }
        lede="The core infrastructure every customer deploys on day one. Consent collection, Purpose Definition Registry, privacy notice, data inventory, breach workflow, and the compliance dashboard."
        features={LAYER_1}
      />

      <CapabilityLayer
        tag="Layer 02"
        title={
          <>
            Enforcement
            <br />
            Depth
          </>
        }
        lede="The layer that separates ConsentShield from documentation-only tools. Real-time monitoring, verified withdrawal, artefact-scoped deletion orchestration with signed receipts."
        features={LAYER_2}
      />

      <CapabilityLayer
        tag="Layer 03"
        title={
          <>
            Multi-framework
            <br />+ ecosystem
          </>
        }
        lede="One artefact model, multiple regulatory frameworks. Dual DPDP + GDPR coverage for Indian companies with EU customers, synthetic consent testing, DPO marketplace, and sector templates."
        features={LAYER_3}
      />

      <CapabilityLayer
        tag="Layer 04"
        title={
          <>
            Healthcare
            <br />+ enterprise
          </>
        }
        lede="Specialist offerings for regulated verticals. The ABDM bundle for Indian clinics, and the enterprise white-label platform for CA firms and large enterprise."
        features={LAYER_4}
      />

      <ArchPromo />

      <CtaBand
        eyebrow="Ready when you are"
        title="Deploy in 48 hours. First observation report in 5 minutes."
        body={
          <>
            Paste a script tag into your site{' '}
            <code
              style={{
                fontFamily: 'var(--mono)',
                background: 'var(--slate-soft)',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              &lt;head&gt;
            </code>
            . The banner renders. Monitoring begins. Your first real
            enforcement report arrives before the coffee is cold.
          </>
        }
      >
        <Link href={ROUTES.contact.href} className="btn btn-primary">
          Book a demo
        </Link>
        <Link href={ROUTES.pricing.href} className="btn btn-secondary">
          See pricing
        </Link>
      </CtaBand>
    </main>
  )
}
