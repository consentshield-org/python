import { createHmac } from 'node:crypto'

// Mirrors worker/src/hmac.ts exactly. If this file drifts from the Worker
// implementation, signed events will be rejected and the paired-positive
// E2E tests will fail — that is the intended tripwire.
//
// Contract:
//   message   = `${orgId}${propertyId}${timestamp}` (concatenation, no separators)
//   algorithm = HMAC-SHA256
//   output    = lowercase hex
//   window    = ±5 minutes (verified on the Worker side; we just stamp now())

export interface SignedEnvelope {
  org_id: string
  property_id: string
  banner_id: string
  banner_version: number
  event_type: ConsentEventType
  purposes_accepted?: string[]
  purposes_rejected?: string[]
  signature: string
  timestamp: string
}

export type ConsentEventType =
  | 'consent_given'
  | 'consent_withdrawn'
  | 'purpose_updated'
  | 'banner_dismissed'

export interface UnsignedEventInput {
  org_id: string
  property_id: string
  banner_id: string
  banner_version?: number
  event_type: ConsentEventType
  purposes_accepted?: string[]
  purposes_rejected?: string[]
}

export function computeHmac(
  orgId: string,
  propertyId: string,
  timestamp: string,
  secret: string
): string {
  const message = `${orgId}${propertyId}${timestamp}`
  return createHmac('sha256', secret).update(message).digest('hex')
}

export function signConsentEvent(
  input: UnsignedEventInput,
  secret: string,
  opts: { timestampMs?: number } = {}
): SignedEnvelope {
  const ts = String(opts.timestampMs ?? Date.now())
  const signature = computeHmac(input.org_id, input.property_id, ts, secret)
  return {
    org_id: input.org_id,
    property_id: input.property_id,
    banner_id: input.banner_id,
    banner_version: input.banner_version ?? 1,
    event_type: input.event_type,
    purposes_accepted: input.purposes_accepted,
    purposes_rejected: input.purposes_rejected,
    signature,
    timestamp: ts
  }
}

// Flip exactly one hex character of the signature. Used by the paired
// negative control to assert the Worker's HMAC check rejects tampered
// signatures. Deterministic — same input produces same output.
export function tamperSignature(envelope: SignedEnvelope): SignedEnvelope {
  const sig = envelope.signature
  const pos = 17 // arbitrary middle position; any position would do
  const ch = sig[pos]
  // Flip 0↔1, a↔b, etc. so we land on a valid hex char.
  const flipped = ch === 'a' ? 'b' : ch === '0' ? '1' : 'a'
  const mutated = sig.slice(0, pos) + flipped + sig.slice(pos + 1)
  return { ...envelope, signature: mutated }
}

// Stamp a timestamp outside the ±5 min window to exercise the drift check.
export function signWithStaleTimestamp(
  input: UnsignedEventInput,
  secret: string
): SignedEnvelope {
  // 10 minutes in the past — comfortably outside the 5-min window.
  return signConsentEvent(input, secret, { timestampMs: Date.now() - 10 * 60 * 1000 })
}
