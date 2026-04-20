import type { Metadata } from 'next'
import { LegalDocumentView } from '@/components/sections/legal-document'
import { TERMS } from '@/content/legal/terms'

export const metadata: Metadata = {
  title: 'Terms of Service · ConsentShield',
  description:
    'ConsentShield Terms of Service. Read in tandem with the Data Processing Agreement and Privacy Policy.',
}

export default function TermsPage() {
  return (
    <main id="page-terms">
      <LegalDocumentView doc={TERMS} />
    </main>
  )
}
