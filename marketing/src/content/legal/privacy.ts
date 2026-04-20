import type { LegalDocument } from './types'

export const PRIVACY: LegalDocument = {
  slug: 'privacy',
  title: 'Privacy Policy.',
  lede: 'How ConsentShield handles personal data — of the businesses who buy from us, and of their Data Principals whose data flows through the platform. Written to the standard we ask our customers to meet.',
  meta: [
    { label: 'Effective', value: '15 April 2026' },
    { label: 'Last updated', value: '15 April 2026' },
    { label: 'Applicable law', value: 'DPDP Act 2023, GDPR' },
    { label: 'Version', value: 'v1.0' },
  ],
  tocItems: [
    { id: 'pp-1', label: 'Who this applies to' },
    { id: 'pp-2', label: 'Data we collect' },
    { id: 'pp-3', label: 'How we use data' },
    { id: 'pp-4', label: 'Legal basis' },
    { id: 'pp-5', label: 'Sharing & sub-processors' },
    { id: 'pp-6', label: 'Retention' },
    { id: 'pp-7', label: 'Your rights' },
    { id: 'pp-8', label: 'Security' },
    { id: 'pp-9', label: 'International transfers' },
    { id: 'pp-10', label: "Children's data" },
    { id: 'pp-11', label: 'Changes' },
    { id: 'pp-12', label: 'Grievance officer' },
  ],
  sections: [
    {
      id: 'pp-1',
      title: 'Who this applies to',
      blocks: [
        { kind: 'p', md: 'This policy covers two distinct categories of personal data:' },
        {
          kind: 'ul',
          items: [
            '**Customer Users** — individuals at our business customers who sign up for, configure, and operate the ConsentShield platform. We act as the **Data Fiduciary** for this data.',
            '**Data Principals** — individuals whose personal data flows through the Service as part of our customers\u2019 compliance operations. For this data, our customer is the Data Fiduciary; ConsentShield is the **Data Processor**. Our obligations to Data Principals are discharged through the Data Processing Agreement with our customer, and through the stateless oracle architecture described below.',
          ],
        },
        {
          kind: 'note',
          md: '**If you are a Data Principal** of one of our customers seeking to exercise rights (erasure, access, correction, nomination), the controller of your data is our customer — not ConsentShield. Contact them directly. If they cannot be reached, our grievance officer (Section 12) will route your request.',
        },
      ],
    },
    {
      id: 'pp-2',
      title: 'Data we collect',
      blocks: [
        { kind: 'h3', text: 'About Customer Users' },
        {
          kind: 'ul',
          items: [
            '**Account data** — name, work email, organisation, role, hashed password credentials.',
            '**Usage data** — how you navigate the platform, features used, timestamps. Collected via first-party analytics; no third-party tracking.',
            '**Billing data** — for paid plans, handled by Razorpay. We do not store card numbers.',
            '**Communications** — support tickets, sales conversations, DPA and order-form records.',
          ],
        },
        { kind: 'h3', text: 'About Data Principals (flowing through the Service)' },
        {
          kind: 'ul',
          items: [
            '**Consent artefacts** — one per purpose, with data scope, expiry, and revocation chain.',
            '**Consent events and tracker observations** — generated as Data Principals interact with customer websites.',
            '**Rights request metadata** — where customers use the Service to manage erasure, access, or correction requests.',
          ],
        },
        {
          kind: 'note',
          md: '**Stateless oracle.** Data Principal data is buffered for delivery to Customer-controlled storage and then deleted from ConsentShield systems. Buffer retention is measured in minutes, not months. See Section 6.',
        },
      ],
    },
    {
      id: 'pp-3',
      title: 'How we use data',
      blocks: [
        { kind: 'p', md: 'We use personal data only for the purposes it was collected for:' },
        {
          kind: 'ul',
          items: [
            '**Provide and operate the Service** — authentication, product functionality, billing, support.',
            '**Improve the Service** — aggregate, de-identified usage patterns inform product decisions. No individual-level profiling.',
            '**Security and abuse prevention** — detect credential stuffing, anomalous API usage, data scraping.',
            '**Communicate with Customer Users** — service announcements, security notices, billing, opt-in product updates.',
            '**Comply with law** — respond to lawful legal process and regulatory obligations.',
          ],
        },
        {
          kind: 'p',
          md: 'We do not sell personal data. We do not use personal data to train third-party AI models. We do not use Data Principal data for any purpose other than processing on behalf of our customer.',
        },
      ],
    },
    {
      id: 'pp-4',
      title: 'Legal basis',
      blocks: [
        {
          kind: 'p',
          md: 'Under the DPDP Act 2023, we process personal data of Customer Users on the basis of **consent** (account creation) and **legitimate uses** — specifically, performance of the contract, compliance with legal obligations, and security — as permitted by Section 7.',
        },
        {
          kind: 'p',
          md: 'For Customer Users located in the European Economic Area, the United Kingdom, or Switzerland, we process personal data under the GDPR on the bases of **contract** (Article 6(1)(b)), **legitimate interest** (6(1)(f) — security, service improvement), **legal obligation** (6(1)(c)), and **consent** (6(1)(a)) for optional marketing.',
        },
      ],
    },
    {
      id: 'pp-5',
      title: 'Sharing & sub-processors',
      blocks: [
        {
          kind: 'p',
          md: 'We share personal data only with vetted sub-processors that are bound by data protection agreements at least as protective as our commitments to you:',
        },
        {
          kind: 'ul',
          items: [
            '**Supabase Inc.** — authentication, Postgres database (operational state).',
            '**Cloudflare Inc.** — banner CDN, edge workers, R2 default storage.',
            '**Razorpay Software Pvt Ltd** — subscription billing (INR).',
            '**Resend Inc.** — transactional email.',
            '**Sentry Inc.** — error monitoring (de-identified).',
            '**Amazon Web Services Inc.** — Bring-Your-Own-Storage option for S3.',
          ],
        },
        {
          kind: 'p',
          md: 'The sub-processor list above is the current, authoritative list. We notify Customers at least 30 days before adding a new sub-processor; customers with an active Enterprise agreement can object and, if the objection cannot be resolved, terminate the affected subscription without penalty.',
        },
        {
          kind: 'p',
          md: 'We do not share personal data with advertising networks, data brokers, or any third party for marketing purposes.',
        },
      ],
    },
    {
      id: 'pp-6',
      title: 'Retention',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Customer User data** — retained for the life of the account plus 12 months, unless law requires longer retention (e.g., tax records).',
            '**Data Principal buffer data** — retained only as long as needed to confirm successful delivery to Customer-controlled storage. Typically minutes; never longer than 7 days.',
            '**Consent artefact index** — a minimal index (artefact ID, expiry, revocation status) is retained for enforcement and probe testing, subject to a configurable TTL.',
            '**Audit logs** — retained for 12 months in ConsentShield; the canonical record lives in Customer-controlled storage under the Customer\u2019s retention policy.',
            '**Health data (ABDM)** — zero persistence. FHIR records flow through memory only; never written to disk.',
          ],
        },
      ],
    },
    {
      id: 'pp-7',
      title: 'Your rights',
      blocks: [
        {
          kind: 'p',
          md: 'Under the DPDP Act 2023 and GDPR (where applicable), you have the right to:',
        },
        {
          kind: 'ul',
          items: [
            '**Access** the personal data we hold about you and obtain a copy;',
            '**Correction** of inaccurate or incomplete data;',
            '**Erasure** of data that is no longer necessary or processed unlawfully;',
            '**Withdraw consent** at any time, with effect going forward;',
            '**Nominate** an individual to exercise rights on your behalf in the event of incapacity or death;',
            '**Grievance redress** — contact our grievance officer (Section 12) and escalate to the Data Protection Board where applicable.',
          ],
        },
        {
          kind: 'p',
          md: 'To exercise any of these rights, email **privacy@consentshield.in**. We respond within 30 days (DPDP) or one month (GDPR) of verified request.',
        },
      ],
    },
    {
      id: 'pp-8',
      title: 'Security',
      blocks: [
        {
          kind: 'ul',
          items: [
            '**Encryption** — TLS 1.3 in transit; AES-256 at rest for buffer tables and customer storage (customer-held keys in Insulated and Zero-Storage modes).',
            '**Access control** — multi-tenant isolation enforced at the database layer, not solely in application code. Isolation is verified by policy, not relying on code review alone.',
            '**Authentication** — SSO, MFA, and magic-link login. Internal service credentials are scoped and rotated on a defined schedule.',
            '**Vulnerability management** — quarterly external pentest; continuous dependency scanning; vulnerability disclosure programme.',
            '**Incident response** — 72-hour DPDP notification and 6-hour RBI notification timelines where applicable.',
          ],
        },
      ],
    },
    {
      id: 'pp-9',
      title: 'International transfers',
      blocks: [
        {
          kind: 'p',
          md: 'ConsentShield\u2019s primary infrastructure runs in India. Some sub-processors (Cloudflare edge, Supabase regional replicas) may process data in jurisdictions outside India subject to appropriate safeguards. For transfers out of the European Economic Area, we rely on Standard Contractual Clauses. For DPDP purposes, we do not transfer personal data to jurisdictions notified by the Central Government as restricted.',
        },
      ],
    },
    {
      id: 'pp-10',
      title: 'Children\u2019s data',
      blocks: [
        {
          kind: 'p',
          md: 'The ConsentShield platform is not intended for users under 18 (DPDP definition of "child"). We do not knowingly collect personal data from children directly. Where our customer operates an edtech or children-facing product, we process children\u2019s data only as a Data Processor on behalf of that customer, and only under the DPDP\u2019s specific child data provisions — including absence of behavioural advertising and verifiable parental consent where applicable.',
        },
      ],
    },
    {
      id: 'pp-11',
      title: 'Changes',
      blocks: [
        {
          kind: 'p',
          md: 'We may update this Privacy Policy periodically. Material changes will be communicated by email to Customer Users and by banner notice on consentshield.in at least 30 days before they take effect. The current version and effective date are shown at the top of this page.',
        },
      ],
    },
    {
      id: 'pp-12',
      title: 'Grievance officer',
      blocks: [
        {
          kind: 'p',
          md: 'Under DPDP Rule 5, we have designated a Data Protection Officer / Grievance Officer:',
        },
        {
          kind: 'contact',
          heading: 'Grievance contact',
          rows: [
            { label: 'Officer', value: '**To be appointed** prior to platform launch' },
            { label: 'Email', value: '**privacy@consentshield.in**' },
            {
              label: 'Response SLA',
              value: 'Acknowledgement within 48 hours; resolution within 30 days',
            },
            {
              label: 'Escalation',
              value: 'The Data Protection Board of India — [www.meity.gov.in](https://www.meity.gov.in)',
            },
          ],
        },
        {
          kind: 'p',
          md: 'For EEA / UK Data Principals, our EU Representative contact will be listed here following appointment under Article 27 GDPR.',
        },
      ],
    },
  ],
}
