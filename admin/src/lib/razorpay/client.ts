// ADR-0034 Sprint 2.2 — Razorpay REST client for the admin app.
//
// Minimal typed wrapper over the two endpoints we actually need from the
// admin surface:
//
//   issueRefund   — POST /v1/payments/:payment_id/refund
//   subscriptionDashboardUrl — composes the Razorpay dashboard link for
//                              a subscription, used by the "Retry now"
//                              button (Razorpay handles charge retries
//                              via its own automatic policy; there is
//                              no direct retry-now REST endpoint).
//
// Rule 15-compatible: zero npm deps. Uses fetch + Basic auth with the
// key_id:key_secret pair that Vercel provides via env vars.
//
// The client throws on missing env instead of silently falling back;
// the admin Server Action surfaces the error to the operator.

const RAZORPAY_BASE_URL = 'https://api.razorpay.com'

export interface RazorpayRefundResponse {
  id: string
  entity: 'refund'
  amount: number
  currency: string
  payment_id: string
  status: 'pending' | 'processed' | 'failed'
  speed_processed?: string
  notes?: Record<string, string>
  created_at: number
}

export interface RazorpayErrorPayload {
  error: {
    code: string
    description: string
    source?: string
    step?: string
    reason?: string
  }
}

export class RazorpayEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RazorpayEnvError'
  }
}

export class RazorpayApiError extends Error {
  readonly status: number
  readonly payload: RazorpayErrorPayload | string

  constructor(status: number, payload: RazorpayErrorPayload | string) {
    super(
      typeof payload === 'string'
        ? `Razorpay ${status}: ${payload}`
        : `Razorpay ${status}: ${payload.error.description} (${payload.error.code})`,
    )
    this.name = 'RazorpayApiError'
    this.status = status
    this.payload = payload
  }

  summary(): string {
    if (typeof this.payload === 'string') return this.payload
    return this.payload.error.description || this.payload.error.code
  }
}

function credentials(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET
  if (!keyId || !keySecret) {
    throw new RazorpayEnvError(
      'RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set on the admin Vercel project.',
    )
  }
  return { keyId, keySecret }
}

function authHeader(keyId: string, keySecret: string): string {
  // Node and Web both have Buffer/btoa; this runs in the Next.js
  // Node server runtime.
  const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  return `Basic ${token}`
}

async function razorpayFetch<T>(
  path: string,
  init: RequestInit & { method: 'POST' | 'GET' },
): Promise<T> {
  const { keyId, keySecret } = credentials()
  const res = await fetch(`${RAZORPAY_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: authHeader(keyId, keySecret),
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    try {
      throw new RazorpayApiError(res.status, JSON.parse(text) as RazorpayErrorPayload)
    } catch (e) {
      if (e instanceof RazorpayApiError) throw e
      throw new RazorpayApiError(res.status, text)
    }
  }

  return (await res.json()) as T
}

/**
 * Issue a refund against a captured Razorpay payment. Amount is in paise.
 * Notes are attached to the refund on the Razorpay side and echo back on
 * the webhook; use them to correlate with our refunds row id.
 *
 * Razorpay accepts partial refunds as long as the total refunded across
 * all calls does not exceed the captured amount.
 */
export async function issueRefund(params: {
  paymentId: string
  amountPaise: number
  notes?: Record<string, string>
}): Promise<RazorpayRefundResponse> {
  if (!params.paymentId) {
    throw new Error('paymentId required')
  }
  if (!Number.isInteger(params.amountPaise) || params.amountPaise <= 0) {
    throw new Error('amountPaise must be a positive integer')
  }
  return razorpayFetch<RazorpayRefundResponse>(
    `/v1/payments/${encodeURIComponent(params.paymentId)}/refund`,
    {
      method: 'POST',
      body: JSON.stringify({
        amount: params.amountPaise,
        notes: params.notes ?? {},
      }),
    },
  )
}

/**
 * Dashboard URL for a Razorpay subscription. Used by the "Retry now"
 * button on the Payment Failures tab — Razorpay has no first-class REST
 * endpoint to force a retry of a subscription charge (retries run on
 * the automatic policy configured on the plan), so the most useful
 * affordance for the operator is a deep-link into the dashboard.
 */
export function subscriptionDashboardUrl(subscriptionId: string): string {
  return `https://dashboard.razorpay.com/app/subscriptions/${encodeURIComponent(subscriptionId)}`
}

export function isRazorpayEnvReady(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
}

// ============================================================================
// ADR-0052 Sprint 1.2 — Dispute contest + Documents APIs.
// ============================================================================

export interface RazorpayDocument {
  id: string
  entity: 'document'
  purpose: string
  name: string
  mime_type: string
  size: number
  created_at: number
}

export interface RazorpayDisputeResponse {
  id: string
  entity: 'dispute'
  payment_id: string
  amount: number
  currency: string
  amount_deducted?: number
  reason_code?: string
  respond_by?: number
  status: 'open' | 'under_review' | 'won' | 'lost' | 'closed'
  phase?: string
  evidence?: Record<string, unknown>
  created_at: number
}

export interface DisputeEvidenceInput {
  /**
   * Total amount being contested, in paise. Usually the full disputed amount.
   */
  amount: number
  /**
   * Summary text — why this dispute is invalid. Max 1000 chars per Razorpay.
   * Rule 3 reminder: operator-authored; MUST NOT contain customer PII.
   */
  summary: string
  /**
   * Array of Razorpay document_ids (from uploadDocument()) that back up the
   * contest. These can go under any of Razorpay's evidence slots — we use
   * `uncategorized_file` for our bundled ZIP, which is the broadest slot.
   */
  uncategorized_file?: string[]
  /**
   * Customer email address — required by some dispute categories. Optional
   * at our level; Razorpay surfaces a validation error if missing.
   */
  customer_email_address?: string
  /**
   * Optional: billing address, service date, cancellation policy refs, etc.
   * Map to Razorpay's evidence fields directly if the operator supplies them.
   */
  billing_address?: string
  service_date?: string
}

/**
 * Upload a file to Razorpay as a `document` (used for dispute evidence).
 * Multipart request — `file` is a Buffer, `filename` + `contentType` drive
 * the multipart part headers. Returns the Razorpay document id that the
 * contest API then references.
 */
export async function uploadDocument(params: {
  file: Buffer
  filename: string
  contentType: string
  purpose?: string  // defaults to 'dispute_evidence'
}): Promise<RazorpayDocument> {
  const { keyId, keySecret } = credentials()

  const boundary = `----ConsentShieldBoundary${Date.now().toString(36)}`
  const crlf = '\r\n'
  const header =
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="file"; filename="${params.filename}"${crlf}` +
    `Content-Type: ${params.contentType}${crlf}${crlf}`
  const purposeField =
    `${crlf}--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="purpose"${crlf}${crlf}` +
    (params.purpose ?? 'dispute_evidence')
  const trailer = `${crlf}--${boundary}--${crlf}`

  const body = Buffer.concat([
    Buffer.from(header, 'utf8'),
    params.file,
    Buffer.from(purposeField, 'utf8'),
    Buffer.from(trailer, 'utf8'),
  ])

  const res = await fetch(`${RAZORPAY_BASE_URL}/v1/documents`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(keyId, keySecret),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
    cache: 'no-store',
  })

  if (!res.ok) {
    const text = await res.text()
    try {
      throw new RazorpayApiError(res.status, JSON.parse(text) as RazorpayErrorPayload)
    } catch (e) {
      if (e instanceof RazorpayApiError) throw e
      throw new RazorpayApiError(res.status, text)
    }
  }

  return (await res.json()) as RazorpayDocument
}

/**
 * Submit a dispute contest to Razorpay. Moves the dispute to `under_review`
 * on their side. `action: 'draft'` is also supported for preview / save-only.
 */
export async function contestDispute(params: {
  razorpayDisputeId: string
  evidence: DisputeEvidenceInput
  action: 'draft' | 'submit'
}): Promise<RazorpayDisputeResponse> {
  if (!params.razorpayDisputeId) {
    throw new Error('razorpayDisputeId required')
  }
  if (!params.evidence.summary || params.evidence.summary.length < 20) {
    throw new Error('evidence.summary must be at least 20 characters')
  }
  if (params.evidence.summary.length > 1000) {
    throw new Error('evidence.summary cannot exceed 1000 characters (Razorpay limit)')
  }
  if (!Number.isInteger(params.evidence.amount) || params.evidence.amount <= 0) {
    throw new Error('evidence.amount must be a positive integer (paise)')
  }

  return razorpayFetch<RazorpayDisputeResponse>(
    `/v1/disputes/${encodeURIComponent(params.razorpayDisputeId)}/contest`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...params.evidence,
        action: params.action,
      }),
    },
  )
}
