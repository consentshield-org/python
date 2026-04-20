import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalDocumentView } from '@/components/sections/legal-document'
import { CtaBand } from '@/components/sections/cta-band'
import { DpaSigningCard } from '@/components/sections/dpa-signing-card'
import { DPA } from '@/content/legal/dpa'
import { DOWNLOAD_BRIEF, ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'DPA & EU Addendum · ConsentShield',
  description:
    'ConsentShield Data Processing Agreement and EU Addendum. Digital execution supported; executed on subscription.',
}

export default function DpaPage() {
  return (
    <main id="page-dpa">
      <LegalDocumentView doc={DPA} />

      <DpaSigningCard />

      <div style={{ marginTop: 80 }}>
        <CtaBand
          eyebrow="Questions before signing?"
          title="Happy to walk the DPA with your legal team."
          body="Whether it's sub-processor scope, SCC elections, audit-rights mechanics, or the Regulatory Exemption Engine's effect on retention — we'll take the call. For architecture-level questions, the standalone Architecture Brief answers most before the call starts."
        >
          <Link href={ROUTES.contact.href} className="btn btn-primary">
            Book a legal walkthrough
          </Link>
          <a
            href={DOWNLOAD_BRIEF.pdf}
            download
            className="btn btn-secondary"
          >
            Architecture Brief (PDF)
          </a>
          <Link href={ROUTES.terms.href} className="btn btn-ghost">
            Read the main Terms
          </Link>
        </CtaBand>
      </div>
    </main>
  )
}
