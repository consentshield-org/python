import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalLayout } from '@/components/sections/legal-layout'
import { CtaBand } from '@/components/sections/cta-band'
import { DpaSigningCard } from '@/components/sections/dpa-signing-card'
import { DOWNLOAD_BRIEF, ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'DPA & EU Addendum · ConsentShield',
  description:
    'ConsentShield Data Processing Agreement and EU Addendum. Digital execution supported; executed on subscription.',
}

// Inline subgrid helper for Annex 3 sub-processors table + SCC election table.
// The HTML spec uses inline-styled grids; we preserve the exact layout.
const SUBPROC_GRID = {
  gridTemplateColumns: '1.4fr 1.2fr 1fr',
}

const SCC_GRID = {
  gridTemplateColumns: '1fr 1.4fr',
}

export default function DpaPage() {
  return (
    <main id="page-dpa">
      <LegalLayout
        title="Data Processing Agreement."
        lede="Under DPDP Act Section 8(2), every Data Fiduciary must have a written contract with each Data Processor handling personal data on its behalf. This DPA — together with the EU Addendum that follows, where applicable — is that contract. Executed digitally on subscription; no download, no wet-ink signature required."
        meta={[
          { label: 'Effective', value: '15 April 2026' },
          { label: 'Versions', value: 'DPA v1.0 · EU Addendum v1.0' },
          { label: 'Execution', value: 'Digital signature' },
          { label: 'Governing law', value: 'India (DPA) · Ireland (SCCs)' },
        ]}
        tocItems={[
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
        ]}
      >
        <p
          style={{
            fontSize: 15,
            color: 'var(--ink-2)',
            lineHeight: 1.65,
            marginBottom: 36,
          }}
        >
          This Data Processing Agreement (&ldquo;<strong>DPA</strong>&rdquo;)
          is entered into between <strong>ConsentShield</strong> (&ldquo;ConsentShield&rdquo;,
          &ldquo;Processor&rdquo;) and the customer identified on the
          applicable Order Form or signup record (&ldquo;Customer&rdquo;,
          &ldquo;Fiduciary&rdquo;). This DPA forms part of, and is subject to,
          the ConsentShield Terms of Service. In case of conflict concerning
          the Processing of Personal Data, this DPA prevails over the Terms.
        </p>

        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-2)',
            lineHeight: 1.65,
            marginBottom: 36,
          }}
        >
          <em>Background.</em> ConsentShield provides a B2B SaaS compliance
          platform (the &ldquo;Service&rdquo;) for the Digital Personal Data
          Protection Act 2023 of India (the &ldquo;DPDP Act&rdquo;) and, where
          applicable, the EU General Data Protection Regulation (the
          &ldquo;GDPR&rdquo;). In the course of providing the Service,
          ConsentShield processes Personal Data on behalf of the Customer.
          This DPA sets out the terms of that Processing, consistent with
          Section 8(2) of the DPDP Act.
        </p>

        <section id="dpa-1">
          <h2>Definitions</h2>
          <p>
            Capitalised terms not defined in this DPA take their meaning from
            the Terms. The following additional definitions apply.
          </p>
          <p>
            <strong>&ldquo;Applicable Data Protection Law&rdquo;</strong> means
            the DPDP Act; the DPDP Rules 2025 notified thereunder; and, where
            the Customer Processes Personal Data of Data Principals in the
            European Economic Area, the United Kingdom, or Switzerland, the
            GDPR and its national implementations.
          </p>
          <p>
            <strong>&ldquo;Data Principal&rdquo;</strong> or{' '}
            <strong>&ldquo;Data Subject&rdquo;</strong> means an identified or
            identifiable natural person to whom the Personal Data relates.
          </p>
          <p>
            <strong>&ldquo;Data Fiduciary&rdquo;</strong> or{' '}
            <strong>&ldquo;Data Controller&rdquo;</strong> means the party
            that determines the purpose and means of the Processing of
            Personal Data.
          </p>
          <p>
            <strong>&ldquo;Data Processor&rdquo;</strong> or{' '}
            <strong>&ldquo;Processor&rdquo;</strong> means the party that
            Processes Personal Data on behalf of the Data Fiduciary.
          </p>
          <p>
            <strong>&ldquo;Personal Data&rdquo;</strong> has the meaning given
            in Section 2(t) of the DPDP Act and, where applicable, Article
            4(1) of the GDPR.
          </p>
          <p>
            <strong>&ldquo;Processing&rdquo;</strong> or{' '}
            <strong>&ldquo;Process&rdquo;</strong> means any operation or set
            of operations performed on Personal Data, whether or not by
            automated means.
          </p>
          <p>
            <strong>&ldquo;Security Incident&rdquo;</strong> means a breach of
            security leading to the accidental or unlawful destruction, loss,
            alteration, unauthorised disclosure of, or access to, Personal
            Data Processed under this DPA.
          </p>
          <p>
            <strong>&ldquo;Sub-processor&rdquo;</strong> means a third party
            engaged by ConsentShield to Process Personal Data on behalf of the
            Customer.
          </p>
        </section>

        <section id="dpa-2">
          <h2>Scope, roles, and duration</h2>
          <h3>2.1 Roles</h3>
          <p>
            In respect of Personal Data Processed through the Service, the
            Customer is the Data Fiduciary and ConsentShield is the Data
            Processor. Sub-processors are processors sub-contracted by
            ConsentShield. Data Principals are the individuals whose Personal
            Data flows through the Service.
          </p>
          <h3>2.2 Subject matter and nature of Processing</h3>
          <p>
            ConsentShield Processes Personal Data solely to provide the
            Service to the Customer — including, without limitation,
            generating, storing, and delivering DEPA-native consent artefacts;
            monitoring consent enforcement; supporting Data Principal rights
            requests; orchestrating artefact-scoped deletion; and producing
            audit exports.
          </p>
          <h3>2.3 Duration</h3>
          <p>
            This DPA applies for as long as ConsentShield Processes Personal
            Data for the Customer, and survives termination to the extent
            necessary to give effect to Sections 10 and 11.
          </p>
          <h3>2.4 Details of Processing</h3>
          <p>
            The categories of Data Principals, categories of Personal Data,
            purposes of Processing, and retention periods are set out in{' '}
            <strong>Annex 1</strong>.
          </p>
        </section>

        <section id="dpa-3">
          <h2>Customer obligations (as Data Fiduciary)</h2>
          <h3>3.1 Warranties</h3>
          <p>
            The Customer warrants that it has lawful basis under Applicable
            Data Protection Law for all Processing instructed; has provided
            all required notices and obtained all required consents from Data
            Principals; its instructions to ConsentShield comply with
            Applicable Data Protection Law; and Customer Data does not
            infringe third-party rights.
          </p>
          <h3>3.2 Primary responsibility for Data Principal rights</h3>
          <p>
            The Customer is primarily responsible for responding to Data
            Principal rights requests. ConsentShield provides reasonable
            support as set out in Section 6.
          </p>
          <h3>3.3 Configuration</h3>
          <p>
            The Customer will use the Service&apos;s configuration tools —
            including the Purpose Definition Registry, retention rules,
            deletion connectors, and breach notification workflow — to
            configure Processing that matches its lawful basis and declared
            purposes.
          </p>
        </section>

        <section id="dpa-4">
          <h2>ConsentShield obligations (as Data Processor)</h2>
          <h3>4.1 Documented instructions</h3>
          <p>
            ConsentShield Processes Personal Data only on documented
            instructions from the Customer. The Customer&apos;s configuration
            of, and use of, the Service consistent with the documentation, the
            Terms, and this DPA constitutes documented instructions.
            ConsentShield will inform the Customer if, in its view, an
            instruction infringes Applicable Data Protection Law.
          </p>
          <h3>4.2 Confidentiality</h3>
          <p>
            ConsentShield ensures that personnel authorised to Process
            Personal Data are bound by written confidentiality obligations no
            less protective than this DPA.
          </p>
          <h3>4.3 Security</h3>
          <p>
            ConsentShield implements and maintains the technical and
            organisational measures set out in <strong>Annex 2</strong>,
            proportionate to the risk represented by the Processing.
          </p>
          <h3>4.4 Sub-processors</h3>
          <p>ConsentShield engages Sub-processors as set out in Section 5.</p>
          <h3>4.5 Support</h3>
          <p>
            ConsentShield supports the Customer&apos;s Data Principal rights
            requests, regulatory notifications, and data protection impact
            assessments as set out in this DPA.
          </p>
          <h3>4.6 Security Incident notification</h3>
          <p>
            ConsentShield notifies the Customer of Security Incidents as set
            out in Section 7.
          </p>
          <h3>4.7 Return and deletion</h3>
          <p>On termination, ConsentShield acts in accordance with Section 11.</p>
          <h3>4.8 Records</h3>
          <p>
            ConsentShield maintains records of its Processing activities on
            behalf of the Customer and makes them available to the Customer
            on reasonable request.
          </p>
        </section>

        <section id="dpa-5">
          <h2>Sub-processors</h2>
          <h3>5.1 Authorisation</h3>
          <p>
            The Customer authorises the use of the Sub-processors listed in{' '}
            <strong>Annex 3</strong>.
          </p>
          <h3>5.2 Notice of new Sub-processors</h3>
          <p>
            ConsentShield will notify the Customer at least 30 days before
            engaging a new Sub-processor, by email to the Customer&apos;s
            registered admin contact and by banner notice in the ConsentShield
            dashboard.
          </p>
          <h3>5.3 Objection</h3>
          <p>
            The Customer may object to a new Sub-processor on reasonable data
            protection grounds within 20 days of notice. If the parties
            cannot resolve the objection in good faith, the Customer may
            terminate the affected subscription without penalty and receive a
            pro-rated refund of any prepaid fees attributable to the period
            after termination.
          </p>
          <h3>5.4 Flow-down</h3>
          <p>
            ConsentShield binds each Sub-processor in writing to data
            protection obligations no less protective than this DPA.
          </p>
          <h3>5.5 Liability</h3>
          <p>
            ConsentShield remains fully liable to the Customer for each
            Sub-processor&apos;s compliance with this DPA, subject to the
            Limitation of Liability clause in the Terms.
          </p>
        </section>

        <section id="dpa-6">
          <h2>Data Principal rights</h2>
          <h3>6.1 Primary responsibility</h3>
          <p>
            The Customer is responsible for responding to Data Principal
            rights requests. ConsentShield does not respond to Data Principal
            rights requests directly; requests received by ConsentShield are
            forwarded to the Customer promptly and not responded to
            substantively.
          </p>
          <h3>6.2 Support provided</h3>
          <p>
            ConsentShield supports the Customer&apos;s response by providing
            dashboard tooling to locate all active consent artefacts for a
            given Data Principal; orchestrating artefact-scoped deletion
            across connected integrations and returning signed deletion
            receipts; providing Data Principal data export in a
            machine-readable format; providing configurable Rights Request SLA
            workflows with 30-day response targets; and, where applicable,
            GDPR Article 15–22 rights workflows.
          </p>
          <h3>6.3 Response timeframe</h3>
          <p>
            ConsentShield-side actions triggered by valid Customer
            instructions are completed within the SLAs set out in the Service
            documentation, not exceeding 72 hours from receipt of a valid
            instruction.
          </p>
        </section>

        <section id="dpa-7">
          <h2>Security Incidents</h2>
          <h3>7.1 Notification to Customer</h3>
          <p>
            ConsentShield will notify the Customer of a confirmed Security
            Incident affecting the Customer&apos;s Personal Data without
            undue delay, and in any event within 48 hours of confirmation.
          </p>
          <h3>7.2 Content of notification</h3>
          <p>
            The notification will include, to the extent known at the time and
            as information develops: the nature of the Security Incident;
            categories and approximate numbers of Data Principals and records
            affected; the likely consequences; the measures taken or proposed
            to address the Security Incident and mitigate its effects; and
            the name and contact details of the ConsentShield point of
            contact.
          </p>
          <h3>7.3 Cooperation</h3>
          <p>
            ConsentShield will cooperate in the Customer&apos;s investigation
            and regulatory reporting obligations — including the 72-hour
            notification obligation under Section 8(6) of the DPDP Act, and
            the corresponding obligations under Articles 33 and 34 GDPR.
          </p>
          <h3>7.4 Direct notification</h3>
          <p>
            ConsentShield will not notify regulators or Data Principals
            directly, except where required by law or where the Customer has
            failed to do so after reasonable notice and the failure is likely
            to cause material harm to Data Principals.
          </p>
        </section>

        <section id="dpa-8">
          <h2>International transfers</h2>
          <h3>8.1 Primary location</h3>
          <p>
            ConsentShield&apos;s primary infrastructure is located in India.
          </p>
          <h3>8.2 Sub-processor transfers</h3>
          <p>
            Certain Sub-processors (notably edge CDN infrastructure and
            regional database replicas) may Process Personal Data outside
            India, subject to the safeguards set out in this DPA.
          </p>
          <h3>8.3 DPDP restrictions</h3>
          <p>
            ConsentShield will not Process Personal Data in any jurisdiction
            notified by the Central Government as restricted under Section 16
            of the DPDP Act.
          </p>
          <h3>8.4 GDPR cross-border transfers</h3>
          <p>
            For transfers of Personal Data of EU Data Subjects outside the
            European Economic Area, the EU Data Protection Addendum (below)
            applies and incorporates the Standard Contractual Clauses adopted
            by Commission Implementing Decision (EU) 2021/914.
          </p>
        </section>

        <section id="dpa-9">
          <h2>Audit rights</h2>
          <h3>9.1 Information on request</h3>
          <p>
            ConsentShield will make available to the Customer, on reasonable
            written request, the information necessary to demonstrate
            compliance with this DPA — including the current Annex 2
            measures, penetration test summaries (non-confidential), and
            third-party audit reports where available.
          </p>
          <h3>9.2 Audits</h3>
          <p>
            The Customer may conduct audits to verify ConsentShield&apos;s
            compliance through a mutually agreed independent third-party
            auditor bound by confidentiality obligations, on not less than 30
            days&apos; written notice, no more than once per 12-month period,
            and at the Customer&apos;s cost. In the event of a Security
            Incident affecting the Customer, the 30-day notice period does
            not apply.
          </p>
          <h3>9.3 Audit in lieu</h3>
          <p>
            ConsentShield may satisfy audit requests by providing current
            third-party audit reports (e.g. SOC 2 Type II, ISO 27001) and
            certifications, where these cover the Processing relevant to the
            Customer&apos;s request.
          </p>
        </section>

        <section id="dpa-10">
          <h2>Liability</h2>
          <p>
            The parties&apos; liability under this DPA is governed by, and
            subject to, Section 8 (Limitation of liability) of the Terms —
            including the cap equal to fees paid in the preceding 12 months,
            the exclusion of indirect and consequential damages, and the
            inclusion of indemnification obligations within the cap.
          </p>
          <p>
            Nothing in this DPA limits or excludes liability to the extent
            limitation is prohibited by Applicable Data Protection Law.
          </p>
        </section>

        <section id="dpa-11">
          <h2>Return and deletion</h2>
          <p>
            On termination or expiry of the Service, and at the
            Customer&apos;s written request, ConsentShield will return
            Personal Data in a machine-readable format or delete all Personal
            Data Processed under this DPA within 30 days, except to the
            extent Applicable Data Protection Law requires continued
            retention.
          </p>
          <p>
            The Customer&apos;s canonical compliance record residing in
            Customer-controlled storage is unaffected by termination and is
            the Customer&apos;s to retain.
          </p>
          <p>
            Any retention required by law is limited to what is necessary,
            subject to ongoing confidentiality and security obligations, and
            is deleted as soon as the legal obligation expires.
          </p>
        </section>

        <section id="dpa-12">
          <h2>Conflict, law, and execution</h2>
          <p>
            <strong>Conflict.</strong> In case of conflict between this DPA
            and the Terms in respect of the Processing of Personal Data, this
            DPA prevails. In case of conflict between this DPA and the EU
            Addendum below, the EU Addendum prevails in respect of EU
            Personal Data only.
          </p>
          <p>
            <strong>Governing law.</strong> This DPA is governed by the laws
            of India. The courts of Hyderabad, Telangana have exclusive
            jurisdiction, subject to either party&apos;s right to seek
            interim relief in any competent court.
          </p>
          <p>
            <strong>Execution.</strong> This DPA is executed by the
            Customer&apos;s digital acceptance on subscription to the Service
            (or on first use of a feature that triggers EU-data Processing,
            for the EU Addendum). The digital acceptance record — signatory
            identity, timestamp, IP address, and the version number of this
            DPA — constitutes execution for all purposes.
          </p>
        </section>

        <section id="dpa-a1">
          <h2>Annex 1 — Description of Processing</h2>
          <h3>Subject matter and duration</h3>
          <p>
            Provision of the ConsentShield compliance platform to the Customer
            under the Terms, for the term of the Customer&apos;s subscription
            plus any reasonable period required to effect return or deletion
            under Section 11.
          </p>
          <h3>Nature and purpose</h3>
          <p>
            Collection, structuring, storage (buffered), and delivery of
            consent artefacts; enforcement monitoring of third-party scripts
            on Customer web properties; orchestration of Data Principal
            rights fulfilment, including artefact-scoped deletion; breach
            notification workflow; audit export.
          </p>
          <h3>Categories of Data Principals</h3>
          <ul>
            <li>End users of the Customer&apos;s websites and applications</li>
            <li>
              Employees, contractors, and representatives of the Customer,
              where the Customer Processes their Personal Data through the
              Service
            </li>
            <li>Patients, where the Customer uses the ABDM Healthcare Bundle</li>
            <li>
              Account holders, nominees, guarantors, and co-borrowers, where
              the Customer is a regulated financial institution using the BFSI
              template
            </li>
          </ul>
          <h3>Categories of Personal Data</h3>
          <ul>
            <li>
              <strong>Consent-related data:</strong> consent artefact
              identifiers, purpose acceptances, timestamps, hashed IP
              addresses, hashed user-agent strings, revocation timestamps
            </li>
            <li>
              <strong>Contact data:</strong> email, phone number, full name
              (where the Customer elects to collect)
            </li>
            <li>
              <strong>Technical data:</strong> session identifiers, anonymised
              device fingerprints
            </li>
            <li>
              <strong>Rights request data:</strong> Data Principal name,
              contact details, nature of the request, correspondence history,
              identity verification metadata
            </li>
            <li>
              <strong>(ABDM Healthcare Bundle only)</strong> health
              identifiers such as ABHA ID and FHIR metadata — flowing through
              memory only, not persisted
            </li>
            <li>
              <strong>(BFSI only)</strong> consent metadata referencing
              sensitive financial data held by the Customer — sensitive
              financial records themselves remain exclusively with the
              Customer
            </li>
          </ul>
          <h3>Special categories</h3>
          <ul>
            <li>
              <strong>Health-related data</strong> (ABDM Healthcare Bundle) —
              Zero-Storage mode is mandatory; never persisted to disk.
            </li>
            <li>
              <strong>Children&apos;s data</strong> (Edtech and similar) —
              Processed only with appropriate age-gating and verifiable
              parental consent configured by the Customer.
            </li>
          </ul>
          <h3>Retention</h3>
          <p>
            Buffer data: minutes typically; no longer than 7 days. Consent
            artefact index: minimal (ID, expiry, revocation status) with
            configurable window. Audit logs in ConsentShield: 12 months.
            Canonical record in Customer storage: per Customer&apos;s policy.
          </p>
        </section>

        <section id="dpa-a2">
          <h2>Annex 2 — Technical and Organisational Measures</h2>
          <h3>A. Confidentiality</h3>
          <ul>
            <li>Encryption in transit (TLS 1.3 or equivalent)</li>
            <li>Encryption at rest (AES-256 or equivalent)</li>
            <li>
              Customer-held encryption keys in Insulated and Zero-Storage
              deployment modes
            </li>
            <li>
              Multi-tenant isolation enforced at the database layer, not
              solely in application code
            </li>
            <li>Role-based access control for all administrative functions</li>
            <li>
              SSO + MFA for all ConsentShield personnel with access to
              Personal Data
            </li>
            <li>
              Internal service credentials scoped to the minimum necessary and
              rotated on a defined schedule
            </li>
          </ul>
          <h3>B. Integrity</h3>
          <ul>
            <li>
              Pseudonymisation and minimisation of Personal Data where purpose
              allows
            </li>
            <li>
              Write-through stateless oracle design: Personal Data buffered
              for delivery, not long-term storage
            </li>
            <li>Immutable audit logs of administrative actions</li>
            <li>Input validation and schema enforcement at API boundaries</li>
          </ul>
          <h3>C. Availability and resilience</h3>
          <ul>
            <li>
              Target availability 99.9% measured monthly; Enterprise service
              credits per Order Form
            </li>
            <li>Daily backups of operational state</li>
            <li>No backups of Data Principal buffer data by design</li>
            <li>Incident response runbooks maintained and tested</li>
          </ul>
          <h3>D. Personnel</h3>
          <ul>
            <li>Written confidentiality obligations for all personnel</li>
            <li>Annual security awareness training</li>
            <li>Background checks for personnel with administrative access</li>
          </ul>
          <h3>E. Supplier management</h3>
          <ul>
            <li>All Sub-processors bound by written data protection terms</li>
            <li>
              Documented selection criteria including compliance,
              certifications, posture
            </li>
            <li>Periodic review of Sub-processor compliance</li>
          </ul>
          <h3>F. Testing and assurance</h3>
          <ul>
            <li>Annual external penetration test</li>
            <li>Continuous automated vulnerability scanning of dependencies</li>
            <li>Quarterly internal access-control review</li>
            <li>Public vulnerability disclosure policy with defined response SLA</li>
          </ul>
        </section>

        <section id="dpa-a3">
          <h2>Annex 3 — Sub-processors</h2>
          <p>
            Current authorised Sub-processors. This list is updated as
            Sub-processors are added; see Section 5 for notification and
            objection procedure.
          </p>
          <div
            className="legal-note"
            style={{
              padding: 0,
              background: 'white',
              border: '1px solid var(--line)',
              borderLeft: '3px solid var(--teal)',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--line-soft)',
                fontFamily: 'var(--mono)',
                fontSize: '10.5px',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
                display: 'grid',
                ...SUBPROC_GRID,
                gap: 14,
                fontWeight: 600,
              }}
            >
              <span>Sub-processor</span>
              <span>Activity</span>
              <span>Location</span>
            </div>
            <SubprocRow
              name="Supabase Inc."
              activity="Authentication; operational database"
              location="Regional"
            />
            <SubprocRow
              name="Cloudflare Inc."
              activity="CDN, edge workers, default R2 storage"
              location="Global edge"
            />
            <SubprocRow
              name="Razorpay Software Pvt Ltd"
              activity="Subscription billing"
              location="India"
            />
            <SubprocRow
              name="Resend Inc."
              activity="Transactional email"
              location="United States"
            />
            <SubprocRow
              name="Sentry Inc."
              activity="Application error monitoring (de-identified)"
              location="United States"
            />
            <SubprocRow
              name="Amazon Web Services Inc."
              activity="Optional customer-selected storage (BYOS)"
              location="Customer-selected"
              last
            />
          </div>
          <p
            style={{
              marginTop: 16,
              fontSize: 12,
              color: 'var(--ink-3)',
            }}
          >
            Last updated: 15 April 2026
          </p>
        </section>
      </LegalLayout>

      {/* Divider into EU Addendum */}
      <div className="dpa-divider">
        <span className="dpa-divider-label">EU Data Protection Addendum</span>
      </div>

      <section className="legal-body" style={{ paddingTop: 16 }}>
        <div className="legal-body-inner">
          <nav className="legal-toc" aria-label="EU Addendum contents">
            <div className="legal-toc-title">EU Addendum</div>
            <ol>
              <li>
                <a href="#eu-1">Scope &amp; precedence</a>
              </li>
              <li>
                <a href="#eu-2">Article 28 GDPR</a>
              </li>
              <li>
                <a href="#eu-3">Standard Contractual Clauses</a>
              </li>
              <li>
                <a href="#eu-4">UK transfers</a>
              </li>
              <li>
                <a href="#eu-5">Swiss transfers</a>
              </li>
              <li>
                <a href="#eu-6">Schrems II safeguards</a>
              </li>
              <li>
                <a href="#eu-7">EU Representative</a>
              </li>
              <li>
                <a href="#eu-8">Supervisory authorities</a>
              </li>
              <li>
                <a href="#eu-9">Data Subject rights</a>
              </li>
            </ol>
          </nav>

          <article className="legal-content" id="dpa-eu">
            <p
              style={{
                fontSize: 15,
                color: 'var(--ink-2)',
                lineHeight: 1.65,
                marginBottom: 28,
              }}
            >
              This Addendum supplements the DPA where the Customer Processes
              Personal Data of Data Subjects located in the European Economic
              Area, the United Kingdom, or Switzerland (&ldquo;EU Personal
              Data&rdquo;) through the Service. Terms used have the meanings
              given in the DPA or, where applicable, the GDPR.
            </p>

            <section id="eu-1">
              <h2>Scope and precedence</h2>
              <p>
                This Addendum applies only in respect of EU Personal Data
                Processed through the Service. In case of conflict between
                this Addendum and the DPA in respect of EU Personal Data,
                this Addendum prevails. For all other Personal Data, the DPA
                applies without modification.
              </p>
            </section>

            <section id="eu-2">
              <h2>Article 28 GDPR compliance</h2>
              <p>
                The parties acknowledge that, with respect to EU Personal
                Data, this Addendum together with the DPA satisfies the
                requirements of Article 28(3) of the GDPR. ConsentShield
                specifically:
              </p>
              <ul>
                <li>
                  Processes EU Personal Data only on documented instructions
                  from the Customer, including transfers to third countries,
                  unless required by EU / Member State law;
                </li>
                <li>
                  ensures confidentiality of personnel authorised to Process
                  EU Personal Data;
                </li>
                <li>
                  implements all measures required under Article 32 GDPR, as
                  set out in Annex 2 of the DPA;
                </li>
                <li>
                  respects the conditions for engaging Sub-processors in
                  Article 28(2) and (4);
                </li>
                <li>
                  assists the Customer in responding to Data Subject rights
                  requests under Articles 15–22;
                </li>
                <li>
                  assists the Customer with Articles 32–36 obligations
                  (security, breach, DPIA);
                </li>
                <li>
                  deletes or returns all EU Personal Data on Customer&apos;s
                  choice after the end of Service;
                </li>
                <li>
                  makes available all information necessary to demonstrate
                  compliance, and contributes to audits.
                </li>
              </ul>
            </section>

            <section id="eu-3">
              <h2>Standard Contractual Clauses</h2>
              <p>
                For transfers of EU Personal Data to jurisdictions without an
                adequacy decision, the parties incorporate by reference the
                Standard Contractual Clauses adopted by Commission
                Implementing Decision (EU) 2021/914 of 4 June 2021 (the
                &ldquo;SCCs&rdquo;),{' '}
                <strong>Module Two (Controller to Processor)</strong>.
              </p>
              <div
                className="legal-note"
                style={{
                  padding: 0,
                  background: 'white',
                  borderLeft: '3px solid var(--teal)',
                }}
              >
                <div
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--line-soft)',
                    fontFamily: 'var(--mono)',
                    fontSize: '10.5px',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    display: 'grid',
                    ...SCC_GRID,
                    gap: 14,
                    fontWeight: 600,
                  }}
                >
                  <span>SCC Clause</span>
                  <span>Election / parameter</span>
                </div>
                <SccRow
                  clause="Parties"
                  value="Customer = Exporter; ConsentShield = Importer"
                />
                <SccRow
                  clause="Module"
                  value="Module Two (Controller to Processor)"
                />
                <SccRow clause="Clause 7 (Docking)" value="Does not apply" />
                <SccRow
                  clause="Clause 9 (Sub-processors)"
                  value="Option 2 (general written authorisation); 30-day notice per DPA §5.2"
                />
                <SccRow
                  clause="Clause 11(a) (Redress body)"
                  value="Not elected"
                />
                <SccRow clause="Clause 17 (Governing law)" value="Irish law" />
                <SccRow clause="Clause 18(b) (Forum)" value="Courts of Ireland" last />
              </div>
              <p style={{ marginTop: 16 }}>
                Annex I (description of transfer) is populated by reference to
                DPA Annex 1; Annex II (technical and organisational measures)
                by reference to DPA Annex 2; Annex III (sub-processors) by
                reference to DPA Annex 3.
              </p>
            </section>

            <section id="eu-4">
              <h2>UK transfers</h2>
              <p>
                Where EU Personal Data includes data subject to the UK GDPR,
                the parties incorporate by reference the UK International Data
                Transfer Addendum issued by the Information Commissioner&apos;s
                Office (version B1.0, in force 21 March 2022), with the SCCs
                at Section 3 as the Approved EU SCCs and Tables 1–3 populated
                by reference to the DPA Annexes.
              </p>
            </section>

            <section id="eu-5">
              <h2>Swiss transfers</h2>
              <p>
                Where EU Personal Data includes data subject to the Swiss
                Federal Act on Data Protection (&ldquo;FADP&rdquo;), the
                parties apply the SCCs with references to &ldquo;GDPR&rdquo;
                read to include the FADP; the competent supervisory authority
                is the Swiss Federal Data Protection and Information
                Commissioner (FDPIC); and &ldquo;Member State&rdquo; includes
                Switzerland, solely to enable Data Subjects in Switzerland to
                enforce rights in their habitual residence.
              </p>
            </section>

            <section id="eu-6">
              <h2>Supplementary measures (Schrems II)</h2>
              <p>
                ConsentShield has conducted a transfer impact assessment in
                respect of Sub-processors Processing EU Personal Data outside
                the EEA. Summary available on written request, subject to
                confidentiality.
              </p>
              <p>
                ConsentShield confirms it has no reason to believe applicable
                laws in importing jurisdictions prevent fulfilling the SCCs;
                applies encryption, pseudonymisation, and strict access
                controls as supplementary measures; and will promptly notify
                the Customer of relevant changes to those laws.
              </p>
              <p>
                On government access: ConsentShield will notify the Customer
                promptly of any legally binding request for access to EU
                Personal Data (except where prohibited); challenge such
                requests on reasonable grounds; provide the minimum Personal
                Data permissible; and maintain records for annual aggregated
                statistics where permitted.
              </p>
            </section>

            <section id="eu-7">
              <h2>EU Representative</h2>
              <p>
                Pending appointment of an EU Representative under Article 27
                GDPR, inquiries from EU Data Subjects or Supervisory
                Authorities may be addressed to{' '}
                <strong>privacy@consentshield.in</strong>. The appointed EU
                Representative&apos;s contact details will be communicated to
                the Customer and updated in the Privacy Policy upon
                appointment.
              </p>
            </section>

            <section id="eu-8">
              <h2>Supervisory authorities</h2>
              <p>
                The lead supervisory authority for the Customer&apos;s
                Processing is determined by the Customer&apos;s main or single
                establishment under Article 56 GDPR and is identified in the
                applicable Order Form. ConsentShield, not being established in
                the EU, submits to the jurisdiction of the Customer&apos;s
                lead supervisory authority for Processing under this Addendum.
              </p>
            </section>

            <section id="eu-9">
              <h2>Data Subject rights</h2>
              <p>
                The Customer remains primarily responsible for responding to
                Data Subject rights requests under Articles 15–22 GDPR.
                ConsentShield provides the same support set out in DPA §6,
                adapted to GDPR response timeframes — without undue delay
                and, in any event, within one month of receipt, extendable by
                two further months for complex or numerous requests.
              </p>
            </section>
          </article>
        </div>
      </section>

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

function SubprocRow({
  name,
  activity,
  location,
  last,
}: {
  name: string
  activity: string
  location: string
  last?: boolean
}) {
  return (
    <div
      style={{
        padding: '12px 16px',
        display: 'grid',
        ...SUBPROC_GRID,
        gap: 14,
        fontSize: '12.5px',
        borderBottom: last ? undefined : '1px solid var(--line-soft)',
      }}
    >
      <strong style={{ color: 'var(--navy)' }}>{name}</strong>
      <span style={{ color: 'var(--ink-2)' }}>{activity}</span>
      <span
        style={{
          fontFamily: 'var(--mono)',
          color: 'var(--ink-3)',
          fontSize: 11,
        }}
      >
        {location}
      </span>
    </div>
  )
}

function SccRow({
  clause,
  value,
  last,
}: {
  clause: string
  value: string
  last?: boolean
}) {
  return (
    <div
      style={{
        padding: '10px 16px',
        display: 'grid',
        ...SCC_GRID,
        gap: 14,
        fontSize: '12.5px',
        borderBottom: last ? undefined : '1px solid var(--line-soft)',
      }}
    >
      <span style={{ color: 'var(--navy)', fontWeight: 600 }}>{clause}</span>
      <span style={{ color: 'var(--ink-2)' }}>{value}</span>
    </div>
  )
}
