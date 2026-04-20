import type { Metadata } from 'next'
import { LegalDocumentView } from '@/components/sections/legal-document'
import { PRIVACY } from '@/content/legal/privacy'

export const metadata: Metadata = {
  title: 'Privacy Policy · ConsentShield',
  description:
    "How ConsentShield handles personal data — of the businesses who buy from us, and of their Data Principals whose data flows through the platform.",
}

export default function PrivacyPage() {
  return (
    <main id="page-privacy">
      <LegalDocumentView doc={PRIVACY} />
    </main>
  )
}
