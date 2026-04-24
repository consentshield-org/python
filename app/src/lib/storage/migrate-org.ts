// ADR-1025 Phase 3 Sprint 3.2 — storage migration orchestrator.
//
// One invocation processes ONE CHUNK of a migration (up to
// CHUNK_OBJECT_LIMIT objects or CHUNK_TIME_BUDGET_MS wall time). The
// route calls this; on non-terminal return, the caller fires the next
// chunk via public.dispatch_migrate_storage. The pg_cron safety-net
// re-kicks any migration whose last_activity_at falls behind.
//
// Two modes:
//   · forward_only  → no object copy; atomic pointer swap from the
//                     CS-managed bucket to the customer BYOK bucket.
//                     Sets retention_until = now + 30 days so the
//                     historical bucket can be cleaned by Phase 4
//                     cron. Completes in one chunk.
//   · copy_existing → ListObjectsV2 from source, stream each object
//                     (GET source, PUT target), record last_copied_key
//                     cursor after every object. When ListObjects
//                     returns empty, atomic pointer swap + state →
//                     completed. Resumable across crashes via the
//                     cursor.
//
// Credential flow:
//   · to_credential_enc is decrypted to usable {access_key_id, secret}
//     at the start of every chunk.
//   · On completed/failed terminal, to_credential_enc is WIPED from the
//     storage_migrations row (written back null). The target credential
//     lives on as write_credential_enc in export_configurations —
//     same ciphertext, same key.
//
// Rule 11: secrets are held in narrow local variables; never logged.

import type postgres from 'postgres'
import { r2Endpoint } from './cf-provision'
import {
  decryptCredentials,
  deriveOrgKey,
  type StorageCredentials,
} from './org-crypto'
import { presignGet, putObject, type SigV4Options } from './sigv4'
import { runVerificationProbe } from './verify'

const CHUNK_OBJECT_LIMIT = 200
const CHUNK_TIME_BUDGET_MS = 240_000 // 4 min — leaves 1 min headroom under Vercel 300s
const RETENTION_DAYS_AFTER_FORWARD_ONLY = 30
const FETCH_TIMEOUT_MS = 30_000

type Pg = ReturnType<typeof postgres>

export type MigrationStatus =
  | 'completed'
  | 'in_flight'   // more work remains; caller should re-dispatch
  | 'terminal'    // already completed / failed — no-op
  | 'not_found'
  | 'failed'

export interface ProcessResult {
  status: MigrationStatus
  mode?: 'forward_only' | 'copy_existing'
  objects_copied?: number
  objects_total?: number | null
  error?: string
}

export interface ProcessMigrationDeps {
  runVerificationProbe?: typeof runVerificationProbe
  putObject?: typeof putObject
  presignGet?: typeof presignGet
  fetchFn?: typeof fetch
  now?: () => number
}

interface MigrationRow {
  id: string
  org_id: string
  from_config_id: string
  from_config_snapshot: {
    provider: string
    bucket: string
    region: string | null
    path_prefix?: string | null
  }
  to_config: {
    provider: 'customer_r2' | 'customer_s3'
    bucket: string
    region: string
    endpoint: string
  }
  to_credential_enc: Buffer | null
  mode: 'forward_only' | 'copy_existing'
  state: 'queued' | 'copying' | 'completed' | 'failed'
  objects_total: number | null
  objects_copied: number
  last_copied_key: string | null
  retention_until: Date | null
  started_at: Date
  last_activity_at: Date
}

// Alias for clarity — migrate-org treats credentials as {access_key_id,
// secret_access_key}; token_id is optional on the shared type.
type Credentials = StorageCredentials

export async function processMigrationChunk(
  pg: Pg,
  migrationId: string,
  deps: ProcessMigrationDeps = {},
): Promise<ProcessResult> {
  const now = deps.now ?? Date.now
  const startTs = now()

  const rows = await pg<MigrationRow[]>`
    select id, org_id, from_config_id, from_config_snapshot, to_config,
           to_credential_enc, mode, state, objects_total, objects_copied,
           last_copied_key, retention_until, started_at, last_activity_at
      from public.storage_migrations
     where id = ${migrationId}
     limit 1
  `
  if (!rows.length) return { status: 'not_found' }
  const mig = rows[0]
  if (mig.state === 'completed' || mig.state === 'failed') {
    return { status: 'terminal', mode: mig.mode }
  }

  // Transition queued → copying on first touch.
  if (mig.state === 'queued') {
    await pg`
      update public.storage_migrations
         set state = 'copying',
             last_activity_at = now()
       where id = ${migrationId}
         and state = 'queued'
    `
  }

  try {
    if (!mig.to_credential_enc) {
      throw new Error('to_credential_enc is null — migration cannot proceed')
    }
    const derivedKey = await deriveOrgKey(pg, mig.org_id)
    const targetCreds = await decryptCredentials(
      pg,
      mig.to_credential_enc,
      derivedKey,
    )

    if (mig.mode === 'forward_only') {
      return await handleForwardOnly(pg, mig, targetCreds, deps)
    }
    // mode === 'copy_existing'
    const sourceCreds = await loadSourceCreds(pg, mig.from_config_id, derivedKey)
    return await handleCopyExisting(
      pg,
      mig,
      sourceCreds,
      targetCreds,
      deps,
      startTs,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailed(pg, migrationId, message)
    return { status: 'failed', mode: mig.mode, error: message }
  }
}

// ═══════════════════════════════════════════════════════════
// forward_only — pointer swap only
// ═══════════════════════════════════════════════════════════

async function handleForwardOnly(
  pg: Pg,
  mig: MigrationRow,
  targetCreds: Credentials,
  deps: ProcessMigrationDeps,
): Promise<ProcessResult> {
  const probeFn = deps.runVerificationProbe ?? runVerificationProbe
  const probe = await probeFn({
    provider: mig.to_config.provider,
    endpoint: mig.to_config.endpoint,
    region: mig.to_config.region,
    bucket: mig.to_config.bucket,
    accessKeyId: targetCreds.access_key_id,
    secretAccessKey: targetCreds.secret_access_key,
  })
  if (!probe.ok) {
    throw new Error(
      `target bucket verification failed at ${probe.failedStep}: ${probe.error}`,
    )
  }

  await atomicCutover(pg, mig, 'forward_only')
  return { status: 'completed', mode: 'forward_only', objects_copied: 0 }
}

// ═══════════════════════════════════════════════════════════
// copy_existing — stream objects then swap
// ═══════════════════════════════════════════════════════════

async function handleCopyExisting(
  pg: Pg,
  mig: MigrationRow,
  sourceCreds: Credentials,
  targetCreds: Credentials,
  deps: ProcessMigrationDeps,
  chunkStartTs: number,
): Promise<ProcessResult> {
  const presignFn = deps.presignGet ?? presignGet
  const putFn = deps.putObject ?? putObject
  const fetchFn = deps.fetchFn ?? fetch
  const now = deps.now ?? Date.now

  // Target probe on the first chunk.
  if (mig.objects_copied === 0 && !mig.last_copied_key) {
    const probe = await (deps.runVerificationProbe ?? runVerificationProbe)({
      provider: mig.to_config.provider,
      endpoint: mig.to_config.endpoint,
      region: mig.to_config.region,
      bucket: mig.to_config.bucket,
      accessKeyId: targetCreds.access_key_id,
      secretAccessKey: targetCreds.secret_access_key,
    })
    if (!probe.ok) {
      throw new Error(
        `target verification failed at ${probe.failedStep}: ${probe.error}`,
      )
    }
  }

  const sourceEndpoint = sourceEndpointFor(mig.from_config_snapshot)
  const sourceRegion = mig.from_config_snapshot.region ?? 'auto'
  const sourceBucket = mig.from_config_snapshot.bucket

  let chunkCopied = 0
  let lastKey = mig.last_copied_key
  let allDone = false

  while (
    chunkCopied < CHUNK_OBJECT_LIMIT &&
    now() - chunkStartTs < CHUNK_TIME_BUDGET_MS
  ) {
    const page = await listObjectsV2(
      sourceEndpoint,
      sourceRegion,
      sourceBucket,
      sourceCreds,
      lastKey,
      fetchFn,
    )
    if (page.keys.length === 0) {
      allDone = true
      break
    }

    for (const key of page.keys) {
      if (chunkCopied >= CHUNK_OBJECT_LIMIT) break
      if (now() - chunkStartTs >= CHUNK_TIME_BUDGET_MS) break

      const { body, contentType } = await fetchObject(
        presignFn,
        {
          endpoint: sourceEndpoint,
          region: sourceRegion,
          bucket: sourceBucket,
          key,
          accessKeyId: sourceCreds.access_key_id,
          secretAccessKey: sourceCreds.secret_access_key,
        },
        fetchFn,
      )

      await putFn({
        endpoint: mig.to_config.endpoint,
        region: mig.to_config.region,
        bucket: mig.to_config.bucket,
        key,
        body,
        contentType,
        accessKeyId: targetCreds.access_key_id,
        secretAccessKey: targetCreds.secret_access_key,
      })

      lastKey = key
      chunkCopied++

      // Commit progress after every N objects so a crash mid-chunk only
      // loses up to N copies.
      if (chunkCopied % 20 === 0) {
        await pg`
          update public.storage_migrations
             set objects_copied = objects_copied + ${20},
                 last_copied_key = ${lastKey},
                 last_activity_at = now()
           where id = ${mig.id}
        `
      }
    }

    // Full batch processed? If the page was short or we walked every
    // key, check if we're at the end.
    if (!page.isTruncated && chunkCopied < CHUNK_OBJECT_LIMIT) {
      allDone = true
      break
    }
  }

  // Flush any uncommitted progress.
  const remainder = chunkCopied % 20
  if (remainder > 0) {
    await pg`
      update public.storage_migrations
         set objects_copied = objects_copied + ${remainder},
             last_copied_key = ${lastKey},
             last_activity_at = now()
       where id = ${mig.id}
    `
  }

  if (allDone) {
    await atomicCutover(pg, mig, 'copy_existing')
    return {
      status: 'completed',
      mode: 'copy_existing',
      objects_copied: mig.objects_copied + chunkCopied,
    }
  }

  return {
    status: 'in_flight',
    mode: 'copy_existing',
    objects_copied: mig.objects_copied + chunkCopied,
  }
}

// ═══════════════════════════════════════════════════════════
// Atomic cutover — the load-bearing pointer swap
// ═══════════════════════════════════════════════════════════

async function atomicCutover(
  pg: Pg,
  mig: MigrationRow,
  mode: 'forward_only' | 'copy_existing',
): Promise<void> {
  // Single transaction: swap the export_configurations row + terminal
  // the migration row + wipe to_credential_enc. If any step fails,
  // nothing commits.
  await pg.begin(async (tx) => {
    await tx`
      update public.export_configurations
         set storage_provider = ${mig.to_config.provider},
             bucket_name      = ${mig.to_config.bucket},
             region           = ${mig.to_config.region},
             write_credential_enc = ${mig.to_credential_enc},
             is_verified      = true,
             updated_at       = now()
       where org_id = ${mig.org_id}
    `

    // Forward-only preserves the old CS-managed bucket for 30 days so
    // audit-export surfaces can still reach historical objects.
    const retentionUntil =
      mode === 'forward_only'
        ? new Date(
            Date.now() + RETENTION_DAYS_AFTER_FORWARD_ONLY * 24 * 3600 * 1000,
          )
        : null

    await tx`
      update public.storage_migrations
         set state            = 'completed',
             completed_at     = now(),
             retention_until  = ${retentionUntil},
             to_credential_enc = null,
             last_activity_at = now()
       where id = ${mig.id}
    `
  })
}

async function markFailed(
  pg: Pg,
  migrationId: string,
  error: string,
): Promise<void> {
  try {
    await pg`
      update public.storage_migrations
         set state            = 'failed',
             error_text       = ${error},
             completed_at     = now(),
             to_credential_enc = null,
             last_activity_at = now()
       where id = ${migrationId}
         and state in ('queued', 'copying')
    `
  } catch {
    /* best effort; caller already has the error */
  }
}

// ═══════════════════════════════════════════════════════════
// Source-side credential loader (migrate-org specific; decrypts the
// write_credential_enc of the source export_configurations row so the
// orchestrator can GET from the old bucket during copy_existing).
// deriveOrgKey + decryptCredentials come from ./org-crypto.
// ═══════════════════════════════════════════════════════════

async function loadSourceCreds(
  pg: Pg,
  fromConfigId: string,
  derivedKey: string,
): Promise<Credentials> {
  const rows = await pg<{ write_credential_enc: Buffer }[]>`
    select write_credential_enc from public.export_configurations
     where id = ${fromConfigId} limit 1
  `
  if (!rows.length) throw new Error('source export_configurations not found')
  return decryptCredentials(pg, rows[0].write_credential_enc, derivedKey)
}

// ═══════════════════════════════════════════════════════════
// S3 ListObjectsV2 — hand-rolled sigv4 (no SDK dependency)
// ═══════════════════════════════════════════════════════════

interface ListPage {
  keys: string[]
  isTruncated: boolean
}

async function listObjectsV2(
  endpoint: string,
  region: string,
  bucket: string,
  creds: Credentials,
  startAfter: string | null,
  fetchFn: typeof fetch,
): Promise<ListPage> {
  const { createHash, createHmac } = await import('node:crypto')
  const { deriveSigningKey, formatAmzDate, sha256Hex } = await import('./sigv4')
  const host = new URL(endpoint).host
  const amzDate = formatAmzDate(new Date())
  const dateStamp = amzDate.slice(0, 8)
  const credScope = `${dateStamp}/${region}/s3/aws4_request`

  const q: [string, string][] = [
    ['list-type', '2'],
    ['max-keys', '1000'],
  ]
  if (startAfter) q.push(['start-after', startAfter])
  const canonicalQuery = q
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/\*/g, '%2A')}`,
    )
    .join('&')

  const canonicalUri = '/' + bucket + '/'
  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const crStr = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const strToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    sha256Hex(crStr),
  ].join('\n')
  const signingKey = deriveSigningKey(creds.secret_access_key, dateStamp, region)
  const signature = createHmac('sha256', signingKey).update(strToSign).digest('hex')
  const auth = `AWS4-HMAC-SHA256 Credential=${creds.access_key_id}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetchFn(`${endpoint}${canonicalUri}?${canonicalQuery}`, {
      method: 'GET',
      headers: {
        Authorization: auth,
        Host: host,
        'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
        'X-Amz-Date': amzDate,
      },
      signal: ac.signal,
    })
    if (!resp.ok) {
      throw new Error(
        `ListObjectsV2 ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
      )
    }
    const xml = await resp.text()
    const keys = Array.from(xml.matchAll(/<Key>([^<]+)<\/Key>/g)).map((m) => m[1])
    const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    // unused var guard — discard createHash so node:crypto isn't dead-code stripped.
    void createHash
    return { keys, isTruncated }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchObject(
  presignFn: typeof presignGet,
  opts: SigV4Options,
  fetchFn: typeof fetch,
): Promise<{ body: Buffer; contentType: string | undefined }> {
  const url = presignFn({ ...opts, expiresIn: 300 })
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetchFn(url, { signal: ac.signal })
    if (!resp.ok) {
      throw new Error(
        `GET ${opts.key} failed: ${resp.status} — ${(await resp.text()).slice(0, 200)}`,
      )
    }
    const body = Buffer.from(await resp.arrayBuffer())
    return {
      body,
      contentType: resp.headers.get('content-type') ?? undefined,
    }
  } finally {
    clearTimeout(timer)
  }
}

function sourceEndpointFor(snapshot: MigrationRow['from_config_snapshot']): string {
  // CS-managed R2 always uses the account-scoped endpoint; BYOK sources
  // aren't supported as the FROM side in Sprint 3.2 (would only come up
  // with a BYOK→BYOK migration, which isn't a listed deliverable).
  if (snapshot.provider === 'cs_managed_r2') return r2Endpoint()
  // Fallback — if this ever runs, snapshots from older config shapes
  // probably include an explicit endpoint already.
  const explicit = (snapshot as { endpoint?: string }).endpoint
  if (explicit) return explicit
  throw new Error(
    `unsupported source provider for migration: ${snapshot.provider}`,
  )
}
