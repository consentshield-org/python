// ADR-0050 Sprint 2.2 — Resend invoice-email dispatch (admin-side).
//
// Sends the invoice PDF as an attachment to the account's billing email.
// Returns Resend's message id so the caller can stamp it on the invoice
// row via admin.billing_stamp_invoice_email. Uses the REST API directly;
// no @resend/node dependency (per Rule 15).

interface SendInvoiceEmailInput {
  to: string
  accountName: string
  invoiceNumber: string
  totalPaise: number
  currency: string
  dueDate: string
  pdfBytes: Uint8Array
  issuerLegalName: string
}

export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<{ messageId: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not set')
  }
  if (!from) {
    throw new Error('RESEND_FROM not set')
  }

  const totalFormatted = `${formatIndianRupees(Math.floor(input.totalPaise / 100))}.${(input.totalPaise % 100).toString().padStart(2, '0')}`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${input.issuerLegalName} <${from}>`,
      to: [input.to],
      subject: `Invoice ${input.invoiceNumber} — ${input.currency} ${totalFormatted} due ${input.dueDate}`,
      html: renderInvoiceEmailHtml(input, totalFormatted),
      text: renderInvoiceEmailText(input, totalFormatted),
      attachments: [
        {
          filename: `${input.invoiceNumber.replace(/[^A-Za-z0-9/_-]/g, '_')}.pdf`,
          content: Buffer.from(input.pdfBytes).toString('base64'),
        },
      ],
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Resend dispatch failed: ${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`)
  }

  const payload = (await resp.json()) as { id?: string }
  if (!payload.id) {
    throw new Error('Resend response missing id')
  }
  return { messageId: payload.id }
}

function renderInvoiceEmailHtml(input: SendInvoiceEmailInput, total: string): string {
  return `<p>Hello ${escape(input.accountName)},</p>
          <p>Your tax invoice <strong>${escape(input.invoiceNumber)}</strong> is attached.</p>
          <ul>
            <li><strong>Total:</strong> ${input.currency} ${total}</li>
            <li><strong>Due date:</strong> ${escape(input.dueDate)}</li>
          </ul>
          <p>If you have a question about this invoice, reply to this email.</p>
          <p style="color:#666;font-size:12px;margin-top:24px;">Sent by ${escape(input.issuerLegalName)} via ConsentShield.</p>`
}

function renderInvoiceEmailText(input: SendInvoiceEmailInput, total: string): string {
  return `Hello ${input.accountName},

Your tax invoice ${input.invoiceNumber} is attached.

Total: ${input.currency} ${total}
Due date: ${input.dueDate}

If you have a question about this invoice, reply to this email.

— ${input.issuerLegalName} via ConsentShield`
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatIndianRupees(rupees: number): string {
  const s = String(rupees)
  if (s.length <= 3) return s
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
}
