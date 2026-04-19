// Hand-rolled AWS sigv4 for Cloudflare R2 S3 compatibility. Admin-side
// copy of the helper shipped under ADR-0040 in app/src/lib/storage/sigv4.ts.
// Each app keeps its own copy per the monorepo "share narrowly" discipline
// (packages are reserved for domain-layer code: shared-types, compliance,
// encryption — not infrastructure glue).
//
// Supports PUT object + presigned GET URLs. Uses Node crypto built-ins.
// No npm dep added (Rule 15). Canonical request ordering and signing-key
// derivation follow the AWS sigv4 specification.

import { createHash, createHmac } from 'node:crypto'

export interface SigV4Options {
  endpoint: string
  region: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
}

export interface PutObjectOptions extends SigV4Options {
  body: Uint8Array | Buffer
  contentType?: string
}

export interface PresignGetOptions extends SigV4Options {
  expiresIn?: number
}

const SERVICE = 's3'

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
  const canonicalHeaders =
    `content-length:${body.length}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${bodyHash}\n` +
    `x-amz-date:${amzDate}\n`
  const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date'

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
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
    },
    body,
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`R2 PUT failed: ${resp.status} ${resp.statusText} — ${text.slice(0, 400)}`)
  }

  return { status: resp.status, etag: resp.headers.get('etag') }
}

export function presignGet(opts: PresignGetOptions): string {
  const expiresIn = Math.min(Math.max(opts.expiresIn ?? 3600, 1), 604800)
  const now = new Date()
  const amzDate = formatAmzDate(now)
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
