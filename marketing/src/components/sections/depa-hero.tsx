import Link from 'next/link'
import { ROUTES } from '@/lib/routes'

export function DepaHero() {
  return (
    <section className="depa-hero">
      <div className="depa-hero-bg" aria-hidden="true" />
      <div className="depa-hero-inner">
        <div className="depa-hero-copy">
          <span className="eyebrow">DEPA-native architecture</span>
          <h1 className="display-lg">
            The only India-native compliance platform with DEPA baked into the
            data model.
          </h1>
          <p className="lede">
            DEPA — Data Empowerment and Protection Architecture — is the
            iSPIRT-designed consent infrastructure that underpins India Stack.
            It&apos;s already how ABDM&apos;s health consent artefacts work.
            It&apos;s the model DPDP is converging toward. And it&apos;s the
            structural frame every other tool in this market got wrong.
          </p>
          <div
            style={{
              marginTop: 32,
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <Link href={ROUTES.contact.href} className="btn btn-primary">
              Book a technical walkthrough
            </Link>
            <Link href={ROUTES.product.href} className="btn btn-ghost">
              See the full product
            </Link>
          </div>
        </div>
        <div className="depa-hero-mark">
          <DepaShield />
        </div>
      </div>
    </section>
  )
}

// 340x340 radial shield with 5 orbiting principle dots (P01–P05).
// Inlined verbatim from the HTML spec.
function DepaShield() {
  return (
    <svg viewBox="0 0 340 340" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="depaShield" cx="40%" cy="30%">
          <stop offset="0%" stopColor="#14A090" />
          <stop offset="100%" stopColor="#0A6458" />
        </radialGradient>
      </defs>
      <circle
        cx="170"
        cy="170"
        r="160"
        fill="none"
        stroke="#E5E9EF"
        strokeWidth="1"
      />
      <circle
        cx="170"
        cy="170"
        r="130"
        fill="none"
        stroke="#E5E9EF"
        strokeWidth="1"
        strokeDasharray="4 6"
      />
      <circle
        cx="170"
        cy="170"
        r="100"
        fill="none"
        stroke="#0D7A6B"
        strokeWidth="1"
        opacity=".3"
      />
      <path
        d="M170 85 L235 110 V175 C235 215 210 245 170 260 C130 245 105 215 105 175 V110 Z"
        fill="url(#depaShield)"
      />
      <path
        d="M170 85 L235 110 V175 C235 215 210 245 170 260 V85 Z"
        fill="#0A6458"
        opacity=".5"
      />
      <path
        d="M142 170 L165 193 L201 152"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <g>
        <circle cx="170" cy="40" r="8" fill="#0F2D5B" />
        <text
          x="170"
          y="23"
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#6B7A93"
          letterSpacing="1"
        >
          P01
        </text>
        <circle cx="294" cy="120" r="8" fill="#0F2D5B" />
        <text
          x="320"
          y="124"
          textAnchor="start"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#6B7A93"
          letterSpacing="1"
        >
          P02
        </text>
        <circle cx="248" cy="282" r="8" fill="#0F2D5B" />
        <text
          x="262"
          y="300"
          textAnchor="start"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#6B7A93"
          letterSpacing="1"
        >
          P03
        </text>
        <circle cx="92" cy="282" r="8" fill="#0F2D5B" />
        <text
          x="78"
          y="300"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#6B7A93"
          letterSpacing="1"
        >
          P04
        </text>
        <circle cx="46" cy="120" r="8" fill="#0F2D5B" />
        <text
          x="20"
          y="124"
          textAnchor="end"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#6B7A93"
          letterSpacing="1"
        >
          P05
        </text>
      </g>
    </svg>
  )
}
