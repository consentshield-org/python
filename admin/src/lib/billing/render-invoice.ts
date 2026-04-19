// ADR-0050 Sprint 2.2 — PDFKit-based invoice renderer (admin-side).
//
// Deterministic: same inputs produce the same bytes. PDF info CreationDate
// is stamped from invoice.issue_date, not wall clock. No Date.now(), no
// Math.random(). The caller supplies all data; this file does no I/O.

import PDFDocument from 'pdfkit'

export interface IssuerForPdf {
  legal_name: string
  gstin: string
  pan: string
  registered_state_code: string
  registered_address: string
  invoice_prefix: string
  signatory_name: string
  signatory_designation: string | null
  bank_account_masked: string | null
}

export interface AccountForPdf {
  billing_legal_name: string
  billing_gstin: string | null
  billing_state_code: string
  billing_address: string
  billing_email: string
}

export interface InvoiceLineForPdf {
  description: string
  hsn_sac: string
  quantity: number
  rate_paise: number
  amount_paise: number
}

export interface InvoiceForPdf {
  invoice_number: string
  fy_year: string
  issue_date: string
  due_date: string
  period_start: string
  period_end: string
  currency: string
  line_items: InvoiceLineForPdf[]
  subtotal_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  total_paise: number
}

export interface RenderInvoiceInput {
  issuer: IssuerForPdf
  account: AccountForPdf
  invoice: InvoiceForPdf
}

export function renderInvoicePdf(input: RenderInvoiceInput): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Invoice ${input.invoice.invoice_number}`,
        Author: input.issuer.legal_name,
        Subject: `Tax invoice for ${input.account.billing_legal_name}`,
        Producer: 'ConsentShield',
        Creator: 'ConsentShield',
        CreationDate: parseCalendarDate(input.invoice.issue_date),
      },
    })

    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    doc.on('error', (err: Error) => reject(err))

    writeDocument(doc, input)
    doc.end()
  })
}

type DocLike = InstanceType<typeof PDFDocument>

function writeDocument(doc: DocLike, input: RenderInvoiceInput): void {
  const { issuer, account, invoice } = input
  const pageWidth = doc.page.width
  const margin = 50
  const contentWidth = pageWidth - margin * 2

  doc.fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', margin, margin)
  doc.fontSize(10).font('Helvetica')
     .text(`Invoice No. ${invoice.invoice_number}`, margin, margin + 24)
     .text(`FY ${invoice.fy_year}`, margin, margin + 38)

  const issuerX = margin + contentWidth / 2
  doc.fontSize(12).font('Helvetica-Bold').text(issuer.legal_name, issuerX, margin, { width: contentWidth / 2 })
  doc.fontSize(9).font('Helvetica')
    .text(issuer.registered_address, { width: contentWidth / 2 })
    .text(`GSTIN: ${issuer.gstin}`)
    .text(`PAN: ${issuer.pan}`)
    .text(`State: ${issuer.registered_state_code}`)

  const ruleY = 160
  doc.moveTo(margin, ruleY).lineTo(pageWidth - margin, ruleY).lineWidth(0.5).stroke()

  const metaTop = ruleY + 16
  doc.fontSize(10).font('Helvetica-Bold').text('Bill to', margin, metaTop)
  doc.fontSize(10).font('Helvetica')
    .text(account.billing_legal_name, margin, metaTop + 14, { width: contentWidth / 2 - 10 })
    .text(account.billing_address, { width: contentWidth / 2 - 10 })
    .text(`GSTIN: ${account.billing_gstin ?? 'Unregistered'}`)
    .text(`State: ${account.billing_state_code}`)
    .text(`Email: ${account.billing_email}`)

  const metaRightX = margin + contentWidth / 2 + 10
  doc.fontSize(10).font('Helvetica-Bold').text('Invoice details', metaRightX, metaTop)
  doc.fontSize(10).font('Helvetica')
    .text(`Issue date: ${invoice.issue_date}`, metaRightX, metaTop + 14)
    .text(`Due date: ${invoice.due_date}`)
    .text(`Period: ${invoice.period_start} to ${invoice.period_end}`)
    .text(`Currency: ${invoice.currency}`)
    .text(`Place of supply: ${account.billing_state_code}`)

  const tableTop = metaTop + 110
  drawLineItemTable(doc, invoice.line_items, tableTop, margin, contentWidth)

  const totalsTop = tableTop + 40 + invoice.line_items.length * 20 + 16
  drawTotals(doc, invoice, pageWidth - margin, totalsTop)

  const footerTop = Math.max(totalsTop + 160, doc.page.height - 180)
  doc.moveTo(margin, footerTop).lineTo(pageWidth - margin, footerTop).lineWidth(0.5).stroke()
  doc.fontSize(9).font('Helvetica')
    .text('This is a computer-generated invoice. Default HSN/SAC is 9983 (IT services) unless otherwise noted per line.',
      margin, footerTop + 10, { width: contentWidth })

  if (issuer.bank_account_masked) {
    doc.text(`Bank: ${issuer.bank_account_masked}`, margin, footerTop + 34)
  }

  doc.fontSize(10).font('Helvetica-Bold')
    .text(`For ${issuer.legal_name}`, margin + contentWidth - 220, footerTop + 60, { width: 220, align: 'right' })
  doc.fontSize(10).font('Helvetica')
    .text(issuer.signatory_name, { width: 220, align: 'right' })
  if (issuer.signatory_designation) {
    doc.text(issuer.signatory_designation, { width: 220, align: 'right' })
  }
  doc.text('Authorised signatory', { width: 220, align: 'right' })
}

function drawLineItemTable(
  doc: DocLike,
  lines: InvoiceLineForPdf[],
  top: number,
  left: number,
  width: number,
): void {
  const cols = {
    description: left,
    hsn: left + width * 0.45,
    qty: left + width * 0.6,
    rate: left + width * 0.72,
    amount: left + width * 0.88,
  }

  doc.fontSize(10).font('Helvetica-Bold')
    .text('Description', cols.description, top)
    .text('HSN/SAC', cols.hsn, top)
    .text('Qty', cols.qty, top, { width: width * 0.1, align: 'right' })
    .text('Rate', cols.rate, top, { width: width * 0.14, align: 'right' })
    .text('Amount', cols.amount, top, { width: width * 0.12, align: 'right' })

  doc.moveTo(left, top + 16).lineTo(left + width, top + 16).lineWidth(0.5).stroke()

  doc.fontSize(10).font('Helvetica')
  lines.forEach((line, i) => {
    const y = top + 22 + i * 20
    doc.text(line.description, cols.description, y, { width: width * 0.42 })
      .text(line.hsn_sac, cols.hsn, y)
      .text(String(line.quantity), cols.qty, y, { width: width * 0.1, align: 'right' })
      .text(formatPaise(line.rate_paise), cols.rate, y, { width: width * 0.14, align: 'right' })
      .text(formatPaise(line.amount_paise), cols.amount, y, { width: width * 0.12, align: 'right' })
  })
}

function drawTotals(doc: DocLike, invoice: InvoiceForPdf, rightEdge: number, top: number): void {
  const labelX = rightEdge - 260
  const valueX = rightEdge - 120
  const valueWidth = 120
  let y = top

  const line = (label: string, paise: number, bold = false): void => {
    doc.fontSize(10).font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .text(label, labelX, y, { width: 140 })
      .text(formatPaise(paise), valueX, y, { width: valueWidth, align: 'right' })
    y += 16
  }

  line('Subtotal', invoice.subtotal_paise)
  if (invoice.cgst_paise > 0 || invoice.sgst_paise > 0) {
    line('CGST @ 9%', invoice.cgst_paise)
    line('SGST @ 9%', invoice.sgst_paise)
  } else {
    line('IGST @ 18%', invoice.igst_paise)
  }
  doc.moveTo(labelX, y).lineTo(rightEdge, y).lineWidth(0.5).stroke()
  y += 6
  line(`Total (${invoice.currency})`, invoice.total_paise, true)
}

function parseCalendarDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const p = paise % 100
  return `${formatIndianRupees(rupees)}.${p.toString().padStart(2, '0')}`
}

function formatIndianRupees(rupees: number): string {
  const s = String(rupees)
  if (s.length <= 3) return s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
}
