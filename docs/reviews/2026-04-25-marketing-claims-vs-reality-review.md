# Marketing claims vs. reality review

**Date:** 2026-04-25 07:02 IST
**Reviewer:** Sudhindra Anegondhi (Terminal C session)
**Scope:** All claims rendered on the marketing site (`marketing/src/app/**`), the customer-app dashboard (`app/src/app/(dashboard)/**`), and the docs hub (`marketing/src/app/docs/**`), reconciled against the actual code state at commit `ae48a96`.
**Trigger:** Cross-check between `docs/competition/ConsentShield-Competitive-Landscape-Briefing-v1.md` and live marketing copy.
**Format:** One issue at a time. Each item carries an explicit decision from the founder.

---

## How this review will be used

Each finding below is a falsifiable claim that does not match the running code. Three kinds of decision are available per item:

- **FIX-COPY** — leave the implementation as-is; rewrite the marketing/docs claim to match what's built.
- **BUILD** — open a sprint (or schedule one) to ship the missing capability; leave the claim live with a target date.
- **REMOVE** — strike the claim; do not commit to building it.

The decisions are recorded inline. Each claim that is not FIX-COPY-and-shipped today gets a follow-up ADR or sprint pointer.

---

## Issue 1 — Deletion-connector counts ("3 / 13 / Unlimited")

**Claim (live on marketing):**
- Pricing preview: Growth = "3 connectors", Pro = "13 connectors", Enterprise = "Unlimited deletion connectors".
  - `marketing/src/components/sections/pricing-preview.tsx:67,80`
  - `marketing/src/components/sections/price-table.tsx:101-104`
- Product LAYER_2: "Pre-built connectors: Mailchimp, HubSpot, Zoho CRM, Freshdesk, Intercom, CleverTap, Shopify, Razorpay, others."
  - `marketing/src/app/product/page.tsx:46`

**Reality in code:**
- Only **2** OAuth providers wired — `mailchimp` and `hubspot` — `app/src/lib/connectors/oauth/registry.ts:6-13`.
- The repo's own catalogue (`app/src/lib/connectors/README.md`) labels the remaining 14 as "Q3 2026" or "Q4 2026", not shipping today.
- Growth's "3 connectors" cannot be honoured with 2 built. Pro's "13" and Enterprise's "Unlimited" are aspirational.

**Severity:** Hard contradiction — a paying Growth customer cannot get the count they're being sold.

**Decision — BUILD (staged):**
- Ship the **promised counts** (3 for Growth, 13 for Pro, "Unlimited" for Enterprise via custom-webhook connector) **before external release** of the pricing surface.
- The 14 connectors catalogued in `app/src/lib/connectors/README.md` as "Q3 2026" / "Q4 2026" are confirmed as the **Q3 2026 slate** — pulled forward into the pre-release window if required to meet the three-connector Growth minimum; otherwise delivered on the existing Q3 schedule.

**Work tracked in:**
- ADR-1007 (pre-built deletion connectors roadmap) — Phase 1 Sprints 1.1–1.5 expanded to land Mailchimp, HubSpot, plus at least one additional Growth-eligible connector before any paying Growth signup. Remainder under the Q3 2026 milestone.
- Pricing copy **stays live unchanged** with this commitment; no FIX-COPY today.

**Non-negotiable:** No external distribution of the Growth tier until at least 3 working connectors are live end-to-end (OAuth + deletion API call + receipt + integration test against a real partner sandbox).

---

## Issue 2 — End-to-end deletion fan-out

**Claim (live on marketing):**
- Story card 02: "When a user withdraws consent, ConsentShield revokes the artefact, orchestrates deletion across connected systems, and verifies enforcement with a re-scan." — `marketing/src/components/sections/story.tsx`
- Product LAYER_2 — "Artefact-scoped deletion" — `marketing/src/app/product/page.tsx:42-46`
- DEPA compare row — "Orchestrate deletion across connected systems scoped to the artefact's data scope, collect signed receipts." — `marketing/src/components/sections/depa-compare.tsx`

**Reality in code:**
- `supabase/functions/process-artefact-revocation/index.ts` header comment (lines 37–43): *"this function only **creates** pending `deletion_receipts` rows. The actual connector call (webhook / Mailchimp API / HubSpot API) is the existing rights-dispatcher path's responsibility; ADR-0023 will unify the two call sites. Until then, revocation-triggered receipts sit in status='pending' until manually or programmatically dispatched."*
- Revocation → actual third-party DELETE is not wired in a single unbroken automatic path today.

**Severity:** Hard contradiction — the copy describes one seamless flow; the code requires a second dispatch step that is not guaranteed to run.

**Decision — BUILD + FIX-COPY:**
- **BUILD:** Ship **ADR-0023** (unified deletion dispatcher — revocation-triggered and rights-request-triggered receipts handled by a single dispatch path) before external release. This makes the claim literally true.
- **FIX-COPY (interim):** Until ADR-0023 closes, amend the Story card / LAYER_2 / DEPA-compare copy to make the two-step nature explicit — *"ConsentShield revokes the artefact and issues a signed deletion request to each connected system; the connector performs the actual DELETE and POSTs back a signed receipt."* No "connector call is automatic and instantaneous" language.
- Once ADR-0023 ships, revert to the stronger single-flow wording.

**Fallback capability — what ConsentShield does in the absence of a pre-built connector**

This was raised as a side question during the review and is captured here because it defines the honest floor for what every customer gets on day one, regardless of which connectors have shipped.

For any connected system without a ConsentShield-built OAuth+API connector:

1. **Custom webhook connector (documented, live).** The customer hosts one HTTPS endpoint. On revocation / erasure, ConsentShield POSTs the fan-out payload signed with a shared `signing_secret`; the customer's backend performs the actual DELETE / anonymise in their own system; the customer POSTs a signed receipt back to the `callback_url` ConsentShield provided. Full contract at `marketing/src/app/docs/cookbook/wire-deletion-connector-webhook/page.mdx`; signing scheme at `/docs/webhook-signatures`.
2. **Artefact revocation is authoritative even with zero connectors.** Revoking the artefact:
   - Removes it from the validity cache, so `/v1/consent/verify` and the banner immediately stop authorising the flow.
   - Causes the Worker's tracker layer to stop treating the matching purpose as consented — so trackers tied to that purpose are blocked at the browser level on every page load following the revocation.
   - This is the enforcement half ConsentShield owns regardless of downstream systems.
3. **Pending-deletion queue surfaced in the dashboard.** All `deletion_receipts` rows (pending / succeeded / failed) appear in the Rights panel for the operator. Missing connectors surface as pending rows with the SLA clock visible — the compliance contact can act manually and mark the receipt complete, or escalate. Nothing is silently dropped.
4. **SLA reminders + email dispatch (shipped).** `supabase/functions/send-sla-reminders/index.ts` fires 7-day and 1-day warnings for unverified / pending rights requests. Works with or without connectors.
5. **Signed callback URLs (shipped, Rule 9).** Every callback URL is HMAC-signed; the callback endpoint verifies the signature before accepting any confirmation — so even a manually-run connector can deposit a non-repudiable receipt.
6. **Audit-export package carries unfulfilled requests (shipped).** `app/src/app/api/orgs/[orgId]/audit-export/route.ts` serialises every pending / failed receipt into the export ZIP. A DPB inspection gets the full chain — including connectors the customer never wired — with explicit status per receipt.
7. **`/v1/integrations/[connector_id]/test_delete` endpoint (shipped).** Operators can dry-run a deletion through a configured connector before trusting it in production.

**The honest sentence:** *without a pre-built or custom connector, ConsentShield gives the customer a scoped, signed, time-bounded deletion **instruction** with an auditable pending queue — the DPB-facing evidence that the Fiduciary issued the right request at the right time — while downstream physical deletion remains the Fiduciary's responsibility.* This is the DPDP-Processor posture (Rule 4: "the customer owns the compliance record").

**Work tracked in:**
- ADR-0023 — unified deletion dispatcher (promoted to pre-release blocker by this decision).
- Copy amendment ships as part of the broader marketing-claims rewrite commit that closes this review.

---

## Issue 3 — ABDM healthcare bundle (ABHA / prescriptions / drug-interaction)

**Claim (live on marketing):**
- Product LAYER_4: "ABHA lookup, ABDM consent artefacts, health record retrieval, prescription writing with drug interaction checks, digital prescription upload." — `marketing/src/app/product/page.tsx:101-104`
- Solutions Healthcare tab: "ABHA ID resolution, consent-gated health record pull, prescription writing with AI drug interaction check, digital prescription upload back to ABDM." — `marketing/src/components/sections/solutions-tabs.tsx`
- Pricing add-on: "Healthcare bundle ₹4,999/mo (₹60,000–1,00,000/yr)." — `marketing/src/app/pricing/page.tsx:51-52`

**Reality in code:**
- Zero ABHA / ABDM / FHIR client modules.
- No prescription workflow, no drug-interaction module, no ABDM Gateway adapter.
- Only surfaces: `framework='abdm'` enum on artefact filters (`app/src/app/api/orgs/[orgId]/artefacts.csv/route.ts:63`, `purposes-view.tsx:338`), and the healthcare retention row in `supabase/migrations/20260804000006_regulatory_exemptions_healthcare_seed.sql`.
- `abdm_bundle: true` in `app/src/lib/billing/plans.ts:32` is a billing flag with no consumers.

**Severity:** Hard contradiction — the bundle is priced and sold but not built.

**Decision — BUILD (new ADR series, range `0500–05NN`):**
- Open a new **Healthcare-bundle ADR series starting at ADR-0500**. The `0500–0599` range is reserved exclusively for healthcare / ABDM / FHIR / clinical-workflow work — kept disjoint from the in-flight `ADR-10NN` pipeline series so Terminal A's current workstream is not disturbed.
- The series covers the full bundle:
  - **ADR-0500** — Healthcare-bundle charter + scope + clinical-partner + clinical-safety review gate (must pass before any drug-interaction code ships).
  - **ADR-0501** — ABHA lookup + ABDM Gateway client (auth, sandbox, ABHA ID resolution).
  - **ADR-0502** — ABDM consent-artefact unification (bridge the `framework='abdm'` artefact to HIE-CM consent-grant format; round-trip with ABDM sandbox).
  - **ADR-0503** — Health-record retrieval + FHIR in-memory passthrough (Rule 3 enforcement: zero FHIR persistence, ever; covered by an RLS + grep gate).
  - **ADR-0504** — Prescription-writer UI + write-back to ABDM.
  - **ADR-0505** — Drug-interaction adapter (partner-API-backed; clinical-safety review mandatory; disclaimer surface; not a medical-device claim).
  - **ADR-0506** — Healthcare bundle billing flag wiring (surface the add-on only when a healthcare purpose is active on the org; revoke automatically if not).
  - Additional sprints numbered inside each ADR as 0500.1, 0500.2, … following existing sprint convention.
- **Pricing copy stays live** with the bundle commitment; no FIX-COPY today.
- Non-negotiable: no healthcare-bundle subscriptions accepted from customers until **ADR-0500 through ADR-0502 are complete at minimum** (ABHA + unified artefact round-trip). Shipping the drug-interaction module (ADR-0505) also requires a clinical-partner MoU on record — not a solo-authored checker.

**Regulatory note:** the drug-interaction claim crosses into medical-device territory in some interpretations. ADR-0500 must include a legal review step on whether the interaction checker is framed as a clinical decision-support tool (CDSS) and what disclaimers / partner arrangements are required. This review gate is a blocker on ADR-0505, not on the rest of the series.

**Strategic alignment:** memory `project_customer_segment_enterprise.md` notes the primary ICP is large Indian corporates rather than clinics, but the competition briefing (§3, §6.2) identifies the ABDM + DPDP unified artefact model as a genuine defensible wedge — particularly across the 438,000 ABDM-registered facilities. The `0500` series is how that wedge becomes code.

**Work tracked in:**
- ADR-0500 series (new, healthcare) — to be drafted in `docs/ADRs/ADR-0500-healthcare-bundle-charter.md` (and siblings).
- Competition briefing §9.3 ("Sectoral depth is the defensible wedge — Healthcare track").

---

## Issue 4 — Zero-storage mode for FHIR / clinical content

**Claim (live on marketing):**
- Product LAYER_4 — Zero-storage mode: *"Mandatory for health data. FHIR records flow through ConsentShield in memory only — never persisted. Clinical content never touches ConsentShield's databases."* — `marketing/src/app/product/page.tsx:106-108`
- Solutions Healthcare tab: *"FHIR records flow through memory only — never persisted. Any code path that tries to persist clinical content is rejected in review."* — `marketing/src/components/sections/solutions-tabs.tsx`

**Reality in code:**
- Zero-storage **consent-record** path is real and just shipped (ADR-1003 Sprint 1.4, commit `99cf35b`): `worker/src/zero-storage-bridge.ts`, `worker/src/storage-mode.ts`, migration 54.
- Zero-storage **FHIR / clinical-content** path is not built. There is no FHIR ingest endpoint, no clinical-content passthrough, no in-memory FHIR processor. Rule 3 (CLAUDE.md) codifies the invariant but has no FHIR path to guard today.
- The sentence is technically vacuously true ("we don't persist what we don't ingest") but misleading — a reader will infer a live in-memory FHIR ingest path that doesn't exist.

**Severity:** Misleading now; becomes a hard contradiction the moment a healthcare customer tries to pipe FHIR through.

**Decision — BUILD (already covered by ADR-0503):**
- FHIR in-memory passthrough is scoped under **ADR-0503** in the Healthcare-bundle series (see Issue 3). No separate build track needed.
- **Pre-launch gate:** the marketing claim stays live. The Healthcare bundle (and therefore this claim) is only offered to customers after ADR-0500 → ADR-0503 ship — consistent with the Issue-3 gate.
- Rule 3 (no FHIR persistence, anywhere, ever) is the binding constraint on ADR-0503's implementation. The grep-gate + RLS check enforcing Rule 3 is a line-item in ADR-0503's acceptance criteria.

**Work tracked in:**
- ADR-0503 (FHIR in-memory passthrough, Healthcare-bundle series).
- No copy edit today — the claim is honest once ADR-0503 ships, and the Healthcare bundle is not live until then.

---

## Issue 5 — GDPR module

**Claim (live on marketing):**
- Product LAYER_3 — GDPR module: *"Dual-framework coverage. Banner detects visitor location and applies the right framework. Adds legal basis documentation, DPIA templates, SCC tracking, EU representative."* — `marketing/src/app/product/page.tsx:78-80`
- Pricing Pro + Enterprise tiers — `marketing/src/components/sections/pricing-preview.tsx:67`, `price-table.tsx`.
- Solutions SaaS tab: *"Dual DPDP + GDPR in one artefact. Same consent record covers both frameworks. Visitor location switches the legal basis and notice automatically."* — `marketing/src/components/sections/solutions-tabs.tsx`

**Reality in code:**
- Only surface: `'gdpr'` enum value in framework filters (`app/src/app/api/orgs/[orgId]/artefacts.csv/route.ts:63`, `dashboard/artefacts/page.tsx:91`, `purposes-view.tsx:339`).
- No geo-detection in `worker/src/banner.ts` — same JS regardless of visitor location.
- No DPIA templates, no SCC tracker, no EU-representative workflow, no Article-30 RoPA export, no legal-basis picker.
- `gdpr_module: true` in `app/src/lib/billing/plans.ts` has one consumer: a chip rendered in `dashboard/billing/page.tsx:152`.

**Severity:** Hard contradiction — sold at Pro and Enterprise; paying customers get only a framework label.

**Decision — BUILD as "GDPR-lite" (new ADR series, range `0600–06NN`):**
- New **GDPR ADR series starting at ADR-0600**. Range `0600–0699` reserved exclusively for GDPR / cross-border / EU-adjacent work — disjoint from the `0500` healthcare series and Terminal A's `10NN` pipeline series.
- **Scope — "GDPR-lite":** the target buyer is an **Indian company with EU exposure** (the Solutions SaaS persona — Indian SaaS, edtech, D2C shipping to EU customers). CS is **not** pursuing EU-HQ customers, EU market-access certifications, or a full GDPR-only offering. That framing keeps the build tractable and aligned with the competition briefing's "sectoral / Indian-native" wedge (§9.3).
- The series covers:
  - **ADR-0600** — GDPR-lite charter + scope + positioning. Explicit statement: Indian customers with EU data subjects; not an EU-market product. Disclaimers wired into pricing, docs, DPA.
  - **ADR-0601** — Banner geo-detection in the Worker (visitor-country classification at the edge; DPDP / GDPR framework selection; notice + legal-basis surface switched per visitor). Zero-dep per Rule 16 (or adds the same carve-out line if a geo-IP lookup requires one — justified in the ADR).
  - **ADR-0602** — Legal-basis picker on purpose definitions (consent / contract / legitimate-interest / legal-obligation / vital-interests / public-task) stored on `purpose_definitions`; artefact carries the basis at grant time.
  - **ADR-0603** — DPIA template library (canonical GDPR Article-35 assessment shell; no ML, no auto-fill beyond org metadata; documents stored in customer-owned storage per Rule 4).
  - **ADR-0604** — SCC tracker (Standard Contractual Clauses for onward transfers out of EU; a register + expiry reminder pipe on top of the existing SLA-reminder infrastructure, not a novel service).
  - **ADR-0605** — EU-representative field on org profile + surface on the privacy notice; nothing more. CS does not appoint or operate the representative; the customer fills the field in.
  - **ADR-0606** — Article-30 RoPA export (add a RoPA-shaped JSON section to the existing audit-export ZIP; purpose register + data categories + recipients + retention + cross-border status).
  - **ADR-0607** — GDPR module billing flag wiring (surface Pro-tier GDPR module only when at least one GDPR-framework purpose is active or visitor-geo detection is enabled).
- **Out of scope (explicit):**
  - EU-HQ sales motion.
  - Full EU DPO appointment / EU-establishment advisory.
  - Cookie-wall A/B testing or consent-rate optimisation tooling (OneTrust / Didomi territory — not our wedge).
  - Automated DPIA completion by AI.
- **Pricing copy stays live** with the Pro-tier "GDPR module" commitment; no FIX-COPY today.
- **Pre-subscription gate:** the Pro-tier GDPR line item is only honoured after **ADR-0600 → ADR-0603 ship at minimum** (charter + geo-detect + legal-basis picker + DPIA library). ADR-0604–0607 can follow without blocking sales.

**Work tracked in:**
- ADR-0600 series (new, GDPR-lite) — to be drafted in `docs/ADRs/ADR-0600-gdpr-lite-charter.md`.
- Competition briefing §9.3 — GDPR-lite remains a secondary wedge to the sectoral BFSI / healthcare plays.

---

## Issue 6 — DPO-as-a-Service marketplace / DPO matchmaking

**Claim (live on marketing):**
- Product LAYER_3 — DPO-as-a-Service marketplace: *"Curated marketplace of empanelled Data Protection Officers with auditor-level dashboard access. DPO carries legal liability; ConsentShield carries software liability."* — `marketing/src/app/product/page.tsx:85-87`
- Pricing Enterprise tier — "DPO matchmaking" (`pricing-preview.tsx:90`, `price-table.tsx`).

**Reality in code:**
- No marketplace page, no DPO directory, no DPO profile table, no matching RPC.
- `dpo_matching: true` in `app/src/lib/billing/plans.ts` has a single consumer: a chip in `dashboard/billing/page.tsx:155`.
- The auditors dashboard (`app/src/app/(dashboard)/dashboard/auditors/`) supports CA / SEBI / RBI-empanelled auditor access — not DPO matchmaking.

**Severity:** Hard contradiction — sold at Enterprise; paying customers get a billing chip and an unrelated (auditor) panel.

**Decision — BUILD under new ADR series `0700–07NN`, marked publicly as "Proposed — Q3/Q4 2026":**
- New **Marketplace / Ecosystem ADR series starting at ADR-0700**. Range `0700–0799` reserved for marketplace, partner ecosystem, and two-sided DPO / auditor-network work — disjoint from `0500` (healthcare), `0600` (GDPR-lite), and Terminal A's `10NN` pipeline series.
- The series covers:
  - **ADR-0700** — Marketplace charter: scope, liability apportionment (DPO carries legal, CS carries software), empanelment criteria, commercial model (revenue share vs. flat listing), grievance-and-removal workflow. Legal review gate before any public-facing empanellee appears.
  - **ADR-0701** — DPO / auditor directory data model (`marketplace.providers`, empanelment status, specialisations, SEBI / RBI / ICAI attestations where applicable, pricing bands, capacity signal).
  - **ADR-0702** — Customer-side matching surface (search + filter + request-intro; no auto-assignment — human-in-the-loop on both sides).
  - **ADR-0703** — Scoped dashboard access for empanelled providers (reuse auditors-panel RLS scaffolding where possible; extend to DPO-specific read/action scope).
  - **ADR-0704** — Marketplace billing + revenue-share wiring (layered on top of the Razorpay billing issuer rework landed under ADR-0050 / 0051).
  - **ADR-0705** — DPO-onboarding workflow (KYC, contract pack, liability attestation, empanelment publication).
- **Public surfacing — update marketing copy now to reflect Proposed / Q3-Q4 2026 status**:
  - **Product LAYER_3**: rewrite "DPO-as-a-Service marketplace" card to lead with a **"Proposed · Q3–Q4 2026"** pill. Body text softened to *"A curated marketplace of empanelled DPOs, designed so the DPO carries legal liability while ConsentShield carries software liability. Opening in phases through Q3–Q4 2026 under ADR-0700. Today, Enterprise customers can bring their own DPO or CA firm and grant scoped dashboard access via the Auditors panel."*
  - **Pricing Enterprise tier**: change the "DPO matchmaking" bullet to *"DPO marketplace access (Proposed — Q3–Q4 2026)"* so the commitment is visible but not claimed-as-shipped.
  - **Price-table Enterprise-only row**: same treatment — label "DPO marketplace (Q3–Q4 2026)" with the ✓ retained as a forward commitment, or swap the glyph to a distinct "🕓 planned" marker if the price-table supports it.
  - Today's auditors panel is **not a substitute claim** — it is positioned separately as "bring-your-own auditor / DPO with scoped access". Do not quietly rebrand the auditors panel as the marketplace.
- **Pre-launch gate:** no Enterprise subscription is sold on the basis of "DPO matchmaking" as a live feature until **ADR-0700 through ADR-0703** ship. Marketing copy carrying the Q3/Q4 2026 pill is the honest interim state.

**Strategic context:**
- A marketplace is an operational business (empanelment, contracts, grievance, revenue share), not just code. The ADR-0700 charter must resolve the commercial + legal track alongside engineering before any public empanellee lands.
- Competition briefing §3.2 + §9.4 already treats CA firms, Big 4, and fintech lawyers as partner categories. The marketplace **extends** the partnership model; it does not replace partner referrals during the proposed window.

**Work tracked in:**
- ADR-0700 series (new, marketplace / ecosystem) — drafted in `docs/ADRs/ADR-0700-dpo-marketplace-charter.md`.
- Marketing copy amendment (Q3/Q4 2026 pill + honest interim) ships as part of the broader marketing-claims rewrite commit that closes this review.

---

## Issue 7 — White-label + custom domains

**Claim (live on marketing):**
- Pricing Enterprise tier — "White-label + custom domains" (`marketing/src/components/sections/pricing-preview.tsx:88`, `price-table.tsx`).
- Product LAYER_4 — Enterprise white-label: *"Custom branding, custom domains, SSO, multi-team roles, customer-held encryption keys for export storage, custom SLAs. Built for CA firms managing multiple clients."* — `marketing/src/app/product/page.tsx:113-115`

**Reality in code:**
- `white_label: true` in `app/src/lib/billing/plans.ts` has no consumers in `app/src/app/**`.
- No per-org domain-binding code, no Vercel domain-attach hook, no CNAME / TLS cert provisioning pipeline, no per-tenant theme / brand-token layer.
- No SSO (SAML / OIDC-federation); Supabase Auth is email/OTP per existing reference memory.
- "Customer-held encryption keys" — BYOS for the export bucket is partially real (ADR-1003 Phase 2); customer-KMS-wrapped keys are not.
- Multi-team roles + BYOS storage are real (ADR-0044 / 0047 and ADR-1003 Phase 2); custom SLAs are a contract concern, not code.

**Severity:** Hard contradiction on white-label + custom domains + SSO + customer-KMS.

**Decision — BUILD under new ADR series `0800–08NN` (Enterprise platform):**
- New **Enterprise-platform ADR series starting at ADR-0800**. Range `0800–0899` reserved for enterprise-grade hosting, tenancy, identity-federation, and key-management work — disjoint from `0500` (healthcare), `0600` (GDPR-lite), `0700` (marketplace), and Terminal A's `10NN` pipeline series.
- The series covers:
  - **ADR-0800** — Enterprise-platform charter: scope, ICP alignment (large Indian corporates per `project_customer_segment_enterprise.md` + BFSI per competition §9.3), tiering, acceptance criteria. Pre-launch gate defined per sub-capability.
  - **ADR-0801** — Custom-domain binding (operator-managed CNAME + Vercel domain attach + auto-TLS via Vercel; `public.org_domains` table + RLS; dashboard panel for add / verify / activate). Supports `app.<customer>.com` and `banner.<customer>.com` style subdomains.
  - **ADR-0802** — White-label branding (per-org brand tokens — logo, wordmark, primary / accent colours, favicon; applied to dashboard shell, emails, audit-export cover page, and banner-script defaults).
  - **ADR-0803** — SSO via SAML 2.0 (enterprise IdP — Okta, Azure AD / Entra ID, Google Workspace SAML). Supabase Auth SAML provisioning; JIT user creation scoped to the org; AAL mapping respected (MFA requirement carries through).
  - **ADR-0804** — SSO via OIDC (federated IdPs, OAuth 2.1 PKCE; feature-equivalent to 0803 for OIDC-native IdPs).
  - **ADR-0805** — Customer-held KMS integration for export-bucket encryption (per-org KMS key reference; AWS KMS + GCP KMS + Azure Key Vault; envelope encryption; key rotation surfaces; disaster-recovery runbook for key-access loss).
  - **ADR-0806** — Enterprise SLA surface (contractual status-page entry + incident-credit calculator + quarterly review export; layers on existing status infra once Issue 18 closes).
  - **ADR-0807** — Operator-facing Enterprise console in `admin/` (customer-held KMS key-status readouts, SAML / OIDC connection health, custom-domain cert expiry alarms, white-label brand-review queue).
- **Pre-subscription gate:** no Enterprise tier is sold on the basis of these features as live until the corresponding ADR has shipped. Per-capability gating:
  - Custom domain → ADR-0801 complete.
  - White-label branding → ADR-0802 complete.
  - SSO → ADR-0803 **or** ADR-0804 complete (whichever the customer needs first; both will ship).
  - Customer-held KMS → ADR-0805 complete.
- Pricing copy on white-label + custom domains stays live as a forward commitment until the ADRs ship; the broader marketing rewrite commit that closes this review will **mark the Enterprise row as "Phased rollout — see ADR-0800 series"** rather than silent "Coming soon", so the commitment is visible and dated.

**Strategic context:**
- Custom-domain + white-label is table-stakes for BFSI / enterprise personas (competition briefing §9.3, §9.4 — core-banking channel + multi-brand enterprises).
- SSO is a non-negotiable for large-corporate procurement per the enterprise-segment memory; without it, procurement stalls before product evaluation.
- Customer-held KMS is a genuine niche requirement for bank risk committees and complements the Zero-Storage architecture as a deployment differentiator.

**Work tracked in:**
- ADR-0800 series (new, Enterprise platform) — drafted in `docs/ADRs/ADR-0800-enterprise-platform-charter.md` and siblings.
- Competition briefing §9.3 ("Sectoral depth is the defensible wedge — BFSI track").

---

## Issue 8 — 72-hour breach workflow

**Claim (live on marketing):**
- Product LAYER_1 — 72-hour breach workflow: *"Guided end-to-end: detect → log → categorise → assess → draft → approve → notify → remediate. Surfaces which active artefacts are affected. Every step timestamped."* — `marketing/src/app/product/page.tsx:35-37`
- Pricing table — "72-hour breach workflow" appears in **every** tier (Starter, Growth, Pro, Enterprise) under "Compliance foundation". — `marketing/src/components/sections/price-table.tsx:45-50`

**Reality in code:**
- No breach pages, routes, or migrations. `find app/src -iname "*breach*" -type d` returns nothing.
- No `security_incidents` / `breach_notifications` tables, no dispatcher, no audit-export `breach_notifications` section (`app/src/app/api/orgs/[orgId]/audit-export/route.ts` manifest omits the field entirely).

**Severity:** Hard contradiction at maximum distribution — the claim is sold in every tier, starting at ₹2,999. DPDP §8(6) makes breach notification mandatory, so this is the highest-stakes single overclaim on the site.

**Decision — BUILD under new ADR series `0900–09NN` (Breach / incident management); pre-release blocker on all tiers:**
- New **Breach / incident-management ADR series starting at ADR-0900**. Range `0900–0999` reserved for incident detection, categorisation, notification dispatch, regulator liaison, and post-incident review — disjoint from `0500` / `0600` / `0700` / `0800` and Terminal A's `10NN` series. Issue 9 (BFSI dual / triple timelines) is **also** in this series — single coherent workflow with variants per sector, not two parallel stacks.
- The series covers:
  - **ADR-0900** — Breach / incident charter: DPDP §8(6) obligations, scope, roles (incident commander, DPO, legal, comms), non-negotiable timestamping per step, links to Rule 3 (Sentry strips PII) and Rule 9 (signed callbacks). Pre-release blocker stance recorded here.
  - **ADR-0901** — Incident data model (`public.incidents`, `public.incident_events` append-only, `public.incident_notifications`, `public.incident_affected_artefacts`) with org_id + RLS per Rules 13 & 14; immutable event log (Rule 2 append-only pattern); links incidents to affected `consent_artefacts` via the existing DEPA scope so "which artefacts are affected" is a join, not a manual tag.
  - **ADR-0902** — Detection inputs: manual report + Sentry-alert hook + security-scan finding promotion. No auto-classification v1 — human declares the severity; the workflow only structures and timestamps the declaration.
  - **ADR-0903** — Categorisation + assessment shell: DPDP §8(6) fields (nature, extent, affected principals count, categories of data, likely consequences), prefilled from linked artefact scopes; mandatory fields enforced before draft stage.
  - **ADR-0904** — Notification draft + approval workflow: DPB-shaped notice template (plain-language + statutory fields); approver role gate (account_owner or platform-operator-of-the-customer-proxy as escalation); versioned drafts with Rule-2-style immutable log.
  - **ADR-0905** — Dispatch to DPB + affected principals: Resend for mass-principal email; webhook to customer-owned regulator-liaison pipe (where Tanla / CPaaS partners land later — see competition §4.5 for the partnership hook); signed callback on delivery.
  - **ADR-0906** — Remediation tracker + post-incident review (PIR) shell: tracks preventive actions, links to deletion-connector actions if data-minimisation remediations apply, publishes PIR to the audit-export package.
  - **ADR-0907** — Audit-export extension: add `incidents`, `incident_events`, `incident_notifications` sections to the manifest — fixes the silent omission in today's export.
  - **ADR-0908** — (Covers Issue 9.) BFSI variant — parallel RBI 6-hour and SEBI 6-hour tracks alongside the DPDP 72-hour track. One incident, multiple notifications, each with its own timer and template. Details recorded under Issue 9 below.
- **Pre-release blocker stance:**
  - The claim appears in **every** pricing tier, so **no paying-customer onboarding** proceeds until at least **ADR-0900 → ADR-0905 ship**. ADR-0906 / 0907 can follow without blocking paid customers but must ship before any DPB inspection or external audit.
  - ADR-0908 (BFSI dual / triple timelines) is blocker-of-blockers for any **BFSI** customer onboarding (per Issue 9 decision).
- **No FIX-COPY today** — the claim stays live with the build commitment.

**Strategic context:**
- Competition briefing §8 shows no competitor publicly claims this workflow — shipping it is a genuine wedge, not a me-too.
- §9.3 lists triple breach notification as one of three defensible wedges; Issue 9 graduates that wedge from doc-only to code.
- §4.5 flags Tanla / CPaaS as latent-high threats with dispatch infrastructure — partnership is a post-launch optimisation for ADR-0905 dispatch, not a substitute for building the core workflow.

**Work tracked in:**
- ADR-0900 series (new, Breach / incident management) — drafted in `docs/ADRs/ADR-0900-incident-management-charter.md` and siblings.
- Issue 9 (BFSI dual / triple breach timelines) is ADR-0908 in this series.

---

## Issue 9 — Dual / triple breach notification (RBI 6h + DPDP 72h, or DPB+RBI+SEBI)

**Claim (live on marketing):**
- Product LAYER_4 — BFSI regulatory overlay: *"Dual breach notification timelines."* — `marketing/src/app/product/page.tsx:118`
- Solutions BFSI tab: *"Dual breach notification timelines. RBI's 6-hour notification track and DPDP's 72-hour track in one workflow. One incident, two correctly-timed notifications."* — `marketing/src/components/sections/solutions-tabs.tsx`
- Competition briefing §8 / §9.3 positions "Triple breach notification (DPB + RBI + SEBI)" as one of CS's three defensible wedges.

**Reality in code:** same as Issue 8 — no breach workflow exists, so the BFSI dual / triple variant cannot exist either. No RBI / SEBI regulator profiles, no per-regulator templates, no multi-timer model.

**Severity:** Hard contradiction for the BFSI persona. BFSI is the sectoral wedge the competition briefing most strongly recommends defending.

**Decision — BUILD; already in-scope as ADR-0908 within the `0900` series (Issue 8):**
- Confirmed scope for **ADR-0908**:
  - **Triple-timer** by default — DPB 72-hour + RBI 6-hour + SEBI 6-hour, running in parallel on a single incident. Not narrowed to dual. Matches the competition briefing's wedge positioning (§9.3) and the Solutions BFSI persona covering both NBFC and broking / wealth.
  - `public.regulator_profiles` — per-regulator notification window, preferred channel (email / portal upload / signed JSON webhook), statutory template fields, India-specific portal URL hooks.
  - `public.org_regulator_mappings` — per-org activation; one incident produces N parallel notifications, each with its own timer, template, approval state, and dispatch receipt.
  - Single incident → N parallel notifications — the UI must make the simultaneous timers visible at a glance (no hidden second timer waiting to expire).
- **Pre-subscription gate for BFSI customers:** no BFSI / NBFC / broking customer is onboarded on the basis of this claim until **ADR-0908 ships**. The base breach workflow (ADR-0900 → ADR-0905, from Issue 8) is still the universal pre-release blocker; ADR-0908 is the **additional** blocker for any customer activating RBI / SEBI regulator mappings.
- Marketing copy on BFSI tab **stays live** with the commitment; the broader claims rewrite commit that closes this review will **upgrade the wording to triple** (DPB + RBI + SEBI) — the competition briefing's full positioning — rather than the weaker "dual" the BFSI tab currently shows.

**Strategic context:**
- Competition briefing §8 confirms no public competitor claims this. Shipping it is a genuine wedge, not a me-too.
- §9.3 lists it as one of three defensible wedges; folding it into the universal `0900` series (rather than a separate BFSI-only series) means the same incident engine serves every sector, with regulator profiles as data, not forks — lower long-term maintenance and easier to extend to ABDM breach timelines later in the Healthcare bundle (ADR-0500 series).

**Work tracked in:**
- ADR-0908 (BFSI dual / triple breach timelines) inside the `0900` Breach / incident-management series.
- Copy upgrade from "dual" to "triple" lands in the marketing rewrite commit closing this review.

---

## Issue 10 — Sector templates "pre-populate Purpose Definitions, data inventory, privacy notice language" for six verticals

**Claim (live on marketing):**
- Solutions hero: *"Each sector template pre-populates Purpose Definitions, data inventory, privacy notice language, and the highest-risk data categories — so onboarding a new customer starts at 60% configured, not 0%."* — `marketing/src/app/solutions/page.tsx`
- Product LAYER_3 — Sector templates: *"Pre-configured kits for six verticals: SaaS, edtech, fintech/BFSI (NBFC + broking), e-commerce, healthcare."* — `marketing/src/app/product/page.tsx:90`
- Solutions tabs (`solutions-tabs.tsx`) render five tabs (SaaS, Edtech, D2C, Healthcare, BFSI) with per-sector stat + feature cards.

**Reality in code:**
- Only BFSI and Healthcare have any seed data, and only at the `regulatory_exemptions` layer: `supabase/migrations/20260804000005_regulatory_exemptions_bfsi_seed.sql`, `…_000006_healthcare_seed.sql`.
- No purpose-definition seed packs, no data-inventory templates, no privacy-notice scaffolding per vertical.
- SaaS / Edtech / D2C / E-commerce — zero seed data.
- `dashboard/inventory/`, `dashboard/notices/` are generic surfaces; `dashboard/purposes/` is user-authored.

**Severity:** Hard contradiction on both the "six verticals" count and the "60% configured" promise.

**Decision — BUILD under new ADR series `1100–11NN` (sector onboarding / seed packs):**
- New **Sector-onboarding ADR series starting at ADR-1100**. Range `1100–1199` reserved for sector seed packs, onboarding templates, and vertical-specific content layers — disjoint from Terminal A's active `1000–1029` sprint range (ADR-1003 / 1007 / 1008 / 1019) and from the BFSI / Healthcare capability work in `0500` and `0900`. This ADR series is the **onboarding-content** layer; it does not overlap the capability ADRs.
- The series covers:
  - **ADR-1100** — Sector-onboarding charter: seed-pack contract, idempotent loader, org-creation-time sector selection, upgrade / re-seed path (customer changes sector), audit-log entry per seed load. Explicit separation of the **content layer** (this series) from the **capability layer** (0500 / 0900 / BFSI regulatory-exemption engine).
  - **ADR-1101** — Seed-pack data model: `public.sector_seed_packs` (version-pinned bundles of purpose_definitions + inventory_rows + notice_language_blocks + risk_categories per sector, all org-id-null at rest, applied per org on activation). Version migration rules — seed updates cannot overwrite customer edits.
  - **ADR-1102** — Loader + org-creation wiring: signup / onboarding flow surfaces the sector picker (already exists on `(public)/onboarding/`); post-org-creation RPC copies the chosen seed pack into the new org's tables, stamps source_version, and logs the load.
  - **ADR-1103** — BFSI seed pack (NBFC + broking + wealth): ~15 purpose definitions (KYC, underwriting, credit-bureau check, collections, relationship-management, AA-initiated data fetch, marketing, WhatsApp opt-in, nominee / guarantor / co-borrower third-party, analytics, trading-history retention, bureau reporting, partner-insurance cross-sell, co-lending, SEBI-LODR reporting); inventory rows mapping each purpose to standard BFSI data fields; notice-language blocks referencing RBI / SEBI / IRDAI where applicable; linked to BFSI `regulatory_exemptions` seed so deletion / retention rules resolve correctly on day one.
  - **ADR-1104** — Healthcare seed pack (clinic + hospital): purpose definitions for clinical care, lab access, prescription, discharge summary, ABDM consent (bridge to Healthcare bundle — see ADR-0502), insurance claim, research participation, marketing; inventory rows for ABHA + clinical categories; notice-language blocks referencing DISHA / CEA / ABDM CM.
  - **ADR-1105** — SaaS / B2B seed pack: purpose definitions for product analytics, error monitoring, marketing, billing, support, security, compliance-reporting; inventory for standard SaaS SDK integrations (Segment, Amplitude, Sentry, Stripe, etc.); notice blocks for DPDP-default + optional GDPR-lite overlay (once ADR-0600 ships).
  - **ADR-1106** — Edtech seed pack: **children's-data provisions first-class** — separate parental-consent purpose as distinct artefact, no-behavioural-advertising invariant, DPDP-highest-multiplier categories. Additional purposes: course-progress, assessment, classroom-comms, marketing-to-guardian-only.
  - **ADR-1107** — D2C / E-commerce seed pack: purposes for checkout, order-fulfilment, marketing (incl. **WhatsApp opt-in as a first-class purpose** — pairs with Solutions D2C tab claim), abandoned-cart, loyalty, reviews, personalisation, analytics.
  - **ADR-1108** — "60% configured" measurement + honesty gate: define what "configured" means (purposes seeded / inventory seeded / notice draft rendered / trackers default-classified / retention rules resolved). Publish a per-sector configured-score calculation so the marketing claim is grounded in a repeatable metric. If the actual score is <60% on a fresh org, the claim is downgraded to the measured number in the same commit that loads the seed.
- **Pre-release gating per sector:**
  - BFSI tab live → **ADR-1103** must have shipped.
  - Healthcare tab live → **ADR-1104** must have shipped (and the Healthcare bundle per Issue 3 if the tab references ABDM-specific capability).
  - SaaS / Edtech / D2C tabs → respective ADR must have shipped **or** the tab is downgraded to a "Coming Q3 2026" card in the marketing rewrite commit.
- The "**six verticals**" claim (Product LAYER_3) is honoured when ADR-1103 → ADR-1107 have shipped (five sector packs + BFSI split into NBFC + broking counts as the sixth if broking gets its own pack; if not, the count is revised to "five verticals" in the copy rewrite).
- **No FIX-COPY today** on the Solutions tab body copy; the **Product LAYER_3 count** may still need an honest number (five vs six) in the rewrite commit depending on how ADR-1103 is scoped (single BFSI pack vs split NBFC + broking).

**Strategic context:**
- Competition briefing §9.3 identifies sectoral depth as the defensible wedge. Onboarding seed packs are the **visible surface** of that depth for every plan tier — not just Enterprise. Starter and Growth customers see the payoff on day one.
- Competition §4 (Tier 2) notes that Consentin (Leegality) + GoTrust lead on distribution; CS can't beat them on reach, but can lead on **first-day-onboarded-correctness**, which is what this series delivers.

**Work tracked in:**
- ADR-1100 series (new, Sector onboarding / seed packs) — drafted in `docs/ADRs/ADR-1100-sector-onboarding-charter.md` and siblings.
- Coordination note: the `1100–1199` range was verified disjoint from Terminal A's current range (`1003 / 1007 / 1008 / 1019`) and Terminal B's range (`1006 / 1014 / 1015`).

---

## Issue 11 — WhatsApp Business API unsubscribe cascade

**Claim (live on marketing):**
- Solutions D2C tab: *"WhatsApp opt-out as a first-class artefact. WhatsApp marketing is a separate purpose with its own artefact and expiry. Revocation cascades to WhatsApp Business API unsubscribe."* — `marketing/src/components/sections/solutions-tabs.tsx` (D2C panel)

**Reality in code:**
- No WhatsApp connector in `app/src/lib/connectors/oauth/registry.ts` — only `mailchimp` and `hubspot`.
- No BSP adapter (Gupshup / Interakt / Karix / Tanla / Kaleyra / Route Mobile) — and the India WhatsApp Business API is BSP-gated by Meta's policy, so there is no "direct to WhatsApp" path at all.
- The "first-class artefact" half is attainable — customers can author a `whatsapp_marketing` purpose on the purposes dashboard today, so revocation does revoke the artefact. The cascade-to-WhatsApp half does not exist.

**Severity:** Hard contradiction on the cascade; artefact-half is partially honest (fully honest once ADR-1107's D2C seed pack ships under Issue 10).

**Decision — BUILD under the existing `ADR-1007` (pre-built connectors) roadmap; new sprints:**
- WhatsApp BSP adapters are added to the existing **ADR-1007 pre-built connectors programme** rather than opening a new ADR series — they are a deletion / suppression connector exactly like Mailchimp / HubSpot / CleverTap, just BSP-gated. This keeps a single connector-catalogue surface for customers and one place to evolve the connector contract.
- New sprints **inside ADR-1007**:
  - **ADR-1007 Sprint 2.1** — Gupshup BSP unsubscribe connector (OAuth or API-key per Gupshup's contract; map `whatsapp_marketing` purpose revocation to the appropriate suppression / opt-out API; signed-receipt round-trip; integration test against Gupshup sandbox).
  - **ADR-1007 Sprint 2.2** — Interakt BSP unsubscribe connector (same shape).
  - **ADR-1007 Sprint 2.3** — Karix BSP unsubscribe connector.
  - **ADR-1007 Sprint 2.4** — Tanla BSP unsubscribe connector. Competition briefing §4.5 explicitly identifies Tanla as a partnership / channel candidate — this sprint's commercial conversation is the partnership hook.
  - **ADR-1007 Sprint 2.5** — Route Mobile BSP unsubscribe connector.
  - **ADR-1007 Sprint 2.6** — Kaleyra BSP unsubscribe connector.
  - (Gupshup is ordered first because it has the broadest Indian SMB WABA reach; the rest follow demand. Each new BSP is a separate sprint with its own partner-sandbox test.)
- **Cross-ADR dependency:** the `whatsapp_marketing` **purpose definition** itself lands with the **D2C seed pack (ADR-1107, Issue 10)** — the first-class artefact half. The connector cascade half lands with ADR-1007 Sprint 2.x. Both halves must ship before the D2C tab's sentence is literally true end-to-end.
- **Commercial prerequisite:** each BSP connector requires a partner MoU (or the customer's own BSP API credentials) because BSP API access is credentialled and rate-limited by the BSP, not by Meta directly. The ADR-1007 Sprint-2.x ADR entries must name the partner for each sprint before engineering starts.
- **Pre-launch gate on the claim:** the D2C tab sentence stays live as a forward commitment. External distribution of the D2C Solutions page to partner / press is held until **at least one BSP connector (ADR-1007 Sprint 2.1 — Gupshup)** plus the **D2C seed pack (ADR-1107)** have shipped. This gives the minimum honest-end-to-end — one customer on Gupshup gets the full cascade; others on other BSPs are on-roadmap with the partner named.
- **No FIX-COPY today** — the commitment stays public.

**Strategic context:**
- Competition briefing §4.5 flags Tanla as latent-high and explicitly recommends partnership. BSP connectors are CS's first-class entry into a partner-channel with Tanla / Karix / Kaleyra / Route Mobile / Gupshup.
- The cascade also counts toward Issue 1's Growth "3 connectors" minimum — a customer can qualify for Growth with Mailchimp + HubSpot + Gupshup — so ADR-1007 Sprint 2.1 is a Growth pre-release accelerator as a side effect.

**Work tracked in:**
- ADR-1007 Sprint 2.x (new sprints, per-BSP) — recorded in `docs/ADRs/ADR-1007-pre-built-connectors.md` when the ADR is opened / updated.
- ADR-1107 (D2C seed pack, from Issue 10) supplies the first-class `whatsapp_marketing` purpose that the cascade sprints target.

---

## Issue 12 — Per-property roles (CA firms / multi-brand)

**Claim (live on marketing):**
- Product LAYER_4 — Multi-property management: *"CA firms and multi-brand enterprises manage consent posture across all client or brand web properties from a single dashboard, **with roles scoped per property**."* — `marketing/src/app/product/page.tsx` (LAYER_4 features block).
- Enterprise narrative reinforces the same in Solutions / Pricing via "built for CA firms managing multiple clients".

**Reality in code:**
- RBAC (ADR-0044 / ADR-0047) scopes roles at **account** and **organisation** levels only. `account_memberships` and `org_memberships` are the role tables.
- `web_properties` rows have no role-scoping table — every member of the org sees every property of that org with the same role.
- Five roles exist (account_owner, account_viewer, org_admin, admin, viewer); none are per-property.
- CA-firm multi-client is partially served by the account → organisations hierarchy; per-property scoping within an org is not implemented.

**Severity:** Hard contradiction for the CA-firm and multi-brand-enterprise personas.

**Decision — BUILD as `ADR-0808` inside the `0800` Enterprise-platform series:**
- Slotted as **ADR-0808 — Per-property role scoping** inside the Enterprise-platform series (from Issue 7). This keeps all Enterprise-tier commitments (custom-domain, white-label, SSO, customer-KMS, per-property roles) under one coherent series with one charter.
- Scope for ADR-0808:
  - **Pattern:** property-tag extension on `org_memberships` (pattern 2 from the review) — `org_memberships.property_scope text[] nullable` where `null` means "all properties in this org" (today's behaviour) and a non-null array restricts visibility / actions to those property IDs. Preserves backwards-compat with every existing membership; lets the account_owner / org_admin scope new invites per-property from day one.
  - RLS policies on every property-owned table (`banners`, `consent_events`, `rights_requests`, `deletion_receipts`, `tracker_observations`, `security_scans`, `consent_probe_runs`, `purpose_connector_mappings` where property-scoped, `audit_log` views per property, etc.) extend the existing `current_org_id()` predicate with `(property_scope is null or property_id = any(property_scope))`. Rule 14 (org_id on every table) is unchanged; this is a **second** predicate, not a replacement.
  - Dashboard: org-admin / account-owner can set `property_scope` on any org_membership from the members panel. The members panel already exists (`app/src/app/(dashboard)/dashboard/settings/members/`); ADR-0808 extends it.
  - Admin-proxy: no change — admin identities are outside customer RBAC (Rule 12, identity isolation).
  - RLS tests: extend `tests/rls/` with a per-property isolation matrix — member with `property_scope=[p1]` must not see `p2` rows across all eight+ property-owned tables. This matches the non-negotiable "RLS isolation test before application code" clause in CLAUDE.md.
- **Left for later (v2 / ADR-0809 if needed):** a dedicated `property_memberships` table (pattern 1). Only pursued if property-tag-on-membership runs out of expressive capacity (e.g. different roles per property for the same user — account auditor on prop A, viewer on prop B). No evidence that's needed today.
- **Pre-subscription gate:** Enterprise customers whose pitch includes per-property role scoping (CA firms, multi-brand enterprises) are not onboarded on that claim until **ADR-0808 ships**. Until then, the existing account → organisations hierarchy is the honest tenancy story and the enterprise-segment memory (division-as-legal-entity) is covered by it.
- **Marketing copy** stays live as a forward commitment under the Enterprise-platform series umbrella.

**Strategic context:**
- Memory `project_rbac_design_2026-04-18.md` records RBAC v2 as a deliberate four-level hierarchy with roles only at account + org. ADR-0808 is the additive extension that closes the gap for CA-firm and multi-brand-enterprise personas without abandoning the bounded v2 model.
- Memory `project_customer_segment_enterprise.md` — large corporates with divisions-as-legal-entities are primarily served by the existing org-per-legal-entity model; per-property roles are most critical for CA firms and single-legal-entity multi-brand operators. ADR-0808 serves the latter two without perturbing the former.

**Work tracked in:**
- ADR-0808 (Per-property role scoping) inside the `0800` Enterprise-platform series — drafted alongside ADR-0800 when the series is opened.
- RLS test matrix extension — lands with ADR-0808.

---

## Issue 13 — Withdrawal verification ("automated scans to confirm the right trackers stopped firing")

**Claim (live on marketing):**
- Story card 02: *"… revokes the artefact, orchestrates deletion across connected systems, and **verifies enforcement with a re-scan**."* — `marketing/src/components/sections/story.tsx`
- Product LAYER_2 — Withdrawal verification: *"On withdrawal, ConsentShield revokes the artefact, removes it from the validity cache, and **schedules automated scans to confirm the right trackers stopped firing**."* — `marketing/src/app/product/page.tsx:51-53`
- Solutions D2C tab: *"After withdrawal, ConsentShield re-scans your site to confirm the relevant marketing trackers actually stopped firing."* — `marketing/src/components/sections/solutions-tabs.tsx`
- Pricing table — "Withdrawal verification" as a Growth+ feature.

**Reality in code:**
- `withdrawal_verifications` is only a buffer-table declaration (Rule 1 in CLAUDE.md). No writer, no consumer, no `verify-withdrawal` Edge Function.
- No revocation-triggered scheduler; no pg_cron sweep of recently-revoked artefacts for verification.
- The Worker does evict revoked artefacts from the validity cache — the prevention half is real; the verification-by-rescan half is not.
- `run-consent-probes` is static HTML analysis v1 (see its header) — cannot observe runtime tracker firing. The correct primitive is either real-user `tracker_observations` correlation or a headless-browser probe.

**Severity:** Hard contradiction on the verification half, across four marketing surfaces including the home-page positioning.

**Decision — BUILD under new `ADR-1200` (Withdrawal verification), two-phase:**
- New **ADR-1200 — Withdrawal verification**. Single ADR, two phases. Range note: `1200–1299` reserved for enforcement-observability work adjacent to the existing Worker / probe stack; disjoint from Terminal A's active `1003 / 1007 / 1008 / 1019` range and from Terminal B's `1006 / 1014 / 1015` range.
- **Phase 1 — Real-user correlation (cheap, fast, ships first):**
  - **Sprint 1.1** — AFTER INSERT trigger on `artefact_revocations` opens a `withdrawal_verifications` row with `status='observing'`, capturing revoked artefact ID, expected-silent tracker slugs (derived from the artefact's purpose → tracker-signature category mapping), and an `observation_window` (default 72 h; configurable per org). Uses existing `tracker_observations` stream — no new runtime component.
  - **Sprint 1.2** — Materialised view + sweep RPC that flags any `tracker_observations` row matching a silent tracker slug + the revoked artefact's session fingerprint / property during the observation window → writes a `verification_finding` with severity `violation_after_revocation`. Runs hourly via pg_cron; also queryable on demand.
  - **Sprint 1.3** — Dashboard surface under `dashboard/enforcement/` (or the Rights panel) showing per-revocation verification status: `observing` / `verified_silent` / `violation_detected`. Violation drill-down links to the offending `tracker_observations` rows.
  - **Sprint 1.4** — Audit-export extension: `withdrawal_verifications` + `verification_findings` sections added to the manifest (same pattern as Issue 8's ADR-0907 for incidents). Ensures the withdrawal-verification claim lands in the DPB-facing evidence pack.
  - **Sprint 1.5** — RLS tests + integration tests on the "Mrs Sharma" path: revoke → subsequent tracker firing (simulated via Worker fixture) → verification row transitions from `observing` → `violation_detected`. Negative case: no firing → `verified_silent`.
  - This phase is honest for the overwhelmingly common case — the customer has real traffic on the property; once revocation lands, the Worker's existing `tracker_observations` stream is sufficient evidence.
- **Phase 2 — Headless-browser probe (graduates the deferred V2 browser probe work):**
  - **Sprint 2.1** — Lifts the "browser-based probe v2" item from `docs/V2-BACKLOG.md` into this ADR. Uses the existing `@vercel/sandbox` stack (per reference memory `reference_vercel_sandbox.md`) — no new runtime; probe script runs inside a sandbox, loads the site with the revoked consent state, asserts expected trackers don't fire, writes a probe run.
  - **Sprint 2.2** — Scheduler integration: AFTER INSERT on `artefact_revocations` can *additionally* enqueue a sandbox probe (not a substitute for Phase 1's correlation — a belt-and-braces second check). Useful when the site has low real-user traffic on the revoked user's configuration and correlation alone gives inconclusive evidence.
  - **Sprint 2.3** — Dashboard surface — probe verdict visible alongside correlation verdict; combined status resolved (`verified_silent` wins only if both agree).
  - **Sprint 2.4** — Cost controls — probe runs are per-revocation, gated by plan tier (Growth+ gets Phase-1 correlation; Pro+ gets Phase-2 sandbox probes as well). `consent_probe_runs` buffer reused per Rule 1.
- **Interaction with Issue 14 (consent-probe v1 overclaim):** Phase 2 here overlaps — the headless-browser primitive it builds is what Issue 14's claim *already describes*. Issue 14 closes by redirecting its claim language to the ADR-1200 Phase-2 artifact rather than claiming v1's static HTML does it.
- **Pre-release gate:** external distribution of Story / Product / Solutions / Pricing copy carrying the withdrawal-verification claim holds until **ADR-1200 Phase 1 Sprints 1.1 → 1.4** ship. Phase 2 can follow without blocking release.
- **No FIX-COPY today** — the claim stays live; it's the central home-page positioning per the competition briefing contrast.

**Strategic context:**
- Competition briefing §8 shows tracker / cookie enforcement is claimed by every Tier 1 competitor. The **verification** half is where CS differentiates — not the banner. This build makes the differentiation real.
- Phase 1 piggybacks on the existing `tracker_observations` stream — already shipped and proven; Phase 1 is additive, not infrastructural.
- Phase 2 graduates a V2-backlog item under a named ADR — matches the documented `feedback_v2_backlog_pattern` convention ("deferred items go into docs/V2-BACKLOG.md; reviewed only after phase closes; user picks 2–3 to graduate").

**Work tracked in:**
- ADR-1200 (Withdrawal verification) — drafted in `docs/ADRs/ADR-1200-withdrawal-verification.md`.
- V2-backlog entry for browser probes is graduated into ADR-1200 Phase 2 per the `feedback_v2_backlog_pattern` memory.

---

## Issue 14 — Consent probe testing ("simulates users with specific consent states and verifies trackers behave correctly")

**Claim (live on marketing):**
- Product LAYER_3 — Consent probe testing: *"Automated synthetic compliance testing. ConsentShield **simulates users with specific consent states** and verifies trackers behave correctly for the artefact state they govern."* — `marketing/src/app/product/page.tsx:73-75`
- Pricing Pro tier — "Consent probe testing" (`marketing/src/components/sections/pricing-preview.tsx:67`, `price-table.tsx`).

**Reality in code:**
- `supabase/functions/run-consent-probes/index.ts` header: *"Static HTML analysis v1: fetches each probe target, extracts script / img / iframe / link URLs, matches against tracker_signatures, flags violations against the probe's declared consent_state."*
- Static HTML analysis cannot simulate a user — no JS execution, no session, no cookies, no rendering.
- The v2 browser-probe work is recorded on `docs/V2-BACKLOG.md` and was not yet graduated.

**Severity:** Hard contradiction — claim describes a category of tool (synthetic user + runtime observation) that v1 is architecturally incapable of.

**Decision — BUILD; already covered by `ADR-1200 Phase 2` (from Issue 13):**
- No new ADR. The Phase-2 sandbox-based headless-browser probe under **ADR-1200** is exactly the "simulate users with specific consent states and verify trackers behave correctly" primitive this claim describes.
- **Pre-release gate:** the Pro-tier "Consent probe testing" line and Product LAYER_3 "simulates users" wording **do not ship externally** until **ADR-1200 Phase 2 Sprints 2.1 → 2.3** complete (sandbox probe + scheduler + dashboard surface). Until then, the claim is not exposed in paid-customer distribution. For existing paid Pro customers who read the line today, the commitment carries forward as a roadmap item under ADR-1200.
- **Interim copy posture (inside the broader marketing-claims rewrite that closes this review):** the "Consent probe testing" line is **retained in place** with the ADR-1200 Phase 2 forward commitment and a dated Q3/Q4 2026 pill equivalent to the treatment used on Issue 6. It is NOT silently downgraded to "static HTML analysis" because the commitment is to build the full primitive — Phase 2 delivers what the line promises; Phase 1 of ADR-1200 already delivers adjacent real-user-correlation evidence.
- **No FIX-COPY today** — the claim stays live with the Phase-2 forward commitment; rewrite commit attaches the Q3/Q4 pill.

**Strategic context:**
- Competition briefing §8 rates "Consent probe testing" as a probable-but-unverified capability across competitors. Once ADR-1200 Phase 2 ships, CS has the runtime-verified claim that no competitor has publicly demonstrated — graduates from parity to lead.
- The v1 static HTML analyser **stays in place** as a cheaper, faster first-pass signal; Phase 2 adds runtime verification rather than replacing v1. Both probe types write into the existing `consent_probe_runs` buffer per Rule 1.

**Work tracked in:**
- ADR-1200 Phase 2 (from Issue 13) — covers the full "simulate users with specific consent states" primitive. Pre-release gate keyed to Phase-2 completion.

---

## Issue 15 — "14-day free trial on Starter, Growth, and Pro"

**Claim (live on marketing):**
- Pricing CTA: *"14-day free trial on Starter, Growth, and Pro."* — `marketing/src/app/pricing/page.tsx:66`
- Implied throughout marketing and signup flow.

**Reality in code:**
- Signup RPC creates `plan_code='trial_starter'` with `trial_ends_at = now() + interval '30 days'` — `supabase/migrations/20260429000001_rbac_memberships.sql:283`.
- `app/src/app/api/internal/invites/route.ts` exposes a `trial_days` override (positive integer), defaulting to 30.
- Onboarding-invitation expiry copy separately mentions 14-day invitation validity in `app/src/app/(public)/onboarding/page.tsx:132` — distinct from trial duration but risks reader confusion.

**Severity:** Straight data drift; 30 days is what code grants.

**Decision — FIX-COPY:**
- Change marketing pricing CTA from *"14-day free trial on Starter, Growth, and Pro."* to *"30-day free trial on Starter, Growth, and Pro."* — single-line edit at `marketing/src/app/pricing/page.tsx:66`.
- Sweep the rest of `marketing/src/` for any other "14-day" / "14 day" / "14 days" trial references and rewrite to 30 in the same commit. (Explicitly preserve the "14 days" invitation-link-validity copy in `app/src/app/(public)/onboarding/page.tsx:132` — it refers to invitation validity, not trial duration; leaving it unchanged keeps the two concepts distinct.)
- No code change. The 30-day default in the RPC is kinder to the customer and is the right default to keep.
- Lands in the broader marketing-claims rewrite commit that closes this review.

**Strategic context:** 30 > 14 for conversion, for fairness, and for not forcing customers to make a paid decision before they have populated their own purpose registry and onboarding seed pack. No reason to shorten.

**Work tracked in:**
- Marketing rewrite commit closing this review (single-line copy edit).

---

## Issue 16 — "All 15 endpoints" / "15 /v1/* endpoints"

**Claim (live on marketing):**
- Docs hub card: *"All 15 endpoints — authentication, request/response schemas, errors, and an inline playground."* — `marketing/src/app/docs/page.tsx:63`
- Docs hub at-a-glance: *"15 REST endpoints across health · consent · deletion · account."* — `marketing/src/app/docs/page.tsx:94`
- Docs status page: *"All 15 /v1/* endpoints probed every 30 seconds from three geographic regions."* — `marketing/src/app/docs/status/page.mdx`

**Reality in code:**
- Actual route count under `app/src/app/api/v1/` at `ae48a96` = **21** `route.ts` files (`_ping`, `plans`, `usage`, `score`, `purposes`, `audit`, `properties`, `consent/artefacts`, `consent/record`, `consent/verify`, `consent/events`, `keys/self`, `deletion/receipts`, `deletion/trigger`, `deletion-receipts/[id]`, `security/scans`, `rights/requests`, `consent/artefacts/[id]`, `consent/verify/batch`, `integrations/[connector_id]/test_delete`, `consent/artefacts/[id]/revoke`).
- Marketing undercounts by 6 and will keep drifting as ADR-0023 / ADR-0908 / ADR-1200 / others ship.

**Severity:** Numeric drift that undersells the product. Easy fix; important for developer-docs integrity.

**Decision — FIX-COPY (dynamic / grouped — no hard count):**
- Rewrite all three sites to avoid a hard integer, so future drift cannot reintroduce the same issue:
  - **`marketing/src/app/docs/page.tsx:63`** — change *"All 15 endpoints — authentication, request/response schemas, errors, and an inline playground."* to *"The full `/v1/*` reference — authentication, request/response schemas, errors, and an inline playground."*
  - **`marketing/src/app/docs/page.tsx:94`** — change *"15 REST endpoints across `health` · `consent` · `deletion` · `account`."* to *"REST endpoints across `health` · `consent` · `deletion` · `rights` · `security` · `account`."* (also widens the grouping list to match the shipped surface — today's copy omits `rights` and `security`, which are live).
  - **`marketing/src/app/docs/status/page.mdx`** — change *"All 15 /v1/* endpoints probed every 30 seconds from three geographic regions."* to *"Every `/v1/*` endpoint probed every 30 seconds from three geographic regions."* (The "three geographic regions" sub-claim is addressed separately under Issue 18 — status-page reality; this edit only fixes the count.)
- No build-tooling change (i.e. not attempting to compute the count dynamically at build time — overkill for developer-docs copy; the grouped wording is robust enough).
- Lands in the broader marketing-claims rewrite commit that closes this review.

**Strategic context:** developer-docs integrity matters more than marketing polish. Under-counting signals sloppiness to the exact buyer who's evaluating the API surface. Removing the integer removes the drift class entirely.

**Work tracked in:**
- Marketing rewrite commit closing this review (three-site copy edit).
- Issue 18 (status-page reality) handles the `three geographic regions` portion separately.

---

## Issue 17 — `testing.consentshield.in` referenced but not resolving

**Claim (live on marketing):**
- Docs test-verification page (Terminal B Sprint 5.3, commit `ae48a96`): *"Compare against the reference run at **testing.consentshield.in**."* — `marketing/src/app/docs/test-verification/page.mdx`
- `testing/` Bun workspace code-complete (22 files under `testing/`).

**Reality at review time (07:02 IST):** DNS for `testing.consentshield.in` did not resolve. Operator step from Terminal B Sprint 5.3 handoff was pending.

**Severity:** Hard contradiction; any external link to `testing.consentshield.in` was broken.

**Decision — DONE (operator action executed by Sudhindra during review):**
- Testing subdomain created + attached to the Vercel project for the `testing/` workspace.
- Verified at review time: `host testing.consentshield.in` now resolves to `e2c0acb21fc7376e.vercel-dns-017.com` — the same Vercel IP pool that serves `app.consentshield.in`, `admin.consentshield.in`, and `status.consentshield.in`.
- All Terminal-B marketing links pointing at `testing.consentshield.in` (including the Sprint 5.3 "Reproduce our tests" doc + the Sprint 5.4 controls page + the RSS feed declared in `testing/src/app/feed.xml/route.ts`) now resolve.
- No FIX-COPY, no BUILD, no REMOVE required — the claim becomes literally true the moment DNS propagates.

**Ownership note:** `testing/`, `marketing/src/app/docs/test-verification/*`, and the Vercel attachment are Terminal B territory. Per the Terminal-C ground rules at session start, Terminal C did not execute the attachment; Sudhindra ran the operator step directly during the review. No Terminal B file was edited from Terminal C.

**Post-attach follow-ups to note for Terminal B's next session (not executed here):**
- Confirm the `testing/` Vercel project's production deployment is pointed at `main` so the seeded reference run (Sprint 5.4 controls dry-run, sealRoot `708d3df842469684`) is served from the new domain.
- Confirm the RSS `alternates.types` metadata on `testing/src/app/layout.tsx` points at `https://testing.consentshield.in/feed.xml` rather than a localhost / preview URL.
- Confirm the SVG-based wordmark / branding renders correctly on the live domain; no CSP surprises from the `testing/src/app/globals.css` palette.

**Work tracked in:**
- None — operator step done inline.

---

## Issue 18 — `status.consentshield.in` "real-time platform health, uptime metrics, and incident history"

**Claim (live on marketing):**
- Docs hub: *"follow status on status.consentshield.in"* — `marketing/src/app/docs/page.tsx:143-151`
- Docs status page: *"Live platform health lives at **status.consentshield.in**. It's hosted outside our primary infrastructure so the page stays reachable when the API itself is degraded."* — `marketing/src/app/docs/status/page.mdx`
- Status page enumerates **seven** monitored surfaces (v1 REST API, Worker event ingestion, Rights-request portal, Dashboard, Admin console, Deletion-connector dispatch, Notification dispatch), per-surface uptime targets (REST API 99.9%/mo, Worker ingestion 99.99%/mo, etc.), and *"probed every 30 seconds from three geographic regions"*.

**Reality:**
- DNS resolves to a Vercel placeholder; no status-monitoring infra exists in the repo (no `status/` workspace, no probe code, no incident store, no uptime calculator).
- "Hosted outside our primary infrastructure" is true only trivially (a different Vercel project), not substantively (an independent provider).

**Severity:** Hard contradiction on the **trust surface** — customers visit the status page precisely when they distrust the platform. A placeholder there is worse than no page.

**Decision — BUILD via Better Stack (external SaaS integration, no in-house status workspace):**
- **Better Stack** (formerly Better Uptime + Better Logs / Logtail) is the chosen provider. Days of work, not weeks; satisfies every specific commitment in the existing status-page copy without committing the team to operate a status-monitoring stack.
- New ADR for the integration — slotted as **`ADR-1300` — Status & uptime via Better Stack** in a new range to keep status / observability / incident-comms work together going forward (range `1300–1399` reserved for this domain). Range verified disjoint from Terminal A (`1003 / 1007 / 1008 / 1019`), Terminal B (`1006 / 1014 / 1015`), and the new ranges opened earlier in this review (`0500 / 0600 / 0700 / 0800 / 0900 / 1100 / 1200`).
- The series:
  - **ADR-1300** — charter: scope, monitor list, secrets handling, incident-template policy, status-page branding, subscriber-notification configuration, replacement gate (when CS would migrate off Better Stack — never planned, but the ADR records the migration shape so it isn't a one-way door).
  - **ADR-1301** — Better Stack monitor matrix configured to mirror the seven surfaces in the existing copy:
    1. **v1 REST API** — synthetic check on each `/v1/*` group (one keep-alive per group; Better Stack handles multi-region from EU + US + APAC at minimum); 30-second cadence; latency thresholds per group.
    2. **Worker event ingestion** — synthetic POST to `/v1/events` and `/v1/observations` from the Cloudflare-edge probe locations; HMAC + origin verified end-to-end so a green check actually proves the ingest path.
    3. **Rights-request portal** — synthetic GET on the public `/rights` page + Turnstile presence; OTP synthetic delivery covered separately under (7) so this monitor stays read-only.
    4. **Dashboard** — auth'd synthetic login probe (test account, MFA-aware) + DEPA-panel render check + billing-page read; per-minute cadence.
    5. **Admin console** — internal probe (Better Stack heartbeat from inside the admin proxy); surfaces a binary up/down only — no detail leaks.
    6. **Deletion-connector dispatch** — queue-depth + dispatch-latency heartbeat from the existing `process-artefact-revocation` Edge Function; piped to Better Stack via heartbeat URL on each successful sweep.
    7. **Notification dispatch** — Resend delivery health + custom-webhook adapter health; subscriber email-delivery success rate per org.
  - **ADR-1302** — incident-comms policy: incident severity matrix (S0–S3), template library, post-mortem publishing rule (S0/S1 published within 14 days), SLA-credit calculation surface for Enterprise customers (links to ADR-0806 from Issue 7's Enterprise series).
  - **ADR-1303** — secrets + DNS cutover: Better Stack API tokens stored via existing `vercel env` (per `reference_vercel_setup` memory); `status.consentshield.in` DNS flipped from the Vercel placeholder to the Better Stack hosted status page (CNAME / ALIAS to the Better Stack endpoint); the existing Vercel project gets archived once the cutover verifies clean.
  - **ADR-1304** — uptime-target surface alignment: the per-surface SLA targets currently rendered in `marketing/src/app/docs/status/page.mdx` (`REST API 99.9%/mo`, `Worker ingestion 99.99%/mo`, etc.) are honoured by Better Stack monitors and surfaced on the public status page as the actual measured number; if Better Stack reports below the claimed target for any month, the docs surface auto-degrades the headline number rather than showing a stale aspirational figure. Acceptance criterion: no claim on the status page exceeds the live measured value at any time.
  - **ADR-1305** — Status page subscriber notifications: customers can subscribe (email + RSS + webhook); incident updates publish via Better Stack; Resend handles transactional fan-out where Better Stack's native sender is insufficient for India-bound mail.
- **Pre-launch gate:** the marketing claim that points at `status.consentshield.in` stays live; the **Better Stack page must be the live target before external distribution of the docs hub or status page** (i.e., before any partner / press follow the link). DNS cutover (ADR-1303) is the pre-release blocker; ADR-1304 / 1305 can follow without blocking.
- **No FIX-COPY today** — the marketing copy is left as-is; ADR-1300 makes it literally true.
- **Cost note:** Better Stack pricing is per-monitor / per-incident-channel; comfortably inside the operating-cost band for a pre-launch SaaS. ADR-1300 charter records the chosen plan and budget.

**Strategic context:**
- Every Tier 1 / Tier 2 competitor in the briefing §8 uses an external status-page SaaS (Statuspage / Better Stack / Instatus). Going in-house is not a wedge and is operating-cost overhead with no upside.
- The existing copy ("hosted outside our primary infrastructure so the page stays reachable when the API itself is degraded") is **already** the SaaS-provider framing — wiring Better Stack closes the gap between the framing and the substance, doesn't change the framing.
- The Issue-16 fix removes the "three geographic regions" + "every 30 seconds" specificity from the docs hub; the **status page itself** retains those specifics because Better Stack honours them.

**Work tracked in:**
- ADR-1300 series (new, Status & uptime via Better Stack) — drafted in `docs/ADRs/ADR-1300-status-and-uptime-better-stack.md` and siblings.
- DNS cutover for `status.consentshield.in` — captured under ADR-1303; pre-release blocker on external distribution.
- Reference memory entry will be added when the integration completes (Better Stack workspace ID, monitor list, status-page URL).

---

## Issue 19 — "DPB-formatted evidence package"

**Claim (live on marketing):**
- Story card 03: *"One-click DPB-formatted evidence package. The full artefact register, consent logs, tracker observations, violation history, and deletion receipts — written to **your** storage, not ours."* — `marketing/src/components/sections/story.tsx`
- Product LAYER_2 — Audit export package: *"One-click DPB-formatted evidence: artefact register, consent logs, tracker observations, violation history, rights request history, breach notifications, data inventory."* — `marketing/src/app/product/page.tsx`
- Docs cookbook: `marketing/src/app/docs/cookbook/build-dpb-audit-export/page.mdx`.

**Reality in code:**
- `app/src/app/api/orgs/[orgId]/audit-export/route.ts` emits a JSON ZIP with: `org`, `data_inventory`, `banners`, `properties`, `consent_events_summary`, `rights_requests`, `deletion_receipts`, `security_scans_rollup`, `probe_runs`, plus the DEPA section.
- **Missing from manifest** vs the marketing claim:
  - `tracker_observations` (claimed, omitted).
  - `violation_history` (claimed, omitted).
  - `breach_notifications` (claimed; the breach module itself doesn't exist — Issue 8).
- "DPB-formatted" — the DPB has not published a normative export format. The shape is CS-defined JSON, not regulator-prescribed.
- "Written to **your** storage, not ours" — honest only for BYOS-mode customers (ADR-1003 Phase 2); default-storage customers receive a signed-URL download from CS-default R2.

**Severity:** Mixed — two real manifest omissions, one upstream-blocked omission (closes with Issue 8), and one terminology overclaim.

**Decision — FIX-COPY (terminology) + BUILD (manifest extensions); manifest work folded into existing `ADR-0907`, no new range:**

**FIX-COPY (lands in the review-closing commit):**
- Replace **"DPB-formatted"** with **"DPB-ready"** everywhere it appears across `marketing/src/components/sections/story.tsx`, `marketing/src/app/product/page.tsx`, and `marketing/src/app/docs/cookbook/build-dpb-audit-export/page.mdx`.
- Add a one-line clarification near the top of the cookbook page: *"The Data Protection Board has not yet published a normative export format. The package shape below is ConsentShield's interpretation of likely DPB demand under DPDP §6(4) and §8(6); it will track any official DPB specification once published."* This keeps the page useful as a reference today and honest about the regulator's position.
- "Written to **your** storage, not ours" copy is left as-is; it is literally true for BYOS-mode customers (the audience the line is selling to). A docs footnote on the audit-export cookbook page may add: *"Default-storage customers download the package via a signed URL from ConsentShield's R2; BYOS-mode customers receive the package written directly to their own R2 / S3 bucket."* Single-line addition only — no claim downgrade.

**BUILD (manifest extensions — folded into existing `ADR-0907`):**
- Folded into the **`ADR-0907` Audit-export extension** scope already opened under Issue 8. No new ADR range opened. Keeps the manifest changes atomic — one ADR ships every section the marketing copy claims, in one go.
- ADR-0907 expanded scope (in addition to the breach extensions from Issue 8):
  - **`tracker_observations_summary`** — rolled-up section per property × tracker × consent-state across the export window. Raw `tracker_observations` rows are NOT exported (Rule 1, buffer-table semantics). Summary fields: tracker slug, category, count, first-seen, last-seen, distinct sessions, percentage covered by an active artefact for the matching purpose, percentage observed *after* a revocation (linked to ADR-1200's withdrawal-verification findings from Issue 13).
  - **`violation_history`** — denormalised view across `verification_findings` (ADR-1200 Sprint 1.2 from Issue 13), `tracker_observations_summary` rows where `coverage_pct < 100`, and `incident_events` of the appropriate severity (ADR-0901 from Issue 8). One canonical violation timeline per org, sortable, with deep-links into the originating row.
  - **`breach_notifications`** — already in ADR-0907's Issue-8 scope; reaffirmed here.
  - Acceptance criterion: every section the marketing copy claims (`artefact register`, `consent logs`, `tracker observations`, `violation history`, `rights request history`, `deletion receipts`, `breach notifications`, `data inventory`) is present in the manifest after ADR-0907 ships. The set is closed.
- **Pre-release gate:** the broader pre-release blocker on Issue 8's `0900` series already covers ADR-0907; no separate gate needed. External distribution of the Story 03 / Product LAYER_2 / cookbook claims about completeness holds until ADR-0907 ships.

**Strategic context:**
- The audit-export package is the most-quoted DPDP §6(4) evidence path — DPB demand-with-48h-notice is the scenario every customer rehearses. Getting it complete and honestly labelled is foundational for the "Prove" narrative.
- Folding manifest extensions into ADR-0907 (rather than opening a new ADR-1400 range) keeps related export work atomic and avoids range proliferation. The competition briefing's framing of "audit trail = chain of custody from consent grant to deletion receipt" lands cleanly when one ADR ships every section in one commit.

**Work tracked in:**
- ADR-0907 (Audit-export extension) inside the `0900` series — scope expanded by this issue to include `tracker_observations_summary` + `violation_history` alongside the breach extensions already committed under Issue 8.
- Marketing rewrite commit closing this review (FIX-COPY: "DPB-formatted" → "DPB-ready" + cookbook clarification + default-storage footnote).

---

## Issue 20 — "The only India-native compliance platform with DEPA baked into the data model"

**Claim (live on marketing):**
- DEPA page metadata + h1: *"The only India-native compliance platform with DEPA baked into the data model."* — `marketing/src/app/depa/page.tsx:9` and `marketing/src/components/sections/depa-hero.tsx`.
- DEPA-moat section (home page): *"Built on DEPA — not retrofitted from GDPR."* — `marketing/src/components/sections/depa-moat.tsx`.
- Home-page hero pill: *"DEPA-native · Built in India · Confidential preview."* — `marketing/src/components/sections/home-hero.tsx`.

**Reality (per CS's own competitive briefing):**
- `docs/competition/ConsentShield-Competitive-Landscape-Briefing-v1.md` §9.1 marks this claim as no longer defensible and must be revised before any external distribution.
- §3.7 — *"'DEPA-native' and 'India-native' positioning claims are now table stakes, not differentiators."*
- §10 recommendation #1 — pause external distribution.
- DEPA architecture is real at CS (ADR-0021 / ADR-0022, schema is artefact-first); the issue is **uniqueness**, not authenticity.

**Severity:** Self-flagged. Reputational risk with sophisticated buyers who can name MeitY Top 6 and dismiss CS on a 30-second comparison.

**Decision — FIX-COPY with a defensible replacement that makes verifiable claims (no "no competitor does X" wording):**

The user-direction here is to **replace the unverifiable-negative ("that no general-purpose competitor publicly claims") with something defensible**. The defensible move is to drop competitor comparisons in this surface entirely and state what CS demonstrably ships, with feature names and statute citations a reader can audit in the repo today. The competitive comparison stays in the briefing where it belongs; the marketing surface stops making competitive negatives.

**Replacement copy (lands in the review-closing commit):**

For the **DEPA-page h1** and **DEPA-page metadata description**:

> *"Built DEPA-native to MeitY BRD standards, with two sector-specific operational extensions: the **BFSI Regulatory Exemption Engine** — a queryable mapping of DPDP erasure rights against RBI KYC, PMLA, SEBI LODR, CICRA, and IRDAI retention statutes, resolved per artefact at deletion time — and the **ABDM unified artefact model** for healthcare. Architecture and ADR record published in our public repo."*

For the **DEPA-moat lede** (home page) — replace the "every India-focused competitor uses a GDPR-adapted model" sentence with:

> *"DEPA — Data Empowerment and Protection Architecture — is the iSPIRT-designed consent infrastructure that underpins India Stack and the model the MeitY BRD now requires. ConsentShield's schema was designed artefact-first before the first customer row was written: one artefact per purpose, time-bounded, independently revocable, machine-readable, with chain-of-custody from grant to deletion receipt in a single query."*

For the **home-page hero pill** — keep *"DEPA-native · Built in India · Confidential preview"* unchanged. It's positioning, not an exclusivity claim.

For the **home-page meta description** (`marketing/src/app/page.tsx:14-16`) — replace with:

> *"ConsentShield is built DEPA-native to MeitY BRD standards. Collect consent as artefacts, enforce it in real time, prove it with an audit trail the DPB can read."*

Why these are defensible:
- **"BFSI Regulatory Exemption Engine"** — shipped today, verifiable: `supabase/migrations/20260804000004_regulatory_exemptions.sql`, `…000005_..._bfsi_seed.sql`, and the route at `app/src/app/api/orgs/[orgId]/regulatory-exemptions/route.ts`. Integrates with revocation cascade per ADR-1004 Sprint 1.4 (process-artefact-revocation reads `applicable_exemptions` before creating receipts).
- **Statute citations (RBI KYC, PMLA, SEBI LODR, CICRA, IRDAI)** — present in the BFSI seed migration. A reader can grep the repo and confirm the mapping exists.
- **"ABDM unified artefact model"** — committed under the ADR-0500 healthcare series (Issue 3) with explicit roadmap and ADR numbers; not yet shipped, but anchored to a public ADR rather than a marketing slogan. Acceptable to claim in copy because the implementation is committed and in-progress; if buyers ask for a ship date, the ADR-0500 charter answers.
- **"Architecture and ADR record published in our public repo"** — durably defensible and currently uncommon among Indian SaaS. The repo's `docs/architecture/` and `docs/ADRs/` directories make every claim above auditable. This single sentence transforms "trust me" into "verify me", which sophisticated DPDP-buyer technical reviewers will respect.
- **No "only" language, no "no one else does" language** — all comparative claims removed from the DEPA surface; the competitive briefing remains the home for that work.

**Build directions already committed elsewhere that operationalise the new positioning:**
- ADR-0500 (Healthcare bundle / ABDM unified artefact model) — Issue 3.
- ADR-0900 series (Incident management) including ADR-0908 (BFSI triple breach timer) — Issues 8 and 9.
- ADR-1100 series (Sector onboarding seed packs) — Issue 10.
- ADR-1004 (Regulatory Exemption Engine) — already shipped; cited above.

**Pre-release gate:** the new copy lands in the review-closing commit and goes live immediately. No build-blocker — the BFSI Regulatory Exemption Engine line is honest today; the ABDM healthcare line is honest because it points to a published ADR.

**Strategic context:**
- The user-direction here ("make one that's defensible") is the right move and stronger than the competitive briefing's own §9.1 prescription. The briefing prescribed a still-comparative line; this review's replacement drops comparatives entirely and substitutes verifiable feature names + statute citations + a public-ADR commitment.
- Long-term durability: as MeitY Top 6 ship more product, the new copy stays true; the only-claim variant would have decayed within months.

**Work tracked in:**
- Marketing rewrite commit closing this review (DEPA-page h1 + DEPA-page metadata + DEPA-moat lede + home-page meta description, four sites).
- No new ADR; the build directions are already committed under the issues cited above.

---

## Issue 21 — "Every other DPDP tool in India is a documentation tool"

**Claim (live on marketing):**
- Home-page Contrast section h2: *"Documentation tools check a box. Enforcement engines check reality."* — `marketing/src/components/sections/contrast.tsx`
- Contrast lede: *"Every other DPDP tool in India is a documentation tool. They record what you say your compliance posture is. ConsentShield records what your website actually does."* — `marketing/src/components/sections/contrast.tsx`

**Reality:** Competitive briefing §3, §4, and §8 show several Indian competitors with shipping tracker / cookie enforcement and probe-testing — not documentation-only. The dichotomy is rhetorical, not factual.

**Severity:** Self-flagged at the related-claim level. The Contrast h2 is the central home-page pivot — the entire "enforcement, not documentation" positioning rests on it.

**Decision — FIX-COPY (sharpened, non-comparative):**

Keep the documentation-vs-enforcement contrast as a **category descriptor**, not a competitor-bucket assignment. The architectural posture CS occupies is real; only the universal claim ("every other DPDP tool") erodes as competitors ship enforcement features.

Replacement copy (lands in the review-closing commit):

**h2** stays unchanged — *"Documentation tools check a box. Enforcement engines check reality."* — it describes two postures, not two competitor buckets.

**Lede** replaced with:

> *"There are two postures a DPDP tool can take. A **documentation tool** records what you say your compliance posture is — banner configured, notice published, policy uploaded. An **enforcement engine** records what your website actually does — which third-party scripts fired, whether the banner was respected, whether revocation actually stopped the downstream flow. ConsentShield is built as an enforcement engine: the Worker observes every tracker call against the consent artefact for the matching purpose, in real time, on every page load."*

**Both contrast cards** (left "Documentation tool" / right "ConsentShield") — kept as illustrative examples of the two postures rather than implicit "competitor / us" labels. The left card body is left as-is (it describes the posture, not a named competitor); the right card body is left as-is (it describes ConsentShield's specific implementation).

Why this is defensible:
- "Documentation tool" and "enforcement engine" are real categories that any architecturally literate reader can verify against any DPDP product (does the tool observe runtime behaviour, or does it record self-reported configuration?). The category description survives any competitor's marketing.
- Drops the universal generalisation ("every other DPDP tool in India") that the competitive briefing §9.1 flagged as no longer defensible.
- Aligns with the Issue-20 direction: no comparative negatives in marketing surfaces; let the reader compare against their current vendor.
- The description of the Worker's runtime observation is concrete and grep-able in the repo (`worker/src/observations.ts`, `worker/src/signatures.ts`, the tracker-observations buffer table) — readers who want to verify can.

**Pre-release gate:** copy lands in the review-closing commit; goes live immediately. No build-blocker.

**Strategic context:**
- The architectural contrast is the strongest home-page narrative CS has — sharpening rather than removing it preserves the central pivot that the rest of the home page (Story / DEPA-moat) hangs from.
- Long-term durability: as competitors ship more enforcement features, the category-descriptor framing stays accurate (the buyer judges their vendor on the **posture**, not on the label CS attaches to it). The universal-claim variant would erode within months.

**Work tracked in:**
- Marketing rewrite commit closing this review (Contrast lede; h2 + cards unchanged).
- No new ADR; the runtime observation primitive is already shipped (Worker + tracker_observations buffer + signatures DB).

---

## Issue 22 — "No India-native product currently owns this space as a compliance enforcement platform"

**Claim (live on marketing + collateral):**
- Public site — closest echoes:
  - Home-page hero h1: *"India's DPDP compliance enforcement engine."* — `marketing/src/components/sections/home-hero.tsx` (positioning, not exclusivity).
  - Home-page metadata: *"ConsentShield is the DEPA-native compliance engine for India's DPDP Act."* — `marketing/src/app/page.tsx:14-16` (already addressed under Issue 20).
- Internal collateral: the verbatim "no India-native product owns this space" claim appears in `docs/GTM-partnership/version 1/ConsentShield-Platform-Business-Strategy-v1.md` and the Partnership Overview / BFSI Segment Brief materials cited by the competitive briefing §9.1.
- Pricing copy ("Priced against a law firm retainer — not a SaaS tool.") — not an enforcement-platform exclusivity claim; defensible against a different comparator (legal-engagement spend).

**Reality (per CS's own competitive briefing):**
- §9.1 + §10 #1 prescribed pausing distribution of Master Design Doc v1.3 / Partnership Overview v4 / BFSI Segment Brief v3 and rewriting them as v1.4 / v5 / v4.
- §10 #2 — *"Rewrite the competitive landscape across all three documents in one consolidated revision."*
- Public-site exposure to this claim is low (Issues 20 / 21 already covered the home-page surfaces); the remaining exposure is internal-collateral.

**Severity:** Mostly internal-collateral risk, low public-site risk. The home-page hero is positioning (defensible); the metadata and DEPA-page surfaces were rewritten under Issue 20; the Contrast section was rewritten under Issue 21. Pricing's law-firm-retainer comparison is fine.

**Decision — FIX-COPY (public-site sweep, lands in this commit) + BUILD (internal-collateral rewrite, tracked as competitive-briefing follow-through; no new ADR range):**

**FIX-COPY — public-site sweep (lands in the review-closing commit alongside Issues 20 / 21):**
- Grep `marketing/src/` for residual exclusivity-tone phrasings: *"no India-native"*, *"only India-focused"*, *"first India-native"*, *"owns this space"*, *"no competitor"*, *"every other DPDP"*, *"the only India-"*. Rewrite each instance per the Issue-20 / 21 direction (drop comparative negatives; substitute verifiable feature names or category descriptors).
- Verify no residual "only" / "first" / "no other" claims survive on `pricing/`, `solutions/`, `product/`, `depa/`, `dpa/`, `privacy/`, or `docs/` surfaces.
- Confirm:
  - Home-page hero h1 (*"India's DPDP compliance enforcement engine."*) — kept; positioning, not exclusivity.
  - Pricing law-firm-retainer framing — kept; legitimate comparator.
- The grep + rewrite is one pass during the review-closing commit; results recorded in the commit message so the audit trail is explicit.

**BUILD — internal-collateral rewrite (operator-pending; tracked as competitive-briefing follow-through, no new ADR range):**

Not opening an ADR series for this. Internal collateral is content work, not architecture; opening an ADR range dilutes the ADR record. The competitive briefing's own §10 prescription is the tracking artefact and already lists target version numbers.

The collateral-rewrite checklist:
1. **Master Design Doc v1.4** (replaces v1.3) — incorporate tiered competitor framework, retire the "no India-native product owns this space" opening, lead with sectoral depth (BFSI + Healthcare).
2. **Partnership Overview v5** (replaces v4) — same retirement; CMP-vs-CM positioning made explicit (CS = CMP, not pursuing CM registration; reasoning per briefing §9.2).
3. **BFSI Segment Brief v4** (replaces v3) — preserves existing sectoral-wedge content (Regulatory Exemption Engine, third-party consent, triple breach), adds tiered competitor framing, retires exclusivity claims.
4. Once the three documents land, the competition briefing's recommendation #1 ("Pause all external distribution …") is closed; v1.4 / v5 / v4 are the externally-distributable artefacts.

**Tracking:**
- Recorded as items 1–3 of a "Collateral rewrite punch list" inline in the competitive briefing itself (`docs/competition/ConsentShield-Competitive-Landscape-Briefing-v1.md` — append a §11 punch list with these three items, dated 2026-04-25, marked `[ ] pending`).
- Each rewrite ships when authored; no engineering dependency; no ADR.
- Pre-launch gate: no external partnership distribution of v1.3 / v4 / v3 between now and the rewrite. Existing-relationship updates use v1.4 / v5 / v4 only after they land.

**Strategic context:**
- The competitive briefing already did the analytical work. This issue is just executing the prescribed rewrite.
- Keeping internal-collateral work outside the ADR record preserves the ADR signal-to-noise ratio (architecture decisions, not document version bumps). The briefing's punch list is the right tracking artefact.

**Work tracked in:**
- Marketing rewrite commit closing this review (FIX-COPY: public-site exclusivity-language sweep).
- `docs/competition/ConsentShield-Competitive-Landscape-Briefing-v1.md` §11 punch list (to be appended) — tracks the v1.4 / v5 / v4 collateral rewrite as competitive-briefing follow-through items.
- No new ADR series.

---

# Review summary

**Status:** All 22 issues processed.

| # | Issue | Decision | Tracked under |
|---|---|---|---|
| 1 | Deletion-connector counts (3 / 13 / Unlimited) | BUILD (pre-release gate on Growth) | ADR-1007 Sprints 1.1–1.5 |
| 2 | End-to-end deletion fan-out | BUILD + FIX-COPY (interim) | ADR-0023 |
| 3 | ABDM healthcare bundle | BUILD | ADR-0500 series (new) |
| 4 | Zero-storage for FHIR / clinical | BUILD (already covered) | ADR-0503 (Issue 3) |
| 5 | GDPR module | BUILD as GDPR-lite | ADR-0600 series (new) |
| 6 | DPO-as-a-Service marketplace | BUILD + Q3/Q4 2026 pill on public surface | ADR-0700 series (new) |
| 7 | White-label + custom domains + SSO + customer-KMS | BUILD | ADR-0800 series (new) |
| 8 | 72-hour breach workflow | BUILD (pre-release blocker, all tiers) | ADR-0900 series (new) |
| 9 | Dual / triple breach notification (DPB + RBI + SEBI) | BUILD (already covered, triple-timer scope confirmed) | ADR-0908 (Issue 8) |
| 10 | Sector templates "60% configured" / six verticals | BUILD | ADR-1100 series (new) |
| 11 | WhatsApp Business API unsubscribe cascade | BUILD | ADR-1007 Sprint 2.x + ADR-1107 |
| 12 | Per-property roles (CA firms / multi-brand) | BUILD | ADR-0808 (Issue 7 series) |
| 13 | Withdrawal verification | BUILD (two phases) | ADR-1200 (new) |
| 14 | Consent probe testing v1 overclaim | BUILD (already covered) | ADR-1200 Phase 2 (Issue 13) |
| 15 | "14-day free trial" | FIX-COPY → 30 days | review-closing commit |
| 16 | "All 15 endpoints" | FIX-COPY (dynamic / grouped) | review-closing commit |
| 17 | `testing.consentshield.in` not resolving | DONE — operator action executed inline | — |
| 18 | `status.consentshield.in` placeholder | BUILD via Better Stack | ADR-1300 series (new) |
| 19 | "DPB-formatted evidence package" | FIX-COPY ("DPB-ready") + BUILD (manifest extension) | ADR-0907 (extended) + commit |
| 20 | "Only India-native compliance platform with DEPA…" | FIX-COPY (verifiable replacement, no comparative negatives) | review-closing commit |
| 21 | "Every other DPDP tool in India is a documentation tool" | FIX-COPY (sharpened, non-comparative) | review-closing commit |
| 22 | "No India-native product owns this space" | FIX-COPY (public sweep) + BUILD (collateral rewrite) | commit + briefing §11 punch list |

**New ADR ranges opened in this review (all verified disjoint from Terminal A's `1003 / 1007 / 1008 / 1019` and Terminal B's `1006 / 1014 / 1015`):**
- `0500–0599` — Healthcare bundle (ABDM / ABHA / FHIR / clinical workflow). Issues 3, 4.
- `0600–0699` — GDPR-lite (Indian customers with EU exposure). Issue 5.
- `0700–0799` — Marketplace / ecosystem (DPO marketplace; partner network). Issue 6.
- `0800–0899` — Enterprise platform (custom-domain, white-label, SSO, customer-KMS, per-property roles, enterprise SLA, operator console). Issues 7, 12.
- `0900–0999` — Breach / incident management (universal workflow + BFSI dual / triple variants + audit-export extension). Issues 8, 9, 19.
- `1100–1199` — Sector onboarding seed packs (BFSI, Healthcare, SaaS, Edtech, D2C, plus measurement of "60% configured"). Issue 10.
- `1200–1299` — Enforcement-observability (withdrawal verification + sandbox-based probes). Issues 13, 14.
- `1300–1399` — Status / observability / incident comms (Better Stack integration). Issue 18.

**Existing ADRs extended (no new range):**
- ADR-0023 — promoted to pre-release blocker (Issue 2, unified deletion dispatcher).
- ADR-1007 — extended with WhatsApp BSP connector sprints under Sprint 2.x (Issue 11).
- ADR-0907 — manifest extension scope expanded to cover `tracker_observations_summary` + `violation_history` alongside the breach extensions already in the ADR-0900 series (Issue 19).

**Pre-release blockers (no paying-customer external distribution until these ship):**
- All tiers — ADR-0900 → ADR-0905 (breach workflow base).
- BFSI customers — ADR-0908 additionally (triple breach timer).
- Growth tier — at least 3 connectors live end-to-end (Issue 1).
- Pro-tier "Consent probe testing" line — ADR-1200 Phase 2 Sprints 2.1 → 2.3.
- Pro-tier "GDPR module" line — ADR-0600 → ADR-0603 minimum.
- Enterprise per-capability gating — ADR-0801 / 0802 / 0803-or-0804 / 0805 per feature claimed.
- BFSI / Healthcare Solutions tabs — ADR-1103 / ADR-1104 (sector seed packs).
- D2C external distribution — ADR-1107 (D2C seed pack) + at least one BSP connector (ADR-1007 Sprint 2.1, Gupshup).
- `status.consentshield.in` external linking — ADR-1303 DNS cutover.
- Healthcare bundle subscriptions — ADR-0500 → ADR-0502 minimum (ADR-0505 additionally on clinical-partner MoU + legal review).

**FIX-COPY changes consolidated into the review-closing commit (one commit, multiple files):**
- `marketing/src/app/pricing/page.tsx:66` — "14-day" → "30-day" (Issue 15).
- `marketing/src/app/docs/page.tsx:63` — drop "All 15 endpoints" hard count (Issue 16).
- `marketing/src/app/docs/page.tsx:94` — drop "15 REST endpoints"; widen grouping list to include `rights` and `security` (Issue 16).
- `marketing/src/app/docs/status/page.mdx` — drop "All 15" hard count (Issue 16).
- `marketing/src/components/sections/story.tsx` — "DPB-formatted" → "DPB-ready" (Issue 19).
- `marketing/src/app/product/page.tsx` — "DPB-formatted" → "DPB-ready" (Issue 19).
- `marketing/src/app/docs/cookbook/build-dpb-audit-export/page.mdx` — "DPB-formatted" → "DPB-ready" + clarification on no-DPB-spec-yet + default-storage footnote (Issue 19).
- `marketing/src/app/depa/page.tsx:9` — DEPA-page metadata rewrite (Issue 20).
- `marketing/src/components/sections/depa-hero.tsx` — DEPA-hero h1 rewrite (Issue 20).
- `marketing/src/components/sections/depa-moat.tsx` — DEPA-moat lede rewrite (Issue 20).
- `marketing/src/app/page.tsx:14-16` — home-page meta description rewrite (Issue 20).
- `marketing/src/components/sections/contrast.tsx` — Contrast lede rewrite (Issue 21).
- `marketing/src/` exclusivity-language sweep across `pricing/`, `solutions/`, `product/`, `depa/`, `dpa/`, `privacy/`, `docs/` for residual "only / first / no other / every other" patterns (Issue 22).

**Subsequent commits (separate from the review-closing commit; each tracked under its ADR):**
- ADR drafts for the new series (`0500`, `0600`, `0700`, `0800`, `0900`, `1100`, `1200`, `1300`) — one charter per series before sprints begin.
- Pre-release blocker sprints land before any external paying-customer distribution per the gates above.
- `docs/competition/ConsentShield-Competitive-Landscape-Briefing-v1.md` §11 punch list appended for the v1.4 / v5 / v4 internal-collateral rewrite (Issue 22).

**Cross-terminal coordination:**
- Terminal A active on ADR-1003 / 1007 / 1008 / 1019 — Terminal C reserves no new ranges that overlap; ADR-1007 extension (Issue 11) for WhatsApp BSP connectors must be authored cooperatively with Terminal A or held until Terminal A's current ADR-1007 phase closes.
- Terminal B active on ADR-1006 / 1014 / 1015 — Terminal C does not edit `testing/`, `marketing/src/app/docs/test-verification/*`, or any of B's in-flight files. Issue 17's testing-domain attach was executed by Sudhindra (operator) inline, not by Terminal C.
- The review-closing commit will stage by **explicit path** (per `feedback_explicit_git_staging` memory) so it does not sweep up A's or B's untracked files.

---

# Release-staging buckets

Derived from the 22 decisions and the pre-release matrix above. Every line carries the originating Issue # for cross-reference.

## Bucket 1 — Pre-release blockers (must ship before any paying-customer external distribution)

**Code / engineering work (unconditional):**
- **ADR-0023** — unified deletion dispatcher (revocation-triggered + rights-request-triggered into one call site). [Issue 2]
- **ADR-0900 → ADR-0905** — incident charter, data model, detection inputs, categorisation + assessment, draft + approval, dispatch (DPB + affected principals). [Issue 8]
- **ADR-0907** — audit-export manifest extensions: `tracker_observations_summary` + `violation_history` + `breach_notifications`. [Issues 8, 13, 19]
- **ADR-1200 Phase 1 Sprints 1.1 → 1.4** — withdrawal-verification real-user correlation: revocation-trigger row, materialised-view sweep, dashboard surface, audit-export extension. [Issue 13]
- **ADR-1007 Phase 1** — at least 3 connectors live end-to-end (Mailchimp + HubSpot + one more) for the Growth tier minimum. [Issue 1]
- **ADR-1303** — DNS cutover for `status.consentshield.in` to the Better Stack hosted page. [Issue 18]
- **ADR-1300 → ADR-1302** — Better Stack charter, monitor matrix, incident-comms policy. [Issue 18]
- **All FIX-COPY edits** — 13-file marketing rewrite commit (trial duration, /v1/* count, "DPB-formatted" → "DPB-ready", DEPA-page rewrite, Contrast lede, exclusivity-language sweep). [Issues 15, 16, 19, 20, 21, 22]

**Conditional pre-release blockers (only if the corresponding tier / sector goes to market pre-release):**
- BFSI customers / BFSI Solutions tab → **ADR-0908** (triple breach timer) + **ADR-1103** (BFSI seed pack). [Issues 9, 10]
- Healthcare Solutions tab + Healthcare-bundle subscriptions → **ADR-0500 → ADR-0502** (charter + ABHA + unified artefact). [Issues 3, 4]
- D2C Solutions tab external distribution → **ADR-1107** (D2C seed pack) + **ADR-1007 Sprint 2.1** (Gupshup BSP). [Issues 10, 11]
- Pro-tier "GDPR module" line → **ADR-0600 → ADR-0603** (charter + geo-detect + legal-basis + DPIA). [Issue 5]
- Pro-tier "Consent probe testing" line → **ADR-1200 Phase 2 Sprints 2.1 → 2.3** (sandbox probe + scheduler + dashboard). [Issues 13, 14]
- Enterprise tier per claim → **ADR-0801** (custom domain) + **ADR-0803-or-0804** (SSO) + **ADR-0805** (customer-KMS) + **ADR-0802** (white-label) per the bullet sold. [Issue 7]
- CA-firm / multi-brand pitch → **ADR-0808** (per-property roles). [Issue 12]

**Internal-collateral rewrite (operator-pending; pre-release before any external partnership distribution):**
- Master Design Doc v1.4, Partnership Overview v5, BFSI Segment Brief v4 — tracked in the competitive briefing's §11 punch list. [Issue 22]

## Bucket 2 — Now and continues into Q3/Q4 (start now; partial pre-release scope; additional scope extends)

Each stream has Bucket-1 work that must ship before release plus follow-on sprints that complete in Q3/Q4.

- **Healthcare bundle (ADR-0500 series).** Pre-release: ADR-0500 → ADR-0502. Continues Q3/Q4: **ADR-0503** (FHIR in-memory passthrough) → **ADR-0504** (prescription writer) → **ADR-0505** (drug-interaction; gated by clinical-partner MoU + legal review) → **ADR-0506** (billing flag wiring). [Issues 3, 4]
- **Sector seed packs (ADR-1100 series).** Pre-release: ADR-1100 → ADR-1102 + ADR-1103 (BFSI) + ADR-1104 (Healthcare) + ADR-1107 (D2C, paired with Gupshup). Continues Q3/Q4: **ADR-1105** (SaaS) + **ADR-1106** (Edtech) + **ADR-1108** (60%-configured measurement gate). [Issue 10]
- **Pre-built deletion connectors (ADR-1007).** Pre-release: 3 connectors live (Mailchimp + HubSpot + one Q3-pulled-forward). Continues Q3/Q4: the remaining 14 from the existing connectors README — CleverTap, Razorpay, WebEngage, MoEngage, Intercom, Freshdesk, Shopify, WooCommerce, Segment (Q3); Zoho CRM, Freshworks CRM, Zendesk, Campaign Monitor, Mixpanel (Q4). [Issue 1]
- **WhatsApp BSP connectors (ADR-1007 Sprint 2.x).** Pre-release: Sprint 2.1 Gupshup (paired with ADR-1107). Continues Q3/Q4: **Sprint 2.2** Interakt → **Sprint 2.3** Karix → **Sprint 2.4** Tanla (also the partnership hook from competition briefing §4.5) → **Sprint 2.5** Route Mobile → **Sprint 2.6** Kaleyra. [Issue 11]
- **Enterprise platform (ADR-0800 series).** Pre-release: per-capability gating on whatever's sold (typically ADR-0801 custom-domain + ADR-0803 / 0804 SSO). Continues Q3/Q4: **ADR-0802** (white-label branding), **ADR-0805** (customer-held KMS), **ADR-0806** (enterprise SLA surface), **ADR-0807** (operator console), **ADR-0808** (per-property role scoping). [Issues 7, 12]
- **Incident management (ADR-0900 series).** Pre-release: ADR-0900 → ADR-0905 + ADR-0907 + ADR-0908 (BFSI). Continues Q3/Q4: **ADR-0906** (remediation tracker + post-incident review). [Issues 8, 9, 19]
- **Withdrawal verification + sandbox probes (ADR-1200).** Pre-release: Phase 1 Sprints 1.1 → 1.4. Continues Q3/Q4: **Phase 1 Sprint 1.5** (RLS + integration tests for the Mrs Sharma path), **Phase 2 Sprint 2.4** (cost controls + plan-tier gating for sandbox probes). Phase 2 Sprints 2.1 → 2.3 are pre-release if the LAYER_3 "simulates users" copy stays live; if that copy gets a Q3/Q4 pill instead, all of Phase 2 moves to Bucket 3. [Issues 13, 14]
- **GDPR-lite (ADR-0600 series).** Pre-release: ADR-0600 → ADR-0603. Continues Q3/Q4: **ADR-0604** (SCC tracker), **ADR-0605** (EU-rep field), **ADR-0606** (Article-30 RoPA export), **ADR-0607** (GDPR billing flag wiring). [Issue 5]
- **Status & uptime via Better Stack (ADR-1300 series).** Pre-release: ADR-1300 → ADR-1303. Continues Q3/Q4: **ADR-1304** (uptime-target alignment + auto-degrade on miss), **ADR-1305** (subscriber notifications via email + RSS + webhook). [Issue 18]

## Bucket 3 — Q3/Q4 only (publicly marked, no pre-release scope)

Streams that do not gate any pre-release distribution and ship entirely in Q3/Q4 with explicit "Proposed — Q3/Q4 2026" public marking on the marketing surface:

- **Marketplace / DPO matchmaking (ADR-0700 series).** Already marked publicly with the Q3/Q4 2026 pill on Product LAYER_3 + Pricing Enterprise per the Issue-6 decision. Series: **ADR-0700** (charter), **ADR-0701** (provider directory data model), **ADR-0702** (matching surface), **ADR-0703** (scoped-access for empanelled providers), **ADR-0704** (revenue-share billing wiring), **ADR-0705** (DPO onboarding + KYC). Auditors panel keeps its existing "bring-your-own DPO/CA" framing in the interim — no silent rebrand. [Issue 6]
- **Healthcare bundle deferrable items.** ADR-0504 (prescription writer), ADR-0505 (drug-interaction; clinical-partner MoU + legal-review gates), ADR-0506 (billing flag wiring) — only deferrable if the bundle ships its first wave (0500 → 0503) without the writer / interaction-checker. [Issue 3]
- **Sector seed packs deferred sectors.** ADR-1105 (SaaS) + ADR-1106 (Edtech) — only deferrable if the SaaS / Edtech Solutions tabs are downgraded to "Coming Q3 2026" pills in the rewrite commit per the Issue-10 fallback. If the tabs stay live as today, these graduate to Bucket 1. [Issue 10]
- **Connector roadmap tail.** ADR-1007 Sprints 1.6 / 3.1 — the 14 connectors flagged Q3 / Q4 in the existing connectors README. [Issue 1]
- **WhatsApp BSP roadmap tail.** ADR-1007 Sprints 2.2 → 2.6 — Interakt, Karix, Tanla, Route Mobile, Kaleyra. [Issue 11]
- **Enterprise platform deferrables.** ADR-0802, ADR-0805, ADR-0806, ADR-0807, ADR-0808 (per-property roles) — deferrable to the extent Enterprise customers don't pull on the specific feature; promotes to Bucket 1 the moment a customer-of-record needs it. [Issues 7, 12]
- **Incident remediation tracker / PIR.** ADR-0906. [Issue 8]
- **GDPR-lite deferrables.** ADR-0604 / 0605 / 0606 / 0607. [Issue 5]
- **Status-page polish.** ADR-1304 / ADR-1305. [Issue 18]

## Load-balancing observations

1. **Bucket 1 is large but tractable.** The pre-release blocker list is dominated by two coherent series (ADR-0900 incident management; ADR-1200 withdrawal verification) plus targeted single-ADR work (ADR-0023, ADR-0907, ADR-1303). The FIX-COPY commit lands in a single sitting.
2. **The "conditional pre-release blockers" enable a staged launch.** If the launch is Starter + Growth only (no BFSI / Healthcare / Pro / Enterprise distribution), the conditional list collapses to ADR-1007 (3 connectors) + ADR-1107 (D2C seed pack) + ADR-1007 Sprint 2.1 (Gupshup). Pro / Enterprise / BFSI / Healthcare unlock as their respective ADRs ship.
3. **Bucket 2 is where the parallel-execution pattern (`feedback_parallel_adrs`) earns its keep.** Healthcare, Sector seed packs, Connectors, Enterprise, Incident, Withdrawal verification, GDPR-lite, Status — eight streams with non-overlapping code paths; round-robin sprint allocation works.
4. **Bucket 3 is genuinely deferrable.** Marketplace is the only major Bucket-3 item, already publicly Q3/Q4-marked. Everything else in Bucket 3 promotes to Bucket 1 the moment a customer-of-record pulls — which is the correct behaviour.

## Pending corrections (appended after the initial review closed)

Two open conflicts surfaced when this review's decisions were reconciled against the existing ADR record. Both are resolved below.

### Issue 18 — `status.consentshield.in` Better Stack decision vs already-shipped self-hosted status page (`ADR-1018`)

**Conflict:** the review decided BUILD via Better Stack under a new `ADR-1300` series. ADR-1018 (Completed 2026-04-23) had already shipped a self-hosted status page on the customer app's `/status` route + admin panel + pg_cron probes, and explicitly chose self-hosted over StatusPage.io to avoid third-party SaaS spend.

**Resolution (2026-04-25):** the user-direction is to **mark the self-hosting part of ADR-1018 as superseded and use ADR-1018 itself to document and plan the Better Stack integration**. Effects:
- ADR-1018 is restructured into Phase 1 (Completed self-hosted, superseded as primary public surface) + Phase 2 (Better Stack integration, Proposed, 8 sprints).
- Phase 1 self-hosted infrastructure stays running as an internal operator readout — useful for in-perimeter triage when Better Stack itself is degraded.
- The proposed `ADR-1300` series is **withdrawn**; Phase 2 of ADR-1018 absorbs the entire Better Stack scope. Avoids opening a new ADR range that would have collided with the existing band reservations (the second conflict, below).
- ADR-1018 Phase 2 acceptance criterion is the wireframe currently rendered at `marketing/src/app/docs/status/page.mdx`: seven monitored surfaces, per-surface uptime targets, 30-second multi-region probes, subscriber notifications, post-mortems for sev1 / sev2 incidents.

**Status:** ADR-1018 row in `docs/ADRs/ADR-index.md` updated to `In Progress (Phase 1 Completed and superseded; Phase 2 Proposed)`. Pre-release blocker on external distribution of any link to `status.consentshield.in` keyed to ADR-1018 Phase 2 Sprint 2.4 (DNS cutover), not the originally-proposed ADR-1303.

### Range collisions between the new ADR series proposed in this review and the existing index trailer

**Conflict:** the review proposed `0500 / 0600 / 0700 / 0800 / 0900 / 1100 / 1200 / 1300` as new ADR ranges. The existing index trailer reserves `0501+` for the marketing site (with `ADR-0501` already In Progress) and `1001+` for the v2 whitepaper (with Terminal A's pipeline work occupying `1003 / 1007 / 1008 / 1019 / 1020 / 1021 / 1025–1027`). The review's `0500` collides with the marketing band; `1100 / 1200 / 1300` sit inside Terminal A's `1001+` band.

**Resolution (2026-04-25):** **partially resolved.**
- Issue 18's `1300` series is withdrawn (folded into ADR-1018 Phase 2; see above).
- The remaining seven proposed ranges (`0500` healthcare, `0600` GDPR-lite, `0700` marketplace, `0800` enterprise platform, `0900` incident management, `1100` sector seed packs, `1200` withdrawal verification) **need renumbering** before any of those ADRs are drafted. Two options the founder can pick from:
  - **Option R-1: shift down into the open `0059–0500` gap.** Cleanest band-discipline path. Suggest `0100` healthcare, `0200` GDPR-lite, `0300` marketplace, `0400` enterprise platform, `0600` incident management, `0700` sector seed packs, `0800` withdrawal verification (`0500` stays clear of the existing `0501+` marketing band).
  - **Option R-2: amend the index trailer** to bracket the new bands explicitly so they coexist with `0501+` marketing and `1001+` v2 whitepaper without ambiguity. Less mechanical churn but the index becomes denser.
- This sub-resolution is **not yet executed.** No ADR file has been authored under any of the seven contested ranges; the renumbering decision can land before any first sprint without disrupting in-flight work. Tracked here pending the founder's pick.

**Status:** awaiting founder decision on Option R-1 vs R-2 for the seven-range renumbering. ADR-1018 Phase 2 (Issue 18 resolution above) does not depend on this decision.

---

**End of review.**
