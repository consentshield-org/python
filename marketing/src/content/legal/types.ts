// Typed content model for legal documents (terms, privacy, dpa).
// Each document is authored once and rendered by:
//   · src/components/sections/legal-document.tsx  — JSX for the web page
//   · scripts/generate-downloads.ts                — Markdown/PDF/DOCX
// Inline formatting uses a constrained Markdown dialect: **bold**, *em*,
// [text](url). Plain text otherwise. The parser lives next to the
// renderer and the serializers so the shape is authoritative.

export type LegalBlock =
  | { kind: 'h3'; text: string }
  | { kind: 'p'; md: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'note'; md: string }
  | {
      kind: 'contact'
      heading: string
      rows: Array<{ label: string; value: string }>
    }
  | {
      kind: 'subprocTable'
      rows: Array<{ name: string; activity: string; location: string }>
    }
  | {
      kind: 'sccTable'
      rows: Array<{ clause: string; value: string }>
    }

export interface LegalSection {
  id: string
  title: string
  blocks: LegalBlock[]
}

export interface LegalMeta {
  label: string
  value: string
}

export interface LegalTocItem {
  id: string
  label: string
}

export interface LegalAddendum {
  label: string
  tocTitle: string
  tocItems: LegalTocItem[]
  articleId?: string
  intro?: string[]
  sections: LegalSection[]
}

export interface LegalDocument {
  slug: 'terms' | 'privacy' | 'dpa'
  title: string
  lede: string
  meta: LegalMeta[]
  tocItems: LegalTocItem[]
  intro?: string[]
  sections: LegalSection[]
  addendum?: LegalAddendum
}
