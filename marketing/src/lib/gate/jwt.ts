// HS256 sign + verify using Web Crypto. ADR-0502 Sprint 1.1.
//
// Zero external dep — `crypto.subtle` is native to both the Vercel Node
// and Edge runtimes (Edge runtime is what the Next.js middleware ships
// on by default, and it cannot import `node:crypto`). We use the global
// `crypto` rather than `node:crypto` so this module loads cleanly in
// both runtimes; same reason we avoid `Buffer` in favour of `btoa`/
// `atob`. JWT envelope is hand-rolled rather than pulling `jose`
// because the marketing dependency surface stays flat (CLAUDE rule 16).

const HEADER = { alg: 'HS256', typ: 'JWT' } as const
const HEADER_B64 = base64UrlEncode(stringToBytes(JSON.stringify(HEADER)))

export interface JwtPayload {
  // Standard claims we use.
  iat: number // issued-at (unix seconds)
  exp: number // expiry (unix seconds)
  // Caller-defined extras. Keep payloads small — cookies have a 4 KB ceiling.
  [key: string]: unknown
}

export async function sign(payload: JwtPayload, secret: string): Promise<string> {
  const payloadB64 = base64UrlEncode(stringToBytes(JSON.stringify(payload)))
  const signingInput = `${HEADER_B64}.${payloadB64}`
  const sig = await hmacSha256(signingInput, secret)
  return `${signingInput}.${sig}`
}

export async function verify<T extends JwtPayload = JwtPayload>(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
): Promise<T> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new JwtError('malformed', 'expected three segments')
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string]
  if (headerB64 !== HEADER_B64) throw new JwtError('header_mismatch', 'unexpected header')
  const expected = await hmacSha256(`${headerB64}.${payloadB64}`, secret)
  if (!constantTimeEqual(expected, sigB64)) throw new JwtError('signature', 'signature mismatch')
  let payload: T
  try {
    payload = JSON.parse(bytesToString(base64UrlDecode(payloadB64))) as T
  } catch {
    throw new JwtError('malformed', 'payload not JSON')
  }
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new JwtError('expired', 'token past exp')
  }
  return payload
}

export class JwtError extends Error {
  constructor(public readonly code: 'malformed' | 'header_mismatch' | 'signature' | 'expired', msg: string) {
    super(msg)
    this.name = 'JwtError'
  }
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return base64UrlEncode(new Uint8Array(sigBuf))
}

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  const bin = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
