import type { ReactNode } from 'react'

// Reusable CTA band section — used by home, product, depa pages.
// Each page supplies its own eyebrow + title + body + action row.
export function CtaBand({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string
  title: ReactNode
  body: ReactNode
  children: ReactNode
}) {
  return (
    <section className="cta-band">
      <div className="cta-band-inner">
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="display-md" style={{ marginTop: 14 }}>
          {title}
        </h2>
        <p>{body}</p>
        <div className="cta-band-actions">{children}</div>
      </div>
    </section>
  )
}
