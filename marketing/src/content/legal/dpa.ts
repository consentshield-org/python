import type { LegalDocument } from './types'

export const DPA: LegalDocument = {
  slug: 'dpa',
  title: 'Data Processing Agreement.',
  lede: 'Under DPDP Act Section 8(2), every Data Fiduciary must have a written contract with each Data Processor handling personal data on its behalf. This DPA — together with the EU Addendum that follows, where applicable — is that contract. Executed digitally on subscription; no download, no wet-ink signature required.',
  meta: [
    { label: 'Effective', value: '15 April 2026' },
    { label: 'Versions', value: 'DPA v1.0 · EU Addendum v1.0' },
    { label: 'Execution', value: 'Digital signature' },
    { label: 'Governing law', value: 'India (DPA) · Ireland (SCCs)' },
  ],
  tocItems: [
    { id: 'dpa-1', label: 'Definitions' },
    { id: 'dpa-2', label: 'Scope, roles, duration' },
    { id: 'dpa-3', label: 'Customer obligations' },
    { id: 'dpa-4', label: 'ConsentShield obligations' },
    { id: 'dpa-5', label: 'Sub-processors' },
    { id: 'dpa-6', label: 'Data Principal rights' },
    { id: 'dpa-7', label: 'Security Incidents' },
    { id: 'dpa-8', label: 'International transfers' },
    { id: 'dpa-9', label: 'Audit rights' },
    { id: 'dpa-10', label: 'Liability' },
    { id: 'dpa-11', label: 'Return & deletion' },
    { id: 'dpa-12', label: 'Conflict & law' },
    { id: 'dpa-a1', label: 'Annex 1 — Processing' },
    { id: 'dpa-a2', label: 'Annex 2 — Security' },
    { id: 'dpa-a3', label: 'Annex 3 — Sub-processors' },
    { id: 'dpa-eu', label: 'EU Addendum' },
  ],
  intro: [
    'This Data Processing Agreement ("**DPA**") is entered into between **ConsentShield** ("ConsentShield", "Processor") and the customer identified on the applicable Order Form or signup record ("Customer", "Fiduciary"). This DPA forms part of, and is subject to, the ConsentShield Terms of Service. In case of conflict concerning the Processing of Personal Data, this DPA prevails over the Terms.',
    '*Background.* ConsentShield provides a B2B SaaS compliance platform (the "Service") for the Digital Personal Data Protection Act 2023 of India (the "DPDP Act") and, where applicable, the EU General Data Protection Regulation (the "GDPR"). In the course of providing the Service, ConsentShield processes Personal Data on behalf of the Customer. This DPA sets out the terms of that Processing, consistent with Section 8(2) of the DPDP Act.',
  ],
  sections: [
    {
      id: 'dpa-1',
      title: 'Definitions',
      blocks: [
        {
          kind: 'p',
          md: 'Capitalised terms not defined in this DPA take their meaning from the Terms. The following additional definitions apply.',
        },
        {
          kind: 'p',
          md: '**"Applicable Data Protection Law"** means the DPDP Act; the DPDP Rules 2025 notified thereunder; and, where the Customer Processes Personal Data of Data Principals in the European Economic Area, the United Kingdom, or Switzerland, the GDPR and its national implementations.',
        },
        {
          kind: 'p',
          md: '**"Data Principal"** or **"Data Subject"** means an identified or identifiable natural person to whom the Personal Data relates.',
        },
        {
          kind: 'p',
          md: '**"Data Fiduciary"** or **"Data Controller"** means the party that determines the purpose and means of the Processing of Personal Data.',
        },
        {
          kind: 'p',
          md: '**"Data Processor"** or **"Processor"** means the party that Processes Personal Data on behalf of the Data Fiduciary.',
        },
        {
          kind: 'p',
          md: '**"Personal Data"** has the meaning given in Section 2(t) of the DPDP Act and, where applicable, Article 4(1) of the GDPR.',
        },
        {
          kind: 'p',
          md: '**"Processing"** or **"Process"** means any operation or set of operations performed on Personal Data, whether or not by automated means.',
        },
        {
          kind: 'p',
          md: '**"Security Incident"** means a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, Personal Data Processed under this DPA.',
        },
        {
          kind: 'p',
          md: '**"Sub-processor"** means a third party engaged by ConsentShield to Process Personal Data on behalf of the Customer.',
        },
      ],
    },
    {
      id: 'dpa-2',
      title: 'Scope, roles, and duration',
      blocks: [
        { kind: 'h3', text: '2.1 Roles' },
        {
          kind: 'p',
          md: 'In respect of Personal Data Processed through the Service, the Customer is the Data Fiduciary and ConsentShield is the Data Processor. Sub-processors are processors sub-contracted by ConsentShield. Data Principals are the individuals whose Personal Data flows through the Service.',
        },
        { kind: 'h3', text: '2.2 Subject matter and nature of Processing' },
        {
          kind: 'p',
          md: 'ConsentShield Processes Personal Data solely to provide the Service to the Customer — including, without limitation, generating, storing, and delivering DEPA-native consent artefacts; monitoring consent enforcement; supporting Data Principal rights requests; orchestrating artefact-scoped deletion; and producing audit exports.',
        },
        { kind: 'h3', text: '2.3 Duration' },
        {
          kind: 'p',
          md: 'This DPA applies for as long as ConsentShield Processes Personal Data for the Customer, and survives termination to the extent necessary to give effect to Sections 10 and 11.',
        },
        { kind: 'h3', text: '2.4 Details of Processing' },
        {
          kind: 'p',
          md: 'The categories of Data Principals, categories of Personal Data, purposes of Processing, and retention periods are set out in **Annex 1**.',
        },
      ],
    },
    {
      id: 'dpa-3',
      title: 'Customer obligations (as Data Fiduciary)',
      blocks: [
        { kind: 'h3', text: '3.1 Warranties' },
        {
          kind: 'p',
          md: 'The Customer warrants that it has lawful basis under Applicable Data Protection Law for all Processing instructed; has provided all required notices and obtained all required consents from Data Principals; its instructions to ConsentShield comply with Applicable Data Protection Law; and Customer Data does not infringe third-party rights.',
        },
        { kind: 'h3', text: '3.2 Primary responsibility for Data Principal rights' },
        {
          kind: 'p',
          md: 'The Customer is primarily responsible for responding to Data Principal rights requests. ConsentShield provides reasonable support as set out in Section 6.',
        },
        { kind: 'h3', text: '3.3 Configuration' },
        {
          kind: 'p',
          md: 'The Customer will use the Service\u2019s configuration tools — including the Purpose Definition Registry, retention rules, deletion connectors, and breach notification workflow — to configure Processing that matches its lawful basis and declared purposes.',
        },
      ],
    },
    {
      id: 'dpa-4',
      title: 'ConsentShield obligations (as Data Processor)',
      blocks: [
        { kind: 'h3', text: '4.1 Documented instructions' },
        {
          kind: 'p',
          md: 'ConsentShield Processes Personal Data only on documented instructions from the Customer. The Customer\u2019s configuration of, and use of, the Service consistent with the documentation, the Terms, and this DPA constitutes documented instructions. ConsentShield will inform the Customer if, in its view, an instruction infringes Applicable Data Protection Law.',
        },
        { kind: 'h3', text: '4.2 Confidentiality' },
        {
          kind: 'p',
          md: 'ConsentShield ensures that personnel authorised to Process Personal Data are bound by written confidentiality obligations no less protective than this DPA.',
        },
        { kind: 'h3', text: '4.3 Security' },
        {
          kind: 'p',
          md: 'ConsentShield implements and maintains the technical and organisational measures set out in **Annex 2**, proportionate to the risk represented by the Processing.',
        },
        { kind: 'h3', text: '4.4 Sub-processors' },
        { kind: 'p', md: 'ConsentShield engages Sub-processors as set out in Section 5.' },
        { kind: 'h3', text: '4.5 Support' },
        {
          kind: 'p',
          md: 'ConsentShield supports the Customer\u2019s Data Principal rights requests, regulatory notifications, and data protection impact assessments as set out in this DPA.',
        },
        { kind: 'h3', text: '4.6 Security Incident notification' },
        {
          kind: 'p',
          md: 'ConsentShield notifies the Customer of Security Incidents as set out in Section 7.',
        },
        { kind: 'h3', text: '4.7 Return and deletion' },
        { kind: 'p', md: 'On termination, ConsentShield acts in accordance with Section 11.' },
        { kind: 'h3', text: '4.8 Records' },
        {
          kind: 'p',
          md: 'ConsentShield maintains records of its Processing activities on behalf of the Customer and makes them available to the Customer on reasonable request.',
        },
      ],
    },
    {
      id: 'dpa-5',
      title: 'Sub-processors',
      blocks: [
        { kind: 'h3', text: '5.1 Authorisation' },
        {
          kind: 'p',
          md: 'The Customer authorises the use of the Sub-processors listed in **Annex 3**.',
        },
        { kind: 'h3', text: '5.2 Notice of new Sub-processors' },
        {
          kind: 'p',
          md: 'ConsentShield will notify the Customer at least 30 days before engaging a new Sub-processor, by email to the Customer\u2019s registered admin contact and by banner notice in the ConsentShield dashboard.',
        },
        { kind: 'h3', text: '5.3 Objection' },
        {
          kind: 'p',
          md: 'The Customer may object to a new Sub-processor on reasonable data protection grounds within 20 days of notice. If the parties cannot resolve the objection in good faith, the Customer may terminate the affected subscription without penalty and receive a pro-rated refund of any prepaid fees attributable to the period after termination.',
        },
        { kind: 'h3', text: '5.4 Flow-down' },
        {
          kind: 'p',
          md: 'ConsentShield binds each Sub-processor in writing to data protection obligations no less protective than this DPA.',
        },
        { kind: 'h3', text: '5.5 Liability' },
        {
          kind: 'p',
          md: 'ConsentShield remains fully liable to the Customer for each Sub-processor\u2019s compliance with this DPA, subject to the Limitation of Liability clause in the Terms.',
        },
      ],
    },
    {
      id: 'dpa-6',
      title: 'Data Principal rights',
      blocks: [
        { kind: 'h3', text: '6.1 Primary responsibility' },
        {
          kind: 'p',
          md: 'The Customer is responsible for responding to Data Principal rights requests. ConsentShield does not respond to Data Principal rights requests directly; requests received by ConsentShield are forwarded to the Customer promptly and not responded to substantively.',
        },
        { kind: 'h3', text: '6.2 Support provided' },
        {
          kind: 'p',
          md: 'ConsentShield supports the Customer\u2019s response by providing dashboard tooling to locate all active consent artefacts for a given Data Principal; orchestrating artefact-scoped deletion across connected integrations and returning signed deletion receipts; providing Data Principal data export in a machine-readable format; providing configurable Rights Request SLA workflows with 30-day response targets; and, where applicable, GDPR Article 15–22 rights workflows.',
        },
        { kind: 'h3', text: '6.3 Response timeframe' },
        {
          kind: 'p',
          md: 'ConsentShield-side actions triggered by valid Customer instructions are completed within the SLAs set out in the Service documentation, not exceeding 72 hours from receipt of a valid instruction.',
        },
      ],
    },
    {
      id: 'dpa-7',
      title: 'Security Incidents',
      blocks: [
        { kind: 'h3', text: '7.1 Notification to Customer' },
        {
          kind: 'p',
          md: 'ConsentShield will notify the Customer of a confirmed Security Incident affecting the Customer\u2019s Personal Data without undue delay, and in any event within 48 hours of confirmation.',
        },
        { kind: 'h3', text: '7.2 Content of notification' },
        {
          kind: 'p',
          md: 'The notification will include, to the extent known at the time and as information develops: the nature of the Security Incident; categories and approximate numbers of Data Principals and records affected; the likely consequences; the measures taken or proposed to address the Security Incident and mitigate its effects; and the name and contact details of the ConsentShield point of contact.',
        },
        { kind: 'h3', text: '7.3 Cooperation' },
        {
          kind: 'p',
          md: 'ConsentShield will cooperate in the Customer\u2019s investigation and regulatory reporting obligations — including the 72-hour notification obligation under Section 8(6) of the DPDP Act, and the corresponding obligations under Articles 33 and 34 GDPR.',
        },
        { kind: 'h3', text: '7.4 Direct notification' },
        {
          kind: 'p',
          md: 'ConsentShield will not notify regulators or Data Principals directly, except where required by law or where the Customer has failed to do so after reasonable notice and the failure is likely to cause material harm to Data Principals.',
        },
      ],
    },
    {
      id: 'dpa-8',
      title: 'International transfers',
      blocks: [
        { kind: 'h3', text: '8.1 Primary location' },
        { kind: 'p', md: 'ConsentShield\u2019s primary infrastructure is located in India.' },
        { kind: 'h3', text: '8.2 Sub-processor transfers' },
        {
          kind: 'p',
          md: 'Certain Sub-processors (notably edge CDN infrastructure and regional database replicas) may Process Personal Data outside India, subject to the safeguards set out in this DPA.',
        },
        { kind: 'h3', text: '8.3 DPDP restrictions' },
        {
          kind: 'p',
          md: 'ConsentShield will not Process Personal Data in any jurisdiction notified by the Central Government as restricted under Section 16 of the DPDP Act.',
        },
        { kind: 'h3', text: '8.4 GDPR cross-border transfers' },
        {
          kind: 'p',
          md: 'For transfers of Personal Data of EU Data Subjects outside the European Economic Area, the EU Data Protection Addendum (below) applies and incorporates the Standard Contractual Clauses adopted by Commission Implementing Decision (EU) 2021/914.',
        },
      ],
    },
    {
      id: 'dpa-9',
      title: 'Audit rights',
      blocks: [
        { kind: 'h3', text: '9.1 Information on request' },
        {
          kind: 'p',
          md: 'ConsentShield will make available to the Customer, on reasonable written request, the information necessary to demonstrate compliance with this DPA — including the current Annex 2 measures, penetration test summaries (non-confidential), and third-party audit reports where available.',
        },
        { kind: 'h3', text: '9.2 Audits' },
        {
          kind: 'p',
          md: 'The Customer may conduct audits to verify ConsentShield\u2019s compliance through a mutually agreed independent third-party auditor bound by confidentiality obligations, on not less than 30 days\u2019 written notice, no more than once per 12-month period, and at the Customer\u2019s cost. In the event of a Security Incident affecting the Customer, the 30-day notice period does not apply.',
        },
        { kind: 'h3', text: '9.3 Audit in lieu' },
        {
          kind: 'p',
          md: 'ConsentShield may satisfy audit requests by providing current third-party audit reports (e.g. SOC 2 Type II, ISO 27001) and certifications, where these cover the Processing relevant to the Customer\u2019s request.',
        },
      ],
    },
    {
      id: 'dpa-10',
      title: 'Liability',
      blocks: [
        {
          kind: 'p',
          md: 'The parties\u2019 liability under this DPA is governed by, and subject to, Section 8 (Limitation of liability) of the Terms — including the cap equal to fees paid in the preceding 12 months, the exclusion of indirect and consequential damages, and the inclusion of indemnification obligations within the cap.',
        },
        {
          kind: 'p',
          md: 'Nothing in this DPA limits or excludes liability to the extent limitation is prohibited by Applicable Data Protection Law.',
        },
      ],
    },
    {
      id: 'dpa-11',
      title: 'Return and deletion',
      blocks: [
        {
          kind: 'p',
          md: 'On termination or expiry of the Service, and at the Customer\u2019s written request, ConsentShield will return Personal Data in a machine-readable format or delete all Personal Data Processed under this DPA within 30 days, except to the extent Applicable Data Protection Law requires continued retention.',
        },
        {
          kind: 'p',
          md: 'The Customer\u2019s canonical compliance record residing in Customer-controlled storage is unaffected by termination and is the Customer\u2019s to retain.',
        },
        {
          kind: 'p',
          md: 'Any retention required by law is limited to what is necessary, subject to ongoing confidentiality and security obligations, and is deleted as soon as the legal obligation expires.',
        },
      ],
    },
    {
      id: 'dpa-12',
      title: 'Conflict, law, and execution',
      blocks: [
        {
          kind: 'p',
          md: '**Conflict.** In case of conflict between this DPA and the Terms in respect of the Processing of Personal Data, this DPA prevails. In case of conflict between this DPA and the EU Addendum below, the EU Addendum prevails in respect of EU Personal Data only.',
        },
        {
          kind: 'p',
          md: '**Governing law.** This DPA is governed by the laws of India. The courts of Hyderabad, Telangana have exclusive jurisdiction, subject to either party\u2019s right to seek interim relief in any competent court.',
        },
        {
          kind: 'p',
          md: '**Execution.** This DPA is executed by the Customer\u2019s digital acceptance on subscription to the Service (or on first use of a feature that triggers EU-data Processing, for the EU Addendum). The digital acceptance record — signatory identity, timestamp, IP address, and the version number of this DPA — constitutes execution for all purposes.',
        },
      ],
    },
    {
      id: 'dpa-a1',
      title: 'Annex 1 — Description of Processing',
      blocks: [
        { kind: 'h3', text: 'Subject matter and duration' },
        {
          kind: 'p',
          md: 'Provision of the ConsentShield compliance platform to the Customer under the Terms, for the term of the Customer\u2019s subscription plus any reasonable period required to effect return or deletion under Section 11.',
        },
        { kind: 'h3', text: 'Nature and purpose' },
        {
          kind: 'p',
          md: 'Collection, structuring, storage (buffered), and delivery of consent artefacts; enforcement monitoring of third-party scripts on Customer web properties; orchestration of Data Principal rights fulfilment, including artefact-scoped deletion; breach notification workflow; audit export.',
        },
        { kind: 'h3', text: 'Categories of Data Principals' },
        {
          kind: 'ul',
          items: [
            'End users of the Customer\u2019s websites and applications',
            'Employees, contractors, and representatives of the Customer, where the Customer Processes their Personal Data through the Service',
            'Patients, where the Customer uses the ABDM Healthcare Bundle',
            'Account holders, nominees, guarantors, and co-borrowers, where the Customer is a regulated financial institution using the BFSI template',
          ],
        },
        { kind: 'h3', text: 'Categories of Personal Data' },
        {
          kind: 'ul',
          items: [
            '**Consent-related data:** consent artefact identifiers, purpose acceptances, timestamps, hashed IP addresses, hashed user-agent strings, revocation timestamps',
            '**Contact data:** email, phone number, full name (where the Customer elects to collect)',
            '**Technical data:** session identifiers, anonymised device fingerprints',
            '**Rights request data:** Data Principal name, contact details, nature of the request, correspondence history, identity verification metadata',
            '**(ABDM Healthcare Bundle only)** health identifiers such as ABHA ID and FHIR metadata — flowing through memory only, not persisted',
            '**(BFSI only)** consent metadata referencing sensitive financial data held by the Customer — sensitive financial records themselves remain exclusively with the Customer',
          ],
        },
        { kind: 'h3', text: 'Special categories' },
        {
          kind: 'ul',
          items: [
            '**Health-related data** (ABDM Healthcare Bundle) — Zero-Storage mode is mandatory; never persisted to disk.',
            '**Children\u2019s data** (Edtech and similar) — Processed only with appropriate age-gating and verifiable parental consent configured by the Customer.',
          ],
        },
        { kind: 'h3', text: 'Retention' },
        {
          kind: 'p',
          md: 'Buffer data: minutes typically; no longer than 7 days. Consent artefact index: minimal (ID, expiry, revocation status) with configurable window. Audit logs in ConsentShield: 12 months. Canonical record in Customer storage: per Customer\u2019s policy.',
        },
      ],
    },
    {
      id: 'dpa-a2',
      title: 'Annex 2 — Technical and Organisational Measures',
      blocks: [
        { kind: 'h3', text: 'A. Confidentiality' },
        {
          kind: 'ul',
          items: [
            'Encryption in transit (TLS 1.3 or equivalent)',
            'Encryption at rest (AES-256 or equivalent)',
            'Customer-held encryption keys in Insulated and Zero-Storage deployment modes',
            'Multi-tenant isolation enforced at the database layer, not solely in application code',
            'Role-based access control for all administrative functions',
            'SSO + MFA for all ConsentShield personnel with access to Personal Data',
            'Internal service credentials scoped to the minimum necessary and rotated on a defined schedule',
          ],
        },
        { kind: 'h3', text: 'B. Integrity' },
        {
          kind: 'ul',
          items: [
            'Pseudonymisation and minimisation of Personal Data where purpose allows',
            'Write-through stateless oracle design: Personal Data buffered for delivery, not long-term storage',
            'Immutable audit logs of administrative actions',
            'Input validation and schema enforcement at API boundaries',
          ],
        },
        { kind: 'h3', text: 'C. Availability and resilience' },
        {
          kind: 'ul',
          items: [
            'Target availability 99.9% measured monthly; Enterprise service credits per Order Form',
            'Daily backups of operational state',
            'No backups of Data Principal buffer data by design',
            'Incident response runbooks maintained and tested',
          ],
        },
        { kind: 'h3', text: 'D. Personnel' },
        {
          kind: 'ul',
          items: [
            'Written confidentiality obligations for all personnel',
            'Annual security awareness training',
            'Background checks for personnel with administrative access',
          ],
        },
        { kind: 'h3', text: 'E. Supplier management' },
        {
          kind: 'ul',
          items: [
            'All Sub-processors bound by written data protection terms',
            'Documented selection criteria including compliance, certifications, posture',
            'Periodic review of Sub-processor compliance',
          ],
        },
        { kind: 'h3', text: 'F. Testing and assurance' },
        {
          kind: 'ul',
          items: [
            'Annual external penetration test',
            'Continuous automated vulnerability scanning of dependencies',
            'Quarterly internal access-control review',
            'Public vulnerability disclosure policy with defined response SLA',
          ],
        },
      ],
    },
    {
      id: 'dpa-a3',
      title: 'Annex 3 — Sub-processors',
      blocks: [
        {
          kind: 'p',
          md: 'Current authorised Sub-processors. This list is updated as Sub-processors are added; see Section 5 for notification and objection procedure.',
        },
        {
          kind: 'subprocTable',
          rows: [
            {
              name: 'Supabase Inc.',
              activity: 'Authentication; operational database',
              location: 'Regional',
            },
            {
              name: 'Cloudflare Inc.',
              activity: 'CDN, edge workers, default R2 storage',
              location: 'Global edge',
            },
            {
              name: 'Razorpay Software Pvt Ltd',
              activity: 'Subscription billing',
              location: 'India',
            },
            {
              name: 'Resend Inc.',
              activity: 'Transactional email',
              location: 'United States',
            },
            {
              name: 'Sentry Inc.',
              activity: 'Application error monitoring (de-identified)',
              location: 'United States',
            },
            {
              name: 'Amazon Web Services Inc.',
              activity: 'Optional customer-selected storage (BYOS)',
              location: 'Customer-selected',
            },
          ],
        },
        { kind: 'p', md: 'Last updated: 15 April 2026' },
      ],
    },
  ],
  addendum: {
    label: 'EU Data Protection Addendum',
    tocTitle: 'EU Addendum',
    articleId: 'dpa-eu',
    tocItems: [
      { id: 'eu-1', label: 'Scope & precedence' },
      { id: 'eu-2', label: 'Article 28 GDPR' },
      { id: 'eu-3', label: 'Standard Contractual Clauses' },
      { id: 'eu-4', label: 'UK transfers' },
      { id: 'eu-5', label: 'Swiss transfers' },
      { id: 'eu-6', label: 'Schrems II safeguards' },
      { id: 'eu-7', label: 'EU Representative' },
      { id: 'eu-8', label: 'Supervisory authorities' },
      { id: 'eu-9', label: 'Data Subject rights' },
    ],
    intro: [
      'This Addendum supplements the DPA where the Customer Processes Personal Data of Data Subjects located in the European Economic Area, the United Kingdom, or Switzerland ("EU Personal Data") through the Service. Terms used have the meanings given in the DPA or, where applicable, the GDPR.',
    ],
    sections: [
      {
        id: 'eu-1',
        title: 'Scope and precedence',
        blocks: [
          {
            kind: 'p',
            md: 'This Addendum applies only in respect of EU Personal Data Processed through the Service. In case of conflict between this Addendum and the DPA in respect of EU Personal Data, this Addendum prevails. For all other Personal Data, the DPA applies without modification.',
          },
        ],
      },
      {
        id: 'eu-2',
        title: 'Article 28 GDPR compliance',
        blocks: [
          {
            kind: 'p',
            md: 'The parties acknowledge that, with respect to EU Personal Data, this Addendum together with the DPA satisfies the requirements of Article 28(3) of the GDPR. ConsentShield specifically:',
          },
          {
            kind: 'ul',
            items: [
              'Processes EU Personal Data only on documented instructions from the Customer, including transfers to third countries, unless required by EU / Member State law;',
              'ensures confidentiality of personnel authorised to Process EU Personal Data;',
              'implements all measures required under Article 32 GDPR, as set out in Annex 2 of the DPA;',
              'respects the conditions for engaging Sub-processors in Article 28(2) and (4);',
              'assists the Customer in responding to Data Subject rights requests under Articles 15–22;',
              'assists the Customer with Articles 32–36 obligations (security, breach, DPIA);',
              'deletes or returns all EU Personal Data on Customer\u2019s choice after the end of Service;',
              'makes available all information necessary to demonstrate compliance, and contributes to audits.',
            ],
          },
        ],
      },
      {
        id: 'eu-3',
        title: 'Standard Contractual Clauses',
        blocks: [
          {
            kind: 'p',
            md: 'For transfers of EU Personal Data to jurisdictions without an adequacy decision, the parties incorporate by reference the Standard Contractual Clauses adopted by Commission Implementing Decision (EU) 2021/914 of 4 June 2021 (the "SCCs"), **Module Two (Controller to Processor)**.',
          },
          {
            kind: 'sccTable',
            rows: [
              { clause: 'Parties', value: 'Customer = Exporter; ConsentShield = Importer' },
              { clause: 'Module', value: 'Module Two (Controller to Processor)' },
              { clause: 'Clause 7 (Docking)', value: 'Does not apply' },
              {
                clause: 'Clause 9 (Sub-processors)',
                value: 'Option 2 (general written authorisation); 30-day notice per DPA §5.2',
              },
              { clause: 'Clause 11(a) (Redress body)', value: 'Not elected' },
              { clause: 'Clause 17 (Governing law)', value: 'Irish law' },
              { clause: 'Clause 18(b) (Forum)', value: 'Courts of Ireland' },
            ],
          },
          {
            kind: 'p',
            md: 'Annex I (description of transfer) is populated by reference to DPA Annex 1; Annex II (technical and organisational measures) by reference to DPA Annex 2; Annex III (sub-processors) by reference to DPA Annex 3.',
          },
        ],
      },
      {
        id: 'eu-4',
        title: 'UK transfers',
        blocks: [
          {
            kind: 'p',
            md: 'Where EU Personal Data includes data subject to the UK GDPR, the parties incorporate by reference the UK International Data Transfer Addendum issued by the Information Commissioner\u2019s Office (version B1.0, in force 21 March 2022), with the SCCs at Section 3 as the Approved EU SCCs and Tables 1–3 populated by reference to the DPA Annexes.',
          },
        ],
      },
      {
        id: 'eu-5',
        title: 'Swiss transfers',
        blocks: [
          {
            kind: 'p',
            md: 'Where EU Personal Data includes data subject to the Swiss Federal Act on Data Protection ("FADP"), the parties apply the SCCs with references to "GDPR" read to include the FADP; the competent supervisory authority is the Swiss Federal Data Protection and Information Commissioner (FDPIC); and "Member State" includes Switzerland, solely to enable Data Subjects in Switzerland to enforce rights in their habitual residence.',
          },
        ],
      },
      {
        id: 'eu-6',
        title: 'Supplementary measures (Schrems II)',
        blocks: [
          {
            kind: 'p',
            md: 'ConsentShield has conducted a transfer impact assessment in respect of Sub-processors Processing EU Personal Data outside the EEA. Summary available on written request, subject to confidentiality.',
          },
          {
            kind: 'p',
            md: 'ConsentShield confirms it has no reason to believe applicable laws in importing jurisdictions prevent fulfilling the SCCs; applies encryption, pseudonymisation, and strict access controls as supplementary measures; and will promptly notify the Customer of relevant changes to those laws.',
          },
          {
            kind: 'p',
            md: 'On government access: ConsentShield will notify the Customer promptly of any legally binding request for access to EU Personal Data (except where prohibited); challenge such requests on reasonable grounds; provide the minimum Personal Data permissible; and maintain records for annual aggregated statistics where permitted.',
          },
        ],
      },
      {
        id: 'eu-7',
        title: 'EU Representative',
        blocks: [
          {
            kind: 'p',
            md: 'Pending appointment of an EU Representative under Article 27 GDPR, inquiries from EU Data Subjects or Supervisory Authorities may be addressed to **privacy@consentshield.in**. The appointed EU Representative\u2019s contact details will be communicated to the Customer and updated in the Privacy Policy upon appointment.',
          },
        ],
      },
      {
        id: 'eu-8',
        title: 'Supervisory authorities',
        blocks: [
          {
            kind: 'p',
            md: 'The lead supervisory authority for the Customer\u2019s Processing is determined by the Customer\u2019s main or single establishment under Article 56 GDPR and is identified in the applicable Order Form. ConsentShield, not being established in the EU, submits to the jurisdiction of the Customer\u2019s lead supervisory authority for Processing under this Addendum.',
          },
        ],
      },
      {
        id: 'eu-9',
        title: 'Data Subject rights',
        blocks: [
          {
            kind: 'p',
            md: 'The Customer remains primarily responsible for responding to Data Subject rights requests under Articles 15–22 GDPR. ConsentShield provides the same support set out in DPA §6, adapted to GDPR response timeframes — without undue delay and, in any event, within one month of receipt, extendable by two further months for complex or numerous requests.',
          },
        ],
      },
    ],
  },
}
