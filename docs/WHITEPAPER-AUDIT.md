# ConsentShield Integration Whitepaper — Critical Audit vs. Implementation
(c) 2026 Sudhindra Anegondhi a.d.sudhindra@gmail.com

**Date:** 2026-04-19
**Status:** CRITICAL GAPS IDENTIFIED
**Severity:** 🔴 BLOCKING (marketing claims > implementation by 6-12 months)

---

## Executive Summary

The whitepaper describes a comprehensive four-surface integration model with extensive pre-built connectors, mobile SDKs, and deployment modes. **The implementation as of 2026-04-18 delivers Surface 1 (web banner only) and partial Surface 3 (deletion with webhooks + 2 OAuth connectors). Surfaces 2 and 4 are present but not featured. Mobile SDK, Zero-Storage mode, GDPR module, and most of the pre-built connector catalogue do not exist.**

**Recommendation:** The whitepaper should not be used for customer-facing marketing until these gaps are either closed in code or explicitly downscoped in the document. Using this whitepaper in a sales process will produce immediate credibility failures when the technical buyer inspects the actual APIs and finds 80% of the promised integrations missing.

---

## Critical Gaps by Section

### Section 2 — Surface 1: Consent Capture

#### 2.1 Mode A — Web Banner (Script Tag) ✓ IMPLEMENTED
**Status:** Fully implemented and production-ready.
- Script-tag delivery from Cloudflare edge via Worker (`banner.js`)
- One artefact per purpose (DEPA-native design)
- Auto-detection on first page load
- Stable cs_art_ IDs, declared data scope, expiry date, append-only

**No issues.**

---

#### 2.2 Mode B — Mobile SDK (iOS, Android) ❌ NOT IMPLEMENTED
**Whitepaper claims:**
- iOS 14+ Swift 5.5+; Android API 24+ Kotlin 1.8+
- React Native + Flutter bridges (Phase 2)
- DPDP-compliant notice rendering (native UIKit / Jetpack Compose)
- Offline queuing with background sync
- In-app preferences centre for revocation
- Integration effort: 2–5 engineer-days

**Implementation reality:**
- Mobile SDK does not exist in any form (no iOS, no Android, no React Native, no Flutter)
- Mobile is deferred to "Month 6+ ABDM trigger" per CLAUDE.md
- Healthcare clinic architecture (Section 6.4) assumes mobile SDK exists; it doesn't
- All reference architectures except "Pure Web SaaS" require mobile SDK; none can proceed as written

**Impact:** 
- 🔴 **BLOCKING** — Any mobile-first customer (NBFC, healthcare, banking) cannot proceed beyond web banner
- Section 6.2 (Mobile-First Digital NBFC) is entirely fictitious until SDK ships
- Estimated gap: 6–8 weeks (not delivered by April 2026)

---

#### 2.3 Mode C — Custom UI via Consent API ✓ IMPLEMENTED
**Whitepaper claims:**
- POST /v1/consent/record with principal identifier, purposes, notice version
- Returns one artefact ID per granted purpose
- Works for kiosk, call-centre, in-person flows

**Implementation reality:**
- RPC exists: `public.rpc_rights_request_create` (ADR-0004)
- **However:** This RPC is specifically for *rights requests*, not consent recording
- No public endpoint for consent recording via custom UI exists
- The whitepaper describes this as a general-purpose API; the implementation has one-off flows only

**Impact:**
- ⚠️ **MAJOR** — Section 2.3 is not accurate. The RPC is narrowly scoped to rights requests, not general consent recording.
- Customers cannot build custom consent UIs against this API
- Estimated gap: 3–4 weeks (requires new RPC + testing)

**Required fix in code:** Create `rpc_consent_record` (public, analogous to `rpc_rights_request_create`).

---

### Section 3 — Surface 2: Consent Verification ✓ PARTIALLY IMPLEMENTED

#### 3.1 Verification Endpoint ❌ NOT PUBLICLY ACCESSIBLE
**Whitepaper claims:**
- GET /v1/consent/verify with property_id, data_principal_identifier, purpose_code
- Returns status (granted/revoked/expired), active_artefact_id, revoked_at, last_valid_artefact_id
- Sub-50ms p99 latency

**Implementation reality:**
- The verification logic exists internally (used by dashboard and deletion orchestration)
- **No public REST API endpoint exists** for external consent verification
- The whitepaper lists `/v1/consent/verify` in Appendix A, but this endpoint is not implemented
- Customers cannot call this endpoint from their server-side systems

**Impact:**
- 🔴 **BLOCKING** — This is a load-bearing claim. Every reference architecture (Sections 6.2, 6.3) relies on Surface 2 verification calls before critical operations (lending decisions, marketing campaigns, partner data shares).
- Without this, reference architectures are non-executable
- Section 3.2 table is fiction — no system can actually call these verification endpoints

**Required fix in code:** Expose `rpc_consent_verify` (public RPC, fast-path via consent_artefact_index) + REST API wrapper.

---

#### 3.3 Batch Verification ❌ NOT IMPLEMENTED
**Whitepaper claims:**
- POST /v1/consent/verify/batch
- Up to 10,000 identifiers per call
- Typical use: nightly bancassurance reconciliation job filters

**Implementation reality:**
- Single-value verification only; no batch operation
- Nightly bancassurance jobs (Section 6.3, worked example Section 9) cannot proceed without this

**Impact:**
- ⚠️ **MAJOR** — Section 6.3 (Private Bank) and Section 9 (Worked Example) both describe nightly batch verification jobs that do not have an API to call.
- Estimated gap: 1 week (batch logic on top of single-value verification)

---

#### 3.4 Failure Modes ✓ PHILOSOPHY ALIGNED
**Whitepaper claims:** Fail-closed on consent verification unreachability

**Implementation reality:**
- No public API to be unreachable yet
- Philosophy is sound (documented in CLAUDE.md non-negotiable rules)
- Once API exists, this should be the behavior

**No immediate issue, pending API implementation.**

---

### Section 4 — Surface 3: Deletion Orchestration

#### 4.1 Pre-Built OAuth Connectors ⚠️ PARTIALLY IMPLEMENTED
**Whitepaper claims (April 2026 list):**
- Email marketing: Mailchimp, Campaign Monitor
- CRM: HubSpot, Zoho CRM, Freshworks CRM
- Support: Freshdesk, Intercom, Zendesk (Q3 2026)
- Engagement: CleverTap, WebEngage, MoEngage
- E-commerce: Shopify, WooCommerce
- Payments: Razorpay
- Analytics: Segment, Mixpanel (Q3 2026)

**Implementation reality (as of 2026-04-18):**
- **Implemented:** Mailchimp, HubSpot (ADR-0039 ✓)
- **Deferred:** Campaign Monitor, Zoho, Freshworks, Freshdesk, Intercom, Zendesk, CleverTap, WebEngage, MoEngage, Shopify, WooCommerce, Razorpay, Segment, Mixpanel
- OAuth refresh cron exists (daily) but only for the 2 implemented connectors

**Impact:**
- 🟡 **MODERATE** — Whitepaper promises 13–15 connectors by April; only 2 exist. The gap is documented and acceptable for April, but the whitepaper's tone suggests immediate availability ("Available connectors as of April 2026").
- For typical SaaS (Section 6.1), the two implemented connectors may suffice; for BFSI (Sections 6.2, 6.3), the missing engagement/CRM/support connectors create gaps.

**Mitigation:** Appendix C clearly marks Q3 2026 dates; the narrative sections (1–6) could be clearer about "coming soon."

---

#### 4.2 Generic Webhook Protocol ✓ FULLY IMPLEMENTED
**Whitepaper claims:**
- Customer implements one HTTP endpoint
- Receives signed deletion requests (HMAC-SHA256)
- Customer posts confirmation back to callback_url
- Partial completion, failure, statutory retention responses supported
- Single-use deletion IDs, deadline enforcement, SLA alerts

**Implementation reality:**
- All of this is implemented (ADR-0007, ADR-0011)
- Signature verification, retry with exponential backoff (1h → 6h → 24h), deadline tracking all working
- RLS: org-scoped deletion isolation ✓
- Audit trail in `deletion_receipt` ✓

**No issues.**

---

#### 4.3 File-Based Reconciliation ❌ NOT IMPLEMENTED
**Whitepaper claims:**
- Daily deletion instruction file (CSV or JSON-lines) deposited in S3/SFTP
- Degraded enforcement mode, marked as such
- Attested reconciliation report workflow

**Implementation reality:**
- No file-based deletion reconciliation exists
- The whitepaper frames this as a "legacy downstream" option; no customer needs it yet
- If a customer does need it (e.g., legacy mainframe partner), this would require custom work

**Impact:**
- ⚠️ **LOW–MODERATE** — This is described as a fallback for legacy systems. No customer has requested it. However, Section 6.3 (Private Bank) mentions "file-based reconciliation for legacy systems where required" — implying it exists, but it doesn't.

**Required if needed:** Implement file scheduler + S3/SFTP delivery. Estimated: 1–2 weeks.

---

### Section 5 — Surface 4: Operational Notifications ✓ IMPLEMENTED

**Whitepaper claims:**
- Email (default)
- Slack incoming webhook (5 min setup)
- Microsoft Teams webhook (5 min setup)
- PagerDuty / OpsGenie (10 min setup)
- Custom webhook (15 min setup)

**Implementation reality:**
- Email delivery via Resend (ADR-0014) ✓
- No Slack/Teams/PagerDuty integration built yet
- Alert types (tracker violation, rights request received, SLA warning, etc.) are conceptually sound but the routing infrastructure doesn't exist

**Impact:**
- 🟡 **MODERATE** — Email works; the fancy op-channel routing doesn't. Most BFSI customers will want PagerDuty/Slack routing; this is a gap.

**Estimated gap:** 2–3 weeks (add Slack/Teams/PagerDuty webhook handlers).

---

### Section 6 — Reference Architectures

#### 6.1 Pure Web SaaS ✓ MOSTLY IMPLEMENTABLE
**Whitepaper claims:**
- Banner (Surface 1) + OAuth connectors (Mailchimp, HubSpot)
- 1-day integration effort

**Implementation reality:**
- Banner ✓
- Mailchimp + HubSpot OAuth ✓
- This reference architecture works as described

**No issues** (at 1-day effort for minimal setup).

---

#### 6.2 Mobile-First Digital NBFC ❌ NOT IMPLEMENTABLE
**Whitepaper claims:**
- Mobile SDK (Surface 1, Mode B) ✗
- Server-side consent verification before lending (Surface 2) ✗
- Deletion orchestration to core lending + engagement partners + collections partner (Surface 3) ✓ (webhooks exist)
- 2–3 weeks integration, including mobile QA

**Implementation reality:**
- Mobile SDK does not exist
- Consent verification API does not exist
- Deletion webhooks exist, but without verification, the enforcement surface is incomplete

**Impact:**
- 🔴 **BLOCKING** — This architecture is entirely non-executable without mobile SDK + verification API. A customer wanting this deployment cannot proceed.

---

#### 6.3 Private Bank with Bancassurance ❌ NOT IMPLEMENTABLE
**Whitepaper claims:**
- Surface 1: Mode C (custom API) — but Mode C is not properly implemented
- Surface 2: verification called by each downstream before critical operations
- Surface 3: webhook + statutory retention + pre-built connectors
- 6–10 weeks, phased rollout

**Implementation reality:**
- Surface 1, Mode C: insufficient (only rights request API, not consent record API)
- Surface 2: consent verification API does not exist
- Surface 3: webhooks ✓, only 2 pre-built connectors (Mailchimp, HubSpot) instead of the expected CleverTap, WebEngage, WhatsApp mentioned

**Impact:**
- 🔴 **BLOCKING** — The most complex and highest-revenue architecture is not implementable. This is the one that drives BFSI enterprise deals.

---

#### 6.4 Healthcare — Clinic with ABDM ❌ NOT IMPLEMENTABLE
**Whitepaper claims:**
- Mobile SDK (Surface 1, Mode B) — doesn't exist
- ABDM integration — DEPA-ABDM bridge mentioned but not in implementation scope

**Implementation reality:**
- Mobile SDK missing
- ABDM integration is deferred to "Month 6+ ABDM trigger" per design docs

**Impact:**
- 🔴 **BLOCKING** — Healthcare segment cannot proceed.

---

### Section 7 — Data Flow and Security

#### 7.1 What Data Crosses the Wire ✓ ACCURATE

**Implementation claim:** Pseudonymous identifier, purpose, notice version, browser fingerprint, timestamps.

**Reality:** Correct per schema (no customer PII stored).

**No issues.**

---

#### 7.2 What ConsentShield Stores ✓ ACCURATE

**Implementation claim:** Operational state store, not compliance record store. Artefacts, revocations, deletion receipts, audit logs append-only. Exported nightly to customer's own storage.

**Reality:** 
- Append-only ✓
- RLS enforcement ✓
- Export via audit-export API ✓ (ADR-0040)
- R2 upload pipeline for exports ✓

**No issues.**

---

#### 7.3 Zero-Storage Mode ❌ NOT IMPLEMENTED
**Whitepaper claims:**
- ConsentShield acts as stateless oracle
- All artefacts written directly to customer's Postgres (VPC or on-prem)
- Dashboard queries customer's DB via signed connection
- BFSI Enterprise option

**Implementation reality:**
- Zero-Storage mode does not exist
- All data flows through ConsentShield's database by design
- The stateless oracle architecture is described in architecture docs but not implemented

**Impact:**
- 🔴 **BLOCKING for RBI-regulated BFSI** — The whitepaper claims this mode "resolves RBI outsourcing guideline concerns." If a regulated bank asks for it, ConsentShield cannot deliver.

**Estimated gap:** 6–8 weeks (significant architectural change to support customer-side data stores).

---

#### 7.4 Transport Security ✓ ACCURATE

**Implementation claim:** TLS 1.3, HSTS, cert pinning (on request), HMAC-signed webhooks, Worker has zero npm deps.

**Reality:** Correct per implementation.

**No issues.**

---

### Section 8 — Integration Timeline and Effort

#### 8.1 Lightweight SaaS — 1 week ✓ ACHIEVABLE

**Timeline accurate.** Customer can deploy banner + 2 OAuth connectors in 1 week.

---

#### 8.2 Mobile-First NBFC — 3 weeks ❌ NOT ACHIEVABLE

**Claimed timeline:** 3 weeks including mobile QA.

**Reality:**
- Mobile SDK (Weeks 2): doesn't exist — add 6–8 weeks
- Consent verification (Week 2): API doesn't exist — add 1–2 weeks
- Realistic timeline: 10–12 weeks, not 3

---

#### 8.3 Private Bank — 8 to 10 weeks ❌ NOT ACHIEVABLE

**Claimed timeline:** 8–10 weeks, phased (foundation 1–2w, capture 3–4w, verification 5–6w, orchestration 6–8w, cutover 9–10w).

**Reality:**
- Foundation (Zero-Storage setup): doesn't exist — add 6–8 weeks
- Verification (Weeks 5–6): API doesn't exist — add 2–3 weeks
- Custom connectors (bancassurance partner, co-lending fintech): webhooks exist but require customer-side endpoint development (realistic: 3–5 weeks per endpoint)
- Realistic timeline: 18–24 weeks, not 8–10

---

### Section 9 — Worked Example (Bancassurance Revocation)

#### Key claims in the example:
1. Mobile SDK: withdraw consent via mobile app ❌ (SDK doesn't exist)
2. Nightly batch verification before data file transmission ❌ (batch API doesn't exist)
3. Deletion orchestration to partner ✓ (webhook works)
4. Receipt callback + validation ✓

**Overall: 60% of the example is implementable; the critical consent-capture and verification surfaces are missing.**

---

### Section 10 — Testing and Validation

#### 10.1 Sandbox Environment ✓ WORKS
- Sandbox org exists per DPDP-0001
- Identical API surface ✓

---

#### 10.2 Consent Probe Testing ✓ WORKS
- Static HTML analysis (ADR-0016) ✓
- Dynamic browser-based probes (ADR-0041) ✓

---

#### 10.3 Deletion Receipt Validation ❌ NOT DESCRIBED
- `test_delete` endpoint does not exist
- Smoke testing webhooks requires manual setup

---

#### 10.4 DPB Audit Export Dry-Run ✓ WORKS
- Audit export API ✓ (ADR-0040)
- Sandbox export ✓

---

### Section 11 — FAQ

#### "Can we host ConsentShield on-premises?" 
**Whitepaper answer:** Zero-Storage mode.
**Reality:** Zero-Storage mode doesn't exist. Full on-premises deployment is "custom engagement" (accurate, but the Zero-Storage halfway point is missing).

---

### Appendix A — Complete API Surface Summary

**Listed but not implemented:**

| Endpoint | Status | Gap | Impact |
|----------|--------|-----|--------|
| POST /v1/consent/record | Missing (Mode C incomplete) | 3–4w | Custom consent capture |
| GET /v1/consent/verify | Missing (internal only) | 1–2w | Critical for all BFSI |
| POST /v1/consent/verify/batch | Missing | 1w | Nightly batch jobs |
| POST /v1/deletion/trigger | Exists as RPC, no REST API | — | Works via internal trigger |
| POST /v1/deletion-receipts/{request_id} | ✓ Implemented | — | Webhook callback |
| All /v1/consent/events, score, tracker, probes, audit endpoints | Mostly ✓ | — | Works via internal APIs |

---

### Appendix C — Pre-Built Connector Catalogue

**Implemented:** Mailchimp, HubSpot
**Deferred or missing:** 13 other services listed

**Severity:** Moderate (clearly marked Q3 2026 for some; others marked GA with no timeline).

---

## Summary of Gaps by Severity

### 🔴 BLOCKING (Prevents reference architectures from working)

1. **Mobile SDK (iOS, Android, React Native, Flutter)** — 6–8 weeks
2. **Consent Verification API (single + batch)** — 2–3 weeks
3. **Consent Record API (Mode C, custom UI)** — 3–4 weeks
4. **Zero-Storage Mode** — 6–8 weeks
5. **Surface 4 routing (Slack, Teams, PagerDuty)** — 2–3 weeks

### 🟡 MAJOR (Features exist but gaps in implementation)

6. File-based reconciliation (Mode C, file-based) — 1–2 weeks
7. Missing pre-built connectors (13 of 15) — ongoing, per schedule
8. Operational notification channels (only email works) — 2–3 weeks

### 🟢 MINOR (Documented, acceptable)

9. Some reference architecture timelines are optimistic
10. Phase 2 / Phase 3 features not clearly separated in marketing copy

---

## Recommendations

### For Marketing / Sales
1. **Do not distribute the current whitepaper to prospects without disclaimers.** The gap between promised features (mobile SDK, verification APIs, pre-built connectors) and actual implementation will cause immediate credibility loss in technical evaluations.

2. **Create a phased whitepaper version:**
   - "ConsentShield v1 (April 2026)" — Web banner only, webhook deletion, 2 OAuth connectors, DPDP-compliant
   - "ConsentShield v2 (Q3 2026)" — Add mobile SDK, consent verification, expanded connector catalogue
   - "ConsentShield v3 (Q4 2026)" — Add Zero-Storage mode, GDPR module, expanded notifications

3. **Downscope reference architectures in current whitepaper** to only "Pure Web SaaS" (which is achievable) and defer NBFC/Bank/Healthcare architectures to v2.

4. **Create a technical capability matrix** showing what ships when, by quarter.

### For Engineering
1. **Prioritize in this order** (for enterprise sales readiness):
   - Consent Record API (Mode C) — 3–4 weeks (unblocks custom consent capture)
   - Consent Verification API (single + batch) — 2–3 weeks (unblocks critical enforcement checks)
   - Operational notifications (Slack/Teams/PagerDuty) — 2–3 weeks (unblocks SLA/violation alerts)
   - Mobile SDK (iOS/Android) — 6–8 weeks (unblocks NBFC/healthcare segments)
   - Zero-Storage mode — 6–8 weeks (unblocks RBI-regulated BFSI)

2. **Update architecture docs** to explicitly call out what is v1 vs. v2 vs. v3. The DEPA roadmap did this well; the integration whitepaper did not.

3. **Add API status page** to the dashboard showing which endpoints are available, their stability status, and timeline for missing ones.

---

## Audit Checklist

- [x] Claims vs. implementation gap analysis
- [x] Reference architectures feasibility check
- [x] API surface completeness check
- [x] Pre-built connector inventory vs. catalogue
- [x] Timeline accuracy check
- [x] Feature parity check

**Overall assessment:** Whitepaper is 40% accurate, 60% aspirational (features planned but not yet implemented). **Not suitable for customer-facing marketing in current form.**

---

*This audit was conducted against ADR-0001 through ADR-0044 and supporting architecture documents. Actual implementation status as of 2026-04-18.*
