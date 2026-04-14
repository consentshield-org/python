// Signed callback URL utilities for deletion receipts.
// HMAC-SHA256(receipt_id, DELETION_CALLBACK_SECRET)

import { createHmac } from 'node:crypto'

export function signCallback(receiptId: string): string {
  const secret = process.env.DELETION_CALLBACK_SECRET
  if (!secret) throw new Error('DELETION_CALLBACK_SECRET must be set')
  return createHmac('sha256', secret).update(receiptId).digest('hex')
}

export function verifyCallback(receiptId: string, signature: string): boolean {
  const secret = process.env.DELETION_CALLBACK_SECRET
  if (!secret) return false
  const expected = createHmac('sha256', secret).update(receiptId).digest('hex')
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}

export function buildCallbackUrl(receiptId: string, appUrl?: string): string {
  const base = appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return `${base}/api/v1/deletion-receipts/${receiptId}?sig=${signCallback(receiptId)}`
}
