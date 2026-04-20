import type { LegalBlock, LegalDocument, LegalSection } from './types'

// LegalDocument → Markdown. Inline formatting is authored as Markdown
// already (see md-inline.ts), so paragraphs / list items / note bodies
// pass through. Block-level constructs (headings, tables, contact
// blocks) get standard CommonMark-ish emission. Output is deterministic
// so the generated files round-trip cleanly in version diffs.

export function serializeToMarkdown(doc: LegalDocument): string {
  const out: string[] = []

  out.push(`# ${stripTrailingPeriod(doc.title)}`)
  out.push('')
  out.push(doc.lede)
  out.push('')

  // Metadata as a definition-style table.
  out.push('| | |')
  out.push('|---|---|')
  for (const m of doc.meta) {
    out.push(`| **${m.label}** | ${m.value} |`)
  }
  out.push('')

  // TOC.
  out.push('## Contents')
  out.push('')
  for (const t of doc.tocItems) {
    out.push(`- [${t.label}](#${t.id})`)
  }
  out.push('')

  if (doc.intro) {
    for (const p of doc.intro) {
      out.push(p)
      out.push('')
    }
  }

  for (const s of doc.sections) {
    out.push(...renderSection(s))
  }

  if (doc.addendum) {
    const a = doc.addendum
    out.push('---')
    out.push('')
    out.push(`# ${a.label}`)
    out.push('')

    if (a.tocItems.length > 0) {
      out.push(`## ${a.tocTitle}`)
      out.push('')
      for (const t of a.tocItems) {
        out.push(`- [${t.label}](#${t.id})`)
      }
      out.push('')
    }

    if (a.intro) {
      for (const p of a.intro) {
        out.push(p)
        out.push('')
      }
    }

    for (const s of a.sections) {
      out.push(...renderSection(s))
    }
  }

  return out.join('\n').trimEnd() + '\n'
}

function renderSection(s: LegalSection): string[] {
  const out: string[] = []
  out.push(`<a id="${s.id}"></a>`)
  out.push(`## ${s.title}`)
  out.push('')
  for (const b of s.blocks) {
    out.push(...renderBlock(b))
  }
  return out
}

function renderBlock(b: LegalBlock): string[] {
  switch (b.kind) {
    case 'h3':
      return [`### ${b.text}`, '']
    case 'p':
      return [b.md, '']
    case 'ul':
      return [...b.items.map((i) => `- ${i}`), '']
    case 'note':
      // Blockquote. Preserves the visual emphasis in rendered MD.
      return [...b.md.split('\n').map((line) => `> ${line}`), '']
    case 'contact': {
      const rows: string[] = [`### ${b.heading}`, '']
      rows.push('| | |')
      rows.push('|---|---|')
      for (const r of b.rows) {
        // Escape pipes in values so they don't break the row.
        rows.push(`| **${r.label}** | ${r.value.replace(/\|/g, '\\|')} |`)
      }
      rows.push('')
      return rows
    }
    case 'subprocTable': {
      const rows: string[] = []
      rows.push('| Sub-processor | Activity | Location |')
      rows.push('|---|---|---|')
      for (const r of b.rows) {
        rows.push(
          `| **${r.name}** | ${escapePipes(r.activity)} | ${escapePipes(r.location)} |`,
        )
      }
      rows.push('')
      return rows
    }
    case 'sccTable': {
      const rows: string[] = []
      rows.push('| SCC Clause | Election / parameter |')
      rows.push('|---|---|')
      for (const r of b.rows) {
        rows.push(
          `| **${escapePipes(r.clause)}** | ${escapePipes(r.value)} |`,
        )
      }
      rows.push('')
      return rows
    }
  }
}

function escapePipes(s: string): string {
  return s.replace(/\|/g, '\\|')
}

function stripTrailingPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s
}
