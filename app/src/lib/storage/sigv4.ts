// ADR-0040 — hand-rolled AWS sigv4 for Cloudflare R2 S3 compatibility.
// Supports PUT object + presigned GET URLs. Uses Node crypto built-ins.
// No npm dep added (per Rule #14).
//
// Canonical request ordering and signing-key derivation follow the AWS
// sigv4 specification. Pinned test vectors live in sigv4.test.ts so
// future edits can't break signing silently.

import { createHash, createHmac } from 'node:crypto'

export interface SigV4Options {
  endpoint: string        // e.g. 'https://<accountid>.r2.cloudflarestorage.com'
  region: string          // 'auto' for R2
  bucket: string
  key: string             // object key, may contain '/'
  accessKeyId: string
  secretAccessKey: string
}

export interface PutObjectOptions extends SigV4Options {
  body: Uint8Array | Buffer
  contentType?: string
  // ADR-1019 Sprint 2.1 — optional x-amz-meta-* headers. Keys are lower-cased
  // and prefixed with `x-amz-meta-` before signing. Values must be US-ASCII
  // (RFC 7230); caller guarantees no PII.
  metadata?: Record<string, string>
}

export interface PresignGetOptions extends SigV4Options {
  expiresIn?: number      // seconds; default 3600
}

const SERVICE = 's3'

// ═══════════════════════════════════════════════════════════
// PUT object (signed via Authorization header).
// ═══════════════════════════════════════════════════════════
export async function putObject(opts: PutObjectOptions): Promise<{ status: number; etag: string | null }> {
  const body = opts.body instanceof Buffer ? opts.body : Buffer.from(opts.body)
  const contentType = opts.contentType ?? 'application/octet-stream'

  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host
  const bodyHash = sha256Hex(body)

  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)
  const canonicalQuery = ''

  // Normalise metadata into sorted, lower-cased, prefixed pairs. The sigv4
  // canonical-headers block requires every signed header — including user
  // metadata — to appear alphabetically.
  const metaPairs: Array<[string, string]> = []
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      const name = `x-amz-meta-${k.toLowerCase()}`
      metaPairs.push([name, v])
    }
    metaPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  }

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
    allHeaders.map(([name, value]) => `${name}:${value}`).join('\n') + '\n'
  const signedHeaders = allHeaders.map(([name]) => name).join(';')

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const url = `${opts.endpoint}${canonicalUri}`
  const requestHeaders: Record<string, string> = {
    Authorization: authorization,
    'Content-Type': contentType,
    'Content-Length': String(body.length),
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amzDate,
  }
  for (const [name, value] of metaPairs) {
    requestHeaders[name] = value
  }

  const resp = await fetch(url, {
    method: 'PUT',
    headers: requestHeaders,
    body,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`R2 PUT failed: ${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`)
  }

  return { status: resp.status, etag: resp.headers.get('etag') }
}

// ═══════════════════════════════════════════════════════════
// DELETE object (signed via Authorization header).
// Added under ADR-1025 Sprint 1.3 — used by the verification probe to
// clean up sentinel objects. Same sigv4 pattern as putObject but with
// an empty payload hash + no content-type / content-length headers.
// ═══════════════════════════════════════════════════════════
const EMPTY_PAYLOAD_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export async function deleteObject(
  opts: SigV4Options,
): Promise<{ status: number }> {
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host

  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)
  const canonicalQuery = ''
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${EMPTY_PAYLOAD_HASH}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'DELETE',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_HASH,
  ].join('\n')

  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const url = `${opts.endpoint}${canonicalUri}`
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': EMPTY_PAYLOAD_HASH,
      'x-amz-date': amzDate,
    },
  })

  // S3 DELETE returns 204 No Content on success. 404 on already-deleted is
  // idempotent-friendly; callers can treat both as success.
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => '')
    throw new Error(
      `R2 DELETE failed: ${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`,
    )
  }

  return { status: resp.status }
}

// ═══════════════════════════════════════════════════════════
// Probe-friendly signed requests (ADR-1003 Sprint 2.1 — scope-down
// validation). Return { status } for ANY HTTP response — never
// throw on 4xx. The scope-down probe wants to see 403 and needs to
// tell it apart from transport errors.
// ═══════════════════════════════════════════════════════════

export async function probeHeadObject(opts: SigV4Options): Promise<{ status: number }> {
  return signedProbeRequest('HEAD', opts, '', opts.key)
}

export async function probeGetObject(opts: SigV4Options): Promise<{ status: number }> {
  return signedProbeRequest('GET', opts, '', opts.key)
}

/**
 * List-objects-v2 on the bucket root. Does not require an object key —
 * a write-only credential should 403 regardless of whether the bucket
 * is empty.
 */
export async function probeListObjectsV2(
  opts: Omit<SigV4Options, 'key'>,
): Promise<{ status: number }> {
  return signedProbeRequest('GET', { ...opts, key: '' }, 'list-type=2', '')
}

export async function probeDeleteObject(opts: SigV4Options): Promise<{ status: number }> {
  return signedProbeRequest('DELETE', opts, '', opts.key)
}

async function signedProbeRequest(
  method: 'GET' | 'HEAD' | 'DELETE',
  opts: SigV4Options,
  canonicalQuery: string,
  keyForPath: string,
): Promise<{ status: number }> {
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host

  // List-objects-v2 hits the bucket root (/bucket/); object ops hit
  // /bucket/<key>. keyForPath=='' produces the trailing-slash form.
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
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_HASH,
  ].join('\n')

  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const queryString = canonicalQuery ? `?${canonicalQuery}` : ''
  const url = `${opts.endpoint}${canonicalUri}${queryString}`
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      'x-amz-content-sha256': EMPTY_PAYLOAD_HASH,
      'x-amz-date': amzDate,
    },
  })
  // Drain body so the connection can be released — but don't look at
  // the content. 4xx bodies can contain the bucket name etc. which the
  // probe doesn't need.
  try {
    await resp.arrayBuffer()
  } catch {
    /* noop */
  }
  return { status: resp.status }
}

// ═══════════════════════════════════════════════════════════
// Presigned GET URL (query-string auth).
// ═══════════════════════════════════════════════════════════
export function presignGet(opts: PresignGetOptions): string {
  const expiresIn = Math.min(Math.max(opts.expiresIn ?? 3600, 1), 604800)
  const now = new Date()
  const amzDate = formatAmzDate(now)
  const dateStamp = amzDate.slice(0, 8)
  const host = new URL(opts.endpoint).host

  const credentialScope = `${dateStamp}/${opts.region}/${SERVICE}/aws4_request`
  const canonicalUri = canonicalUriFor(opts.bucket, opts.key)

  // Presigned requests put the signed-header list + amz-* params in the
  // query string; the only signed header is `host`.
  const queryParams = new URLSearchParams()
  queryParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  queryParams.set('X-Amz-Credential', `${opts.accessKeyId}/${credentialScope}`)
  queryParams.set('X-Amz-Date', amzDate)
  queryParams.set('X-Amz-Expires', String(expiresIn))
  queryParams.set('X-Amz-SignedHeaders', 'host')
  // Sort for canonical form (URLSearchParams keeps insertion order; sort
  // keys manually for determinism).
  const canonicalQuery = [...queryParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = deriveSigningKey(opts.secretAccessKey, dateStamp, opts.region)
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `${opts.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// ═══════════════════════════════════════════════════════════
// Helpers (also exported for unit tests)
// ═══════════════════════════════════════════════════════════

export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(SERVICE).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

export function canonicalUriFor(bucket: string, key: string): string {
  // Virtual-hosted–style: path is /<key> where <key> is RFC3986-encoded per segment.
  return '/' + encodeKey(bucket) + '/' + encodeKey(key)
}

export function formatAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  const h = createHash('sha256')
  h.update(data instanceof Buffer ? data : typeof data === 'string' ? data : Buffer.from(data))
  return h.digest('hex')
}

function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => rfc3986(segment))
    .join('/')
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}
