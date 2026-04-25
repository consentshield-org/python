import type { Metadata } from 'next'
import Link from 'next/link'
import { DepaHero } from '@/components/sections/depa-hero'
import { DepaCompare } from '@/components/sections/depa-compare'
import { CtaBand } from '@/components/sections/cta-band'
import { DOWNLOAD_BRIEF, ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'DEPA · ConsentShield',
  description:
    'Built DEPA-native to MeitY BRD standards, with two sector-specific operational extensions: the BFSI Regulatory Exemption Engine and the ABDM unified artefact model for healthcare. Architecture and ADR record published in our public repo.',
}

export default function DepaPage() {
  return (
    <main id="page-depa">
      <DepaHero />
      <DepaCompare />
      <CtaBand
        eyebrow="For technical buyers"
        title="Walk the architecture with us."
        body="Download the full 30-page architecture brief — integration contracts, security rules, reference architectures, and the due-diligence question bank. Or book a 45-minute walkthrough with your engineering, security, and compliance team on the call together."
        meta={
          <>
            <span>
              <span className="mono" style={{ color: 'var(--ink-3)' }}>
                PDF
              </span>{' '}
              · 30 pages · 476 KB
            </span>
            <span style={{ color: 'var(--line)' }}>·</span>
            <a
              href={DOWNLOAD_BRIEF.docx}
              download
              style={{
                color: 'var(--teal)',
                borderBottom: '1px dashed var(--teal)',
              }}
            >
              Also available as Word (.docx)
            </a>
            <span style={{ color: 'var(--line)' }}>·</span>
            <a
              href={DOWNLOAD_BRIEF.md}
              download
              style={{
                color: 'var(--teal)',
                borderBottom: '1px dashed var(--teal)',
              }}
            >
              or Markdown (.md)
            </a>
          </>
        }
      >
        <a href={DOWNLOAD_BRIEF.pdf} download className="btn btn-primary">
          Download architecture brief
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M7 2v8m0 0L3.5 6.5M7 10l3.5-3.5M2 12h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <Link href={ROUTES.contact.href} className="btn btn-secondary">
          Book a technical walkthrough
        </Link>
      </CtaBand>
    </main>
  )
}
