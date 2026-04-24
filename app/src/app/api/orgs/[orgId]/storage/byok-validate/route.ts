// ADR-1025 Phase 3 Sprint 3.1 — BYOK credential validation.
//
// Stateless endpoint: runs the verification probe against a set of
// customer-supplied S3/R2 credentials and returns {ok, failed_step?, error?}.
// Credentials stay in request memory only — this route NEVER writes to
// export_configurations (that's Sprint 3.2's migration step).
//
// Auth chain:
//   1. Authenticated user via Supabase server client.
//   2. Org role gate — 'org_admin' (folds account_owner via effective_org_role).
//   3. Turnstile challenge verified.
//   4. Per-account rate limit — 5 attempts / hour (Upstash Redis).
//   5. Body schema validation.
//   6. runVerificationProbe → 4-step PUT/GET/sha256/DELETE against CF.
//
// Rule 11: nothing in this file ever calls console.log on the body. Sentry
// capture is also suppressed for this route (handled by the Sentry beforeSend
// strip of request.body).

import { NextResponse } from 'next/server'
import {
  OrgAccessDeniedError,
  requireOrgAccess,
} from '@/lib/auth/require-org-role'
import { checkRateLimit } from '@/lib/rights/rate-limit'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { runVerificationProbe, type StorageConfig } from '@/lib/storage/verify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RATE_LIMIT_PER_HOUR = 5

interface ValidateBody {
  provider?: string
  bucket?: string
  region?: string
  endpoint?: string
  access_key_id?: string
  secret_access_key?: string
  turnstile_token?: string
}

interface ValidateOk {
  ok: true
  probe_id: string
  duration_ms: number
}

interface ValidateFail {
  ok: false
  failed_step: 'put' | 'get' | 'content_hash' | 'delete'
  error: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params

  // 1+2. Auth + role.
  let authCtx: Awaited<ReturnType<typeof requireOrgAccess>>
  try {
    authCtx = await requireOrgAccess(orgId, ['org_admin'])
  } catch (err) {
    if (err instanceof OrgAccessDeniedError) {
      const status =
        err.reason === 'unauthenticated'
          ? 401
          : err.reason === 'not_a_member'
            ? 403
            : 403
      return NextResponse.json({ error: err.reason }, { status })
    }
    throw err
  }

  // 5. Body parse FIRST so Turnstile runs only on well-formed requests.
  // Keep the body in a narrow scope so the credentials go out of lexical
  // scope as soon as the probe returns.
  let body: ValidateBody
  try {
    body = (await request.json()) as ValidateBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const provider = body.provider
  const bucket = body.bucket
  const region = body.region
  const endpoint = body.endpoint
  const accessKeyId = body.access_key_id
  const secretAccessKey = body.secret_access_key
  const turnstileToken = body.turnstile_token

  const missing = validateRequiredFields({
    provider,
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    turnstileToken,
  })
  if (missing) {
    return NextResponse.json(
      { error: 'missing_field', field: missing },
      { status: 400 },
    )
  }
  if (provider !== 'customer_r2' && provider !== 'customer_s3') {
    return NextResponse.json(
      { error: 'invalid_provider' },
      { status: 400 },
    )
  }

  // 3. Turnstile.
  const remoteIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined
  const turnstile = await verifyTurnstileToken(turnstileToken!, remoteIp)
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: 'turnstile_failed', message: turnstile.error },
      { status: 400 },
    )
  }

  // 4. Rate-limit per-account (not per-org) — same-account can't DoS by
  // switching orgs. Reads the derived account_id from the auth context.
  //
  // We use the authed user's id as the bucket because effective_org_role
  // already confirmed the membership + account; anchoring on the user
  // rather than the account id keeps the key simple and covers the
  // one-account-per-user invariant (v1). Move to account-keyed when v2
  // multi-account lands.
  const rl = await checkRateLimit(
    `byok-validate:${authCtx.user.id}`,
    RATE_LIMIT_PER_HOUR,
    60,
  )
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        retry_in_seconds: rl.retryInSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryInSeconds) },
      },
    )
  }

  // 6. Run the probe. The StorageConfig's `provider` discriminator is
  // retained in the sentinel body — if the customer's bucket policy
  // inspects requests, they'll see `cs_verify_probe` markers.
  const config: StorageConfig = {
    provider: provider as 'customer_r2' | 'customer_s3',
    endpoint: endpoint!,
    region: region!,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
  }
  const probe = await runVerificationProbe(config)

  if (probe.ok) {
    const payload: ValidateOk = {
      ok: true,
      probe_id: probe.probeId,
      duration_ms: probe.durationMs,
    }
    return NextResponse.json(payload)
  }

  const payload: ValidateFail = {
    ok: false,
    failed_step: probe.failedStep ?? 'put',
    error: probe.error ?? 'unknown',
  }
  // 200 — the probe ran and produced a structured failure; callers render
  // it as a form-level error, not a transport error.
  return NextResponse.json(payload)
}

function validateRequiredFields(fields: {
  provider: string | undefined
  bucket: string | undefined
  region: string | undefined
  endpoint: string | undefined
  accessKeyId: string | undefined
  secretAccessKey: string | undefined
  turnstileToken: string | undefined
}): string | null {
  if (!fields.provider) return 'provider'
  if (!fields.bucket) return 'bucket'
  if (!fields.region) return 'region'
  if (!fields.endpoint) return 'endpoint'
  if (!fields.accessKeyId) return 'access_key_id'
  if (!fields.secretAccessKey) return 'secret_access_key'
  if (!fields.turnstileToken) return 'turnstile_token'
  return null
}
