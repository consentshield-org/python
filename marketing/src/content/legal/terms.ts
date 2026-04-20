import type { LegalDocument } from './types'

// Canonical source for Terms of Service. Authored once; consumed by:
//   · src/app/terms/page.tsx       — web render via LegalDocumentView
//   · scripts/generate-downloads.ts — MD/PDF/DOCX under /downloads
// Inline formatting uses the MD subset in md-inline.ts: **bold**, *em*,
// [text](url). Anchors in `rows` values use the md-link form for contact
// rows that need bold.

export const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms of Service.',
  lede: 'The contract under which ConsentShield provides the ConsentShield platform. Read in tandem with the Data Processing Agreement and Privacy Policy.',
  meta: [
    { label: 'Effective', value: '15 April 2026' },
    { label: 'Last updated', value: '15 April 2026' },
    { label: 'Governing law', value: 'India' },
    { label: 'Version', value: 'v1.0' },
  ],
  tocItems: [
    { id: 'terms-1', label: 'Acceptance & parties' },
    { id: 'terms-2', label: 'The service' },
    { id: 'terms-3', label: 'Subscription & billing' },
    { id: 'terms-4', label: 'Customer data' },
    { id: 'terms-5', label: 'Acceptable use' },
    { id: 'terms-6', label: 'Intellectual property' },
    { id: 'terms-7', label: 'Warranties & disclaimers' },
    { id: 'terms-8', label: 'Limitation of liability' },
    { id: 'terms-9', label: 'Indemnification' },
    { id: 'terms-10', label: 'Termination' },
    { id: 'terms-11', label: 'Governing law' },
    { id: 'terms-12', label: 'Changes & contact' },
  ],
  sections: [
    {
      id: 'terms-1',
      title: 'Acceptance & parties',
      blocks: [
        {
          kind: 'p',
          md: 'These Terms of Service form a binding contract between **ConsentShield**, based in Hyderabad, Telangana, India ("**ConsentShield**", "we", "our"), and the entity or individual identified on the order form or in the online signup flow ("**Customer**", "you"). By creating an account, accepting an order form, or using the platform, you agree to these Terms.',
        },
        {
          kind: 'p',
          md: 'If you are signing on behalf of an organisation, you represent that you have authority to bind it. The platform is not intended for use by individuals acting in a personal, non-commercial capacity.',
        },
      ],
    },
    {
      id: 'terms-2',
      title: 'The service',
      blocks: [
        {
          kind: 'p',
          md: 'ConsentShield provides a B2B SaaS compliance platform ("**the Service**") comprising DEPA-native consent management, tracker enforcement monitoring, rights workflow management, artefact-scoped deletion orchestration, audit export, and related capabilities described at [consentshield.in/product](/product).',
        },
        { kind: 'h3', text: 'Operating model' },
        {
          kind: 'p',
          md: 'ConsentShield operates as a stateless compliance oracle. The Customer\u2019s canonical compliance record — the artefact register, consent logs, rights request history, and audit trail — is written to Customer-controlled storage. ConsentShield does not hold the canonical record.',
        },
        { kind: 'h3', text: 'Availability' },
        {
          kind: 'p',
          md: 'Target platform availability is 99.9% measured monthly, excluding scheduled maintenance windows communicated 72 hours in advance. SLA credits apply as set out in the Enterprise order form where applicable.',
        },
      ],
    },
    {
      id: 'terms-3',
      title: 'Subscription & billing',
      blocks: [
        {
          kind: 'p',
          md: 'Subscriptions are offered in monthly and annual terms. Pricing is as set out in the applicable order form or on the [pricing page](/pricing). Fees are exclusive of GST and other applicable taxes.',
        },
        {
          kind: 'ul',
          items: [
            '**Monthly plans** renew automatically on the subscription anniversary date. Cancel any time; cancellation takes effect at the end of the current billing period.',
            '**Annual plans** renew automatically and receive a 20% discount over monthly billing. Cancellation takes effect at the end of the annual term; no mid-term refunds.',
            '**Enterprise** and **BFSI specialist** pricing is set per order form. Payment terms default to 30 days from invoice.',
          ],
        },
        {
          kind: 'note',
          md: '**Late payment.** Overdue amounts accrue interest at 1.5% per month (or the maximum permitted by law, whichever is lower). Service may be suspended — not terminated — after 15 days of non-payment; Customer Data export remains available during suspension.',
        },
      ],
    },
    {
      id: 'terms-4',
      title: 'Customer data',
      blocks: [
        {
          kind: 'p',
          md: 'Customer Data means any data — including personal data of Data Principals — that Customer or Customer\u2019s end users provide to, or that is processed through, the Service.',
        },
        { kind: 'h3', text: 'Roles under the DPDP Act 2023' },
        {
          kind: 'p',
          md: 'In respect of personal data of Data Principals processed through the Service, the Customer is the **Data Fiduciary** and ConsentShield is the **Data Processor**. The Data Processing Agreement (DPA) — incorporated by reference — governs the Processor relationship.',
        },
        { kind: 'h3', text: 'Ownership' },
        {
          kind: 'p',
          md: 'Customer retains all right, title, and interest in Customer Data. ConsentShield obtains only the limited rights needed to provide the Service in accordance with the DPA and these Terms.',
        },
      ],
    },
    {
      id: 'terms-5',
      title: 'Acceptable use',
      blocks: [
        { kind: 'p', md: 'Customer will not, and will not permit any third party to:' },
        {
          kind: 'ul',
          items: [
            'Use the Service to process personal data without a lawful basis under the DPDP Act or other applicable law;',
            'Attempt to reverse-engineer, decompile, or extract the source code of the Service, except as expressly permitted by law;',
            'Use the Service to transmit malware, phishing content, or material that infringes third-party intellectual property;',
            'Submit load testing, penetration testing, or synthetic traffic in excess of documented plan limits without written consent;',
            'Use the Service to collect or process children\u2019s data without appropriate verifiable parental consent mechanisms;',
            'Attempt to circumvent the consent banner enforcement mechanisms of the Service on the Customer\u2019s own properties.',
          ],
        },
      ],
    },
    {
      id: 'terms-6',
      title: 'Intellectual property',
      blocks: [
        {
          kind: 'p',
          md: 'The Service — including the platform, the DEPA-native consent artefact schema, the tracker signature database, and all underlying software — is owned by ConsentShield and protected by applicable intellectual property law. These Terms grant Customer a non-exclusive, non-transferable, revocable right to use the Service for Customer\u2019s internal business purposes during the subscription term.',
        },
        {
          kind: 'p',
          md: 'Customer grants ConsentShield a limited right to use Customer\u2019s name and logo in a customer list on consentshield.in, subject to opt-out by written notice.',
        },
      ],
    },
    {
      id: 'terms-7',
      title: 'Warranties & disclaimers',
      blocks: [
        {
          kind: 'p',
          md: 'The Service is provided on an "as is" and "as available" basis. To the maximum extent permitted by applicable law, ConsentShield makes no warranties of any kind — whether express, implied, statutory, or otherwise — including any implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy, uninterrupted or error-free operation, or that the Service will meet Customer\u2019s specific requirements.',
        },
        {
          kind: 'p',
          md: 'Any availability targets, response-time targets, or similar commitments set out in an Enterprise order form operate as service-credit mechanisms only; service credits are Customer\u2019s sole and exclusive remedy for any failure to meet such targets, and are not warranties.',
        },
        {
          kind: 'p',
          md: '**ConsentShield is software; it is not legal advice.** All templates — privacy notices, DPAs, sub-processor lists — carry prominent disclaimers and should be reviewed by Customer\u2019s legal counsel before deployment.',
        },
        {
          kind: 'note',
          md: '**Compliance outcomes are the Customer\u2019s responsibility.** ConsentShield provides the infrastructure that makes DPDP compliance achievable and demonstrable. Customer remains the Data Fiduciary and bears ultimate responsibility for its compliance posture. The DPO-as-a-Service partner, where engaged through the ConsentShield marketplace, carries professional-advisory liability; ConsentShield carries software liability only, subject to Section 8.',
        },
      ],
    },
    {
      id: 'terms-8',
      title: 'Limitation of liability',
      blocks: [
        {
          kind: 'p',
          md: 'To the maximum extent permitted by applicable law, ConsentShield\u2019s aggregate liability to Customer arising out of or related to these Terms and the Service — whether in contract, tort, statute, or any other theory, and **including any indemnification obligations under Section 9** — will not exceed the total fees paid by Customer to ConsentShield in the twelve months preceding the event giving rise to the claim.',
        },
        {
          kind: 'p',
          md: 'Neither party will be liable for indirect, incidental, special, consequential, exemplary, or punitive damages — including lost profits, lost revenue, loss of data, loss of goodwill, or business interruption — even if advised of the possibility of such damages.',
        },
        {
          kind: 'p',
          md: 'These limitations do not apply (i) where limitation is prohibited by applicable law — including in respect of fraud or gross negligence — or (ii) to Customer\u2019s obligation to pay fees owed for the Service.',
        },
        {
          kind: 'note',
          md: '**Worked example.** A Customer on the ₹2,999/month plan for three months has paid ₹8,997 in total fees. If a claim arose at that point, ConsentShield\u2019s total liability — across all theories and including any IP-indemnity obligation — would be capped at ₹8,997. The cap scales with the commercial relationship and cannot create exposure disproportionate to fees received.',
        },
      ],
    },
    {
      id: 'terms-9',
      title: 'Indemnification',
      blocks: [
        {
          kind: 'p',
          md: '**By ConsentShield.** Subject to the liability cap in Section 8, ConsentShield will defend Customer against any third-party claim alleging that the Service, as provided and used in accordance with the documentation, infringes third-party intellectual property rights, and will pay damages finally awarded against Customer in respect of such claim. ConsentShield\u2019s obligation under this paragraph — together with all other liability to Customer — is capped at the amount stated in Section 8.',
        },
        {
          kind: 'p',
          md: '**By Customer.** Customer will defend ConsentShield against any third-party claim arising from (i) Customer Data, (ii) Customer\u2019s use of the Service in breach of these Terms, or (iii) Customer\u2019s failure to obtain lawful consent for the personal data processed through the Service.',
        },
      ],
    },
    {
      id: 'terms-10',
      title: 'Termination',
      blocks: [
        {
          kind: 'p',
          md: 'Either party may terminate for material breach unremedied 30 days after written notice. Customer may terminate monthly subscriptions at the end of any billing period; annual subscriptions at the end of the annual term.',
        },
        {
          kind: 'p',
          md: '**Effect of termination.** ConsentShield will retain Customer Data for 30 days post-termination to allow export. After 30 days, ConsentShield will delete its copies of Customer Data in accordance with the DPA. The canonical record residing in Customer-controlled storage is not affected by termination.',
        },
      ],
    },
    {
      id: 'terms-11',
      title: 'Governing law',
      blocks: [
        {
          kind: 'p',
          md: 'These Terms are governed by the laws of India. Any dispute will be submitted to the exclusive jurisdiction of the courts of Hyderabad, Telangana, except either party may seek interim relief in any competent court. For disputes exceeding INR 50,00,000, the parties will first attempt good-faith resolution through the Arbitration and Conciliation Act 1996 (Indian seat; Hyderabad venue) before commencing litigation.',
        },
      ],
    },
    {
      id: 'terms-12',
      title: 'Changes & contact',
      blocks: [
        {
          kind: 'p',
          md: 'ConsentShield may update these Terms with 30 days\u2019 advance notice by email to the Customer\u2019s primary admin and by banner notice in the platform. Material changes to pricing, liability, or data handling require express Customer acceptance.',
        },
        {
          kind: 'contact',
          heading: 'Contact',
          rows: [
            { label: 'Legal notices', value: '**legal@consentshield.in**' },
            { label: 'General', value: '**hello@consentshield.in**' },
          ],
        },
      ],
    },
  ],
}
