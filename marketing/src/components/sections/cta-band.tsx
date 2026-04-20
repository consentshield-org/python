import type { ReactNode } from 'react'

// Reusable CTA band section — used by home, product, depa, solutions pages.
// Each page supplies its own eyebrow + title + body + action row, and
// optionally a `meta` row below the actions (DEPA uses it for PDF
// size/page metadata).
export function CtaBand({
  eyebrow,
  title,
  body,
  children,
  meta,
}: {
  eyebrow: string
  title: ReactNode
  body: ReactNode
  children: ReactNode
  meta?: ReactNode
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
        {meta ? (
          <div
            style={{
              marginTop: 14,
              fontSize: '12.5px',
              color: 'var(--ink-3)',
              display: 'flex',
              gap: 14,
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>
    </section>
  )
}
