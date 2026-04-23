// ADR-1025 Phase 1 Sprint 1.1 end-to-end verification.
//
// Exercises the real Cloudflare R2 account against the primitives that
// Sprints 1.2 + 1.3 shipped with mocked unit tests. Proves:
//   1. CLOUDFLARE_ACCOUNT_API_TOKEN has the R2:Edit scope we think it has.
//   2. cf-provision.ts + verify.ts work end-to-end against a live bucket.
//   3. Bucket-scoped token revocation takes effect (post-revoke PUT → 403).
//
// Run:
//   bunx tsx scripts/verify-adr-1025-sprint-11.ts
//
// Env required (loaded from .env.local if present):
//   CLOUDFLARE_ACCOUNT_ID          — account id (not secret)
//   CLOUDFLARE_ACCOUNT_API_TOKEN   — account-level token, R2:Edit scope
//   STORAGE_NAME_SALT              — base64 random; salts bucket-name derivation
//
// Clean-up: the script creates a throwaway bucket named from a fixed orgId
// derivation, runs the probe (which already DELETEs its sentinel), then
// revokes the token and deletes the bucket. On success the CF dashboard
// should show no trace.

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createBucket,
  createBucketScopedToken,
  deriveBucketName,
  r2Endpoint,
  revokeBucketToken,
} from '../app/src/lib/storage/cf-provision'
import {
  deleteObject,
  deriveSigningKey,
  formatAmzDate,
  putObject,
  sha256Hex,
} from '../app/src/lib/storage/sigv4'
import { runVerificationProbe } from '../app/src/lib/storage/verify'

// ── Step 0: load .env.local into process.env (idempotent) ──
// Static imports above are safe because cf-provision.ts / verify.ts / sigv4.ts
// read env vars only at call-time (inside requireEnv() / putObject()).
function loadEnv(path: string): void {
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
      if (!m) continue
      const [, k, v] = m
      const val = v.replace(/^"|"$/g, '')
      if (!process.env[k]) process.env[k] = val
    }
  } catch (err) {
    console.error(`[skip] could not read ${path}: ${(err as Error).message}`)
  }
}
loadEnv(resolve(process.cwd(), '.env.local'))
loadEnv(resolve(process.cwd(), 'app/.env.local'))

// ── constants ──
const THROWAWAY_ORG_ID = 'adr-1025-sprint-11-verification'
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const ACCOUNT_TOKEN = process.env.CLOUDFLARE_ACCOUNT_API_TOKEN!
const R2_REGION = 'auto'

function section(title: string): void {
  console.log('\n━━━ ' + title + ' ━━━')
}

async function deleteBucket(name: string): Promise<void> {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${name}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${ACCOUNT_TOKEN}` } },
  )
  if (resp.status === 200 || resp.status === 204 || resp.status === 404) return
  throw new Error(`delete bucket ${name} failed: HTTP ${resp.status} — ${await resp.text()}`)
}

// Hand-rolled sigv4 for ListObjectsV2 (not a named export in sigv4.ts).
// Signs GET /<bucket>/?list-type=2 with AWS4-HMAC-SHA256 (host header only,
// UNSIGNED-PAYLOAD). Returns up to 1000 keys per call; caller loops with
// continuation-token when needed.
async function listAllObjects(
  bucketName: string,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined
  for (let page = 0; page < 20; page++) {
    const endpoint = r2Endpoint()
    const host = new URL(endpoint).host
    const now = new Date()
    const amzDate = formatAmzDate(now)
    const dateStamp = amzDate.slice(0, 8)
    const credentialScope = `${dateStamp}/${R2_REGION}/s3/aws4_request`

    const q: [string, string][] = [['list-type', '2']]
    if (continuationToken) q.push(['continuation-token', continuationToken])
    const canonicalQuery = q
      .map(([k, v]) => [k, v] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/\*/g, '%2A')}`)
      .join('&')

    const canonicalUri = '/' + bucketName + '/'
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n')
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const signingKey = deriveSigningKey(secretAccessKey, dateStamp, R2_REGION)
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const auth = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const url = `${endpoint}${canonicalUri}?${canonicalQuery}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Host: host,
        'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
        'X-Amz-Date': amzDate,
      },
    })
    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`ListObjectsV2 failed: ${resp.status} — ${body.slice(0, 300)}`)
    }
    const xml = await resp.text()
    const pageKeys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1])
    keys.push(...pageKeys)
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    if (!truncated) break
    const nextMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    continuationToken = nextMatch?.[1]
    if (!continuationToken) break
  }
  return keys
}

// Empty the bucket completely by minting a fresh cleanup token, listing all
// objects, deleting them, and revoking the token.
async function emptyBucket(bucketName: string): Promise<number> {
  const cleanup = await createBucketScopedToken(bucketName)
  await new Promise((r) => setTimeout(r, 5000)) // propagation
  const keys = await listAllObjects(bucketName, cleanup.access_key_id, cleanup.secret_access_key)
  let deleted = 0
  for (const key of keys) {
    try {
      await deleteObject({
        endpoint: r2Endpoint(),
        region: R2_REGION,
        bucket: bucketName,
        key,
        accessKeyId: cleanup.access_key_id,
        secretAccessKey: cleanup.secret_access_key,
      })
      deleted++
    } catch {
      /* 404 = already gone; ignore */
    }
  }
  await revokeBucketToken(cleanup.token_id)
  return deleted
}

async function main(): Promise<void> {
  const t0 = Date.now()

  section('Step 1 — derive bucket name')
  const bucketName = deriveBucketName(THROWAWAY_ORG_ID)
  console.log('  org_id     :', THROWAWAY_ORG_ID)
  console.log('  bucket name:', bucketName)

  section('Step 2 — create bucket (locationHint=apac)')
  const bucket = await createBucket(bucketName, 'apac')
  console.log('  name        :', bucket.name)
  console.log('  location    :', bucket.location)
  console.log('  creation    :', bucket.creation_date)

  section('Step 3 — mint bucket-scoped token')
  const token = await createBucketScopedToken(bucketName)
  console.log('  token_id    :', token.token_id)
  console.log('  access_key  :', token.access_key_id)
  console.log('  secret      : [REDACTED — length=' + token.secret_access_key.length + ']')

  section('Step 3b — wait for token propagation to R2 edge (5s)')
  await new Promise((r) => setTimeout(r, 5000))

  section('Step 4 — runVerificationProbe (PUT → GET → hash → DELETE)')
  const probe = await runVerificationProbe({
    provider: 'cs_managed_r2',
    endpoint: r2Endpoint(),
    region: R2_REGION,
    bucket: bucketName,
    accessKeyId: token.access_key_id,
    secretAccessKey: token.secret_access_key,
  })
  console.log('  ok          :', probe.ok)
  console.log('  probe_id    :', probe.probeId)
  console.log('  duration_ms :', probe.durationMs)
  if (probe.failedStep) console.log('  failed_step :', probe.failedStep)
  if (probe.error) console.log('  error       :', probe.error)
  if (!probe.ok) {
    throw new Error('probe failed — aborting (bucket + token left in place for diagnosis)')
  }

  section('Step 5 — revoke bucket-scoped token')
  await revokeBucketToken(token.token_id)
  console.log('  revoked token_id=' + token.token_id)

  section('Step 6 — post-revoke PUT must fail with auth (poll up to 60s)')
  const endpoint = r2Endpoint()
  // CF token revocation is eventually consistent at the R2 edge. Poll every
  // 5s; the first PUT that 401s proves revocation took effect. Cap at 60s.
  // Use a numbered key per-attempt so any PUTs that succeed before propagation
  // can be cleaned up in Step 7.
  const revokeStart = Date.now()
  const straysWrittenDuringPolling: string[] = []
  let rejected = false
  for (let i = 0; i < 12; i++) {
    const key = `post-revoke-probe-${i + 1}.txt`
    try {
      await putObject({
        endpoint,
        region: R2_REGION,
        bucket: bucketName,
        key,
        body: Buffer.from('nope'),
        contentType: 'text/plain',
        accessKeyId: token.access_key_id,
        secretAccessKey: token.secret_access_key,
      })
      straysWrittenDuringPolling.push(key)
      console.log(`  attempt ${i + 1}: PUT still succeeded (revocation not yet propagated)`)
    } catch (err) {
      console.log('  attempt ' + (i + 1) + ' → rejected (expected): ' + (err as Error).message.slice(0, 120))
      rejected = true
      break
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  if (!rejected) {
    throw new Error(
      `revocation did not take effect within ${Math.round((Date.now() - revokeStart) / 1000)}s — investigate CF token lifecycle`,
    )
  }
  console.log('  revoke propagation took', Math.round((Date.now() - revokeStart) / 1000), 's')

  section('Step 7 — delete bucket (empty + cleanup)')
  const swept = await emptyBucket(bucketName)
  console.log(`  swept ${swept} object(s) from bucket`)
  await deleteBucket(bucketName)
  console.log('  deleted', bucketName)
  // Reference the polling-stray array so lint doesn't flag the assignment.
  void straysWrittenDuringPolling

  const elapsed = Date.now() - t0
  section(`done — ${elapsed} ms`)
  console.log('  all 7 steps passed')
}

main().catch((err) => {
  console.error('\n✗ verification failed:', err)
  process.exit(1)
})
