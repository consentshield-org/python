# ConsentShield — Customer-Side Integration

## A Technical White Paper for CTOs, CISOs, and Enterprise Architects

*Version 2.0 · April 2026*
*Supersedes: Version 1.0 (April 2026)*
*Audience: Technical decision-makers evaluating ConsentShield for DPDP compliance*
*Companion to: Definitive Architecture Reference · Complete Schema Design · BFSI Segment Brief v2 · DEPA-Banking Bridge*

---

## Why This Version Exists

Version 1.0 described ConsentShield's integration model as four surfaces mapped to DPDP compliance obligations. That framing held, but the architectural foundation underneath it has matured in three material ways since v1.0 was drafted:

1. **Three processing modes now exist** — Standard, Insulated, and Zero-Storage — representing three distinct answers to *"where does our data live?"* This is a first-order customer choice and belongs at the top of the document, not deep inside a security section.

2. **The DEPA consent artefact model is implementation-level, not aspirational.** Every consent event fans out to one artefact per purpose via a hybrid trigger-plus-safety-net pipeline. The Purpose Definition Registry is a hard constraint. The Regulatory Exemption Engine is parameterised by sector. The deletion orchestration is artefact-scoped and receipt-based.

3. **Category C zero-persistence explicitly enumerates banking identifiers** alongside FHIR clinical data. PAN values, Aadhaar values, bank account numbers, balances, transactions, repayment history, and bureau pulls never enter any ConsentShield table, log, or buffer. This is a structural property of the schema — the single most important architectural claim for any BFSI or healthcare buyer.

Version 2.0 reorganises around these three anchors. The integration surfaces are still there, but now they are built on top of a properly explained foundation. The native mobile SDK claims from v1.0 have been removed — native mobile is not in scope through Phase 3. The webhook protocol field names have been aligned with ADR-0022 (single-table deletion receipt model).

---

## Executive Summary

ConsentShield is the DPDP consent and rights infrastructure for regulated Indian enterprises, built around one architectural identity: **ConsentShield is a stateless compliance oracle**. It processes consent events, generates compliance evidence, and delivers the canonical record to the customer's own storage. It does not hold the compliance record — the customer does.

This identity drives every integration choice a customer makes. There are three questions a technical buyer needs answered before a procurement conversation can proceed, and this paper answers each one:

1. **Where does our data live?** — addressed in Section 2, covering the three processing modes: Standard, Insulated, and Zero-Storage.
2. **What is the unit of consent?** — addressed in Section 3, covering the DEPA consent artefact model.
3. **What do we integrate with?** — addressed in Sections 4 through 7, covering the four integration surfaces.

The short answer on integration surfaces is unchanged from v1.0. A typical SaaS customer needs only Surface 1 to go live. A BFSI customer with bancassurance partners and credit bureau reporting needs all four, integrated in a specific order, with specific payloads. The details are where the customer's legal exposure is resolved or created.

| Surface | Direction | Purpose | Typical integration effort |
|---|---|---|---|
| **1. Consent capture** | Customer → ConsentShield | Produce DPDP-compliant consent artefacts | 10 minutes (web banner) · 1–2 days (custom UI via API) |
| **2. Consent verification** | Customer → ConsentShield | Server-side check that consent exists before acting on data | 1–3 days per calling system |
| **3. Deletion orchestration** | ConsentShield → Customer's downstream systems | Propagate revocation and erasure with field-level precision | 1 hour (pre-built OAuth) to 2 weeks (custom webhook connector) |
| **4. Operational notifications** | ConsentShield → Customer's ops channel | Alert on violations, rights requests, SLA breaches | 15 minutes |

**The architectural claim that matters most:** when the Data Protection Board examines a BFSI customer and asks *"on 10 March 2026, when Mrs. Sharma withdrew her insurance marketing consent, what was deleted from which system with what confirmation, and what was retained under which statute?"* — the customer's answer is a single artefact ID, a single revocation record, a single deletion receipt with a timestamp, and a statutory-exemption ledger. Every piece of that answer lives in an append-only table linked by foreign keys. There is no forensic reconstruction, no email thread between compliance officers, no spreadsheet of "what we think happened." This is what the DEPA-native artefact model produces, and why it is the only viable architecture for regulated Indian enterprise.

**A note on capability status.** Every capability referenced in this document carries one of three states — *Shipping* (live in production), *Beta* (production code path with a known narrow limit), or *Roadmap* (scoped in an ADR with a target quarter). **Appendix E** is the authoritative, line-by-line status inventory and is the first place a technical buyer should go to reconcile any claim in this document against the current reality of the product. If Appendix E conflicts with a paragraph in the body, Appendix E wins.

---

## 1. Architectural Identity

ConsentShield is a stateless compliance oracle. Three principles flow from this identity, and each principle has a direct consequence for how the customer integrates.

### 1.1 Principle 1 — Process, Deliver, Delete

Every piece of user data that enters ConsentShield exits to customer-owned storage within minutes. ConsentShield's buffer tables (consent events, tracker observations, audit log entries, deletion receipts, processing log entries, withdrawal verifications) are write-ahead logs, not databases. A row that has been delivered and confirmed has zero reason to persist. It is deleted immediately upon confirmed delivery, not on a nightly schedule.

**Consequence for the customer:** The customer's own storage (Cloudflare R2 by default, or customer-owned R2/S3 in Insulated or Zero-Storage mode) is the canonical compliance record. Audit exports, DPB-facing artefacts, and long-term retention all read from the customer's storage, never from ConsentShield's operational database. If ConsentShield were to disappear tomorrow, the customer's compliance evidence would survive intact.

### 1.2 Principle 2 — The Customer Is the System of Record

Dashboard views may read from operational tables for real-time display, and the consent artefact itself lives in an operational table (because an active artefact is an ongoing authorisation, not a transient event). But any compliance-facing artefact — the audit package a DPB examiner reviews, the seven-year retention archive, the breach notification evidence pack — is assembled from, or directs the viewer to, customer-owned storage.

**Consequence for the customer:** The customer is not a ConsentShield dependency. The customer's compliance posture is carried by the customer's own infrastructure. ConsentShield is the processor; the customer is the fiduciary, with all the data that status implies under their direct custody.

### 1.3 Principle 3 — Data Processor, Not Data Fiduciary

Under DPDP, a Data Fiduciary faces penalty exposure of up to ₹250 crore per violation. A Data Processor that accumulates a centralised record of everything it processes across its customer base starts looking like a Fiduciary in every way that matters to the Data Protection Board. The stateless oracle architecture ensures ConsentShield never crosses that line.

**Consequence for the customer:** A BFSI or healthcare customer that integrates ConsentShield is not sharing their data principals' personal data with a third party that accumulates it. The customer retains Fiduciary status over their own data principals. ConsentShield's Processor status is architecturally enforced, not merely asserted in the DPA.

---

## 2. Choosing a Data Plane

Every new customer makes this choice during onboarding. The three processing modes represent three answers to the question *"where does our data live?"* — and the correct answer depends on sector, customer size, and the sensitivity of the data categories the customer handles.

### 2.1 The Three Modes

| Mode | What ConsentShield Holds | Customer Storage | Who Manages Storage | Typical Buyer |
|---|---|---|---|---|
| **Standard** | Operational config + encrypted buffer | ConsentShield-provisioned Cloudflare R2 bucket, per-customer encryption key (delivered once, discarded) | ConsentShield provisions, customer holds key | Starter-tier SaaS, early-stage startups |
| **Insulated** | Operational config only | Customer's own R2 or S3 bucket. Write-only credential. ConsentShield cannot read, list, or delete. | Customer manages | Growth-tier SaaS, digital NBFCs, most BFSI customers |
| **Zero-Storage** | Consent artefact index (TTL-bounded) + delivery buffer (seconds) | Customer's own bucket. Data flows through memory only, never persists on ConsentShield infrastructure. | Customer manages | Private banks, insurance companies, healthcare providers handling FHIR data |

**Zero-Storage is mandatory for health data.** Any organisation processing ABDM FHIR records must be in Zero-Storage mode. **Insulated is the default for Growth tier and above.** Standard is only offered to Starter-tier customers who cannot provision their own bucket.

### 2.2 How the Mode Is Enforced

The `storage_mode` flag on the organisation record is checked at the API gateway layer before any data write. An organisation configured in Zero-Storage mode must never have personal data written to any persistent ConsentShield table. This is enforced as Security Rule 9 — a non-negotiable architectural constraint, not a feature flag.

Moving between modes is possible but requires a managed migration. A customer on Standard who wants to move to Insulated provides a target bucket, ConsentShield validates the write-only credential, the export pipeline is switched, and the prior bucket is decommissioned. A customer moving to Zero-Storage requires additional engineering work because the consent artefact index behaviour changes (TTL-bounded instead of persistent).

### 2.3 The BYOS (Bring Your Own Storage) Pattern

In Insulated and Zero-Storage modes, the customer provides the storage target. The operational pattern is identical:

- Customer provisions an S3-compatible bucket (AWS S3, Cloudflare R2, or any compatible service).
- Customer creates an IAM credential scoped to `PutObject` only. No read, no list, no delete.
- Customer provides the credential to ConsentShield via the dashboard. ConsentShield validates with a test write and a verify round-trip, then stores the credential encrypted at rest with per-org key derivation.
- All subsequent compliance exports are written to the customer's bucket. ConsentShield never sees the contents again.

If the credential is ever compromised, the attacker gains write access to an encrypted bucket they cannot decrypt. The customer's historical compliance record is unreadable and untouchable.

### 2.4 Which Mode Should You Choose?

Three questions, in order:

1. **Do you process ABDM FHIR data?** If yes: Zero-Storage is mandatory. Stop here.
2. **Are you a regulated entity under RBI, SEBI, or IRDAI?** If yes: Zero-Storage is the strongly recommended choice, because it is the architectural position that most cleanly answers RBI outsourcing guideline questions. Insulated is also defensible; Standard is not.
3. **Do you have the internal capability to provision and manage a cloud storage bucket with scoped IAM credentials?** If no: Standard. If yes: Insulated is the default.

For most enterprise customers the correct answer is **Insulated**. For BFSI Enterprise and healthcare, the answer is **Zero-Storage**.

---

## 3. The Consent Artefact Model

Before any integration surface can be meaningfully described, the reader needs to understand what ConsentShield considers "a consent" to be. This is the single most consequential schema decision in the product, and it is what differentiates ConsentShield from every GDPR-adapted consent tool in the Indian market.

### 3.1 One Consent Event, N Artefacts

When a data principal interacts with the banner or a custom consent UI, ConsentShield receives one `consent_events` row. That row is the interaction log — it records that the interaction happened, when, from which property, under which notice version.

From that single event, the system fans out and creates **one `consent_artefacts` row per purpose accepted**. Each artefact is an independent, addressable, lifecycle-bearing record of a specific permission for a specific purpose.

Using the banking example from Section 11: a bank customer opening an account and accepting five purposes produces one `consent_events` row and five `consent_artefacts` rows:

```
consent_events:
  event_id: evt_01HXX0  purposes_accepted: [bureau_reporting, insurance_marketing,
                                            co_lending_fintech, whatsapp_marketing, analytics]

consent_artefacts:
  cs_art_01HXX1  purpose: bureau_reporting       data_scope: [pan, aadhaar_ref, account_type, repayment_history]
  cs_art_01HXX2  purpose: insurance_marketing    data_scope: [email_address, name, dob, account_type, nominee_name]
  cs_art_01HXX3  purpose: co_lending_fintech     data_scope: [pan, account_balance, transaction_count_6m, income_estimate]
  cs_art_01HXX4  purpose: whatsapp_marketing     data_scope: [mobile_number]
  cs_art_01HXX5  purpose: analytics              data_scope: [device_id, session_data, feature_usage]
```

Each artefact has:
- A **stable, externally-referenceable ID** (`cs_art_...`)
- An explicit **`data_scope`** declaring which data categories this consent authorises (these are category labels, never actual values — see Section 8)
- A **`purpose_definition_id`** keying into the Purpose Definition Registry
- An explicit **`expires_at`** timestamp (no open-ended consent — Security Rule 20)
- A lifecycle **status** (`active`, `revoked`, `expired`, or `replaced`)

### 3.2 The Purpose Definition Registry

Every purpose on every banner MUST carry a `purpose_definition_id`. This is a hard constraint, not a migration-era accommodation. Banner save and banner publish endpoints reject the request with HTTP 422 if any purpose in the `purposes` JSONB array lacks a `purpose_definition_id`. The DEPA compliance score's `coverage_score` sub-metric is expected to read 100% at all times — any lower reading is a configuration bug to be caught and fixed, not a gradient to tolerate.

**The Registry holds, per organisation:**

- `purpose_code` — e.g., `insurance_marketing`, `bureau_reporting`
- `display_name` — human-readable label for banners
- `data_scope` — the canonical category list this purpose authorises
- `default_expiry_days` — the default artefact expiry (365 days is the platform default)
- `auto_delete_on_expiry` — whether expiry should cascade into deletion orchestration
- `sector` — BFSI, healthcare, SaaS, etc.

Sector templates (BFSI, healthcare, edtech, e-commerce, SaaS) ship pre-seeded purpose definitions that match the sector's typical data flows. A new BFSI customer inherits the BFSI template's purpose definitions on account creation; they can customise from there.

### 3.3 The Fan-Out Pipeline

When a `consent_events` row is written, a pipeline converts it into artefacts. This is not synchronous with the user's browser experience — the Cloudflare Worker returns HTTP 202 the moment the consent event is validated and persisted. The fan-out happens downstream.

```
Worker validates + writes consent_events row + returns 202 to browser
    │
    ▼
AFTER INSERT trigger on consent_events
    └─→ net.http_post(process-consent-event Edge Function)
            │  (wrapped in EXCEPTION WHEN OTHERS — trigger cannot roll back the insert)
            ▼
        process-consent-event (running as cs_orchestrator scoped role):
            ├─ idempotency check: count artefacts for consent_event_id; if > 0, skip creation
            ├─ for each accepted purpose: lookup purpose_definitions, copy data_scope
            ├─ INSERT N rows into consent_artefacts (data_scope is a snapshot at creation time)
            ├─ UPSERT into consent_artefact_index (the real-time validity cache)
            ├─ INSERT into consent_expiry_queue (notify_at = expires_at - 30 days)
            ├─ INSERT into delivery_buffer (stage for export to customer storage)
            ├─ UPDATE consent_events SET artefact_ids = ARRAY[...]
            └─ INSERT audit_log

Safety net (pg_cron every 5 minutes):
    SELECT consent_events WHERE artefact_ids = '{}' AND created_at < now() - 5 min
        └─→ re-fire process-consent-event for each (idempotent)
```

**Idempotency is load-bearing.** The Edge Function is designed so that whether the trigger fires, the safety-net cron fires, or both fire, the outcome is identical: one artefact per purpose per event, no duplicates.

**Orphan event detection.** A compliance metric `orphan_consent_events` counts `consent_events` rows where `artefact_ids = '{}'` and `created_at > now() - 10 minutes`. Any non-zero value on the dashboard indicates a stuck pipeline and fires an alert via the notification channels.

### 3.4 Artefact Lifecycle

```
                    ┌──────────┐
                    │  active  │ ◄── created by process-consent-event
                    └─────┬────┘
              ┌───────────┼─────────────┐
              ▼           ▼             ▼
         ┌─────────┐  ┌─────────┐  ┌─────────┐
         │ revoked │  │ expired │  │ replaced│
         └─────────┘  └─────────┘  └─────────┘
         (user       (TTL lapse,   (re-consent
         withdrawal  enforced by   creates
         or regu-    pg_cron)      successor
         latory                     artefact)
         action)
```

**Append-only (Security Rule 19).** The `consent_artefacts` table has no INSERT, UPDATE, or DELETE RLS policy for the authenticated role. Artefacts are created exclusively by the `process-consent-event` Edge Function. Status transitions occur only through three paths: (a) an `artefact_revocations` INSERT trigger (active → revoked), (b) the `enforce_artefact_expiry()` pg_cron job (active → expired), or (c) `process-consent-event` during a re-consent flow (active → replaced). Direct UPDATE of `consent_artefacts.status` from application code is a bug and is rejected in review. Artefact rows are never deleted except via the `organisations ON DELETE CASCADE` path.

**Mandatory expiry (Security Rule 20).** Every artefact row has a non-null `expires_at`. Open-ended consent is not permitted. The `send_expiry_alerts()` pg_cron job notifies compliance contacts 30 days before expiry; `enforce_artefact_expiry()` transitions expired artefacts to `status = 'expired'` and, if `auto_delete_on_expiry = true` on the purpose definition, cascades deletion via the artefact-scoped deletion orchestration (Section 6).

**Replacement chain semantics.** If artefact A is replaced by B (a re-consent interaction), and B is later revoked, A's status remains frozen at `replaced`. The revocation of B creates an `artefact_revocations` row referencing B only and does *not* walk the `replaced_by` chain. The chain is a historical record of how consent was re-obtained, not a live authorisation chain. Only the most recent non-replaced artefact authorises the current data flow.

### 3.5 Why This Matters for the Customer

The customer integrates against artefacts, not against events. When a campaign engine asks *"can I send Mrs. Sharma a marketing SMS right now?"*, it is asking *"is there an active, non-expired artefact for the `marketing` purpose for this data principal?"* — and the `consent_artefact_index` validity cache is the authoritative answer, returned in under 50 ms.

When a deletion orchestration fires, it fires against one artefact's scope. The customer's bancassurance partner is instructed to delete exactly the fields declared in `cs_art_01HXX2.data_scope`, for exactly this one data principal, with a receipt chain that traces back to the artefact ID, the revocation record, and the notice version the user consented under. This is what produces the DPB-defensible answer.

---

## 4. Surface 1 — Consent Capture

Consent capture is how the data principal's permission becomes an artefact. There are two integration modes, corresponding to two customer deployment shapes.

### 4.1 Mode A — Web Banner (Script Tag)

The default integration for any web property.

```html
<script src="https://cdn.consentshield.in/v1/banner.js"
        data-org="org_7H3K..."
        data-property="prop_BQ2X..."
        async></script>
```

**What the customer does during onboarding:**

1. Signs up and completes the onboarding wizard (≈ 10 minutes)
2. Selects a sector template — BFSI, healthcare, edtech, e-commerce, SaaS — which pre-seeds the Purpose Definition Registry with sector-appropriate purpose definitions
3. Chooses a processing mode (Section 2) — Standard, Insulated, or Zero-Storage
4. Configures banner copy and selects which purposes appear on the banner
5. Pastes the script tag into the site's `<head>`
6. ConsentShield auto-detects the snippet on first page load

**What happens at runtime:**

- Banner is served from Cloudflare's edge in under 50 ms
- User interacts with the banner; consent event is HMAC-signed client-side and POSTed to the Worker
- Worker validates (origin, HMAC signature, payload), writes `consent_events`, and returns HTTP 202
- The fan-out pipeline (Section 3.3) creates one artefact per accepted purpose, asynchronously
- Banner script continues monitoring for tracker violations after the consent decision (enforcement engine)

**What the banner integration does not do on its own:**

- It does not gate server-side data processing (that is Surface 2)
- It does not propagate revocation to downstream systems (that is Surface 3)
- It does not stop a tag manager from firing pixels before consent if those pixels are hardcoded in the page source (the banner catches dynamically-injected scripts via MutationObserver, but server-rendered hardcoded trackers require the consent probe engine — see Section 12)

**CMS variants.** For WordPress, Shopify, Webflow, Wix, Framer, and Squarespace, the snippet is delivered as a platform plugin to keep installation inside the customer's CMS workflow. The payload and data model are identical; only the installation mechanism differs.

**Offline behaviour.** The banner stores the user's consent decision in the browser's `localStorage` immediately. If the POST to the Worker fails (network issue, rate limit, transient error), the consent artefact is still effective in the user's browser session — the Worker's retry logic and the customer's own audit dashboard will reconcile when connectivity returns. A failed write must never break the user's browsing session.

### 4.2 Mode B — Custom UI via Consent API

For customers with a consent flow that cannot be rendered by the banner — a mobile app using its own native UI, a call-centre agent capturing telephonic consent, a kiosk application, an in-person account-opening flow with a tablet and signature pad, or any server-to-server recording of consent obtained through another channel.

```bash
POST https://api.consentshield.in/v1/consent/record
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "property_id": "prop_mobile_BQ2X",
  "data_principal": {
    "identifier": "cust_987654",
    "identifier_type": "internal_customer_id"
  },
  "purposes": [
    {
      "purpose_definition_id": "pd_bureau_reporting_01HZY",
      "granted": true
    },
    {
      "purpose_definition_id": "pd_insurance_marketing_01HZZ",
      "granted": true
    },
    {
      "purpose_definition_id": "pd_whatsapp_marketing_01H00",
      "granted": false
    }
  ],
  "captured_via": "mobile_app_onboarding",
  "captured_by": "system",
  "notice_version": "notice_v_2026_04",
  "captured_at": "2026-04-19T10:15:33Z"
}
```

ConsentShield validates that every `purpose_definition_id` exists in the Purpose Definition Registry (HTTP 422 if any are missing or invalid), writes `consent_events`, and returns one artefact ID per granted purpose. The customer stores these IDs against their account record in their own system.

**This is the escape hatch.** Any consent capture interaction the customer needs to instrument can be recorded through this endpoint, and the resulting artefacts behave identically to those produced by the web banner.

**Mobile-first customers use this mode.** A digital NBFC with a native iOS and Android app renders its own consent UI (matching the app's design system, handling Android runtime permission prompts in-line with its onboarding flow), captures the user's decision, and posts it to `/v1/consent/record`. ConsentShield does not ship a mobile SDK today; the custom-UI-via-API pattern is the current integration model for mobile apps.

**Native mobile SDK roadmap.** A React Native SDK is under consideration for Phase 4, specifically to solve the ABDM ABHA QR scan workflow in clinic settings where Progressive Web App camera APIs on iOS have proven limiting. The SDK is not currently in scope for Phases 1–3 and is not available as a commitment. Customers who need native mobile consent flows today use Mode B.

### 4.3 Notice Versioning

Every `consent_events` row carries a `notice_version` field identifying the exact privacy notice the user consented under. When the customer updates their privacy notice, a new notice version is published; subsequent consent events reference the new version; prior artefacts retain their reference to the old version. This is how ConsentShield makes *"what notice did this user consent under on 15 January 2025?"* a trivial database lookup rather than a document archaeology exercise.

When a customer publishes a materially changed notice, ConsentShield surfaces a re-consent campaign workflow: it enumerates the affected active artefacts, offers template messages, and produces new artefacts (with `replaced_by` chaining to the old ones) as users re-consent under the new notice.

---

## 5. Surface 2 — Consent Verification

The consent artefact is the evidence of permission. Consent verification is the runtime check, made by the customer's own systems, that asks: *"Is this purpose currently authorised for this data principal?"*

This is the surface that separates **recorded** compliance from **enforced** compliance. Without verification, the marketing engine can send a WhatsApp campaign to a user who revoked marketing consent yesterday; the consent record will show the revocation, but the outbound message already went out. The examiner finding is not *"you failed to record revocation"* — it is *"you acted on data after consent was withdrawn."* The second is materially worse.

### 5.1 The Verification Endpoint

```bash
GET https://api.consentshield.in/v1/consent/verify
     ?property_id=prop_core_banking
     &data_principal_identifier=cust_987654
     &identifier_type=internal_customer_id
     &purpose_code=insurance_marketing
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
```

```json
{
  "data_principal_identifier": "cust_987654",
  "purpose_code": "insurance_marketing",
  "status": "revoked",
  "active_artefact_id": null,
  "revoked_at": "2026-03-10T14:05:33Z",
  "revocation_record_id": "rev_01HXX7",
  "last_valid_artefact_id": "cs_art_01HXX2",
  "expires_at": null,
  "evaluated_at": "2026-04-19T10:15:33.445Z"
}
```

Sub-50 ms p99 latency, served from the `consent_artefact_index` validity cache that the fan-out pipeline maintains. Safe to call synchronously from any server-side process.

The response status field takes four values:
- `granted` — an active non-expired artefact exists
- `revoked` — the previous artefact was withdrawn by the user
- `expired` — the previous artefact passed its `expires_at` timestamp
- `never_consented` — no artefact has ever existed for this principal/purpose pair

The customer's system should treat the last three as functionally identical — *"do not act"* — and log which specific reason applied.

### 5.2 Where Customers Call This

Every system in the customer's architecture that takes an action on behalf of a user needs a verification call at the point of action. A non-exhaustive list for a BFSI customer:

| Customer system | When to call | Purpose code typically checked |
|---|---|---|
| Marketing campaign engine | Before adding a user to a campaign cohort | `whatsapp_marketing`, `email_marketing`, `sms_marketing` |
| Underwriting API (NBFC) | Before passing the applicant's data to the scoring model | `credit_scoring`, `bureau_inquiry` |
| Insurance cross-sell batch job | Before sharing the daily data file with the bancassurance partner | `insurance_marketing` |
| Analytics ingestion layer | Before writing the event to Mixpanel/CleverTap | `analytics` |
| Push notification service | Before sending any non-transactional push | `push_marketing` |
| Contact-list sync (collections) | Before reading the user's phone contact list for recovery outreach | `contact_list_access` |
| Co-lending data share | Before the nightly partner reconciliation file is transmitted | `co_lending_partner` |

### 5.3 Batch Verification

For bulk operations — marketing segment builds, nightly partner data files, bureau reporting runs — verification can be batched in a single API call:

```bash
POST https://api.consentshield.in/v1/consent/verify/batch
Authorization: Bearer cs_live_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "property_id": "prop_core_banking",
  "purpose_code": "insurance_marketing",
  "data_principal_identifiers": [
    { "identifier": "cust_987654", "type": "internal_customer_id" },
    { "identifier": "cust_987655", "type": "internal_customer_id" },
    ...
  ]
}
```

Returns an array of statuses. Up to 10,000 identifiers per call. For larger batches (a bank with 12 million customers running a nightly bancassurance reconciliation), the customer issues multiple calls in parallel; the underlying validity cache can sustain the aggregate throughput.

### 5.4 Failure Modes and Fail-Safes

The verification endpoint has three failure modes, and the customer's integration must handle each deliberately:

| Response | Customer system behaviour | Rationale |
|---|---|---|
| `status: granted` | Proceed with the action | Normal path |
| `status: revoked`, `expired`, or `never_consented` | Do not proceed; log the suppression with the reason code | Normal path; the log is the audit trail |
| API unreachable (timeout, 5xx, network error) | Do not proceed; log the failure; alert ops | **Fail-closed on consent verification is the correct DPDP posture** |

ConsentShield's client libraries — six server-side languages across two tiers, all delivered under the Pro and Enterprise tiers — ship with a default 2-second timeout and fail-closed behaviour. **Tier 1 (hand-rolled, line-audited):** Node.js, Python, Go (ADR-1006, shipped 2026-04-25 / 2026-04-26). **Tier 2 (OpenAPI-generated, framework-friendly wrappers):** Java (Spring Boot starter), .NET (ASP.NET Core integration), PHP (Laravel + Symfony examples) (ADR-1028, shipped 2026-04-26). Mobile (Swift / Kotlin) follows a different security model — no `cs_live_*` keys client-side — and is deferred to a future ADR gated on the ABDM mobile launch trigger.

The fail-closed default is deliberate. A customer who chooses to override this — for example, *"if ConsentShield is down, default to granted so our business doesn't stop"* — is making an explicit compliance trade-off, and we require them to configure that override with a named flag (`CONSENT_VERIFY_FAIL_OPEN = true`) that appears in their audit export. The decision is visible.

### 5.5 Caching and Freshness

A withdrawal at 14:05:33 must invalidate the verification response at 14:05:34 — not at 14:10:33 after a five-minute cache TTL. The `consent_artefact_index` is the validity cache; it is updated by the `artefact_revocations` INSERT trigger before the transaction commits, so the first verification call that runs after the trigger fires returns the revoked status. Customers should not implement their own cache layer in front of the verify endpoint; if they need higher throughput, the batch endpoint is the correct mechanism.

---

## 6. Surface 3 — Deletion Orchestration

When a data principal revokes an artefact (Section 3.4), the consent artefact's status transitions to `revoked` and the `artefact_revocations` row is written. What happens next is Surface 3: the orchestrated propagation of that revocation to every downstream system that holds the data the artefact authorised.

ConsentShield provides two models for this, which the customer mixes and matches per downstream system.

### 6.1 The Artefact-Scoped Deletion Principle

**Deletion is artefact-scoped.** This is the single most important design decision in Surface 3. When artefact `cs_art_01HXX2` (insurance marketing) is revoked, deletion fires against the fields in *that artefact's `data_scope`*, routed to the connectors mapped to *that artefact's purpose*, for *that specific data principal*.

Crucially, this is **not** a blanket *"delete everything about this user"* sweep. The bureau reporting artefact (`cs_art_01HXX1`) is untouched. The co-lending artefact (`cs_art_01HXX3`) is untouched. CIBIL continues to receive the customer's repayment data under the Credit Information Companies Regulation Act. The co-lending fintech continues to receive the customer's loan-servicing data. Only the bancassurance partner's records are touched, and only the specific fields the insurance marketing consent authorised.

**The `purpose_connector_mappings` table** is the routing layer. For each purpose, it declares which connectors receive deletion instructions, and which subset of the artefact's `data_scope` each connector is responsible for. When an artefact is revoked, the orchestrator:

1. Reads `consent_artefacts.data_scope` for the revoked artefact
2. Queries `purpose_connector_mappings` for the artefact's `purpose_definition_id`
3. For each mapped connector, creates one `deletion_receipts` row with `status='pending'`, `artefact_id` populated, `trigger_type='consent_revoked'`, and `request_payload.data_scope` set to the intersection of the mapping's fields with the artefact's `data_scope`
4. The existing delivery pathway dispatches each receipt to the connector

Idempotency is enforced by a unique constraint: `UNIQUE (trigger_id, connector_id) WHERE trigger_type = 'consent_revoked'`. A replayed revocation cannot produce duplicate deletion instructions.

### 6.2 Model A — Pre-Built OAuth Connectors

For well-known SaaS tools with documented deletion APIs, ConsentShield ships direct integrations.

**Setup flow:**

1. Customer goes to the Integrations surface in the dashboard
2. Clicks Connect on the target service (e.g., Mailchimp)
3. OAuth redirect to the service's authorisation page
4. User authorises ConsentShield with delete-user scope
5. OAuth token stored encrypted in ConsentShield's vault, scoped to that organisation
6. Connector is active

**At runtime:** when a deletion is orchestrated, ConsentShield calls the service's API directly (e.g., `DELETE /lists/{id}/members/{hash}`) and records the response as the `deletion_receipts` row's transition from `pending` to `confirmed` or `failed`. No webhook on the customer's side.

**Connector catalogue (April 2026):**

| Category | Shipping today | Q3 2026 | On request (Q4 2026+) |
|---|---|---|---|
| Email marketing | Mailchimp | Campaign Monitor | — |
| CRM | HubSpot | Zoho CRM, Freshworks CRM | — |
| Support & helpdesk | — | Freshdesk, Intercom, Zendesk | — |
| Engagement / push | — | CleverTap, WebEngage, MoEngage | — |
| E-commerce | — | Shopify, WooCommerce | — |
| Payments | — | Razorpay (anonymisation, not deletion — PMLA retention) | — |
| Analytics | — | Segment, Mixpanel | — |

Shipping today means the OAuth flow, deletion API call, and integration-test coverage are all live in production (Mailchimp, HubSpot — ADR-0018 + ADR-0039). Q3 2026 connectors have scoped acceptance criteria in the whitepaper-closure ADR sequence (ADR-1007 Phase 1) and are delivered in the order the customer pipeline signals. "On request" means a bespoke BFSI Enterprise engagement — typical engineering effort for a new pre-built connector is 2–3 engineer-days once the vendor's deletion API is in hand.

### 6.3 Model B — Generic Webhook Protocol

For every other system — the customer's core banking platform, internal CRM, data warehouse, regulatory reporting systems, or any partner vendor without a pre-built connector — the generic webhook protocol is the universal interface.

**The customer implements one HTTP endpoint.** That endpoint receives deletion instructions from ConsentShield, executes the deletion inside the customer's system, and confirms back through a signed callback URL.

**Instruction from ConsentShield (post-ADR-0022 single-table model):**

```http
POST https://customer-api.bank.in/privacy/deletion
Content-Type: application/json
X-ConsentShield-Signature: sha256=<HMAC of body with shared secret>

{
  "event": "deletion_request",
  "receipt_id": "rcpt_01HXX8",
  "artefact_id": "cs_art_01HXX2",
  "data_principal": {
    "identifier": "cust_987654",
    "identifier_type": "internal_customer_id"
  },
  "reason": "consent_revoked",
  "data_scope": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "purpose_code": "insurance_marketing",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/rcpt_01HXX8?sig=<HMAC>",
  "deadline": "2026-04-09T14:05:33Z",
  "issued_at": "2026-03-10T14:05:35Z"
}
```

**Reason codes** are drawn from a fixed enumeration:
- `consent_revoked` — user withdrew an artefact
- `consent_expired` — artefact's `expires_at` lapsed and the purpose's `auto_delete_on_expiry` is true
- `erasure_request` — DPDP Section 13 rights request (sweeps all active artefacts for the data principal)
- `retention_expired` — a retention rule on a data category has expired

**Customer's callback to ConsentShield** (posted when deletion is complete — the callback URL is already HMAC-signed, so the customer does not need to add its own signature):

```http
POST https://api.consentshield.in/v1/deletion-receipts/rcpt_01HXX8?sig=<HMAC>
Content-Type: application/json

{
  "receipt_id": "rcpt_01HXX8",
  "status": "completed",
  "records_deleted": 1,
  "fields_deleted": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "systems_affected": ["bancassurance_partner_prod", "bancassurance_partner_replica"],
  "completed_at": "2026-03-10T14:07:12Z",
  "operator": "system_auto",
  "evidence_reference": "partner_ref_XYZ123"
}
```

On successful callback, the same `deletion_receipts` row transitions from `pending` to `confirmed`. There is no separate "deletion request" entity — the row represents the full lifecycle of one connector instruction, disambiguated by its `status` field (ADR-0022).

**Partial completion and statutory-retention responses:**

```json
{
  "receipt_id": "rcpt_01HXX8",
  "status": "partial",
  "records_deleted": 1,
  "fields_deleted": ["email_address", "name"],
  "fields_retained": ["dob", "account_type"],
  "retention_reason": "Required for pending insurance policy underwriting — statutory",
  "retention_statute": "Insurance Act 1938 § 64VB",
  "completed_at": "2026-03-10T14:07:12Z"
}
```

ConsentShield normalises partial responses and surfaces them on the customer's compliance dashboard. A DPB examiner reviewing the record sees exactly what was deleted, what was retained, and which statute compelled retention.

**Security properties:**

- Every instruction carries an `X-ConsentShield-Signature` header: HMAC-SHA256 of the body, using a shared secret established at connector setup. The customer's endpoint MUST verify the signature before processing (see Security Rule 14 — deletion callbacks are signature-verified on both directions).
- The callback URL includes its own HMAC signature derived from the receipt ID and ConsentShield's `DELETION_CALLBACK_SECRET`. The endpoint rejects callbacks with invalid signatures.
- Deletion receipt IDs are single-use. A replayed callback is rejected with HTTP 409.
- The `deadline` field is binding. If the callback is not received by the deadline, the receipt transitions to `overdue`, an alert fires via the customer's notification channels, and the DPB-facing audit export flags the missed SLA.

### 6.4 The Three-Link Audit Chain

Every artefact-triggered deletion produces a complete, auditable chain of custody:

```
consent_artefacts.artefact_id
    └── artefact_revocations.artefact_id (the revocation record)
         └── deletion_receipts.artefact_id (one row per connector instruction)
```

Rights-portal erasure requests and retention-rule expiries produce two-link chains starting at `rights_requests` or `retention_rules` respectively. In every case, an auditor can reconstruct which user consented, when they withdrew, which systems were instructed to delete which fields, and when each system confirmed. This is the DPDP Section 12 evidence trail, produced as a by-product of normal operation rather than as a separate reporting exercise.

### 6.5 Integration Effort

Implementing the webhook endpoint on the customer side is typically 1–2 engineer-days: define the route, verify the signature, enqueue a deletion job, execute the deletion across the customer's internal data stores, and POST the callback. The real effort is inside the customer's architecture — understanding where the data lives and how to delete it cleanly from every downstream store — and that effort is bounded by the customer's own architectural complexity, not by ConsentShield's API.

---

## 7. Surface 4 — Operational Notifications

The fourth integration surface is operational, not data-plane. ConsentShield needs to alert the customer's compliance and engineering teams when specific events occur. This is set up once during onboarding and forgotten thereafter.

| Channel | Setup effort | Typical use |
|---|---|---|
| Email (Resend) | 0 (default — compliance contact on org record) | Compliance officer, DPO |
| Slack incoming webhook | 5 minutes | Engineering on-call channel |
| Microsoft Teams webhook | 5 minutes | Compliance team channel |
| Discord webhook | 5 minutes | Startup engineering channel |
| PagerDuty / OpsGenie | 10 minutes (via custom webhook) | Production incident routing |
| Custom webhook | 15 minutes | Customer's internal alerting system |

**Alert types (each independently routable per channel):**

- Tracker violation detected (a consent was declined but a tracker fired anyway)
- New rights request received (access, correction, erasure, nomination)
- SLA warning — 7 days remaining on a rights request
- SLA overdue
- Consent withdrawal verification failure — a tracker continued firing after the user's revocation
- Security scan: new critical finding on a monitored property
- Retention period expired on a data category
- Deletion orchestration failure (a `deletion_receipts` row transitioned to `failed` or timed out to `overdue`)
- Consent probe failure
- Daily compliance score summary
- **Orphan consent event detected** (the DEPA fan-out pipeline is stuck — see Section 3.3)
- **Artefact expiry warning** (30 days before artefact expiry, so re-consent can be planned)

The `notification_channels` configuration is stored per organisation; severity levels (info, warning, critical) can be mapped independently per channel, so a customer can route critical alerts to PagerDuty while sending daily summaries to Slack.

---

## 8. Zero-Persistence for Regulated Content

This is the single most important architectural claim in the product for any BFSI or healthcare buyer, and it deserves its own section rather than being buried in the security rules.

### 8.1 The Claim

Content-layer data governed by sector-specific retention regulation is never written to any ConsentShield table, any log, any file, or any buffer. It flows through ConsentShield's server in memory only, if at all. This is Security Rule 3, recently broadened (2026-04-16) to explicitly enumerate banking identifiers alongside healthcare FHIR data.

**Enumerated regulated categories:**

| Category | Source | Governing regulation | ConsentShield treatment |
|---|---|---|---|
| PAN values | BFSI customers | RBI KYC Master Directions | Never persisted |
| Aadhaar values and Aadhaar-derived references | BFSI customers | Aadhaar Act, RBI KYC | Never persisted |
| Bank account numbers | BFSI customers | RBI KYC, Banking Regulation Act | Never persisted |
| Account balances | BFSI customers | Banking Regulation Act | Never persisted |
| Bank statements | BFSI customers | RBI record retention | Never persisted |
| Repayment history | BFSI customers | Credit Information Companies Act | Never persisted |
| Transaction records | BFSI customers | PMLA, Banking Regulation Act | Never persisted |
| Bureau pulls (CIBIL, Experian, CRIF) | BFSI customers | Credit Information Companies Act | Never persisted |
| KYC documents | BFSI customers | PMLA, RBI KYC | Never persisted |
| FHIR clinical records | Healthcare customers | ABDM, DISHA | Never persisted |
| Diagnoses, medications, lab results, prescriptions, observations, imaging | Healthcare customers | ABDM, DISHA | Never persisted |

Any future regulated sector's content — telecom call detail records, insurance claims content, education records — inherits Category C by default and is enumerated here when the corresponding module ships.

### 8.2 How It Is Enforced

This is a **structural property of the schema**, not a policy document or a set of promises. The DDL contains no column, no JSONB field, no log target, no queue entry where a PAN value, an Aadhaar value, a FHIR resource payload, or any other regulated content value can be written. A code review that encounters a PR adding such a column rejects the change without discussion.

**Category labels versus content values — the critical distinction.** The DEPA artefact model holds *category declarations*, never values:

```
consent_artefacts.data_scope = ['pan', 'aadhaar_ref', 'account_type', 'repayment_history']
     ↑                              ↑                ↑              ↑
   a LABEL                     a LABEL          a LABEL       a LABEL
   (declares "this consent covers PAN-type data"; actual PAN value 'ABCDE1234F' is never stored)
```

The artefact tells the deletion orchestrator *which categories to propagate*. The actual values live in the customer's systems (core banking, CRM, insurance partner), which is precisely where the customer's Fiduciary obligations under DPDP require them to be.

### 8.3 Why This Matters for Customer Procurement

Every regulated BFSI customer will ask some version of the following question during their security review: *"If your platform is compromised, does the attacker gain access to our customers' PAN numbers, account numbers, or balances?"*

For ConsentShield, the answer is: **no, because those values do not exist in our database.** The attacker gains category labels, purpose definitions, artefact IDs, and timestamps — all of which are operational metadata. They do not gain content.

For the same reason, the RBI outsourcing guideline analysis becomes tractable. The customer is not outsourcing data storage to ConsentShield because ConsentShield does not store their customers' personal data. The customer is outsourcing consent *processing* — the same relationship a bank has with a payment gateway. The bank holds the cards; the gateway processes the transactions.

This is also why Zero-Storage mode is the natural deployment for BFSI Enterprise and why it is mandatory for healthcare: in Zero-Storage, even the identifiers and metadata flow through ConsentShield in memory only, giving the customer a maximally defensible architectural posture.

---

## 9. Reference Architectures

Four archetypes, covering the spectrum from lightweight SaaS to a full private-bank deployment.

### 9.1 Pure Web SaaS (Starter or Growth Tier)

```
[user's browser]
        │
        │ loads page
        ▼
[customer's web app (Vercel / AWS / GCP)]
        │
        │  <script src="cdn.consentshield.in/v1/banner.js">
        ▼
[ConsentShield CDN] ──── consent events ───► [ConsentShield (Standard or Insulated mode)]
                                                 │
                                                 │ deletion orchestration
                                                 ▼
                           [Mailchimp · HubSpot]  ← pre-built OAuth connectors (see Appendix D)
```

- Processing mode: **Standard** (Starter) or **Insulated** (Growth)
- Surfaces used: 1 (banner), 3 (pre-built OAuth connectors)
- Integration effort: 1 day
- Compliance outcome: full consent capture with artefact-per-purpose precision; automatic deletion across the top 3–5 SaaS tools the startup uses

### 9.2 Mobile-First Digital NBFC (BFSI Growth Tier)

```
[user's iOS / Android app (NBFC's own native UI)]
         │
         │ Custom UI via API — POST /v1/consent/record
         ▼
[NBFC's mobile backend (AWS / on-prem)]
         │                                     │
         │  Surface 2: consent verification    │
         ▼                                     ▼
[ConsentShield] ◄── verify before underwriting  [underwriting API]
       │
       │  Surface 3: artefact-scoped deletion
       ▼
[core lending system]        ← generic webhook
[CleverTap · MoEngage]       ← pre-built connectors
[collections partner]        ← generic webhook
[bureau: CIBIL / Experian]   ← does NOT receive deletion (statutory exemption)
```

- Processing mode: **Insulated** (customer's own S3 bucket)
- Surfaces used: 1 (custom UI via API), 2 (verification on every lending decision), 3 (mix of webhooks and connectors), 4 (PagerDuty for SLA alerts)
- Integration effort: 2–3 weeks total including mobile app UX integration
- Compliance outcome: DPDP-compliant at the moment of Android runtime permission grant; statutory retention correctly handled for bureau data; contact-list collection backstop closed

### 9.3 Private Bank with Bancassurance (BFSI Enterprise Tier)

```
[account opening — branch channel or digital channel]
         │
         │  Surface 1: custom UI via API (branch) OR web banner (digital) OR bank's mobile app (custom UI via API)
         ▼
[ConsentShield — 5 artefacts created via fan-out pipeline]
         │
         │  Surface 2: verification called by each downstream system
         ▼
    ┌────┼────────────────────────────────────┐
    │    │                                     │
    ▼    ▼                                     ▼
[core banking: Finacle / FLEXCUBE]   [marketing engine]   [treasury / trade finance]
    │                                    │
    │   Surface 3: artefact-scoped deletion orchestration
    ▼                                    ▼
[bancassurance partner]     ← generic webhook — field-level DELETE per data_scope
[co-lending fintech]        ← generic webhook — bidirectional, Regulatory Exemption Engine
[CIBIL / Experian / CRIF]   ← statutory retention — no deletion triggered
[WhatsApp Business]         ← pre-built connector
[Firebase / Mixpanel]       ← pre-built connectors
```

- Processing mode: **Zero-Storage** (mandatory architectural claim for the bank's RBI outsourcing analysis)
- Surfaces used: all four, comprehensively
- Integration effort: 6–10 weeks for a phased rollout
- Compliance outcome: surgical revocation matching DPDP Section 6, full statutory-retention handling via the Regulatory Exemption Engine, DPB-defensible deletion receipts for every partner flow, zero-persistence of banking identifiers

**The architectural claim this delivers:** when the DPB examiner asks *"on 10 March 2026, when customer X withdrew insurance marketing consent, what was deleted from which system with what confirmation?"*, the bank's answer is a single artefact ID, a single revocation record, and a single deletion receipt. The question becomes a one-screen lookup in the compliance dashboard, not a forensic exercise.

### 9.4 Healthcare — Clinic with ABDM (Healthcare Bundle)

```
[clinic tablet — ABHA QR scan at patient check-in]
         │
         │ Responsive web consent interface (tablet-optimised)
         │  + Custom UI via API — POST /v1/consent/record
         ▼
[clinic EMR]
    │
    │  Surface 3: artefact-scoped deletion orchestration
    ▼
[ABDM HIU/HIP federation layer]   ← healthcare bundle generic webhook
[clinic's EMR vendor]              ← pre-built connector (when vendor is onboarded)
[appointment reminder vendor]      ← CleverTap/WebEngage connector
```

- Processing mode: **Zero-Storage** (mandatory for FHIR data)
- Surfaces used: 1 (custom UI via API, tablet-optimised), 3 (deletion orchestration), 4 (notifications to DPO)
- Integration effort: 1–2 weeks for single-doctor clinic; 3–4 weeks for multi-doctor practice
- Compliance outcome: unified ABDM + DPDP consent capture in a single patient interaction; Zero-Storage guarantee for FHIR clinical records

Detailed in the ABDM Scope & Data Architecture companion document.

---

## 10. Integration Timeline and Effort

For typical customer archetypes, based on the reference architectures in Section 9.

### 10.1 Lightweight SaaS — 1 week

| Day | Activity |
|---|---|
| 1 | Sign up, complete onboarding wizard (sector template selection, purpose definitions seeded, processing mode selected), inventory answers |
| 1 | Paste script tag into production site `<head>` |
| 2 | Connect Mailchimp and HubSpot via OAuth |
| 3 | Configure Slack alert webhook |
| 4 | First compliance score generated; action queue addressed |
| 5 | First week of production monitoring; compliance score reviewed |

### 10.2 Mobile-First NBFC — 3 weeks

| Week | Activity |
|---|---|
| 1 | Web onboarding; processing mode = Insulated; BFSI sector template activated; Purpose Definition Registry customised for digital lending flows; banner deployed on landing/marketing site; data inventory completed |
| 2 | Custom UI via API integrated into iOS and Android app onboarding; consent flows instrumented at Android runtime permission prompts (contact list, location, camera); QA. Server-side consent verification added to underwriting API and marketing campaign engine |
| 3 | Deletion orchestration: core lending system generic webhook + CleverTap connector + collections partner generic webhook; Regulatory Exemption Engine configured for RBI KYC and PMLA retention categories; ops alerts routed to PagerDuty |

### 10.3 Private Bank — 8 to 10 weeks

| Phase | Weeks | Activity |
|---|---|---|
| Foundation | 1–2 | BFSI Enterprise account setup; Zero-Storage deployment architecture agreed; Purpose Definition Registry populated with bank-specific purposes; statutory retention rules pre-loaded (RBI KYC, PMLA, Banking Regulation Act, Credit Information Companies Act, Insurance Act) |
| Capture | 3–4 | Digital channel integration (web banner + mobile app custom UI via API); branch channel custom UI via API integration for account opening flow |
| Verification | 5–6 | Server-side consent verification wired into core banking batch jobs (marketing extract, bancassurance feed, co-lending data share, bureau reporting); batch verification endpoints exercised at production-scale identifier counts |
| Orchestration | 6–8 | Deletion connectors: bancassurance partner (generic webhook with field-level scope), co-lending fintech (bidirectional webhook), internal CRM (generic webhook), WhatsApp Business (pre-built connector) |
| Cutover | 9–10 | Existing customer re-consent campaign; legacy T&C consent migrated to artefact model via the re-consent workflow; compliance dashboard reviewed by bank's DPO; DPB-facing audit export dry-run |

---

## 11. Worked Example — Bancassurance Revocation End-to-End

This example is the most common complex scenario a BFSI customer will face. It ties together all four surfaces and demonstrates the architectural claim that is load-bearing for the DPB examiner conversation.

**Setup.** Mrs. Sharma opens an account at a private bank on 15 January 2025. At account opening, the ConsentShield banner (rendered inside the digital onboarding flow) captures five separate purposes. The fan-out pipeline (Section 3.3) creates five artefacts:

```
cs_art_01HXX1  bureau_reporting        active  expires 2026-01-15
cs_art_01HXX2  insurance_marketing     active  expires 2026-01-15
cs_art_01HXX3  co_lending_fintech      active  expires 2026-01-15
cs_art_01HXX4  whatsapp_marketing      active  expires 2026-01-15
cs_art_01HXX5  analytics               active  expires 2026-01-15
```

The bank's core banking system stores the five artefact IDs against Mrs. Sharma's customer record.

**Operational baseline, weeks 1 through 60.** The bank's bancassurance engine runs a nightly job. Before it transmits the daily data file to the insurance partner, it calls `POST /v1/consent/verify/batch` with Mrs. Sharma and 12 million other customer IDs. The API returns a status per customer. Mrs. Sharma's status is `granted` for `insurance_marketing`. Her data is included in the file. The partner pulls the file and processes it. No DPDP issue.

**Revocation event — 10 March 2026.** Mrs. Sharma opens her banking app and withdraws consent for insurance marketing. The bank's app calls `POST /v1/consent/artefacts/cs_art_01HXX2/revoke`.

**What happens next, in order:**

**1. Immutable revocation record written.** A row is inserted into `artefact_revocations` with the artefact ID, the timestamp, the reason (`user_request`), and a new revocation record ID (`rev_01HXX7`). The original artefact row is not mutated — a database trigger (`trg_artefact_revocation_cascade`) updates its status to `revoked` in place, but all historical columns (notice_version, data_scope, captured_at) are preserved.

**2. Validity cache invalidated.** The entry for `cs_art_01HXX2` is removed from `consent_artefact_index` inside the same transaction as the revocation. The first verification call that runs after the transaction commits returns `status: revoked`.

**3. Deletion orchestration triggered.** The `process-artefact-revocation` Edge Function reads the artefact's `data_scope` field (`email_address`, `name`, `dob`, `account_type`, `nominee_name`) and queries `purpose_connector_mappings` for the artefact's purpose. It finds one mapped connector: `bancassurance_partner_connector`. One `deletion_receipts` row is created:

```
deletion_receipts:
  id: rcpt_01HXX8
  artefact_id: cs_art_01HXX2
  connector_id: bancassurance_partner_connector
  trigger_type: consent_revoked
  trigger_id: rev_01HXX7
  status: pending
  request_payload.data_scope: [email_address, name, dob, account_type, nominee_name]
```

The existing delivery pathway dispatches the instruction to the connector:

```json
POST https://partner-api.insurance-co.in/privacy/deletion
{
  "event": "deletion_request",
  "receipt_id": "rcpt_01HXX8",
  "artefact_id": "cs_art_01HXX2",
  "data_principal": { "identifier": "cust_987654", "identifier_type": "bank_customer_id" },
  "reason": "consent_revoked",
  "data_scope": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "purpose_code": "insurance_marketing",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/rcpt_01HXX8?sig=<HMAC>",
  "deadline": "2026-04-09T14:05:33Z"
}
```

**4. Partner confirms.** The insurance partner's privacy endpoint verifies the `X-ConsentShield-Signature` header, deletes the specified fields for Mrs. Sharma, and posts back:

```json
POST https://api.consentshield.in/v1/deletion-receipts/rcpt_01HXX8?sig=<HMAC>
{
  "receipt_id": "rcpt_01HXX8",
  "status": "completed",
  "records_deleted": 1,
  "fields_deleted": ["email_address", "name", "dob", "account_type", "nominee_name"],
  "completed_at": "2026-03-10T14:07:12Z"
}
```

**5. Receipt confirmed.** The same `deletion_receipts` row transitions from `status = 'pending'` to `status = 'confirmed'`. It is staged in `delivery_buffer` and exported to the bank's own S3 bucket overnight as part of the daily audit package.

**6. Other artefacts untouched.** `cs_art_01HXX1` (bureau reporting), `cs_art_01HXX3` (co-lending fintech), `cs_art_01HXX4` (WhatsApp), `cs_art_01HXX5` (analytics) remain `active`. CIBIL continues to receive Mrs. Sharma's repayment data — this is a statutory obligation under the Credit Information Companies Act. The co-lending fintech continues to receive her loan-servicing data under the Banking Regulation Act. The analytics platform continues to track her app behaviour. Only the bancassurance partner's records are purged, and only the five specific fields the insurance marketing consent authorised.

**7. Next morning.** The bancassurance nightly job calls `POST /v1/consent/verify/batch`. Mrs. Sharma's status is now `revoked`. Her record is excluded from the outbound file. No further data flows to the partner.

### 11.1 The DPB Examiner's Question

One year later, the Data Protection Board examines the bank. The examiner asks:

*"On 10 March 2026, when Mrs. Sharma withdrew insurance marketing consent, what was deleted, from which system, with what confirmation, and what was retained under which statute?"*

### 11.2 The Bank's Answer

> *"On 10 March 2026 at 14:05:33 IST, artefact `cs_art_01HXX2` (insurance_marketing) was revoked via revocation record `rev_01HXX7`. Deletion receipt `rcpt_01HXX8` was issued to the bancassurance partner at 14:05:35. The partner confirmed deletion at 14:07:12. Fields deleted: email_address, name, dob, account_type, nominee_name. No data was retained for this purpose; statutory retention does not apply to marketing consent."*
>
> *"The bureau reporting artefact (`cs_art_01HXX1`) remained active; Mrs. Sharma's repayment data continued to be reported to CIBIL under the Credit Information Companies Regulation Act. The co-lending artefact (`cs_art_01HXX3`) remained active; her loan-servicing data continued to flow to the co-lending partner under the Banking Regulation Act. The three-link audit chain (consent_artefacts → artefact_revocations → deletion_receipts) is attached."*

This is the answer the architecture produces. No retroactive reconstruction. No emails between compliance officers. No spreadsheet forensics. A single query resolves the examiner's entire inquiry.

---

## 12. Testing and Validation

A technical buyer will want to know how integration is validated before going live.

### 12.1 Sandbox Environment

Every customer account includes a separate sandbox organisation (`org_test_...`) with identical API surface, a zero-cost rate limit, and test data principal identifiers. All four surfaces work in sandbox identically to production. The sandbox is the standard environment for integration testing and CI/CD pipelines.

### 12.2 Consent Probe Testing

ConsentShield runs synthetic consent probes against the customer's production property on a configurable schedule. A probe loads the page in a controlled environment, sets a specific consent state (e.g., *"marketing declined"*), waits for the page to fully load, and inspects for any trackers that should have been blocked by that consent state.

This is a live test of the enforcement surface and runs continuously in production. Customers can configure probes for specific user journeys — *"the checkout flow must not load Meta Pixel before purchase consent"*, *"the signup flow must not fire Google Analytics before analytics consent"*.

Probes catch server-rendered hardcoded trackers that the banner script's MutationObserver cannot see (because they load before the banner script is active). Probes and real-time monitoring are complementary — neither alone is sufficient.

### 12.3 Deletion Receipt Validation

For generic webhook connectors, ConsentShield offers a `test_delete` endpoint that issues a no-op deletion instruction to the customer's endpoint. The customer confirms receipt, the signature verification path is exercised, the callback path is exercised, and no actual data is touched. This is the recommended smoke test after wiring a new webhook connector.

### 12.4 DPB Audit Export Dry-Run

Before going live, customers can generate a DPB-format audit export on demand. The export is a ZIP package containing consent artefacts, revocation records, deletion receipts, rights request logs, processing logs, and breach records over a specified time window. The dry-run exports a sandbox-only window; the production export exports production data. The package format is designed for DPB submission — it includes the three-link audit chain for every deletion and the statutory-retention annotations for every retained category.

### 12.5 Fan-Out Pipeline Monitoring

Two compliance metrics are exposed on the customer dashboard:

- **`orphan_consent_events`** — count of consent events stuck without corresponding artefacts for more than 10 minutes. Expected: 0.
- **`coverage_score`** — percentage of active purposes with valid `purpose_definition_id` mappings. Expected: 100%.

Any non-zero orphan count or sub-100% coverage score triggers an alert via the customer's notification channels and indicates a configuration issue to be investigated. These are the primary health indicators of the DEPA fan-out pipeline.

---

## 13. Frequently Asked Questions

**Does ConsentShield see our customers' personal data?**
For regulated categories (PAN, Aadhaar, account numbers, balances, transactions, bureau pulls, FHIR clinical records): no, structurally. These never enter any ConsentShield table, log, or buffer. See Section 8. For non-regulated identifiers (pseudonymous customer IDs, email hashes, mobile number hashes): yes, these are necessary to route consent verification and deletion orchestration. In Zero-Storage mode, even these transient identifiers are memory-only.

**What if our downstream partner cannot implement the webhook protocol?**
ConsentShield does not currently ship a file-based reconciliation mode as a general product. For partners that cannot accept real-time webhooks, a bespoke integration (typically a scheduled file drop to a customer-controlled SFTP or S3 bucket, with an attested reconciliation report) is available as an engineering engagement under the BFSI Enterprise tier. This is a degraded enforcement mode — deletion lag measured in days rather than seconds — and customers using it must disclose the lag in their privacy notice and to the DPB examiner on request.

**What happens if ConsentShield is down?**
The verification endpoint fails closed by default — the customer's system does not act on data when ConsentShield is unreachable, logging the suppression for audit. The banner is served from Cloudflare's edge and has a separate availability profile from the control plane. Consent events queue in the browser's localStorage and sync when connectivity is restored.

**Can we deploy ConsentShield on-premises?**
BFSI Enterprise and healthcare customers can deploy in Zero-Storage mode, where artefacts, revocations, deletion receipts, and audit records are written directly to the customer's own storage (R2, S3, or compatible) in their VPC or on-prem. The ConsentShield control plane (dashboard, API surface, fan-out pipeline, orchestration) remains SaaS. Full on-premises deployment of the control plane is not a currently offered product; it would be a custom engagement.

**How do we handle purpose changes — adding a new marketing channel, updating the privacy notice?**
The Purpose Definition Registry is versioned. Adding a new purpose does not invalidate existing artefacts. When the customer's privacy notice is updated, ConsentShield surfaces a re-consent campaign workflow that produces new artefacts (with the `replaced_by` chain tracking the re-consent history) for users who consent under the new notice. Existing artefacts under the old notice remain `active` until their natural expiry or until the user re-consents.

**What is your incident response if a deletion connector fails?**
Failed deletion instructions retry with exponential backoff for 24 hours. If the receipt remains at `status='pending'` past its `deadline`, it transitions to `status='overdue'`, an alert fires on the customer's ops channel, and the compliance dashboard flags the overdue deletion in red. The audit export records the failure, the retry history, and the outstanding obligation. Resolution is the customer's responsibility; ConsentShield provides the evidence trail.

**Can we use ConsentShield for GDPR as well?**
Yes. The GDPR module (Phase 3) uses the same artefact model with GDPR-specific rights variants (right to portability, right to object) and notice templates. A single organisation account can host both DPDP and GDPR compliance for EU-exposed Indian businesses. The underlying data plane — artefacts, revocations, deletion receipts — is framework-agnostic.

**Does ConsentShield operate as a registered Consent Manager under DPDP Rule 3?**
The ConsentShield software is delivered to customers via a partner company that carries the Consent Manager registration, the ₹2 crore net worth requirement, and the customer-facing regulatory accountability. Details of this partnership structure are in the ConsentShield Partnership Overview (v3).

**What does pricing look like for complex integrations?**
BFSI Enterprise (starting at ₹40,000/month) includes solutions engineer support during integration. For pure SaaS customers, Growth (₹5,999/mo) and Pro (₹9,999/mo) tiers are self-serve; Enterprise (₹24,999+/mo) includes dedicated onboarding. Healthcare bundle (₹5,000–₹8,000/mo) covers ABDM integration. Indicative ranges; contract pricing is negotiated.

**Is there a separate admin console?**
Yes. ConsentShield operators manage the platform via a separate Next.js application at `admin.consentshield.in`, gated by a distinct authentication context and hardware 2FA. Customer-side and admin-side identities are strictly separated (a single `auth.users` row is either a customer or an operator, never both). This is primarily an internal operational surface, not a customer integration concern.

---

## 14. What Comes Next

For a technical buyer who has read this far, the recommended next steps are:

1. **Sandbox provisioning.** A free sandbox organisation can be provisioned within the hour. This is the fastest way to inspect the API surface against your own architecture.

2. **Processing mode selection and reference architecture review.** A 60-minute call with the ConsentShield solutions team to (a) confirm the right processing mode for your sector and architecture, and (b) map your architecture against the reference patterns in Section 9 to identify the specific integration surfaces you need.

3. **Purpose Definition Registry scoping.** For BFSI and healthcare customers, the Purpose Definition Registry is the single most important configuration artefact. A working session to define your organisation's purposes, data scopes, statutory retention rules, and connector mappings. Typically 2–3 hours.

4. **Integration effort estimate.** A written estimate, based on the architecture review and Registry scoping, specifying the expected engineer-weeks, the connectors to be built, and the sequencing.

5. **Security documentation package.** SOC 2 audit status (currently underway; Type II report expected Q4 2026), penetration test summary, architecture diagrams, DPIA template for customer use, and the Zero-Storage architectural claim letter. Available under NDA.

---

## Appendix A — Complete API Surface Summary

### Public endpoints (no authentication)

| Route | Method | Protection |
|---|---|---|
| `cdn.consentshield.in/v1/banner.js` | GET | Rate limit 1000/IP/min |
| `cdn.consentshield.in/v1/events` | POST | HMAC signature + origin validation + rate limit 200/IP/min |
| `cdn.consentshield.in/v1/observations` | POST | HMAC signature + origin validation + rate limit 100/IP/min |
| `/api/public/rights-request` | POST | Cloudflare Turnstile + email OTP + rate limit 5/IP/hr |
| `/api/v1/deletion-receipts/{id}` | POST | HMAC-signed callback URL |

### Customer-tenant endpoints (Supabase JWT)

| Route | Method | Purpose |
|---|---|---|
| `/api/orgs/[orgId]/banners` | GET, POST | List/create banners |
| `/api/orgs/[orgId]/banners/[id]/publish` | POST | Activate banner |
| `/api/orgs/[orgId]/inventory` | GET, POST, PATCH | Data inventory CRUD |
| `/api/orgs/[orgId]/rights-requests` | GET | List rights requests |
| `/api/orgs/[orgId]/rights-requests/[id]` | PATCH | Update rights request |
| `/api/orgs/[orgId]/breaches` | GET, POST | Breach notifications |
| `/api/orgs/[orgId]/audit/export` | POST | Generate audit package |
| `/api/orgs/[orgId]/integrations` | GET, POST, DELETE | Manage connectors |
| `/api/orgs/[orgId]/integrations/[id]/delete` | POST | Trigger deletion via connector |
| `/api/orgs/[orgId]/notifications` | GET, PATCH | Notification channels |
| `/api/orgs/[orgId]/purpose-definitions` | GET, POST | Purpose Definition Registry |
| `/api/orgs/[orgId]/purpose-definitions/[id]` | GET, PATCH | Read/update a purpose definition |
| `/api/orgs/[orgId]/purpose-definitions/[id]/connectors` | GET, POST, DELETE | Purpose → connector mappings |
| `/api/orgs/[orgId]/artefacts` | GET | List consent artefacts |
| `/api/orgs/[orgId]/artefacts/[id]` | GET | Read artefact with full audit trail |
| `/api/orgs/[orgId]/artefacts/[id]/revoke` | POST | Revoke an artefact |
| `/api/orgs/[orgId]/expiry-queue` | GET | Upcoming expiry notifications |
| `/api/orgs/[orgId]/depa-score` | GET | DEPA compliance score |

### Compliance API (API key authentication — Pro and Enterprise tiers)

`Authorization: Bearer cs_live_xxxxxxxxxxxxxxxxxxxxxxxx`

<!-- BEGIN AUTO-GENERATED APPENDIX-A-COMPLIANCE-API -->
<!-- Generated 2026-04-26 by scripts/regenerate-whitepaper-appendix.ts from app/public/openapi.yaml -->
<!-- Do not hand-edit this section; the next regeneration will overwrite it. -->

| Route | Method | Tag | Scope |
|---|---|---|---|
| `/v1/_ping` | GET | Utility | _(any valid key)_ |
| `/v1/consent/artefacts` | GET | Consent | `read:artefacts` |
| `/v1/consent/artefacts/{id}` | GET | Consent | `read:artefacts` |
| `/v1/consent/artefacts/{id}/revoke` | POST | Consent | `write:artefacts` |
| `/v1/consent/events` | GET | Consent | `read:consent` |
| `/v1/consent/record` | POST | Consent | `write:consent` |
| `/v1/consent/verify` | GET | Consent | `read:consent` |
| `/v1/consent/verify/batch` | POST | Consent | `read:consent` |
| `/v1/deletion/receipts` | GET | Deletion | `read:deletion` |
| `/v1/deletion/trigger` | POST | Deletion | `write:deletion` |
| `/v1/integrations/{connector_id}/test_delete` | POST | Deletion | `write:deletion` |
| `/v1/rights/requests` | GET | Rights | `read:rights` |
| `/v1/rights/requests` | POST | Rights | `write:rights` |
| `/v1/audit` | GET | Audit | `read:audit` |
| `/v1/keys/self` | GET | Account | _(any valid key)_ |
| `/v1/plans` | GET | Account | _(any valid key)_ |
| `/v1/properties` | GET | Account | _(any valid key)_ |
| `/v1/purposes` | GET | Account | _(any valid key)_ |
| `/v1/usage` | GET | Account | _(any valid key)_ |
| `/v1/score` | GET | Score | `read:score` |
| `/v1/security/scans` | GET | Security | `read:security` |

<!-- END AUTO-GENERATED APPENDIX-A-COMPLIANCE-API -->

**Rate limits:** Starter 100/hr · Growth 1,000/hr · Pro 10,000/hr · Enterprise custom

---

## Appendix B — Webhook Payload Specifications

### B.1 Deletion Instruction (ConsentShield → Customer)

```json
{
  "event": "deletion_request",
  "receipt_id": "rcpt_01HXX8",
  "artefact_id": "cs_art_01HXX2 | null",
  "data_principal": {
    "identifier": "string",
    "identifier_type": "email | internal_customer_id | mobile_number | pan_hash | bank_customer_id"
  },
  "reason": "consent_revoked | consent_expired | erasure_request | retention_expired",
  "data_scope": ["field_1", "field_2", "..."],
  "purpose_code": "string",
  "callback_url": "https://api.consentshield.in/v1/deletion-receipts/{receipt_id}?sig={HMAC}",
  "deadline": "ISO 8601 timestamp",
  "issued_at": "ISO 8601 timestamp"
}
```

Request header: `X-ConsentShield-Signature: sha256=<HMAC-SHA256 of body using shared secret>`

`artefact_id` is non-null for `consent_revoked` and `consent_expired` triggers. It is null for `erasure_request` (which sweeps all active artefacts for the principal) and `retention_expired` (which is data-scope-driven, not artefact-driven).

### B.2 Deletion Confirmation (Customer → ConsentShield)

```json
{
  "receipt_id": "rcpt_01HXX8",
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

Callback URL is HMAC-signed by ConsentShield; the customer does not need to add its own signature. The endpoint rejects callbacks with invalid signatures or for receipts already in a terminal state.

### B.3 Notification Event (ConsentShield → Customer Ops Channel)

```json
{
  "event_type": "rights_request_received | sla_warning | violation_detected | orphan_consent_events | artefact_expiry_warning | deletion_overdue | ...",
  "severity": "info | warning | critical",
  "occurred_at": "ISO 8601 timestamp",
  "payload": { /* event-specific */ },
  "dashboard_url": "https://app.consentshield.in/..."
}
```

---

## Appendix C — Processing Mode Comparison

| Attribute | Standard | Insulated | Zero-Storage |
|---|---|---|---|
| ConsentShield holds operational config | ✓ | ✓ | ✓ |
| ConsentShield holds encrypted consent buffer | ✓ | – | – |
| ConsentShield holds consent artefact index | ✓ (persistent) | ✓ (persistent) | ✓ (TTL-bounded) |
| Customer storage target | CS-provisioned R2 | Customer's own R2/S3 | Customer's own R2/S3 |
| Customer controls encryption key | ✓ (delivered once) | ✓ (customer manages) | ✓ (customer manages) |
| ConsentShield can read stored data | – | – | – |
| Minimum tier | Starter | Growth | BFSI Enterprise / Healthcare |
| RBI outsourcing defensibility | Limited | Strong | Strongest |
| Mandatory for FHIR data | – | – | ✓ |
| Transient data retention on CS | Minutes | Minutes (buffer) | Seconds (memory only) |

---

## Appendix D — Pre-Built Connector Catalogue (April 2026)

| Service | Category | Deletion Operation | Status | Target |
|---|---|---|---|---|
| Mailchimp | Email marketing | `DELETE /lists/{id}/members/{hash}` | Shipping today | — |
| HubSpot | CRM | `DELETE /crm/v3/objects/contacts/{id}` | Shipping today | — |
| CleverTap | Engagement | `POST /delete/profiles` | Q3 2026 | ADR-1007 Sprint 1.1 |
| Razorpay | Payments (PMLA anonymisation) | `POST /customers/{id}/anonymize` | Q3 2026 | ADR-1007 Sprint 1.2 |
| WebEngage | Engagement | `DELETE /users/{id}` | Q3 2026 | ADR-1007 Sprint 1.3 |
| MoEngage | Engagement | `DELETE /v1/customer/{id}` | Q3 2026 | ADR-1007 Sprint 1.3 |
| Intercom | Support | `POST /user_delete_requests` | Q3 2026 | ADR-1007 Sprint 1.4 |
| Freshdesk | Support | `PUT /api/v2/contacts/{id}` (anonymise) | Q3 2026 | ADR-1007 Sprint 1.4 |
| Shopify | E-commerce | `DELETE /customers/{id}` | Q3 2026 | ADR-1007 Sprint 1.5 |
| WooCommerce | E-commerce | `POST /customers/{id}/anonymize` | Q3 2026 | ADR-1007 Sprint 1.5 |
| Segment | CDP | `POST /regulations` (async) | Q3 2026 | ADR-1007 Sprint 1.6 |
| Zoho CRM | CRM | `DELETE /crm/v2/Contacts/{id}` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Freshworks CRM | CRM | `DELETE /contacts/{id}` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Zendesk | Support | `POST /api/v2/users/{id}/deletions` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Campaign Monitor | Email marketing | `DELETE /subscribers.json` | Q4 2026 | ADR-1007 Sprint 3.1 |
| Mixpanel | Analytics | `POST /api/2.0/gdpr-requests` | Q4 2026 | ADR-1007 Sprint 3.1 |

**Status semantics.** *Shipping today* means the OAuth flow, deletion API call, token refresh, and integration-test coverage against a real partner test account are all live in production. *Q3 2026* and *Q4 2026* mean the connector has scoped acceptance criteria in the identified ADR sprint; delivery order within a quarter follows customer-pipeline signal rather than alphabet. Customers on the BFSI Enterprise tier that need a specific connector ahead of its target quarter can request acceleration under their engagement.

Custom connectors for bank-specific partners (bancassurance APIs, co-lending fintech APIs, bureau APIs) are built on request as part of the BFSI Enterprise engagement and are not tracked in this catalogue.

---

## Appendix E — Operational Maturity (Capability Status)

This appendix is the authoritative status inventory for every capability claimed in Sections 1 through 14. It is maintained as part of the whitepaper-closure ADR sequence (ADR-1001 through ADR-1008) and is regenerated whenever a gap closes. If this appendix conflicts with any paragraph in the body of this document, this appendix wins.

**Status semantics.**
- **Shipping** — production code path is live, exercised by integration tests, and available to customers today.
- **Beta** — production code path exists but has limited customer exposure, partial coverage, or a known gap flagged in the acceptance criteria of its owning ADR. Usable, but narrow.
- **Roadmap** — scoped in an ADR with a target quarter; not yet in production.

Target quarters are as of 2026-04-19 and reflect the solo-execution schedule of the closure plan (`docs/plans/ConsentShield-V2-Whitepaper-Closure-Plan.md`). Contractor capacity after G-013 closes may compress them.

### Architectural identity (§1)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Stateless compliance oracle architecture | Shipping | — | Foundational; ADR-0001 onwards |
| Process → deliver → delete pipeline | Shipping | — | ADR-0007, ADR-0017, ADR-0040 |
| Customer holds canonical compliance record (R2 upload) | Shipping | — | ADR-0040 |
| Processor-not-Fiduciary posture | Shipping (architectural) | — | Structural; runtime enforcement matures with G-041 |

### Processing modes (§2)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Standard mode | Shipping | — | Default for Starter tier |
| Insulated mode (BYOS) — data-plane | Beta | Q2 2026 (ADR-1003 Phase 2) | SigV4 upload live (ADR-0040); credential-validation UX is Roadmap (G-006) |
| Insulated mode — scoped-credential validation UX | Roadmap | Q2 2026 | G-006 (ADR-1003 Sprint 2.1) |
| Zero-Storage mode | Roadmap | Q2 2026 | G-005 + G-041 (ADR-1003 Phases 1, 3); mandatory for FHIR |
| `storage_mode` runtime enforcement | Roadmap | Q2 2026 | G-041 (ADR-1003 Phase 1); column exists today, enforcement does not |
| Mode migration (Standard → Insulated → Zero-Storage) | Beta | — | Manual/managed in v1; self-serve deferred (V2 backlog) |

### Consent artefact model (§3)

| Capability | Status | Target | Notes |
|---|---|---|---|
| One consent event → N artefacts fan-out | Shipping | — | ADR-0021 |
| Purpose Definition Registry | Shipping | — | ADR-0020; BFSI seed ADR-0030 |
| Trigger + safety-net cron fan-out pipeline | Shipping | — | ADR-0021 |
| `consent_artefact_index` validity cache | Shipping | — | ADR-0021 |
| Artefact lifecycle (active / revoked / expired / replaced) | Shipping | — | ADR-0022, ADR-0023 |
| Append-only artefacts (Security Rule 19) | Shipping | — | ADR-0020 |
| Mandatory expiry (Security Rule 20) | Shipping | — | ADR-0023 |
| `coverage_score` metric | Shipping | — | ADR-0025, ADR-0037 |
| `orphan_consent_events` metric + alert | Roadmap | Q3 2026 | G-048 (ADR-1004 Phase 3) |

### Surface 1 — Consent capture (§4)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Mode A — Web banner (script tag) | Shipping | — | ADR-0003 |
| Mode B — `POST /v1/consent/record` | Roadmap | Q2 2026 | G-038 (ADR-1002 Phase 2); critical for mobile/branch/kiosk/call-centre |
| Notice versioning + material-change re-consent | Beta | Q3 2026 | `consent_banners.version` today; full `notices` table + workflow is G-012 (ADR-1004 Phase 2) |
| WordPress plugin | Roadmap | Q3 2026 | G-022 (ADR-1007 Sprint 2.1) |
| Shopify App Store app | Roadmap | Q3 2026 | G-023 (ADR-1007 Sprint 2.2) |
| Webflow / Wix / Framer / Squarespace plugins | Roadmap | Decision Q3 2026 | G-029 — build vs. instructions vs. remove decision per platform |
| React Native SDK | Roadmap | Q4 2026+ | G-028; conditional on ABDM-phase demand |

### Surface 2 — Consent verification (§5)

| Capability | Status | Target | Notes |
|---|---|---|---|
| `GET /v1/consent/verify` | Shipping today | — | G-037 (ADR-1002 Phase 1) — identifier+property+purpose → granted/revoked/expired/never_consented |
| `POST /v1/consent/verify/batch` | Shipping today | — | G-037 (ADR-1002 Phase 1) — up to 10,000 identifiers per call; order preserved |
| Sub-50ms p99 latency SLO (measured) | Roadmap | Q3 2026 | One-shot baseline in ADR-1002; continuous measurement in G-027 (ADR-1008 Phase 1) |
| Client libraries: Node.js, Python | Roadmap | Q3 2026 | G-002 + G-003 (ADR-1006) |
| Client libraries: Java, Go | Roadmap | Q3 2026 | G-024 (ADR-1006 Phase 4) |
| Fail-closed default + `CONSENT_VERIFY_FAIL_OPEN` override | Roadmap | Q3 2026 | Lives in client libraries (ADR-1006); server returns deterministic status |

### Surface 3 — Deletion orchestration (§6)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Generic webhook protocol (HMAC-signed both directions) | Shipping | — | ADR-0007, ADR-0022; single-table `deletion_receipts` model |
| `purpose_connector_mappings` routing | Shipping | — | ADR-0020 |
| Artefact-scoped deletion | Shipping | — | ADR-0022 |
| Pre-built OAuth connectors — Mailchimp, HubSpot | Shipping | — | ADR-0018, ADR-0039 |
| Pre-built connector catalogue — CleverTap, Razorpay, WebEngage, MoEngage, Intercom, Freshdesk, Shopify, WooCommerce, Segment | Roadmap | Q3 2026 | G-016 – G-021 (ADR-1007 Phase 1) |
| Pre-built connector catalogue — Zoho, Freshworks, Zendesk, Campaign Monitor, Mixpanel | Roadmap | Q4 2026 | G-030 (ADR-1007 Phase 3) |
| Regulatory Exemption Engine (statutory-retention suppression) | Roadmap | Q3 2026 | G-007 + G-008 (ADR-1004 Phase 1); legal review in parallel |
| Reference webhook partner (case study) | Roadmap | Q3 2026 | G-011 (ADR-1005 Phase 1) |
| `test_delete` endpoint | Roadmap | Q3 2026 | G-035 (ADR-1005 Phase 2) |
| HMAC secret rotation (dual-window) | Roadmap | Q4 2026 | G-032 (ADR-1008 Phase 3) |
| Retry + timeout + overdue handling | Shipping | — | ADR-0011 |

### Surface 4 — Operational notifications (§7)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Email channel (Resend) | Shipping | — | ADR-0014 |
| Slack, Teams, Discord, PagerDuty, custom-webhook channels | Roadmap | Q3 2026 | G-043 (ADR-1005 Phase 6); `notification_channels` schema already exists |
| Alert-type catalogue (base set) | Shipping | — | ADR-0038 |
| Alert-type — orphan event | Roadmap | Q3 2026 | G-048 |
| Alert-type — artefact expiry warning (30d) | Shipping | — | ADR-0023 |
| Per-severity channel routing | Roadmap | Q3 2026 | G-043 Sprint 6.4 |

### Zero-persistence for regulated content (§8)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Category labels, never content values (Security Rule 3) | Shipping (structural) | — | DDL contains no column accepting regulated content |
| Banking identifiers enumeration | Shipping (documentation) | — | 2026-04-16 broadening |
| FHIR clinical records excluded | Shipping (structural) | — | Same |
| Runtime enforcement under Zero-Storage | Roadmap | Q2 2026 | G-041 |

### Reference architectures (§9)

| Capability | Status | Target | Notes |
|---|---|---|---|
| 9.1 Pure Web SaaS (Standard / Insulated) | Shipping | — | Banner + 2 connectors + portal executable today |
| 9.2 Mobile-first NBFC | Roadmap | Q2 2026 | Depends on G-037 + G-038 |
| 9.3 Private Bank (Zero-Storage) | Roadmap | Q3 2026 | Depends on G-037 + G-038 + G-041 + G-007 |
| 9.4 Healthcare clinic (ABDM) | Roadmap | Q3 2026 | Depends on G-038 + G-041 + G-042 |

### Testing + validation (§12)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Sandbox organisations (`org_test_*`) | Roadmap | Q2 2026 | G-046 (ADR-1003 Phase 5) |
| Consent probes (headless browser, scheduled) | Shipping | — | ADR-0041 (Vercel Sandbox runner + probe CRUD UI) |
| Tracker signature coverage (≥ 200 fingerprints) | Beta | Q4 2026 | Catalogue framework shipped (ADR-0031); corpus expansion is G-047 (ADR-1008 Phase 2) |
| DPB-format audit export (CSV + manifest) | Beta | Q4 2026 | JSON-sectioned ZIP ships today (ADR-0017 / ADR-0040); CSV alignment is G-044 + G-026 (ADR-1008 Phase 2) |
| `test_delete` smoke-test endpoint | Roadmap | Q3 2026 | G-035 |

### Public compliance API (§Appendix A)

| Capability | Status | Target | Notes |
|---|---|---|---|
| `cs_live_*` bearer-token API keys | Shipping today | — | G-036 (ADR-1001 Sprints 2.1–2.4) — issuance, rotation, revocation, dual-window, rate limiting shipped |
| Rate-tier enforcement per plan | Shipping today | — | G-036 Sprint 2.4 — 100/hr starter, 1000/hr growth, 10k/hr pro, 100k/hr enterprise |
| `/v1/consent/{verify, verify/batch, record}` | Shipping today | — | G-037 + G-038 (ADR-1002 Phases 1–2) |
| `/v1/consent/artefacts` + revoke + events | Shipping today | — | G-039 (ADR-1002 Phase 3) |
| `/v1/deletion/trigger` + receipts list | Shipping today | — | G-040 (ADR-1002 Phase 4); `reason=retention_expired` deferred |
| `/v1/rights/requests` (list + create) | Roadmap | Q3 2026 | G-049 (ADR-1005 Phase 5); public portal + OTP path is Shipping |
| `/v1/deletion-receipts/{id}` callback | Shipping | — | ADR-0022 (HMAC-signed customer callback) |
| Public OpenAPI spec + CI drift check against Appendix A | Roadmap | Q3 2026 | G-045 (ADR-1006 Phase 3); once landed, Appendix A is regenerated from `openapi.yaml` |

### Operations + support (§13 FAQ, §14)

| Capability | Status | Target | Notes |
|---|---|---|---|
| Written SLA per tier | Roadmap | Q3 2026 | G-014 (ADR-1005 Phase 3) |
| Severity matrix + on-call rotation | Roadmap | Q3 2026 | G-014 |
| Public status page (`status.consentshield.in`) | Roadmap | Q3 2026 | G-015 (ADR-1005 Phase 4) |
| Solutions-engineer support (BFSI Enterprise) | Roadmap | Q3 2026 | G-013 (ADR-1005 Phase 3) — hire vs. contract decision pending |
| SOC 2 Type I | Roadmap | Q4 2026 | Not yet available |
| SOC 2 Type II | Roadmap | H1 2027 (realistic) | G-033 (ADR-1008 Phase 3) — observation-period start being confirmed; original Q4 2026 target softened |
| Separate admin console (admin.consentshield.in) | Shipping | — | ADR-0028 through ADR-0050 |
| Identity isolation (customer vs operator — Security Rule 12) | Shipping | — | ADR-0043, ADR-0044, ADR-0045, ADR-0047 |
| Consent Manager registration (via partner company) | Shipping (commercial) | — | See Partnership Overview v3 |

### Sector templates

| Capability | Status | Target | Notes |
|---|---|---|---|
| BFSI sector template | Shipping | — | ADR-0030; seed in `20260502000003_bfsi_template_seed.sql` |
| Healthcare sector template (ABDM + DISHA) | Roadmap | Q3 2026 | G-042 (ADR-1003 Phase 4) |
| E-commerce / SaaS / Edtech / Insurance seeds | Roadmap | Demand-driven | Added when first customer in sector signs |

---

*This appendix is regenerated when any gap in the closure plan closes. Last refreshed: 2026-04-19 (ADR-1001 Sprint 1.2).*

---

*Document prepared April 2026. Version 2.0. This is a technical white paper. For commercial terms, contract structure, and partnership details, see the ConsentShield Partnership Overview (v3). For the underlying data architecture, see the Definitive Architecture Reference and the Complete Schema Design. For BFSI-specific go-to-market framing, see the BFSI Segment Brief (v2) and the DEPA-Banking Bridge.*
