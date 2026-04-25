ConsentShield — Competitive Landscape Briefing	Confidential · April 2026

**CONFIDENTIAL — INTERNAL BRIEFING**

**ConsentShield**

*India's DPDP Compliance Landscape — Competitive Briefing*

**COMPREHENSIVE COMPETITIVE LANDSCAPE**

April 2026 · v1.0 · Supersedes all prior competitive sections in Master Design Document, Partnership Overview, and BFSI Segment Brief

Hyderabad, India

> **Executive summary.** The Indian DPDP consent and privacy-tech market is significantly more crowded and more capitalised than ConsentShield's existing collateral acknowledges. At least **25 distinct competitors** operate across five tiers. Six of them — Jio Platforms, IDfy (Privy), Redacto, Zoop, Concur, and Aurelion Future Forge — have been explicitly shortlisted by MeitY under the "Code for Consent: DPDP Innovation Challenge" and are building reference-implementation Consent Manager systems to MeitY's own Business Requirement Document. These six enjoy a regulatory halo that ConsentShield cannot match on sentence-level positioning claims. Leegality (Consentin) has the strongest standalone Indian-market eSign-driven BFSI distribution. GoTrust, Scrut, Sprinto, and international players (OneTrust, TrustArc, Securiti, BigID) each have incumbent advantages in specific segments. ConsentShield's existing "only India-native DEPA-native platform" positioning is no longer defensible and must be rewritten. Three defensible wedges remain — the Regulatory Exemption Engine, third-party consent flows for nominees/guarantors/co-lenders, and the triple breach-notification timeline — but these are narrower than the current claims and require proof-point customers before external distribution.

# **1. Market Context**

## **1.1 DPDP Timeline**

The landscape that existed when ConsentShield's earlier collateral was written no longer exists. Three events in the last six months have changed it.

| Date | Event | Impact |
|---|---|---|
| 6 June 2025 | MeitY released the Business Requirement Document (BRD) for Consent Management under DPDP Act | Codifies the technical architecture for a DPDP Consent Manager — consent artefacts, purpose-specificity, revocation, dashboards, 22-language support, immutable audit trails. DEPA-native by design. |
| 28 July 2025 | MeitY shortlisted six firms for "Code for Consent: DPDP Innovation Challenge" Round 2 | Government-sanctioned reference implementations now exist. The six firms have regulatory halo no later entrant can replicate. |
| 14 November 2025 | DPDP Rules 2025 notified | Data Protection Board operational, penalties activated, compliance clock running. EY India estimates ₹10,000 crore compliance market over three years. |

## **1.2 Market Size**

EY India estimates a ₹10,000 crore cumulative spend on privacy automation, cybersecurity, and compliance services over 36 months. Consent management specifically is estimated at approximately 10% of this — roughly **₹1,000 crore (~$120M) over three years** for India consent tooling alone. The global CMP market is projected to grow from $802M (2025) to $3.59B (2033) — Asia-Pacific at 28% CAGR, driven principally by India.

## **1.3 The Crucial Distinction: CMP vs Consent Manager**

Existing ConsentShield collateral elides a distinction that will define competitive positioning for the next 18 months:

- A **Consent Management Platform (CMP)** is software sold to a Data Fiduciary (a bank, SaaS, e-commerce company, hospital, etc.) to help it collect, manage, and enforce consent from its users. Any Indian or foreign vendor can sell a CMP.
- A **registered Consent Manager (CM)** is a regulated intermediary, defined under DPDP Section 6 and the DPDP Rules 2025, that acts as a neutral interoperable platform allowing Data Principals to manage their consent across multiple Data Fiduciaries. Only India-incorporated companies with ₹2 crore minimum net worth can register. Consent Manager registration opens **13 November 2026**.

The MeitY Top 6 are explicitly building toward the **Consent Manager** category. Most other competitors — including OneTrust, TrustArc, Securiti, BigID, and Leegality — are positioned as **CMPs**. The two categories are complementary, not substitutable. A Data Fiduciary may deploy a CMP AND integrate with a registered Consent Manager.

**ConsentShield's current positioning is implicit CMP (sold to Data Fiduciaries) with DEPA-native architecture.** This is a valid category but needs to be made explicit in external collateral, because the default reader assumption in 2026 will be that every DPDP product is aiming at the regulated Consent Manager status. If ConsentShield is not pursuing CM registration, it needs a clear reason why — which it has (net worth, neutrality constraints, focus on operational runtime) but has not articulated.

# **2. Competitive Tier Structure**

The 25+ competitors fall into five distinct tiers. Not all tiers are equally threatening; tier membership is a better predictor of competitive risk than product-feature comparisons.

| Tier | Description | Count | Threat to ConsentShield |
|---|---|---|---|
| **Tier 1** | MeitY "Code for Consent" Top 6 — DEPA-native, government-sanctioned, building to MeitY BRD | 6 | **Highest.** Regulatory halo. Most are pursuing registered CM status. |
| **Tier 2** | Indian privacy-tech with real BFSI or enterprise distribution | 5 | **High.** Established customers, real go-to-market, DPDP products shipped. |
| **Tier 3** | Indian GRC platforms extending into DPDP from adjacent compliance categories | 6 | **Medium.** Broad compliance surface, existing customer base, but not DPDP-native. |
| **Tier 4** | Adjacent ecosystems (Account Aggregators, ABDM, Telecom DLT) with DEPA-native architectures in their own domains | 25+ | **Medium — category-adjacent.** Existing DEPA expertise but different regulatory scope. |
| **Tier 5** | International privacy-tech incumbents selling into India | 15+ | **Low-medium.** Priced out of mid-market, cannot register as CM, but have brand and RFP presence. |

The critical insight: **Tiers 1 and 2 together represent 11 direct competitors with real product, customers, or regulatory standing**. This is not a green-field market.

# **3. Tier 1 — MeitY "Code for Consent" Top 6**

On 28 July 2025, MeitY's National e-Governance Division and the MeitY Startup Hub shortlisted six firms from 46 applicants to build reference Consent Management Systems aligned with the MeitY BRD. These six are competing for what is effectively a government-endorsed reference architecture. This is the highest-signal cohort in the market.

## **3.1 Jio Platforms Pvt. Ltd. (Reliance Jio)**

| Field | Detail |
|---|---|
| Parent | Reliance Industries — India's largest conglomerate |
| Base | Mumbai |
| Category | Platform incumbent; telecom, JioFiber, retail, media, consumer tech |
| DPDP play | Reference Consent Manager under MeitY "Code for Consent" |
| Existing assets | 450M+ Jio telecom subscribers, JioMart retail, JioSaavn, JioCinema — massive first-party data footprint |
| Threat level | **Existential if fully executed.** Reliance rarely ships half-baked products. Can combine CM registration with cross-sell into every JioMart merchant, JioFiber enterprise customer, and Reliance group company. |
| ConsentShield implication | Cannot compete head-on for Jio-adjacent customers. Compete on sectoral depth (BFSI/healthcare) and where Jio will deprioritise SMB. |

## **3.2 Baldor Technologies / IDfy — Privy**

| Field | Detail |
|---|---|
| Parent | IDfy (Baldor Technologies Pvt. Ltd.) — 13+ year integrated identity platform |
| Base | Mumbai |
| Scale | 60M+ identity authentications monthly, sub-2-second response times |
| DPDP product | **Privy** (launched July 2024) — "India's first consent governance suite." Expanded May 2025 with **Privy Data Compass** (data discovery, classification, endpoint scanning) |
| Named customers | **Axis Bank**, Wakefit (public). Top-4 private bank reference. |
| Legal endorsement | Supratim Chakraborty (Partner, Khaitan & Co) at launch |
| Product surface | Consent & Rights Management, Data Governance, Risk Management, Continuous Compliance. 22-language support. Verifiable parental consent. Endpoint scanning on BFSI/insurance field agent devices. India-specific AI document models. |
| Threat level | **Highest among non-Reliance competitors.** Real bank, real product, MeitY-endorsed, deep-capital parent, BFSI-native features. |
| ConsentShield implication | Privy is materially wider than ConsentShield today on endpoint scanning, multilingual support, parental consent, and data discovery. ConsentShield's wedge must be narrower — operational DPDP runtime (Regulatory Exemption Engine, artefact-scoped deletion, triple breach) rather than "India-native DPDP." |

## **3.3 VertexTech Labs — Redacto**

| Field | Detail |
|---|---|
| Founded | 2025 (CIN U62099KA2025PTC197080) |
| Base | Bangalore — Embassy Tech Village |
| Founders | Amit Kumar, Vaibhav Sharma, Shashank Karincheti |
| Product | AI-powered nine-module privacy suite: Consent Manager, DSAR, PIA Automation, Data Discovery, Anonymization, CI/CD Privacy Scanner, Vendor Risk Management, Audit & Reporting, Trust Center |
| DPDP positioning | MeitY Top 6. Claims 7,000+ consent integrations. |
| Geographic | India + US storefronts |
| Threat level | **Medium.** MeitY halo upgrades them from "pre-PMF startup" to "government-sanctioned reference vendor." Broader suite than most Indian competitors. But young, no named customers, no BFSI proof points. |
| ConsentShield implication | Competes on AI branding and breadth of suite, not sectoral depth. ConsentShield wins in BFSI and healthcare where Redacto has no vertical proof. |

## **3.4 Quagga Tech — Zoop**

| Field | Detail |
|---|---|
| Company | Quagga Tech Pvt. Ltd. (zoop.one) |
| Category | Identity and business verification platform (KYC, KYB, background verification) |
| DPDP play | Consent management platform extending from identity. Uses AI to analyse user behaviour and suggest consent formats with higher opt-in probability. |
| MeitY status | Top 6 |
| Customer base | Unclear public list; the primary business is KYC/KYB APIs |
| Threat level | **Low-medium.** Category-extension play similar to IDfy but without IDfy's 60M/month scale. MeitY halo but limited DPDP-specific product visibility. |
| ConsentShield implication | Zoop will likely bundle consent with KYC onboarding for the fintech/NBFC buyer. ConsentShield must differentiate on post-onboarding lifecycle — erasure, retention mapping, rights portal. |

## **3.5 Concur — Consent Manager**

| Field | Detail |
|---|---|
| Company | Concur (unrelated to SAP Concur) |
| Co-founder | Gaurav Mehta |
| Category | Standalone DPDP Consent Manager pure-play — no adjacent business |
| MeitY status | Top 6 |
| Content | Active blog, strong DPDP educational content, competes directly on "consent manager" terminology |
| Features (public) | Multi-language, flexible APIs for web/enterprise/mobile, real-time consent orchestration, data discovery, grievance redressal workflows |
| Threat level | **Medium — pure-play specialist.** Not distracted by adjacent business like Jio, IDfy, or Zoop. Could be the fastest to execute a focused CM play. |
| ConsentShield implication | Most architecturally similar competitor. If Concur executes well, feature parity is likely within 12 months. ConsentShield's differentiation must be sectoral (BFSI/healthcare) rather than purely architectural. |

## **3.6 Aurelion Future Forge**

| Field | Detail |
|---|---|
| Base | Chennai |
| Category | Standalone Consent Manager play |
| MeitY status | Top 6 |
| Public information | Limited — most opaque of the six |
| Threat level | **Unknown — requires deeper research.** MeitY halo is the primary signal. |
| ConsentShield implication | Monitor and research. If customer announcements emerge, reassess. |

## **3.7 The Tier 1 Meta-Conclusion**

The MeitY Top 6 between them will define the "Consent Manager" category in India. They are building to the government's own specification. They will receive regulatory interpretive benefit of the doubt. Any DPDP product in India that is NOT part of this cohort will need to explain why it is a legitimate alternative — even if it is a better product. This has three implications for ConsentShield:

1. **The "DEPA-native" and "India-native" positioning claims are now table stakes, not differentiators.** Every Tier 1 competitor is building DEPA-native because the MeitY BRD requires it.
2. **ConsentShield should clarify explicitly whether it is pursuing CM registration.** If yes, it needs ₹2 crore net worth, neutrality commitments, and the 7-year retention obligation. If no, it needs to position as CMP (Data Fiduciary-facing software) without confusing buyers.
3. **Sectoral depth is the defensible wedge.** None of the Tier 1 six has published a BFSI retention-exemption module, a healthcare ABDM bundle, or a triple-breach-notification workflow. This is where ConsentShield should push.

# **4. Tier 2 — Indian Privacy-Tech with Distribution**

Five Indian companies not in the MeitY Top 6 but with established distribution or named customers in the DPDP space.

## **4.1 Leegality — Consentin**

| Field | Detail |
|---|---|
| Parent | Leegality (Gurugram) — established Indian legal-tech (BharatSign, BharatStamp) |
| Named customers (eSign business) | Federal Bank, South Indian Bank, IIFL Samasta, TCHFL, Dhan, Asian Paints |
| DPDP product | **Consentin** (consent.in) — "India's first DPDP Act compliant Consent Manager" (positioning claim) |
| Content machine | Consent blog — 30+ articles by Anahad Narain, weekly data protection newsletter, BFSI article series |
| Strategic asset | eSign-driven BFSI distribution — every major paperwork execution in Indian banks goes through Leegality |
| Threat level | **High.** Real BFSI distribution + DPDP-positioned product. Cross-sell into existing eSign accounts is frictionless. |
| ConsentShield implication | Cannot out-distribute Leegality in BFSI via direct sales. Must compete on product depth (Reg Exemption Engine) or find channel partners (Finacle, FLEXCUBE) that Leegality doesn't own. |

## **4.2 GoTrust**

| Field | Detail |
|---|---|
| Product | Universal Consent Management (UCM) with cross-system enforcement propagation, DPO Copilot, automated Data Discovery + RoPA, DSPM, Vendor Risk Management, Policy Manager, Trust Center |
| Advisory board | Former MeitY Senior Director in cyber law and data governance, IT Director, tech-focused business lawyer |
| Certifications (implied) | ISO 27001, ISO 27701 referenced in content |
| Testimonials | Anonymous but substantive ("centralised consent and DSR workflows — simple, reliable, and audit-ready") |
| NIST Privacy Framework alignment | Explicitly mapped |
| Threat level | **High — most architecturally complete competitor outside MeitY Top 6.** Broader than Consentin, more credible than Redacto, more India-specific than OneTrust. |
| ConsentShield implication | If GoTrust emerges as a serious contender in BFSI, ConsentShield's BFSI wedge narrows. Their DPO Copilot and DSPM overlap with adjacent segments ConsentShield hasn't yet addressed. |

## **4.3 Sprinto**

| Field | Detail |
|---|---|
| Base | Bangalore |
| Scale | $31.8M raised, 1,000+ customers, 2.5× revenue growth |
| Core business | SOC 2 / ISO 27001 / HIPAA / GDPR compliance automation |
| DPDP extension | "Get DPDP" — in-house + external compliance experts + platform, with DPDP control mapping layered on cloud-first compliance stack |
| Buyer | Cloud-first SaaS startups needing multi-framework automation |
| Threat level | **Medium — category overlap without DPDP depth.** Sprinto's strength is in security certifications, not DPDP operational runtime. |
| ConsentShield implication | Sprinto's buyer is a different persona (CISO, not DPO). Most ConsentShield SaaS targets will already have or be evaluating Sprinto for SOC 2. Opportunity: partner with Sprinto rather than compete — each solves a different compliance problem. |

## **4.4 Scrut Automation (Scrut.io)**

| Field | Detail |
|---|---|
| Base | Bangalore |
| Core business | Unified GRC — SOC 2, ISO 27001, GDPR, now DPDP |
| DPDP positioning | Control library mapped directly to DPDP Rules 2025; continuous control monitoring |
| Buyer | SaaS and fintech managing multiple compliance frameworks simultaneously |
| Threat level | **Medium — same rationale as Sprinto.** Different primary buyer, different value proposition. |
| ConsentShield implication | Same as Sprinto — potential partnership rather than zero-sum competition. Scrut customers still need a CMP; ConsentShield can be the CMP layer Scrut's governance framework references. |

## **4.5 Tanla Platforms — Wisely Consent**

| Field | Detail |
|---|---|
| Parent | Tanla Platforms (NSE: TANLA), Hyderabad, Gartner Visionary 3× |
| Category | CPaaS (SMS, voice, WhatsApp, RCS) with telecom consent overlay |
| DPDP positioning | Adjacent — Wisely Consent is TCCCPR/TRAI DLT, not DPDP. Trubloq is a DLT aggregator. |
| BFSI customers | 24 of top 30 BFSI (ICICI, Axis, HDFC, SBI, Bajaj Allianz) — all messaging-business |
| Threat level | **Medium — latent.** Category-adjacent today but has the distribution and brand to extend if they choose. |
| ConsentShield implication | See BFSI Brief v3 Tanla Positioning section. Channel partner candidate, quarterly monitored threat. |

# **5. Tier 3 — Indian GRC and Identity Platforms Extending into DPDP**

Indian platforms whose DPDP play is an extension of a primary business in GRC, identity, or adjacent compliance.

## **5.1 CONSEE (Future Crime Research Foundation)**

| Field | Detail |
|---|---|
| Positioning | "India's First Consent Management Platform Under DPDP Rule 2025" (marketing claim) |
| Origin | Future Crime Research Foundation (FCRF) |
| Focus | Cryptographic audit trails, constitutional-language notifications, grievance redressal automation |
| Threat level | **Low.** Research foundation origin suggests academic rather than commercial focus. Limited public traction. |

## **5.2 Digio (DigiO)**

| Field | Detail |
|---|---|
| Business | Digital documentation and Account Aggregator services |
| DPDP adjacency | Active content marketing on DPDP consent management; AA integrations with consent-driven financial data flows |
| Buyer | BFSI, lenders, LSPs |
| Threat level | **Low-medium.** Strong content SEO but unclear what DPDP product they actually ship. |

## **5.3 Signzy**

| Field | Detail |
|---|---|
| Business | KYC / digital onboarding |
| DPDP adjacency | KYC platforms naturally adjacent to consent but focus is identity verification, not consent lifecycle |
| Threat level | **Low.** Different primary product; competes in KYC not DPDP. |

## **5.4 Perfios (Anumati AA)**

| Field | Detail |
|---|---|
| Business | Financial data analysis, Account Aggregator (Anumati) |
| DPDP adjacency | RBI-regulated NBFC-AA consent manager for financial data. Already DEPA-native in its domain. |
| Threat level | **Low — different scope.** AAs are financial data only; see Tier 4. |

## **5.5 DPDP Consultants / Progressive Techserve / DPO India**

| Field | Detail |
|---|---|
| Category | Consultancy-led GRC stacks with in-house CMPs or reseller arrangements |
| Sales model | Advisory retainer + implementation + software |
| Threat level | **Low-medium — different buyer.** Competes with law firms and Big 4, not pure-play SaaS. |
| ConsentShield implication | Potential channel partners. CA firm partner programme already in the Partnership Overview applies analogously. |

## **5.6 ClearTax**

| Field | Detail |
|---|---|
| Business | GST and tax compliance SaaS |
| DPDP positioning | No dedicated DPDP product publicly announced |
| Threat level | **Low.** Different buyer (CFO, not CTO/DPO). |

# **6. Tier 4 — Adjacent DEPA-Native Ecosystems**

Existing DEPA-native consent manager ecosystems that operate in adjacent regulatory domains. These are not direct DPDP CMP competitors but they are the most architecturally mature consent managers in India and their approaches define the "gold standard" for DEPA-native implementation.

## **6.1 RBI Account Aggregator ecosystem (financial data)**

**17 RBI-licensed NBFC-AAs + 1 in-principle** operate as consent managers for financial data only, under RBI Master Directions. They are DEPA-native by design — consent artefacts with purpose IDs, timestamps, session IDs, digital signatures. Key AAs:

| Name | Parent | Notable |
|---|---|---|
| OneMoney | FinSec AA Solutions | First RBI-licensed AA (Oct 2019) |
| Anumati | Perfios AA | Largest bank integration footprint |
| Finvu | Cookiejar Technologies | Strong enterprise presence |
| NESL Asset Data | NESL-backed | Government-linked |
| CAMS Finserv | CAMS | Mutual fund infrastructure |
| Yodlee Finsoft | Yodlee | International parent |

**DPDP relevance.** DPDP draft rules (First Schedule, Illustration 2) explicitly contemplate NBFC-AAs registering as DPDP Consent Managers for financial data. This means **AAs could enter the general DPDP CMP market from a position of regulatory incumbency**. Most likely scenario: AAs continue focusing on structured financial data sharing and do not attempt to become general-purpose DPDP CMPs. But if they do, they would enter with 6+ years of DEPA operational experience and RBI regulatory credibility.

**ConsentShield implication.** AAs are not competitors today for ConsentShield's core BFSI targets (NBFCs, broking, SFBs needing operational DPDP). They become competitors if they extend beyond financial data — monitor OneMoney, Anumati, and Finvu product announcements quarterly.

## **6.2 ABDM Health Information Exchange — Consent Manager (HIE-CM)**

The ABDM stack includes its own HIE-CM, a DEPA-native consent manager for health data managed under the National Health Authority (NHA). Relevant actors:

| Name | Category |
|---|---|
| HIE-CM (ABDM-native) | Government reference implementation |
| Bahmni | Open-source HIS with HIE-CM extensions (Thoughtworks, MIT-licensed) |
| Eka Care | Patient-facing ABHA app |
| SpreadMe Digital, VCDoctor, Dreamsoft4u | ABDM integration services for hospitals |

**DPDP relevance.** Health data is a DPDP-sensitive category. ABDM's HIE-CM handles consent for health record exchange but does NOT handle other DPDP obligations (marketing consent, cookie consent, rights portals, breach notification). Hospitals with ABDM integration still need a full DPDP CMP for everything outside the ABDM data flow.

**ConsentShield implication.** This is the premise behind ConsentShield's healthcare bundle. The "ABDM + DPDP unified artefact model" is a genuine wedge for 438,000 ABDM-registered clinics. Competitive risk is low because no other DPDP vendor has built this bridge explicitly.

## **6.3 Telecom DLT — TCCCPR / TRAI (covered in BFSI Brief v3)**

VilPower (Vi), Jio DLT, Airtel DLT, BSNL/MTNL DLT at the portal layer. Tanla (Trubloq, Wisely Consent), Karix, Kaleyra, Route Mobile, Gupshup at the aggregator layer. All telecom commercial communications regulation, not DPDP. See BFSI Segment Brief v3 §10 for full treatment.

# **7. Tier 5 — International Privacy-Tech Incumbents**

International vendors cannot register as DPDP Consent Managers (Section 6 restricts CM status to India-incorporated entities with ₹2 crore net worth). They can still sell CMP software to Indian Data Fiduciaries but operate under a market-access constraint.

| Vendor | HQ | Annual price (India context) | DPDP positioning | Threat |
|---|---|---|---|---|
| OneTrust | US | ~₹46 lakh+ | DPDPA-mapped control frameworks; DSAR automation; data discovery; vendor risk; breach response. Comprehensive but priced for large enterprise. | Medium — enterprise RFPs only |
| TrustArc | US | Enterprise | Structured workflows; RoPA; DPIA automation; audit trails | Low-medium — closest OneTrust alternative |
| Securiti.ai | US | Enterprise | PrivacyOps + AI governance; automated data discovery; DSR + Consent Automation; PIA automation; breach management. AI-native positioning resonates with current buying trends. | **Medium-high — AI-native enterprise play** |
| BigID | US | Enterprise + CMP Express | **BigID CMP Express** (launched Nov 2025) — connects consent to enterprise data discovery at the data layer. $60M Series in March 2025. | Medium — unique data-layer positioning |
| Ketch | US | Mid-enterprise | No-code privacy automation, DSAR orchestration across complex stacks | Low |
| Osano | US | SMB-mid | Cookie-focused, simpler than OneTrust | Low |
| Transcend | US | Enterprise | Engineering-led privacy, developer-focused | Low — niche |
| Didomi | France | Enterprise | Cookie-focused, 2B+ consents/month, 99.9999% uptime | Low — non-India focus |
| Usercentrics / Cookiebot | Germany/Denmark | Mid | Cookie-focused | Low |
| CookieYes | India/UK | SMB | Cookie banner SaaS | Low |
| Relyance AI | US | Enterprise | $32M Series B, AI-native compliance | Low — early India presence |
| DataGrail | US | Mid-enterprise | Privacy automation | Low — limited India presence |
| Vanta | US | Mid-enterprise | SOC 2 automation, now GDPR/DPDP | Low — Sprinto-equivalent from US |
| Secureframe | US | Mid | SOC 2 automation | Low |
| Secure Privacy | Denmark | SMB | Mid-market CMP; India DPDP Phase 1 ready | Low — SMB focus, SMB pricing |
| ServiceNow | US | Enterprise | Bundled with ServiceNow GRC | Low — TCS/Infosys SI-led deployments |
| IBM | US | Enterprise | Bundled with IBM Guardium | Low |

**International incumbent meta-observation.** The ₹250 crore DPDP penalty ceiling and the Consent Manager registration barrier collectively mean that international vendors face a structural disadvantage in the Indian mid-market. They will dominate large-enterprise RFPs (where OneTrust's feature breadth wins) and lose in the mid-market where Indian vendors offer a compliance-fit-for-purpose alternative at one-tenth the price.

# **8. Feature Comparison Matrix — The Capabilities That Actually Differentiate**

ConsentShield's earlier collateral positioned itself on "DEPA-native consent artefacts" as the primary differentiator. That claim is no longer sharp — every MeitY Top 6 entrant and GoTrust, Consentin, and Tier 4 AAs are DEPA-native. The defensible wedges are narrower:

| Capability | ConsentShield | Privy (IDfy) | Consentin (Leegality) | GoTrust | Redacto | Concur | Jio CM | OneTrust |
|---|---|---|---|---|---|---|---|---|
| DEPA-native consent artefacts | Yes | Probable (to MeitY BRD) | Probable | Yes | Probable | Probable | Certain | No (GDPR event model) |
| 22-language support | No | Yes | Unknown | Partial | Probable | Probable | Probable | Limited |
| Verifiable parental consent | Partial | Yes | Unknown | Partial | Unknown | Unknown | Probable | Yes (global) |
| Data discovery / endpoint scanning | No | **Yes (Data Compass, endpoint)** | Partial | **Yes (DSPM)** | Yes | Partial | Probable | Yes |
| Tracker / cookie enforcement | **Yes** | Unknown | Unknown | Yes | Yes | Yes | Unknown | Yes |
| DSAR / rights portal with SLA | Yes | Yes | Yes | Yes | Yes | Yes | Probable | Yes |
| **Regulatory Exemption Engine** (RBI KYC, PMLA, SEBI retention) | **Yes** | **No** | **No** | **No** | **No** | **No** | **Unknown** | **No** |
| **Triple breach notification** (DPB + RBI + SEBI) | **Yes** | **No** | **No** | **No** | **No** | **No** | **Unknown** | **Partial** |
| **Third-party consent** (nominees, guarantors, co-lenders) | **Yes** | **No** | **No** | **No** | **No** | **No** | **Unknown** | **No** |
| ABDM healthcare unified bundle | Yes | No | No | No | No | No | No | No |
| BFSI sectoral template | Yes | Partial (endpoint scanning) | Partial (eSign integration) | Partial | No | No | Probable via Jio Financial | Partial |
| Zero-Storage architecture | Yes | No (holds data) | No (holds data) | Probable | Probable | Probable | No (likely holds data) | No |
| Registered Consent Manager status | **No** (by design) | **Pending (MeitY Top 6)** | **Pending (positioning)** | **Unknown** | **Pending (MeitY Top 6)** | **Pending (MeitY Top 6)** | **Pending (MeitY Top 6)** | **Cannot register** |
| 30-second to deploy (growth-stage pricing) | **Yes** | No | No | No | Probable | Probable | No | No |

The cells in bold are where ConsentShield has defensible differentiation. **The remaining wedges are:**

1. **Regulatory Exemption Engine** — no public competitor maps DPDP erasure against RBI KYC / PMLA / SEBI LODR statutory retention. This is genuine novelty.
2. **Third-party consent flows** for nominees, guarantors, insurance partners, co-lenders — none of the BFSI products above has built this. It is a specific DPDP obligation most have ignored.
3. **Triple breach notification** (72-hr DPB + 6-hr SEBI + 4-hr RBI) in one workflow — no competitor publicly claims this.
4. **ABDM-DPDP unified artefact model** for healthcare — no competitor publicly claims this.
5. **Zero-Storage architecture** — a deployment differentiator for bank risk committees, not a feature-comparison differentiator.
6. **Growth-stage pricing** — genuinely differentiated vs OneTrust/Privy/GoTrust; similar to Redacto/Concur.

# **9. Strategic Implications for ConsentShield**

## **9.1 Positioning Must Be Rewritten**

Three claims across the Master Design Doc, Partnership Overview, and BFSI Segment Brief are no longer defensible and must be revised before any external distribution:

| Current claim | Problem | Replacement |
|---|---|---|
| "No India-native product currently owns this space as a compliance enforcement platform" (Partnership Overview, opening) | False — at least 11 Indian products ship DPDP-positioned tooling as of Q1 2026, and 6 of them are MeitY-endorsed. | "The Indian DPDP compliance market in 2026 is crowded. ConsentShield's differentiation is operational depth in BFSI and healthcare — the Regulatory Exemption Engine, third-party consent for nominees/guarantors/co-lenders, and the triple breach notification timeline — capabilities no competitor has publicly claimed." |
| "ConsentShield is the only India-focused platform with a DEPA-native consent artefact model" (Master Design Doc, Partnership Overview) | DEPA-native is table stakes post-MeitY BRD. Every MeitY Top 6 entrant is building DEPA-native. | "ConsentShield is built DEPA-native to MeitY BRD standards, with sector-specific extensions for BFSI (retention-exemption, third-party consent) and healthcare (ABDM unified artefact model) that the MeitY reference implementations do not include." |
| "Every other tool in the market uses a GDPR-adapted checkbox event model" (Partnership Overview) | True for international tools (OneTrust, TrustArc, Didomi) but increasingly false for Indian tools, especially the MeitY Top 6. | "International tools retain GDPR-adapted models. Indian competitors are increasingly DEPA-native. ConsentShield differentiates on sector-specific operational capabilities, not on the architectural category." |

## **9.2 The CMP-vs-CM Question Must Be Resolved**

Before the next round of external distribution, ConsentShield must answer:

**Is ConsentShield pursuing registration as a Consent Manager (CM), or positioning as a Consent Management Platform (CMP) sold to Data Fiduciaries?**

Arguments for pursuing CM registration:
- Regulatory halo equivalent to MeitY Top 6
- Eligibility to operate neutrally across Data Fiduciaries
- Strategic lock-in — once registered, switching costs are high for any enterprise customer

Arguments against:
- ₹2 crore minimum net worth (sole proprietorship structure is incompatible; incorporation and capitalisation required)
- Fiduciary duty to Data Principals creates conflicts with selling CMP software to Data Fiduciaries
- 7-year retention obligation for consent records (architecturally incompatible with Zero-Storage mode)
- Neutrality obligations prevent sectoral template customisation for specific Data Fiduciaries

**Recommendation:** Position ConsentShield explicitly as a **CMP** (Data Fiduciary-facing software), not a CM. The Zero-Storage architecture, sectoral templates, and growth-stage pricing are all incompatible with CM registration requirements. Write this into the Partnership Overview openly — *"ConsentShield is a Consent Management Platform sold to Data Fiduciaries; it is not pursuing registration as a DPDP Consent Manager. Our customers may choose to integrate with any registered Consent Manager (MeitY Top 6 or others) alongside ConsentShield; the two categories are complementary."*

## **9.3 Sectoral Depth Is the Defensible Wedge**

Every general-purpose DPDP competitor is building horizontal capability to MeitY BRD. ConsentShield's moat is vertical:

- **BFSI track.** Regulatory Exemption Engine, triple breach notification, third-party consent for nominees/guarantors/co-lenders, core banking channel partnerships (Finacle/FLEXCUBE), SFB entry strategy.
- **Healthcare track.** ABDM-DPDP unified artefact model for the 438,000 ABDM-registered facilities — no competitor has this.

The BFSI Segment Brief v3 already articulates this wedge correctly. The Master Design Doc and Partnership Overview need to be re-weighted to lead with sectoral depth rather than DEPA-architecture-first.

## **9.4 Partnership Strategy Requires Expansion**

The current partnership triangle (CA firms, startup accelerators, fintech lawyers) is inadequate for a crowded competitive field. The revised partnership map should include:

| Partner category | Rationale | Example targets |
|---|---|---|
| **Core banking vendors** | Bypass bank procurement; already in BFSI Brief v3 | Infosys Finacle, Oracle FLEXCUBE, Temenos |
| **CPaaS players** (Tanla model) | Bundle DPDP with telecom consent for enterprise customers who already use them | Tanla, Karix, Kaleyra, Route Mobile, Gupshup |
| **GRC complement** (Sprinto, Scrut model) | Each solves a different compliance problem; customer needs both | Sprinto, Scrut Automation |
| **KYC/identity platforms** | Consent flows naturally extend KYC flows | Signzy, Perfios, IDfy (only if not competing), Digio |
| **ABDM integrators** | Healthcare channel | SpreadMe Digital, VCDoctor, Dreamsoft4u |
| **CA firms and fintech law firms** | Existing — maintain | NASSCOM, T-Hub, iSPIRT cohorts; fintech lawyer DPO partner |
| **Big 4 advisory follow-through** | Big 4 produces one-time gap reports; ConsentShield is the operational follow-through | Deloitte, EY, PwC, KPMG privacy practices |

## **9.5 Quarterly Competitive Monitoring Protocol**

Given the velocity of the market, quarterly competitive updates are required. Specific signals to monitor:

- MeitY Top 6 product announcements, customer wins, or Consent Manager registration completions (post Nov 2026)
- Jio Platforms' first public DPDP product announcement
- Privy Data Compass customer announcements; extension into non-BFSI sectors
- GoTrust customer names (currently anonymous in testimonials)
- Consentin BFSI case study publications beyond eSign
- Any of Sprinto, Scrut, Redacto adding BFSI retention-exemption modules
- RBI Account Aggregator ecosystem announcements — any AA extending beyond financial data
- International vendor pricing changes specifically for India
- MeitY Top 6 public product teardowns by industry analysts

# **10. Immediate Recommended Actions**

In order of priority:

1. **Pause all external distribution of Master Design Doc v1.3, Partnership Overview v4, and BFSI Segment Brief v3.** The competitive positioning across all three overclaims relative to market reality.

2. **Rewrite the competitive landscape** across all three documents in one consolidated revision. Master Design Doc v1.4, Partnership Overview v5, BFSI Segment Brief v4. Lead with sectoral depth; position DEPA-native as table stakes; add the tiered competitor framework from this briefing.

3. **Make the CMP vs CM positioning explicit.** Recommend CMP positioning; write it into the Partnership Overview opening section; eliminate any claims that could be read as CM positioning.

4. **Do a live product teardown of Privy by IDfy.** Register for a Privy demo, evaluate the actual consent data model, confirm or refute DEPA-native architecture, capture pricing signals. This is the single highest-impact competitive research outstanding.

5. **Do a live product teardown of Consentin (consent.in).** Second-highest priority.

6. **Build an opinionated "why not register as a Consent Manager" explainer page** for the ConsentShield website. This addresses the buyer objection "but Privy / Concur / Jio are registering as Consent Managers — why aren't you?" before it is raised in a sales conversation.

7. **Develop BFSI proof-point collateral urgently.** The BFSI Segment Brief v4 will be credible only with a named NBFC or SFB customer reference. Every quarter without a reference customer narrows the defensible differentiation window.

8. **Evaluate partnership approaches with Sprinto, Scrut, Tanla, and one ABDM integrator.** Each is a non-zero-sum channel.

9. **Commit to a quarterly competitive update rhythm.** The market velocity rewards frequent recalibration.

---

*Regulatory references: DPDP Act 2023; DPDP Rules 2025 (notified 14 November 2025); MeitY Business Requirement Document for Consent Management under the DPDP Act, June 2025; RBI Master Directions on NBFC-AA 2016; ABDM architecture documentation (National Health Authority).*

*Prepared April 2026 from public sources. All competitor characterisations are based on publicly available product pages, press releases, industry analyst reports, and regulatory filings as of the briefing date. No non-public information has been used. Product capabilities marked "probable" or "unknown" are inferred or unconfirmed and require direct product validation.*

# **11. Collateral Rewrite Punch List**

Added 2026-04-25 from `docs/reviews/2026-04-25-marketing-claims-vs-reality-review.md` Issue 22. Tracks the §10 #1 + §10 #2 prescription. Each item is the rewrite of an internal-distribution document; engineering work for the underlying capabilities is tracked separately under the ADR series opened in the marketing-claims review (ranges `0500 / 0600 / 0700 / 0800 / 0900 / 1100 / 1200 / 1300`).

| # | Document | Action | Status | Owner | Pre-release? |
|---|---|---|---|---|---|
| 1 | Master Design Doc v1.4 (replaces v1.3) | Incorporate tiered competitor framework. Retire "no India-native product owns this space" opening. Lead with sectoral depth (BFSI + Healthcare). | [ ] pending | Sudhindra | Yes — pre-release before any external partnership distribution |
| 2 | Partnership Overview v5 (replaces v4) | Same retirement. CMP-vs-CM positioning made explicit (CS = CMP, not pursuing CM registration; reasoning per §9.2). | [ ] pending | Sudhindra | Yes — pre-release |
| 3 | BFSI Segment Brief v4 (replaces v3) | Preserve sectoral-wedge content (Regulatory Exemption Engine, third-party consent, triple breach). Add tiered competitor framing. Retire exclusivity claims. | [ ] pending | Sudhindra | Yes — pre-release |

Once v1.4 / v5 / v4 are landed, recommendation #1 from §10 ("Pause all external distribution …") is closed; v1.4 / v5 / v4 are the externally-distributable artefacts. Until then, no external partnership distribution of the v1.3 / v4 / v3 versions.

Engineering build directions referenced by the rewrite (cross-references back into the marketing-claims review's bucketing):

- BFSI sectoral depth — ADR-0900 series (incident management) + ADR-0908 (BFSI triple breach) + ADR-1004 (Regulatory Exemption Engine, shipped) + ADR-1103 (BFSI seed pack).
- Healthcare sectoral depth — ADR-0500 series (charter → ABHA → unified artefact → FHIR → prescription writer → drug-interaction → billing flag) + ADR-1104 (Healthcare seed pack).
- CMP vs CM positioning — no engineering implication; documented in the rewrite.

© 2026 ConsentShield · consentshield.in · Confidential
