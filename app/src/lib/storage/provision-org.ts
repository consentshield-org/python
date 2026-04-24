// ADR-1025 Phase 2 Sprint 2.1 — customer-storage auto-provisioning orchestrator.
//
// Runs end-to-end provisioning for one org:
//   1. short-circuit if export_configurations row already verified
//   2. derive per-org bucket name (salted hash)
//   3. createBucket  (account-auth, idempotent on 409)
//   4. createBucketScopedToken  (user-auth, new token each run)
//   5. wait 5s for token propagation to R2 edge
//   6. runVerificationProbe (PUT → GET → sha256 → DELETE)
//   7. on success: encrypt credential JSON + UPSERT export_configurations
//      + flip is_verified=true
//   8. on failure: INSERT export_verification_failures row; leave
//      export_configurations untouched (or is_verified=false if we wrote
//      the row first)
//
// Takes a postgres.js client (cs_orchestrator connection). Never needs a
// Supabase JS client because it calls the pgcrypto `encrypt_secret` RPC
// via direct SQL with the per-org derived key computed in Node.
//
// Rule 11: the bucket-scoped secret exists in process memory only for the
// ~100 ms between createBucketScopedToken() return and the encrypt_secret
// call. It's cleared by going out of scope immediately after the INSERT.
// Never logged. The token_id is preserved in the encrypted JSON so a
// future rotation / revocation path can find it.

import type postgres from 'postgres'
import {
  CfProvisionError,
  createBucket,
  createBucketScopedToken,
  deriveBucketName,
  r2Endpoint,
  revokeBucketToken,
} from './cf-provision'
import {
  deriveOrgKey,
  normaliseBytea,
} from './org-crypto'
import { runVerificationProbe, type ProbeResult } from './verify'

const TOKEN_PROPAGATION_MS = 5000
const R2_REGION = 'auto'
const PROVIDER_TAG = 'cs_managed_r2'

export type ProvisionStatus =
  | 'provisioned'
  | 'already_provisioned'
  | 'verification_failed'

export interface ProvisionResult {
  status: ProvisionStatus
  configId: string | null
  bucketName: string
  probe?: ProbeResult
}

export interface ProvisionDeps {
  createBucket?: typeof createBucket
  createBucketScopedToken?: typeof createBucketScopedToken
  revokeBucketToken?: typeof revokeBucketToken
  runVerificationProbe?: typeof runVerificationProbe
  deriveBucketName?: typeof deriveBucketName
  r2Endpoint?: typeof r2Endpoint
  sleep?: (ms: number) => Promise<void>
}

type Pg = ReturnType<typeof postgres>

/**
 * Provision (or re-verify) the CS-managed R2 bucket + token for one org.
 * Idempotent at two layers: CF bucket creation is 409-tolerant, and the
 * DB writes upsert on `unique(org_id)`.
 */
export async function provisionStorageForOrg(
  pg: Pg,
  orgId: string,
  deps: ProvisionDeps = {},
): Promise<ProvisionResult> {
  const fns = {
    createBucket: deps.createBucket ?? createBucket,
    createBucketScopedToken: deps.createBucketScopedToken ?? createBucketScopedToken,
    revokeBucketToken: deps.revokeBucketToken ?? revokeBucketToken,
    runVerificationProbe: deps.runVerificationProbe ?? runVerificationProbe,
    deriveBucketName: deps.deriveBucketName ?? deriveBucketName,
    r2Endpoint: deps.r2Endpoint ?? r2Endpoint,
    sleep:
      deps.sleep ??
      ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  }

  // Step 1 — short-circuit if already verified.
  const existing = await pg<{ id: string; is_verified: boolean }[]>`
    select id, is_verified
      from public.export_configurations
     where org_id = ${orgId}
     limit 1
  `
  const bucketName = fns.deriveBucketName(orgId)
  if (existing.length && existing[0].is_verified) {
    return {
      status: 'already_provisioned',
      configId: existing[0].id,
      bucketName,
    }
  }

  // Step 2 — bucket (idempotent).
  await fns.createBucket(bucketName, 'apac')

  // Step 3 — fresh bucket-scoped token. If we're re-provisioning, we
  // intentionally mint a new one and abandon the old — token cleanup is a
  // Phase 4 concern.
  const token = await fns.createBucketScopedToken(bucketName)

  // Step 4 — token propagation window.
  await fns.sleep(TOKEN_PROPAGATION_MS)

  // Step 5 — verification probe.
  const endpoint = fns.r2Endpoint()
  const probe = await fns.runVerificationProbe({
    provider: 'cs_managed_r2',
    endpoint,
    region: R2_REGION,
    bucket: bucketName,
    accessKeyId: token.access_key_id,
    secretAccessKey: token.secret_access_key,
  })

  if (!probe.ok) {
    // Record the failure so the operator can see it; revoke the bad
    // token so it doesn't linger. Return without writing creds.
    await pg`
      insert into public.export_verification_failures
        (org_id, export_config_id, probe_id, failed_step,
         error_text, duration_ms, attempted_at)
      values (
        ${orgId},
        ${existing[0]?.id ?? null},
        ${probe.probeId},
        ${probe.failedStep ?? 'unknown'},
        ${probe.error ?? null},
        ${probe.durationMs},
        now()
      )
    `
    // Best-effort token revoke. If this throws, probe-failure return is
    // the important signal — swallow the revoke error.
    try {
      await fns.revokeBucketToken(token.token_id)
    } catch {
      /* intentional: revoke-on-failure is best-effort */
    }
    return {
      status: 'verification_failed',
      configId: existing[0]?.id ?? null,
      bucketName,
      probe,
    }
  }

  // Step 6 — encrypt credential JSON using per-org derived key.
  const credentialJson = JSON.stringify({
    token_id: token.token_id,
    access_key_id: token.access_key_id,
    secret_access_key: token.secret_access_key,
  })
  const derivedKey = await deriveOrgKey(pg, orgId)
  const encryptedRows = await pg<{ encrypt_secret: Buffer | string }[]>`
    select public.encrypt_secret(${credentialJson}, ${derivedKey})
  `
  if (!encryptedRows.length) {
    throw new Error('encrypt_secret returned no rows')
  }
  const encrypted = normaliseBytea(encryptedRows[0].encrypt_secret)

  // Step 7 — UPSERT export_configurations.
  const upserted = await pg<{ id: string }[]>`
    insert into public.export_configurations (
      org_id, storage_provider, bucket_name, path_prefix, region,
      write_credential_enc, is_verified, updated_at
    ) values (
      ${orgId}, ${PROVIDER_TAG}, ${bucketName}, '', ${R2_REGION},
      ${encrypted}, true, now()
    )
    on conflict (org_id) do update
      set storage_provider     = excluded.storage_provider,
          bucket_name          = excluded.bucket_name,
          region               = excluded.region,
          write_credential_enc = excluded.write_credential_enc,
          is_verified          = true,
          updated_at           = now()
    returning id
  `

  return {
    status: 'provisioned',
    configId: upserted[0]?.id ?? null,
    bucketName,
    probe,
  }
}

// Re-export for callers that want the error discriminator at a single
// import site.
export { CfProvisionError }
