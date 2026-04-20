import { LegalLayout } from './legal-layout'
import { renderInline } from '@/content/legal/md-inline'
import type {
  LegalBlock,
  LegalDocument,
  LegalSection,
} from '@/content/legal/types'

// ─── Renderer for structured legal documents ─────────────────────────────
// Takes a LegalDocument authored in src/content/legal/*.ts and renders the
// same JSX the hand-written pages were emitting before Sprint 3.1. The
// downloads generator (scripts/generate-downloads.ts) reads the same
// source data to produce MD/PDF/DOCX from the same tree.

export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <>
      <LegalLayout
        title={doc.title}
        lede={doc.lede}
        meta={doc.meta}
        tocItems={doc.tocItems}
      >
        {doc.intro?.map((p, i) => (
          <IntroParagraph key={i} md={p} />
        ))}
        {doc.sections.map((s) => (
          <SectionView key={s.id} section={s} />
        ))}
      </LegalLayout>

      {doc.addendum ? <AddendumView doc={doc} /> : null}
    </>
  )
}

function AddendumView({ doc }: { doc: LegalDocument }) {
  const a = doc.addendum!
  return (
    <>
      <div className="dpa-divider">
        <span className="dpa-divider-label">{a.label}</span>
      </div>

      <section className="legal-body" style={{ paddingTop: 16 }}>
        <div className="legal-body-inner">
          <nav className="legal-toc" aria-label={a.tocTitle}>
            <div className="legal-toc-title">{a.tocTitle}</div>
            <ol>
              {a.tocItems.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.label}</a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="legal-content" id={a.articleId}>
            {a.intro?.map((p, i) => (
              <IntroParagraph key={i} md={p} condensed />
            ))}
            {a.sections.map((s) => (
              <SectionView key={s.id} section={s} />
            ))}
          </article>
        </div>
      </section>
    </>
  )
}

function IntroParagraph({
  md,
  condensed,
}: {
  md: string
  condensed?: boolean
}) {
  return (
    <p
      style={{
        fontSize: condensed ? 15 : 15,
        color: 'var(--ink-2)',
        lineHeight: 1.65,
        marginBottom: condensed ? 28 : 36,
      }}
    >
      {renderInline(md)}
    </p>
  )
}

function SectionView({ section }: { section: LegalSection }) {
  return (
    <section id={section.id}>
      <h2>{section.title}</h2>
      {section.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </section>
  )
}

function BlockView({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case 'h3':
      return <h3>{block.text}</h3>
    case 'p':
      return <p>{renderInline(block.md)}</p>
    case 'ul':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
    case 'note':
      return <div className="legal-note">{renderInline(block.md)}</div>
    case 'contact':
      return (
        <div className="legal-contact-block">
          <h3>{block.heading}</h3>
          {block.rows.map((r, i) => (
            <div key={i} className="legal-contact-row">
              <span className="label">{r.label}</span>
              <span>{renderInline(r.value)}</span>
            </div>
          ))}
        </div>
      )
    case 'subprocTable':
      return <SubprocTable rows={block.rows} />
    case 'sccTable':
      return <SccTable rows={block.rows} />
  }
}

const SUBPROC_GRID = { gridTemplateColumns: '1.4fr 1.2fr 1fr' }
const SCC_GRID = { gridTemplateColumns: '1fr 1.4fr' }

function SubprocTable({
  rows,
}: {
  rows: Array<{ name: string; activity: string; location: string }>
}) {
  return (
    <div
      className="legal-note"
      style={{
        padding: 0,
        background: 'white',
        border: '1px solid var(--line)',
        borderLeft: '3px solid var(--teal)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line-soft)',
          fontFamily: 'var(--mono)',
          fontSize: '10.5px',
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          display: 'grid',
          ...SUBPROC_GRID,
          gap: 14,
          fontWeight: 600,
        }}
      >
        <span>Sub-processor</span>
        <span>Activity</span>
        <span>Location</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.name}
          style={{
            padding: '12px 16px',
            display: 'grid',
            ...SUBPROC_GRID,
            gap: 14,
            fontSize: '12.5px',
            borderBottom:
              i === rows.length - 1
                ? undefined
                : '1px solid var(--line-soft)',
          }}
        >
          <strong style={{ color: 'var(--navy)' }}>{r.name}</strong>
          <span style={{ color: 'var(--ink-2)' }}>{r.activity}</span>
          <span
            style={{
              fontFamily: 'var(--mono)',
              color: 'var(--ink-3)',
              fontSize: 11,
            }}
          >
            {r.location}
          </span>
        </div>
      ))}
    </div>
  )
}

function SccTable({
  rows,
}: {
  rows: Array<{ clause: string; value: string }>
}) {
  return (
    <div
      className="legal-note"
      style={{
        padding: 0,
        background: 'white',
        borderLeft: '3px solid var(--teal)',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line-soft)',
          fontFamily: 'var(--mono)',
          fontSize: '10.5px',
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          display: 'grid',
          ...SCC_GRID,
          gap: 14,
          fontWeight: 600,
        }}
      >
        <span>SCC Clause</span>
        <span>Election / parameter</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.clause}
          style={{
            padding: '10px 16px',
            display: 'grid',
            ...SCC_GRID,
            gap: 14,
            fontSize: '12.5px',
            borderBottom:
              i === rows.length - 1
                ? undefined
                : '1px solid var(--line-soft)',
          }}
        >
          <span style={{ color: 'var(--navy)', fontWeight: 600 }}>
            {r.clause}
          </span>
          <span style={{ color: 'var(--ink-2)' }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}
