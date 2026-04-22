import { randomBytes } from 'node:crypto'

// Per-test trace ID. Every HTTP request, browser page, DB row, R2 object, and
// Worker log line downstream of this test is tagged with the same id so the
// pipeline is reconstructable end-to-end from the evidence archive.
//
// Format mirrors ULID-ish: 26 chars, base32 Crockford. Not cryptographic; just
// monotone-per-ms and opaque. Runs under crypto.randomBytes (Node's CSPRNG).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function toBase32(buf: Uint8Array): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const byte of buf) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += CROCKFORD[(acc >> bits) & 31]
    }
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31]
  return out
}

export function traceId(prefix = 'e2e'): string {
  const ts = Date.now()
  const tsBytes = new Uint8Array(6)
  tsBytes[0] = (ts / 0x10000000000) & 0xff
  tsBytes[1] = (ts / 0x100000000) & 0xff
  tsBytes[2] = (ts / 0x1000000) & 0xff
  tsBytes[3] = (ts / 0x10000) & 0xff
  tsBytes[4] = (ts / 0x100) & 0xff
  tsBytes[5] = ts & 0xff
  const rand = randomBytes(10)
  const combined = new Uint8Array(16)
  combined.set(tsBytes, 0)
  combined.set(rand, 6)
  return `${prefix}_${toBase32(combined).slice(0, 26)}`
}
