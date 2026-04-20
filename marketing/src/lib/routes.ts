// Shared route definitions for <Nav/> + <Footer/>.
// Mirrors the `data-nav` targets in docs/design/screen designs and ux/
// marketing-site/consentshield-site-v2.html.
export type RouteKey =
  | 'home'
  | 'product'
  | 'depa'
  | 'solutions'
  | 'pricing'
  | 'contact'
  | 'terms'
  | 'privacy'
  | 'dpa'

export interface Route {
  key: RouteKey
  href: string
  label: string
}

export const ROUTES: Record<RouteKey, Route> = {
  home: { key: 'home', href: '/', label: 'Home' },
  product: { key: 'product', href: '/product', label: 'Product' },
  depa: { key: 'depa', href: '/depa', label: 'DEPA' },
  solutions: { key: 'solutions', href: '/solutions', label: 'Solutions' },
  pricing: { key: 'pricing', href: '/pricing', label: 'Pricing' },
  contact: { key: 'contact', href: '/contact', label: 'Partners' },
  terms: { key: 'terms', href: '/terms', label: 'Terms of Service' },
  privacy: { key: 'privacy', href: '/privacy', label: 'Privacy Policy' },
  dpa: { key: 'dpa', href: '/dpa', label: 'DPA & EU Addendum' },
}

export const NAV_LINKS: RouteKey[] = [
  'product',
  'depa',
  'solutions',
  'pricing',
  'contact',
]

export const DOWNLOAD_BRIEF = {
  pdf: '/downloads/ConsentShield-Architecture-Brief.pdf',
  docx: '/downloads/ConsentShield-Architecture-Brief.docx',
  md: '/downloads/ConsentShield-Architecture-Brief.md',
} as const

// Legal download packets — regenerated on every build from
// src/content/legal/*.ts via scripts/generate-downloads.ts.
export const DOWNLOAD_LEGAL = {
  terms: {
    pdf: '/downloads/terms.pdf',
    docx: '/downloads/terms.docx',
    md: '/downloads/terms.md',
  },
  privacy: {
    pdf: '/downloads/privacy.pdf',
    docx: '/downloads/privacy.docx',
    md: '/downloads/privacy.md',
  },
  dpa: {
    pdf: '/downloads/dpa.pdf',
    docx: '/downloads/dpa.docx',
    md: '/downloads/dpa.md',
  },
} as const
