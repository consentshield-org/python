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
