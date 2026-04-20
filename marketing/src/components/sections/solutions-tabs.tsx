'use client'

import { useState, type ReactNode } from 'react'

// ─── Sector data ─────────────────────────────────────────────────────────
// Ported verbatim from consentshield-site-v2.html (#page-solutions).
// Each sector has a tab label, slug (used as `id=tab-<slug>` anchor for
// cross-page links from the footer), priority badge, scenario copy, two
// stats, and three feature cards with inline SVG icons.

interface Stat {
  num: string
  label: string
}

interface Feature {
  icon: ReactNode
  title: string
  desc: ReactNode
}

interface Sector {
  slug: string
  tab: ReactNode
  priority: string
  heading: ReactNode
  description: ReactNode
  stats: [Stat, Stat]
  features: [Feature, Feature, Feature]
}

const SECTORS: Sector[] = [
  {
    slug: 'saas',
    tab: <>SaaS &amp; B2B</>,
    priority: 'PRIORITY 01',
    heading: 'Indian SaaS founders, 5–50 employees, seed to Series B.',
    description:
      'DPDP is now a due diligence item for fundraising. VCs ask about it. EU customer exposure adds GDPR urgency on top. DEPA-native artefacts answer the "show me your consent model" question in investor calls with a specific, auditable answer — not a cookie banner screenshot.',
    stats: [
      { num: '~15,000', label: 'Indian SaaS startups in the immediate ICP' },
      { num: '48 hrs', label: 'From signup to first enforcement report' },
    ],
    features: [
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Investor-ready compliance posture',
        desc: 'DEPA artefact register answers "show us your consent architecture" with a precise, auditable data structure — not a cookie banner.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 6h16M4 12h16M4 18h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Dual DPDP + GDPR in one artefact',
        desc: 'Same consent record covers both frameworks. Visitor location switches the legal basis and notice automatically.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="8"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M8 12l3 3 5-6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Engineering-lead compatible',
        desc: 'Compliance API, webhooks, and SDKs. Embed artefact revocation and deletion into your own workflow — no manual dashboards for every event.',
      },
    ],
  },
  {
    slug: 'edtech',
    tab: 'Edtech',
    priority: 'PRIORITY 02',
    heading: 'Edtech platforms, 50K–2M users, K-12 or upskilling.',
    description: (
      <>
        Children&apos;s data provisions are the harshest under DPDP — separate
        consent, no behavioural advertising, highest penalty multiplier.
        Purpose-scoped artefacts with defined expiry windows and data scope
        are the <em>defensible evidence trail</em> if a Data Protection Board
        case is ever opened.
      </>
    ),
    stats: [
      { num: '~3,000', label: 'Indian edtech platforms in scope' },
      {
        num: 'Verifiable',
        label: 'Parental consent recorded as a distinct artefact',
      },
    ],
    features: [
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 3L3 8l9 5 9-5-9-5z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M3 13l9 5 9-5M3 18l9 5 9-5"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Child-specific purpose definitions',
        desc: 'Template includes age-gated purpose definitions, parental consent artefact type, and behavioural-advertising block.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 4h16v16H4z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M4 10h16M10 4v16"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Learning analytics, not behavioural tracking',
        desc: 'Pre-configured to separate learning progress analytics (necessary) from behavioural advertising (blocked) in the artefact model.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12l4 4L19 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ),
        title: 'DPB-ready evidence package',
        desc: 'If a complaint is filed, generate a complete audit export scoped to the principal and the purpose — one click.',
      },
    ],
  },
  {
    slug: 'd2c',
    tab: <>D2C &amp; e-commerce</>,
    priority: 'PRIORITY 03',
    heading: 'D2C e-commerce, ₹5–50 crore GMV.',
    description:
      'Email and WhatsApp marketing lists are explicitly regulated under DPDP. Artefact-scoped deletion means when a user withdraws, marketing actually stops across Mailchimp, CleverTap, MoEngage, WhatsApp, and others — not just fires a webhook that gets ignored.',
    stats: [
      { num: '~25,000', label: 'Indian D2C brands in the target market' },
      { num: '13', label: 'Pre-built deletion connectors on Pro tier' },
    ],
    features: [
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M3 6h18l-2 13H5L3 6z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Marketing-stack deletion connectors',
        desc: 'Pre-built for Mailchimp, HubSpot, CleverTap, MoEngage, Shopify, Razorpay, WebEngage, and generic webhook for custom systems.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 4h16v16H4z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path d="M4 9h16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ),
        title: 'WhatsApp opt-out as a first-class artefact',
        desc: 'WhatsApp marketing is a separate purpose with its own artefact and expiry. Revocation cascades to WhatsApp Business API unsubscribe.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="8"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M12 7v5l3 2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Withdrawal verified, not just triggered',
        desc: 'After withdrawal, ConsentShield re-scans your site to confirm the relevant marketing trackers actually stopped firing.',
      },
    ],
  },
  {
    slug: 'healthcare',
    tab: 'Healthcare (ABDM)',
    priority: 'PRIORITY 04',
    heading: 'Single-doctor clinics and small group practices.',
    description:
      'ABDM registration plus health data means immediate DPDP obligation. The unified DEPA artefact model — the same structure whether the framework is DPDP or ABDM — is the headline differentiator. One artefact register covers both. Target distribution: IMA chapters across Mumbai, Delhi NCR, Bengaluru, Hyderabad, Chennai, Pune, Kolkata, Ahmedabad.',
    stats: [
      { num: '4,38,000', label: 'ABDM-registered facilities in scope' },
      { num: 'Zero', label: 'Clinical content persisted by ConsentShield' },
    ],
    features: [
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4v16M4 12h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Unified ABDM + DPDP artefact',
        desc: "A patient's ABDM consent artefact and their DPDP consent artefact are the same data structure. One register, two framework labels.",
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <rect
              x="4"
              y="6"
              width="16"
              height="14"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M9 2v4M15 2v4M4 11h16"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'ABHA lookup + prescription workflow',
        desc: 'ABHA ID resolution, consent-gated health record pull, prescription writing with AI drug interaction check, digital prescription upload back to ABDM.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 4h16v6H4z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M4 14h16v6H4z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Zero-storage mode is mandatory',
        desc: 'FHIR records flow through memory only — never persisted. Any code path that tries to persist clinical content is rejected in review.',
      },
    ],
  },
  {
    slug: 'bfsi',
    tab: <>BFSI (NBFC + Broking)</>,
    priority: 'PRIORITY 05 · NEW',
    heading: 'Digital NBFCs and broking/wealth platforms.',
    description:
      "India's 1,500+ digital-first NBFCs and 500+ SEBI-registered broking platforms carry the same DPDP obligations as large banks — with none of the internal compliance infrastructure. Sensitive financial data at scale (KYC, bureau data, contact permissions, trading history), dual regulatory obligations under DPDP plus RBI/SEBI, and no existing tool that maps these intersections into operational software.",
    stats: [
      { num: '1,500+', label: 'Digital-first NBFCs addressable today' },
      { num: 'First', label: 'India-native Regulatory Exemption Engine' },
    ],
    features: [
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M4 7h16l-2 13H6L4 7z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle
              cx="12"
              cy="13"
              r="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
        ),
        title: 'Regulatory Exemption Engine',
        desc: 'Resolves SEBI retention requirements vs DPDP erasure rights. The only India-native tool that maps these intersections into operational software.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <circle
              cx="9"
              cy="9"
              r="4"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle
              cx="17"
              cy="14"
              r="3"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M3 21c0-3 3-5 6-5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Third-party consent flows',
        desc: 'Structured artefacts for nominee, guarantor, co-borrower, and joint-account-holder consent — separately addressable, independently revocable.',
      },
      {
        icon: (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2v20M5 9l7-7 7 7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ),
        title: 'Dual breach notification timelines',
        desc: "RBI's 6-hour notification track and DPDP's 72-hour track in one workflow. One incident, two correctly-timed notifications.",
      },
    ],
  },
]

export function SolutionsTabs() {
  const [active, setActive] = useState<string>(SECTORS[0].slug)
  const panel = SECTORS.find((s) => s.slug === active)!

  return (
    <>
      <div className="sol-tabs" role="tablist">
        {SECTORS.map((s) => (
          <button
            key={s.slug}
            type="button"
            role="tab"
            aria-selected={active === s.slug}
            aria-controls={`tab-${s.slug}`}
            onClick={() => setActive(s.slug)}
            className={`sol-tab${active === s.slug ? ' active' : ''}`}
          >
            {s.tab}
          </button>
        ))}
      </div>

      <div
        className="sol-panel active"
        id={`tab-${panel.slug}`}
        role="tabpanel"
      >
        <div className="sol-panel-inner">
          <div className="sol-scenario">
            <span className="mono" style={{ color: 'var(--teal)' }}>
              {panel.priority}
            </span>
            <h3>{panel.heading}</h3>
            <p>{panel.description}</p>
            <div className="sol-stats">
              {panel.stats.map((stat) => (
                <div key={stat.label}>
                  <div className="sol-stat-num">{stat.num}</div>
                  <div className="sol-stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="sol-features">
            {panel.features.map((f) => (
              <div key={f.title} className="sol-feature">
                <div className="sol-feature-icon">{f.icon}</div>
                <div>
                  <div className="sol-feature-title">{f.title}</div>
                  <div className="sol-feature-desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
