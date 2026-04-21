# ConsentShield — Customer-Side Integration

## A Technical White Paper for CTOs, CISOs, and Enterprise Architects

*Version 1.0 · April 2026*
*Audience: Technical decision-makers evaluating ConsentShield for DPDP compliance*
*Companion to: ConsentShield Master Design Document · BFSI Segment Brief · DEPA-Banking Bridge*

---

## Executive Summary

ConsentShield is the DPDP consent and rights infrastructure for regulated Indian enterprises. This paper answers the single question a technical buyer needs answered before a procurement conversation can proceed: **what does integration actually look like on my side?**

The short answer is that integration has four distinct surfaces, each solving a specific class of problem. A customer does not pick between them — they pick which surfaces they need based on what their architecture looks like and what regulatory outcome they are trying to produce.

| Surface | Direction | Purpose | Typical integration effort |
|---|---|---|---|
| **1. Consent capture** | Customer → ConsentShield | Collect DPDP-compliant consent from the data principal | 10 minutes (web) · 2–5 days (mobile SDK) |
| **2. Consent verification** | Customer → ConsentShield | Server-side check that consent exists before acting on data | 1–3 days per calling system |
| **3. Deletion orchestration** | ConsentShield → Customer's downstream systems | Propagate revocation and erasure to every system holding the data | 1 hour (pre-built) to 2 weeks (custom connector) |
| **4. Operational notifications** | ConsentShield → Customer's ops channel | Alert on violations, rights requests, SLA breaches | 15 minutes |

For a typical SaaS customer, only Surface 1 is required to go live. A script tag in the `<head>` produces DPDP-compliant consent artefacts and moves the organisation from non-compliant to compliant on the consent capture obligation.

For a BFSI customer with bancassurance partners, co-lending fintechs, and credit bureau reporting, all four surfaces are required — and the architectural choice between them determines whether a DPB examiner will accept the bank's answer to the question *"on 10 March 2026, what data was deleted from which system with what confirmation?"*

This paper walks through each surface, provides reference architectures for four customer archetypes, and closes with a worked end-to-end example. A companion appendix lists the complete API surface, webhook payload specifications, and pre-built connector catalogue.

---

## 1. Integration Philosophy

Every DPDP consent tool sold in India makes one of two integration assumptions.

**The first assumption — universal at GDPR-adapted tools — is that integration is a cookie banner plus a preferences page.** This solves the *consent capture* problem and declares the rest out of scope. The customer's internal systems never check consent. The customer's third-party partners never receive revocation instructions. Erasure requests are emails forwarded to the customer's inbox. A DPB examination will produce the answer *"we have a consent banner."*

**The second assumption — universal at enterprise GRC platforms — is that integration is a six-month professional services engagement.** This produces a genuine outcome but at a cost that only large enterprises can absorb, and with a timeline that misses the DPDP enforcement window entirely.

ConsentShield rejects both assumptions. Integration is modular. A customer integrates at exactly the level of maturity their architecture supports — and no more. The four surfaces can be picked up in any order, and each one independently improves the customer's DPDP posture.

**The consequence of this philosophy is the architectural property that matters most to a technical buyer:** integration is never all-or-nothing. A customer can install the banner tomorrow and be compliant on consent capture. They can add server-side verification in quarter two when their engineering roadmap has room. They can wire the bancassurance partner connector when the partner contract is renegotiated to include a deletion endpoint. Each step produces a DPDP outcome that stands on its own.

---

## 2. Surface 1 — Consent Capture

Consent capture is how the data principal's permission becomes a DPDP-compliant artefact in the customer's compliance record. There are three integration modes, corresponding to three customer deployment shapes.

### 2.1 Mode A — Web Banner (Script Tag)

The default integration for any web property.

```html
<script src="https://cdn.consentshield.in/v1/banner.js"
        data-org="org_7H3K..."
        data-property="prop_BQ2X..."
        async></script>
```

**What the customer does:**
1. Signs up and completes a 7-step onboarding wizard (≈ 10 minutes)
2. Configures banner copy and purposes in the dashboard
3. Pastes the script tag into the site's `<head>`
4. ConsentShield auto-detects the snippet on first page load

**What happens at runtime:**
- Banner is served from Cloudflare's edge in under 50 ms
- On user interaction, one consent artefact per purpose is written (not one event with an array of purposes — see the DEPA Architecture companion)
- Each artefact has a stable `cs_art_` ID, declared data scope, expiry date, and is append-only

**What this does not do on its own:**
- It does not stop your marketing team's tag manager from firing pixels before consent
- It does not propagate revocation to your downstream systems
- It does not gate server-side data processing

These are Surfaces 2 and 3. The banner captures consent; the other surfaces enforce it.

**CMS variants:** For WordPress, Shopify, Webflow, Wix, Framer, and Squarespace, the same snippet is delivered as a platform plugin to keep installation inside the customer's CMS workflow. Payload and data model are identical.

### 2.2 Mode B — Mobile SDK (iOS, Android)

For customers whose primary user touchpoint is a mobile app — digital NBFCs, broking platforms, neo-banks, healthcare apps.

```swift
// iOS — Swift
import ConsentShield

let cs = ConsentShield.configure(
    orgId: "org_7H3K...",
    propertyId: "prop_ios_BQ2X...",
    environment: .production
)

// Request consent at the moment of use
let result = await cs.requestConsent(
    purpose: .contactListAccess,
    dataScope: ["contact_name", "contact_number"],
    context: .loanOriginationFlow
)

if result.granted {
    proceedWithContactListUpload(artefactId: result.artefactId)
}
```

```kotlin
// Android — Kotlin
val cs = ConsentShield.configure(
    orgId = "org_7H3K...",
    propertyId = "prop_android_BQ2X...",
    environment = Environment.PRODUCTION
)

val result = cs.requestConsent(
    purpose = Purpose.LOCATION_ACCESS,
    dataScope = listOf("latitude", "longitude", "accuracy"),
    context = Context.DELIVERY_TRACKING
)

if (result.granted) {
    proceedWithLocationCapture(artefactId = result.artefactId)
}
```

**What the SDK handles:**
- DPDP-compliant consent notice rendering (native UIKit / Jetpack Compose components, customer-themeable)
- Artefact generation at the moment of Android runtime permission grant (contact list, location, camera, microphone)
- Purpose-specific consent flows in loan origination, account opening, KYC, and in-app marketing
- Offline queuing with background sync when the device is online
- Artefact revocation via in-app preferences centre

**Platform coverage:**
- iOS 14+ (Swift 5.5+)
- Android API 24+ (Kotlin 1.8+)
- React Native and Flutter bridges (Phase 2 deliverable — available as a custom engagement before the general release)

**Integration effort:** Typically 2–5 engineer-days for an experienced mobile team, including QA of consent flows in the customer's onboarding journey.

### 2.3 Mode C — Custom UI via Consent API

For customers with a consent flow that cannot be rendered by the banner or the mobile SDK — for example, a call-centre agent capturing telephonic consent on behalf of a data principal, a kiosk application, or an in-person account-opening flow with a tablet and signature pad.

```bash
POST https://api.consentshield.in/v1/consent/record
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "property_id": "prop_kiosk_XYZ",
  "data_principal": {
    "identifier": "9876543210",
    "identifier_type": "mobile_number"
  },
  "purposes": [
    { "purpose_code": "account_opening", "granted": true },
    { "purpose_code": "bureau_reporting", "granted": true },
    { "purpose_code": "insurance_marketing", "granted": false },
    { "purpose_code": "whatsapp_marketing", "granted": true }
  ],
  "captured_via": "branch_kiosk",
  "captured_by": "agent_emp_12345",
  "notice_version": "notice_v_2026_01",
  "captured_at": "2026-04-19T10:15:33Z"
}
```

ConsentShield returns one artefact ID per granted purpose. The customer stores these IDs against their account record.

**This is the escape hatch.** Any consent capture interaction the customer needs to instrument can be recorded through this endpoint, and the resulting artefacts behave identically to those produced by the banner or the mobile SDK.

---

## 3. Surface 2 — Consent Verification

The consent artefact is the evidence of permission. Consent *verification* is the runtime check, made by the customer's own systems, that asks: *"Is this purpose currently authorised for this data principal?"*

This is the surface that separates **recorded** compliance from **enforced** compliance. Without verification, the marketing engine can send an SMS campaign to a user who revoked marketing consent yesterday; the consent record will show the revocation, but the outbound SMS already went out. The examiner finding is not *"you failed to record revocation"* — it is *"you acted on data after consent was withdrawn."* The second is materially worse.

### 3.1 The Verification Endpoint

```bash
GET https://api.consentshield.in/v1/consent/verify
     ?property_id=prop_core_banking
     &data_principal_identifier=customer_id_987654
     &identifier_type=internal_customer_id
     &purpose_code=insurance_marketing
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
```

```json
{
  "data_principal_identifier": "customer_id_987654",
  "purpose_code": "insurance_marketing",
  "status": "revoked",
  "active_artefact_id": null,
  "revoked_at": "2026-03-10T14:05:33Z",
  "revocation_record_id": "rev_01HXX7",
  "last_valid_artefact_id": "cs_art_01HXX2",
  "evaluated_at": "2026-04-19T10:15:33.445Z"
}
```

Sub-50 ms p99 latency, served from the `consent_artefact_index` validity cache. Safe to call synchronously from any server-side process.

### 3.2 Where Customers Call This

Every system in the customer's architecture that takes an action on behalf of a user needs a verification call at the point of action. A non-exhaustive list:

| Customer system | When to call | Purpose code typically checked |
|---|---|---|
| Marketing campaign engine | Before adding a user to a campaign cohort | `whatsapp_marketing`, `email_marketing`, `sms_marketing` |
| Underwriting API (NBFC) | Before passing data to the scoring model | `credit_scoring`, `bureau_inquiry` |
| Insurance cross-sell batch job | Before sharing the daily data file with the bancassurance partner | `insurance_marketing` |
| Analytics ingestion | Before writing the event to Mixpanel/CleverTap | `analytics` |
| Push notification service | Before sending any non-transactional push | `push_marketing` |
| Contact-list sync (NBFC collections) | Before reading the user's contact list | `contact_list_access` |
| Co-lending data share | Before the nightly partner reconciliation | `co_lending_partner` |

### 3.3 Batch Verification

For bulk operations — marketing segment builds, nightly partner data files, bureau reporting runs — verification can be batched:

```bash
POST https://api.consentshield.in/v1/consent/verify/batch
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx

{
  "property_id": "prop_core_banking",
  "purpose_code": "insurance_marketing",
  "data_principal_identifiers": [
    { "identifier": "customer_id_987654", "type": "internal_customer_id" },
    { "identifier": "customer_id_987655", "type": "internal_customer_id" },
    ...
  ]
}
```

Returns an array of statuses. Up to 10,000 identifiers per call. This is how a bank's nightly bancassurance reconciliation job filters its recipient list before transmission.

### 3.4 Failure Modes and Fail-Safes

The verification endpoint has three failure modes; the customer integration must handle each:

| Failure | Customer system behaviour | Rationale |
|---|---|---|
| `status: granted` | Proceed | Normal path |
| `status: revoked` or `expired` | Do not proceed; log the suppression | Normal path |
| API unreachable (timeout, 5xx) | Do not proceed; log the failure; alert ops | Fail-closed on consent verification is the correct DPDP posture |

The ConsentShield client libraries (Node, Python, Java, Go) ship with a default 2-second timeout and fail-closed behaviour. This is deliberate. A customer who chooses to override this (e.g., *"if ConsentShield is down, default to granted"*) is making an explicit compliance trade-off and we require them to configure it with a named flag.

---

## 4. Surface 3 — Deletion Orchestration

When a data principal revokes consent for a specific purpose — or submits an erasure request — the customer's obligation under DPDP Section 6 and Section 12 is to actually delete the data from every system that holds it. This is the hard part of DPDP. Every downstream system the customer has integrated with over the last decade now needs to be instructed to delete a specific user's data on demand, with a deletion receipt that can be shown to a DPB examiner.

ConsentShield provides three models for doing this, which the customer mixes and matches based on the nature of each downstream system.

### 4.1 Model A — Pre-Built OAuth Connectors

For well-known SaaS tools with documented deletion APIs, ConsentShield ships direct integrations.

**Setup flow:**
1. Customer goes to Integrations in the dashboard
2. Clicks Connect on the target service (e.g., Mailchimp)
3. OAuth redirect to the service's auth page
4. User authorises ConsentShield with delete-user scope
5. OAuth token stored encrypted in ConsentShield's vault, scoped to that organisation
6. Connector is now active

**At runtime:** when a deletion is orchestrated, ConsentShield calls the service's API directly (e.g., `DELETE /lists/{id}/members/{hash}`) and records the response as a `deletion_receipt` row. No webhook on the customer's side.

**Available connectors (as of April 2026):**

| Category | Services |
|---|---|
| Email marketing | Mailchimp, Campaign Monitor |
| CRM | HubSpot, Zoho CRM, Freshworks CRM |
| Support & helpdesk | Freshdesk, Intercom, Zendesk *(Phase 3)* |
| Engagement / push | CleverTap, WebEngage, MoEngage |
| E-commerce | Shopify, WooCommerce |
| Payments | Razorpay *(anonymisation, not deletion — PMLA retention)* |
| Analytics | Segment, Mixpanel *(Phase 3)* |

**Integration effort per connector:** one click. Integration effort to add a new pre-built connector to the product (if a customer's requested service is not yet on the list): 2–3 engineer-days on the ConsentShield side, at no cost to the customer.

### 4.2 Model B — Generic Webhook Protocol

For every other system — the customer's core banking platform, internal CRM, data warehouse, reconciliation files, regulatory reporting systems, or any partner vendor without a pre-built connector — the generic webhook protocol is the universal interface.

**The customer implements one HTTP endpoint.** That endpoint receives deletion requests from ConsentShield, performs the deletion inside the customer's system, and posts a confirmation back.

**Request from ConsentShield:**

```http
POST https://customer-api.bank.in/privacy/deletion-request
Content-Type: application/json
X-ConsentShield-Signature: sha256=... (HMAC of body with shared secret)

{
  "event": "deletion_request",
  "request_id": "del_req_01HXX8",
  "data_principal": {
    "identifier": "customer_id_987654",
    "identifier_type": "internal_customer_id"
  },
  "reason": "consent_withdrawn",
  "source_artefact_id": "cs_art_01HXX2",
  "data_scope": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "purpose_code": "insurance_marketing",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/del_req_01HXX8",
  "deadline": "2026-05-09T14:05:33Z",
  "issued_at": "2026-03-10T14:05:35Z"
}
```

**Customer's callback to ConsentShield** (posted when deletion is complete):

```http
POST https://api.consentshield.in/v1/deletion-receipts/del_req_01HXX8
Content-Type: application/json
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx

{
  "request_id": "del_req_01HXX8",
  "status": "completed",
  "records_deleted": 1,
  "fields_deleted": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "systems_affected": ["bancassurance_partner_prod", "bancassurance_partner_replica"],
  "completed_at": "2026-03-10T14:07:12Z",
  "operator": "system_auto",
  "evidence_reference": "partner_ref_XYZ123"
}
```

**Partial completion, failure, and statutory-retention responses:**

```json
{
  "status": "partial",
  "records_deleted": 1,
  "fields_deleted": ["email_address", "name"],
  "fields_retained": ["dob", "account_type"],
  "retention_reason": "Required for pending insurance policy underwriting — statutory",
  "retention_statute": "Insurance Act 1938 § 64VB",
  "completed_at": "2026-03-10T14:07:12Z"
}
```

ConsentShield normalises partial and retention responses into the `deletion_receipt` record and surfaces them on the customer's compliance dashboard and in audit exports. A DPB examiner reviewing the record sees exactly what was deleted, what was retained, and why — with a statutory citation.

**Security properties:**
- Every request is signed with an HMAC-SHA256 of the body using a shared secret established at connector setup. The customer's endpoint must verify the signature before processing.
- All callbacks are authenticated with the customer's `cs_live_` API key.
- Deletion request IDs are single-use. A replayed callback is rejected.
- The `deadline` field is binding. If the callback is not received by the deadline, the request transitions to `overdue`, an alert fires, and the DPB-facing audit export flags the missed SLA.

**Integration effort:** 1–2 engineer-days for a customer team to implement the webhook endpoint in their internal API layer, plus whatever effort is needed inside the customer's architecture to execute the actual deletion across their downstream systems.

### 4.3 Model C — File-Based Reconciliation (Legacy Downstream)

Some customer systems cannot accept real-time deletion requests. Classic examples: a legacy mainframe, a third-party partner that only accepts a nightly CSV, an insurance partner whose data-sharing is contractually a monthly reconciliation.

For these cases, ConsentShield generates a daily deletion instruction file (CSV or JSON-lines) in a format the downstream system accepts, deposits it in a customer-configured SFTP or S3 bucket, and waits for an attested reconciliation report in return.

**This is a degraded enforcement mode.** Deletion lag is measured in days, not seconds. The deletion receipt is based on attestation, not live confirmation. Customers using this mode must disclose the lag in their privacy notice and to the DPB examiner on request.

Where possible, customers should push their partners toward webhook adoption. Where not possible, the file-based mode exists so that these data flows are at least compliant, rather than being excluded from the consent architecture and producing silent violations.

---

## 5. Surface 4 — Operational Notifications

The fourth integration surface is operational, not data-plane. ConsentShield needs to alert the customer's compliance and engineering teams when specific events occur. This is set up once and forgotten.

| Channel | Setup effort | Use |
|---|---|---|
| Email | 0 (default) | Compliance officer, DPO |
| Slack incoming webhook | 5 minutes | Engineering on-call channel |
| Microsoft Teams webhook | 5 minutes | Compliance team channel |
| PagerDuty / OpsGenie | 10 minutes | Production incident routing |
| Custom webhook | 15 minutes | Customer's internal alerting system |

**Alert types (each independently routable per channel):**

- Tracker violation detected
- New rights request received (access, correction, erasure, nomination)
- SLA warning: 7 days remaining on a rights request
- SLA overdue
- Consent withdrawal verification failure (tracker continued firing after revocation)
- Security scan: new critical finding on monitored property
- Retention period expired on a data category
- Deletion orchestration failure
- Consent probe failure
- Daily compliance score summary

---

## 6. Reference Architectures

Four archetypes, covering the spectrum from lightweight SaaS to a full private-bank deployment.

### 6.1 Pure Web SaaS (e.g., B2B SaaS Startup, ₹2K–₹10K/month tier)

```
[user's browser]
        │
        │ loads page
        ▼
[customer's web app (Vercel / AWS / GCP)]
        │
        │  <script src="cdn.consentshield.in/v1/banner.js">
        ▼
[ConsentShield CDN] ──── consent events ───► [ConsentShield]
                                                 │
                                                 │ deletion orchestration
                                                 ▼
                           [Mailchimp · HubSpot · Intercom]  ← pre-built OAuth connectors
```

- Surfaces used: 1 (banner), 3 (OAuth connectors)
- Integration effort: 1 day
- Compliance outcome: full consent capture, automatic deletion across the top 3–5 SaaS tools the startup uses

### 6.2 Mobile-First Digital NBFC (BFSI Growth tier, ~₹18K/month)

```
[user's iOS / Android app]
         │
         │ ConsentShield Mobile SDK
         ▼
[customer's mobile backend (AWS / on-prem)]
         │                                     │
         │  Surface 2: consent verification    │
         ▼                                     ▼
[ConsentShield] ◄── verify before lending    [underwriting API]
       │
       │  Surface 3: deletion orchestration
       ▼
[core lending system]        ← generic webhook
[CleverTap · MoEngage]       ← pre-built connectors
[collections partner]        ← generic webhook
[bureau: CIBIL / Experian]   ← does not receive deletion (statutory exemption)
```

- Surfaces used: 1 (mobile SDK), 2 (verification on every lending decision), 3 (mix of webhooks and connectors), 4 (PagerDuty for SLA alerts)
- Integration effort: 2–3 weeks total including mobile QA
- Compliance outcome: DPDP-compliant at the moment of Android runtime permission grant; statutory retention correctly handled for bureau data; contact-list collection backstop closed

### 6.3 Private Bank with Bancassurance (BFSI Enterprise tier, ₹40K+/month)

```
[account opening — branch or digital channel]
         │
         │  Surface 1: Mode C (custom UI via API) OR web banner OR mobile SDK
         ▼
[ConsentShield — 5 artefacts created]
         │
         │  Surface 2: verification called by each downstream
         ▼
    ┌────┼────────────────────────────────────┐
    │    │                                     │
    ▼    ▼                                     ▼
[core banking: Finacle / FLEXCUBE]   [marketing engine]   [treasury / trade finance]
    │                                    │
    │   Surface 3: deletion orchestration │
    ▼                                    ▼
[bancassurance partner]     ← generic webhook — field-level DELETE
[co-lending fintech]        ← generic webhook — bidirectional, Regulatory Exemption Engine
[CIBIL / Experian / CRIF]   ← statutory retention — no deletion triggered
[WhatsApp Business]         ← pre-built connector
[Firebase / Mixpanel]       ← pre-built connectors
```

- Surfaces used: all four, comprehensively
- Integration effort: 6–10 weeks for a phased rollout
- Compliance outcome: surgical revocation that matches DPDP Section 6, full statutory-retention handling, DPB-defensible deletion receipts for every partner flow

**The architectural claim this delivers:** when the DPB examiner asks *"on 10 March 2026, when customer X withdrew insurance marketing consent, what was deleted from which system with what confirmation?"* — the bank's answer is a single artefact ID, a single revocation record, and a single deletion receipt. The question becomes a one-screen lookup in the compliance dashboard, not a forensic exercise.

### 6.4 Healthcare — Clinic with ABDM (Healthcare bundle, ₹5K–₹8K/month)

```
[clinic tablet — ABHA QR scan at patient check-in]
         │
         │ ConsentShield mobile SDK — ABDM + DPDP bundled consent
         ▼
[clinic EMR]
    │
    │  Surface 3: deletion orchestration
    ▼
[ABDM HIU/HIP federation layer]   ← healthcare bundle generic webhook
[clinic's EMR vendor]              ← pre-built connector (when vendor is onboarded)
[appointment reminder vendor]      ← CleverTap/WebEngage connector
```

Detailed in the ABDM Scope & Data Architecture companion.

---

## 7. Data Flow and Security

A technical buyer's next question is: *"what of my data crosses the wire, and what do you store?"*

### 7.1 What Data Crosses the Wire

From the customer's browser/app to ConsentShield's edge:
- A pseudonymous principal identifier (whatever the customer chooses — email hash, internal customer ID, mobile number hash)
- The purpose being consented to
- A notice version reference
- Browser fingerprint for fraud deterrence (standard user-agent string, no device fingerprinting)
- Timestamps

From ConsentShield to the customer's deletion endpoint:
- The principal identifier
- The data scope to be deleted
- The source artefact ID

**ConsentShield never receives the actual personal data.** ConsentShield does not see the customer's name, email body, transaction history, or any payload beyond identifiers and purpose codes. The data is held by the customer; ConsentShield holds the permission state for the data.

### 7.2 What ConsentShield Stores

ConsentShield's database is an **operational state store**, not a compliance record store. Consent events, revocations, deletion receipts, and audit logs are append-only. They are exported nightly to the customer's own storage (S3-compatible bucket or SFTP endpoint) as the durable compliance record.

This distinction matters architecturally: the ConsentShield database is a multi-tenant operational store with Postgres row-level security enforcing tenant isolation. The compliance record — the thing a DPB examiner will eventually inspect — lives in the customer's own storage under the customer's own keys. ConsentShield cannot unilaterally modify it.

### 7.3 Zero-Storage Mode (BFSI Enterprise Option)

For regulated customers for whom even pseudonymous principal identifiers are too much data to host in a third-party SaaS — private banks, insurance companies — ConsentShield offers a Zero-Storage deployment.

In this mode:
- The ConsentShield platform acts as a stateless oracle. It receives consent events, returns artefact IDs, and forgets them.
- All artefacts, revocations, and audit records are written directly to the customer's own Postgres (in their VPC or on-prem).
- ConsentShield's compliance API queries the customer's database via a signed connection when the dashboard needs to render data; no principal data is cached on ConsentShield infrastructure.

This mode makes ConsentShield architecturally equivalent to a payment gateway: the bank holds all the data, ConsentShield provides the processing. It is the deployment model that resolves RBI outsourcing guideline concerns for regulated BFSI customers.

**Zero-Storage mode is detailed in the Stateless Oracle Architecture companion and the DEPA Architecture companion.**

### 7.4 Transport Security

- TLS 1.3 on every surface, HSTS enforced, certificate pinning available for mobile SDK customers who request it.
- API keys are organisation-scoped, permission-scoped (`read:consent`, `write:deletion`, etc.), and revocable from the dashboard.
- Webhook payloads are HMAC-SHA256 signed; receiving systems must verify before processing.
- The ConsentShield Cloudflare Worker (banner delivery) has zero npm dependencies — vanilla TypeScript only, by policy, to eliminate supply-chain attack surface on the edge.

---

## 8. Integration Timeline and Effort

For typical customer archetypes, based on actual deployments.

### 8.1 Lightweight SaaS — 1 week

| Day | Activity |
|---|---|
| 1 | Sign up, onboarding wizard, data inventory answers, banner template selection |
| 1 | Paste script tag into production site `<head>` |
| 2 | Connect Mailchimp + HubSpot via OAuth |
| 3 | Configure Slack alert webhook |
| 4 | First compliance score generated; action queue addressed |
| 5 | First week of production monitoring; compliance score reviewed |

### 8.2 Mobile-First NBFC — 3 weeks

| Week | Activity |
|---|---|
| 1 | Web onboarding, banner deployed on landing/marketing site; data inventory completed; BFSI sector template configured |
| 2 | Mobile SDK integrated in iOS and Android app; consent flows instrumented in onboarding journey; QA |
| 2 | Server-side consent verification added to underwriting API and marketing campaign engine |
| 3 | Deletion orchestration: core lending system webhook + CleverTap connector + collections partner webhook |
| 3 | Regulatory Exemption Engine configured for RBI and PMLA retention categories |
| 3 | Ops alerts routed to PagerDuty |

### 8.3 Private Bank — 8 to 10 weeks

| Phase | Weeks | Activity |
|---|---|---|
| Foundation | 1–2 | BFSI Enterprise account setup; Zero-Storage deployment architecture agreed; Purpose Definition Registry populated with bank-specific purposes; statutory retention rules pre-loaded (RBI, PMLA, Banking Regulation Act, Credit Information Companies Act) |
| Capture | 3–4 | Digital channel integration (web + mobile SDK); branch channel custom API integration for account opening flow |
| Verification | 5–6 | Server-side consent verification wired into core banking batch jobs (marketing extract, bancassurance feed, co-lending data share, bureau reporting) |
| Orchestration | 6–8 | Deletion connectors: bancassurance partner (generic webhook with field-level scope), co-lending fintech (bidirectional webhook), internal CRM (generic webhook), WhatsApp Business (pre-built connector); file-based reconciliation for legacy systems where required |
| Cutover | 9–10 | Existing customer re-consent campaign; legacy T&C consent migrated to artefact model; compliance dashboard reviewed by bank's DPO; DPB-facing audit export dry-run |

---

## 9. Worked Example — Bancassurance Revocation End-to-End

This example is the most common complex scenario a BFSI customer will face. It ties together all four surfaces.

**Setup.** Mrs. Sharma opens an account at a private bank on 15 January 2025. At account opening, the ConsentShield banner (rendered inside the digital onboarding flow) captures five separate purposes. The bank's core banking system receives five artefact IDs and stores them against Mrs. Sharma's customer record.

```
cs_art_01HXX1  bureau_reporting        active  expires 2026-01-15
cs_art_01HXX2  insurance_marketing     active  expires 2026-01-15
cs_art_01HXX3  co_lending_fintech      active  expires 2026-01-15
cs_art_01HXX4  whatsapp_marketing      active  expires 2026-01-15
cs_art_01HXX5  analytics               active  expires 2026-01-15
```

**Operational baseline, weeks 1 through 60.** The bank's bancassurance engine runs a nightly job. Before it transmits the daily data file to the insurance partner, it calls `POST /v1/consent/verify/batch` with Mrs. Sharma and 12 million other customer IDs. The API returns a status per customer. Mrs. Sharma's status is `granted` for `insurance_marketing`. Her data is included in the file. The partner pulls the file and processes it.

**Revocation event — 10 March 2026.** Mrs. Sharma opens her banking app and withdraws consent for insurance marketing. The mobile SDK calls `POST /v1/consent/withdraw` with artefact ID `cs_art_01HXX2`.

**What happens next, in order:**

1. **Immutable revocation record written.** A row is inserted into `artefact_revocations` with the artefact ID, the timestamp, the reason (`user_request`), and a new revocation record ID (`rev_01HXX7`). The original artefact record is not mutated.

2. **Validity cache invalidated.** The entry for `cs_art_01HXX2` is removed from the `consent_artefact_index`. Any subsequent verification call returns `revoked`.

3. **Deletion orchestration triggered.** ConsentShield's orchestrator reads the artefact's `data_scope` field (`email_address`, `name`, `dob`, `account_type`, `nominee_name`) and its mapped connector (`bancassurance_partner_connector`). It issues a deletion request:

   ```json
   POST https://partner-api.insurance-co.in/privacy/deletion
   {
     "event": "deletion_request",
     "request_id": "del_req_01HXX8",
     "data_principal": { "identifier": "cust_987654", "type": "bank_customer_id" },
     "reason": "consent_withdrawn",
     "source_artefact_id": "cs_art_01HXX2",
     "data_scope": ["email_address", "name", "dob", "account_type", "nominee_name"],
     "purpose_code": "insurance_marketing",
     "callback_url": "https://api.consentshield.in/v1/deletion-receipts/del_req_01HXX8",
     "deadline": "2026-04-09T14:05:33Z"
   }
   ```

4. **Partner confirms.** The insurance partner's privacy endpoint deletes the specified fields for Mrs. Sharma and posts back:

   ```json
   POST https://api.consentshield.in/v1/deletion-receipts/del_req_01HXX8
   {
     "request_id": "del_req_01HXX8",
     "status": "completed",
     "records_deleted": 1,
     "fields_deleted": ["email_address", "name", "dob", "account_type", "nominee_name"],
     "completed_at": "2026-03-10T14:07:12Z"
   }
   ```

5. **Receipt recorded.** An immutable `deletion_receipt` row is written. It is exported to the bank's own S3 bucket overnight as part of the daily audit package.

6. **Other artefacts untouched.** `cs_art_01HXX1` (bureau reporting), `cs_art_01HXX3` (co-lending fintech), `cs_art_01HXX4` (WhatsApp), `cs_art_01HXX5` (analytics) remain `active`. CIBIL continues to receive Mrs. Sharma's repayment data — this is a statutory obligation. The co-lending fintech continues to receive her loan-servicing data. The analytics platform continues to track her app behaviour. Only the bancassurance partner's records are purged, and only the five specific fields the consent authorised.

7. **Next morning.** The bancassurance nightly job calls `POST /v1/consent/verify/batch`. Mrs. Sharma's status is now `revoked`. Her record is excluded from the outbound file. No further data flows to the partner.

**The DPB examiner's question.** One year later, the DPB examines the bank. The examiner asks: *"On 10 March 2026, when Mrs. Sharma withdrew insurance marketing consent, what was deleted, from which system, with what confirmation, and what was retained under which statute?"*

**The bank's answer:**

> On 10 March 2026 at 14:05:33 IST, artefact cs_art_01HXX2 (insurance_marketing) was revoked via revocation record rev_01HXX7. Deletion request del_req_01HXX8 was issued to the bancassurance partner at 14:05:35. The partner confirmed deletion at 14:07:12, receipt ID del_rcpt_01HXX9. Fields deleted: email_address, name, dob, account_type, nominee_name. No data was retained for this purpose; statutory retention does not apply to marketing consent. The bureau reporting artefact (cs_art_01HXX1) remained active; Mrs. Sharma's repayment data continued to be reported to CIBIL under the Credit Information Companies Regulation Act. The co-lending artefact (cs_art_01HXX3) remained active; her loan-servicing data continued to flow to the co-lending partner under the Banking Regulation Act. Complete audit log attached.

This is the answer architecture produces. No retroactive reconstruction. No emails between compliance officers. No spreadsheet forensics. One screen in one dashboard.

---

## 10. Testing and Validation

A technical buyer will want to know how they validate the integration before going live.

### 10.1 Sandbox Environment

Every customer account includes a separate sandbox organisation (`org_test_...`) with identical API surface, a zero-cost rate limit, and test data principal identifiers. All four surfaces work in sandbox identically to production.

### 10.2 Consent Probe Testing

ConsentShield runs synthetic consent probes against the customer's production property on a configurable schedule. A probe simulates a user who rejects marketing, waits, and then inspects the page for marketing trackers. If any fire, a violation is logged.

This is a live test of the enforcement surface and runs continuously in production. Customers can configure probes for specific user journeys (e.g., *"the checkout flow must not load Meta Pixel before purchase consent"*).

### 10.3 Deletion Receipt Validation

For generic webhook connectors, ConsentShield offers a `test_delete` endpoint that issues a no-op deletion request to the customer's endpoint. The customer confirms receipt, the callback path is exercised, and no actual data is touched. This is the recommended smoke test after wiring a new webhook connector.

### 10.4 DPB Audit Export Dry-Run

Before going live, customers can generate a DPB-format audit export on demand. The export is a zip package containing consent artefacts, revocation records, deletion receipts, rights request logs, processing logs, and breach records over a specified time window. The dry-run exports a sandbox-only window; the real export exports production data.

---

## 11. Frequently Asked Questions

**Does ConsentShield see my customer data?**
No. The customer sends identifiers and purpose codes. Actual personal data (name, email content, transaction records) stays in the customer's systems.

**What if my downstream partner doesn't support webhooks?**
Use the file-based reconciliation mode (Section 4.3). It is a degraded enforcement mode, but it keeps the data flow inside the consent architecture and produces attested deletion records.

**What happens if ConsentShield is down?**
Consent verification fails closed by default — the customer's system does not act on data when ConsentShield is unreachable. The banner is served from Cloudflare's edge and has a separate availability profile from the control plane. Consent events queue locally in the banner and sync when connectivity is restored.

**Can we host ConsentShield on-premises?**
BFSI Enterprise customers can deploy in Zero-Storage mode, where artefacts, revocations, and audit records are written directly to the customer's Postgres (in their VPC or on-prem). The ConsentShield control plane remains SaaS. Full on-premises deployment of the control plane is a custom engagement.

**How do you handle purpose changes — e.g., adding a new marketing channel?**
The Purpose Definition Registry is versioned. Adding a new purpose does not invalidate existing artefacts. When the customer's privacy notice is updated, ConsentShield surfaces a re-consent campaign workflow that produces new artefacts for the new purposes without disturbing the existing ones.

**What is your incident response if a deletion connector fails?**
Failed deletion requests retry with exponential backoff for 24 hours. If the request remains unfulfilled at the deadline, an alert fires on the customer's ops channel and the compliance dashboard flags the overdue deletion in red. The audit export records the failure, the retry history, and the outstanding obligation.

**Can we use ConsentShield for GDPR as well?**
Yes. The GDPR module (Phase 3) uses the same artefact model with the GDPR-specific rights and notice variants. A single customer account can host both DPDP and GDPR compliance for EU-exposed Indian businesses.

**What does pricing look like for complex integrations?**
The BFSI Enterprise tier (₹40K+/month) includes solutions engineer support during integration. For pure SaaS customers, Growth (₹5,999/mo) and Pro (₹9,999/mo) tiers are self-serve; Enterprise (₹24,999+/mo) includes dedicated onboarding. Indicative ranges; contract pricing is negotiated.

---

## 12. What Comes Next

For a technical buyer who has read this far, the recommended next steps are:

1. **Sandbox provisioning.** A free sandbox organisation can be provisioned within the hour. This is the fastest way to inspect the API surface against your own architecture.
2. **Reference architecture review.** A 60-minute call with the ConsentShield solutions team to map your architecture against the reference patterns in Section 6 and identify the specific integration surfaces you need.
3. **Integration effort estimate.** A written estimate, based on the architecture review, specifying the expected engineer-weeks, the connectors to be built, and the sequencing.
4. **Security documentation package.** Full SOC 2 Type II audit report, penetration test summary, architecture diagrams, and the DPIA template for customer use. Available under NDA.

---

## Appendix A — Complete API Surface Summary

### Consent capture

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/consent/record` | Record consent captured via custom UI |
| POST | `/v1/consent/withdraw` | Revoke an artefact |
| GET | `/v1/consent/artefacts` | List artefacts for a data principal |

### Consent verification

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/consent/verify` | Single check — is this purpose granted? |
| POST | `/v1/consent/verify/batch` | Batch check up to 10,000 identifiers |

### Rights requests

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/rights/requests` | Create a rights request (access, correction, erasure, nomination) |
| GET | `/v1/rights/requests` | List rights requests |
| GET | `/v1/rights/requests/{id}` | Get detail + event history |
| PATCH | `/v1/rights/requests/{id}` | Update (assign, verify, respond) |

### Deletion orchestration

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/v1/deletion/trigger` | Manually trigger deletion for a data principal |
| GET | `/v1/deletion/receipts` | List deletion receipts |
| POST | `/v1/deletion-receipts/{request_id}` | Customer's callback endpoint (public, API-key authed) |

### Evidence & reporting

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/v1/consent/events` | Paginated consent event log |
| GET | `/v1/consent/score` | Current compliance score |
| GET | `/v1/tracker/observations` | Tracker observations |
| GET | `/v1/tracker/violations` | Tracker violations |
| GET | `/v1/audit/export` | Generate audit export package |
| GET | `/v1/security/scans` | Security scan results |
| GET | `/v1/inventory` | Current data inventory |
| GET | `/v1/probes/results` | Consent probe results |

**Authentication:** `Authorization: Bearer cs_live_xxxxxxxxxxxxxxxxxxxxxxxx`
**Rate limits:** Starter 100/hr · Growth 1,000/hr · Pro 10,000/hr · Enterprise custom

---

## Appendix B — Webhook Payload Specifications

### B.1 Deletion Request (ConsentShield → Customer)

```json
{
  "event": "deletion_request",
  "request_id": "del_req_01HXX8",
  "data_principal": {
    "identifier": "string",
    "identifier_type": "email | internal_customer_id | mobile_number | pan_hash"
  },
  "reason": "consent_withdrawn | erasure_request | retention_expired",
  "source_artefact_id": "cs_art_01HXX2 | null",
  "data_scope": ["field_1", "field_2", "..."],
  "purpose_code": "string",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/{request_id}",
  "deadline": "ISO 8601 timestamp",
  "issued_at": "ISO 8601 timestamp"
}
```

Signature header: `X-ConsentShield-Signature: sha256=<HMAC-SHA256 of body using shared secret>`

### B.2 Deletion Receipt (Customer → ConsentShield)

```json
{
  "request_id": "del_req_01HXX8",
  "status": "completed | partial | failed | deferred",
  "records_deleted": 1,
  "fields_deleted": ["field_1", "field_2"],
  "fields_retained": ["field_3"],
  "retention_reason": "string",
  "retention_statute": "string",
  "systems_affected": ["system_name"],
  "completed_at": "ISO 8601 timestamp",
  "operator": "system_auto | user_name",
  "evidence_reference": "string (optional customer-side reference)"
}
```

### B.3 Notification Event (ConsentShield → Customer Ops Channel)

```json
{
  "event_type": "rights_request_received | sla_warning | violation_detected | ...",
  "severity": "info | warning | critical",
  "occurred_at": "ISO 8601 timestamp",
  "payload": { /* event-specific */ },
  "dashboard_url": "https://app.consentshield.in/..."
}
```

---

## Appendix C — Pre-Built Connector Catalogue (April 2026)

| Service | Category | Deletion operation | Availability |
|---|---|---|---|
| Mailchimp | Email marketing | `DELETE /lists/{id}/members/{hash}` | GA |
| HubSpot | CRM | `DELETE /crm/v3/objects/contacts/{id}` | GA |
| Freshdesk | Support | `PUT /api/v2/contacts/{id}` (anonymise) | GA |
| Zoho CRM | CRM | `DELETE /crm/v2/Contacts/{id}` | GA |
| Intercom | Support | `POST /user_delete_requests` | GA |
| CleverTap | Engagement | `POST /delete/profiles` | GA |
| WebEngage | Engagement | `DELETE /users/{id}` | GA |
| MoEngage | Engagement | `DELETE /v1/customer/{id}` | GA |
| Shopify | E-commerce | `DELETE /customers/{id}` | GA |
| Razorpay | Payments | `POST /customers/{id}/anonymize` | GA |
| Segment | CDP | `POST /regulations` | GA |
| Freshworks CRM | CRM | `DELETE /contacts/{id}` | GA |
| WooCommerce | E-commerce | `POST /customers/{id}/anonymize` | GA |
| Campaign Monitor | Email marketing | `DELETE /subscribers.json` | Q3 2026 |
| Zendesk | Support | `POST /api/v2/users/{id}/deletions` | Q3 2026 |
| Mixpanel | Analytics | `POST /api/2.0/gdpr-requests` | Q3 2026 |

Custom connectors for bank-specific partners (bancassurance APIs, co-lending fintech APIs, bureau APIs) are built on request as part of the BFSI Enterprise engagement.

---

*Document prepared April 2026. Version 1.0. This is a technical white paper. For commercial terms, contract structure, and partnership details, see the ConsentShield Partnership Overview (v4). For the underlying data architecture, see the DEPA Architecture document and the Stateless Oracle Architecture document. For the BFSI-specific go-to-market framing, see the BFSI Segment Brief (v2) and the DEPA-Banking Bridge.*
