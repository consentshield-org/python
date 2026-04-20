import type { ReactNode } from 'react'

export interface LegalMeta {
  label: string
  value: string
}

export interface TocItem {
  id: string
  label: ReactNode
}

// Shared hero + TOC-on-left + body-on-right layout used by Terms, Privacy,
// and the DPA/EU Addendum pages. The `<article className="legal-content">`
// wrapper applies the auto-numbered section counter (h2::before uses
// `counter(section)`), so callers pass child <section> elements with `id`
// matching the TOC href anchors.
export function LegalLayout({
  eyebrow = 'Legal',
  title,
  lede,
  meta,
  tocTitle = 'Contents',
  tocItems,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  lede: ReactNode
  meta: LegalMeta[]
  tocTitle?: string
  tocItems: TocItem[]
  children: ReactNode
}) {
  return (
    <>
      <section className="legal-hero">
        <div className="legal-hero-inner">
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="display-md">{title}</h1>
          <p className="lede">{lede}</p>
          <div className="legal-meta">
            {meta.map((m) => (
              <div key={m.label} className="legal-meta-item">
                <span className="legal-meta-label">{m.label}</span>
                <span className="legal-meta-value">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="legal-body">
        <div className="legal-body-inner">
          <nav className="legal-toc" aria-label={tocTitle}>
            <div className="legal-toc-title">{tocTitle}</div>
            <ol>
              {tocItems.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.label}</a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="legal-content">{children}</article>
        </div>
      </section>
    </>
  )
}
