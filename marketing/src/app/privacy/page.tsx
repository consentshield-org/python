import type { Metadata } from 'next'
import { LegalLayout } from '@/components/sections/legal-layout'

export const metadata: Metadata = {
  title: 'Privacy Policy · ConsentShield',
  description:
    "How ConsentShield handles personal data — of the businesses who buy from us, and of their Data Principals whose data flows through the platform.",
}

export default function PrivacyPage() {
  return (
    <main id="page-privacy">
      <LegalLayout
        title="Privacy Policy."
        lede="How ConsentShield handles personal data — of the businesses who buy from us, and of their Data Principals whose data flows through the platform. Written to the standard we ask our customers to meet."
        meta={[
          { label: 'Effective', value: '15 April 2026' },
          { label: 'Last updated', value: '15 April 2026' },
          { label: 'Applicable law', value: 'DPDP Act 2023, GDPR' },
          { label: 'Version', value: 'v1.0' },
        ]}
        tocItems={[
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
        ]}
      >
        <section id="pp-1">
          <h2>Who this applies to</h2>
          <p>This policy covers two distinct categories of personal data:</p>
          <ul>
            <li>
              <strong>Customer Users</strong> — individuals at our business
              customers who sign up for, configure, and operate the
              ConsentShield platform. We act as the{' '}
              <strong>Data Fiduciary</strong> for this data.
            </li>
            <li>
              <strong>Data Principals</strong> — individuals whose personal
              data flows through the Service as part of our customers&apos;
              compliance operations. For this data, our customer is the Data
              Fiduciary; ConsentShield is the{' '}
              <strong>Data Processor</strong>. Our obligations to Data
              Principals are discharged through the Data Processing Agreement
              with our customer, and through the stateless oracle architecture
              described below.
            </li>
          </ul>
          <div className="legal-note">
            <strong>If you are a Data Principal</strong> of one of our
            customers seeking to exercise rights (erasure, access, correction,
            nomination), the controller of your data is our customer — not
            ConsentShield. Contact them directly. If they cannot be reached,
            our grievance officer (Section 12) will route your request.
          </div>
        </section>

        <section id="pp-2">
          <h2>Data we collect</h2>
          <h3>About Customer Users</h3>
          <ul>
            <li>
              <strong>Account data</strong> — name, work email, organisation,
              role, hashed password credentials.
            </li>
            <li>
              <strong>Usage data</strong> — how you navigate the platform,
              features used, timestamps. Collected via first-party analytics;
              no third-party tracking.
            </li>
            <li>
              <strong>Billing data</strong> — for paid plans, handled by
              Razorpay. We do not store card numbers.
            </li>
            <li>
              <strong>Communications</strong> — support tickets, sales
              conversations, DPA and order-form records.
            </li>
          </ul>
          <h3>About Data Principals (flowing through the Service)</h3>
          <ul>
            <li>
              <strong>Consent artefacts</strong> — one per purpose, with data
              scope, expiry, and revocation chain.
            </li>
            <li>
              <strong>Consent events and tracker observations</strong> —
              generated as Data Principals interact with customer websites.
            </li>
            <li>
              <strong>Rights request metadata</strong> — where customers use
              the Service to manage erasure, access, or correction requests.
            </li>
          </ul>
          <div className="legal-note">
            <strong>Stateless oracle.</strong> Data Principal data is buffered
            for delivery to Customer-controlled storage and then deleted from
            ConsentShield systems. Buffer retention is measured in minutes,
            not months. See Section 6.
          </div>
        </section>

        <section id="pp-3">
          <h2>How we use data</h2>
          <p>We use personal data only for the purposes it was collected for:</p>
          <ul>
            <li>
              <strong>Provide and operate the Service</strong> —
              authentication, product functionality, billing, support.
            </li>
            <li>
              <strong>Improve the Service</strong> — aggregate, de-identified
              usage patterns inform product decisions. No individual-level
              profiling.
            </li>
            <li>
              <strong>Security and abuse prevention</strong> — detect
              credential stuffing, anomalous API usage, data scraping.
            </li>
            <li>
              <strong>Communicate with Customer Users</strong> — service
              announcements, security notices, billing, opt-in product updates.
            </li>
            <li>
              <strong>Comply with law</strong> — respond to lawful legal
              process and regulatory obligations.
            </li>
          </ul>
          <p>
            We do not sell personal data. We do not use personal data to train
            third-party AI models. We do not use Data Principal data for any
            purpose other than processing on behalf of our customer.
          </p>
        </section>

        <section id="pp-4">
          <h2>Legal basis</h2>
          <p>
            Under the DPDP Act 2023, we process personal data of Customer
            Users on the basis of <strong>consent</strong> (account creation)
            and <strong>legitimate uses</strong> — specifically, performance
            of the contract, compliance with legal obligations, and security —
            as permitted by Section 7.
          </p>
          <p>
            For Customer Users located in the European Economic Area, the
            United Kingdom, or Switzerland, we process personal data under the
            GDPR on the bases of <strong>contract</strong> (Article 6(1)(b)),{' '}
            <strong>legitimate interest</strong> (6(1)(f) — security, service
            improvement), <strong>legal obligation</strong> (6(1)(c)), and{' '}
            <strong>consent</strong> (6(1)(a)) for optional marketing.
          </p>
        </section>

        <section id="pp-5">
          <h2>Sharing &amp; sub-processors</h2>
          <p>
            We share personal data only with vetted sub-processors that are
            bound by data protection agreements at least as protective as our
            commitments to you:
          </p>
          <ul>
            <li>
              <strong>Supabase Inc.</strong> — authentication, Postgres
              database (operational state).
            </li>
            <li>
              <strong>Cloudflare Inc.</strong> — banner CDN, edge workers, R2
              default storage.
            </li>
            <li>
              <strong>Razorpay Software Pvt Ltd</strong> — subscription
              billing (INR).
            </li>
            <li>
              <strong>Resend Inc.</strong> — transactional email.
            </li>
            <li>
              <strong>Sentry Inc.</strong> — error monitoring (de-identified).
            </li>
            <li>
              <strong>Amazon Web Services Inc.</strong> — Bring-Your-Own-Storage
              option for S3.
            </li>
          </ul>
          <p>
            The sub-processor list above is the current, authoritative list.
            We notify Customers at least 30 days before adding a new
            sub-processor; customers with an active Enterprise agreement can
            object and, if the objection cannot be resolved, terminate the
            affected subscription without penalty.
          </p>
          <p>
            We do not share personal data with advertising networks, data
            brokers, or any third party for marketing purposes.
          </p>
        </section>

        <section id="pp-6">
          <h2>Retention</h2>
          <ul>
            <li>
              <strong>Customer User data</strong> — retained for the life of
              the account plus 12 months, unless law requires longer retention
              (e.g., tax records).
            </li>
            <li>
              <strong>Data Principal buffer data</strong> — retained only as
              long as needed to confirm successful delivery to
              Customer-controlled storage. Typically minutes; never longer
              than 7 days.
            </li>
            <li>
              <strong>Consent artefact index</strong> — a minimal index
              (artefact ID, expiry, revocation status) is retained for
              enforcement and probe testing, subject to a configurable TTL.
            </li>
            <li>
              <strong>Audit logs</strong> — retained for 12 months in
              ConsentShield; the canonical record lives in Customer-controlled
              storage under the Customer&apos;s retention policy.
            </li>
            <li>
              <strong>Health data (ABDM)</strong> — zero persistence. FHIR
              records flow through memory only; never written to disk.
            </li>
          </ul>
        </section>

        <section id="pp-7">
          <h2>Your rights</h2>
          <p>
            Under the DPDP Act 2023 and GDPR (where applicable), you have the
            right to:
          </p>
          <ul>
            <li>
              <strong>Access</strong> the personal data we hold about you and
              obtain a copy;
            </li>
            <li>
              <strong>Correction</strong> of inaccurate or incomplete data;
            </li>
            <li>
              <strong>Erasure</strong> of data that is no longer necessary or
              processed unlawfully;
            </li>
            <li>
              <strong>Withdraw consent</strong> at any time, with effect going
              forward;
            </li>
            <li>
              <strong>Nominate</strong> an individual to exercise rights on
              your behalf in the event of incapacity or death;
            </li>
            <li>
              <strong>Grievance redress</strong> — contact our grievance
              officer (Section 12) and escalate to the Data Protection Board
              where applicable.
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{' '}
            <strong>privacy@consentshield.in</strong>. We respond within 30
            days (DPDP) or one month (GDPR) of verified request.
          </p>
        </section>

        <section id="pp-8">
          <h2>Security</h2>
          <ul>
            <li>
              <strong>Encryption</strong> — TLS 1.3 in transit; AES-256 at
              rest for buffer tables and customer storage (customer-held keys
              in Insulated and Zero-Storage modes).
            </li>
            <li>
              <strong>Access control</strong> — multi-tenant isolation
              enforced at the database layer, not solely in application code.
              Isolation is verified by policy, not relying on code review
              alone.
            </li>
            <li>
              <strong>Authentication</strong> — SSO, MFA, and magic-link
              login. Internal service credentials are scoped and rotated on a
              defined schedule.
            </li>
            <li>
              <strong>Vulnerability management</strong> — quarterly external
              pentest; continuous dependency scanning; vulnerability disclosure
              programme.
            </li>
            <li>
              <strong>Incident response</strong> — 72-hour DPDP notification
              and 6-hour RBI notification timelines where applicable.
            </li>
          </ul>
        </section>

        <section id="pp-9">
          <h2>International transfers</h2>
          <p>
            ConsentShield&apos;s primary infrastructure runs in India. Some
            sub-processors (Cloudflare edge, Supabase regional replicas) may
            process data in jurisdictions outside India subject to appropriate
            safeguards. For transfers out of the European Economic Area, we
            rely on Standard Contractual Clauses. For DPDP purposes, we do not
            transfer personal data to jurisdictions notified by the Central
            Government as restricted.
          </p>
        </section>

        <section id="pp-10">
          <h2>Children&apos;s data</h2>
          <p>
            The ConsentShield platform is not intended for users under 18
            (DPDP definition of &ldquo;child&rdquo;). We do not knowingly
            collect personal data from children directly. Where our customer
            operates an edtech or children-facing product, we process
            children&apos;s data only as a Data Processor on behalf of that
            customer, and only under the DPDP&apos;s specific child data
            provisions — including absence of behavioural advertising and
            verifiable parental consent where applicable.
          </p>
        </section>

        <section id="pp-11">
          <h2>Changes</h2>
          <p>
            We may update this Privacy Policy periodically. Material changes
            will be communicated by email to Customer Users and by banner
            notice on consentshield.in at least 30 days before they take
            effect. The current version and effective date are shown at the
            top of this page.
          </p>
        </section>

        <section id="pp-12">
          <h2>Grievance officer</h2>
          <p>
            Under DPDP Rule 5, we have designated a Data Protection Officer /
            Grievance Officer:
          </p>
          <div className="legal-contact-block">
            <h3>Grievance contact</h3>
            <div className="legal-contact-row">
              <span className="label">Officer</span>
              <span>
                <strong>To be appointed</strong> prior to platform launch
              </span>
            </div>
            <div className="legal-contact-row">
              <span className="label">Email</span>
              <span>
                <strong>privacy@consentshield.in</strong>
              </span>
            </div>
            <div className="legal-contact-row">
              <span className="label">Response SLA</span>
              <span>
                Acknowledgement within 48 hours; resolution within 30 days
              </span>
            </div>
            <div className="legal-contact-row">
              <span className="label">Escalation</span>
              <span>
                The Data Protection Board of India —{' '}
                <a
                  href="https://www.meity.gov.in"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  www.meity.gov.in
                </a>
              </span>
            </div>
          </div>
          <p style={{ marginTop: 20 }}>
            For EEA / UK Data Principals, our EU Representative contact will be
            listed here following appointment under Article 27 GDPR.
          </p>
        </section>
      </LegalLayout>
    </main>
  )
}
