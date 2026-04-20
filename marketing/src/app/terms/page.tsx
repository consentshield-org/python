import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalLayout } from '@/components/sections/legal-layout'
import { ROUTES } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Terms of Service · ConsentShield',
  description:
    'ConsentShield Terms of Service. Read in tandem with the Data Processing Agreement and Privacy Policy.',
}

export default function TermsPage() {
  return (
    <main id="page-terms">
      <LegalLayout
        title="Terms of Service."
        lede="The contract under which ConsentShield provides the ConsentShield platform. Read in tandem with the Data Processing Agreement and Privacy Policy."
        meta={[
          { label: 'Effective', value: '15 April 2026' },
          { label: 'Last updated', value: '15 April 2026' },
          { label: 'Governing law', value: 'India' },
          { label: 'Version', value: 'v1.0' },
        ]}
        tocItems={[
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
        ]}
      >
        <section id="terms-1">
          <h2>Acceptance &amp; parties</h2>
          <p>
            These Terms of Service form a binding contract between{' '}
            <strong>ConsentShield</strong>, based in Hyderabad, Telangana,
            India (&ldquo;<strong>ConsentShield</strong>&rdquo;, &ldquo;we&rdquo;,
            &ldquo;our&rdquo;), and the entity or individual identified on the
            order form or in the online signup flow (&ldquo;
            <strong>Customer</strong>&rdquo;, &ldquo;you&rdquo;). By creating an
            account, accepting an order form, or using the platform, you agree
            to these Terms.
          </p>
          <p>
            If you are signing on behalf of an organisation, you represent that
            you have authority to bind it. The platform is not intended for use
            by individuals acting in a personal, non-commercial capacity.
          </p>
        </section>

        <section id="terms-2">
          <h2>The service</h2>
          <p>
            ConsentShield provides a B2B SaaS compliance platform (&ldquo;
            <strong>the Service</strong>&rdquo;) comprising DEPA-native consent
            management, tracker enforcement monitoring, rights workflow
            management, artefact-scoped deletion orchestration, audit export,
            and related capabilities described at{' '}
            <Link href={ROUTES.product.href}>consentshield.in/product</Link>.
          </p>
          <h3>Operating model</h3>
          <p>
            ConsentShield operates as a stateless compliance oracle. The
            Customer&apos;s canonical compliance record — the artefact register,
            consent logs, rights request history, and audit trail — is written
            to Customer-controlled storage. ConsentShield does not hold the
            canonical record.
          </p>
          <h3>Availability</h3>
          <p>
            Target platform availability is 99.9% measured monthly, excluding
            scheduled maintenance windows communicated 72 hours in advance. SLA
            credits apply as set out in the Enterprise order form where
            applicable.
          </p>
        </section>

        <section id="terms-3">
          <h2>Subscription &amp; billing</h2>
          <p>
            Subscriptions are offered in monthly and annual terms. Pricing is
            as set out in the applicable order form or on the{' '}
            <Link href={ROUTES.pricing.href}>pricing page</Link>. Fees are
            exclusive of GST and other applicable taxes.
          </p>
          <ul>
            <li>
              <strong>Monthly plans</strong> renew automatically on the
              subscription anniversary date. Cancel any time; cancellation
              takes effect at the end of the current billing period.
            </li>
            <li>
              <strong>Annual plans</strong> renew automatically and receive a
              20% discount over monthly billing. Cancellation takes effect at
              the end of the annual term; no mid-term refunds.
            </li>
            <li>
              <strong>Enterprise</strong> and <strong>BFSI specialist</strong>{' '}
              pricing is set per order form. Payment terms default to 30 days
              from invoice.
            </li>
          </ul>
          <div className="legal-note">
            <strong>Late payment.</strong> Overdue amounts accrue interest at
            1.5% per month (or the maximum permitted by law, whichever is
            lower). Service may be suspended — not terminated — after 15 days
            of non-payment; Customer Data export remains available during
            suspension.
          </div>
        </section>

        <section id="terms-4">
          <h2>Customer data</h2>
          <p>
            Customer Data means any data — including personal data of Data
            Principals — that Customer or Customer&apos;s end users provide to,
            or that is processed through, the Service.
          </p>
          <h3>Roles under the DPDP Act 2023</h3>
          <p>
            In respect of personal data of Data Principals processed through
            the Service, the Customer is the <strong>Data Fiduciary</strong>{' '}
            and ConsentShield is the <strong>Data Processor</strong>. The Data
            Processing Agreement (DPA) — incorporated by reference — governs
            the Processor relationship.
          </p>
          <h3>Ownership</h3>
          <p>
            Customer retains all right, title, and interest in Customer Data.
            ConsentShield obtains only the limited rights needed to provide
            the Service in accordance with the DPA and these Terms.
          </p>
        </section>

        <section id="terms-5">
          <h2>Acceptable use</h2>
          <p>
            Customer will not, and will not permit any third party to:
          </p>
          <ul>
            <li>
              Use the Service to process personal data without a lawful basis
              under the DPDP Act or other applicable law;
            </li>
            <li>
              Attempt to reverse-engineer, decompile, or extract the source
              code of the Service, except as expressly permitted by law;
            </li>
            <li>
              Use the Service to transmit malware, phishing content, or
              material that infringes third-party intellectual property;
            </li>
            <li>
              Submit load testing, penetration testing, or synthetic traffic in
              excess of documented plan limits without written consent;
            </li>
            <li>
              Use the Service to collect or process children&apos;s data
              without appropriate verifiable parental consent mechanisms;
            </li>
            <li>
              Attempt to circumvent the consent banner enforcement mechanisms
              of the Service on the Customer&apos;s own properties.
            </li>
          </ul>
        </section>

        <section id="terms-6">
          <h2>Intellectual property</h2>
          <p>
            The Service — including the platform, the DEPA-native consent
            artefact schema, the tracker signature database, and all
            underlying software — is owned by ConsentShield and protected by
            applicable intellectual property law. These Terms grant Customer a
            non-exclusive, non-transferable, revocable right to use the Service
            for Customer&apos;s internal business purposes during the
            subscription term.
          </p>
          <p>
            Customer grants ConsentShield a limited right to use Customer&apos;s
            name and logo in a customer list on consentshield.in, subject to
            opt-out by written notice.
          </p>
        </section>

        <section id="terms-7">
          <h2>Warranties &amp; disclaimers</h2>
          <p>
            The Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo; basis. To the maximum extent permitted by
            applicable law, ConsentShield makes no warranties of any kind —
            whether express, implied, statutory, or otherwise — including any
            implied warranties of merchantability, fitness for a particular
            purpose, title, non-infringement, accuracy, uninterrupted or
            error-free operation, or that the Service will meet Customer&apos;s
            specific requirements.
          </p>
          <p>
            Any availability targets, response-time targets, or similar
            commitments set out in an Enterprise order form operate as
            service-credit mechanisms only; service credits are Customer&apos;s
            sole and exclusive remedy for any failure to meet such targets, and
            are not warranties.
          </p>
          <p>
            <strong>
              ConsentShield is software; it is not legal advice.
            </strong>{' '}
            All templates — privacy notices, DPAs, sub-processor lists — carry
            prominent disclaimers and should be reviewed by Customer&apos;s
            legal counsel before deployment.
          </p>
          <div className="legal-note">
            <strong>
              Compliance outcomes are the Customer&apos;s responsibility.
            </strong>{' '}
            ConsentShield provides the infrastructure that makes DPDP
            compliance achievable and demonstrable. Customer remains the Data
            Fiduciary and bears ultimate responsibility for its compliance
            posture. The DPO-as-a-Service partner, where engaged through the
            ConsentShield marketplace, carries professional-advisory liability;
            ConsentShield carries software liability only, subject to Section
            8.
          </div>
        </section>

        <section id="terms-8">
          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by applicable law,
            ConsentShield&apos;s aggregate liability to Customer arising out of
            or related to these Terms and the Service — whether in contract,
            tort, statute, or any other theory, and{' '}
            <strong>
              including any indemnification obligations under Section 9
            </strong>{' '}
            — will not exceed the total fees paid by Customer to ConsentShield
            in the twelve months preceding the event giving rise to the claim.
          </p>
          <p>
            Neither party will be liable for indirect, incidental, special,
            consequential, exemplary, or punitive damages — including lost
            profits, lost revenue, loss of data, loss of goodwill, or business
            interruption — even if advised of the possibility of such damages.
          </p>
          <p>
            These limitations do not apply (i) where limitation is prohibited
            by applicable law — including in respect of fraud or gross
            negligence — or (ii) to Customer&apos;s obligation to pay fees
            owed for the Service.
          </p>
          <div className="legal-note">
            <strong>Worked example.</strong> A Customer on the ₹2,999/month
            plan for three months has paid ₹8,997 in total fees. If a claim
            arose at that point, ConsentShield&apos;s total liability — across
            all theories and including any IP-indemnity obligation — would be
            capped at ₹8,997. The cap scales with the commercial relationship
            and cannot create exposure disproportionate to fees received.
          </div>
        </section>

        <section id="terms-9">
          <h2>Indemnification</h2>
          <p>
            <strong>By ConsentShield.</strong> Subject to the liability cap in
            Section 8, ConsentShield will defend Customer against any
            third-party claim alleging that the Service, as provided and used
            in accordance with the documentation, infringes third-party
            intellectual property rights, and will pay damages finally awarded
            against Customer in respect of such claim. ConsentShield&apos;s
            obligation under this paragraph — together with all other liability
            to Customer — is capped at the amount stated in Section 8.
          </p>
          <p>
            <strong>By Customer.</strong> Customer will defend ConsentShield
            against any third-party claim arising from (i) Customer Data, (ii)
            Customer&apos;s use of the Service in breach of these Terms, or
            (iii) Customer&apos;s failure to obtain lawful consent for the
            personal data processed through the Service.
          </p>
        </section>

        <section id="terms-10">
          <h2>Termination</h2>
          <p>
            Either party may terminate for material breach unremedied 30 days
            after written notice. Customer may terminate monthly subscriptions
            at the end of any billing period; annual subscriptions at the end
            of the annual term.
          </p>
          <p>
            <strong>Effect of termination.</strong> ConsentShield will retain
            Customer Data for 30 days post-termination to allow export. After
            30 days, ConsentShield will delete its copies of Customer Data in
            accordance with the DPA. The canonical record residing in
            Customer-controlled storage is not affected by termination.
          </p>
        </section>

        <section id="terms-11">
          <h2>Governing law</h2>
          <p>
            These Terms are governed by the laws of India. Any dispute will be
            submitted to the exclusive jurisdiction of the courts of Hyderabad,
            Telangana, except either party may seek interim relief in any
            competent court. For disputes exceeding INR 50,00,000, the parties
            will first attempt good-faith resolution through the Arbitration
            and Conciliation Act 1996 (Indian seat; Hyderabad venue) before
            commencing litigation.
          </p>
        </section>

        <section id="terms-12">
          <h2>Changes &amp; contact</h2>
          <p>
            ConsentShield may update these Terms with 30 days&apos; advance
            notice by email to the Customer&apos;s primary admin and by banner
            notice in the platform. Material changes to pricing, liability, or
            data handling require express Customer acceptance.
          </p>
          <div className="legal-contact-block">
            <h3>Contact</h3>
            <div className="legal-contact-row">
              <span className="label">Legal notices</span>
              <span>
                <strong>legal@consentshield.in</strong>
              </span>
            </div>
            <div className="legal-contact-row">
              <span className="label">General</span>
              <span>
                <strong>hello@consentshield.in</strong>
              </span>
            </div>
          </div>
        </section>
      </LegalLayout>
    </main>
  )
}
