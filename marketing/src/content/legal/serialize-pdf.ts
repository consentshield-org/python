import PDFDocument from 'pdfkit'
import { parseInline } from './md-inline'
import type { LegalBlock, LegalDocument, LegalSection } from './types'

// LegalDocument → PDF (Buffer).
//
// pdfkit is a streaming API — we pipe chunks into an array and resolve
// once `end` fires. Inline formatting (bold/italic/link) is rendered by
// chaining `text(..., { continued: true })` calls with a font switch in
// between. Tables are drawn manually (pdfkit has no table primitive;
// adding a plugin dep isn't justified for six tables across three docs).
//
// Brand palette — mirrors globals.css so the PDF feels consistent with
// the website it was generated from.
const COLORS = {
  navy: '#0F2D5B',
  navyDark: '#091E3E',
  teal: '#0D7A6B',
  tealBright: '#34D399',
  line: '#E5E9EF',
  ink: '#0B1A35',
  ink2: '#43506B',
  ink3: '#6B7A93',
}

const MARGIN = 64

export async function serializeToPdf(doc: LegalDocument): Promise<Buffer> {
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: MARGIN },
    info: {
      Title: stripTrailingPeriod(doc.title),
      Author: 'ConsentShield',
      Subject: stripTrailingPeriod(doc.title),
      Producer: 'ConsentShield legal downloads generator',
    },
    bufferPages: true,
  })

  const chunks: Buffer[] = []
  pdf.on('data', (c: Buffer) => chunks.push(c))

  // ─── Title + lede + meta + TOC ───────────────────────────────────
  pdf
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(COLORS.navy)
    .text(stripTrailingPeriod(doc.title))
  pdf.moveDown(0.6)

  pdf.font('Helvetica').fontSize(11).fillColor(COLORS.ink2).text(doc.lede, {
    align: 'justify',
  })
  pdf.moveDown(0.8)

  renderMetaTable(pdf, doc.meta)

  pdf.moveDown(1)
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.ink3)
    .text('CONTENTS', { characterSpacing: 1.5 })
  pdf.moveDown(0.4)
  pdf.font('Helvetica').fontSize(10).fillColor(COLORS.ink2)
  doc.tocItems.forEach((t, i) => {
    pdf.text(`${(i + 1).toString().padStart(2, '0')}.  ${t.label}`)
  })

  pdf.addPage()

  // ─── Intro paragraphs ─────────────────────────────────────────────
  if (doc.intro) {
    for (const p of doc.intro) {
      renderParagraph(pdf, p)
    }
  }

  // ─── Sections ────────────────────────────────────────────────────
  doc.sections.forEach((s, idx) => {
    renderSection(pdf, s, idx + 1)
  })

  // ─── Addendum ────────────────────────────────────────────────────
  if (doc.addendum) {
    const a = doc.addendum
    pdf.addPage()
    pdf
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(COLORS.navy)
      .text(a.label)
    pdf.moveDown(0.5)

    if (a.tocItems.length > 0) {
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(COLORS.ink3)
        .text(a.tocTitle.toUpperCase(), { characterSpacing: 1.2 })
      pdf.moveDown(0.4)
      pdf.font('Helvetica').fontSize(10).fillColor(COLORS.ink2)
      a.tocItems.forEach((t, i) => {
        pdf.text(`${(i + 1).toString().padStart(2, '0')}.  ${t.label}`)
      })
      pdf.moveDown(0.8)
    }

    if (a.intro) {
      for (const p of a.intro) {
        renderParagraph(pdf, p)
      }
    }

    a.sections.forEach((s, idx) => {
      renderSection(pdf, s, idx + 1)
    })
  }

  // ─── Footer on every page ────────────────────────────────────────
  const range = pdf.bufferedPageRange()
  const total = range.count
  for (let i = 0; i < total; i++) {
    pdf.switchToPage(range.start + i)
    const y = pdf.page.height - MARGIN / 2 - 6
    pdf.font('Helvetica').fontSize(8).fillColor(COLORS.ink3)
    pdf.text(
      `ConsentShield · ${stripTrailingPeriod(doc.title)}`,
      MARGIN,
      y,
      { width: pdf.page.width - MARGIN * 2, align: 'left', lineBreak: false },
    )
    pdf.text(`Page ${i + 1} of ${total}`, MARGIN, y, {
      width: pdf.page.width - MARGIN * 2,
      align: 'right',
      lineBreak: false,
    })
  }

  pdf.end()

  return new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.on('error', reject)
  })
}

function renderSection(
  pdf: PDFKit.PDFDocument,
  section: LegalSection,
  number: number,
) {
  pdf.moveDown(0.6)
  pdf
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.teal)
    .text(number.toString().padStart(2, '0'), { continued: true })
    .fillColor(COLORS.navy)
    .fontSize(14)
    .text(`  ${section.title}`)
  pdf.moveDown(0.4)

  for (const b of section.blocks) {
    renderBlock(pdf, b)
  }
}

function renderBlock(pdf: PDFKit.PDFDocument, block: LegalBlock) {
  switch (block.kind) {
    case 'h3':
      pdf.moveDown(0.4)
      pdf
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(COLORS.navy)
        .text(block.text)
      pdf.moveDown(0.2)
      return
    case 'p':
      renderParagraph(pdf, block.md)
      return
    case 'ul':
      for (const item of block.items) {
        pdf
          .font('Helvetica-Bold')
          .fontSize(10.5)
          .fillColor(COLORS.teal)
          .text('• ', { continued: true })
        renderInline(pdf, item, { finalLineBreak: true })
      }
      pdf.moveDown(0.3)
      return
    case 'note':
      renderNote(pdf, block.md)
      return
    case 'contact':
      renderContact(pdf, block.heading, block.rows)
      return
    case 'subprocTable':
      renderTable(
        pdf,
        ['Sub-processor', 'Activity', 'Location'],
        block.rows.map((r) => [r.name, r.activity, r.location]),
        [0.35, 0.4, 0.25],
      )
      return
    case 'sccTable':
      renderTable(
        pdf,
        ['SCC Clause', 'Election / parameter'],
        block.rows.map((r) => [r.clause, r.value]),
        [0.35, 0.65],
      )
      return
  }
}

function renderParagraph(pdf: PDFKit.PDFDocument, md: string) {
  pdf.font('Helvetica').fontSize(10.5).fillColor(COLORS.ink2)
  renderInline(pdf, md, {
    finalLineBreak: true,
    paragraphOptions: { align: 'justify' },
  })
  pdf.moveDown(0.4)
}

function renderNote(pdf: PDFKit.PDFDocument, md: string) {
  pdf.moveDown(0.3)
  const startX = pdf.x
  const startY = pdf.y
  // Indent the note body.
  pdf.fillColor(COLORS.teal)
  pdf.font('Helvetica-Bold').fontSize(11).text('▏ ', { continued: true })
  pdf.font('Helvetica').fontSize(10.5)
  renderInline(pdf, md, { finalLineBreak: true })
  // Restore x/colours.
  pdf.x = startX
  pdf.fillColor(COLORS.ink2)
  pdf.moveDown(0.3)
  void startY
}

function renderContact(
  pdf: PDFKit.PDFDocument,
  heading: string,
  rows: Array<{ label: string; value: string }>,
) {
  pdf.moveDown(0.4)
  pdf
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.navy)
    .text(heading)
  pdf.moveDown(0.2)
  for (const r of rows) {
    pdf
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.ink3)
      .text(r.label.toUpperCase(), { continued: true, characterSpacing: 1 })
    pdf.font('Helvetica').fontSize(10).fillColor(COLORS.ink2).text('   ', {
      continued: true,
      characterSpacing: 0,
    })
    renderInline(pdf, r.value, { finalLineBreak: true })
  }
  pdf.moveDown(0.4)
}

function renderMetaTable(
  pdf: PDFKit.PDFDocument,
  meta: Array<{ label: string; value: string }>,
) {
  const cols = Math.min(meta.length, 4)
  const width = pdf.page.width - MARGIN * 2
  const colW = width / cols
  const startX = pdf.x
  const startY = pdf.y
  pdf.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink3)
  meta.slice(0, cols).forEach((m, i) => {
    pdf.text(m.label.toUpperCase(), startX + colW * i, startY, {
      width: colW,
      characterSpacing: 1.2,
      lineBreak: false,
    })
  })
  pdf.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.navy)
  meta.slice(0, cols).forEach((m, i) => {
    pdf.text(m.value, startX + colW * i, startY + 14, {
      width: colW,
      lineBreak: false,
    })
  })
  pdf.y = startY + 36
  pdf.x = MARGIN
}

function renderTable(
  pdf: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widthFractions: number[],
) {
  pdf.moveDown(0.3)
  const width = pdf.page.width - MARGIN * 2
  const widths = widthFractions.map((f) => Math.floor(width * f))
  const startX = MARGIN
  let y = pdf.y

  // Header
  pdf
    .rect(startX, y, width, 22)
    .fillColor(COLORS.teal)
    .fill()
  pdf.fillColor('white').font('Helvetica-Bold').fontSize(8.5)
  let x = startX
  headers.forEach((h, i) => {
    pdf.text(h.toUpperCase(), x + 8, y + 7, {
      width: widths[i] - 16,
      characterSpacing: 1,
      lineBreak: false,
    })
    x += widths[i]
  })
  y += 22

  pdf.font('Helvetica').fontSize(9).fillColor(COLORS.ink2)
  for (const row of rows) {
    const rowHeight = estimateRowHeight(pdf, row, widths)
    if (y + rowHeight > pdf.page.height - MARGIN) {
      pdf.addPage()
      y = MARGIN
    }
    x = startX
    pdf
      .rect(startX, y, width, rowHeight)
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .stroke()
    row.forEach((cell, i) => {
      const isFirst = i === 0
      pdf
        .font(isFirst ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(isFirst ? COLORS.navy : COLORS.ink2)
        .text(cell, x + 8, y + 6, {
          width: widths[i] - 16,
          lineGap: 1,
        })
      x += widths[i]
    })
    y += rowHeight
  }

  pdf.y = y + 6
  pdf.x = MARGIN
  pdf.fillColor(COLORS.ink2)
}

function estimateRowHeight(
  pdf: PDFKit.PDFDocument,
  cells: string[],
  widths: number[],
): number {
  // pdfkit's heightOfString is the only reliable way to compute wrapped
  // text height before drawing.
  let max = 18
  cells.forEach((c, i) => {
    const h = pdf.heightOfString(c, { width: widths[i] - 16 })
    if (h + 12 > max) max = h + 12
  })
  return max
}

function renderInline(
  pdf: PDFKit.PDFDocument,
  md: string,
  opts: {
    finalLineBreak?: boolean
    paragraphOptions?: PDFKit.Mixins.TextOptions
  } = {},
) {
  const tokens = parseInline(md)
  const base = currentFont(pdf)

  tokens.forEach((tok, i) => {
    const isLast = i === tokens.length - 1
    const continued = !isLast || !opts.finalLineBreak

    let font = base
    let color = pdf.fillColor.toString()
    let link: string | undefined
    let underline = false

    switch (tok.kind) {
      case 'text':
        font = base
        break
      case 'strong':
        font = boldOf(base)
        break
      case 'em':
        font = italicOf(base)
        break
      case 'link':
        font = base
        color = COLORS.teal
        link = tok.href
        underline = true
        break
    }

    pdf.font(font).fillColor(color)
    const textOpts: PDFKit.Mixins.TextOptions = {
      continued,
      ...(opts.paragraphOptions ?? {}),
    }
    if (link) {
      ;(textOpts as unknown as { link?: string }).link = link
      textOpts.underline = underline
    }
    pdf.text(tok.value, textOpts)
    if (link) {
      // Reset underline for subsequent runs.
      pdf.text('', { continued, underline: false })
    }
  })

  // Reset to base font/colour for the next block.
  pdf.font(base).fillColor(COLORS.ink2)
}

function currentFont(pdf: PDFKit.PDFDocument): string {
  const current = (pdf as unknown as { _font?: { name?: string } })._font
  return current?.name ?? 'Helvetica'
}

function boldOf(base: string): string {
  if (base.includes('Bold')) return base
  if (base === 'Helvetica') return 'Helvetica-Bold'
  if (base === 'Helvetica-Oblique') return 'Helvetica-BoldOblique'
  return 'Helvetica-Bold'
}

function italicOf(base: string): string {
  if (base.includes('Oblique') || base.includes('Italic')) return base
  if (base === 'Helvetica') return 'Helvetica-Oblique'
  if (base === 'Helvetica-Bold') return 'Helvetica-BoldOblique'
  return 'Helvetica-Oblique'
}

function stripTrailingPeriod(s: string): string {
  return s.endsWith('.') ? s.slice(0, -1) : s
}
