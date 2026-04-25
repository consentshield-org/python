#!/usr/bin/env bunx tsx
/* eslint-disable no-console */
//
// ADR-1014 Phase-4 follow-up — generate pinned sigv4 test vectors.
//
// Stryker mutation testing on app/src/lib/storage/sigv4.ts requires
// known-answer test vectors. The signatures depend on the wall clock
// (formatAmzDate produces dateStamp inputs to the signing chain), so
// we capture them once with a frozen clock and pin them in
// app/tests/storage/sigv4.test.ts.
//
// Re-run this script if any sigv4 implementation detail changes
// intentionally; otherwise the existing pinned tests must hold.
//
// Usage: bunx tsx scripts/capture-sigv4-vectors.ts

import { createHash, createHmac } from 'node:crypto'

// We re-implement the vectors locally rather than importing from the
// app workspace to avoid alias-resolution gymnastics from this script.
// The implementation mirrors app/src/lib/storage/sigv4.ts exactly; the
// captured outputs are then asserted against the real implementation
// in the unit tests.

const SERVICE = 's3'

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function formatAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(SERVICE).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}
function encodeKey(key: string): string {
  return key.split('/').map((segment) => rfc3986(segment)).join('/')
}
function canonicalUriFor(bucket: string, key: string): string {
  return '/' + encodeKey(bucket) + '/' + encodeKey(key)
}

const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

// ═══════════════════════════════════════════════════════════
// FROZEN CLOCK + canonical inputs
// ═══════════════════════════════════════════════════════════
// 2026-01-15T08:00:00.000Z — chosen as a stable date in the cutoff era.
const FROZEN = new Date(Date.UTC(2026, 0, 15, 8, 0, 0))
const COMMON = {
  endpoint: 'https://accountid.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'compliance',
  key: 'audit-exports/org-abc/2026-01/file.zip',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

// ─────────────────────────────────────────────────────────────
// presignGet vector
// ─────────────────────────────────────────────────────────────
function vectorPresign(): { url: string; signature: string; canonicalRequest: string; stringToSign: string } {
  const opts = { ...COMMON, expiresIn: 600 }
  const expiresIn = Math.min(Math.max(opts.expiresIn ?? 3600, 1), 604800)
  const amzDate = formatAmzDate(FROZEN)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host

  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)

  const queryParams = new URLSearchParams()
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  queryParams.set('X-Amz-Credential', `${opts.accessKeyId}/${credentialScope}`)
  queryParams.set('X-Amz-Date', amzDate)
  queryParams.set('X-Amz-Expires', String(expiresIn))
  queryParams.set('X-Amz-SignedHeaders', 'host')
  const canonicalQuery = [...queryParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    'GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const url = `${opts.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`

  return { url, signature, canonicalRequest, stringToSign }
}

// ─────────────────────────────────────────────────────────────
// putObject Authorization header vector
// ─────────────────────────────────────────────────────────────
function vectorPut(): { authorization: string; signature: string; bodyHash: string; signedHeaders: string } {
  const opts = COMMON
  const body = Buffer.from('test-body-content', 'utf8')
  const contentType = 'application/json; charset=utf-8'
  const amzDate = formatAmzDate(FROZEN)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host
  const bodyHash = sha256Hex(body)

  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)
  const canonicalQuery = ''

  const metaPairs: Array<[string, string]> = [
    ['x-amz-meta-cs-row-id', '11111111-1111-1111-1111-111111111111'],
    ['x-amz-meta-cs-org-id', '22222222-2222-2222-2222-222222222222'],
  ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) as Array<[string, string]>

  const fixedHeaders: Array<[string, string]> = [
    ['content-length', String(body.length)],
    ['content-type', contentType],
    ['host', host],
    ['x-amz-content-sha256', bodyHash],
    ['x-amz-date', amzDate],
  ]
  const allHeaders = [...fixedHeaders, ...metaPairs].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )
  const canonicalHeaders =
    allHeaders.map(([n, v]) => `${n}:${v}`).join('\n') + '\n'
  const signedHeaders = allHeaders.map(([n]) => n).join(';')

  const canonicalRequest = [
    'PUT', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, bodyHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, signature, bodyHash, signedHeaders }
}

// ─────────────────────────────────────────────────────────────
// deleteObject Authorization header vector
// ─────────────────────────────────────────────────────────────
function vectorDelete(): { authorization: string; signature: string } {
  const opts = COMMON
  const amzDate = formatAmzDate(FROZEN)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host
  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${EMPTY_PAYLOAD_HASH}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'DELETE', canonicalUri, '', canonicalHeaders, signedHeaders, EMPTY_PAYLOAD_HASH,
  ].join('\n')
  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, signature }
}

console.log('━━━ FROZEN clock ━━━')
console.log(`  Date.UTC(2026, 0, 15, 8, 0, 0) → ${FROZEN.toISOString()}`)
console.log(`  formatAmzDate              → ${formatAmzDate(FROZEN)}`)
console.log(`  dateStamp                  → ${formatAmzDate(FROZEN).slice(0, 8)}`)
console.log()

const presign = vectorPresign()
console.log('━━━ presignGet vector ━━━')
console.log(`  signature: ${presign.signature}`)
console.log(`  url      : ${presign.url}`)
console.log()

const put = vectorPut()
console.log('━━━ putObject vector ━━━')
console.log(`  signature    : ${put.signature}`)
console.log(`  bodyHash     : ${put.bodyHash}`)
console.log(`  signedHeaders: ${put.signedHeaders}`)
console.log(`  authorization: ${put.authorization}`)
console.log()

const del = vectorDelete()
console.log('━━━ deleteObject vector ━━━')
console.log(`  signature    : ${del.signature}`)
console.log(`  authorization: ${del.authorization}`)
console.log()

// ─────────────────────────────────────────────────────────────
// signedProbeRequest vectors — HEAD/GET/LIST/DELETE share the same
// helper but probeListObjectsV2 hits the bucket root with a query
// string instead of a key.
// ─────────────────────────────────────────────────────────────
function vectorProbe(method: 'HEAD' | 'GET' | 'DELETE', canonicalQuery: string, keyForPath: string) {
  const opts = COMMON
  const amzDate = formatAmzDate(FROZEN)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host

  const canonicalUri =
    keyForPath === ''
      ? '/' + encodeKey(opts.bucket) + '/'
      : canonicalUriFor(opts.bucket, keyForPath)

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${EMPTY_PAYLOAD_HASH}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, EMPTY_PAYLOAD_HASH,
  ].join('\n')
  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest),
  ].join('\n')
  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { signature, authorization }
}

const head = vectorProbe('HEAD', '', COMMON.key)
console.log('━━━ probeHeadObject vector ━━━')
console.log(`  signature    : ${head.signature}`)
console.log(`  authorization: ${head.authorization}`)
console.log()

const get = vectorProbe('GET', '', COMMON.key)
console.log('━━━ probeGetObject vector ━━━')
console.log(`  signature    : ${get.signature}`)
console.log(`  authorization: ${get.authorization}`)
console.log()

const delProbe = vectorProbe('DELETE', '', COMMON.key)
console.log('━━━ probeDeleteObject vector ━━━')
console.log(`  signature    : ${delProbe.signature}`)
console.log(`  authorization: ${delProbe.authorization}`)
console.log()

const list = vectorProbe('GET', 'list-type=2', '')
console.log('━━━ probeListObjectsV2 vector ━━━')
console.log(`  signature    : ${list.signature}`)
console.log(`  authorization: ${list.authorization}`)
console.log()

console.log('━━━ derived constants ━━━')
console.log(`  deriveSigningKey(secret, dateStamp, region) hex (length ${deriveSigningKey(COMMON.secretAccessKey, formatAmzDate(FROZEN).slice(0, 8), COMMON.region).length}):`)
console.log(`    ${deriveSigningKey(COMMON.secretAccessKey, formatAmzDate(FROZEN).slice(0, 8), COMMON.region).toString('hex')}`)
