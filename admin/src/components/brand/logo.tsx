// ConsentShield brand assets — ADR-0026 Sprint 4.1 design-foundation.
//
// Source of truth: docs/design/screen designs and ux/consentshield-logos-v2.pdf.
//
// - LogoIcon: the 28×28 sidebar / 16×16 favicon / 120×120 app icon shield.
//   Rounded-square background with inner shield + white checkmark.
// - Wordmark: Satoshi Bold 700 / -0.04em, "Consent" in Navy + "Shield" in Teal
//   (or Teal Bright on dark).
// - Tagline: DM Sans Medium 500, 10px, 2px tracking, uppercase, Slate.
// - FullLogo: icon + wordmark + tagline laid out horizontally.

import type { ReactElement } from 'react'

type Variant =
  | 'primary' // navy rounded-sq + teal shield + white check (default)
  | 'gradient' // navy→teal rounded-sq gradient + teal-mid shield + white check
  | 'teal-inverse' // teal rounded-sq + white shield + teal check
  | 'mono-navy' // outlined shield, navy stroke, no bg
  | 'mono-white' // outlined shield, white stroke, no bg
  | 'standalone' // teal shield + white check, transparent bg (no rounded-sq)

interface LogoIconProps {
  size?: number
  variant?: Variant
  className?: string
  ariaLabel?: string
}

export function LogoIcon({
  size = 28,
  variant = 'primary',
  className,
  ariaLabel = 'ConsentShield',
}: LogoIconProps): ReactElement {
  // Unique id so multiple icons on the same page don't collide with their
  // gradient defs. Scoped to this instance.
  const gradId = `cs-grad-${variant}-${size}`

  const bg =
    variant === 'primary'
      ? { fill: '#0F2D5B' }
      : variant === 'teal-inverse'
        ? { fill: '#0D7A6B' }
        : variant === 'gradient'
          ? { fill: `url(#${gradId})` }
          : { fill: 'transparent' }

  const shieldFill =
    variant === 'primary'
      ? '#0D7A6B'
      : variant === 'gradient'
        ? '#14A090'
        : variant === 'teal-inverse'
          ? '#FFFFFF'
          : 'transparent'

  const shieldStroke =
    variant === 'mono-navy'
      ? '#0F2D5B'
      : variant === 'mono-white'
        ? '#FFFFFF'
        : 'none'

  const checkStroke =
    variant === 'teal-inverse'
      ? '#0D7A6B'
      : variant === 'mono-navy'
        ? '#0F2D5B'
        : variant === 'mono-white'
          ? '#FFFFFF'
          : '#FFFFFF'

  const hasRoundedBg = variant === 'primary' || variant === 'teal-inverse' || variant === 'gradient'

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      {variant === 'gradient' ? (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#091E3E" />
            <stop offset="1" stopColor="#0D7A6B" />
          </linearGradient>
        </defs>
      ) : null}

      {hasRoundedBg ? (
        <rect x="0" y="0" width="120" height="120" rx="26" ry="26" {...bg} />
      ) : null}

      {/* Inner shield — classic shield silhouette, tapered to a point at the bottom. */}
      <path
        d="M60 28 Q 86 30 88 36 L 88 64 Q 88 84 60 97 Q 32 84 32 64 L 32 36 Q 34 30 60 28 Z"
        fill={shieldFill}
        stroke={shieldStroke}
        strokeWidth={variant === 'mono-navy' || variant === 'mono-white' ? 4 : 0}
      />

      {/* Checkmark */}
      <path
        d="M46 62 L56 72 L76 52"
        fill="none"
        stroke={checkStroke}
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type WordmarkTheme = 'light' | 'dark'

interface WordmarkProps {
  theme?: WordmarkTheme
  size?: number // font size in px; the "COMPLIANCE ENGINE" tagline scales proportionally
  tagline?: string | null // null hides it
  className?: string
}

export function Wordmark({
  theme = 'light',
  size = 22,
  tagline = 'COMPLIANCE ENGINE',
  className,
}: WordmarkProps): ReactElement {
  const consentColor = theme === 'light' ? '#0F2D5B' : 'rgba(255,255,255,0.6)'
  const shieldColor = theme === 'light' ? '#0D7A6B' : '#34D399'
  const taglineColor = theme === 'light' ? '#94A3B8' : 'rgba(255,255,255,0.45)'
  const taglineSize = Math.max(9, Math.round(size * 0.45))

  return (
    <div className={className} style={{ lineHeight: 1 }}>
      <span
        style={{
          fontFamily: 'var(--font-brand)',
          fontWeight: 700,
          fontSize: `${size}px`,
          letterSpacing: '-0.04em',
          color: consentColor,
        }}
      >
        Consent
      </span>
      <span
        style={{
          fontFamily: 'var(--font-brand)',
          fontWeight: 700,
          fontSize: `${size}px`,
          letterSpacing: '-0.04em',
          color: shieldColor,
        }}
      >
        Shield
      </span>
      {tagline ? (
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 500,
            fontSize: `${taglineSize}px`,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: taglineColor,
            marginTop: `${Math.round(size * 0.25)}px`,
          }}
        >
          {tagline}
        </div>
      ) : null}
    </div>
  )
}

interface FullLogoProps {
  iconSize?: number
  textSize?: number
  theme?: WordmarkTheme
  tagline?: string | null
  iconVariant?: Variant
  className?: string
  gap?: number
}

export function FullLogo({
  iconSize = 40,
  textSize = 22,
  theme = 'light',
  tagline = 'COMPLIANCE ENGINE',
  iconVariant,
  className,
  gap = 12,
}: FullLogoProps): ReactElement {
  const resolvedVariant: Variant =
    iconVariant ?? (theme === 'dark' ? 'gradient' : 'primary')

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: `${gap}px` }}
    >
      <LogoIcon size={iconSize} variant={resolvedVariant} />
      <Wordmark theme={theme} size={textSize} tagline={tagline} />
    </div>
  )
}
