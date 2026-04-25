# ConsentShield — Whitepaper-to-Code Gap Document (Combined & Canonical)

(c) 2026 Sudhindra Anegondhi · a.d.sudhindra@gmail.com

*Canonical date: 2026-04-19*
*Supersedes: `consentshield-whitepape-v2-gaps.md` (initial) and `ConsentShield-Customer-Integration-Whitepaper-V2-gaps.md` (revised).*
*Source whitepaper: `docs/design/ConsentShield-Customer-Integration-Whitepaper-v2.md` (v2.0, April 2026).*
*Ground truth: 44 ADRs (0001–0050), changelogs in `docs/changelogs/`, migrations in `supabase/migrations/`, and a code-level verification sweep (`app/src/app/api/**`, `app/src/lib/**`, `packages/**`, `worker/**`) performed 2026-04-19.*

---

## Purpose

This is the single authoritative gap document for closing the distance between the v2.0 whitepaper and the running product. It replaces two earlier drafts and will be updated in place as gaps close.

Every gap has:
- A stable ID (`G-NNN`) used in tickets, commits, and PR descriptions.
- A priority band (P0 → P3) tied to a delivery gate (see below).
- A set of testable acceptance criteria — when all criteria pass, the gap is Closed.
- A wall-clock effort estimate for a solo developer with focused attention.
- A mapping to one or more DPDP/DEPA compliance obligations (O1–O10) that the gap unblocks.
- Dependencies on other gaps where applicable.

## Priority bands → Delivery gates

| Band | Closes before | Rationale |
|---|---|---|
| **P0** | Whitepaper goes to any BFSI / healthcare prospect | Active misrepresentation or hard blocker; discovery in procurement = lost deal + reputation damage |
| **P1** | First BFSI Enterprise or Healthcare customer goes live | Promised capability customer will exercise on day one |
| **P2** | Whitepaper claims fully deliverable at scale across all four reference archetypes | Required for the document to be ironclad rather than aspirational |
| **P3** | Phase 4 or post-launch hardening | Nice-to-have, deferrable, not blocking |

---

## Why these gaps matter — the DEPA/DPDP compliance promise

ConsentShield's reason for existing is a concrete promise: **we will let customers discharge their DPDP obligations, produce DEPA-aligned consent artefacts, and survive a Data Protection Board examination, across every channel and every customer category they operate in.** Every gap earns its band by what slice of that promise it unblocks.

### Obligations ConsentShield must help customers discharge

| # | Obligation | DPDP / DEPA anchor | ConsentShield's contribution |
|---|---|---|---|
| O1 | Specific, informed, free consent per purpose | DPDP §6(1); DEPA artefact model | Produce one artefact per purpose with explicit `data_scope` and `notice_version`, from any channel |
| O2 | Purpose limitation at point of action | DPDP §5, §6(2) | Runtime verify API with sub-50ms latency, callable from every customer system |
| O3 | Withdrawal as easy as granting | DPDP §6(4) | Revocation on any channel the grant was available on; reflected in verify within one request cycle |
| O4 | Data-principal rights (access, correction, erasure, nomination, grievance) | DPDP §11–14 | Rights requests capturable from portal, mobile, call-centre, branch; SLA-tracked; delivery orchestrated |
| O5 | Erasure + retention discipline | DPDP §8(7); sector statutes | Artefact-scoped deletion respecting statutory retention via the Regulatory Exemption Engine |
| O6 | Notice obligation + material-change re-consent | DPDP §5(a), §6(1) | Notice versioning on every artefact; re-consent workflow on material changes |
| O7 | Processor-not-Fiduciary posture | DPDP §8; RBI outsourcing guidelines | Zero-persistence of regulated content; customer holds compliance record |
| O8 | Breach + silent-failure detection | DPDP §8(6); reasonable-security-safeguards test | Orphan-event metric, deletion-overdue alerts, probe failures surfaced |
| O9 | DPB-defensible audit trail | DPDP §12–14; Rule 12 | Three-link chain (artefact → revocation → deletion receipt), regulator-ready export |
| O10 | Significant Data Fiduciary controls | DPDP §10 | DPIA inputs, DPO routing, periodic audit (Phase 3; ADR-0046 foundation) |

### Customer archetype × obligation matrix

Bold cells are hard blockers — without them, the customer cannot contract.

| Archetype | O1 | O2 | O3 | O4 | O5 | O6 | O7 | O8 | O9 |
|---|---|---|---|---|---|---|---|---|---|
| Pure web SaaS (Starter/Growth) | banner | optional | banner | portal | minimal | basic | Standard | basic | basic |
| SaaS Pro (API-heavy) | banner + API | **required** | banner + API | portal + API | basic | required | Insulated | required | required |
| Digital NBFC (mobile-first) | banner + **mobile API** | **critical** | **mobile API** | portal + mobile | **RBI KYC, PMLA, CICRA** | required | **Insulated mandatory** | required | **critical** |
| Private bank (omni-channel) | banner + **branch + mobile + call-centre APIs** | **critical, batch** | **every channel** | **every channel** | **5+ statutes** | **versioned + re-consent** | **Zero-Storage mandatory** | **critical** | **critical** |
| Healthcare (ABDM clinic) | **tablet + kiosk API** | required | tablet + API | portal + tablet | **DISHA 7 yr** | required | **Zero-Storage mandatory (FHIR)** | required | **critical** |
| Telecom / edtech / e-commerce (future) | sector-dependent | required | sector-dependent | required | sector statutes | required | Insulated | required | required |

### Gap → obligation → customer unblock

| Gap | Unblocks | Without it | Most-affected |
|---|---|---|---|
| **G-036** public API scaffolding | All server-to-server promises (O1–O5, O9) | Only Pure-Web-SaaS archetype works; every other is unreachable | NBFC, Bank, Healthcare, SaaS Pro |
| **G-037** verify + batch | **O2** | Customer records consent but cannot enforce; DPB *"did you act on withdrawn consent?"* unanswerable | NBFC, Bank, regulated sectors |
| **G-038** consent record (Mode B) | **O1 (multi-channel)** | Mobile/branch/kiosk/call-centre cannot produce artefacts | NBFC, Bank, Healthcare |
| **G-039** artefact list/revoke/events | **O3**, O4 | §6(4) parity broken; no mobile withdraw | NBFC, Bank, Healthcare |
| **G-040** deletion trigger + receipts list | **O4**, O9 | Operator-initiated erasure manual; multi-partner orchestration unchanneled | Bank, NBFC, support-ops customers |
| **G-041** storage_mode enforcement | **O7** | Zero-Storage is declarative only; RBI defence collapses | Bank (mandatory), Healthcare (mandatory) |
| **G-042** healthcare seed | O1 healthcare | Healthcare bundle has no SKU | Healthcare |
| **G-045** OpenAPI + CI drift | O9 support | Silent doc-code drift erodes auditor trust | BFSI, healthcare, SDF |
| **G-046** sandbox provisioning | Integration velocity | Procurement-to-go-live stretches | All |
| **G-048** orphan metric + alert | **O8** | Silent fan-out failure → latent §6 violation | All, especially high-volume BFSI |
| **G-049** `/v1/rights/requests` | **O4 (any channel)** | Rights only via portal + Turnstile | Bank, NBFC, Healthcare |
| **G-007** Regulatory Exemption Engine | **O5** | Cannot tell "delete marketing" from "retain KYC" | NBFC, Bank, Insurance, Healthcare |
| **G-012** notice versioning + re-consent | **O6** | Notice update silently orphans artefacts | All (over time) |
| **G-011** webhook reference implementation | O4 + O5 + O9 | Generic protocol unexercised; edge cases discovered at the customer | Bank, NBFC |

**Critical ordering:** **G-036 → G-037 → G-038 → G-039 → G-040 → G-041 (+ G-042, G-048)** is the product, in engineering form. Everything else is hygiene, depth, or polish.

---

## Master gap table

| ID | Title | Priority | Effort | Obligations |
|---|---|---|---|---|
| G-001 | Connector catalogue accuracy in marketing materials | P0 | 0.5 day | O9 (trust) |
| G-002 | Node.js client library with fail-closed default | P1 | 1 week | O2 (safety net) |
| G-003 | Python client library with fail-closed default | P1 | 1 week | O2 |
| G-004 | Operational Maturity appendix in whitepaper | P0 | 1 day | O9 (trust) |
| G-005 | Zero-Storage mode end-to-end production validation | P1 | 3 weeks | O7 |
| G-006 | Insulated mode (BYOS) end-to-end validation | P1 | 2 weeks | O7 |
| G-007 | Regulatory Exemption Engine — schema + sector templates | P1 | 3 weeks | O5 |
| G-008 | Regulatory Exemption Engine — legal review of mappings | P1 | 2 weeks elapsed | O5 |
| G-009 | Batch verification load test at 1M+ identifiers | P1 | 1 week | O2 (at scale) |
| G-010 | DEPA fan-out pipeline spike load test | P1 | 1 week | O1 (at scale) |
| G-011 | Generic webhook protocol — reference implementation | P1 | 2 weeks | O4, O5, O9 |
| G-012 | Notice versioning — minimum re-consent workflow | P1 | 3 weeks | O6 |
| G-013 | Solutions engineer capacity — hire or contract | P1 | Ongoing | Delivery |
| G-014 | Production support model — definition + tooling | P1 | 2 weeks | Delivery |
| G-015 | Status page + incident communication infrastructure | P1 | 1 week | Delivery |
| G-016 | CleverTap connector | P2 | 1 week | O5 |
| G-017 | Razorpay anonymisation connector | P2 | 1 week | O5 |
| G-018 | WebEngage + MoEngage connectors | P2 | 2 weeks | O5 |
| G-019 | Intercom + Freshdesk connectors | P2 | 2 weeks | O5 |
| G-020 | Shopify + WooCommerce connectors | P2 | 2 weeks | O5 |
| G-021 | Segment connector | P2 | 1 week | O5 |
| G-022 | WordPress plugin | P2 | 2 weeks | O1 (reach) |
| G-023 | Shopify App Store plugin + listing | P2 | 3 weeks | O1 (reach) |
| G-024 | Java + Go client libraries | P2 | 2 weeks | O2 (safety net) |
| G-025 | Consent probe testing infrastructure | **Closed** | — | Closed by ADR-0041 |
| G-026 | DPB-format audit export structured packaging | P2 | 2 weeks | O9 |
| G-027 | Sub-50ms verify p99 SLO — measurement + infrastructure | P2 | 2 weeks | O2 (SLO) |
| G-028 | React Native consent component (drop-in modal) | P3 | 3 weeks | O1 (mobile) |
| G-029 | Webflow / Wix / Framer / Squarespace plugin decision | P3 | 0.5 day + variable | O1 (reach) |
| G-030 | Q3 2026 connector batch (Zoho, Freshworks, Zendesk, Campaign Monitor, Mixpanel) | P3 | 4 weeks | O5 |
| G-031 | Re-consent campaign multi-channel delivery | P3 | 4 weeks | O6 |
| G-032 | HMAC signature secret rotation mechanism | P3 | 1 week | Security hygiene |
| G-033 | SOC 2 Type II audit observation period — verify start | P3 | Audit/process | O9 (trust) |
| G-034 | Compliance dashboard surfacing of orphan / overdue / expiry metrics | P2 | 2 weeks | O8 |
| G-035 | `test_delete` endpoint for connector smoke testing | P2 | 1 week | O4, O9 |
| G-036 | **Public API scaffolding — `cs_live_*` keys + Bearer middleware + rate tiers** | **P0** | **2 weeks** | **All server-to-server** |
| G-037 | **`GET /v1/consent/verify` + `POST /v1/consent/verify/batch`** | **P0** | **2 weeks** | **O2** |
| G-038 | **`POST /v1/consent/record` — Mode B escape hatch** | **P0** | **1.5 weeks** | **O1 (multi-channel)** |
| G-039 | **`/v1/consent/artefacts` + revoke + `/v1/consent/events`** | **P1** | **1 week** | **O3, O4** |
| G-040 | **`POST /v1/deletion/trigger` + `GET /v1/deletion/receipts`** | **P1** | **1 week** | **O4, O9** |
| G-041 | **`storage_mode` enforcement at API gateway layer** | **P1** | **1 week** | **O7** |
| G-042 | **Healthcare sector template seed (ABDM + DISHA purposes)** | **P1** | **1 week** | **O1 (healthcare)** |
| G-043 | **Non-email notification channels (Slack, Teams, Discord, PagerDuty, webhook)** | **P2** | **2 weeks** | **O8** |
| G-044 | **Audit export CSV-format alignment** | **P2** | **1 week** | **O9** |
| G-045 | **Public OpenAPI spec + Appendix A regeneration + CI drift check** | **P1** | **1 week** | **O9 (trust)** |
| G-046 | **Sandbox organisation provisioning flow** | **P1** | **1 week** | **Delivery** |
| G-047 | **Tracker signature catalogue coverage to 200+ fingerprints** | **P2** | **2 weeks** | **O8** |
| G-048 | **`orphan_consent_events` metric + alert wiring** | **P1** | **1 week** | **O8** |
| G-049 | **Public rights-request API (`/v1/rights/requests`)** | **P2** | **1 week** | **O4 (multi-channel)** |

**Total P0:** ~7 weeks · **Total P1:** ~22 weeks · **Total P2:** ~26 weeks · **Total P3:** ~12 weeks

---

## P0 — Close before BFSI/Healthcare whitepaper distribution

### G-001 — Connector catalogue accuracy in marketing materials

**Whitepaper:** Appendix D; §9.2, §9.3 passing references
**Claim:** 11 services listed as "Shipping" — Mailchimp, HubSpot, Freshdesk, Intercom, CleverTap, WebEngage, MoEngage, Shopify, WooCommerce, Razorpay, Segment.
**Actual state:** Only Mailchimp + HubSpot built & tested (ADR-0018 + ADR-0039). Verified: `app/src/lib/connectors/oauth/`.

**Acceptance criteria:**
- Appendix D edited: only Mailchimp + HubSpot marked "Shipping today"
- All other services moved to "Q3 2026" or "On request" with concrete dates
- Same change propagated to landing page, product site, sales decks, and `app/src/lib/connectors/README.md`

**Effort:** 0.5 day · **Dependencies:** None · **Owner:** Founder

---

### G-004 — Operational Maturity appendix in whitepaper

**Whitepaper:** to be added as new Appendix E
**Gap:** Capabilities described throughout as live are a mix of Shipping/Partial/Roadmap. No transparent status inventory.

**Acceptance criteria:**
- New Appendix E: table of Capability | Status | Target date | Notes
- Minimum 30 rows covering §1–§14 claims
- Honest flag per row: Shipping (production) / Beta (limited customer use) / Roadmap (timeline only)
- Roadmap items committed to a target quarter
- Same appendix mirrored in security-review sales deck
- Executive Summary line references the appendix
- Public `/v1/*` API surface explicitly listed as Roadmap (not Shipping)

**Effort:** 1 day · **Dependencies:** Honest internal inventory (this doc) · **Owner:** Founder

---

### G-036 — Public API scaffolding — `cs_live_*` keys + Bearer middleware + rate tiers

**Whitepaper:** Appendix A (entire Compliance API section)
**Claim:** Every `/v1/*` route authenticated via `Authorization: Bearer cs_live_...`; rate limits Starter 100/hr · Growth 1,000/hr · Pro 10,000/hr · Enterprise custom.
**Actual state:** Nothing. No key issuance, no verification middleware. Only `/v1/deletion-receipts/[id]` exists (HMAC-signed callback, not API-key auth).

**Target state:** Customers mint, rotate, revoke `cs_live_*` keys scoped to account or org. Every `/v1/*` route resolves key → org_id → rate tier → scopes. Usage is audited.

**Acceptance criteria:**
- New `public.api_keys` table: `id`, `account_id`, `org_id`, `prefix`, `hashed_secret` (SHA-256), `scopes[]`, `rate_tier`, `created_by`, `created_at`, `last_used_at`, `revoked_at`, `name`
- Key format: `cs_live_` + 32 url-safe bytes; plaintext shown once on creation, never stored
- Dashboard surface `/dashboard/settings/api-keys`: list, create, rotate, revoke; copy-once UI for plaintext
- Middleware on `/api/v1/*` branch: bearer → org context (via `cs_api` minimum-privilege Postgres role); rejects with 401 / 403 / 429 per failure mode
- Scoped execution: every `/v1/*` handler runs as `cs_api` with `current_org_id()` set from resolved key
- Per-tier rate limit re-using ADR-0010 infrastructure; window and limit from `public.plans`
- `public.api_request_log` (day-partitioned, 90-day retention): key_id, route, status, latency_ms, response_bytes, occurred_at
- Scopes from §Appendix A: `read:consent`, `write:consent`, `read:artefacts`, `write:artefacts`, `read:rights`, `write:rights`, `read:deletion`, `write:deletion`, `read:tracker`, `read:audit`, `read:security`, `read:probes`, `read:score`
- Unit + integration tests: valid key / revoked key / rotated key / wrong scope / rate-limit / cross-org rejection
- OpenAPI stub at `/openapi.yaml` consumed by G-045

**Effort:** 2 weeks · **Dependencies:** ADR-0044 memberships (shipped) · **Blocks:** G-002, G-003, G-024, G-035, G-037, G-038, G-039, G-040, G-049 · **Owner:** Founder

---

### G-037 — `GET /v1/consent/verify` + `POST /v1/consent/verify/batch`

**Whitepaper:** §5.1, §5.3, §11; Appendix A
**Claim:** Sub-50ms p99 single verify; batches up to 10k; fail-closed client-library behaviour.
**Actual state:** `consent_artefact_index` populated by `process-consent-event` (ADR-0021). No public HTTP reader. Internal callers query via RLS.

**Acceptance criteria:**
- `GET /api/v1/consent/verify?property_id=...&data_principal_identifier=...&identifier_type=...&purpose_code=...` as Vercel Function
- `POST /api/v1/consent/verify/batch` accepts body per §5.3; rejects >10k with 413
- Response schema matches §5.1 exactly (field names, ISO timestamps, null handling)
- Scope check: key has `read:consent`
- Hot path reads `consent_artefact_index` only (no JOIN to `consent_artefacts`)
- Status values: `granted | revoked | expired | never_consented`
- `evaluated_at` set server-side
- Integration tests: active → granted; revoked → revoked + `revocation_record_id`; past expiry → expired; absent → never_consented
- One-shot staging load test with `consent_artefact_index` at 50M rows → p99 < 50ms captured as baseline (G-027 continues measurement)

**Effort:** 2 weeks · **Dependencies:** G-036 · **Owner:** Founder

---

### G-038 — `POST /v1/consent/record` — Mode B escape hatch

**Whitepaper:** §4.2, §9.2, §9.4, §11; Appendix A
**Claim:** Server-to-server consent recording; returns one artefact ID per granted purpose.
**Actual state:** Fan-out pipeline runs on any `consent_events` row; no non-browser writer.

**Acceptance criteria:**
- `POST /api/v1/consent/record` body: property_id, data_principal, purposes[], notice_version, captured_via, captured_by, captured_at
- Scope: `write:consent`
- Validation: every `purpose_definition_id` resolves and belongs to org; `property_id` belongs to org; `captured_at` within ±15 min of server
- Writes `consent_events` with `source='api'`, `captured_via` recorded, `notice_version` recorded
- Synchronous path: triggers `process-consent-event` in-line for this call only; returns artefact IDs in response. Trigger + safety-net path remains idempotent.
- Response: `{ event_id, artefact_ids: [{ purpose_code, artefact_id, status }], created_at }`
- Returns 422 if any `purpose_definition_id` is missing/invalid
- Integration tests: kiosk, call-centre, branch, and the 5-grant/2-deny §4.2 fixture

**Effort:** 1.5 weeks · **Dependencies:** G-036 · **Owner:** Founder

---

## P1 — Close before first BFSI / Healthcare go-live

### G-002 — Node.js client library with fail-closed default

**Whitepaper:** §5.4
**Claim:** Library ships with 2s default timeout + fail-closed behaviour; `CONSENT_VERIFY_FAIL_OPEN=true` overrides and audits.

**Acceptance criteria:**
- `@consentshield/node` published to npm at v1.0.0
- Methods: `verify`, `verifyBatch`, `recordConsent`, `revoke`, `triggerDeletion`
- 2s default timeout; fail-closed (throws `ConsentVerifyError` on network failure)
- `CONSENT_VERIFY_FAIL_OPEN=true` override writes to audit log
- TypeScript type definitions included
- README + Express/Next.js integration example
- Unit coverage ≥ 80%
- Internal smoke-test integration in admin app uses library against staging

**Effort:** 1 week · **Dependencies:** G-036, G-037, G-038, G-039, G-040 · **Owner:** Founder

---

### G-003 — Python client library with fail-closed default

**Whitepaper:** §5.4
**Acceptance criteria:**
- `consentshield` published to PyPI at 1.0.0
- API parity with G-002 (method names + semantics)
- Fail-closed default + `CONSENT_VERIFY_FAIL_OPEN` override
- Python 3.9+ (Django/Flask/FastAPI examples)
- Type hints (mypy clean)
- Coverage ≥ 80%
- Internal smoke test vs staging

**Effort:** 1 week · **Dependencies:** G-002 (API convention lockdown) · **Owner:** Founder

---

### G-005 — Zero-Storage mode end-to-end production validation

**Whitepaper:** §2.1, §2.2, §9.3, §9.4, Appendix C
**Actual state:** `storage_mode` column exists; enforcement does not (see G-041). TTL behaviour of `consent_artefact_index` has to be wired.

**Acceptance criteria:**
- `storage_mode='zero_storage'` enforced at API gateway (Security Rule 9)
- TTL-bounded `consent_artefact_index`: default 24h TTL, refresh-on-read or background job from customer storage
- Memory-only `delivery_buffer` path; no persistent row for zero-storage orgs (invariant test: `SELECT COUNT(*)=0` across all buffer tables)
- Restart-runbook documented (what happens mid-delivery)
- Internal load test: 100K events, 0 persistent rows for the zero-storage org
- Launch-partner or internal test deployment for 4 weeks with metrics dashboard
- Documented gap list: features that require special handling (re-export from buffer, consent re-display)

**Effort:** 3 weeks · **Dependencies:** G-041, G-006 · **Owner:** Founder

---

### G-006 — Insulated mode (BYOS) end-to-end validation

**Whitepaper:** §2.1, §2.3
**Actual state:** SigV4 helpers ship (ADR-0040); UX + scoped-credential probe absent.

**Acceptance criteria:**
- Credential-validation flow: customer pastes creds → CS performs PutObject → HeadObject verify → surfaced to user
- Rejects credentials with `s3:GetObject`, `s3:ListBucket`, or `s3:DeleteObject` permissions (explicit scope-down check)
- Encrypted credential storage per-org key derivation (existing pattern)
- Tested against AWS S3, Cloudflare R2, one S3-compatible (DO Spaces or B2)
- Customer-facing BYOS provisioning guide (AWS + R2 with IAM policy JSON / R2 token recipes)
- Standard → Insulated migration procedure documented
- Launch-partner customer in Insulated for ≥ 4 weeks

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder

---

### G-007 — Regulatory Exemption Engine — schema + sector templates

**Whitepaper:** §9.2, §9.3, §10.2, §10.3, §11
**Actual state:** Conceptual. BFSI template seed (`20260502000003_bfsi_template_seed.sql`) carries purpose-level retention defaults; no queryable exemption engine.

**Acceptance criteria:**
- `public.regulatory_exemptions`: `id`, `org_id` (nullable for platform defaults), `sector`, `statute`, `data_category`, `retention_period`, `source_citation`, `precedence`, `applies_to_purposes` (array), `legal_review_notes`, `reviewed_at`, `reviewer`
- BFSI platform defaults: rows for RBI KYC Master Directions, PMLA, Banking Regulation Act, CICRA, Insurance Act § 64VB
- Healthcare platform defaults: rows for ABDM, DISHA, Clinical Establishments Act
- Per-org overrides (with audit trail)
- Deletion orchestrator consults engine; suppresses deletion with statute citation when retention applies
- Compliance dashboard surfaces "X records retained under RBI KYC" with drill-down
- `GET /api/orgs/[orgId]/regulatory-exemptions` for customer inspection
- Unit tests: BFSI marketing → deletion proceeds; BFSI bureau-reporting → retention enforced; healthcare clinical → DISHA enforced

**Effort:** 3 weeks · **Dependencies:** `consent_artefacts.data_scope` (exists) · **Owner:** Founder

---

### G-008 — Regulatory Exemption Engine — legal review

**Whitepaper:** §9.3, §9.4
**Target:** Mappings reviewed and signed off by an Indian regulatory lawyer with BFSI + healthcare expertise.

**Acceptance criteria:**
- Engagement letter signed with at least one Indian regulatory firm
- Reviewed mappings cover BFSI (10+ statutes), Healthcare (5+ statutes), Telecom + Insurance placeholders
- Reviewer notes captured per row; review date + credentials recorded
- Re-review trigger process documented (amendment published → re-review; default annual)
- Reviewer letter saved for customer security packs
- Budget ₹2–3 lakh allocated and spent

**Effort:** 2 weeks elapsed (legal lead time; ~3 days founder effort for prep + ingestion) · **Dependencies:** G-007 + lawyer engagement · **Owner:** Founder + counsel

---

### G-009 — Batch verification load test at 1M+ identifiers

**Whitepaper:** §5.3, §11
**Acceptance criteria:**
- Load test infra (k6, Artillery, or Locust) provisioned
- Scenario: 100 concurrent batch calls × 10k identifiers × 10 minutes (= 60M verifications/min sustained)
- Measured: p50/p95/p99 per batch, error rate, DB CPU/connections, Worker subrequest exhaustion
- Staging `consent_artefact_index` at 50M+ rows
- Documented results in internal SLO doc
- If p99 > 50ms: follow-on work for edge caching or regional replicas tracked separately
- Realistic per-tier rate limits set from observed throughput
- Customer-facing doc updated with batching guidance for 10M+ reconciliations

**Effort:** 1 week · **Dependencies:** G-037 · **Owner:** Founder

---

### G-010 — DEPA fan-out pipeline spike load test

**Whitepaper:** §3.3
**Acceptance criteria:**
- Spike: 50k consent events / 12h × 5 artefacts (= 250k artefact rows)
- Measured: trigger fire rate, Edge Function execution time, validity cache contention, safety-net cron latency, end-to-end event-to-artefact distribution
- p99 event-to-artefact documented; SLO set (proposed: 99% within 30s)
- Orphan detection verified: trigger failure caught by safety net within 10 min
- Idempotency verified: replayed consent_event_id → zero duplicates
- Results in internal SLO doc
- Whitepaper §3.3 amended with SLO

**Effort:** 1 week · **Dependencies:** Staging env · **Owner:** Founder

---

### G-011 — Generic webhook protocol — reference implementation with friendly partner

**Whitepaper:** §6.3
**Acceptance criteria:**
- Friendly partner onboarded (Hyderabad fintech, non-customer internal system, or internal sample backend)
- Partner implements full protocol: HMAC verify on receive, deletion execution, signed callback with `completed | partial | failed | deferred`
- ConsentShield issues ≥ 100 deletions under production-like conditions
- Measured: instruction delivery rate, callback success rate, retry behaviour (3× 500 then success), overdue handling
- Documented case study for BFSI sales
- `test_delete` (G-035) used as smoke test

**Effort:** 2 weeks · **Dependencies:** G-035 + willing partner · **Owner:** Founder

---

### G-012 — Notice versioning — minimum re-consent workflow

**Whitepaper:** §4.3
**Actual state:** `consent_banners.version` exists; `notices` table + `material_change_flag` do not.

**Acceptance criteria:**
- `public.notices`: `id`, `org_id`, `version`, `title`, `published_at`, `material_change_flag`
- Publishing `material_change_flag=true` enumerates affected active artefacts
- Dashboard surface "X artefacts on prior notice — re-consent campaign" with action
- CSV export of affected principals (identifier, email if known, last consent date) for customer messaging
- Re-consent via banner or API correctly populates `replaced_by` chain
- Old artefact stays `active` until natural expiry or explicit revocation
- Audit trail: "campaign for notice v2026-04 affected N principals; M re-consented; K revoked; L didn't respond"

**Effort:** 3 weeks · **Dependencies:** G-007 helpful (retention-vs-re-consent distinction) · **Owner:** Founder

---

### G-013 — Solutions engineer capacity — hire or contract

**Whitepaper:** §11, §14
**Acceptance criteria:**
- Decision documented: hire FT vs contract per-engagement
- If contract: ≥ 2 named contractors with BFSI integration experience, rate cards agreed
- If hire: job spec written, search started, target start date set
- Handoff process (sales → integration): Purpose Definition Registry scope, mode decision, connector inventory
- BFSI pipeline capped at 2 simultaneous until SE capacity online
- Pricing model decided: SE-hours included per tier vs billable

**Effort:** Ongoing organisational; first hire/contract within 8 weeks of P1 trigger · **Dependencies:** Cash runway · **Owner:** Founder

---

### G-014 — Production support model — definition + tooling

**Whitepaper:** §13 FAQ, implied by BFSI pricing
**Acceptance criteria:**
- Written SLA per tier: response, resolution, maintenance window, uptime (99.5% Starter, 99.9% Pro/BFSI Growth, 99.95% BFSI Enterprise/Healthcare)
- Severity matrix: SEV1 data loss → 30 min; SEV2 outage → 2 hr; SEV3 cosmetic → next business day
- On-call schedule
- Incident comms: email + status page + optional Slack-bridge
- Post-incident process: written report in 5 business days for SEV1/2
- Tooling: PagerDuty (or equivalent)
- BFSI Enterprise contracts include SLA as a schedule

**Effort:** 2 weeks · **Dependencies:** G-013 · **Owner:** Founder

---

### G-015 — Status page + incident communication infrastructure

**Acceptance criteria:**
- `status.consentshield.in` provisioned (StatusPage.io, Atlassian, or self-hosted Cachet)
- Subsystems tracked: Banner CDN, Consent Capture API, Verification API, Deletion Orchestration, Dashboard, Notification Channels
- Automated uptime probes every 5 min
- Incident posting workflow < 2 min from a phone
- Email + webhook subscriber notifications
- 90-day uptime history
- Linked from main site footer and dashboard

**Effort:** 1 week · **Dependencies:** None · **Owner:** Founder

---

### G-039 — `/v1/consent/artefacts` + `/v1/consent/artefacts/{id}/revoke` + `/v1/consent/events`

**Whitepaper:** §11 (bank stores artefact IDs); Appendix A
**Acceptance criteria:**
- `GET /v1/consent/artefacts` with filters: property_id, data_principal_identifier, status, purpose_code, expires_before/after, limit ≤ 200, cursor
- `GET /v1/consent/artefacts/{id}` returning artefact + revocation record + replaced-by chain
- `POST /v1/consent/artefacts/{id}/revoke` body: `{ reason_code, reason_notes?, actor_type }`; re-uses existing `artefact_revocations` INSERT (ADR-0022)
- `GET /v1/consent/events` date-range filter; paged summary
- Scopes: `read:artefacts`, `write:artefacts`, `read:consent`
- Idempotent revoke: already-revoked → 200 with existing `revocation_record_id`
- Integration tests inc. §11 end-to-end fixture

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

### G-040 — `POST /v1/deletion/trigger` + `GET /v1/deletion/receipts`

**Whitepaper:** Appendix A; §6 passing
**Acceptance criteria:**
- `POST /v1/deletion/trigger` body: `{ property_id, data_principal, reason, purpose_codes?, deadline? }` creates appropriate `artefact_revocations` and/or `deletion_receipts` rows
- `GET /v1/deletion/receipts` filters: status, connector_id, artefact_id, issued_after/before
- Scopes: `write:deletion`, `read:deletion`
- Asserts principal has ≥1 matching artefact (unless `reason=erasure_request` which sweeps)
- Returns receipt IDs synchronously; dispatch runs asynchronously as today
- Integration tests

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

### G-041 — `storage_mode` enforcement at API gateway

**Whitepaper:** §2.2 "Security Rule 9"; §8.1
**Actual state:** Column exists (migration 20260413000003); no runtime gate.

**Acceptance criteria:**
- `public.get_storage_mode(p_org_id)` STABLE SQL, per-request cached
- Worker queries mode via cached KV; zero-storage orgs → ephemeral in-memory queue → direct Edge Function dispatch, bypassing `consent_events`
- `process-consent-event` branches: zero-storage writes `consent_artefact_index` (TTL-bounded) but NOT `consent_artefacts` persistent rows
- `delivery_buffer` zero-storage path: transient memory + immediate R2 upload, no durable row
- Invariant test: zero-storage org, 1000 events, `SELECT COUNT(*)=0` in `consent_events`, `consent_artefacts`, `delivery_buffer`
- Degraded-feature list for zero-storage surfaced in onboarding

**Effort:** 1 week (base enforcement; zero-storage data-plane rework absorbed into G-005) · **Dependencies:** None · **Owner:** Founder

---

### G-042 — Healthcare sector template seed

**Whitepaper:** §9.4, §8, §4.1
**Acceptance criteria:**
- New migration `<date>_healthcare_template_seed.sql`
- Purposes: teleconsultation, prescription dispensing, lab-report access, ABDM HIU/HIP insurance claim share, appointment reminders, marketing, research (broad-consent caveat)
- `storage_mode='zero_storage'` default for orgs applying the template
- Retention rules: DISHA 7 years, Clinical Establishments Act per-state
- Connector-mapping defaults: appointment reminder, EMR vendor placeholder
- Admin templates panel shows BFSI + Healthcare as published
- Healthcare-bundle onboarding path documented

**Effort:** 1 week · **Dependencies:** G-007 schema alignment preferable · **Owner:** Founder

---

### G-045 — Public OpenAPI spec + Appendix A regeneration + CI drift check

**Whitepaper:** Appendix A
**Acceptance criteria:**
- `openapi.yaml` at repo root or `app/public/openapi.yaml` covering every `/v1/*` endpoint
- Published at `https://api.consentshield.in/openapi.yaml`
- Script `scripts/regenerate-whitepaper-appendix.ts` emits markdown table from spec
- CI check: regeneration + diff vs Appendix A → fail build on drift
- Auth scheme, scopes, rate tiers, request/response schemas, error codes covered

**Effort:** 1 week · **Dependencies:** G-036–G-040 exist first · **Owner:** Founder

---

### G-046 — Sandbox organisation provisioning flow

**Whitepaper:** §12.1, §14
**Acceptance criteria:**
- `accounts.sandbox` boolean; plan gating bypassed; no billing rows created
- Self-serve provisioning button creates `org_test_<nanoid>` with sector template auto-applied
- Sandbox rate limits: 1000/hr on all tiers with dashboard banner
- Test data principal generator: `cs_test_principal_<seq>` endpoint for integration-test scaffolding
- Sandbox exports marked; excluded from production compliance score
- New `docs/customer-docs/sandbox.md`

**Effort:** 1 week · **Dependencies:** G-036 (API keys sandbox-scoped) · **Owner:** Founder

---

### G-048 — `orphan_consent_events` metric + alert wiring

**Whitepaper:** §3.3, §12.5
**Actual state:** `depa_compliance_metrics.coverage_score` exists; orphan count does not.

**Acceptance criteria:**
- View `public.vw_orphan_consent_events` returning `(org_id, count)` for `artefact_ids='{}'` rows with `created_at between now()-24h and now()-10min`
- pg_cron every 5 min reads the view; writes `depa_compliance_metrics.orphan_count`; fires notification-channels delivery on non-zero
- Dashboard compliance-health widget (G-034) shows orphan count + drill-down with safety-net retry history
- Integration test: disable Edge Function URL, verify metric + alert fire

**Effort:** 1 week · **Dependencies:** None (G-034 surfaces it) · **Owner:** Founder

---

## P2 — Required for full whitepaper deliverability

### G-016 — CleverTap connector

**Acceptance criteria:**
- OAuth app registered with CleverTap; CS app approved
- Dashboard setup: Connect → OAuth redirect → active connector
- Deletion: `POST /delete/profiles` on revocation
- Response: success → receipt confirmed; failure → failed with error
- Token refresh for expiring OAuth tokens
- Rate-limit error handling
- Customer-facing setup guide
- Integration test with real CleverTap test account

**Effort:** 1 week · **Dependencies:** G-002 conventions · **Owner:** Founder

---

### G-017 — Razorpay anonymisation connector

**Acceptance criteria:**
- OAuth setup with Razorpay
- `POST /customers/{id}/anonymize` on deletion
- PMLA consultation via Regulatory Exemption Engine (G-007): transaction records retained, PII fields anonymised
- Customer documentation explains PMLA-compliant pattern

**Effort:** 1 week · **Dependencies:** G-007, G-016 conventions · **Owner:** Founder

---

### G-018 — WebEngage + MoEngage connectors

**Acceptance criteria:**
- WebEngage: `DELETE /users/{id}`
- MoEngage: `DELETE /v1/customer/{id}`
- Both follow G-016 patterns (OAuth, retry, token refresh, error handling, dashboard)
- Integration tests vs real test accounts

**Effort:** 2 weeks · **Dependencies:** G-016 conventions · **Owner:** Founder

---

### G-019 — Intercom + Freshdesk connectors

**Acceptance criteria:**
- Intercom: `POST /user_delete_requests`
- Freshdesk: `PUT /api/v2/contacts/{id}` (anonymise)
- Established patterns
- Integration tests

**Effort:** 2 weeks · **Dependencies:** G-016 conventions · **Owner:** Founder

---

### G-020 — Shopify + WooCommerce connectors

**Acceptance criteria:**
- Shopify: `DELETE /customers/{id}` via REST Admin API (app install)
- WooCommerce: `POST /customers/{id}/anonymize` via consumer key/secret
- Both follow patterns adapted for non-OAuth auth
- Integration tests vs test stores

**Effort:** 2 weeks · **Dependencies:** G-016 conventions · **Owner:** Founder

---

### G-021 — Segment connector

**Acceptance criteria:**
- `POST /regulations` with `regulationType: Suppress_With_Delete`
- Segment Workspace API key (not OAuth)
- Polling for regulation status (multi-day async)
- Receipt status transitions: pending → accepted → confirmed over time
- Customer docs explain multi-day timeline

**Effort:** 1 week · **Dependencies:** G-016 conventions; async-receipt pattern · **Owner:** Founder

---

### G-022 — WordPress plugin

**Acceptance criteria:**
- Plugin injects banner script via settings page (org_id + property_id)
- WordPress 6.0+, PHP 7.4+, tested vs WooCommerce
- WP.org Plugin Directory submitted, approved, free install
- Dashboard widget shows compliance status
- One-click disconnect
- English + Hindi localised
- Setup screencast + troubleshooting guide

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder or PHP/WP contractor

---

### G-023 — Shopify App Store plugin + listing

**Acceptance criteria:**
- Shopify Partners account
- Remix/CLI-based app
- OAuth install + script-tag injection via Shopify Script Tag API
- Mandatory: GDPR webhooks, embedded UI, Billing API
- App Store listing with screenshots + demo store
- Approval received
- Pricing model decided (free/per-install/freemium)

**Effort:** 3 weeks · **Dependencies:** None · **Owner:** Founder or contractor

---

### G-024 — Java + Go client libraries

**Acceptance criteria:**
- Java: `com.consentshield:consentshield-client:1.0.0` on Maven Central
- Go: `github.com/consentshield-org/go-client` as Go module
- API parity with Node + Python (G-002/G-003)
- Fail-closed default
- Spring Boot example (Java); net/http example (Go)
- Coverage ≥ 80%

**Effort:** 2 weeks · **Dependencies:** G-002, G-003 · **Owner:** Founder or per-language contractor

---

### G-026 — DPB-format audit export structured packaging

**Whitepaper:** §12.4
**Acceptance criteria:**
- ZIP: `manifest.json`, `consent_artefacts.csv`, `artefact_revocations.csv`, `deletion_receipts.csv`, `rights_requests.csv`, `processing_logs.csv`, `breaches.csv`, `regulatory_exemptions_applied.csv`
- Three-link audit chain via documented FK joins in manifest
- Format spec at `docs.consentshield.in/audit-export-spec`
- Whitepaper §12.4 language amended: "structured format ready for regulatory submission; will align with DPB specs when published"
- 1M-artefact export < 60s
- `POST /v1/audit/export` returns download URL when ready (async for large)

**Effort:** 2 weeks · **Dependencies:** All schema stable · **Owner:** Founder

---

### G-027 — Sub-50ms verify p99 SLO — measurement + infrastructure

**Whitepaper:** §5.1
**Acceptance criteria:**
- Synthetic verify probes from Mumbai, Hyderabad, Bangalore, Delhi every minute
- Dashboard p50/p95/p99 over 24h/7d/30d
- If SLO not met: Cloudflare KV-backed validity cache replicated from Postgres with TTL invalidation on revocation events
- Public latency SLO; current performance on status page (G-015)
- BFSI Enterprise contracts reference the SLO

**Effort:** 2 weeks measurement + variable cache infra · **Dependencies:** G-015 · **Owner:** Founder

---

### G-034 — Compliance dashboard surfacing of orphan / overdue / expiry metrics

**Acceptance criteria:**
- Dashboard widget "Compliance Health": coverage score (100% target), orphan events (0), overdue deletions (0), upcoming expiries (30d count)
- Clickable drill-down per metric → affected artefacts/events with action buttons
- 5-min refresh
- Configurable threshold alerts (Surface 4 channels)
- Documentation: meaning + remediation per metric

**Effort:** 2 weeks · **Dependencies:** G-048 (orphan metric), other metrics already computed · **Owner:** Founder

---

### G-035 — `test_delete` endpoint for connector smoke testing

**Whitepaper:** §12.3
**Acceptance criteria:**
- `POST /v1/integrations/{connector_id}/test_delete`
- Generates deletion with `data_principal.identifier=cs_test_principal_<random>` and `reason=test`
- Customer endpoint branches on `reason==='test'` and skips real deletion
- Test deletion either excluded from compliance audit or clearly marked as test
- Rate limit: 10/connector/hr

**Effort:** 1 week · **Dependencies:** G-011, G-036 · **Owner:** Founder

---

### G-043 — Non-email notification channels

**Whitepaper:** §7 (Surface 4)
**Actual state:** `notification_channels` schema exists; only Resend email is wired.

**Acceptance criteria:**
- Adapters in `app/src/lib/notifications/adapters/`: slack, teams, discord, pagerduty, webhook
- Interface: `deliver(channel, event, severity) → { ok, external_id? }`; retries on 5xx; no retries on 4xx
- UI `/dashboard/settings/notifications` per-channel config + test-send
- Severity-to-channel mapping per §7
- PagerDuty via Events API v2
- Custom webhook signs body with channel's shared secret
- One live delivery per adapter in integration tests

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder

---

### G-044 — Audit export CSV-format alignment

**Whitepaper:** §12.4
**Actual state:** ADR-0017/0040 ship JSON-sectioned ZIP.

**Acceptance criteria:**
- New ZIP format: manifest + CSV files per entity (see G-026)
- Legacy JSON sections retained under `legacy/*.json` for 6 months, then removed
- Spec published
- 1M-artefact benchmark < 60s
- Dashboard export + R2 upload + `/v1/audit/export` all emit new format

**Effort:** 1 week · **Dependencies:** None · **Owner:** Founder

---

### G-047 — Tracker signature catalogue coverage to 200+

**Whitepaper:** §12.2
**Acceptance criteria:**
- ≥ 200 signatures in `admin.tracker_signature_catalogue`
- Coverage: Google (Analytics/Ads/GTM/Firebase), Meta (Pixel, CAPI), MarTech big-ten (Hotjar, Mixpanel, Segment, HubSpot, Salesforce, Adobe, Intercom, Zendesk, Drift, Amplitude), India (CleverTap, WebEngage, MoEngage, NetCore, Hansel), DMPs, fingerprinting libs
- Each: domains, cookie patterns, script URL patterns, classification
- Versioned + deprecation path
- Import script from Disconnect list / EasyList for bulk triage

**Effort:** 2 weeks · **Dependencies:** None · **Owner:** Founder or contractor

---

### G-049 — Public rights-request API

**Whitepaper:** Appendix A
**Acceptance criteria:**
- `GET /v1/rights/requests` paged + filtered; `POST /v1/rights/requests` (bypasses Turnstile but requires `identity_verified_by`)
- Scopes: `read:rights`, `write:rights`
- POST triggers same workflow as public path but skips Turnstile+OTP
- Separate audit-log trail marking API-created requests for DPB filtering
- Integration tests

**Effort:** 1 week · **Dependencies:** G-036 · **Owner:** Founder

---

## P3 — Phase 4 / post-launch hardening

### G-028 — React Native consent component (drop-in modal)

**Acceptance criteria:**
- `@consentshield/react-native` on npm
- `<ConsentShieldModal orgId="..." propertyId="..." purposes={[...]} onConsentRecorded={fn} />`
- Themeable via prop
- ABHA QR scanner (camera permission)
- Internally calls `/v1/consent/record`
- Tested iOS + Android with Expo and bare RN

**Effort:** 3 weeks · **Dependencies:** G-002/G-003 conventions · **Owner:** Founder or RN contractor

---

### G-029 — Webflow / Wix / Framer / Squarespace plugin decision

**Acceptance criteria:**
- Per platform: Build / Instructions / Remove
- For Build: new gap with estimate
- For Instructions: per-platform guide
- For Remove: whitepaper §4.1 edited
- Decision factors: market share, engineering effort, support burden

**Effort:** 0.5 day decision + variable · **Owner:** Founder

---

### G-030 — Q3 2026 connector batch

**Acceptance criteria:**
- Zoho CRM, Freshworks CRM, Zendesk, Campaign Monitor, Mixpanel — same pattern as G-016
- Sequenced by customer demand from pipeline

**Effort:** 4 weeks · **Dependencies:** G-016 patterns · **Owner:** Founder or contractor

---

### G-031 — Re-consent campaign multi-channel delivery

**Acceptance criteria:**
- Email (Resend), SMS (MSG91 or Twilio), WhatsApp (Razorpay/Gupshup), in-app push (FCM)
- Per-channel templates with merge fields
- Tracking: delivery, open (where supported), click-through
- Hosted re-consent page, branded, produces new artefact

**Effort:** 4 weeks · **Dependencies:** G-012 + per-channel vendor selection · **Owner:** Founder or contractor

---

### G-032 — HMAC signature secret rotation

**Acceptance criteria:**
- Dashboard action "Rotate webhook secret" per connector
- Dual-secret window: both old + new accepted for configurable period (default 7 days)
- Customer documentation
- Notification on rotation start + old-secret retirement
- Audit log capture

**Effort:** 1 week · **Dependencies:** G-011 · **Owner:** Founder

---

### G-033 — SOC 2 Type II audit observation — verify start

**Acceptance criteria:**
- Auditor engaged with signed letter
- Observation start date confirmed; evidence collection underway
- Realistic delivery date set (likely Q1 2027)
- Whitepaper §14 + Operational Maturity appendix (G-004) updated
- If Q4 2026 infeasible: soften to "Type I available; Type II in progress, expected H1 2027"

**Effort:** Process + audit cost (₹15–25 lakh) · **Dependencies:** Documented controls + cash · **Owner:** Founder

---

## Closed since initial document

| ID | Title | Resolution |
|---|---|---|
| G-025 | Consent probe testing infrastructure | Shipped in ADR-0041 (Vercel Sandbox runner + probe CRUD UI). Residual signature-catalogue coverage carved out as G-047. |

---

## Cross-cutting concerns

### CC-A → G-045 — Promoted to a gap (OpenAPI + CI drift check)

### CC-B — Documentation consistency

Whitepaper, Architecture Reference, and Schema Design must remain consistent as gaps close. PR template checkbox: "Whitepaper / Architecture / Schema updated where affected."

### CC-C — Testing coverage standards

- API endpoints: ≥ 80% line coverage
- DB triggers/functions: 100% (every code path)
- Client libraries: ≥ 80%
- Connectors: integration tests vs real partner sandboxes for deletion path

### CC-D — Security review cadence

Client libraries (G-002/G-003 fail-closed), generic webhook (G-011 HMAC), OAuth connectors (G-016–G-021 token storage), and G-036 API-key system need targeted security review. Quarterly external pen test starting Q3 2026 with reputable Indian firm; results feed SOC 2 evidence.

### CC-E — Schema migration discipline

Every change: numbered migration, reversible (down-migration tested), RLS policies on new tables, tested at production-volume clone, documented in Complete Schema Design.

### CC-F — Whitepaper-as-normative-spec

The v2.0 whitepaper is the customer-facing normative spec for the compliance-API surface. Any ADR changing a `/v1/*` shape must be paired with a whitepaper amendment (or errata) before Completed. Once G-045's CI check is in place, drift is caught automatically.

---

## Revised critical-path sequencing

### Sprint 1 (Weeks 1–2): Marketing accuracy + public API foundation
- G-001 (catalogue accuracy) — 0.5 day
- G-004 (operational-maturity appendix) — 1 day
- G-036 (public API scaffolding) — 2 weeks

### Sprint 2 (Weeks 3–4): Verification + record endpoints
- G-037 (verify + batch) — 2 weeks
- G-038 (record) — 1.5 weeks overlapping

**Milestone:** whitepaper defensibly distributable to a BFSI prospect (~week 4).

### Sprint 3 (Weeks 5–7): Storage-mode + Zero-Storage + Insulated + batch-verify load
- G-041 — 1 week
- G-005 — 3 weeks (starts week 5)
- G-006 — 2 weeks (parallel)
- G-009 — 1 week (week 7)
- G-010 — 1 week (week 7 parallel)

### Sprint 4 (Weeks 8–10): Regulatory engine + webhook partner + healthcare seed + sandbox
- G-007 — 3 weeks
- G-008 — 2 weeks (parallel, week 8)
- G-011 — 2 weeks (parallel, week 9)
- G-035 — 1 week (week 8)
- G-042 — 1 week (week 10)
- G-046 — 1 week (week 10 parallel)

### Sprint 5 (Weeks 11–13): Artefact API + deletion API + notice + support
- G-039 — 1 week
- G-040 — 1 week parallel
- G-012 — 3 weeks
- G-048 — 1 week parallel
- G-014 — 2 weeks (week 11 start)
- G-013 — background
- G-015 — 1 week parallel
- G-034 — 2 weeks (weeks 12–13)

### Sprint 6 (Weeks 14–15): Client libraries + OpenAPI + rights API
- G-002 — 1 week
- G-003 — 1 week parallel
- G-045 — 1 week parallel
- G-049 — 1 week (week 15)

**Milestone:** first BFSI Enterprise go-live ready (~week 15).

### After Sprint 6 (Week 16+): P2 connectors + plugins + polish + P3
Connectors G-016–G-021 (~10 weeks demand-sequenced) · Plugins G-022/G-023 (~5 weeks parallel) · G-024 Java/Go (2 weeks) · G-026 DPB export (2 weeks) · G-027 verify SLO infra (2 weeks) · G-043 notification channels (2 weeks) · G-044 audit CSV (1 week) · G-047 tracker signatures (2 weeks) · P3 block afterwards.

---

## Critical-path summary

- **Whitepaper defensibly distributable to BFSI prospect:** end of Sprint 2 = **~4 weeks**.
- **First BFSI Enterprise signature (with Operational Maturity appendix in hand):** end of Sprint 2 + contract = ~6 weeks.
- **First BFSI Enterprise go-live:** end of Sprint 6 = **~15 weeks**.
- **Two simultaneous BFSI Enterprise customers:** infeasible without G-013 landing during Sprints 3–5.

---

## Document maintenance

Update on:
- Any gap closes → mark **Closed** with date + ADR / PR reference; move to "Closed" table.
- New gap discovered → append with next sequential ID in appropriate band.
- Whitepaper revised → re-run verification sweep, issue new revision.
- Quarterly review → re-prioritise based on pipeline + capacity.

*Canonical · 2026-04-19 · Next scheduled review: after Sprint 2 closes (mid-May 2026 expected).*
