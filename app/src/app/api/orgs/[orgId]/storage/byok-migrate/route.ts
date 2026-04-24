// ADR-1025 Phase 3 Sprint 3.2 — customer-facing BYOK migration initiation.
//
// Auth chain:
//   1. requireOrgAccess(['org_admin'])  — account_owner folds in.
//   2. Body parse + schema validation.
//   3. verifyTurnstileToken.
//   4. runVerificationProbe against the supplied target creds
//      (defense in depth — refuse bad creds before creating the row).
//   5. Encrypt target creds using the org's derived key via encrypt_secret.
//   6. INSERT storage_migrations row — the AFTER INSERT trigger fires
//      net.http_post to /api/internal/migrate-storage.
//
// The exclusion constraint storage_migrations_active_unique guarantees
// at most one active migration per org — a conflict returns 409.
//
// Credentials stay in request memory until the INSERT wraps them in
// to_credential_enc. The decrypted target creds are re-derived by the
// orchestrator on each chunk; the plaintext leaves this file as soon
// as the INSERT returns.

import { createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { csOrchestrator } from '@/lib/api/cs-orchestrator-client'
import {
  OrgAccessDeniedError,
  requireOrgAccess,
} from '@/lib/auth/require-org-role'
import { verifyTurnstileToken } from '@/lib/rights/turnstile'
import { runVerificationProbe } from '@/lib/storage/verify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MigrateBody {
  provider?: 'customer_r2' | 'customer_s3'
  bucket?: string
  region?: string
  endpoint?: string
  access_key_id?: string
  secret_access_key?: string
  mode?: 'forward_only' | 'copy_existing'
  turnstile_token?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params

  // 1. Auth + role. We discard the return value — the side-effect is
  //    the role gate. Nothing in this handler needs the authed client
  //    (we use csOrchestrator() for writes).
  try {
    await requireOrgAccess(orgId, ['org_admin'])
  } catch (err) {
    if (err instanceof OrgAccessDeniedError) {
      const status = err.reason === 'unauthenticated' ? 401 : 403
      return NextResponse.json({ error: err.reason }, { status })
    }
    throw err
  }

  // 2. Body parse.
  let body: MigrateBody
  try {
    body = (await request.json()) as MigrateBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const missing = validateRequired(body)
  if (missing) {
    return NextResponse.json(
      { error: 'missing_field', field: missing },
      { status: 400 },
    )
  }
  if (body.provider !== 'customer_r2' && body.provider !== 'customer_s3') {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 })
  }
  if (body.mode !== 'forward_only' && body.mode !== 'copy_existing') {
    return NextResponse.json({ error: 'invalid_mode' }, { status: 400 })
  }

  // 3. Turnstile.
  const remoteIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined
  const turnstile = await verifyTurnstileToken(body.turnstile_token!, remoteIp)
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: 'turnstile_failed', message: turnstile.error },
      { status: 400 },
    )
  }

  // 4. Verification probe — refuse to create a migration row for creds
  //    that can't PUT/GET/DELETE. Catches typos, wrong-region buckets,
  //    and revoked tokens before the chunk chain kicks off.
  const probe = await runVerificationProbe({
    provider: body.provider,
    endpoint: body.endpoint!,
    region: body.region!,
    bucket: body.bucket!,
    accessKeyId: body.access_key_id!,
    secretAccessKey: body.secret_access_key!,
  })
  if (!probe.ok) {
    return NextResponse.json(
      {
        error: 'probe_failed',
        failed_step: probe.failedStep,
        message: probe.error,
      },
      { status: 400 },
    )
  }

  const pg = csOrchestrator()

  // 5. Encrypt target credentials.
  const masterKey = process.env.MASTER_ENCRYPTION_KEY
  if (!masterKey) {
    return NextResponse.json(
      { error: 'MASTER_ENCRYPTION_KEY not configured' },
      { status: 500 },
    )
  }
  const saltRows = await pg<{ encryption_salt: string }[]>`
    select encryption_salt from public.organisations
     where id = ${orgId} limit 1
  `
  if (!saltRows.length) {
    return NextResponse.json({ error: 'org_not_found' }, { status: 404 })
  }
  const derivedKey = createHmac('sha256', masterKey)
    .update(`${orgId}${saltRows[0].encryption_salt}`)
    .digest('hex')

  const credentialJson = JSON.stringify({
    access_key_id: body.access_key_id,
    secret_access_key: body.secret_access_key,
  })
  const encRows = await pg<{ encrypt_secret: Buffer | string }[]>`
    select public.encrypt_secret(${credentialJson}, ${derivedKey})
  `
  const encrypted = normaliseBytea(encRows[0].encrypt_secret)

  // 6. Fetch the source config id.
  const srcRows = await pg<{ id: string }[]>`
    select id from public.export_configurations
     where org_id = ${orgId}
     limit 1
  `
  if (!srcRows.length) {
    return NextResponse.json(
      { error: 'no_source_export_config' },
      { status: 409 },
    )
  }

  // 7. Insert migration row. The exclusion constraint raises on a second
  //    active row for the same org — surface that as 409.
  const toConfig = {
    provider: body.provider,
    bucket: body.bucket,
    region: body.region,
    endpoint: body.endpoint,
  }
  try {
    const migRows = await pg<{ id: string }[]>`
      insert into public.storage_migrations
        (org_id, from_config_id, from_config_snapshot, to_config,
         to_credential_enc, mode, state)
      values (
        ${orgId},
        ${srcRows[0].id},
        (select jsonb_build_object(
                  'provider',    storage_provider,
                  'bucket',      bucket_name,
                  'region',      region,
                  'path_prefix', path_prefix
                )
           from public.export_configurations
          where org_id = ${orgId}),
        ${JSON.stringify(toConfig)}::jsonb,
        ${encrypted},
        ${body.mode},
        'queued'
      )
      returning id
    `
    return NextResponse.json({
      migration_id: migRows[0].id,
      mode: body.mode,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/storage_migrations_active_unique|conflicting key value/i.test(message)) {
      return NextResponse.json(
        { error: 'migration_already_active' },
        { status: 409 },
      )
    }
    throw err
  }
}

function validateRequired(b: MigrateBody): string | null {
  if (!b.provider) return 'provider'
  if (!b.bucket) return 'bucket'
  if (!b.region) return 'region'
  if (!b.endpoint) return 'endpoint'
  if (!b.access_key_id) return 'access_key_id'
  if (!b.secret_access_key) return 'secret_access_key'
  if (!b.mode) return 'mode'
  if (!b.turnstile_token) return 'turnstile_token'
  return null
}

function normaliseBytea(v: Buffer | string): Buffer {
  if (Buffer.isBuffer(v)) return v
  const hex = v.startsWith('\\x') ? v.slice(2) : v
  return Buffer.from(hex, 'hex')
}
