// ADR-1025 Phase 1 Sprint 1.2 — Cloudflare R2 provisioning primitives.
//
// Creates + destroys the per-org R2 bucket and bucket-scoped S3 credentials
// used by ADR-1019 `deliver-consent-events`. Zero npm deps — uses the
// built-in `fetch` against Cloudflare's REST API under a single account-level
// API token that lives in server-side secrets (never in client code).
//
// Required env (all set by the operator in Phase 1 Sprint 1.1 before any of
// these functions can run live):
//   CLOUDFLARE_ACCOUNT_ID         — Cloudflare account id (not a secret; copy from dashboard)
//   CLOUDFLARE_ACCOUNT_API_TOKEN  — account-level token with R2 Storage:Edit scope
//   STORAGE_NAME_SALT     — base64 random (>= 16 bytes) — prevents bucket-name
//                           reverse-engineering from a listed bucket back to org_id
//
// Rule 11: the per-bucket credentials this module returns are NEVER written to
// logs. The caller is responsible for passing them to `encryptForOrg` before
// persisting to `export_configurations.write_credential_enc`.
//
// Runtime-green gated on Sprint 1.1 (operator creates the token). Until then,
// `requireEnv` throws `CfProvisionError('...', 'config')` on every call. Unit
// tests mock the env + fetch; the mocks live in `app/tests/storage/cf-provision.test.ts`.

import { createHash } from 'node:crypto'

const CF_BASE_URL = 'https://api.cloudflare.com/client/v4'
const MAX_ATTEMPTS = 3
const INITIAL_BACKOFF_MS = 250
const BUDGET_MS = 30_000

export class CfProvisionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'auth'
      | 'conflict'
      | 'rate_limit'
      | 'server'
      | 'network'
      | 'config'
      | 'not_found',
  ) {
    super(message)
    this.name = 'CfProvisionError'
  }
}

interface CfConfig {
  accountId: string
  token: string
  salt: string
}

function requireEnv(): CfConfig {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_ACCOUNT_API_TOKEN
  const salt = process.env.STORAGE_NAME_SALT
  if (!accountId) {
    throw new CfProvisionError('CLOUDFLARE_ACCOUNT_ID not set', 'config')
  }
  if (!token) {
    throw new CfProvisionError('CLOUDFLARE_ACCOUNT_API_TOKEN not set', 'config')
  }
  if (!salt) {
    throw new CfProvisionError('STORAGE_NAME_SALT not set', 'config')
  }
  return { accountId, token, salt }
}

/**
 * Derive a globally-unique bucket name from an org id. sha256(orgId || salt),
 * first 10 bytes as lowercase hex (20 chars), prefixed with `cs-cust-` → 28
 * chars total. Deterministic: re-running the provisioner on the same org
 * always computes the same bucket name, which is what makes the whole job
 * idempotent.
 *
 * Why a hash-prefix rather than org_id directly: CF buckets share a global
 * namespace per-account; listing buckets would otherwise leak the full set
 * of customer UUIDs. The salt prevents rainbow-table reversal.
 */
export function deriveBucketName(orgId: string): string {
  const { salt } = requireEnv()
  const hash = createHash('sha256').update(orgId + salt).digest()
  return 'cs-cust-' + hash.subarray(0, 10).toString('hex')
}

/** Internal fetch wrapper with retry + exponential backoff + overall budget. */
async function cfFetch<T>(
  path: string,
  init: RequestInit,
  opts: {
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    fetchFn?: typeof fetch
  } = {},
): Promise<T> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  const fetchFn = opts.fetchFn ?? fetch
  const { token } = requireEnv()
  const started = now()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let lastErr: unknown = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (now() - started > BUDGET_MS) {
      throw new CfProvisionError(
        `CF API budget exceeded (${BUDGET_MS}ms) on ${path}`,
        'server',
      )
    }

    let response: Response
    try {
      response = await fetchFn(CF_BASE_URL + path, { ...init, headers })
    } catch (err) {
      lastErr = err
      if (attempt === MAX_ATTEMPTS) {
        throw new CfProvisionError(
          `CF API network error on ${path}: ${err instanceof Error ? err.message : String(err)}`,
          'network',
        )
      }
      await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      continue
    }

    // Retryable: 429 Too Many Requests + 5xx.
    if (response.status === 429 || response.status >= 500) {
      lastErr = new CfProvisionError(
        `CF API ${response.status} on ${path}`,
        response.status === 429 ? 'rate_limit' : 'server',
      )
      if (attempt === MAX_ATTEMPTS) throw lastErr
      await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1))
      continue
    }

    // Non-retryable: auth, conflict, not-found, other 4xx.
    if (response.status === 401 || response.status === 403) {
      throw new CfProvisionError(`CF API ${response.status} on ${path}`, 'auth')
    }
    if (response.status === 404) {
      throw new CfProvisionError(`CF API 404 on ${path}`, 'not_found')
    }
    if (response.status === 409) {
      throw new CfProvisionError(`CF API 409 on ${path}`, 'conflict')
    }
    if (response.status >= 400) {
      const text = await response.text().catch(() => '')
      throw new CfProvisionError(
        `CF API ${response.status} on ${path}: ${text.slice(0, 400)}`,
        'server',
      )
    }

    return (await response.json()) as T
  }

  // Unreachable — the loop body always either returns or throws.
  throw lastErr instanceof Error
    ? lastErr
    : new CfProvisionError('CF API exhausted retries', 'server')
}

// ═══════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════

export interface Bucket {
  name: string
  location: string
  creation_date: string
}

/**
 * Create an R2 bucket. Idempotent — if the bucket already exists (409),
 * fetches and returns the existing row instead of throwing. `locationHint`
 * defaults to 'apac' (DPDP data-residency). Valid CF location hints:
 * 'wnam', 'enam', 'weur', 'eeur', 'apac', 'auto'.
 */
export async function createBucket(
  name: string,
  locationHint: string = 'apac',
  opts?: Parameters<typeof cfFetch>[2],
): Promise<Bucket> {
  const { accountId } = requireEnv()
  try {
    const resp = await cfFetch<{ result: Bucket }>(
      `/accounts/${accountId}/r2/buckets`,
      {
        method: 'POST',
        body: JSON.stringify({ name, locationHint }),
      },
      opts,
    )
    return resp.result
  } catch (err) {
    if (err instanceof CfProvisionError && err.code === 'conflict') {
      // Bucket exists — reuse. GET the bucket metadata.
      const resp = await cfFetch<{ result: Bucket }>(
        `/accounts/${accountId}/r2/buckets/${name}`,
        { method: 'GET' },
        opts,
      )
      return resp.result
    }
    throw err
  }
}

export interface BucketScopedToken {
  token_id: string
  access_key_id: string
  secret_access_key: string
}

/**
 * Mint an S3-compatible bucket-scoped token for the given bucket.
 * Returns `secret_access_key` exactly once — the caller MUST encrypt and
 * persist it before this function's return value leaves scope. Subsequent
 * retrieval of the secret is not possible via the CF API.
 *
 * The token carries object-read + object-write permissions scoped to the
 * single named bucket. Delete-object is included so the verification probe
 * can clean up its sentinel.
 */
export async function createBucketScopedToken(
  bucketName: string,
  opts?: Parameters<typeof cfFetch>[2],
): Promise<BucketScopedToken> {
  const { accountId } = requireEnv()
  const resp = await cfFetch<{
    result: {
      id: string
      credentials?: {
        accessKeyId?: string
        secretAccessKey?: string
      }
    }
  }>(
    `/accounts/${accountId}/r2/tokens`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: `cs-bucket-${bucketName}`,
        permissions: ['object_read', 'object_write', 'object_delete'],
        buckets: [bucketName],
      }),
    },
    opts,
  )

  const creds = resp.result.credentials
  if (!creds?.accessKeyId || !creds?.secretAccessKey) {
    throw new CfProvisionError(
      `CF token created (${resp.result.id}) but credentials missing in response`,
      'server',
    )
  }
  return {
    token_id: resp.result.id,
    access_key_id: creds.accessKeyId,
    secret_access_key: creds.secretAccessKey,
  }
}

/**
 * Revoke a bucket-scoped token by id. Idempotent: 404 (already revoked /
 * never existed) is treated as success.
 */
export async function revokeBucketToken(
  tokenId: string,
  opts?: Parameters<typeof cfFetch>[2],
): Promise<void> {
  const { accountId } = requireEnv()
  try {
    await cfFetch(
      `/accounts/${accountId}/r2/tokens/${tokenId}`,
      { method: 'DELETE' },
      opts,
    )
  } catch (err) {
    if (err instanceof CfProvisionError && err.code === 'not_found') {
      return
    }
    throw err
  }
}

/**
 * Compute the S3 endpoint URL for an R2 bucket. CF R2's S3-compat endpoint
 * is account-scoped: `https://<account_id>.r2.cloudflarestorage.com`.
 */
export function r2Endpoint(): string {
  const { accountId } = requireEnv()
  return `https://${accountId}.r2.cloudflarestorage.com`
}
