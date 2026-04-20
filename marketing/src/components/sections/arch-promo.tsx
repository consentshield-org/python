import Link from 'next/link'
import { DOWNLOAD_BRIEF, ROUTES } from '@/lib/routes'

// Architecture Brief promo card. Appears on the Product page (inline),
// and links into the PDF + DOCX downloads. The MD link lives alongside
// as a quieter tertiary option since the HTML spec promotes PDF + DOCX.
export function ArchPromo() {
  return (
    <section className="arch-promo">
      <div className="arch-promo-inner">
        <div className="arch-promo-card">
          <div className="arch-promo-copy">
            <span className="eyebrow">For technical evaluators</span>
            <h3>
              Every question your CTO, CISO, or DPO will ask — answered in one
              document.
            </h3>
            <p>
              The Architecture Brief is a standalone, 30-page technical
              reference. Integration contracts, reference architectures, twelve
              security rules, sub-processor register, incident-response
              timelines, and a due-diligence question bank with 13
              cross-referenced answers.
            </p>
            <div className="arch-promo-bullets">
              <span className="arch-promo-bullet">30 pages · standalone</span>
              <span className="arch-promo-bullet">
                12 tables · 48 headings
              </span>
              <span className="arch-promo-bullet">
                PDF + Word + Markdown
              </span>
            </div>
            <div className="arch-promo-ctas">
              <a
                className="arch-promo-primary"
                href={DOWNLOAD_BRIEF.pdf}
                download
              >
                Download (PDF)
                <svg viewBox="0 0 14 14" fill="none">
                  <path
                    d="M7 2v8m0 0L3.5 6.5M7 10l3.5-3.5M2 12h10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <Link
                href={ROUTES.contact.href}
                className="arch-promo-secondary"
              >
                Book a walkthrough instead
              </Link>
            </div>
            <div className="arch-promo-alt">
              No form, no gating. Also available as{' '}
              <a href={DOWNLOAD_BRIEF.docx} download>
                Word (.docx)
              </a>{' '}
              or{' '}
              <a href={DOWNLOAD_BRIEF.md} download>
                Markdown (.md)
              </a>
              .
            </div>
          </div>
          <div className="arch-promo-doc">
            <div className="arch-promo-doc-mock">
              <div className="arch-promo-doc-head">
                <div className="arch-promo-doc-logo">
                  <svg
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M12 3 L19.5 6 V13 C19.5 17.5 16 21 12 22 C8 21 4.5 17.5 4.5 13 V6 Z"
                      fill="#0D7A6B"
                    />
                    <path
                      d="M8.5 12.2 L11 14.7 L15.8 9.7"
                      stroke="white"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  </svg>
                </div>
                <div className="arch-promo-doc-brand">
                  Consent<em>Shield</em>
                </div>
              </div>
              <div className="arch-promo-doc-label">
                Architecture Brief · v1.0
              </div>
              <div className="arch-promo-doc-title">
                Technical, security, and compliance architecture.
              </div>
              <div className="arch-promo-doc-lines">
                <div className="arch-promo-doc-line med"></div>
                <div className="arch-promo-doc-line"></div>
                <div className="arch-promo-doc-line short"></div>
                <div className="arch-promo-doc-line med"></div>
                <div className="arch-promo-doc-line"></div>
              </div>
              <div className="arch-promo-doc-foot">
                <span>APR 2026</span>
                <span>30 PAGES</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
