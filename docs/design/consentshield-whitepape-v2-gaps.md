# ConsentShield — Whitepaper-to-Code Gap Document

*Generated: April 2026*
*Source: Critical evaluation of Customer-Side Integration Whitepaper v2.0 (April 2026)*
*Audience: Engineering, for sprint planning and ticketing*
*Companion to: ConsentShield-Customer-Integration-Whitepaper-v2.docx, Definitive Architecture Reference, Complete Schema Design*

---

## Purpose

The v2.0 whitepaper accurately describes the **target product** at end-of-Phase-2. This document enumerates the gaps between target and current implementation, structured so each gap is a discrete unit of engineering work with explicit acceptance criteria.

## How to use this document

- Each gap has a stable ID (`G-NNN`) for cross-reference in tickets, PRs, and commit messages.
- Acceptance criteria are written as testable statements — when all criteria pass, the gap is closed.
- Priority bands are tied to delivery gates (see next section), not arbitrary urgency levels.
- Effort estimates are wall-clock weeks for a solo developer with focused attention. Adjust if contractor capacity or parallelism is added.

## Priority bands → Delivery gates

| Band | Closes before | Rationale |
|---|---|---|
| **P0** | Whitepaper goes to any BFSI / healthcare prospect | Active misrepresentation if not closed. Discovered during procurement = lost deal + reputation damage |
| **P1** | First BFSI Enterprise or Healthcare customer goes live | Promised capability that customer will exercise on day one |
| **P2** | Whitepaper claims fully deliverable at scale across all 4 archetypes | Required for the document to be ironclad rather than aspirational |
| **P3** | Phase 4 or post-launch hardening | Nice-to-have, deferrable, not blocking |

---

## Gap summary

| ID | Title | Priority | Effort |
|---|---|---|---|
| G-001 | Connector catalogue accuracy in marketing materials | P0 | 0.5 day |
| G-002 | Node.js client library with fail-closed default | P0 | 1 week |
| G-003 | Python client library with fail-closed default | P0 | 1 week |
| G-004 | Operational Maturity appendix in whitepaper | P0 | 1 day |
| G-005 | Zero-Storage mode end-to-end production validation | P1 | 3 weeks |
| G-006 | Insulated mode (BYOS) end-to-end validation | P1 | 2 weeks |
| G-007 | Regulatory Exemption Engine — schema + sector templates | P1 | 3 weeks |
| G-008 | Regulatory Exemption Engine — legal review of mappings | P1 | 2 weeks (legal lead time) |
| G-009 | Batch verification load test at 1M+ identifiers | P1 | 1 week |
| G-010 | DEPA fan-out pipeline spike load test | P1 | 1 week |
| G-011 | Generic webhook protocol — reference implementation | P1 | 2 weeks |
| G-012 | Notice versioning — minimum re-consent workflow | P1 | 3 weeks |
| G-013 | Solutions engineer capacity — hire or contract | P1 | Ongoing org work |
| G-014 | Production support model — definition + tooling | P1 | 2 weeks |
| G-015 | Status page + incident communication infrastructure | P1 | 1 week |
| G-016 | CleverTap connector | P2 | 1 week |
| G-017 | Razorpay anonymisation connector | P2 | 1 week |
| G-018 | WebEngage + MoEngage connectors | P2 | 2 weeks |
| G-019 | Intercom + Freshdesk connectors | P2 | 2 weeks |
| G-020 | Shopify + WooCommerce connectors | P2 | 2 weeks |
| G-021 | Segment connector | P2 | 1 week |
| G-022 | WordPress plugin | P2 | 2 weeks |
| G-023 | Shopify App Store plugin + listing | P2 | 3 weeks |
| G-024 | Java + Go client libraries | P2 | 2 weeks |
| G-025 | Consent probe testing infrastructure | P2 | 4 weeks |
| G-026 | DPB-format audit export structured packaging | P2 | 2 weeks |
| G-027 | Sub-50ms verify p99 SLO — measurement + infrastructure | P2 | 2 weeks |
| G-028 | React Native consent component (drop-in modal) | P3 | 3 weeks |
| G-029 | Webflow / Wix / Framer / Squarespace plugin decision | P3 | 0.5 day (decision) + variable |
| G-030 | Q3 2026 connector batch (Zoho, Freshworks, Zendesk, Campaign Monitor, Mixpanel) | P3 | 4 weeks |
| G-031 | Re-consent campaign multi-channel delivery | P3 | 4 weeks |
| G-032 | HMAC signature secret rotation mechanism | P3 | 1 week |
| G-033 | SOC 2 Type II audit observation period — verify start | P3 | Audit/process work |
| G-034 | Compliance dashboard surfacing of orphan / overdue / expiry metrics | P2 | 2 weeks |
| G-035 | `test_delete` endpoint for connector smoke testing | P2 | 1 week |

**Total P0 effort:** ~2.5 weeks
**Total P1 effort:** ~17 engineering weeks (significant external dependencies on legal review + hiring)
**Total P2 effort:** ~22 engineering weeks
**Total P3 effort:** ~12 engineering weeks (some non-engineering)

---

## P0 — Close before BFSI/Healthcare whitepaper distribution

### G-001 — Connector catalogue accuracy in marketing materials

**Whitepaper section:** Appendix D
**Whitepaper claim:** 11 services listed as "Shipping" today (Mailchimp, HubSpot, Freshdesk, Intercom, CleverTap, WebEngage, MoEngage, Shopify, WooCommerce, Razorpay, Segment).
**Current state:** Only Mailchimp + HubSpot are built and tested.
**Target state:** Catalogue accurately reflects shipping vs roadmap status, with realistic delivery dates per non-shipping service.

**Acceptance criteria:**
- Appendix D in whitepaper edited to mark only Mailchimp + HubSpot as "Shipping today"
- All other services moved to "Q3 2026" or "On request" with concrete dates
- Same change applied to landing page (`consentshield-landing.html`), product site (`consentshield-site.html`), and any sales decks
- README in `/connectors` directory matches the whitepaper claims exactly

**Effort:** 0.5 day
**Dependencies:** None
**Owner:** Founder (marketing/sales surface owner)

---

### G-002 — Node.js client library with fail-closed default

**Whitepaper section:** §5.4
**Whitepaper claim:** "ConsentShield's client libraries (Node.js, Python, Java, Go — delivered under the Pro and Enterprise tiers) ship with a default 2-second timeout and fail-closed behaviour."
**Current state:** No client libraries shipped. Customers integrate via raw HTTP, with no enforcement of fail-closed semantics.
**Target state:** Production Node.js library published to npm with documented fail-closed behaviour, used by at least one internal sample integration.

**Acceptance criteria:**
- `@consentshield/node` package published to npm with semver 1.0.0
- Library exposes `verify(principalId, purposeCode)`, `verifyBatch([...])`, `recordConsent(...)`, `revoke(artefactId)`, `triggerDeletion(...)` methods
- 2-second default timeout, fail-closed (throws `ConsentVerifyError` on network failure rather than returning `granted`)
- `CONSENT_VERIFY_FAIL_OPEN=true` env flag overrides fail-closed and logs the override decision to audit trail
- Includes TypeScript type definitions
- README + integration example for Express/Next.js
- Publishes to ConsentShield's audit log when fail-open mode is engaged
- Unit test coverage ≥ 80%
- Internal smoke test integration in the ConsentShield admin app uses the library against staging

**Effort:** 1 week
**Dependencies:** Stable v1 API surface (already exists)
**Owner:** Founder

---

### G-003 — Python client library with fail-closed default

**Whitepaper section:** §5.4
**Whitepaper claim:** Same as G-002, language list includes Python.
**Current state:** Same as G-002.
**Target state:** Production Python library published to PyPI.

**Acceptance criteria:**
- `consentshield` package published to PyPI with version 1.0.0
- API parity with Node.js library (same method names, same semantics)
- Fail-closed default with `CONSENT_VERIFY_FAIL_OPEN` override
- Compatible with Python 3.9+ (Django, Flask, FastAPI integration examples)
- Includes type hints (mypy clean)
- Tests with ≥ 80% coverage
- Internal smoke test against staging

**Effort:** 1 week
**Dependencies:** G-002 to settle the API surface conventions
**Owner:** Founder

---

### G-004 — Operational Maturity appendix in whitepaper

**Whitepaper section:** New appendix to be added (suggest Appendix E)
**Whitepaper claim:** Various capabilities described as live throughout document.
**Current state:** Some are live, some are partial, some are planned. No transparent inventory exists in customer-facing material.
**Target state:** A capability status appendix listing every claimed capability with Shipping / Beta / Roadmap status and a target date for non-shipping items.

**Acceptance criteria:**
- New Appendix E added to whitepaper with table: Capability | Status | Target date | Notes
- Capabilities enumerated from §1–§14 of whitepaper, minimum 30 rows
- Each capability flagged honestly: Shipping (production) / Beta (limited customer use) / Roadmap (timeline only)
- For Roadmap items: target quarter committed
- Same appendix mirrored in any sales pitch deck used in security reviews
- Appendix is referenced from a new line in the Executive Summary

**Effort:** 1 day
**Dependencies:** Honest internal inventory of current state
**Owner:** Founder

---

## P1 — Close before first BFSI Enterprise / Healthcare go-live

### G-005 — Zero-Storage mode end-to-end production validation

**Whitepaper section:** §2.1, §2.2, §9.3, §9.4, Appendix C
**Whitepaper claim:** Zero-Storage mode is production-deployable, mandatory for FHIR data, recommended for BFSI Enterprise.
**Current state:** Architecture supports the concept; production code path differences from Standard/Insulated mode not validated end-to-end.
**Target state:** Zero-Storage mode runs in production for at least one customer (or one comprehensive internal test deployment) for ≥ 4 weeks with documented operational metrics.

**Acceptance criteria:**
- `storage_mode = 'zero_storage'` org configuration enforced at API gateway layer (Security Rule 9 implementation verified)
- TTL-bounded `consent_artefact_index` behaviour implemented: artefacts evicted from index after configurable TTL (default 24h), refreshed on read or by background job from customer storage
- Memory-only `delivery_buffer` flow path: data never lands in any persistent table for Zero-Storage orgs; verified with database query that returns zero rows for Zero-Storage org IDs in any persistent table
- Incident runbook documented: "What happens when ConsentShield restarts during Zero-Storage delivery?" answered
- Internal load test: 100K consent events processed in Zero-Storage mode with zero personal data in persistent tables (verified by query)
- One launch-partner customer or internal test deployment running for 4 weeks with metrics dashboard
- Documented gap analysis: things that work in Standard mode but require special handling in Zero-Storage (re-export from buffer is impossible, consent re-display requires customer fetch)

**Effort:** 3 weeks
**Dependencies:** Insulated mode validated first (G-006), since Zero-Storage is Insulated + memory-only constraint
**Owner:** Founder

---

### G-006 — Insulated mode (BYOS) end-to-end validation

**Whitepaper section:** §2.1, §2.3
**Whitepaper claim:** Customer's own R2 or S3 bucket with write-only credential; ConsentShield cannot read, list, or delete.
**Current state:** Schema supports the configuration; full pipeline validated only with CS-provisioned R2 (Standard mode).
**Target state:** Insulated mode validated end-to-end with a customer-owned bucket on at least one cloud provider.

**Acceptance criteria:**
- IAM credential validation flow: customer pastes credentials in dashboard → CS performs `PutObject` test → CS performs scoped `HeadObject` to verify the object exists → success/failure surfaced to user
- Validation rejects credentials with `s3:GetObject`, `s3:ListBucket`, or `s3:DeleteObject` permissions (CS verifies the credential is actually scoped down)
- Encrypted credential storage with per-org key derivation (existing pattern)
- Tested against AWS S3, Cloudflare R2, and one S3-compatible provider (DigitalOcean Spaces or Backblaze B2)
- Documentation: customer-facing "How to provision a BYOS bucket" guide for AWS S3 and Cloudflare R2 (with IAM policy JSON / R2 token recipe)
- Migration path: documented procedure for moving an existing Standard-mode customer to Insulated mode
- One launch-partner customer running in Insulated mode for ≥ 4 weeks

**Effort:** 2 weeks
**Dependencies:** None
**Owner:** Founder

---

### G-007 — Regulatory Exemption Engine — schema + sector templates

**Whitepaper section:** §9.2, §9.3, §10.2, §10.3, §11
**Whitepaper claim:** "Regulatory Exemption Engine configured for RBI KYC and PMLA retention categories" (mentioned in passing, treated as a built capability).
**Current state:** Conceptual; no schema exists for sector-specific exemption rules.
**Target state:** A queryable rules engine that, given (sector, data category, statute), returns retention requirements; pre-populated for BFSI sector at minimum.

**Acceptance criteria:**
- `regulatory_exemptions` table exists with columns: `id`, `org_id` (nullable for platform defaults), `sector`, `statute`, `data_category`, `retention_period`, `source_citation`, `precedence`, `applies_to_purposes` (array)
- Platform defaults for BFSI: rows for RBI KYC Master Directions, PMLA, Banking Regulation Act, Credit Information Companies Act, Insurance Act § 64VB
- Platform defaults for Healthcare: rows for ABDM, DISHA, Clinical Establishments Act
- Per-org overrides supported: an org can add its own exemption rule (with audit trail)
- Deletion orchestration consults the engine: when a deletion would violate a retention rule, the engine returns the statute and the deletion is suppressed with explanation in audit log
- Compliance dashboard surfaces exemptions applied: "X records retained under RBI KYC" with drill-down
- API endpoint: `GET /api/orgs/[orgId]/regulatory-exemptions` for the customer to inspect what's configured
- Unit tests covering: BFSI marketing artefact (no retention) → deletion proceeds; BFSI bureau reporting artefact → retention enforced; healthcare clinical record → DISHA retention enforced

**Effort:** 3 weeks
**Dependencies:** Stable schema for `consent_artefacts.data_scope` (exists)
**Owner:** Founder

---

### G-008 — Regulatory Exemption Engine — legal review of mappings

**Whitepaper section:** §9.3 (RBI KYC, PMLA, Banking Regulation Act, Credit Information Companies Act references); §9.4 (ABDM, DISHA references)
**Whitepaper claim:** Implies authoritative knowledge of which statute requires which retention period for which data category.
**Current state:** Mappings are derived from founder's research; no professional review.
**Target state:** Mappings reviewed and signed off by an Indian regulatory lawyer with sector expertise.

**Acceptance criteria:**
- Engagement letter signed with at least one Indian regulatory lawyer (BFSI focus + healthcare focus, can be one firm or two)
- Reviewed mappings cover: BFSI (10+ statutes), Healthcare (5+ statutes), Telecom and Insurance as future-state placeholders
- Reviewer's notes captured per row in a `legal_review_notes` field of `regulatory_exemptions`
- Review date and reviewer credentials captured per row
- Process documented: when does a mapping get re-reviewed? (Trigger: regulator publishes amendment; default: annual review)
- Reviewer's letter saved as evidence document for inclusion in customer security packs
- Budget: ₹2–3 lakh allocated and spent

**Effort:** 2 weeks elapsed (mostly legal lead time, founder's coding effort is ~3 days for review-prep + ingestion)
**Dependencies:** G-007 schema exists; lawyer engagement
**Owner:** Founder + external counsel

---

### G-009 — Batch verification load test at 1M+ identifiers

**Whitepaper section:** §5.3, §11
**Whitepaper claim:** "Up to 10,000 identifiers per call. For larger batches (a bank with 12 million customers running a nightly bancassurance reconciliation), the customer issues multiple calls in parallel; the underlying validity cache can sustain the aggregate throughput."
**Current state:** Unverified at scale.
**Target state:** Documented load test result with concrete numbers.

**Acceptance criteria:**
- Load test infrastructure provisioned (k6, Artillery, or Locust)
- Test scenario: 100 concurrent batch calls, each 10,000 identifiers, run for 10 minutes (simulates 60M identifier verifications/min sustained)
- Measured: p50, p95, p99 latency per batch call; error rate; database CPU and connection pool saturation; Cloudflare Worker subrequest exhaustion
- Test run against a staging environment with `consent_artefact_index` populated with 50M+ artefact rows
- Documented results published in an internal SLO document
- If results don't meet sub-50ms p99 (G-027), follow-on work to add edge caching or regional replicas tracked as separate gap
- Realistic per-tier rate limits set based on observed sustainable throughput
- Customer-facing documentation updated: "BFSI Enterprise customers running nightly reconciliations of 10M+ identifiers should batch into N parallel calls for optimal throughput"

**Effort:** 1 week
**Dependencies:** Staging environment with realistic data volume; G-007 not blocking
**Owner:** Founder

---

### G-010 — DEPA fan-out pipeline spike load test

**Whitepaper section:** §3.3
**Whitepaper claim:** Fan-out is bounded by trigger latency + 5-minute pg_cron safety net; orphan metric alerts at 10 minutes.
**Current state:** Architecture verified for steady state; spike behaviour unverified.
**Target state:** Documented behaviour under realistic spike load.

**Acceptance criteria:**
- Spike scenario: 50,000 consent events written within 12 hours (simulates a bank's launch-day account-opening surge), each producing 5 artefacts (250,000 artefact rows)
- Measured: trigger fire-rate, Edge Function execution time, validity cache UPSERT contention, safety-net cron latency, end-to-end event-to-artefact time distribution
- p99 event-to-artefact latency documented; SLO set ("99% of consent events have artefacts within 30 seconds")
- Orphan event detection verified: if a trigger fires fail, safety net catches the orphan within 10 minutes
- Idempotency verified: replaying the same consent_event_id produces zero duplicate artefacts
- Results published to internal SLO document
- Customer-facing documentation: "Fan-out latency SLO" mentioned in §3.3 of whitepaper

**Effort:** 1 week
**Dependencies:** Staging environment
**Owner:** Founder

---

### G-011 — Generic webhook protocol — reference implementation with friendly partner

**Whitepaper section:** §6.3
**Whitepaper claim:** Universal interface for any downstream system, with two-way HMAC, retry policy, deadline enforcement, partial completion semantics.
**Current state:** Protocol specified; no end-to-end production exercise with a real partner.
**Target state:** One real partner integration in production, used as canonical case study.

**Acceptance criteria:**
- Identify and onboard one friendly partner (a Hyderabad fintech, a non-customer's internal system, or an internal sample backend) willing to be the launch reference
- Partner implements the full webhook protocol: HMAC verification on receive, deletion execution, signed callback with `completed | partial | failed | deferred` status
- ConsentShield instructs ≥ 100 deletions to the partner in production-like conditions
- Measured: instruction delivery success rate, callback success rate, retry behaviour on simulated partner failure (return 500 to first 3 attempts, success on 4th), overdue handling at deadline
- Documented case study (anonymised if needed) used in BFSI sales conversations
- `test_delete` endpoint (G-035) used as the smoke test customers run before going live

**Effort:** 2 weeks
**Dependencies:** G-035 (test_delete endpoint); willing partner
**Owner:** Founder

---

### G-012 — Notice versioning — minimum re-consent workflow

**Whitepaper section:** §4.3
**Whitepaper claim:** "ConsentShield surfaces a re-consent campaign workflow: it enumerates the affected active artefacts, offers template messages, and produces new artefacts (with `replaced_by` chaining to the old ones) as users re-consent under the new notice."
**Current state:** `notice_version` field exists on `consent_events`; replacement chain (`replaced_by`) field exists on `consent_artefacts`; the workflow connecting them does not exist.
**Target state:** A minimum viable re-consent workflow that doesn't require multi-channel campaign delivery (deferred to G-031).

**Acceptance criteria:**
- New `notices` table with: `id`, `org_id`, `version`, `title`, `published_at`, `material_change_flag`
- When a customer publishes a new notice with `material_change_flag = true`, system enumerates affected active artefacts (those with the prior notice version reference)
- Dashboard surface: "X artefacts on prior notice version — re-consent campaign" with action button
- Action: generate a CSV export of affected data principals (identifier, email if known, last consent date) for the customer to feed into their own messaging system
- When a data principal re-consents (via banner or API), `replaced_by` chain is correctly populated linking new artefact to old
- Old artefact remains `active` until natural expiry or until user explicitly revokes
- Audit trail: customer can show DPB examiner "the re-consent campaign for notice v2026-04 affected N principals; M re-consented; K revoked; L did not respond"

**Effort:** 3 weeks
**Dependencies:** G-007 (regulatory exemption engine helps with deciding which old-notice artefacts persist under statutory exemption vs require re-consent)
**Owner:** Founder

---

### G-013 — Solutions engineer capacity — hire or contract

**Whitepaper section:** §11 (BFSI Enterprise pricing implies SE support); §14 (recommended next steps imply consultative onboarding)
**Whitepaper claim:** "BFSI Enterprise (starting at ₹40,000/month) includes solutions engineer support during integration."
**Current state:** Founder is the only resource. Cannot personally onboard 5 simultaneous BFSI Enterprise customers with 6–10 week integration timelines each.
**Target state:** Sufficient SE capacity for the BFSI pipeline, before more than 2 BFSI Enterprise customers are signed.

**Acceptance criteria:**
- Decision documented: hire (full-time) or contract (per-engagement)
- If contract: at least 2 named contractors identified with BFSI integration experience, rate cards agreed
- If hire: job spec written, search underway, target start date set
- Either way: a written process exists for handing off a BFSI customer from sales (founder) to integration (SE), including all documents required (Purpose Definition Registry scope, processing mode decision, connector inventory)
- BFSI pipeline capped at 2 simultaneous integrations until SE capacity is online
- Pricing model: SE-hours included per tier vs additional billable, decided

**Effort:** Ongoing organisational work; first hire/contract within 8 weeks of P1 trigger
**Dependencies:** Cash runway, partnership structure (Partnership Overview v3)
**Owner:** Founder

---

### G-014 — Production support model — definition + tooling

**Whitepaper section:** §13 FAQ, implied by BFSI Enterprise pricing
**Whitepaper claim:** Implicit reliability expected at ₹40K+/month tier.
**Current state:** No formal SLA, no on-call rotation, no incident response process documented.
**Target state:** Documented support model that BFSI procurement can review and accept.

**Acceptance criteria:**
- Written SLA per tier: response time, resolution time, planned maintenance window, uptime commitment (suggest 99.5% Starter, 99.9% Pro/BFSI Growth, 99.95% BFSI Enterprise / Healthcare)
- Documented incident severity matrix (SEV1: data loss / silent compliance failure → 30-min response; SEV2: feature outage → 2-hour response; SEV3: cosmetic → next business day)
- On-call schedule: Indian business hours = founder; nights/weekends = founder on rotation initially, transitioning to a contractor or hire
- Incident communication channel: email + status page + Slack-bridge if customer requests
- Post-incident process: written incident report within 5 business days for SEV1/SEV2, shared with affected customers
- Tooling: PagerDuty (or equivalent) account with primary on-call defined
- BFSI Enterprise contracts include the SLA as a schedule

**Effort:** 2 weeks (process design + tooling setup; ongoing operationalisation thereafter)
**Dependencies:** G-013 (capacity)
**Owner:** Founder

---

### G-015 — Status page + incident communication infrastructure

**Whitepaper section:** Implied operational maturity
**Whitepaper claim:** None explicit; expected by BFSI procurement.
**Current state:** No status page.
**Target state:** Public status page with subsystem-level uptime reporting and incident history.

**Acceptance criteria:**
- Status page provisioned at `status.consentshield.in` (StatusPage.io, Atlassian Statuspage, or self-hosted Cachet)
- Subsystems tracked: Banner CDN, Consent Capture API, Verification API, Deletion Orchestration, Dashboard, Notification Channels
- Automated uptime probes for each subsystem every 5 minutes, results published
- Incident posting workflow: founder can post incident in < 2 minutes from a phone
- Subscriber notifications: customers can subscribe to email or webhook updates
- Uptime history retained for 90 days minimum
- Linked from main site footer and dashboard

**Effort:** 1 week
**Dependencies:** None
**Owner:** Founder

---

## P2 — Required for full whitepaper deliverability across all archetypes

### G-016 — CleverTap connector

**Whitepaper section:** Appendix D, §9.2
**Whitepaper claim:** Listed as Shipping pre-G-001; will be honestly Q3 2026 post-G-001. This gap is the actual build.
**Current state:** Not built.
**Target state:** Production OAuth connector for CleverTap with delete-user scope.

**Acceptance criteria:**
- OAuth app registered with CleverTap; ConsentShield's app approved
- Connector setup flow in dashboard: customer clicks Connect → OAuth redirect → returns with active connector
- Deletion execution: `POST /delete/profiles` invoked with the data principal's identifier when an artefact mapped to the CleverTap connector is revoked
- Response handling: success → `deletion_receipts.status = 'confirmed'`; failure → `failed` with error captured
- Token refresh logic for expired OAuth tokens
- Error handling for CleverTap API rate limits
- Documentation: customer-facing setup guide
- Integration test: real CleverTap test account, end-to-end deletion flow

**Effort:** 1 week
**Dependencies:** G-002 conventions for connector implementation
**Owner:** Founder

---

### G-017 — Razorpay anonymisation connector

**Whitepaper section:** Appendix D
**Whitepaper claim:** Razorpay anonymisation (PMLA retention).
**Current state:** Not built.
**Target state:** Production connector that calls Razorpay's customer anonymisation API.

**Acceptance criteria:**
- OAuth setup flow with Razorpay
- `POST /customers/{id}/anonymize` invoked on deletion instruction
- Special handling: PMLA retention rules consulted via Regulatory Exemption Engine (G-007); transaction records explicitly NOT deleted, only PII fields anonymised
- Documentation explains the PMLA-compliant pattern to customer

**Effort:** 1 week
**Dependencies:** G-007 (regulatory exemption integration), G-016 conventions
**Owner:** Founder

---

### G-018 — WebEngage + MoEngage connectors

**Whitepaper section:** Appendix D
**Current state:** Not built.
**Target state:** Two production OAuth connectors, used for customer engagement deletion in NBFC and B2C scenarios.

**Acceptance criteria:**
- WebEngage: `DELETE /users/{id}` invoked on revocation
- MoEngage: `DELETE /v1/customer/{id}` invoked on revocation
- Both follow same patterns as CleverTap (OAuth, retry, token refresh, error handling, dashboard integration)
- Integration tests against real test accounts

**Effort:** 2 weeks (1 each)
**Dependencies:** G-016 conventions
**Owner:** Founder

---

### G-019 — Intercom + Freshdesk connectors

**Whitepaper section:** Appendix D
**Current state:** Not built.
**Target state:** Two production OAuth connectors for support tooling.

**Acceptance criteria:**
- Intercom: `POST /user_delete_requests` invoked on revocation
- Freshdesk: `PUT /api/v2/contacts/{id}` (anonymise) invoked on revocation
- Both follow established patterns
- Integration tests

**Effort:** 2 weeks (1 each)
**Dependencies:** G-016 conventions
**Owner:** Founder

---

### G-020 — Shopify + WooCommerce connectors

**Whitepaper section:** Appendix D
**Current state:** Not built.
**Target state:** Two production connectors for e-commerce deletion.

**Acceptance criteria:**
- Shopify: `DELETE /customers/{id}` (uses Shopify's REST Admin API, requires app installation rather than OAuth pure)
- WooCommerce: `POST /customers/{id}/anonymize` (REST API, requires consumer key/secret rather than OAuth)
- Both follow established patterns adapted for non-OAuth auth
- Integration tests against test stores

**Effort:** 2 weeks (1 each, slightly more than CleverTap due to different auth patterns)
**Dependencies:** G-016 conventions adapted for non-OAuth
**Owner:** Founder

---

### G-021 — Segment connector

**Whitepaper section:** Appendix D
**Current state:** Not built.
**Target state:** Production connector for Segment deletion regulations API.

**Acceptance criteria:**
- `POST /regulations` invoked on revocation, body specifies user IDs and `regulationType: "Suppress_With_Delete"`
- Integration with Segment Workspace via API key (not OAuth)
- Polling for regulation completion status (Segment's deletion is async, takes hours/days)
- `deletion_receipts.status` transitions: `pending` → `accepted` (Segment received) → `confirmed` (Segment completed) over time
- Documentation explains the multi-day timeline to customer

**Effort:** 1 week
**Dependencies:** G-016 conventions; async receipt status handling pattern
**Owner:** Founder

---

### G-022 — WordPress plugin

**Whitepaper section:** §4.1
**Whitepaper claim:** "For WordPress, Shopify, Webflow, Wix, Framer, and Squarespace, the snippet is delivered as a platform plugin."
**Current state:** Not built.
**Target state:** Production WordPress plugin available in WordPress.org plugin directory.

**Acceptance criteria:**
- Plugin handles installation: customer enters org_id and property_id in settings page; plugin injects banner script tag in `<head>`
- Plugin compatibility: WordPress 6.0+, PHP 7.4+, tested against WooCommerce
- WordPress.org Plugin Directory listing: submitted, approved, available for free install
- Plugin shows compliance status from ConsentShield API in dashboard widget
- One-click "Disconnect" removes the script and clears the configuration
- Localised in English and Hindi
- Documentation: setup screencast, troubleshooting guide

**Effort:** 2 weeks
**Dependencies:** None
**Owner:** Founder or contractor (PHP/WordPress contractor preferable)

---

### G-023 — Shopify App Store plugin + listing

**Whitepaper section:** §4.1
**Current state:** Not built.
**Target state:** Production Shopify app available in the Shopify App Store.

**Acceptance criteria:**
- Shopify Partners account created
- App built using Shopify CLI / Remix template
- App handles installation: OAuth flow, script tag injection via Shopify's Script Tag API
- Mandatory App Store requirements met: GDPR webhooks, embedded app UI, billing API integration
- App Store listing submitted with screenshots, demo store, review materials
- App Store approval received
- Pricing model decided: free with ConsentShield account, or per-install fee, or freemium

**Effort:** 3 weeks (longer than WordPress due to App Store approval cycle)
**Dependencies:** None
**Owner:** Founder or contractor

---

### G-024 — Java + Go client libraries

**Whitepaper section:** §5.4
**Current state:** Not built.
**Target state:** Production libraries published to Maven Central (Java) and Go module proxy.

**Acceptance criteria:**
- Java: `com.consentshield:consentshield-client:1.0.0` published to Maven Central
- Go: `github.com/consentshield-org/go-client` available as Go module
- Both have API parity with Node.js (G-002) and Python (G-003) libraries
- Both ship with fail-closed default
- Spring Boot integration example for Java; net/http example for Go
- Tests with ≥ 80% coverage

**Effort:** 2 weeks (1 each, slightly accelerated since API conventions established)
**Dependencies:** G-002, G-003
**Owner:** Founder or contractor (per-language)

---

### G-025 — Consent probe testing infrastructure

**Whitepaper section:** §12.2
**Whitepaper claim:** "ConsentShield runs synthetic consent probes against the customer's production property on a configurable schedule."
**Current state:** Not built.
**Target state:** Headless browser fleet runs scheduled probes; results stored; alerts fire on tracker violations.

**Acceptance criteria:**
- Headless browser infrastructure: Playwright on Cloudflare Browser Rendering, or self-hosted Playwright pool on a VPS
- Probe scheduler: per-property cron-style schedule (default daily; customer can configure)
- Probe configuration: customer specifies a journey (URL sequence) and a consent state (e.g., "marketing declined")
- Probe execution: load page, set consent cookie state, navigate the journey, capture all network requests, identify trackers via fingerprint database
- Tracker fingerprint database: minimum 200 trackers (Meta Pixel, Google Analytics, GTM, Hotjar, etc.) with detection rules
- Results storage: per-probe result with violations enumerated, timestamped, retained 90 days
- Dashboard: probe results visualised, drill-down per violation
- Alerts: tracker violation triggers customer's notification channel (per Surface 4)

**Effort:** 4 weeks
**Dependencies:** None
**Owner:** Founder + possibly contractor for tracker database curation
**Notes:** This is the most substantial P2 item; consider whether Phase 3 deferral is acceptable given competing priorities

---

### G-026 — DPB-format audit export structured packaging

**Whitepaper section:** §12.4
**Whitepaper claim:** "DPB-format" audit export.
**Current state:** No defined format because DPB has not published one.
**Target state:** A structured, well-documented export format that can be claimed as DPB-ready when DPB publishes specifications.

**Acceptance criteria:**
- Export packaging: ZIP archive with `manifest.json` (export metadata), `consent_artefacts.csv`, `artefact_revocations.csv`, `deletion_receipts.csv`, `rights_requests.csv`, `processing_logs.csv`, `breaches.csv`, `regulatory_exemptions_applied.csv`
- Three-link audit chain queryable by joining the CSVs (foreign key relationships documented in manifest)
- Format specification document: `docs.consentshield.in/audit-export-spec` with field definitions, types, examples
- Customer-facing language updated in whitepaper §12.4: "structured format ready for regulatory submission; will be aligned with DPB specifications when published"
- Tested with sandbox + production data; export of 1M-artefact org completes in < 60 seconds
- API endpoint: `POST /v1/audit/export` triggers export; returns download URL when ready (async for large exports)

**Effort:** 2 weeks
**Dependencies:** All schema components stable
**Owner:** Founder

---

### G-027 — Sub-50ms verify p99 SLO — measurement + infrastructure

**Whitepaper section:** §5.1
**Whitepaper claim:** "Sub-50 ms p99 latency, served from the consent_artefact_index validity cache."
**Current state:** Likely true at low load and same-region; unverified under realistic conditions and cross-region.
**Target state:** Measured and documented SLO with infrastructure to back it.

**Acceptance criteria:**
- Continuous latency measurement: synthetic verify probes from multiple Indian regions (Mumbai, Hyderabad, Bangalore, Delhi) every minute
- Latency dashboard with p50/p95/p99 over rolling 24h, 7d, 30d windows
- If sub-50ms p99 is not consistently met, add edge caching: Cloudflare KV-backed validity cache replicated from Postgres `consent_artefact_index` with TTL invalidation on revocation events
- Public latency SLO published; current performance shown on status page (G-015)
- BFSI Enterprise contracts reference the SLO

**Effort:** 2 weeks (measurement infra) + variable (cache infra if needed)
**Dependencies:** G-015 (status page)
**Owner:** Founder

---

### G-034 — Compliance dashboard surfacing of orphan / overdue / expiry metrics

**Whitepaper section:** §3.3, §6.3, §12.5
**Whitepaper claim:** Customer dashboard exposes `orphan_consent_events`, `coverage_score`, deletion overdue counts, artefact expiry warnings.
**Current state:** Metrics exist (or are planned per architecture doc); customer-facing visualisation is partial.
**Target state:** A unified compliance health surface in the customer dashboard.

**Acceptance criteria:**
- Dashboard widget: "Compliance Health" with 4 metrics — coverage score (target 100%), orphan events (target 0), overdue deletions (target 0), upcoming expiries (count over next 30 days)
- Each metric is clickable → drill-down list of affected artefacts/events with action buttons
- Real-time updates (5-minute refresh)
- Configurable threshold alerts (per Surface 4 channels)
- Documentation: what each metric means, what to do when it's non-zero

**Effort:** 2 weeks
**Dependencies:** All four metrics computed in backend
**Owner:** Founder

---

### G-035 — `test_delete` endpoint for connector smoke testing

**Whitepaper section:** §12.3
**Whitepaper claim:** "ConsentShield offers a `test_delete` endpoint that issues a no-op deletion instruction to the customer's endpoint."
**Current state:** Not built.
**Target state:** Production endpoint that exercises the full deletion path with a sentinel data principal that triggers no real action on the customer side.

**Acceptance criteria:**
- API endpoint: `POST /v1/integrations/{connector_id}/test_delete`
- Generates a deletion instruction with `data_principal.identifier = "cs_test_principal_<random>"` and `reason = "test"`
- Customer endpoint receives the instruction, verifies the signature, can detect the test marker (in `reason` field), and returns a success callback without performing real deletion
- Documentation: customer's webhook handler should branch on `reason === 'test'` and skip the deletion logic
- Test deletion does NOT create a real `deletion_receipts` row visible in customer's compliance audit (or is clearly marked as test in the audit)
- Rate limit: 10 test calls per connector per hour (prevents abuse)

**Effort:** 1 week
**Dependencies:** Generic webhook protocol (G-011)
**Owner:** Founder

---

## P3 — Phase 4 / post-launch hardening

### G-028 — React Native consent component (drop-in modal)

**Whitepaper section:** §4.2 (mentions roadmap, conditional)
**Current state:** Not built.
**Target state:** React Native package with a themeable consent modal and rights request screen, suitable for the ABDM ABHA QR scan use case.

**Acceptance criteria:**
- `@consentshield/react-native` package on npm
- Single drop-in component: `<ConsentShieldModal orgId="..." propertyId="..." purposes={[...]} onConsentRecorded={(artefactIds) => ...} />`
- Themeable via prop (matches host app's design tokens)
- Includes ABHA QR scanner (camera permission handled)
- Internally calls `/v1/consent/record`
- Tested on iOS + Android with Expo and bare React Native

**Effort:** 3 weeks
**Dependencies:** G-002 / G-003 (API conventions)
**Owner:** Founder or React Native contractor

---

### G-029 — Webflow / Wix / Framer / Squarespace plugin decision

**Whitepaper section:** §4.1
**Current state:** Not built; not a true plugin model on any of these (mostly custom code injection).
**Target state:** Honest decision per platform: build custom integration, provide instructions only, or remove from claim.

**Acceptance criteria:**
- Per platform: documented decision (Build / Instructions / Remove)
- For Build: scoped as separate gap with effort estimate
- For Instructions: customer-facing setup guide for each platform
- For Remove: whitepaper §4.1 updated to remove the platform
- Decision considers: market share in target customer base; engineering effort; support burden

**Effort:** 0.5 day for decision + variable for execution
**Dependencies:** None
**Owner:** Founder

---

### G-030 — Q3 2026 connector batch (Zoho, Freshworks, Zendesk, Campaign Monitor, Mixpanel)

**Whitepaper section:** Appendix D
**Current state:** Not built.
**Target state:** Five additional connectors built, each following established patterns.

**Acceptance criteria:**
- Per connector: same pattern as G-016 (OAuth, dashboard integration, deletion API call, error handling, integration test)
- Sequenced based on customer demand from incoming pipeline

**Effort:** 4 weeks (≈ 4 days each, slightly faster than G-016 with established patterns)
**Dependencies:** G-016 patterns; customer demand signal
**Owner:** Founder or contractor (post-Phase-3, contractor preferable)

---

### G-031 — Re-consent campaign multi-channel delivery

**Whitepaper section:** §4.3
**Whitepaper claim:** Multi-channel re-consent campaign workflow.
**Current state:** Minimum workflow planned in G-012; multi-channel delivery deferred.
**Target state:** Re-consent campaigns delivered via email (Resend), SMS, WhatsApp, and in-app push.

**Acceptance criteria:**
- Per-channel delivery integration: email (existing Resend), SMS (MSG91 or Twilio), WhatsApp (WhatsApp Business via Razorpay or Gupshup), in-app push (FCM)
- Customer chooses channel(s) per campaign
- Templates per channel with merge fields (customer name, principal name where known, link to re-consent page)
- Tracking: per-recipient delivery status, open status (where supported), click-through to re-consent page
- Re-consent page: hosted by ConsentShield, branded per customer, shows new notice, captures consent, produces new artefact

**Effort:** 4 weeks
**Dependencies:** G-012 (minimum workflow); per-channel vendor selection
**Owner:** Founder or contractor

---

### G-032 — HMAC signature secret rotation mechanism

**Whitepaper section:** §6.3 (implicit)
**Whitepaper claim:** Shared secret established at connector setup; not described how to rotate.
**Current state:** Not built.
**Target state:** Documented and tooled secret rotation that doesn't break in-flight deletion instructions.

**Acceptance criteria:**
- Dashboard action: "Rotate webhook secret" for any connector
- Dual-secret window: during rotation, both old and new secrets are accepted by the verification path for a configurable period (default 7 days)
- Customer documentation: when to rotate, how to update their endpoint to verify against the new secret
- Notification fires when rotation is initiated and when the old secret is fully retired
- Audit log captures rotation events

**Effort:** 1 week
**Dependencies:** G-011 (generic webhook protocol shipped)
**Owner:** Founder

---

### G-033 — SOC 2 Type II audit observation period — verify start

**Whitepaper section:** §14
**Whitepaper claim:** Type II expected Q4 2026.
**Current state:** Unknown whether observation period is actually running.
**Target state:** Confirmed audit timeline with realistic delivery date.

**Acceptance criteria:**
- Auditor engaged with signed engagement letter
- Observation period start date confirmed; control evidence collection underway
- Realistic Type II report delivery date set (likely Q1 2027 if observation period begins now)
- Whitepaper §14 and Operational Maturity appendix (G-004) updated to reflect realistic date
- If Q4 2026 is not feasible, customer-facing language softened: "Type I report available; Type II in progress, expected H1 2027"

**Effort:** Process + audit cost (₹15–25 lakh typical for SOC 2 Type II)
**Dependencies:** Documented controls; cash for audit fee
**Owner:** Founder

---

## Cross-cutting concerns

### CC-A — API surface alignment with whitepaper claims

The whitepaper Appendix A lists endpoints that should match the actual implementation 1:1. As gaps are closed (especially G-002 client libraries, G-035 test_delete, G-007 regulatory exemptions), the API surface will evolve. Maintain a single source of truth: the OpenAPI spec at `/openapi.yaml`, with the whitepaper Appendix A regenerated from it.

**Action:** Add CI check that fails if whitepaper Appendix A drifts from OpenAPI spec.

### CC-B — Documentation consistency

The whitepaper, the Definitive Architecture Reference, and the Complete Schema Design must remain consistent as gaps are closed. Any code change that affects a whitepaper claim should be paired with documentation updates in the same PR.

**Action:** PR template includes a checkbox "Whitepaper / Architecture / Schema docs updated where affected."

### CC-C — Testing coverage standards

Per-gap unit test coverage targets vary; establish platform-wide minimums:
- API endpoints: ≥ 80% line coverage
- Database triggers and functions: 100% (every code path tested)
- Client libraries: ≥ 80%
- Connectors: integration tests against real partner APIs (sandbox accounts) for the deletion path

### CC-D — Security review cadence

As new code lands (especially client libraries G-002/G-003 with fail-closed behaviour, generic webhook G-011 with HMAC, OAuth connectors G-016-G-021 with token storage), security review is needed. Establish a quarterly external pen test starting Q3 2026 with a reputable Indian security firm; results feed back into the SOC 2 evidence pack.

### CC-E — Schema migration discipline

The schema is large and evolving. Each change must:
- Be expressed as a numbered migration file
- Be reversible (down-migration tested)
- Include RLS policy updates if new tables introduced
- Be tested against a clone of production data volume
- Be documented in the Complete Schema Design

---

## Suggested sequencing — minimum viable path to BFSI / Healthcare deliverability

### Sprint 1 (Week 1–2): Marketing accuracy + foundation
- G-001 (catalogue accuracy) — 0.5 day
- G-004 (operational maturity appendix) — 1 day
- G-002 (Node.js library) — 1 week
- G-003 (Python library) — 1 week (parallel if possible)

### Sprint 2 (Week 3–4): Insulated mode + status page
- G-006 (Insulated mode validation) — 2 weeks
- G-015 (status page) — 1 week (parallel)

### Sprint 3 (Week 5–7): Zero-Storage + load tests
- G-005 (Zero-Storage validation) — 3 weeks
- G-009 (1M batch load test) — 1 week (parallel, last week of sprint)
- G-010 (DEPA spike load test) — 1 week (parallel, last week of sprint)

### Sprint 4 (Week 8–10): Regulatory engine + reference partner
- G-007 (Reg engine schema + templates) — 3 weeks
- G-008 (legal review) — 2 weeks (parallel, started week 8)
- G-011 (generic webhook reference) — 2 weeks (parallel, started week 9)
- G-035 (test_delete endpoint) — 1 week (parallel, week 8)

### Sprint 5 (Week 11–13): Notice versioning + support model
- G-012 (re-consent workflow minimum) — 3 weeks
- G-014 (support model + tooling) — 2 weeks (parallel, started week 11)
- G-013 (SE capacity hire/contract) — runs in background, target onboarded by week 13
- G-034 (compliance dashboard surfacing) — 2 weeks (parallel, weeks 12-13)

### After Sprint 5 (Week 14+): P2 connector buildout, documentation hardening
- Connectors G-016 through G-021: ~10 weeks total, sequenced by customer demand
- Plugins G-022, G-023: ~5 weeks, can run in parallel with connector work
- Client libraries G-024 (Java/Go): ~2 weeks
- DPB export packaging G-026: 2 weeks
- Latency SLO infra G-027: 2 weeks
- Probe infrastructure G-025: 4 weeks (defer to Phase 3 if priorities crowd it out)

**Critical path to first BFSI Enterprise customer go-live:** ~13 weeks of focused engineering from Sprint 1 start.

**Critical path to BFSI Enterprise customer signature (with Operational Maturity appendix in hand):** ~2.5 weeks (P0 closure only).

The window between signature and go-live is ~10 weeks during which Sprints 2–5 must complete. This is achievable for a single customer; not for two simultaneous customers without G-013 capacity addition.

---

## Document maintenance

Update this document on the following triggers:
- Any gap closes → mark as Closed with date and PR reference
- New gap discovered (e.g., from customer demand or ops incident) → add as G-NNN with priority
- Whitepaper revised → re-evaluate gaps for changes in claims
- Quarterly review → re-prioritise based on pipeline and capacity

*Last updated: April 2026 · Next scheduled review: July 2026*
